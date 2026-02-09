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

  return data.id as number;
}

// GET /api/templates?program_slug=default
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const programSlug = url.searchParams.get("program_slug") || "default";

    const programId = await getProgramIdBySlug(programSlug);

    const { data, error } = await supabase
      .from("email_templates")
      .select("id,name,html,program_id")
      .eq("program_id", programId)
      .order("id", { ascending: true });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ templates: data ?? [] }, { status: 200 });
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

    // Asegurar program_id en cada fila
    const payload = templates.map((t: any) => ({
      id: t.id,
      name: t.name,
      html: t.html,
      program_id: programId
    }));

    const { error } = await supabase
      .from("email_templates")
      .upsert(payload, { onConflict: "id" });

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
