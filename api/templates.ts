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

async function getProgramIdBySlug(slug: string) {
  const programSlug = (slug || "default").trim() || "default";

  const { data, error } = await supabase
    .from("programs")
    .select("id")
    .eq("slug", programSlug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Program not found for slug: ${programSlug}`);

  return Number(data.id);
}

type DbTemplateRow = {
  id: number; // DB primary key
  program_id: number;
  local_template_id: number;
  name: string | null;
  html: string | null;
  sort_order: number | null;
};

// GET /api/templates?program_slug=default
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const programSlug = url.searchParams.get("program_slug") || "default";
    const programId = await getProgramIdBySlug(programSlug);

    const { data, error } = await supabase
      .from("email_templates")
      .select("id,program_id,local_template_id,name,html,sort_order")
      .eq("program_id", programId)
      // orden principal: sort_order
      .order("sort_order", { ascending: true, nullsFirst: false })
      // fallback estable
      .order("local_template_id", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as DbTemplateRow[];

    // IMPORTANT:
    // Devolvemos `id` como `local_template_id` para que el frontend siga igual (sin cambios).
    const templates = rows.map((r) => ({
      id: r.local_template_id ?? r.id,
      name: r.name ?? "",
      html: r.html ?? "",
      program_id: r.program_id,
      sort_order: r.sort_order ?? null,
      // Si alguna vez necesitas debug:
      // db_id: r.id,
    }));

    return Response.json({ templates }, { status: 200 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

// POST /api/templates  { program_slug: "default", templates: [...] }
export async function POST(req: Request) {
  try {
    const auth = requireAdmin(req);
    if (auth) return auth;

    const body = await req.json().catch(() => null);
    const templates = body?.templates;
    const programSlug = body?.program_slug || "default";

    if (!Array.isArray(templates)) {
      return Response.json(
        { error: "templates must be an array" },
        { status: 400 }
      );
    }

    const programId = await getProgramIdBySlug(programSlug);

    // Validación: ids duplicados dentro del mismo payload
    const seen = new Set<number>();
    for (const t of templates) {
      const localId = Number(t?.id);
      if (!Number.isFinite(localId)) {
        return Response.json(
          { error: `template.id must be a number (got: ${t?.id})` },
          { status: 400 }
        );
      }
      if (seen.has(localId)) {
        return Response.json(
          { error: `duplicate template id found: ${localId}` },
          { status: 400 }
        );
      }
      seen.add(localId);
    }

    // Guardamos el orden del array como sort_order.
    // IMPORTANT: usamos local_template_id para que cada programa tenga su propio "id lógico".
    const payload = templates.map((t: any, idx: number) => ({
      program_id: programId,
      local_template_id: Number(t.id),
      name: String(t?.name || ""),
      html: String(t?.html || ""),
      sort_order: idx + 1,
    }));

    const { error } = await supabase
      .from("email_templates")
      .upsert(payload, { onConflict: "program_id,local_template_id" });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return Response.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
