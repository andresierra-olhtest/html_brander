// api/tellescope/forms.js
const https = require("https");

async function readJson(req) {
  // Si Vercel ya parseó body (a veces pasa), úsalo
  if (req.body && typeof req.body === "object") return req.body;

  // Si no, lee el stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, obj) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function normalizeAuth(apiKey) {
  const v = String(apiKey || "").trim();
  if (!v) return "";
  // ✅ Soporta: token solo o "API_KEY token"
  return v.startsWith("API_KEY ") ? v : `API_KEY ${v}`;
}

function httpRequest({ hostname, path, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method, headers },
      (resp) => {
        const chunks = [];
        resp.on("data", (d) => chunks.push(d));
        resp.on("end", () => {
          resolve({
            status: resp.statusCode || 0,
            headers: resp.headers || {},
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("Tellescope request timeout"));
    });

    if (body) req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Use POST" });
  }

  try {
    const {
      apiKey,
      businessId,
      limit = 200,
      sort = "newFirst",
      lastId,
      search,
      debug,
      // 👇 opcional: si quieres permitir un filter override en el futuro
      filter,
    } = await readJson(req);

    const auth = normalizeAuth(apiKey);
    const biz = String(businessId || "").trim();

    if (!auth) return sendJson(res, 400, { error: "Missing apiKey" });
    if (!biz) return sendJson(res, 400, { error: "Missing businessId" });

    // ✅ mismo patrón que templates: GET con body, filter por businessId
    const payload = {
      filter: { ...(filter || {}), businessId: biz },
      limit,
      sort,
    };
    if (lastId) payload.lastId = lastId;
    if (search) payload.search = String(search);

    const body = JSON.stringify(payload);

    const r = await httpRequest({
      hostname: "api.tellescope.com",
      path: "/v1/forms",          // ✅ CAMBIO: endpoint de forms
      method: "GET",              // ✅ igual que templates
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth,
        "Content-Length": Buffer.byteLength(body),
      },
      body,
    });

    let parsed = {};
    try {
      parsed = r.text ? JSON.parse(r.text) : {};
    } catch {
      parsed = { raw: r.text };
    }

    // ✅ respeta status si Tellescope devuelve error
    if (r.status >= 400) {
      return sendJson(res, r.status, {
        error: parsed?.error || parsed?.message || "Tellescope error",
        details: debug ? parsed : undefined,
      });
    }

    // ✅ normaliza forms (Tellescope puede devolver array plano o envuelto)
    const forms =
      (Array.isArray(parsed) && parsed) || // ✅ respuesta tipo array
      (Array.isArray(parsed.forms) && parsed.forms) ||
      (Array.isArray(parsed?.data?.forms) && parsed.data.forms) ||
      (Array.isArray(parsed?.data) && parsed.data) || // por si data es array
      (Array.isArray(parsed?.results) && parsed.results) ||
      (Array.isArray(parsed?.items) && parsed.items) ||
      [];

    if (!forms.length) {
      return sendJson(res, 502, {
        error: "Tellescope returned 200 but no forms array was found.",
        meta: debug
          ? {
              status: r.status,
              topLevelKeys: Object.keys(parsed || {}),
              sample: typeof r.text === "string" ? r.text.slice(0, 600) : "",
            }
          : undefined,
      });
    }

    return sendJson(res, 200, {
      forms,
      meta: debug ? { count: forms.length } : undefined,
    });
  } catch (e) {
    return sendJson(res, 500, {
      error: "Server error in /api/tellescope/forms",
      details: String(e?.message || e),
    });
  }
};
