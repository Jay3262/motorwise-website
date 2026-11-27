// GitHubStore: the Desk's live storage, kept in GitHub.
//   Private business data (cars, costs, customers, accounts) -> private repo  {owner}/{books}
//   Public website stock (data/stock.json + listing photos)    -> public repo   {owner}/{site}
// Sign-in uses GitHub through Netlify's OAuth service (the same login as /admin).
// Every save is a commit, so GitHub keeps a full history and backup of the books.
import { uid, nowIso, TABLES } from "./data.js";

const API = "https://api.github.com";
const TOKEN_KEY = "mw-desk-gh-token";
const DB_DIR = "db";
const FILE_DIR = "files";

const b64ToText = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0)));
const textToB64 = txt => { const bytes = new TextEncoder().encode(txt); let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
const b64ToBlob = (b64, type = "application/octet-stream") => new Blob([Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0))], { type });
const mimeOf = p => /\.png$/i.test(p) ? "image/png" : /\.jpe?g$/i.test(p) ? "image/jpeg" : /\.pdf$/i.test(p) ? "application/pdf" : /\.json$/i.test(p) ? "application/json" : "application/octet-stream";

export class GitHubError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

// Sign in with GitHub via Netlify's OAuth popup (same protocol Decap CMS uses).
export function githubLogin({ siteId = location.hostname, scope = "repo" } = {}) {
  return new Promise((resolve, reject) => {
    const w = 600, h = 720, left = (screen.width - w) / 2, top = (screen.height - h) / 2;
    const popup = window.open(`https://api.netlify.com/auth?provider=github&site_id=${encodeURIComponent(siteId)}&scope=${encodeURIComponent(scope)}`, "netlify-auth", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return reject(new Error("The sign-in window was blocked. Allow pop-ups for this site and try again."));
    const done = (fn, v) => { window.removeEventListener("message", onMsg); clearInterval(poll); fn(v); };
    const onMsg = e => {
      if (e.origin !== "https://api.netlify.com" || typeof e.data !== "string") return;
      if (e.data === "authorizing:github") { e.source.postMessage(e.data, e.origin); return; }
      const m = e.data.match(/^authorization:github:(success|error):(.*)$/s);
      if (!m) return;
      let body = {}; try { body = JSON.parse(m[2]); } catch { }
      if (m[1] === "success" && body.token) { try { popup.close(); } catch { } done(resolve, body.token); }
      else done(reject, new Error(body.message || body.error || "GitHub sign-in failed"));
    };
    window.addEventListener("message", onMsg);
    const poll = setInterval(() => { if (popup.closed) done(reject, new Error("Sign-in window closed before finishing")); }, 700);
  });
}

export class GitHub {
  constructor(token) { this.token = token; }
  async req(path, opts = {}) {
    const r = await fetch(path.startsWith("http") ? path : API + path, { ...opts, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${this.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers || {}) } });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new GitHubError(j.message || `GitHub error ${r.status}`, r.status);
    return j;
  }
  me() { return this.req("/user"); }
  repo(full) { return this.req(`/repos/${full}`); }
  async head(full, branch) { const ref = await this.req(`/repos/${full}/git/ref/heads/${branch}`); return ref.object.sha; }
  async tree(full, sha) { const c = await this.req(`/repos/${full}/git/commits/${sha}`); const t = await this.req(`/repos/${full}/git/trees/${c.tree.sha}?recursive=1`); return { treeSha: c.tree.sha, entries: t.tree, truncated: t.truncated }; }
  async blob(full, sha) { const b = await this.req(`/repos/${full}/git/blobs/${sha}`); return b.content; }
  // One commit with many files. files: { path: string | Blob | null }  (null deletes the file)
  async commit(full, branch, files, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const parent = await this.head(full, branch).catch(e => { if (e.status === 409) return null; throw e; });
      const baseTree = parent ? (await this.req(`/repos/${full}/git/commits/${parent}`)).tree.sha : undefined;
      const tree = [];
      for (const [path, val] of Object.entries(files)) {
        if (val === null) { tree.push({ path, mode: "100644", type: "blob", sha: null }); continue; }
        const content = typeof val === "string" ? textToB64(val) : await blobToB64(val);
        const b = await this.req(`/repos/${full}/git/blobs`, { method: "POST", body: JSON.stringify({ content, encoding: "base64" }) });
        tree.push({ path, mode: "100644", type: "blob", sha: b.sha });
      }
      const t = await this.req(`/repos/${full}/git/trees`, { method: "POST", body: JSON.stringify(baseTree ? { base_tree: baseTree, tree } : { tree: tree.filter(x => x.sha) }) });
      const c = await this.req(`/repos/${full}/git/commits`, { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: parent ? [parent] : [] }) });
      try {
        if (parent) await this.req(`/repos/${full}/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
        else await this.req(`/repos/${full}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: c.sha }) });
        return c.sha;
      } catch (e) { if (e.status !== 422 || attempt === 2) throw e; } // someone else saved first: rebuild on top of theirs
    }
  }
  async readText(full, path, branch = "main") {
    const j = await this.req(`/repos/${full}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${branch}`);
    if (j.content) return b64ToText(j.content);
    return b64ToText(await this.blob(full, j.sha)); // files over 1 MB
  }
}

