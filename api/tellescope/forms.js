// api/tellescope/forms.js

async function readJson(req) {
  // si ya viene parseado, úsalo
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

function pickArray(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  try {
    const { apiKey, businessId, limit = 200, sort = "newFirst", debug = false, ...rest } =
      await readJson(req);

    if (!apiKey || !businessId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "apiKey and businessId are required" }));
    }

    // arma el body tal cual lo haces en templates.js
    const body = { businessId, limit, sort, ...rest };

    // ⚠️ Usa el mismo método + headers que templates.js
    const tsRes = await fetch("https://api.tellescope.com/v1/forms", {
      method: "POST", // si tu templates.js usa GET, cámbialo aquí también
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey, // si en templates.js usas Bearer, aplícalo aquí igual
      },
      body: JSON.stringify(body),
    });

    const raw = await tsRes.text();
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

    if (!tsRes.ok) {
      res.statusCode = tsRes.status;
      return res.end(JSON.stringify({
        error: "Tellescope error",
        meta: { status: tsRes.status },
        data: debug ? data : undefined,
      }));
    }

    const forms = pickArray(data, "forms");

    if (!forms.length) {
      res.statusCode = 502;
      return res.end(JSON.stringify({
        error: "Tellescope returned 200 but no forms array was found.",
        meta: {
          status: tsRes.status,
          topLevelKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 20) : [],
          sample: typeof raw === "string" ? raw.slice(0, 300) : "",
        },
      }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ forms }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: e?.message || String(e) }));
  }
};
