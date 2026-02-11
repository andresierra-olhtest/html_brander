// api/tellescope/templates.js

async function readJson(req) {
  // si ya viene parseado, úsalo
  if (req.body && typeof req.body === "object") return req.body;

  // si no, lee el stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  try {
    const { apiKey, businessId, limit = 100, sort = "newFirst" } = await readJson(req);

    if (!apiKey || !businessId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "Missing apiKey or businessId" }));
    }

    const payload = { filter: { businessId }, limit, sort };
    const url = "https://api.tellescope.com/v1/templates";

    // 1) intenta POST (más compatible)
    let r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `API_KEY ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(payload),
    });

    // 2) fallback GET con body si hiciera falta (poco estándar)
    if (!r.ok) {
      r = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `API_KEY ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "*/*",
        },
        body: JSON.stringify(payload),
      });
    }

    const json = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.statusCode = r.status || 500;
      return res.end(JSON.stringify({ error: "Tellescope fetch failed", details: json }));
    }

    const templates = json.templates || json.results || json.items || [];
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ templates, raw: json }));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: e?.message || String(e) }));
  }
};
