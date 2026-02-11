// api/tellescope/templates.js
const https = require("https");

async function readJson(req) {
  // Si Vercel ya lo parseó
  if (req.body && typeof req.body === "object") return req.body;

  // Si no, lee el stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function httpsRequest({ method, hostname, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const r = https.request({ method, hostname, path, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          body: data,
        })
      );
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // TU PROXY: lo hacemos POST para que el browser/postman mande JSON normal
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Use POST" }));
  }

  try {
    const { apiKey, businessId, limit = 100, sort = "newFirst", filter = {} } =
      await readJson(req);

    const bizId = businessId || filter.businessId;

    if (!apiKey || !bizId) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "apiKey and businessId are required" }));
    }

    // Payload EXACTO como Postman
    const payload = JSON.stringify({
      filter: { ...filter, businessId: bizId },
      limit,
      sort,
    });

    // TELLESCOPE: GET con JSON body (fetch no lo permite, https.request sí)
    const out = await httpsRequest({
      method: "GET",
      hostname: "api.tellescope.com",
      path: "/v1/templates",
      headers: {
        Authorization: `API_KEY ${apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Accept: "application/json",
      },
      body: payload,
    });

    let json;
    try {
      json = JSON.parse(out.body || "{}");
    } catch {
      json = { raw: out.body };
    }

    if (out.status < 200 || out.status >= 300) {
      res.statusCode = out.status || 502;
      return res.end(
        JSON.stringify({
          error: "Tellescope error",
          status: out.status,
          details: json,
        })
      );
    }

    res.statusCode = 200;
    return res.end(JSON.stringify(json));
  } catch (e) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: e?.message || String(e) }));
  }
};
