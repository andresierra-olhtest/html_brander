import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Función helper para obtener el program_id desde slug o query
async function getProgramId(searchParams: URLSearchParams) {
  const slug = searchParams.get("program_slug") || "default";

  const { data, error } = await supabase
    .from("programs")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Program with slug "${slug}" not found`);
  return data.id as number;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const programId = await getProgramId(searchParams);

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

export async function POST(request: Request) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (adminToken && request.headers.get("x-admin-token") !== adminToken) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const templates = body?.templates;
    const programSlug = body?.program_slug || "default";

    if (!Array.isArray(templates)) {
      return Response.json(
        { error: "templates must be an array" },
        { status: 400 }
      );
    }

    // buscamos program_id por slug
    const { data: program, error: programError } = await supabase
      .from("programs")
      .select("id")
      .eq("slug", programSlug)
      .maybeSingle();

    if (programError) throw programError;
    if (!program) {
      return Response.json(
        { error: `Program with slug "${programSlug}" not found` },
        { status: 400 }
      );
    }

    const programId = program.id as number;

    // nos aseguramos de que cada template tenga program_id correcto
    const templatesWithProgram = templates.map((t: any) => ({
      ...t,
      program_id: programId
    }));

    const { error } = await supabase
      .from("email_templates")
      .upsert(templatesWithProgram, { onConflict: "id" });

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
