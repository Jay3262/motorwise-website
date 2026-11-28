// Remote e-signature for Motorwise Desk.
//   GET  /.netlify/functions/esign?r=<request id>&t=<token>        -> what the customer is signing + the PDF
//   POST /.netlify/functions/esign  { r, t, name, signature, agree } -> records the signature
// The signing request and the signature are stored in the PRIVATE books repo. This function is the only
// public route to them, and it only answers for a valid, unexpired request id + secret token pair.
// Netlify environment variables needed:
//   BOOKS_GITHUB_TOKEN  fine-grained GitHub token: repository Jay3262/motorwise-books, "Contents: Read and write"
//   DESK_BOOKS_REPO     (optional) defaults to Jay3262/motorwise-books
import { createHash, timingSafeEqual } from "node:crypto";
const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? process.env[k];
const REPO = () => env("DESK_BOOKS_REPO") || "Jay3262/motorwise-books";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

async function gh(path, opts = {}) {
  const r = await fetch(`${env("GITHUB_API_BASE") || "https://api.github.com"}/repos/${REPO()}${path}`, { ...opts, headers: { Authorization: `Bearer ${env("BOOKS_GITHUB_TOKEN")}`, Accept: "application/vnd.github+json", "User-Agent": "motorwise-esign", ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || `GitHub ${r.status}`); e.status = r.status; throw e; }
  return j;
}
async function readTable(ref = "heads/main") {
  const head = (await gh(`/git/ref/${ref}`)).object.sha;
  const commit = await gh(`/git/commits/${head}`);
  const tree = await gh(`/git/trees/${commit.tree.sha}?recursive=1`);
  const entry = tree.tree.find(e => e.path === "db/esign.json");
  const rows = entry ? JSON.parse(Buffer.from((await gh(`/git/blobs/${entry.sha}`)).content, "base64").toString("utf8")) : [];
  return { head, baseTree: commit.tree.sha, rows, tree: tree.tree };
}
const same = (a, b) => { const x = Buffer.from(String(a || "")), y = Buffer.from(String(b || "")); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };
function check(rows, r, t) {
  const rec = rows.find(x => x.id === r);
  if (!rec || !same(rec.token, t)) return { err: json(404, { error: "This signing link isn't valid. Please ask Motorwise Hereford to send a new one." }) };
  if (rec.status === "cancelled") return { err: json(410, { error: "This signing request has been cancelled. Please contact Motorwise Hereford." }) };
  if (rec.status !== "signed" && rec.expires_at && Date.parse(rec.expires_at) < Date.now()) return { err: json(410, { error: "This signing link has expired. Please ask Motorwise Hereford to send a new one." }) };
  return { rec };
}
const pub = rec => ({ id: rec.id, status: rec.status, customer_name: rec.customer_name, car_title: rec.car_title, reg: rec.reg, order_no: rec.order_no, total: rec.total, balance: rec.balance, delivery: rec.delivery, signed_at: rec.signed_at || null, signed_name: rec.signed_name || null });

export default async (req) => {
  if (!env("BOOKS_GITHUB_TOKEN")) return json(503, { error: "Online signing isn't switched on yet. Please contact Motorwise Hereford on 07424 947219." });
  try {
    if (req.method === "GET") {
      const u = new URL(req.url); const { rows, tree } = await readTable();
      const { rec, err } = check(rows, u.searchParams.get("r"), u.searchParams.get("t")); if (err) return err;
      let pdf = null;
      if (u.searchParams.get("pdf") === "1") { const e = tree.find(x => x.path === `files/${rec.pdf_path}`); if (e) pdf = (await gh(`/git/blobs/${e.sha}`)).content.replace(/\n/g, ""); }
      return json(200, { ...pub(rec), pdf });
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const sig = String(body.signature || "");
      if (!body.agree) return json(400, { error: "Please tick both boxes to confirm." });
      if (name.length < 3) return json(400, { error: "Please type your full name." });
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{200,400000}$/.test(sig)) return json(400, { error: "Please sign in the box." });
      const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
      const ua = (req.headers.get("user-agent") || "").slice(0, 300);
      for (let attempt = 0; attempt < 4; attempt++) {
        const { head, baseTree, rows } = await readTable();
        const { rec, err } = check(rows, body.r, body.t); if (err) return err;
        if (rec.status === "signed") return json(200, pub(rec));
        const at = new Date().toISOString();
        const sigPath = `esign/${rec.id}-signature.png`;
        const png = sig.split(",")[1];
        const updated = rows.map(x => x.id === rec.id ? { ...x, status: "signed", signed_at: at, signed_name: name, sig_path: sigPath, ip, user_agent: ua, sig_sha256: createHash("sha256").update(Buffer.from(png, "base64")).digest("hex"), updated_at: at } : x);
        const blob = await gh(`/git/blobs`, { method: "POST", body: JSON.stringify({ content: png, encoding: "base64" }) });
        const tree = await gh(`/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: [
          { path: "db/esign.json", mode: "100644", type: "blob", content: JSON.stringify(updated, null, 1) },
          { path: `files/${sigPath}`, mode: "100644", type: "blob", sha: blob.sha }] }) });
        const commit = await gh(`/git/commits`, { method: "POST", body: JSON.stringify({ message: `E-signature: ${rec.order_no || rec.id} signed by ${name}`, tree: tree.sha, parents: [head] }) });
        try { await gh(`/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) }); return json(200, pub(updated.find(x => x.id === rec.id))); }
        catch (e) { if (e.status !== 422) throw e; }
      }
      return json(409, { error: "Please try again in a moment." });
    }
    return json(405, { error: "Not allowed" });
  } catch (e) { console.error(e); return json(502, { error: "Something went wrong. Please try again, or call Motorwise Hereford on 07424 947219." }); }
};
