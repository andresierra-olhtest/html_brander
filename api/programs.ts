import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function requireAdmin(req: Request) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && req.headers.get("x-admin-token") !== adminToken) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

// GET /api/programs  -> programs + fields
export async function GET() {
  const { data: programs, error: pErr } = await supabase
    .from("programs")
    .select("id,name,slug,created_at")
    .order("created_at", { ascending: true });

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  const ids = (programs ?? []).map((p) => p.id);
  const { data: fields, error: fErr } = await supabase
    .from("program_fields")
    .select("id,program_id,label,key,is_core,sort_order")
    .in("program_id", ids.length ? ids : [-1])
    .order("sort_order", { ascending: true });

  if (fErr) return Response.json({ error: fErr.message }, { status: 500 });

  const byProgram: Record<string, any[]> = {};
  (fields ?? []).forEach((f) => {
    byProgram[f.program_id] = byProgram[f.program_id] || [];
    byProgram[f.program_id].push(f);
  });

  const enriched = (programs ?? []).map((p) => ({
    ...p,
    fields: byProgram[p.id] || [],
  }));

  return Response.json({ programs: enriched }, { status: 200 });
}

// POST /api/programs  -> create program OR update fields
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "create_program") {
    const name = String(body?.name || "").trim();
    const slug = String(body?.slug || "").trim() || name.toLowerCase().replace(/\s+/g, "_");

    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    const { data, error } = await supabase
      .from("programs")
      .insert({ name, slug })
      .select("id,name,slug")
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    // create core fields for new program
    const core = [
      { label: "Brand Name", key: "brand_name", is_core: true, sort_order: 1 },
      { label: "Primary Color", key: "brand_color", is_core: true, sort_order: 2 },
      { label: "Logo URL", key: "logo_url", is_core: true, sort_order: 3 },
      { label: "Support Email", key: "support_email", is_core: true, sort_order: 4 },
      { label: "Support Phone", key: "support_phone_raw", is_core: true, sort_order: 5 },
    ].map((c) => ({ ...c, program_id: data.id }));

    await supabase.from("program_fields").upsert(core, { onConflict: "program_id,key" });

    return Response.json({ program: data }, { status: 200 });
  }

  if (action === "update_fields") {
    const programId = Number(body?.program_id);
    const fields = body?.fields;

    if (!programId || !Array.isArray(fields)) {
      return Response.json({ error: "program_id and fields required" }, { status: 400 });
    }

    // enforce max 10 extras
    const extras = fields.filter((f: any) => !f.is_core);
    if (extras.length > 10) {
      return Response.json({ error: "max 10 extra fields" }, { status: 400 });
    }

    // upsert provided fields (core + extras)
    const payload = fields.map((f: any, idx: number) => ({
      program_id: programId,
      label: String(f.label || "").trim(),
      key: String(f.key || "").trim(),
      is_core: !!f.is_core,
      sort_order: Number.isFinite(f.sort_order) ? f.sort_order : idx + 1
    }));

    if (payload.some((f: any) => !f.label || !f.key)) {
      return Response.json({ error: "each field needs label + key" }, { status: 400 });
    }

    const { error: upErr } = await supabase
      .from("program_fields")
      .upsert(payload, { onConflict: "program_id,key" });

    if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

    // delete removed extras (keep core always)
    const keepKeys = new Set(payload.map((p: any) => p.key));
    const { data: existing } = await supabase
      .from("program_fields")
      .select("id,key,is_core")
      .eq("program_id", programId);

    const toDelete = (existing ?? [])
      .filter((f: any) => !f.is_core && !keepKeys.has(f.key))
      .map((f: any) => f.id);

    if (toDelete.length) await supabase.from("program_fields").delete().in("id", toDelete);

    return Response.json({ ok: true }, { status: 200 });
  }

  return Response.json({ error: "invalid action" }, { status: 400 });
}
