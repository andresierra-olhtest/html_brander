import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET() {
  const { data, error } = await supabase
    .from("email_templates")
    .select("id,name,html")
    .order("id", { ascending: true });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ templates: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && req.headers.get("x-admin-token") !== adminToken) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const templates = body?.templates;

  if (!Array.isArray(templates)) {
    return Response.json({ error: "templates must be an array" }, { status: 400 });
  }

  const { error } = await supabase
    .from("email_templates")
    .upsert(templates, { onConflict: "id" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true }, { status: 200 });
}