const CACHE_KEY = "mw-desk-cache-v2";
const PHOTO_CACHE = "mw-photos";
// git's own id for a file, so we know which tables changed without downloading them
async function gitSha(text) { const body = new TextEncoder().encode(text); const head = new TextEncoder().encode(`blob ${body.length}\0`); const all = new Uint8Array(head.length + body.length); all.set(head); all.set(body, head.length); const h = await crypto.subtle.digest("SHA-1", all); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join(""); }

export class GitHubStore {
  constructor(cfg) {
    this.kind = "github"; this.cfg = cfg; this.listeners = new Set();
    this.books = `${cfg.owner}/${cfg.books}`; this.site = `${cfg.owner}/${cfg.site}`; this.branch = cfg.branch || "main";
    this.data = {}; this.paths = new Map(); this.tableShas = {}; this.head = null; this.fileCache = new Map();
    this.ops = {}; this.pendingFiles = {}; this.chain = Promise.resolve(); this.status = "saved";
  }
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } }
  readCache() { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); return c && c.books === this.books ? c : null; } catch { return null; } }
  writeCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ books: this.books, me: this.me, head: this.head, tableShas: this.tableShas, paths: [...this.paths], data: this.data })); } catch { } }
  async init() {
    for (const t of TABLES) this.data[t] = [];
    if (!this.token) return;
    this.gh = new GitHub(this.token);
    const c = this.readCache();
    if (c && c.me) {
      // Open instantly from what's on this device, then check GitHub in the background.
      Object.assign(this, { me: c.me, head: c.head, tableShas: c.tableShas || {}, paths: new Map(c.paths || []) });
      for (const t of TABLES) this.data[t] = (c.data && c.data[t]) || [];
      this.loadedAt = 0;
      this.revalidate();
    } else {
      try { this.me = await this.gh.me(); } catch (e) { if (e.status === 401) { this.forget(); return; } throw e; }
      await this.ensureBooks(); await this.load();
    }
    window.addEventListener("beforeunload", e => { if (this.status !== "saved") { e.preventDefault(); e.returnValue = ""; } });
    setInterval(() => { if (document.visibilityState === "visible") this.checkRemote(); }, 30000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") this.checkRemote(); });
  }
  async revalidate() {
    try { this.me = await this.gh.me(); }
    catch (e) { if (e.status === 401) { this.forget(); try { localStorage.removeItem(CACHE_KEY); } catch { } location.reload(); } return; }
    try { await this.gh.repo(this.books); } catch (e) { if (e.status === 404) { this.forget(); try { localStorage.removeItem(CACHE_KEY); } catch { } location.reload(); return; } }
    this.checkRemote();
  }
  forget() { try { localStorage.removeItem(TOKEN_KEY); } catch { } this.me = null; this.gh = null; }
  async ensureBooks() {
    try { await this.gh.repo(this.books); }
    catch (e) {
      if (e.status !== 404) throw e;
      const login = this.me.login;
      if (login.toLowerCase() !== this.cfg.owner.toLowerCase()) { this.forget(); throw new Error(`${login} doesn't have access to the Motorwise records yet. Open github.com/${this.books}/invitations, tap Accept, then sign in again.`); }
      await this.gh.req("/user/repos", { method: "POST", body: JSON.stringify({ name: this.cfg.books, private: true, auto_init: true, description: "Motorwise Desk: private business records. Do not make public." }) });
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  // Fetch only what changed since we last looked. Returns true if anything did.
  async load(head) {
    head = head || await this.gh.head(this.books, this.branch);
    if (head === this.head) { this.loadedAt = Date.now(); return false; }
    const { entries } = await this.gh.tree(this.books, head);
    this.paths = new Map(entries.filter(e => e.type === "blob").map(e => [e.path, e.sha]));
    let changed = false;
    await Promise.all(TABLES.map(async t => {
      const sha = this.paths.get(`${DB_DIR}/${t}.json`) || null;
      if (sha === (this.tableShas[t] || null)) return;
      changed = true;
      try { this.data[t] = sha ? JSON.parse(b64ToText(await this.gh.blob(this.books, sha))) : []; } catch { this.data[t] = []; }
      this.tableShas[t] = sha;
    }));
    this.head = head; this.loadedAt = Date.now();
    this.applyOps(); this.writeCache();
    return changed;
  }
  applyOps() {
    for (const [t, m] of Object.entries(this.ops)) {
      let rows = [...(this.data[t] || [])];
      for (const [id, row] of m) { const i = rows.findIndex(r => r.id === id); if (row === null) { if (i >= 0) rows.splice(i, 1); } else if (i >= 0) rows[i] = row; else rows.push(row); }
      this.data[t] = rows;
    }
  }
  async checkRemote() {
    if (!this.gh || this.checking || this.status !== "saved" || Date.now() - (this.loadedAt || 0) < 8000) return;
    this.checking = true;
    try { if (await this.load()) this.emit("*", true); } catch { } finally { this.checking = false; }
  }
  async refresh() { this.loadedAt = 0; await this.checkRemote(); return true; }

  // ---- same API as LocalStore / SupaStore ----
  async user() { if (!this.me) return null; const st = (this.data.settings || [])[0]; const t = st && (st.team || []).find(x => (x.email || "").toLowerCase() === this.me.login.toLowerCase()); return { id: this.me.login, email: this.me.login, name: (t && t.name) || this.me.name || this.me.login }; }
  async signIn() { const token = await githubLogin({ siteId: this.cfg.siteId || location.hostname }); try { localStorage.setItem(TOKEN_KEY, token); localStorage.removeItem(CACHE_KEY); } catch { } this.head = null; this.tableShas = {}; await this.init(); return this.user(); }
  async signOut() { await this.flush(); this.forget(); try { localStorage.removeItem(CACHE_KEY); } catch { } }
  async list(t) { return (this.data[t] || []).map(r => ({ ...r })); }
  async get(t, id) { const r = (this.data[t] || []).find(x => x.id === id); return r ? { ...r } : null; }
  op(t, id, row) { (this.ops[t] ||= new Map()).set(id, row); }
  async insert(t, row) { row = { id: uid(), created_at: nowIso(), ...row }; this.data[t] = [...(this.data[t] || []), row]; this.op(t, row.id, row); this.touch(t); return { ...row }; }
  async update(t, id, patch) { let out = null; this.data[t] = (this.data[t] || []).map(r => r.id === id ? (out = { ...r, ...patch, id, updated_at: nowIso() }) : r); if (out) this.op(t, id, out); this.touch(t); return out && { ...out }; }
  async remove(t, id) { this.data[t] = (this.data[t] || []).filter(r => r.id !== id); this.op(t, id, null); this.touch(t); }
  async putFile(path, blob) { this.pendingFiles[`${FILE_DIR}/${path}`] = blob; this.fileCache.set(path, blob); this.schedule(); return path; }
  async fileBlob(path) {
    if (!path) return null;
    if (this.fileCache.has(path)) return this.fileCache.get(path);
    const sha = this.paths.get(`${FILE_DIR}/${path}`); if (!sha) return null;
    const key = `/__mw-photo/${sha}`;
    try { const c = await caches.open(PHOTO_CACHE); const hit = await c.match(key); if (hit) { const b = await hit.blob(); this.fileCache.set(path, b); return b; } } catch { }
    const blob = b64ToBlob(await this.gh.blob(this.books, sha), mimeOf(path)); this.fileCache.set(path, blob);
    try { const c = await caches.open(PHOTO_CACHE); await c.put(key, new Response(blob, { headers: { "Content-Type": blob.type } })); } catch { }
    return blob;
  }
  async fileUrl(path) { const b = await this.fileBlob(path); return b ? URL.createObjectURL(b) : ""; }
  async nextInvoiceNumber() { const st = this.data.settings[0]; const n = st.next_invoice_number; await this.update("settings", st.id, { next_invoice_number: n + 1 }); await this.flush(); return `${st.invoice_prefix}-${n}`; }
  async team() { const st = (this.data.settings || [])[0]; return (st && st.team) || (this.me ? [{ name: this.me.name || this.me.login, email: this.me.login }] : []); }
  async invoke(fn, body) {
    const r = await fetch(`/.netlify/functions/${fn}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Service error ${r.status}`);
    return j;
  }
  async wipe() { throw new Error("Live records can't be wiped from the app."); }
  onChange(fn) { this.listeners.add(fn); }
  emit(t, remote = false) { if (!remote) this.lastWrite = Date.now(); for (const f of this.listeners) f(t, remote); }

  // ---- saving: edits are batched into one commit; if someone else saved in between, their changes are kept and ours applied on top ----
  touch(t) { this.writeCache(); this.emit(t); this.schedule(); }
  schedule() { this.setStatus("pending"); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 700); }
  setStatus(s, err) { this.status = s; this.lastError = err || null; document.dispatchEvent(new CustomEvent("desk-save", { detail: { status: s, error: err } })); }
  flush() {
    clearTimeout(this.timer);
    this.chain = this.chain.then(async () => {
      const ops = this.ops, files = this.pendingFiles;
      if (!Object.keys(ops).length && !Object.keys(files).length) { if (this.status !== "error") this.setStatus("saved"); return; }
      this.ops = {}; this.pendingFiles = {};
      this.setStatus("saving");
      try {
        // upload photos once (in parallel); their ids don't change between retries
        const fileShas = {};
        await Promise.all(Object.entries(files).map(async ([path, blob]) => { const b = await this.gh.req(`/repos/${this.books}/git/blobs`, { method: "POST", body: JSON.stringify({ content: await blobToB64(blob), encoding: "base64" }) }); fileShas[path] = b.sha; }));
        for (let attempt = 0; ; attempt++) {
          const head = await this.gh.head(this.books, this.branch);
          if (head !== this.head) { const keep = this.ops; this.ops = ops; await this.load(head); this.ops = keep; this.applyOps(); }
          const tree = Object.entries(fileShas).map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha }));
          const written = {};
          for (const t of Object.keys(ops)) { const text = JSON.stringify(this.data[t], null, 1); written[t] = text; tree.push({ path: `${DB_DIR}/${t}.json`, mode: "100644", type: "blob", content: text }); }
          const base = (await this.gh.req(`/repos/${this.books}/git/commits/${head}`)).tree.sha;
          const tr = await this.gh.req(`/repos/${this.books}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: base, tree }) });
          const c = await this.gh.req(`/repos/${this.books}/git/commits`, { method: "POST", body: JSON.stringify({ message: `Desk: update ${Object.keys(ops).join(", ") || "photos"} (${this.me.login})`, tree: tr.sha, parents: [head] }) });
          try { await this.gh.req(`/repos/${this.books}/git/refs/heads/${this.branch}`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) }); }
          catch (e) { if (e.status === 422 && attempt < 4) continue; throw e; }
          this.head = c.sha;
          for (const [p, sha] of Object.entries(fileShas)) this.paths.set(p, sha);
          for (const [t, text] of Object.entries(written)) { const sha = await gitSha(text); this.tableShas[t] = sha; this.paths.set(`${DB_DIR}/${t}.json`, sha); }
          break;
        }
        this.loadedAt = Date.now(); this.writeCache();
        const more = Object.keys(this.ops).length || Object.keys(this.pendingFiles).length;
        this.setStatus(more ? "pending" : "saved"); if (more) this.schedule();
      } catch (e) {
        // put the unsaved edits back (newer edits made meanwhile win) and retry shortly
        for (const [t, m] of Object.entries(ops)) { const cur = this.ops[t] || new Map(); for (const [id, row] of m) if (!cur.has(id)) cur.set(id, row); this.ops[t] = cur; }
        this.pendingFiles = { ...files, ...this.pendingFiles };
        this.setStatus("error", e.message); clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 6000);
      }
    });
    return this.chain;
  }

  // ---- staff: collaborators on both repos (books = private records, site = website) ----
  async inviteStaff(login) {
    try { await this.gh.req(`/users/${encodeURIComponent(login)}`); } catch (e) { if (e.status === 404) throw new Error(`No GitHub account called "${login}". Check the spelling.`); throw e; }
    for (const repo of [this.books, this.site]) await this.gh.req(`/repos/${repo}/collaborators/${encodeURIComponent(login)}`, { method: "PUT", body: JSON.stringify({ permission: "push" }) });
  }
  async removeStaff(login) {
    for (const repo of [this.books, this.site]) {
      await this.gh.req(`/repos/${repo}/collaborators/${encodeURIComponent(login)}`, { method: "DELETE" }).catch(e => { if (e.status !== 404) throw e; });
      const inv = await this.gh.req(`/repos/${repo}/invitations`).catch(() => []);
      for (const i of inv || []) if ((i.invitee && i.invitee.login || "").toLowerCase() === login.toLowerCase()) await this.gh.req(`/repos/${repo}/invitations/${i.id}`, { method: "DELETE" }).catch(() => { });
    }
  }

  // ---- website (public repo) ----
  async readSiteStock() { try { return JSON.parse(await this.gh.readText(this.site, "data/stock.json", this.branch)); } catch (e) { if (e.status === 404) return { cars: [] }; throw e; } }
  async commitSite(files, message) { return this.gh.commit(this.site, this.branch, files, message); }
}

export const hasGitHubToken = () => { try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; } };
