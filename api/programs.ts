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

function slugify(name: string) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

// GET /api/programs  -> programs + fields
export async function GET() {
  const { data: programs, error: pErr } = await supabase
    .from("programs")
    .select("id,name,slug,created_at")
    .order("created_at", { ascending: true });

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 });

  const ids = (programs ?? []).map((p) => p.id);

  // ✅ IMPORTANT: include is_form_link
  const { data: fields, error: fErr } = await supabase
    .from("program_fields")
    .select("id,program_id,label,key,is_core,is_form_link,sort_order")
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

  // -----------------------
  // CREATE PROGRAM
  // -----------------------
  if (action === "create_program") {
    const name = String(body?.name || "").trim();
    const slug = String(body?.slug || "").trim() || slugify(name);

    if (!name) return Response.json({ error: "name required" }, { status: 400 });

    const { data, error } = await supabase
      .from("programs")
      .insert({ name, slug })
      .select("id,name,slug")
      .single();

    if (error) return Response.json({ error: error.message }, { status: 500 });

    // create core fields for new program
    const core = [
      { label: "Brand Name", key: "brand_name", is_core: true, is_form_link: false, sort_order: 1 },
      { label: "Primary Color", key: "brand_color", is_core: true, is_form_link: false, sort_order: 2 },
      { label: "Logo URL", key: "logo_url", is_core: true, is_form_link: false, sort_order: 3 },
      { label: "Support Email", key: "support_email", is_core: true, is_form_link: false, sort_order: 4 },
      { label: "Support Phone", key: "support_phone_raw", is_core: true, is_form_link: false, sort_order: 5 },
    ].map((c) => ({ ...c, program_id: data.id }));

    const { error: coreErr } = await supabase
      .from("program_fields")
      .upsert(core, { onConflict: "program_id,key" });

    if (coreErr) return Response.json({ error: coreErr.message }, { status: 500 });

    return Response.json({ program: data }, { status: 200 });
  }

  // -----------------------
  // UPDATE FIELDS
  // -----------------------
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

    // Trae existentes UNA vez (sirve para preservar is_form_link si viniera undefined,
    // y también para luego borrar los removidos)
    const { data: existing, error: exErr } = await supabase
      .from("program_fields")
      .select("id,key,is_core,is_form_link")
      .eq("program_id", programId);

    if (exErr) return Response.json({ error: exErr.message }, { status: 500 });

    const existingByKey = new Map<string, any>(
      (existing ?? []).map((f: any) => [String(f.key), f])
    );

    // upsert provided fields (core + extras)
    const payload = fields.map((f: any, idx: number) => {
      const label = String(f.label || "").trim();
      const key = String(f.key || "").trim();
      const isCore = !!f.is_core;

      const so = Number(f.sort_order);
      const sort_order = Number.isFinite(so) ? so : idx + 1;

      // ✅ is_form_link:
      // - core fields => siempre false
      // - extras => usa boolean si viene; si no viene, preserva lo que ya estaba en DB
      const prev = key ? existingByKey.get(key) : null;
      const is_form_link = isCore
        ? false
        : (typeof f.is_form_link === "boolean"
            ? f.is_form_link
            : (prev?.is_form_link ?? false));

      return {
        program_id: programId,
        label,
        key,
        is_core: isCore,
        is_form_link,
        sort_order,
      };
    });

    if (payload.some((f: any) => !f.label || !f.key)) {
      return Response.json({ error: "each field needs label + key" }, { status: 400 });
    }

    // (Opcional pero recomendado) evita keys duplicadas en el payload
    const seen = new Set<string>();
    for (const f of payload) {
      if (seen.has(f.key)) {
        return Response.json({ error: `duplicate field key: ${f.key}` }, { status: 400 });
      }
      seen.add(f.key);
    }

    const { error: upErr } = await supabase
      .from("program_fields")
      .upsert(payload, { onConflict: "program_id,key" });

    if (upErr) return Response.json({ error: upErr.message }, { status: 500 });

    // delete removed extras (keep core always)
    const keepKeys = new Set(payload.map((p: any) => p.key));
    const toDelete = (existing ?? [])
      .filter((f: any) => !f.is_core && !keepKeys.has(String(f.key)))
      .map((f: any) => f.id);

    if (toDelete.length) {
      const { error: delErr } = await supabase
        .from("program_fields")
        .delete()
        .in("id", toDelete);

      if (delErr) return Response.json({ error: delErr.message }, { status: 500 });
    }

    return Response.json({ ok: true }, { status: 200 });
  }

  return Response.json({ error: "invalid action" }, { status: 400 });
}
