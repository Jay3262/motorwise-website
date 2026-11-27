// Vehicle lookup for Motorwise Desk.
// POST { reg } with "Authorization: Bearer <GitHub token>" (the Desk sends the signed-in user's token).
// Uses two free government services. Set these in Netlify > Project configuration > Environment variables:
//   DVLA_API_KEY                         Vehicle Enquiry Service key (make, colour, fuel, year, engine, MOT expiry)
//   MOT_CLIENT_ID, MOT_CLIENT_SECRET,    DVSA MOT History API credentials (model, mileage history, advisories)
//   MOT_API_KEY, MOT_TOKEN_URL
//   Access: anyone who can open the private books repo (DESK_BOOKS_REPO, default Jay3262/motorwise-books).
//   DESK_GITHUB_USERS (optional)         extra comma-separated GitHub usernames to allow
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const iso = d => d ? String(d).slice(0, 10).replace(/\./g, "-") : null;
const fmt = d => { if (!d) return ""; const x = new Date(d + "T12:00"); return isNaN(x) ? d : x.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };

async function signedInUser(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, "User-Agent": "motorwise-desk" } });
  if (!r.ok) return null;
  const u = await r.json();
  const allowed = (env("DESK_GITHUB_USERS") || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.includes(String(u.login).toLowerCase())) return u.login;
  // Anyone the owner has added to the private books repo (Desk → Admin → Team) can use lookup.
  const books = env("DESK_BOOKS_REPO") || "Jay3262/motorwise-books";
  const b = await fetch(`https://api.github.com/repos/${books}`, { headers: { Authorization: `Bearer ${token}`, "User-Agent": "motorwise-desk" } });
  return b.ok ? u.login : null;
}

async function dvla(reg) {
  const key = env("DVLA_API_KEY"); if (!key) return { missing: "DVLA_API_KEY" };
  const r = await fetch("https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles", { method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json" }, body: JSON.stringify({ registrationNumber: reg }) });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) return { error: `DVLA lookup failed (${r.status})` };
  return { data: await r.json() };
}

async function motHistory(reg) {
  const id = env("MOT_CLIENT_ID"), secret = env("MOT_CLIENT_SECRET"), key = env("MOT_API_KEY"), tokenUrl = env("MOT_TOKEN_URL");
  if (!id || !secret || !key || !tokenUrl) return { missing: "MOT API credentials" };
  const t = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret, scope: env("MOT_SCOPE") || "https://tapi.dvsa.gov.uk/.default" }) });
  if (!t.ok) return { error: `MOT sign-in failed (${t.status})` };
  const { access_token } = await t.json();
  const r = await fetch(`https://history.mot.api.gov.uk/v1/trade/vehicles/registration/${encodeURIComponent(reg)}`, { headers: { Authorization: `Bearer ${access_token}`, "X-API-Key": key } });
  if (r.status === 404) return { notFound: true };
  if (!r.ok) return { error: `MOT history lookup failed (${r.status})` };
  return { data: await r.json() };
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });
  const user = await signedInUser(req).catch(() => null);
  if (!user) return json(401, { error: "Sign in to the Desk to use vehicle lookup" });
  const { reg: raw } = await req.json().catch(() => ({}));
  const reg = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{2,8}$/.test(reg)) return json(400, { error: "That doesn't look like a UK registration" });

  const [v, m] = await Promise.all([dvla(reg).catch(e => ({ error: e.message })), motHistory(reg).catch(e => ({ error: e.message }))]);
  if (v.missing && m.missing) return json(501, { error: "Vehicle lookup isn't switched on yet. Add the DVLA and MOT keys in Netlify" });
  if ((v.notFound || v.missing || v.error) && (m.notFound || m.missing || m.error) && !(v.data || m.data)) {
    return json(v.notFound || m.notFound ? 404 : 502, { error: v.notFound || m.notFound ? "No vehicle found with that registration" : (v.error || m.error) });
  }
  const d = v.data || {}, h = m.data || {};
  const tests = (h.motTests || []).map(t => ({
    date: iso(t.completedDate), result: t.testResult, expiry: iso(t.expiryDate),
    mileage: t.odometerValue ? Number(t.odometerValue) : null, unit: t.odometerUnit || "MI",
    defects: (t.defects || []).map(x => ({ type: x.type, text: x.text, dangerous: !!x.dangerous })),
  })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const last = tests[0];
  const lastPass = tests.find(t => t.result === "PASSED");
  let motSummary = "";
  if (lastPass) {
    const adv = lastPass.defects.filter(x => x.type === "ADVISORY" || x.type === "MINOR").map(x => x.text);
    motSummary = `Passed ${fmt(lastPass.date)}${adv.length ? `. Advisories: ${adv.join("; ")}` : " with no advisories"}.`;
  }
  const warnings = [];
  if (v.missing) warnings.push("DVLA key not set, so some details are missing.");
  if (m.missing) warnings.push("MOT history key not set, so model and mileage history are missing.");
  if (h.hasOutstandingRecall === "Yes") warnings.push("DVSA says this vehicle has an outstanding safety recall.");
  if (last && last.result === "FAILED") warnings.push("Its most recent MOT test was a fail.");
  return json(200, {
    reg, make: d.make || h.make || null, model: h.model || null, colour: d.colour || h.primaryColour || null,
    fuel: d.fuelType || h.fuelType || null, year: d.yearOfManufacture || (h.manufactureDate ? Number(String(h.manufactureDate).slice(0, 4)) : null),
    engineCc: d.engineCapacity || (h.engineSize ? Number(h.engineSize) : null), firstRegistered: d.monthOfFirstRegistration || iso(h.registrationDate) || null,
    motExpiry: iso(d.motExpiryDate) || (lastPass && lastPass.expiry) || null, taxStatus: d.taxStatus || null, taxDue: iso(d.taxDueDate),
    lastMileage: last && last.unit === "MI" ? last.mileage : null, motTests: tests, motSummary, recall: h.hasOutstandingRecall || null, warnings,
  });
};
