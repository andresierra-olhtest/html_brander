// api/tellescope/push.js

async function readJson(req) {
  // Si Vercel ya lo parseó:
  if (req.body && typeof req.body === "object") return req.body;

  // Si no, lee el stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function normalizeAuth(apiKey) {
  const key = String(apiKey || "").trim();
  if (!key) return "";
  return key.startsWith("API_KEY ") ? key : `API_KEY ${key}`;
}

module.exports = async (req, res) => {
  // Solo POST (más simple desde browser)
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  try {
    const body = await readJson(req);

    const apiKey = body.apiKey;
    const updates = body.updates; // [{ templateId, html }]
    const replaceObjectFields = !!body.replaceObjectFields;

    const auth = normalizeAuth(apiKey);

    if (!auth) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Missing apiKey" }));
    }

    if (!Array.isArray(updates) || updates.length === 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ error: "Missing updates[]" }));
    }

    // Ejecuta en serie (más seguro por rate limits / tamaños)
    const results = [];
    let updatedCount = 0;

    for (const u of updates) {
      const templateId = String(u?.templateId || "").trim();
      const html = String(u?.html ?? "");

      if (!templateId) {
        results.push({ templateId: "", ok: false, error: "Missing templateId" });
        continue;
      }

      const url = `https://api.tellescope.com/v1/template/${encodeURIComponent(templateId)}`;

      const payload = {
        updates: {
          // mínimo viable: actualizar HTML
          html,
          mode: "html",
        },
        options: {
          replaceObjectFields,
        },
      };

      const r = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": auth,
        },
        body: JSON.stringify(payload),
      });

      const json = await r.json().catch(() => ({}));

      if (!r.ok) {
        results.push({
          templateId,
          ok: false,
          status: r.status,
          error: json?.error || json?.message || "Patch failed",
          details: json,
        });
        continue;
      }

      updatedCount++;
      results.push({ templateId, ok: true, status: r.status });
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      updatedCount,
      total: updates.length,
      results,
    }));
  } catch (e) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({
      error: e?.message || "Internal error",
      details: String(e),
    }));
  }
};
