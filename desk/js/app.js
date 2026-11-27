import { CONFIG, BUSINESS_DEFAULTS } from "./config.js";
import { GitHubStore } from "./github.js";
import { LocalStore, SupaStore, isLiveConfigured, seedSample, TEMPLATE_DEFAULTS, uid, nowIso } from "./data.js";
import { esc, money, money2, todayISO, fmtDate, fmtDay, fmtTime, fmtDT, localDT, endOfToday, plateFmt, telHref, waHref, I, toast, sheet, formData, saveOrShare, resizeImage, signaturePad, downloadText, csv } from "./ui.js";
import { carFigures, summary, forecast, avgDaysToSell, ageDays, IN_TYPES, monthly, monthLabel, stockValuation, projection } from "./calc.js";
import { buildPdf, sha256, DOCS } from "./pdf.js";
import { writeUp, publishCar, importFromSite, longDate, nextStockId } from "./website.js";

const S = { store: null, user: null, live: false, mode: "sample", settings: null, team: [] };
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const APP = document.getElementById("app");

const CAR_STAGES = [["preparing", "Preparing"], ["available", "Available"], ["reserved", "Reserved"], ["sold", "Sold"], ["returned", "Returned to owner (SOR)"]];
const OUT = ["sold", "returned"];
const sorTag = c => c.sor ? `<span class="tag sor" title="Sale or return">SOR</span>` : "";
const LEAD_STAGES = [["new", "New"], ["replied", "Replied"], ["viewing_booked", "Viewing booked"], ["sold", "Sold"], ["closed", "Closed"]];
const SOURCES = ["Phone", "WhatsApp", "Facebook", "Marketplace", "Website", "Email", "Walk-up", "Other"];
const SLOTS = [["exterior", "Exterior"], ["interior", "Interior"], ["dashboard", "Dash / miles"], ["boot", "Boot"], ["damage", "Damage"]];
const EXPENSE_CATS = ["Valeting", "Repairs", "Parts", "MOT", "Tyres", "Fuel", "Advertising", "Transport", "Other"];
const OVERHEAD_CATS = ["Pitch rent", "Insurance", "Phone", "Advertising", "Software", "Accountant", "Other"];
const CHECKLIST = [
  { key: "inspected", label: "Customer has inspected the vehicle", short: "Vehicle inspected by buyer" },
  { key: "faults", label: "Faults and condition points explained", short: "Faults explained to buyer" },
  { key: "keys", label: "All keys handed over", short: "Keys handed over" },
  { key: "v5c", label: "Green new keeper slip (V5C/2) given to the customer", short: "New keeper slip (V5C/2) given" },
  { key: "dvla", label: "DVLA told the vehicle has been sold (done or booked for today)", short: "DVLA told of sale" },
  { key: "docs", label: "Service records and handbook handed over (if any)", short: "Service records/handbook given" },
  { key: "mot", label: "MOT expiry and history explained", short: "MOT date explained" },
  { key: "tax_ins", label: "Customer told to insure and tax before driving away", short: "Told to insure and tax first" },
];
const ACK = "I agree to buy the vehicle at this price and on the terms and conditions, which I have read. The faults and condition points listed were explained to me before I agreed to buy. I have inspected the vehicle and received it with the keys stated. This does not affect my statutory rights.";
const stageLabel = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];
const nameOf = (email) => (S.team.find(t => t.email === email) || {}).name || (email ? email.split("@")[0] : "Unassigned");
const carTitle = c => c ? [c.year, c.make, c.model].filter(Boolean).join(" ") : "";
const isMe = (email) => email && S.user && email.toLowerCase() === S.user.email.toLowerCase();

/* ---------------- Boot ---------------- */
async function boot() {
  const gh = CONFIG.GITHUB && ((CONFIG.GITHUB.hosts || []).includes(location.hostname) || new URLSearchParams(location.search).has("github"));
  S.mode = isLiveConfigured() ? "supabase" : gh ? "github" : "sample";
  S.live = S.mode !== "sample";
  S.store = S.mode === "supabase" ? new SupaStore() : S.mode === "github" ? new GitHubStore(CONFIG.GITHUB) : new LocalStore("motorwise-desk-sample");
  try { await S.store.init(); } catch (e) { APP.innerHTML = `<div class="login"><div class="card"><h1>Can't connect</h1><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`; return; }
  if (!S.live) await seedSample(S.store);
  S.user = await S.store.user();
  // Only changes made on the OTHER phone refresh the screen by themselves; never while someone is typing, signing or in a sheet.
  S.store.onChange((t, remote) => { if (!remote) return; clearTimeout(boot.t); boot.t = setTimeout(() => { if (!document.querySelector(".sheet,canvas.sig") && !document.activeElement?.matches("input,textarea,select")) render(); }, 400); });
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => { });
  window.addEventListener("hashchange", render);
  document.addEventListener("desk-save", e => paintSave(e.detail));
  if (S.mode === "github") document.addEventListener("visibilitychange", async () => { if (document.visibilityState === "visible" && S.user && Date.now() - (S.store.loadedAt || 0) > 60000 && !document.querySelector(".sheet")) { if (await S.store.refresh()) render(); } });
  render();
}
function paintSave(d = { status: S.store.status || "saved" }) {
  const el = document.getElementById("savestate"); if (!el) return;
  const map = { saved: ["Saved", "ok"], pending: ["Saving…", ""], saving: ["Saving…", ""], error: ["Not saved yet, retrying", "bad"] };
  const [t, c] = map[d.status] || map.saved; el.textContent = t; el.className = "savestate " + c; el.title = d.error || "";
}

async function loadSettings() {
  let st = (await S.store.list("settings"))[0];
  if (!st) st = await S.store.insert("settings", { ...BUSINESS_DEFAULTS, ...(S.mode === "github" ? { team: [{ name: S.user.name === S.user.email ? "Jay" : S.user.name, email: S.user.email }], lookup_enabled: true } : {}) });
  S.settings = st;
  S.team = await S.store.team().catch(() => []);
  const tpls = await S.store.list("templates");
  for (const t of TEMPLATE_DEFAULTS) if (!tpls.some(x => x.key === t.key)) await S.store.insert("templates", { ...t, version: 1 });
}

async function audit(action, detail = {}) { try { await S.store.insert("audit", { action, by: S.user.email, at: nowIso(), ...detail }); } catch { } }

// Bring in any cars that are on the website but not yet in the Desk (first run, or cars added via /admin).
async function syncFromSite() {
  try {
    const [stock, mine] = await Promise.all([S.store.readSiteStock(), S.store.list("cars")]);
    const have = mine.map(c => c.stock_id).filter(Boolean);
    const missing = (stock.cars || []).filter(e => !have.includes(e.id));
    if (!missing.length) return;
    const bar = document.createElement("div"); bar.className = "syncbar"; bar.setAttribute("role", "status"); document.body.appendChild(bar);
    bar.textContent = `Bringing in ${missing.length} car${missing.length > 1 ? "s" : ""} from your website…`;
    const made = await importFromSite(S.store, CONFIG.GITHUB.siteUrl, m => bar.textContent = m, { skipIds: have });
    await S.store.flush(); bar.remove();
    toast(`${made.length} car${made.length > 1 ? "s" : ""} brought in from the website`); render();
  } catch (e) { document.querySelector(".syncbar")?.remove(); toast("Couldn't bring in website stock: " + e.message, true); S.synced = false; }
}

/* ---------------- Router ---------------- */
async function render() {
  if (!S.user) return renderLogin();
  await loadSettings();
  if (S.mode === "github" && !S.synced) { S.synced = true; syncFromSite(); }
  const [r, a, b] = location.hash.replace(/^#/, "").split("/");
  const routes = { today, cars, car, "car-new": carNew, leads, lead, "lead-new": leadNew, "viewing-new": viewingNew, viewing, money: moneyScreen, handover, admin, "money-car": moneyCar };
  const fn = routes[r] || today;
  try {
    const view = await fn(a, b);
    shell(view, r || "today");
  } catch (e) { console.error(e); shell({ title: "Something went wrong", html: `<div class="panel"><p>${esc(e.message)}</p><a class="btn" href="#today">Back to Today</a></div>` }, r); }
}

function shell(view, route) {
  const tab = { today: "today", cars: "cars", car: "cars", "car-new": "cars", "money-car": "money", leads: "leads", lead: "leads", "lead-new": "leads", "viewing-new": "leads", viewing: "leads", money: "money", handover: "today", admin: "admin" }[route] || "today";
  const tabs = [["today", "Today", I.today], ["cars", "Stock", I.cars], ["leads", "Leads", I.leads], ["money", "Accounts", I.money], ["admin", "Admin", I.admin]];
  APP.dataset.route = route;
  APP.innerHTML = `
  <aside class="brand"><img src="icons/icon-192.png" alt="" width="36" height="36"><div><b>Motorwise</b><span>Desk</span></div></aside>
  <header class="top">
    ${view.back ? `<a class="back" href="${view.back}" aria-label="Back">${I.back}</a>` : ""}
    <h1>${esc(view.title)}</h1>
    ${S.mode === "github" ? `<span id="savestate" class="savestate ok" role="status">Saved</span>` : ""}
    <a class="who" href="#admin">${esc(S.user.name)}</a>
  </header>
  ${S.live ? "" : `<div class="sample">SAMPLE MODE: practice data on this phone only. Nothing is sent to customers.</div>`}
  <main>${view.html}</main>
  <nav class="tabs" aria-label="Main">${tabs.map(([k, l, ic]) => `<a href="#${k}" ${k === tab ? 'aria-current="page"' : ""}>${ic}<span>${l}</span></a>`).join("")}</nav>`;
  view.mount && view.mount(APP);
  paintSave();
  if (!view.keepScroll) window.scrollTo(0, 0);
}

/* ---------------- Sign in ---------------- */
async function renderLogin() {
  if (S.mode === "github") {
    APP.innerHTML = `<div class="login"><div class="card">
      <img src="icons/icon-192.png" alt="" width="64" height="64" style="border-radius:14px">
      <h1>Motorwise Desk</h1><p class="small" style="color:var(--mint)">Stock, sales and accounts for Motorwise Hereford.</p>
      <div class="panel">
        <button class="btn primary block" id="gh">Sign in with GitHub</button>
        <p class="muted">Use the same GitHub account as the website admin. A small window opens to confirm it's you.</p>
      </div></div></div>`;
    $("#gh").onclick = async () => { const b = $("#gh"); b.disabled = true; b.textContent = "Signing in…"; try { S.user = await S.store.signIn(); location.hash = "#today"; render(); } catch (err) { toast(err.message || "Sign-in failed", true); b.disabled = false; b.textContent = "Sign in with GitHub"; } };
    return;
  }
  if (S.live) {
    APP.innerHTML = `<div class="login"><form class="card" id="f">
      <img src="icons/icon-192.png" alt="" width="64" height="64" style="border-radius:14px">
      <h1>Motorwise Desk</h1><p class="small" style="color:var(--mint)">Sign in with your own email and password.</p>
      <div class="panel">
        <label class="f">Email<input class="i" name="email" type="email" autocomplete="username" required></label>
        <label class="f">Password<input class="i" name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary block">Sign in</button>
        <button type="button" class="btn block" id="forgot">Forgot password</button>
      </div></form></div>`;
    $("#f").onsubmit = async e => { e.preventDefault(); const d = formData(e.target); try { S.user = await S.store.signIn(d.email, d.password); location.hash = "#today"; render(); } catch (err) { toast(err.message || "Sign-in failed", true); } };
    $("#forgot").onclick = async () => { const email = $("#f").email.value; if (!email) return toast("Type your email first", true); try { await S.store.resetPassword(email); toast("Reset link sent if that email is on the team"); } catch (e) { toast(e.message, true); } };
    return;
  }
  await loadSettings();
  APP.innerHTML = `<div class="login"><div class="card">
    <img src="icons/icon-192.png" alt="" width="64" height="64" style="border-radius:14px">
    <h1>Motorwise Desk</h1>
    <div class="flag"><p>This copy is in <b>sample mode</b>: it runs on this phone with practice data so you can try everything. When Supabase is set up, each of you signs in with your own email and password.</p></div>
    <div class="panel"><h2>Continue as</h2>${S.team.map(t => `<button class="btn block" data-email="${esc(t.email)}" data-name="${esc(t.name)}">${esc(t.name)}</button>`).join("")}</div>
  </div></div>`;
  $$("[data-email]").forEach(b => b.onclick = async () => { S.user = await S.store.signIn(b.dataset.email); S.user.name = b.dataset.name; location.hash = "#today"; render(); });
}

/* ---------------- Today ---------------- */
async function today() {
  const [leads, viewings, carsL, photos, hos, txs] = await Promise.all(["leads", "viewings", "cars", "photos", "handovers", "transactions"].map(t => S.store.list(t)));
  const eod = endOfToday(); const now = new Date();
  const items = [];
  for (const l of leads) {
    if (l.stage === "new" && !l.assigned_to) items.push({ pri: 0, href: `#lead/${l.id}`, t: "New enquiry: nobody has picked it up", s: `${esc(l.name || "Unknown")} · ${esc(l.source || "")}`, tag: ["new", "New"] });
    else if (l.follow_up && new Date(l.follow_up) <= eod && !["sold", "closed"].includes(l.stage) && (isMe(l.assigned_to) || !l.assigned_to)) items.push({ pri: new Date(l.follow_up) < now ? 1 : 2, href: `#lead/${l.id}`, t: `Follow up ${esc(l.name || "")}`, s: `${new Date(l.follow_up) < now ? "Overdue · " : ""}${fmtDT(l.follow_up)}`, tag: new Date(l.follow_up) < now ? ["failed", "Overdue"] : null });
  }
  for (const v of viewings) {
    if (!v.at || v.outcome) continue; const at = new Date(v.at);
    if (at <= eod && at >= new Date(now.getTime() - 3 * 3600e3)) { const l = leads.find(x => x.id === v.lead_id) || {}; const c = carsL.find(x => x.id === v.car_id); items.push({ pri: 1.5, href: `#viewing/${v.id}`, t: `Viewing ${fmtTime(v.at)}: ${esc(l.name || "")}`, s: `${esc(carTitle(c))} · ${esc(nameOf(v.assigned_to))}`, tag: ["reserved", "Viewing"] }); }
  }
  for (const h of hos) {
    if (h.status === "failed") items.push({ pri: 0.5, href: `#handover/${h.id}`, t: "Handover pack did not send", s: "Open to send again", tag: ["failed", "Failed"] });
    else if (h.status === "draft") { const c = carsL.find(x => x.id === h.car_id); items.push({ pri: 3, href: `#handover/${h.id}`, t: "Finish handover", s: esc(c ? `${carTitle(c)} ${c.reg}` : "Car not chosen yet"), tag: ["prepared", "In progress"] }); }
    else if (h.status === "prepared") items.push({ pri: 2.5, href: `#handover/${h.id}`, t: "Handover pack prepared, not sent", s: "Open to send", tag: ["prepared", "Prepared"] });
  }
  for (const c of carsL.filter(c => c.status === "preparing")) {
    const have = new Set(photos.filter(p => p.car_id === c.id).map(p => p.slot)); const missing = SLOTS.filter(s => s[0] !== "damage" && !have.has(s[0]));
    if (missing.length) items.push({ pri: 4, href: `#car/${c.id}`, t: `Photos needed: ${esc(c.reg)}`, s: missing.map(m => m[1]).join(", "), tag: ["preparing", "Preparing"] });
  }
  for (const c of carsL.filter(c => c.status === "sold")) { const f = carFigures(c, txs, S.settings); if (f.owed > 0) items.push({ pri: 3.5, href: `#money-car/${c.id}`, t: `${money(f.owed)} still owed`, s: `${esc(c.reg)} · ${esc(carTitle(c))}`, tag: ["new", "Owed"] }); }
  for (const c of carsL.filter(c => c.sor && c.status === "sold")) { const ff = carFigures(c, txs, S.settings); if (ff.ownerOwed > 0) items.push({ pri: 2.2, href: `#car/${c.id}`, t: `Pay ${esc(c.sor_owner || "the owner")} ${money(ff.ownerOwed)}`, s: `Sale or return: ${esc(c.stock_id || c.reg)} has sold`, tag: ["failed", "Owed"] }); }
  for (const c of carsL.filter(c => c.sor && !OUT.includes(c.status) && c.sor_until && c.sor_until <= todayISO())) items.push({ pri: 2.4, href: `#car/${c.id}`, t: `Sale or return agreement has ended: ${esc(c.stock_id || c.reg)}`, s: `Agree a new date with ${esc(c.sor_owner || "the owner")} or return the car`, tag: ["prepared", "SOR"] });
  for (const c of carsL.filter(c => !OUT.includes(c.status) && !c.sample)) {
    if (!c.sor && !txs.some(t => t.car_id === c.id && t.type === "purchase")) items.push({ pri: 3.8, href: `#car/${c.id}`, t: `Add what you paid: ${esc(c.stock_id || c.reg)}`, s: esc(carTitle(c)), tag: ["preparing", "Accounts"] });
    if (S.mode === "github" && c.published && c.web_dirty) items.push({ pri: 2.8, href: `#car/${c.id}`, t: `Website listing out of date: ${esc(c.stock_id || c.reg)}`, s: "You've changed details since publishing. Open and tap Update website listing.", tag: ["prepared", "Website"] });
    if (S.mode === "github" && !c.published && c.status === "available") items.push({ pri: 2.9, href: `#car/${c.id}`, t: `Not on the website yet: ${esc(c.stock_id || c.reg)}`, s: "Open it and tap Publish to website", tag: ["new", "Website"] });
  }
  items.sort((a, b) => a.pri - b.pri);
  const mk = new Date().toISOString().slice(0, 7);
  const soldMonth = carsL.filter(c => c.status === "sold" && !c.sample && (c.sold_date || "").startsWith(mk));
  const profitMonth = soldMonth.reduce((t, c) => t + (carFigures(c, txs, S.settings).profit || 0), 0);
  const inStock = carsL.filter(c => !OUT.includes(c.status) && !c.sample).length;
  const hello = new Date().getHours() < 12 ? "Morning" : new Date().getHours() < 18 ? "Afternoon" : "Evening";
  return {
    title: "Today",
    html: `
    <div class="row between"><h2>${hello}, ${esc(S.user.name)}</h2><span class="muted">${fmtDay(nowIso())}</span></div>
    <div class="kpis">
      <a class="kpi" href="#cars"><span class="k">In stock</span><span class="v">${inStock}</span><span class="muted">cars</span></a>
      <a class="kpi" href="#money"><span class="k">Sold this month</span><span class="v">${soldMonth.length}</span><span class="muted">${money(profitMonth)} profit</span></a>
    </div>
    <div class="cols today"><div class="col">
    <section class="panel tight" aria-label="Needs doing">
      <div style="padding:14px 16px 6px"><h2>Needs doing</h2></div>
      <div class="list">${items.length ? items.map(i => `<a href="${i.href}"><div class="grow"><div class="t">${i.t}</div><div class="s">${i.s}</div></div>${i.tag ? `<span class="tag ${i.tag[0]}">${i.tag[1]}</span>` : ""}<span class="chev">›</span></a>`).join("") : `<div class="empty">Nothing due. New enquiries, follow-ups and viewings will show here.</div>`}</div>
    </section></div><div class="col">
    <nav class="quick" aria-label="Quick actions">
      <a href="#car-new">${I.addcar}Add car</a>
      <a href="#lead-new">${I.addlead}Add lead</a>
      <a href="#viewing-new">${I.viewing}Book viewing</a>
      <a href="#handover/new">${I.handover}Start handover</a>
    </nav></div></div>`,
  };
}

/* ---------------- Cars ---------------- */
async function photoUrl(p, size = "thumb") { if (!p) return ""; if (S.mode === "github" && p.web_path && !S.store.fileCache.has(p.listing_path)) return size === "thumb" ? `/.netlify/images?url=${encodeURIComponent("/" + p.web_path)}&w=480&q=70` : "/" + p.web_path; return S.store.fileUrl(size === "thumb" ? p.thumb_path : size === "listing" ? p.listing_path : p.original_path); }

async function cars(filter) {
  const [list, photos, txAll] = await Promise.all([S.store.list("cars"), S.store.list("photos"), S.store.list("transactions")]);
  const f = filter || "stock";
  const noCost = list.filter(c => !OUT.includes(c.status) && !c.sor && !c.sample && !txAll.some(t => t.car_id === c.id && t.type === "purchase"));
  const shown = list.filter(c => f === "stock" ? !OUT.includes(c.status) : f === "sor" ? c.sor : f === "all" ? true : c.status === f).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const thumbs = {}; for (const c of shown) { const p = photos.find(p => p.id === c.cover_photo) || photos.filter(p => p.car_id === c.id).sort((a, b) => a.order - b.order)[0]; thumbs[c.id] = p ? photoUrl(p) : ""; }
  await Promise.all(Object.keys(thumbs).map(async k => { thumbs[k] = await thumbs[k]; }));
  const chips = [["stock", "In stock"], ...CAR_STAGES.filter(x => x[0] !== "returned"), ...(list.some(c => c.sor) ? [["sor", "Sale or return"]] : []), ["all", "All"]];
  return {
    title: "Stock",
    html: `
    <a class="btn primary block" href="#car-new">Add car</a>
    ${noCost.length ? `<div class="flag"><p style="margin:0"><b>${noCost.length} car${noCost.length > 1 ? "s need" : " needs"} a purchase price</b> so the accounts are right: ${noCost.map(c => `<a href="#car/${c.id}">${esc(c.stock_id || c.reg)}</a>`).join(", ")}</p></div>` : ""}
    <div class="chips" role="group" aria-label="Filter">${chips.map(([k, l]) => `<button aria-pressed="${k === f}" data-f="${k}">${l} ${k === "stock" ? `(${list.filter(c => c.status !== "sold").length})` : ""}</button>`).join("")}</div>
    <div class="panel tight"><div class="list">${shown.length ? shown.map(c => `<a href="#car/${c.id}"><div class="thumb" style="${thumbs[c.id] ? `background-image:url('${thumbs[c.id]}')` : ""}">${thumbs[c.id] ? "" : "No photo"}</div><div class="grow"><div class="t">${esc(carTitle(c))}</div><div class="s">${sorTag(c)} ${c.stock_id ? `<b>${esc(c.stock_id)}</b> · ` : ""}<span class="plate">${esc(c.reg)}</span> ${c.asking_price ? money(c.asking_price) : ""}${c.published && c.status !== "sold" ? " · on website" : ""} ${c.sample ? '<span class="tag sample-t">Sample</span>' : ""}</div></div><span class="tag ${c.status}">${stageLabel(CAR_STAGES, c.status)}</span></a>`).join("") : `<div class="empty">No cars here yet.</div>`}</div></div>`,
    mount() {
      $$("[data-f]").forEach(b => b.onclick = () => location.hash = `#cars/${b.dataset.f}`);
      const imp = $("#imp"); if (imp) imp.onclick = async () => { imp.disabled = true; try { const made = await importFromSite(S.store, CONFIG.GITHUB.siteUrl, m => imp.textContent = m); await S.store.flush(); toast(`${made.length} cars imported`); render(); } catch (e) { toast("Import failed: " + e.message, true); imp.disabled = false; imp.textContent = "Import cars from the website"; } };
    },
  };
}

async function carNew() {
  return {
    title: "Add car", back: "#cars",
    html: `
    <form class="panel" id="f">
      <label class="f">Registration<input class="i plate-in" name="reg" autocomplete="off" autocapitalize="characters" required placeholder="AB12 CDE"></label>
      <button type="button" class="btn" id="lookup">Look up details</button>
      <p class="muted" id="lkmsg">Lookup is optional. You can always type the details yourself.</p>
      <div class="btns"><label class="f">Make<input class="i" name="make" required></label><label class="f">Model<input class="i" name="model" required></label></div>
      <label class="f">Version <span class="hint">e.g. 2.0 TDI SE</span><input class="i" name="variant"></label>
      <div class="btns"><label class="f">Year<input class="i" name="year" type="number" inputmode="numeric" min="1980" max="2030"></label><label class="f">Colour<input class="i" name="colour"></label></div>
      <div class="btns"><label class="f">Fuel<select class="i" name="fuel"><option></option><option>Petrol</option><option>Diesel</option><option>Hybrid</option><option>Electric</option></select></label><label class="f">Gearbox<select class="i" name="gearbox"><option></option><option>Manual</option><option>Automatic</option></select></label></div>
      <div class="btns"><label class="f">Mileage<input class="i" name="mileage" type="number" inputmode="numeric"></label><label class="f">MOT expiry<input class="i" name="mot_expiry" type="date"></label></div>
      <label class="row"><input type="checkbox" name="sor" id="sorchk"> Sale or return (selling it for someone else)</label>
      <div id="sorf" hidden style="gap:12px"><div class="btns"><label class="f">Owner's name<input class="i" name="sor_owner"></label><label class="f">Owner's phone<input class="i" name="sor_phone" type="tel"></label></div>
      <div class="btns"><label class="f">Owner gets (£) <span class="hint">when it sells</span><input class="i" name="sor_payout" type="number" inputmode="decimal" step="0.01"></label><label class="f">Agreement ends<input class="i" name="sor_until" type="date"></label></div></div>
      <div class="btns" id="boughtrow"><label class="f">Bought for (£)<input class="i" name="purchase" type="number" inputmode="decimal" step="0.01"></label><label class="f">Asking price (£)<input class="i" name="asking_price" type="number" inputmode="decimal"></label></div>
      <label class="f">Bought on<input class="i" name="purchase_date" type="date" value="${todayISO()}"></label>
      <button class="btn primary block">Save and add photos</button>
    </form>`,
    mount() {
      const f = $("#f");
      f.reg.addEventListener("input", () => { const p = f.reg.selectionStart; f.reg.value = f.reg.value.toUpperCase(); f.reg.setSelectionRange(p, p); });
      $("#sorchk").onchange = e => { $("#sorf").hidden = !e.target.checked; $("#sorf").style.display = e.target.checked ? "grid" : ""; const p = $('[name=purchase]'); if (p) { p.closest("label").hidden = e.target.checked; if (e.target.checked) p.value = ""; } };
      $("#lookup").onclick = async () => {
        const reg = plateFmt(f.reg.value).replace(/ /g, ""); if (!reg) return toast("Type the registration first", true);
        if (!S.live || !S.settings.lookup_enabled) { $("#lkmsg").textContent = "Vehicle lookup isn't set up yet (it needs free DVLA and DVSA keys). Type the details below."; return; }
        const btn = $("#lookup"); btn.disabled = true; btn.textContent = "Looking up…";
        try {
          const d = await S.store.invoke("vehicle-lookup", { reg });
          const set = (k, v) => { if (v != null && v !== "" && f[k]) f[k].value = v; };
          set("make", d.make && cap(d.make)); set("model", d.model && cap(d.model)); set("colour", d.colour && cap(d.colour)); set("year", d.year);
          set("fuel", d.fuel && cap(d.fuel)); set("mot_expiry", d.motExpiry); if (d.lastMileage) set("mileage", d.lastMileage);
          f.dataset.lookup = JSON.stringify(d);
          $("#lkmsg").innerHTML = `Found: <b>${esc([d.year, cap(d.make || ""), cap(d.model || "")].filter(Boolean).join(" "))}</b>${d.engineCc ? `, ${d.engineCc}cc` : ""}${d.motTests ? `, ${d.motTests.length} MOT tests on record` : ""}. Check the details below.${d.warnings && d.warnings.length ? `<br><span class="muted">${esc(d.warnings.join(" "))}</span>` : ""}`;
        } catch (e) { $("#lkmsg").textContent = `${e.message}. Type the details below.`; }
        btn.disabled = false; btn.textContent = "Look up details";
      };
      f.onsubmit = async e => {
        e.preventDefault(); const d = formData(f);
        const lk = f.dataset.lookup ? JSON.parse(f.dataset.lookup) : {};
        const stock_id = nextStockId([], await S.store.list("cars"));
        const c = await S.store.insert("cars", { stock_id, engine_cc: lk.engineCc || null, mot_history: lk.motTests || null, mot_notes: lk.motSummary || "", first_registered: lk.firstRegistered || null, reg: plateFmt(d.reg), make: d.make, model: d.model, variant: d.variant, year: d.year, colour: d.colour, fuel: d.fuel, gearbox: d.gearbox, mileage: d.mileage, mot_expiry: d.mot_expiry, asking_price: d.asking_price, purchase_date: d.purchase_date, sor: !!d.sor, sor_owner: d.sor_owner || "", sor_phone: d.sor_phone || "", sor_payout: d.sor_payout || null, sor_until: d.sor_until || null, status: "preparing", keys: 1, known_faults: "", condition: "", service_history: "", added_by: S.user.email });
        if (d.purchase && !d.sor) await S.store.insert("transactions", { car_id: c.id, type: "purchase", amount: d.purchase, date: d.purchase_date || todayISO(), method: "bank", note: "Purchase", by: S.user.email });
        await audit("car_added", { car_id: c.id, stock_id });
        toast(`Car added as stock number ${stock_id}`); location.hash = `#car/${c.id}`;
      };
    },
  };
}
const cap = s => String(s).toLowerCase().replace(/\b\w/g, m => m.toUpperCase());

async function car(id) {
  const c = await S.store.get("cars", id); if (!c) return { title: "Not found", back: "#cars", html: `<div class="empty">This car has been removed.</div>` };
  const [photosAll, txs, leadsAll, viewingsAll] = await Promise.all([S.store.list("photos"), S.store.list("transactions"), S.store.list("leads"), S.store.list("viewings")]);
  const photos = photosAll.filter(p => p.car_id === id).sort((a, b) => a.order - b.order);
  const urls = {}; await Promise.all(photos.map(async p => { urls[p.id] = await photoUrl(p); }));
  const have = new Set(photos.map(p => p.slot));
  const f = carFigures(c, txs, S.settings);
  const ctx = txs.filter(t => t.car_id === id).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const txLabel = { purchase: "Purchase", expense: "Cost", deposit: "Deposit in", part_payment: "Part-payment in", balance: "Balance in", refund: "Refund out", sor_payout: "Paid to owner (SOR)" };
  return {
    title: c.reg, back: "#cars", keepScroll: (() => { const k = car.lastId === id; car.lastId = id; return k; })(),
    html: `<div class="cols"><div class="col">
    <section class="panel">
      <div class="row between"><div class="grow"><h1>${esc(carTitle(c))}</h1><p class="muted">${c.stock_id ? `<b>Stock no. ${esc(c.stock_id)}</b>` : `<button class="btn" id="giveid" style="min-height:36px">Give it a stock number</button>`}${c.variant ? " · " + esc(c.variant) : ""}</p></div><span class="plate">${esc(c.reg)}</span></div>
      ${c.sample ? `<p><span class="tag sample-t">Sample record</span></p>` : ""}
      ${c.sor ? `<div class="flag sorbox"><p style="margin:0"><b>Sale or return</b> for ${esc(c.sor_owner || "the owner")}${c.sor_phone ? ` (<a href="tel:${esc(c.sor_phone)}">${esc(c.sor_phone)}</a>)` : ""}. They get <b>${money(c.sor_payout || 0)}</b> when it sells${c.sor_until ? `; agreement runs to ${fmtDate(c.sor_until)}` : ""}.${f.ownerOwed ? `<br><b>You still owe them ${money(f.ownerOwed)}.</b> <button class="btn" id="payowner" style="min-height:36px;margin-top:6px">Record payment to owner</button>` : ""}</p></div>` : ""}
      <label class="f">Stage<select class="i" id="stage">${CAR_STAGES.filter(([k]) => k !== "returned" || c.sor || c.status === "returned").map(([k, l]) => `<option value="${k}" ${c.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <div class="row between"><span class="muted">Asking price</span><span class="big">${c.asking_price ? money(c.asking_price) : "Not set"}</span></div>
    </section>

    <section class="panel">
      <div class="row between"><h2>Photos</h2><span class="muted">${photos.length}</span></div>
      <div class="check" aria-label="Photo checklist">${SLOTS.map(([k, l]) => `<div class="${have.has(k) ? "ok" : ""}">${have.has(k) ? "✓ " : ""}${l}</div>`).join("")}</div>
      <label class="f">Next photo is of<select class="i" id="slot">${SLOTS.map(([k, l]) => `<option value="${k}" ${!have.has(k) && SLOTS.find(s => !have.has(s[0]))?.[0] === k ? "selected" : ""}>${l}</option>`).join("")}<option value="other">Other</option></select></label>
      <div class="btns">
        <label class="btn primary">Take photo<input type="file" accept="image/*" capture="environment" id="cam" hidden></label>
        <label class="btn">Upload<input type="file" accept="image/*" multiple id="up" hidden></label>
      </div>
      ${photos.length ? `<div class="photos">${photos.map((p, i) => `<div class="ph" style="background-image:url('${urls[p.id]}')">${c.cover_photo === p.id || (!c.cover_photo && i === 0) ? '<span class="cover">Cover</span>' : ""}<span class="cap"><span>${esc(stageLabel([...SLOTS, ["other", "Other"]], p.slot))}</span><span>${i + 1}</span></span><button data-ph="${p.id}" aria-label="Photo options"><span>⋯</span></button></div>`).join("")}</div>
      <button class="btn block" id="sharelist">Share listing photos</button>` : `<p class="muted">Take the five checklist photos first. ${S.mode === "github" ? "Each photo is saved at listing size (1600px) for the website." : "Originals are kept, plus a smaller copy for listings."}</p>`}
    </section>

    </div><div class="col">
    ${buyersPanel(c, leadsAll, viewingsAll)}
    ${websitePanel(c, photos)}
    <section class="panel">
      <div class="row between"><h2>Costs and money</h2><a class="small" href="#money-car/${c.id}">Full breakdown</a></div>
      ${!f.purchase && !c.sor ? `<form class="flag" id="paid" style="display:grid;gap:8px"><b>What did you pay for this car?</b><div class="btns"><label class="f">Amount (£)<input class="i" name="amount" type="number" inputmode="decimal" step="0.01" required></label><label class="f">Date<input class="i" name="date" type="date" value="${esc(c.purchase_date || todayISO())}"></label></div><button class="btn primary">Save purchase price</button></form>` : ""}
      <div class="calc">${f.lines.map(([k, v]) => `<div class="l"><span>${k}</span><span class="num">${money2(v)}</span></div>`).join("")}<div class="l tot"><span>${f.sold ? "Profit" : "Cash tied up"}</span><span class="num">${money2(f.sold ? f.profit : f.cashTied)}</span></div><div class="muted">${esc(f.working)}</div></div>
      <div class="list" style="margin:0 -16px">${ctx.map(t => `<button data-tx="${t.id}"><div class="grow"><div class="t">${esc(txLabel[t.type] || t.type)}${t.category ? `: ${esc(t.category)}` : ""}</div><div class="s">${fmtDate(t.date)} · ${esc(t.note || "")}${t.receipt_path ? " · receipt" : ""}</div></div><span class="num">${money2(t.amount)}</span></button>`).join("")}</div>
      <div class="btns"><button class="btn" id="addexp">Add cost</button><button class="btn" id="adddep">Take deposit</button></div>
    </section>
    <details class="panel" id="detbox" ${!c.make || !c.model ? "open" : ""}>
      <summary><h2 style="display:inline">Edit details</h2> <span class="muted">make, mileage, MOT, faults…</span></summary>
      <form id="det" style="display:grid;gap:12px">
        <div class="btns"><label class="f">Make<input class="i" name="make" value="${esc(c.make)}"></label><label class="f">Model<input class="i" name="model" value="${esc(c.model)}"></label></div>
        <label class="f">Version<input class="i" name="variant" value="${esc(c.variant)}"></label>
        <div class="btns"><label class="f">Year<input class="i" name="year" type="number" value="${esc(c.year)}"></label><label class="f">Colour<input class="i" name="colour" value="${esc(c.colour)}"></label></div>
        <div class="btns"><label class="f">Fuel<input class="i" name="fuel" value="${esc(c.fuel)}"></label><label class="f">Gearbox<input class="i" name="gearbox" value="${esc(c.gearbox)}"></label></div>
        <div class="btns"><label class="f">Mileage<input class="i" name="mileage" type="number" value="${esc(c.mileage)}"></label><label class="f">MOT expiry<input class="i" name="mot_expiry" type="date" value="${esc(c.mot_expiry)}"></label></div>
        <div class="btns"><label class="f">Asking price (£)<input class="i" name="asking_price" type="number" value="${esc(c.asking_price)}"></label><label class="f">Keys<input class="i" name="keys" type="number" value="${esc(c.keys)}"></label></div>
        <div class="btns"><label class="f">Body<select class="i" name="body"><option></option>${["Hatchback", "Estate", "Saloon", "SUV", "MPV", "Coupe", "Convertible", "Van"].map(x => `<option ${c.body === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label class="f">Doors<input class="i" name="doors" type="number" value="${esc(c.doors)}"></label></div>
        <div class="btns"><label class="f">Engine <span class="hint">e.g. 1.6 petrol</span><input class="i" name="engine" value="${esc(c.engine)}"></label><label class="f">Engine size (cc)<input class="i" name="engine_cc" type="number" value="${esc(c.engine_cc)}"></label></div>
        <label class="row"><input type="checkbox" name="mileage_approx" ${c.mileage_approx ? "checked" : ""}> Mileage is approximate</label>
        <label class="f">VIN <span class="hint">(optional, shown on the invoice)</span><input class="i" name="vin" value="${esc(c.vin)}"></label>
        <label class="row"><input type="checkbox" name="sor" ${c.sor ? "checked" : ""}> Sale or return (selling it for someone else)</label>
        <div class="btns"><label class="f">Owner's name<input class="i" name="sor_owner" value="${esc(c.sor_owner)}"></label><label class="f">Owner's phone<input class="i" name="sor_phone" type="tel" value="${esc(c.sor_phone)}"></label></div>
        <div class="btns"><label class="f">Owner gets (£) <span class="hint">when it sells</span><input class="i" name="sor_payout" type="number" step="0.01" value="${esc(c.sor_payout)}"></label><label class="f">Agreement ends<input class="i" name="sor_until" type="date" value="${esc(c.sor_until)}"></label></div>
        <label class="f">Equipment <span class="hint">One per line, e.g. Air conditioning</span><textarea class="i" name="equipment">${esc(c.equipment)}</textarea></label>
        <label class="f">MOT notes <span class="hint">Last test result and any advisories</span><textarea class="i" name="mot_notes">${esc(c.mot_notes)}</textarea></label>
        <label class="f">Service history<input class="i" name="service_history" value="${esc(c.service_history)}"></label>
        <label class="f">Known faults <span class="hint">One per line. Shown on the website and on the summary the buyer signs</span><textarea class="i" name="known_faults">${esc(c.known_faults)}</textarea></label>
        <label class="f">Condition notes<textarea class="i" name="condition">${esc(c.condition)}</textarea></label>
        <button class="btn primary block">Save details</button>
      </form>
    </details>
    ${c.status !== "sold" ? `<a class="btn navy block" href="#handover/new/${c.id}">Start handover for this car</a>` : ""}
    <button class="btn danger block" id="del">Delete car</button></div></div>`,
    mount() {
      $("#stage").onchange = async e => {
        const to = e.target.value;
        if (to === "sold" && c.status !== "sold") { e.target.value = c.status; return soldSheet(c); }
        await S.store.update("cars", id, { status: to }); await audit("car_stage", { car_id: id, to }); toast(`Marked ${stageLabel(CAR_STAGES, to)}`);
        if (S.mode === "github" && c.published) { const off = ["preparing", "returned"].includes(to); try { await syncWebsite(id, { remove: off }); toast(off ? "Taken off the website" : "Website updated"); } catch (err) { toast("Website not updated: " + err.message, true); } render(); }
      };
      mountWebsite(c, photos);
      const po = $("#payowner"); if (po) po.onclick = () => txSheet({ car_id: id, type: "sor_payout", amount: f.ownerOwed, note: `Sale or return payout to ${c.sor_owner || "owner"}` });
      const gi = $("#giveid"); if (gi) gi.onclick = async () => { const sid = nextStockId([], await S.store.list("cars")); await S.store.update("cars", id, { stock_id: sid }); toast(`Stock number ${sid} given`); render(); };
      $("#det").onsubmit = async e => { e.preventDefault(); await S.store.update("cars", id, { ...formData(e.target), ...(c.published ? { web_dirty: true } : {}) }); toast(c.published ? "Saved. Tap Update website listing to put it live." : "Saved"); render(); };
      const addPhotos = async files => {
        const slot = $("#slot").value; let order = photos.length; toast(`Saving ${files.length} photo${files.length > 1 ? "s" : ""}…`);
        for (const file of files) {
          const pid = uid(); const base = `cars/${id}/${pid}`;
          const listing = await resizeImage(file, 1600, 0.82), thumb = await resizeImage(file, 480, 0.75);
          const origPath = S.mode === "github" ? `${base}/listing.jpg` : `${base}/original-${(file.name || "photo.jpg").replace(/[^\w.-]/g, "_")}`;
          if (S.mode !== "github") await S.store.putFile(origPath, file);
          await S.store.putFile(`${base}/listing.jpg`, listing); await S.store.putFile(`${base}/thumb.jpg`, thumb);
          await S.store.insert("photos", { id: pid, car_id: id, slot, order: order++, original_path: origPath, listing_path: `${base}/listing.jpg`, thumb_path: `${base}/thumb.jpg`, by: S.user.email });
        }
        toast("Photos saved"); render();
      };
      $("#cam").onchange = e => e.target.files.length && addPhotos([...e.target.files]);
      $("#up").onchange = e => e.target.files.length && addPhotos([...e.target.files]);
      $$("[data-ph]").forEach(b => b.onclick = () => {
        const p = photos.find(x => x.id === b.dataset.ph); const i = photos.indexOf(p);
        sheet(`<h2>Photo ${i + 1}</h2><img src="${urls[p.id]}" alt="" style="width:100%;border-radius:8px">
          <label class="f">This photo shows<select class="i" id="ps">${[...SLOTS, ["other", "Other"]].map(([k, l]) => `<option value="${k}" ${p.slot === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <button class="btn primary" data-a="cover">Use as cover photo</button>
          <div class="btns"><button class="btn" data-a="up" ${i === 0 ? "disabled" : ""}>Move earlier</button><button class="btn" data-a="down" ${i === photos.length - 1 ? "disabled" : ""}>Move later</button></div>
          <button class="btn" data-a="orig">Save original</button>
          <button class="btn danger" data-a="del">Delete photo</button><button class="btn" data-close>Close</button>`, (el, close) => {
          $("#ps", el).onchange = async ev => { await S.store.update("photos", p.id, { slot: ev.target.value }); close(); render(); };
          $$("[data-a]", el).forEach(x => x.onclick = async () => {
            const a = x.dataset.a;
            if (a === "cover") await S.store.update("cars", id, { cover_photo: p.id });
            if (a === "up" || a === "down") { const j = a === "up" ? i - 1 : i + 1; const q = photos[j]; await S.store.update("photos", p.id, { order: q.order }); await S.store.update("photos", q.id, { order: p.order }); }
            if (a === "orig") { const blob = await S.store.fileBlob(p.original_path); if (blob) await saveOrShare(blob, `${c.reg.replace(/ /g, "")}-${i + 1}.jpg`); return; }
            if (a === "del") { if (!confirm("Delete this photo?")) return; await S.store.remove("photos", p.id); if (c.cover_photo === p.id) await S.store.update("cars", id, { cover_photo: null }); }
            close(); render();
          });
        });
      });
      const sl = $("#sharelist"); if (sl) sl.onclick = async () => {
        const files = []; const ordered = c.cover_photo ? [photos.find(p => p.id === c.cover_photo), ...photos.filter(p => p.id !== c.cover_photo)] : photos;
        for (const [i, p] of ordered.entries()) { const b = await S.store.fileBlob(p.listing_path); if (b) files.push(new File([b], `${c.reg.replace(/ /g, "")}-${String(i + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" })); }
        if (navigator.canShare && navigator.canShare({ files })) { try { await navigator.share({ files }); } catch { } } else for (const fl of files) await saveOrShare(fl, fl.name);
      };
      const pd = $("#paid"); if (pd) pd.onsubmit = async e => { e.preventDefault(); const d = formData(e.target); await S.store.insert("transactions", { car_id: id, type: "purchase", amount: d.amount, date: d.date, method: "bank", note: "Purchase", by: S.user.email }); await S.store.update("cars", id, { purchase_date: d.date }); toast("Purchase price saved"); render(); };
      $("#addexp").onclick = () => txSheet({ car_id: id, type: "expense" });
      $("#adddep").onclick = () => txSheet({ car_id: id, type: "deposit" });
      $$("[data-tx]").forEach(b => b.onclick = () => txSheet(ctx.find(t => t.id === b.dataset.tx)));
      $("#del").onclick = async () => { if (txs.some(t => t.car_id === id && IN_TYPES.includes(t.type))) return toast("This car has payments recorded, so it can't be deleted. Mark it Sold or record a refund instead.", true); if (!confirm(`Delete ${c.reg} and its photos and costs?`)) return; for (const p of photos) await S.store.remove("photos", p.id); for (const t of ctx) await S.store.remove("transactions", t.id); await S.store.remove("cars", id); await audit("car_deleted", { reg: c.reg }); location.hash = "#cars"; };
    },
  };
}

// Quick "mark as sold" for sales done without the handover flow.
function soldSheet(c) {
  sheet(`<h2>Mark ${esc(c.reg)} as sold</h2><p class="muted">For the full paperwork (order form, terms, signatures) use <b>Start handover</b> instead.</p>
    <form id="sf" style="display:grid;gap:12px">
      <div class="btns"><label class="f">Sold for (£)<input class="i" name="sold_price" type="number" inputmode="decimal" step="0.01" value="${esc(c.asking_price || "")}" required></label><label class="f">Date sold<input class="i" name="sold_date" type="date" value="${todayISO()}" required></label></div>
      <label class="f">Part exchange value (£) <span class="hint">Leave blank if none</span><input class="i" name="px_value" type="number" inputmode="decimal"></label>
      <label class="row"><input type="checkbox" name="paid" checked> Customer has paid in full</label>
      ${c.sor ? `<label class="row"><input type="checkbox" name="payowner"> I've paid the owner their ${money(c.sor_payout || 0)} (sale or return)</label>` : ""}
      <label class="f">Paid by<select class="i" name="method"><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
      <button class="btn primary block">Mark sold</button><button type="button" class="btn block" data-close>Cancel</button></form>`, (el, close) => {
    $("#sf", el).onsubmit = async e => {
      e.preventDefault(); const d = formData(e.target);
      await S.store.update("cars", c.id, { status: "sold", sold_price: d.sold_price, sold_date: d.sold_date, px_value: d.px_value || 0 });
      if (d.paid) { const due = (Number(d.sold_price) || 0) - (Number(d.px_value) || 0); if (due > 0) await S.store.insert("transactions", { car_id: c.id, type: "balance", amount: due, date: d.sold_date, method: d.method, note: "Paid in full", by: S.user.email }); }
      if (c.sor && d.payowner && Number(c.sor_payout)) await S.store.insert("transactions", { car_id: c.id, type: "sor_payout", amount: c.sor_payout, date: d.sold_date, method: "bank", note: `Sale or return payout to ${c.sor_owner || "owner"}`, by: S.user.email });
      await audit("car_sold_quick", { car_id: c.id, price: d.sold_price }); close();
      toast(`Sold for ${money(d.sold_price)}`);
      if (S.mode === "github" && c.published) { try { await syncWebsite(c.id); toast("Marked sold on the website"); } catch (err) { toast("Website not updated: " + err.message, true); } }
      render();
    };
  });
}

/* ---------------- Interested buyers on a car ---------------- */
function buyersPanel(c, leadsAll, viewingsAll) {
  const ls = leadsAll.filter(l => l.car_id === c.id && l.stage !== "closed").sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const soon = Date.now() - 3 * 3600e3;
  const vs = viewingsAll.filter(v => v.car_id === c.id && !v.outcome && v.at && new Date(v.at).getTime() > soon).sort((a, b) => a.at.localeCompare(b.at));
  const who = id => (leadsAll.find(l => l.id === id) || {}).name || "Customer";
  return `<section class="panel tight"><div style="padding:16px 16px 4px" class="row between"><h2>Interested buyers</h2><span class="muted">${ls.length} lead${ls.length === 1 ? "" : "s"}</span></div>
    ${vs.length ? `<div style="padding:0 16px"><p class="muted" style="margin:4px 0">Viewings booked</p></div><div class="list">${vs.map(v => `<a href="#viewing/${v.id}"><div class="grow"><div class="t">${fmtDT(v.at)}</div><div class="s">${esc(who(v.lead_id))}${v.assigned_to ? ` · with ${esc(nameOf(v.assigned_to))}` : ""}</div></div><span class="tag prepared">Viewing</span></a>`).join("")}</div>` : ""}
    <div class="list">${ls.length ? ls.map(l => `<a href="#lead/${l.id}"><div class="grow"><div class="t">${esc(l.name || "Unknown")}</div><div class="s">${esc(stageLabel(LEAD_STAGES, l.stage))}${l.phone ? ` · ${esc(l.phone)}` : ""}${l.assigned_to ? ` · ${esc(nameOf(l.assigned_to))}` : ""}</div></div>${I.chev || ""}</a>`).join("") : `<div class="muted" style="padding:12px 16px">Nobody linked to this car yet. When someone asks about it, add them here, or set "Interested in" on their lead.</div>`}</div>
    <div class="btns" style="padding:12px 16px 16px"><a class="btn" href="#lead-new/${c.id}">Add enquiry</a><a class="btn" href="#viewing-new//${c.id}">Book viewing</a></div>
  </section>`;
}

/* ---------------- Website listing ---------------- */
function websitePanel(c, photos) {
  if (S.mode !== "github") return `<section class="panel"><h2>Website</h2><p class="muted">Publishing to motorwisehereford.co.uk works when the Desk is opened from the website (motorwisehereford.co.uk/desk).</p></section>`;
  const live = c.published && c.status !== "sold";
  const url = `${CONFIG.GITHUB.siteUrl}/#car-${[c.make, c.model, c.variant].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${(c.stock_id || "").toLowerCase()}`;
  return `<section class="panel" id="web">
    <div class="row between"><h2>Website listing</h2><span class="webstate"><span class="dot ${live ? "on" : ""}"></span>${c.published ? (c.status === "sold" ? "Shown as sold (hidden)" : `Live${c.stock_id ? " · " + esc(c.stock_id) : ""}`) : "Not on the website"}</span></div>
    ${c.published_at ? `<p class="muted">Last published ${fmtDate(c.published_at)}${c.web_dirty ? " · <b>you've changed things since</b>" : ""}</p>` : ""}
    <label class="f">Description <span class="hint">What buyers read. Only write what you know is true.</span><textarea class="i" id="wdesc" style="min-height:140px">${esc(c.description || "")}</textarea></label>
    <button class="btn" id="wgen" type="button">Write it for me from the details</button>
    <label class="row"><input type="checkbox" id="wfeat" ${c.web_featured ? "checked" : ""}> Show first on the homepage</label>
    <label class="row"><input type="checkbox" id="wvalet" ${c.valet_preview ? "checked" : ""}> Photos include digital valet previews (adds a note under the gallery)</label>
    ${!photos.length ? `<div class="flag">Add at least one photo before publishing.</div>` : ""}
    ${!c.asking_price ? `<p class="muted">No asking price set, so the website will show "Call for price".</p>` : ""}
    <button class="btn primary block" id="wpub" ${photos.length ? "" : "disabled"}>${c.published ? "Update website listing" : "Publish to website"}</button>
    ${c.published ? `<div class="btns"><a class="btn" href="${url}" target="_blank" rel="noopener">View on website</a><button class="btn danger" id="wrem">Remove from website</button></div>` : ""}
    <p class="muted">Changes appear on motorwisehereford.co.uk about 30 seconds after publishing.</p>
  </section>`;
}
function mountWebsite(c, photos) {
  if (S.mode !== "github") return;
  const save = async patch => { await S.store.update("cars", c.id, { ...patch, web_dirty: !!c.published }); };
  $("#wdesc").onchange = e => save({ description: e.target.value });
  $("#wfeat").onchange = e => save({ web_featured: e.target.checked });
  $("#wvalet").onchange = e => save({ valet_preview: e.target.checked });
  $("#wgen").onclick = async () => { const cur = await S.store.get("cars", c.id); const t = writeUp(cur); if ($("#wdesc").value.trim() && !confirm("Replace the description with a new one written from the details?")) return; $("#wdesc").value = t; await save({ description: t }); toast("Description written. Check it and edit anything."); };
  $("#wpub").onclick = async () => {
    const b = $("#wpub"); b.disabled = true; b.textContent = "Publishing…";
    try {
      const cur = await S.store.get("cars", c.id);
      if (cur.status === "preparing") { await S.store.update("cars", c.id, { status: "available" }); }
      await syncWebsite(c.id);
      toast("Published. It'll be live in about 30 seconds."); render();
    } catch (e) { toast("Couldn't publish: " + e.message, true); b.disabled = false; b.textContent = c.published ? "Update website listing" : "Publish to website"; }
  };
  const rem = $("#wrem"); if (rem) rem.onclick = async () => { if (!confirm("Take this car off the website? Its listing and photos are removed from the site, but stay here in the Desk.")) return; try { await syncWebsite(c.id, { remove: true }); toast("Removed from the website"); render(); } catch (e) { toast(e.message, true); } };
}
async function syncWebsite(carId, opts = {}) {
  await S.store.flush();
  const [cur, allPhotos, allCars] = await Promise.all([S.store.get("cars", carId), S.store.list("photos"), S.store.list("cars")]);
  const ph = allPhotos.filter(p => p.car_id === carId).sort((a, b) => a.order - b.order);
  const ordered = cur.cover_photo ? [ph.find(p => p.id === cur.cover_photo), ...ph.filter(p => p.id !== cur.cover_photo)].filter(Boolean) : ph;
  const r = await publishCar(S.store, cur, ordered, allCars, opts);
  for (const [pid, path] of r.photoPatch) await S.store.update("photos", pid, { web_path: path });
  await S.store.update("cars", carId, opts.remove ? { published: false, web_paths: [], web_dirty: false } : { stock_id: r.stockId, published: true, web_paths: r.paths, published_at: new Date().toISOString(), web_dirty: false });
  await audit(opts.remove ? "web_removed" : "web_published", { car_id: carId, stock_id: r.stockId });
  await S.store.flush();
}

// Add or edit a money record (cost, overhead, deposit, payment, refund) with an optional receipt photo.
function txSheet(t) {
  const isNew = !t.id; const type = t.type;
  const title = { expense: "Cost for this car", overhead: "Business overhead", deposit: "Deposit taken", part_payment: "Part-payment", balance: "Balance payment", refund: "Refund to customer", purchase: "Purchase price", sor_payout: "Payment to owner (sale or return)" }[type] || "Money";
  const cats = type === "expense" ? EXPENSE_CATS : type === "overhead" ? OVERHEAD_CATS : null;
  sheet(`<h2>${title}</h2><form id="tf" style="display:grid;gap:12px">
    <label class="f">Amount (£)<input class="i" name="amount" type="number" inputmode="decimal" step="0.01" required value="${esc(t.amount ?? "")}"></label>
    ${cats ? `<label class="f">Type<select class="i" name="category">${cats.map(x => `<option ${t.category === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>` : ""}
    <div class="btns"><label class="f">Date<input class="i" name="date" type="date" value="${esc(t.date || todayISO())}"></label>
    <label class="f">${["expense", "overhead", "purchase", "refund", "sor_payout"].includes(type) ? "Paid by" : "Paid by customer"}<select class="i" name="method">${[["bank", "Bank transfer"], ["cash", "Cash"], ["card", "Card"], ["other", "Other"]].map(([k, l]) => `<option value="${k}" ${t.method === k ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <label class="f">Note<input class="i" name="note" value="${esc(t.note || "")}"></label>
    ${["expense", "overhead", "purchase"].includes(type) ? `<label class="btn">${t.receipt_path ? "Replace receipt photo" : "Add receipt photo"}<input type="file" accept="image/*" name="receipt" hidden></label><p class="muted" id="rmsg">${t.receipt_path ? "Receipt saved." : ""}</p>` : ""}
    <button class="btn primary block">${isNew ? "Save" : "Save changes"}</button>
    ${!isNew ? `<div class="btns">${t.receipt_path ? `<button type="button" class="btn" id="vr">View receipt</button>` : "<span></span>"}<button type="button" class="btn danger" id="dt">Delete</button></div>` : ""}
    <button type="button" class="btn" data-close>Cancel</button></form>`, (el, close) => {
    let receipt = null; const rf = el.querySelector("[name=receipt]"); if (rf) rf.onchange = e => { receipt = e.target.files[0]; $("#rmsg", el).textContent = "Receipt photo ready to save."; };
    $("#tf", el).onsubmit = async e => {
      e.preventDefault(); const d = formData(e.target); delete d.receipt;
      const row = { ...t, ...d, by: t.by || S.user.email };
      if (receipt) { const small = await resizeImage(receipt, 2000, 0.85); row.receipt_path = `receipts/${uid()}.jpg`; await S.store.putFile(row.receipt_path, small); }
      if (isNew) await S.store.insert("transactions", row); else await S.store.update("transactions", t.id, row);
      await audit(isNew ? "money_added" : "money_edited", { type, amount: d.amount, car_id: t.car_id || null });
      close(); toast("Saved"); render();
    };
    const vr = $("#vr", el); if (vr) vr.onclick = async () => { const b = await S.store.fileBlob(t.receipt_path); if (b) window.open(URL.createObjectURL(b)); };
    const dt = $("#dt", el); if (dt) dt.onclick = async () => { if (t.handover_id) return toast("This payment is on an issued handover pack. Record a refund instead.", true); if (!confirm("Delete this record?")) return; await S.store.remove("transactions", t.id); await audit("money_deleted", { type, amount: t.amount }); close(); render(); };
  });
}

/* ---------------- Leads and viewings ---------------- */
async function leads(seg = "leads", filter) {
  const [list, views, carsL] = await Promise.all([S.store.list("leads"), S.store.list("viewings"), S.store.list("cars")]);
  if (seg === "viewings") {
    const upcoming = views.filter(v => !v.outcome).sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    const past = views.filter(v => v.outcome).sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 20);
    const row = v => { const l = list.find(x => x.id === v.lead_id) || {}; const c = carsL.find(x => x.id === v.car_id); return `<a href="#viewing/${v.id}"><div class="grow"><div class="t">${fmtDT(v.at)}</div><div class="s">${esc(l.name || "")} · ${esc(c ? c.reg : "")} · ${esc(nameOf(v.assigned_to))}</div></div>${v.outcome ? `<span class="tag">${esc(v.outcome)}</span>` : ""}<span class="chev">›</span></a>`; };
    return { title: "Leads", html: segs("viewings") + `<a class="btn primary block" href="#viewing-new">Book viewing</a><div class="panel tight"><div style="padding:14px 16px 6px"><h2>Coming up</h2></div><div class="list">${upcoming.map(row).join("") || `<div class="empty">No viewings booked.</div>`}</div></div>${past.length ? `<div class="panel tight"><div style="padding:14px 16px 6px"><h2>Done</h2></div><div class="list">${past.map(row).join("")}</div></div>` : ""}` };
  }
  const f = filter || "open";
  const shown = list.filter(l => f === "open" ? !["sold", "closed"].includes(l.stage) : f === "mine" ? isMe(l.assigned_to) && !["sold", "closed"].includes(l.stage) : l.stage === f).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const chips = [["open", "Open"], ["mine", "Mine"], ...LEAD_STAGES];
  return {
    title: "Leads",
    html: segs("leads") + `<a class="btn primary block" href="#lead-new">Add lead</a>
    <div class="chips" role="group" aria-label="Filter">${chips.map(([k, l]) => `<button aria-pressed="${k === f}" data-f="${k}">${l}</button>`).join("")}</div>
    <div class="panel tight"><div class="list">${shown.map(l => { const c = carsL.find(x => x.id === l.car_id); return `<a href="#lead/${l.id}"><div class="grow"><div class="t">${esc(l.name || "Unknown")} ${l.sample ? '<span class="tag sample-t">Sample</span>' : ""}</div><div class="s">${esc(l.source || "")}${c ? ` · ${esc(c.reg)}` : ""} · ${esc(nameOf(l.assigned_to))}${l.follow_up ? ` · follow up ${fmtDT(l.follow_up)}` : ""}</div></div><span class="tag ${l.stage}">${stageLabel(LEAD_STAGES, l.stage)}</span></a>`; }).join("") || `<div class="empty">No leads here.</div>`}</div></div>`,
    mount() { $$("[data-f]").forEach(b => b.onclick = () => location.hash = `#leads/leads/${b.dataset.f}`); },
  };
}
const segs = (on) => `<div class="chips" role="tablist"><button aria-pressed="${on === "leads"}" onclick="location.hash='#leads/leads'">Leads</button><button aria-pressed="${on === "viewings"}" onclick="location.hash='#leads/viewings'">Viewings</button></div>`;
const teamOptions = (sel, allowNone = true) => `${allowNone ? `<option value="">Unassigned</option>` : ""}${S.team.map(t => `<option value="${esc(t.email)}" ${t.email === sel ? "selected" : ""}>${esc(t.name)}</option>`).join("")}`;
const carOptions = (carsL, sel, allowNone = true) => `${allowNone ? `<option value="">No particular car</option>` : ""}${carsL.filter(c => !OUT.includes(c.status) || c.id === sel).map(c => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.reg)} · ${esc(carTitle(c))}</option>`).join("")}`;

async function leadNew(carId) {
  const carsL = await S.store.list("cars");
  return {
    title: "Add lead", back: "#leads",
    html: `<form class="panel" id="f">
      <label class="f">Name<input class="i" name="name" autocomplete="off" required></label>
      <div class="btns"><label class="f">Phone<input class="i" name="phone" type="tel" inputmode="tel"></label><label class="f">Came in by<select class="i" name="source">${SOURCES.map(s => `<option>${s}</option>`).join("")}</select></label></div>
      <label class="f">Email<input class="i" name="email" type="email"></label>
      <label class="f">Interested in<select class="i" name="car_id">${carOptions(carsL, carId || "")}</select></label>
      <label class="f">What did they say?<textarea class="i" name="notes" placeholder="Paste or type their message"></textarea></label>
      <div class="btns"><label class="f">Assign to<select class="i" name="assigned_to">${teamOptions("")}</select></label><label class="f">Follow up<input class="i" name="follow_up" type="datetime-local" value="${localDT(new Date(Date.now() + 3600e3))}"></label></div>
      <button class="btn primary block">Save lead</button></form>`,
    mount() {
      $("#f").onsubmit = async e => {
        e.preventDefault(); const d = formData(e.target);
        const l = await S.store.insert("leads", { ...d, follow_up: d.follow_up ? new Date(d.follow_up).toISOString() : null, stage: "new", messages: d.notes ? [{ at: nowIso(), by: S.user.email, dir: "in", text: d.notes }] : [], created_by: S.user.email });
        await audit("lead_added", { lead_id: l.id }); toast(d.assigned_to ? `Lead saved and assigned to ${nameOf(d.assigned_to)}` : "Lead saved. Both of you will be notified."); location.hash = `#lead/${l.id}`;
      };
    },
  };
}

async function lead(id) {
  const l = await S.store.get("leads", id); if (!l) return { title: "Not found", back: "#leads", html: `<div class="empty">Lead removed.</div>` };
  const [carsL, views] = await Promise.all([S.store.list("cars"), S.store.list("viewings")]);
  const c = carsL.find(x => x.id === l.car_id);
  const myViews = views.filter(v => v.lead_id === id).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const first = (l.name || "").split(" ")[0];
  const waText = c ? `Hi ${first}, it's ${S.user.name} from ${S.settings.trading_name} about the ${carTitle(c)} (${c.reg}).` : `Hi ${first}, it's ${S.user.name} from ${S.settings.trading_name}.`;
  return {
    title: l.name || "Lead", back: "#leads",
    html: `
    <section class="panel">
      <div class="row between"><div><h1>${esc(l.name)}</h1><p class="muted">${esc(l.source || "")} · added ${fmtDate(l.created_at)}</p></div><span class="tag ${l.stage}">${stageLabel(LEAD_STAGES, l.stage)}</span></div>
      ${l.phone ? `<div class="btns"><a class="btn primary" href="${telHref(l.phone)}">Call</a><a class="btn primary" href="${waHref(l.phone, waText)}" target="_blank" rel="noopener">WhatsApp</a></div><p class="muted num">${esc(l.phone)}${l.email ? ` · ${esc(l.email)}` : ""}</p>` : `<p class="muted">No phone number saved.</p>`}
      ${c ? `<a class="row" href="#car/${c.id}" style="text-decoration:none;color:inherit"><span class="plate">${esc(c.reg)}</span><span class="grow">${esc(carTitle(c))}</span><span class="num">${c.asking_price ? money(c.asking_price) : ""}</span></a>` : ""}
    </section>
    <section class="panel">
      <div class="btns"><label class="f">Stage<select class="i" id="stage">${LEAD_STAGES.map(([k, v]) => `<option value="${k}" ${l.stage === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="f">Assigned to<select class="i" id="assign">${teamOptions(l.assigned_to)}</select></label></div>
      ${!l.assigned_to ? `<button class="btn" id="takeit">I'll take this one</button>` : ""}
      <label class="f">Follow up<input class="i" id="fu" type="datetime-local" value="${l.follow_up ? localDT(new Date(l.follow_up)) : ""}"></label>
      <div class="btns"><button class="btn" data-fu="2">In 2 hours</button><button class="btn" data-fu="tomorrow">Tomorrow 10:00</button></div>
    </section>
    <section class="panel">
      <h2>Messages and notes</h2>
      ${(l.messages || []).length ? `<div style="display:grid;gap:8px">${(l.messages || []).map(m => `<div class="calc" style="${m.dir === "out" ? "background:var(--mint-l)" : ""}"><div class="muted">${m.dir === "out" ? "Sent by " + esc(nameOf(m.by)) : m.dir === "in" ? "From customer" : "Note by " + esc(nameOf(m.by))} · ${fmtDT(m.at)}${m.channel ? " · " + esc(m.channel) : ""}</div><div>${esc(m.text).replace(/\n/g, "<br>")}</div></div>`).join("")}</div>` : `<p class="muted">Nothing logged yet.</p>`}
      <form id="msg" style="display:grid;gap:8px"><textarea class="i" name="text" placeholder="Paste a WhatsApp message or add a note" required></textarea>
      <div class="btns three"><button class="btn" name="dir" value="in">They said</button><button class="btn" name="dir" value="out">We said</button><button class="btn" name="dir" value="note">Note</button></div></form>
    </section>
    <section class="panel">
      <div class="row between"><h2>Viewings</h2><a class="btn" href="#viewing-new/${id}">Book viewing</a></div>
      ${myViews.map(v => `<a href="#viewing/${v.id}" class="row" style="text-decoration:none;color:inherit"><span class="grow">${fmtDT(v.at)} · ${esc(nameOf(v.assigned_to))}</span>${v.outcome ? `<span class="tag">${esc(v.outcome)}</span>` : `<span class="tag reserved">Booked</span>`}</a>`).join("") || `<p class="muted">None yet.</p>`}
    </section>
    <section class="panel"><h2>Details</h2><form id="det" style="display:grid;gap:12px">
      <label class="f">Name<input class="i" name="name" value="${esc(l.name)}"></label>
      <div class="btns"><label class="f">Phone<input class="i" name="phone" type="tel" value="${esc(l.phone)}"></label><label class="f">Email<input class="i" name="email" type="email" value="${esc(l.email)}"></label></div>
      <label class="f">Interested in<select class="i" name="car_id">${carOptions(carsL, l.car_id)}</select></label>
      <button class="btn block">Save details</button></form></section>
    <button class="btn danger block" id="del">Delete lead</button>`,
    mount() {
      const up = async (patch, msg) => { await S.store.update("leads", id, patch); msg && toast(msg); render(); };
      $("#stage").onchange = e => { audit("lead_stage", { lead_id: id, to: e.target.value }); up({ stage: e.target.value }, "Stage updated"); };
      $("#assign").onchange = e => up({ assigned_to: e.target.value || null }, e.target.value ? `Assigned to ${nameOf(e.target.value)}` : "Unassigned");
      const ti = $("#takeit"); if (ti) ti.onclick = () => up({ assigned_to: S.user.email }, "It's yours");
      $("#fu").onchange = e => up({ follow_up: e.target.value ? new Date(e.target.value).toISOString() : null, follow_up_notified: false }, "Follow-up set");
      $$("[data-fu]").forEach(b => b.onclick = () => { const d = new Date(); if (b.dataset.fu === "2") d.setHours(d.getHours() + 2); else { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); } up({ follow_up: d.toISOString(), follow_up_notified: false, assigned_to: l.assigned_to || S.user.email }, `Follow up ${fmtDT(d.toISOString())}`); });
      let dir = "note"; $$("#msg button").forEach(b => b.onclick = () => dir = b.value);
      $("#msg").onsubmit = e => { e.preventDefault(); const text = e.target.text.value.trim(); if (!text) return; const stage = dir === "out" && l.stage === "new" ? "replied" : l.stage; up({ messages: [...(l.messages || []), { at: nowIso(), by: S.user.email, dir, text, channel: l.source === "WhatsApp" ? "WhatsApp" : "" }], stage }, "Logged"); };
      $("#det").onsubmit = e => { e.preventDefault(); up(formData(e.target), "Saved"); };
      $("#del").onclick = async () => { if (!confirm("Delete this lead and its notes?")) return; await S.store.remove("leads", id); location.hash = "#leads"; };
    },
  };
}

async function viewingNew(leadId, carId) {
  const [leadsL, carsL] = await Promise.all([S.store.list("leads"), S.store.list("cars")]);
  const l = leadsL.find(x => x.id === leadId);
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0);
  return {
    title: "Book viewing", back: leadId ? `#lead/${leadId}` : "#leads/viewings",
    html: `<form class="panel" id="f">
      <label class="f">Customer<select class="i" name="lead_id"><option value="">New customer…</option>${leadsL.filter(x => !["sold", "closed"].includes(x.stage) || x.id === leadId).map(x => `<option value="${x.id}" ${x.id === leadId ? "selected" : ""}>${esc(x.name)}${x.phone ? " · " + esc(x.phone) : ""}</option>`).join("")}</select></label>
      <div id="newc" class="btns" ${leadId ? "hidden" : ""}><label class="f">Name<input class="i" name="name"></label><label class="f">Phone<input class="i" name="phone" type="tel"></label></div>
      <label class="f">Car<select class="i" name="car_id" required>${carOptions(carsL, carId || (l ? l.car_id : ""), false)}</select></label>
      <label class="f">When<input class="i" name="at" type="datetime-local" value="${localDT(d)}" required></label>
      <label class="f">Who's meeting them<select class="i" name="assigned_to">${teamOptions(S.user.email, false)}</select></label>
      <label class="f">Notes<input class="i" name="notes"></label>
      <button class="btn primary block">Book viewing</button></form>`,
    mount() {
      const f = $("#f"); f.lead_id.onchange = () => $("#newc").hidden = !!f.lead_id.value;
      f.onsubmit = async e => {
        e.preventDefault(); const d = formData(f); let lid = d.lead_id;
        if (!lid) { if (!d.name) return toast("Add the customer's name", true); const nl = await S.store.insert("leads", { name: d.name, phone: d.phone, source: "Phone", car_id: d.car_id, stage: "viewing_booked", assigned_to: d.assigned_to, messages: [], created_by: S.user.email }); lid = nl.id; }
        else await S.store.update("leads", lid, { stage: "viewing_booked", car_id: d.car_id, assigned_to: (leadsL.find(x => x.id === lid) || {}).assigned_to || d.assigned_to });
        const v = await S.store.insert("viewings", { lead_id: lid, car_id: d.car_id, at: new Date(d.at).toISOString(), assigned_to: d.assigned_to, notes: d.notes, by: S.user.email });
        await audit("viewing_booked", { viewing_id: v.id }); toast("Viewing booked"); location.hash = `#viewing/${v.id}`;
      };
    },
  };
}

async function viewing(id) {
  const v = await S.store.get("viewings", id); if (!v) return { title: "Not found", back: "#leads/viewings", html: "" };
  const [l, c] = await Promise.all([S.store.get("leads", v.lead_id), S.store.get("cars", v.car_id)]);
  const loc = S.settings.viewing_location || "";
  const confirmText = `Hi ${(l?.name || "").split(" ")[0]}, your viewing of the ${carTitle(c)} (${c?.reg}) is booked for ${fmtDT(v.at)} at ${loc}. Any problems, message this number. ${S.user.name}, ${S.settings.trading_name}`;
  return {
    title: "Viewing", back: "#leads/viewings",
    html: `<section class="panel">
      <h1>${fmtDT(v.at)}</h1>
      <p><a href="#lead/${l?.id}">${esc(l?.name || "")}</a> · ${esc(nameOf(v.assigned_to))} meeting them</p>
      ${c ? `<p class="row"><span class="plate">${esc(c.reg)}</span>${esc(carTitle(c))}</p>` : ""}
      ${v.notes ? `<p class="muted">${esc(v.notes)}</p>` : ""}
      ${l?.phone ? `<div class="btns"><a class="btn primary" href="${telHref(l.phone)}">Call</a><a class="btn primary" target="_blank" rel="noopener" href="${waHref(l.phone, confirmText)}">Send confirmation</a></div>` : ""}
      <button class="btn" id="ics">Add to my calendar</button>
    </section>
    <section class="panel"><h2>How did it go?</h2>
      <div class="btns"><button class="btn" data-o="Sold">Sold</button><button class="btn" data-o="Thinking">Thinking about it</button><button class="btn" data-o="No show">No show</button><button class="btn" data-o="Not for them">Not for them</button></div>
      ${v.outcome ? `<p>Outcome: <b>${esc(v.outcome)}</b></p>` : ""}
      <div class="btns"><label class="f">Move to<input class="i" id="at" type="datetime-local" value="${localDT(new Date(v.at))}"></label><label class="f">Who<select class="i" id="who">${teamOptions(v.assigned_to, false)}</select></label></div>
    </section>
    ${v.outcome === "Sold" && c && c.status !== "sold" ? `<a class="btn navy block" href="#handover/new/${c.id}/${l?.id || ""}">Start handover</a>` : ""}
    <button class="btn danger block" id="del">Cancel viewing</button>`,
    mount() {
      $$("[data-o]").forEach(b => b.onclick = async () => { await S.store.update("viewings", id, { outcome: b.dataset.o }); if (l) { if (b.dataset.o === "Not for them") await S.store.update("leads", l.id, { stage: "closed" }); if (b.dataset.o === "Thinking") await S.store.update("leads", l.id, { follow_up: new Date(Date.now() + 864e5).toISOString(), follow_up_notified: false }); } if (b.dataset.o === "Sold" && c && c.status === "available") await S.store.update("cars", c.id, { status: "reserved" }); toast("Saved"); render(); });
      $("#at").onchange = async e => { await S.store.update("viewings", id, { at: new Date(e.target.value).toISOString(), notified: false }); toast("Moved"); render(); };
      $("#who").onchange = async e => { await S.store.update("viewings", id, { assigned_to: e.target.value, notified: false }); toast(`${nameOf(e.target.value)} is meeting them`); render(); };
      $("#ics").onclick = () => { const s = new Date(v.at), e = new Date(s.getTime() + 30 * 60000); const f = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, ""); downloadText(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Motorwise Desk//EN", "BEGIN:VEVENT", `UID:${v.id}@motorwise-desk`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(s)}`, `DTEND:${f(e)}`, `SUMMARY:Viewing: ${c?.reg || ""}`, `LOCATION:${loc}`, "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Viewing", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n"), "viewing.ics", "text/calendar"); };
      $("#del").onclick = async () => { if (!confirm("Cancel this viewing?")) return; await S.store.remove("viewings", id); location.hash = "#leads/viewings"; };
    },
  };
}

/* ---------------- Money ---------------- */
async function moneyScreen(period = "month") {
  const [carsL, txs] = await Promise.all([S.store.list("cars"), S.store.list("transactions")]);
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  const ranges = { month: [new Date(y, m, 1), new Date(y, m + 1, 0)], last: [new Date(y, m - 1, 1), new Date(y, m, 0)], year: [new Date(y, 0, 1), new Date(y, 11, 31)], all: [null, null] };
  const [fromD, toD] = ranges[period] || ranges.month; const iso = d => d ? new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10) : null;
  const s = summary(carsL, txs, S.settings, iso(fromD), iso(toD));
  const a = { days_to_sell: 30, discount_pct: 0, monthly_overheads: 0, horizon_days: 90, ...(S.settings.forecast || {}) };
  const hist = avgDaysToSell(carsL);
  const scen = { Base: forecast(carsL, txs, S.settings, a), "Lower price": forecast(carsL, txs, S.settings, { ...a, discount_pct: (a.discount_pct || 0) + 10 }), "Slower sale": forecast(carsL, txs, S.settings, { ...a, days_to_sell: (a.days_to_sell || 30) + 30 }) };
  const recent = txs.filter(t => (!s || true)).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12);
  const carById = Object.fromEntries(carsL.map(c => [c.id, c]));
  const months = monthly(carsL, txs, S.settings, 12);
  const val = stockValuation(carsL, txs, S.settings);
  const pa = { months: 6, monthly_overheads: a.monthly_overheads, ...(S.settings.projection || {}) };
  const proj = projection(carsL, txs, S.settings, pa);
  const bars = (list, key, cls = "") => { const max = Math.max(1, ...list.map(x => Math.abs(x[key]))); return `<div class="bars">${list.map(x => `<div title="${monthLabel(x.key)}: ${money(x[key])}"><b>${x[key] ? money(x[key]) : ""}</b><i class="${cls} ${x[key] < 0 ? "neg" : ""}" style="height:${Math.max(2, Math.round(Math.abs(x[key]) / max * 100))}%"></i><small>${monthLabel(x.key).split(" ")[0]}</small></div>`).join("")}</div>`; };
  const tl = { purchase: "Bought", expense: "Cost", overhead: "Overhead", deposit: "Deposit in", part_payment: "Part-payment in", balance: "Balance in", refund: "Refund out", sor_payout: "Paid to owner (SOR)" };
  return {
    title: "Accounts",
    html: `
    <div class="chips" role="group" aria-label="Period">${[["month", "This month"], ["last", "Last month"], ["year", "This year"], ["all", "All time"]].map(([k, l]) => `<button aria-pressed="${k === period}" data-p="${k}">${l}</button>`).join("")}</div>
    <div class="kpis">
      <div class="kpi"><span class="k">Received</span><span class="v">${money(s.received)}</span><span class="muted">payments in, less refunds</span></div>
      <div class="kpi"><span class="k">Owed to you</span><span class="v">${money(s.owed)}</span><span class="muted">sold cars, balance unpaid</span></div>
      <div class="kpi"><span class="k">Tied up in stock</span><span class="v">${money(s.tied)}</span><span class="muted">cost of unsold cars</span></div>
      <div class="kpi"><span class="k">Profit</span><span class="v">${money(s.netProfit)}</span><span class="muted">${s.soldCount} sold, after ${money(s.overheads)} overheads</span></div>
    </div>
    <section class="panel"><div class="row between"><h2>Profit by month</h2><span class="muted">last 12 months, after overheads</span></div>
      ${bars(months, "net")}
      <div style="overflow-x:auto;margin:8px -16px 0"><table class="t"><thead><tr><th>Month</th><th class="r">Sold</th><th class="r">Sales</th><th class="r">Cost of cars sold</th><th class="r">Gross profit</th><th class="r">Overheads</th><th class="r">Net profit</th><th class="r">Cash in</th><th class="r">Cash out</th></tr></thead><tbody>
      ${[...months].reverse().map(m => `<tr><td>${monthLabel(m.key)}</td><td class="r">${m.sold}</td><td class="r">${money(m.revenue)}</td><td class="r">${money(m.costOfSales)}</td><td class="r">${money(m.gross)}</td><td class="r">${money(m.overheads)}</td><td class="r ${m.net < 0 ? "neg" : ""}"><b>${money(m.net)}</b></td><td class="r">${money(m.cashIn)}</td><td class="r ${m.cashOut ? "neg" : ""}">${money(m.cashOut)}</td></tr>`).join("")}
      <tr><td><b>12 months</b></td><td class="r"><b>${months.reduce((t, m) => t + m.sold, 0)}</b></td><td class="r"><b>${money(months.reduce((t, m) => t + m.revenue, 0))}</b></td><td class="r">${money(months.reduce((t, m) => t + m.costOfSales, 0))}</td><td class="r"><b>${money(months.reduce((t, m) => t + m.gross, 0))}</b></td><td class="r">${money(months.reduce((t, m) => t + m.overheads, 0))}</td><td class="r"><b>${money(months.reduce((t, m) => t + m.net, 0))}</b></td><td class="r">${money(months.reduce((t, m) => t + m.cashIn, 0))}</td><td class="r">${money(months.reduce((t, m) => t + m.cashOut, 0))}</td></tr>
      </tbody></table></div>
      <p class="muted">A car's profit counts in the month it's marked sold: sale price − what you paid − its costs. Cash shows money actually in and out of the business that month.</p>
    </section>

    <section class="panel"><div class="row between"><h2>Stock on hand</h2><span class="muted">${val.rows.length} car${val.rows.length === 1 ? "" : "s"}</span></div>
      <div class="kpis" style="margin:8px 0">
        <div class="kpi"><span class="k">Cost so far</span><span class="v">${money(val.cost)}</span></div>
        <div class="kpi"><span class="k">Asking prices</span><span class="v">${money(val.asking)}</span></div>
        <div class="kpi"><span class="k">Margin if sold at asking</span><span class="v">${money(val.margin)}</span></div>
      </div>
      <div style="overflow-x:auto;margin:0 -16px"><table class="t"><thead><tr><th>Car</th><th class="r">Days</th><th class="r">Cost so far</th><th class="r">Asking</th><th class="r">Margin</th></tr></thead><tbody>
      ${val.rows.map(r => `<tr><td><a href="#money-car/${r.car.id}">${r.car.stock_id ? `<b>${esc(r.car.stock_id)}</b> ` : ""}<span class="plate">${esc(r.car.reg)}</span> ${esc([r.car.make, r.car.model].filter(Boolean).join(" "))}</a>${r.noCost ? `<div class="muted">No purchase price entered</div>` : ""}</td><td class="r ${r.days > 60 ? "neg" : ""}">${r.days}</td><td class="r">${money(r.cost)}</td><td class="r">${r.asking ? money(r.asking) : "Not set"}</td><td class="r ${r.margin < 0 ? "neg" : ""}">${r.margin != null ? `${money(r.margin)}${r.pct != null ? ` <span class="muted">${r.pct}%</span>` : ""}` : "–"}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No unsold cars.</td></tr>`}
      </tbody></table></div>
      <p class="muted">Days in red: in stock over 60 days. Cars with no purchase price entered show a margin that's too high, so add what you paid.</p>
    </section>

    <section class="panel"><div class="row between"><h2>Projection</h2><span class="tag draft">Estimate, not actual</span></div>
      <form id="pa" class="btns">
        <label class="f">Cars sold per month<input class="i" name="cars_per_month" type="number" step="0.5" value="${proj.perMonth}"><span class="hint">${proj.basis.histPerMonth != null ? `Your last 6 months: ${Math.round(proj.basis.histPerMonth * 10) / 10}` : "Shows your real rate once you've sold some"}</span></label>
        <label class="f">Profit per car (£)<input class="i" name="profit_per_car" type="number" value="${proj.perCar}"><span class="hint">${proj.basis.histProfit != null ? `Your average so far: ${money(proj.basis.histProfit)}` : proj.basis.stockMargin != null ? `Current stock average margin: ${money(proj.basis.stockMargin)}` : ""}</span></label>
        <label class="f">Overheads per month (£)<input class="i" name="monthly_overheads" type="number" value="${proj.over}"></label>
        <label class="f">Months ahead<input class="i" name="months" type="number" min="1" max="24" value="${proj.months}"></label>
      </form>
      ${bars(proj.rows, "cumulative", "proj")}
      <div style="overflow-x:auto;margin:8px -16px 0"><table class="t"><thead><tr><th>Month</th><th class="r">Cars</th><th class="r">Gross</th><th class="r">Overheads</th><th class="r">Net</th><th class="r">Running total</th></tr></thead><tbody>
      ${proj.rows.map(r => `<tr><td>${monthLabel(r.key)}</td><td class="r">${r.cars}</td><td class="r">${money(r.gross)}</td><td class="r">${money(r.overheads)}</td><td class="r ${r.net < 0 ? "neg" : ""}">${money(r.net)}</td><td class="r"><b>${money(r.cumulative)}</b></td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted">Working: each month = cars sold × profit per car − overheads. Running total adds the months up. Change the numbers above to test what-ifs.</p>
    </section>

    <section class="panel tight"><div style="padding:14px 16px 6px" class="row between"><h2>Profit by car</h2><span class="muted">tap for working</span></div>
      <div class="list">${s.figs.sort((x, y) => (y.car.sold_date || "9").localeCompare(x.car.sold_date || "9")).map(({ car: c, f }) => `<a href="#money-car/${c.id}"><div class="grow"><div class="t"><span class="plate">${esc(c.reg)}</span> ${esc(carTitle(c))} ${c.sample ? '<span class="tag sample-t">Sample</span>' : ""}</div><div class="s">${f.sold ? `Sold ${fmtDate(c.sold_date)} for ${money(f.salePrice)}${f.owed ? ` · ${money(f.owed)} owed` : ""}` : `${stageLabel(CAR_STAGES, c.status)} · cost so far ${money(f.cost)}`}</div></div><span class="num" style="font-weight:800">${f.sold ? money(f.profit) : ""}</span></a>`).join("") || `<div class="empty">No cars yet.</div>`}</div></section>
    <div class="btns"><button class="btn" id="ovh">Add overhead</button><button class="btn" id="exp">Export for accountant</button></div>
    <section class="panel"><div class="row between"><h2>Forecast</h2><span class="tag draft">Estimate, not actual</span></div>
      <p class="muted">Based on the cars in stock now and the assumptions below. Change them to test what-ifs.</p>
      <form id="fa" class="btns">
        <label class="f">Days to sell a car<input class="i" name="days_to_sell" type="number" value="${a.days_to_sell}"><span class="hint">${hist ? `Your average so far: ${hist}` : "Your own average shows after 3 real sales"}</span></label>
        <label class="f">Discount off asking (%)<input class="i" name="discount_pct" type="number" value="${a.discount_pct}"></label>
        <label class="f">Overheads per month (£)<input class="i" name="monthly_overheads" type="number" value="${a.monthly_overheads}"></label>
        <label class="f">Look ahead (days)<input class="i" name="horizon_days" type="number" value="${a.horizon_days}"></label>
      </form>
      <table class="t"><thead><tr><th>Scenario</th><th class="r">Cash in 30 days</th><th class="r">In 90 days</th><th class="r">Profit after overheads</th></tr></thead><tbody>
      ${Object.entries(scen).map(([k, r]) => `<tr><td><b>${k}</b><div class="muted">${k === "Base" ? `${r.assumptions.discount_pct}% off, ${r.assumptions.days_to_sell} days` : k === "Lower price" ? `${r.assumptions.discount_pct}% off asking` : `${r.assumptions.days_to_sell} days to sell`}</div></td><td class="r num">${money(r.cashIn30)}</td><td class="r num">${money(r.cashIn90)}</td><td class="r num">${money(r.net)}</td></tr>`).join("")}
      </tbody></table>
      <p class="muted">Working: each unsold car sells at asking price less the discount, once it reaches the days-to-sell age. Profit = expected price − costs so far, less overheads for the look-ahead period.</p>
    </section>
    ${S.settings.vat_treatment !== "not_registered" ? `<div class="flag">VAT figures are estimates using the ${S.settings.vat_treatment === "margin_scheme" ? "second-hand margin scheme (VAT = margin ÷ 6)" : "standard rate (VAT = price ÷ 6)"}. Your accountant should confirm.</div>` : ""}
    <section class="panel tight"><div style="padding:14px 16px 6px"><h2>Latest money in and out</h2></div><div class="list">${recent.map(t => `<button data-tx="${t.id}"><div class="grow"><div class="t">${tl[t.type] || t.type}${t.category ? ": " + esc(t.category) : ""}</div><div class="s">${fmtDate(t.date)}${t.car_id && carById[t.car_id] ? " · " + esc(carById[t.car_id].reg) : ""}${t.sample ? " · sample" : ""}</div></div><span class="num">${["deposit", "part_payment", "balance"].includes(t.type) ? "+" : "−"}${money2(t.amount)}</span></button>`).join("") || `<div class="empty">Nothing recorded yet.</div>`}</div></section>`,
    mount() {
      $$("[data-p]").forEach(b => b.onclick = () => location.hash = `#money/${b.dataset.p}`);
      $("#ovh").onclick = () => txSheet({ type: "overhead" });
      $$("[data-tx]").forEach(b => b.onclick = () => txSheet(txs.find(t => t.id === b.dataset.tx)));
      $("#pa").onchange = async e => { await S.store.update("settings", S.settings.id, { projection: { ...pa, ...formData(e.currentTarget) } }); render(); };
      $("#fa").onchange = async e => { await S.store.update("settings", S.settings.id, { forecast: { ...a, ...formData(e.currentTarget) } }); render(); };
      $("#exp").onclick = () => exportSheet();
    },
  };
}

async function moneyCar(id) {
  const [c, txs] = await Promise.all([S.store.get("cars", id), S.store.list("transactions")]);
  const f = carFigures(c, txs, S.settings);
  const mine = txs.filter(t => t.car_id === id).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return {
    title: c.reg, back: "#money",
    html: `<section class="panel"><h1>${esc(carTitle(c))}</h1><p class="muted">${stageLabel(CAR_STAGES, c.status)} · in stock ${ageDays(c)} days</p>
      <div class="calc">
        ${f.sold ? `<div class="l"><span>Sold for</span><span class="num">${money2(f.salePrice)}</span></div>` : ""}
        <div class="l"><span>− Purchase price</span><span class="num">${money2(f.purchase)}</span></div>
        <div class="l"><span>− Costs (${mine.filter(t => t.type === "expense").length})</span><span class="num">${money2(f.expenses)}</span></div>
        ${f.refunds ? `<div class="l"><span>− Refunds</span><span class="num">${money2(f.refunds)}</span></div>` : ""}
        <div class="l tot"><span>${f.sold ? "Profit on this car" : "Cash tied up"}</span><span class="num">${money2(f.sold ? f.profit : f.cashTied)}</span></div>
        ${f.vat != null ? `<div class="l"><span>VAT estimate (${S.settings.vat_treatment === "margin_scheme" ? "margin ÷ 6" : "price ÷ 6"})</span><span class="num">${money2(f.vat)}</span></div>` : ""}
      </div>
      ${f.sold ? `<div class="calc"><div class="l"><span>Customer has paid</span><span class="num">${money2(f.received - f.refunds)}</span></div>${f.px ? `<div class="l"><span>Part exchange</span><span class="num">${money2(f.px)}</span></div>` : ""}<div class="l tot"><span>Still owed</span><span class="num">${money2(f.owed)}</span></div></div>` : ""}
      <p class="muted">Overheads (rent, insurance) are not split across cars. They come off the total on the Money screen.</p></section>
    <section class="panel tight"><div class="list">${mine.map(t => `<button data-tx="${t.id}"><div class="grow"><div class="t">${esc(t.type.replace("_", " "))}${t.category ? ": " + esc(t.category) : ""}</div><div class="s">${fmtDate(t.date)} · ${esc(t.method || "")}${t.receipt_path ? " · receipt" : ""}</div></div><span class="num">${money2(t.amount)}</span></button>`).join("")}</div></section>
    <div class="btns"><button class="btn" id="exp">Add cost</button>${f.sold ? `<button class="btn" id="pay">Record payment</button>` : `<button class="btn" id="dep">Take deposit</button>`}</div>
    ${f.sold ? `<button class="btn danger block" id="ref">Record refund</button>` : ""}`,
    mount() {
      $("#exp").onclick = () => txSheet({ car_id: id, type: "expense" });
      const p = $("#pay"); if (p) p.onclick = () => txSheet({ car_id: id, type: "balance" });
      const d = $("#dep"); if (d) d.onclick = () => txSheet({ car_id: id, type: "deposit" });
      const r = $("#ref"); if (r) r.onclick = () => txSheet({ car_id: id, type: "refund" });
      $$("[data-tx]").forEach(b => b.onclick = () => txSheet(mine.find(t => t.id === b.dataset.tx)));
    },
  };
}

function exportSheet() {
  const y = new Date().getFullYear();
  sheet(`<h2>Export for your accountant</h2><p class="muted">Spreadsheet files (CSV) that open in Excel, Numbers or Google Sheets.</p>
    <div class="btns"><label class="f">From<input class="i" id="ef" type="date" value="${y}-01-01"></label><label class="f">To<input class="i" id="et" type="date" value="${todayISO()}"></label></div>
    <button class="btn" data-e="money">All money in and out</button><button class="btn" data-e="cars">Cars with costs and profit</button><button class="btn" data-e="sales">Sales register (invoices)</button><button class="btn" data-close>Close</button>`, (el) => {
    $$("[data-e]", el).forEach(b => b.onclick = async () => {
      const from = $("#ef", el).value, to = $("#et", el).value; const [carsL, txs, issues, custs, hos] = await Promise.all(["cars", "transactions", "issues", "customers", "handovers"].map(t => S.store.list(t)));
      const carById = Object.fromEntries(carsL.map(c => [c.id, c])); const inR = d => (!from || d >= from) && (!to || d <= to);
      let rows, name;
      if (b.dataset.e === "money") { rows = [["Date", "Type", "Category", "Registration", "Amount", "Direction", "Method", "Note", "Receipt saved", "Sample"], ...txs.filter(t => inR(t.date || "")).sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type, t.category || "", carById[t.car_id]?.reg || "", Number(t.amount).toFixed(2), IN_TYPES.includes(t.type) ? "In" : "Out", t.method, t.note || "", t.receipt_path ? "Yes" : "No", t.sample ? "SAMPLE" : ""])]; name = `motorwise-money-${from}-to-${to}.csv`; }
      if (b.dataset.e === "cars") { rows = [["Registration", "Vehicle", "Stage", "Bought", "Purchase", "Costs", "Sold", "Sale price", "Profit", "Owed", "VAT estimate", "Sample"], ...carsL.map(c => { const f = carFigures(c, txs, S.settings); return [c.reg, carTitle(c), c.status, c.purchase_date || "", f.purchase.toFixed(2), f.expenses.toFixed(2), c.sold_date || "", f.sold ? f.salePrice.toFixed(2) : "", f.sold ? f.profit.toFixed(2) : "", f.owed.toFixed(2), f.vat != null ? f.vat.toFixed(2) : "", c.sample ? "SAMPLE" : ""]; })]; name = `motorwise-stock-and-profit.csv`; }
      if (b.dataset.e === "sales") { rows = [["Document no.", "Kind", "Date", "Registration", "Customer", "Price", "Pack version", "Pack status", "SHA-256"], ...issues.filter(i => inR((i.issued_at || "").slice(0, 10))).sort((a, b) => a.issued_at.localeCompare(b.issued_at)).map(i => [i.number, i.kind, i.issued_at.slice(0, 10), carById[i.car_id]?.reg || "", (custs.find(c => c.id === i.customer_id) || {}).name || "", Number(i.price || 0).toFixed(2), i.version, (hos.find(x => x.id === i.handover_id) || {}).status || "", i.files?.[0]?.hash || ""])]; name = `motorwise-sales-register.csv`; }
      await downloadText(csv(rows), name);
    });
  });
}

/* ---------------- Handover ---------------- */
async function handover(id, step) {
  if (id === "new") {
    if (S.creating) return { title: "Handover", html: "" };
    S.creating = true;
    const leadId = location.hash.split("/")[3] || null;
    const h = await S.store.insert("handovers", { status: "draft", version: 1, car_id: step || null, lead_id: leadId, sale_type: "on_premises", warranty: "none", checklist: {}, signatures: {}, started_by: S.user.email });
    setTimeout(() => S.creating = false, 1000);
    location.replace(`#handover/${h.id}/${step ? "customer" : "car"}`); return { title: "Handover", html: "" };
  }
  const h = await S.store.get("handovers", id); if (!h) return { title: "Not found", back: "#today", html: `<div class="empty">Handover not found.</div>` };
  if (h.status !== "draft") return handoverDone(h);
  const STEPS = ["car", "customer", "price", "checklist", "preview"];
  const st = STEPS.includes(step) ? step : "car"; const i = STEPS.indexOf(st);
  const bar = `<div class="steps" aria-label="Step ${i + 1} of 5">${STEPS.map((s, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div>`;
  const next = s => location.hash = `#handover/${id}/${s}`;
  const back = i ? `#handover/${id}/${STEPS[i - 1]}` : "#today";
  const titles = { car: "Choose the car", customer: "Customer", price: "Price and payments", checklist: "Checklist and signatures", preview: "Preview handover pack" };
  const v = await HSTEP[st](h, next);
  const keep = handover.last === id + st; handover.last = id + st;
  return { title: titles[st], back, keepScroll: keep, html: bar + v.html + (st === "car" ? `<button class="btn danger block" id="cancelho">Cancel this handover</button>` : ""), mount(r) { v.mount && v.mount(r); const c = $("#cancelho"); if (c) c.onclick = async () => { if (!confirm("Cancel this handover? Nothing has been issued.")) return; await S.store.remove("handovers", id); location.hash = "#today"; }; } };
}

const HSTEP = {
  async car(h, next) {
    const carsL = (await S.store.list("cars")).filter(c => c.status !== "sold");
    return {
      html: `<div class="panel tight"><div class="list">${carsL.map(c => `<button data-c="${c.id}" ${h.car_id === c.id ? 'style="background:var(--mint-l)"' : ""}><div class="grow"><div class="t"><span class="plate">${esc(c.reg)}</span> ${esc(carTitle(c))}</div><div class="s">${stageLabel(CAR_STAGES, c.status)} · ${c.asking_price ? money(c.asking_price) : "no price"}</div></div><span class="chev">›</span></button>`).join("") || `<div class="empty">No unsold cars. Add the car first.</div>`}</div></div>`,
      mount() { $$("[data-c]").forEach(b => b.onclick = async () => { const c = carsL.find(x => x.id === b.dataset.c); await S.store.update("handovers", h.id, { car_id: c.id, price: h.price || c.asking_price, mileage: h.mileage || c.mileage, keys: h.keys ?? c.keys, faults_disclosed: h.faults_disclosed ?? c.known_faults }); next("customer"); }); },
    };
  },
  async customer(h, next) {
    const [custs, leadsL, carsL] = await Promise.all([S.store.list("customers"), S.store.list("leads"), S.store.list("cars")]);
    const c = carsL.find(x => x.id === h.car_id);
    if (c && h.price == null) await S.store.update("handovers", h.id, { price: c.asking_price, mileage: c.mileage, keys: c.keys, faults_disclosed: c.known_faults });
    const cu = custs.find(x => x.id === h.customer_id) || {};
    const lead = leadsL.find(x => x.id === h.lead_id) || (c ? leadsL.filter(x => x.car_id === c.id && !["sold", "closed"].includes(x.stage)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] : null);
    const pre = cu.id ? cu : lead ? { name: lead.name, phone: lead.phone, email: lead.email } : {};
    return {
      html: `${c ? `<p class="row"><span class="plate">${esc(c.reg)}</span>${esc(carTitle(c))}</p>` : ""}
      ${lead && !cu.id ? `<div class="flag ok">Filled in from the lead for ${esc(lead.name)}. Check it's right.</div>` : ""}
      <form class="panel" id="f">
        <label class="f">Full name<input class="i" name="name" required value="${esc(pre.name)}" autocomplete="off"></label>
        <label class="f">Address<textarea class="i" name="address" style="min-height:72px" required>${esc(pre.address)}</textarea></label>
        <div class="btns"><label class="f">Postcode<input class="i" name="postcode" value="${esc(pre.postcode)}" autocapitalize="characters" required></label><label class="f">Phone<input class="i" name="phone" type="tel" value="${esc(pre.phone)}"></label></div>
        <label class="f">Email <span class="hint">to send the pack</span><input class="i" name="email" type="email" value="${esc(pre.email)}"></label>
        <p class="muted">Customer details are private to the two of you and only appear in their own pack.</p>
        <button class="btn primary block">Next: price and payments</button>
      </form>`,
      mount() {
        $("#f").onsubmit = async e => { e.preventDefault(); const d = formData(e.target); d.postcode = d.postcode.toUpperCase(); let cid = h.customer_id; if (cid) await S.store.update("customers", cid, d); else cid = (await S.store.insert("customers", { ...d, lead_id: lead?.id || null })).id; await S.store.update("handovers", h.id, { customer_id: cid, lead_id: lead?.id || h.lead_id || null }); next("price"); };
      },
    };
  },
  async price(h, next) {
    const [c, txs] = await Promise.all([S.store.get("cars", h.car_id), S.store.list("transactions")]);
    const pays = txs.filter(t => t.car_id === h.car_id && [...IN_TYPES, "refund"].includes(t.type));
    const paid = pays.reduce((s, t) => s + (t.type === "refund" ? -1 : 1) * Number(t.amount), 0);
    const bal = (Number(h.price) || 0) - (Number(h.px_value) || 0) - paid;
    const warrantyOk = (await S.store.list("templates")).some(t => t.key === "warranty" && t.status === "approved");
    return {
      html: `<form class="panel" id="f">
        <label class="f">Agreed price (£)<input class="i" name="price" type="number" inputmode="decimal" step="0.01" required value="${esc(h.price)}"></label>
        <div class="btns"><label class="f">Mileage at handover<input class="i" name="mileage" type="number" value="${esc(h.mileage)}"></label><label class="f">Keys<input class="i" name="keys" type="number" value="${esc(h.keys)}"></label></div>
        <label class="f">How was the sale agreed?<select class="i" name="sale_type">
          <option value="on_premises" ${h.sale_type === "on_premises" ? "selected" : ""}>In person at Ramsden Road</option>
          <option value="distance" ${h.sale_type === "distance" ? "selected" : ""}>Remotely (phone, WhatsApp, online) without visiting</option>
          <option value="off_premises" ${h.sale_type === "off_premises" ? "selected" : ""}>In person, away from our site</option></select>
          <span class="hint">Remote and off-site sales give the buyer extra cancellation rights. The pack adds that information.</span></label>
        <label class="f">Warranty<select class="i" name="warranty"><option value="none">No warranty</option><option value="included" ${h.warranty === "included" ? "selected" : ""} ${warrantyOk ? "" : "disabled"}>Warranty included${warrantyOk ? "" : " (approve warranty wording in Admin first)"}</option></select></label>
        <details ${h.px_value ? "open" : ""}><summary class="btn block">Part exchange</summary><div class="btns" style="margin-top:12px"><label class="f">PX registration<input class="i" name="px_reg" value="${esc(h.px_reg)}" autocapitalize="characters"></label><label class="f">PX value (£)<input class="i" name="px_value" type="number" value="${esc(h.px_value)}"></label></div><label class="f" style="margin-top:12px">PX vehicle<input class="i" name="px_desc" value="${esc(h.px_desc)}" placeholder="e.g. 2008 Ford Focus"></label></details>
      </form>
      <section class="panel"><h2>Payments</h2>
        ${pays.length ? pays.map(p => `<div class="row between"><span>${fmtDate(p.date)} · ${esc(p.type.replace("_", "-"))} · ${esc(p.method)}</span><span class="num">${p.type === "refund" ? "−" : ""}${money2(p.amount)}</span></div>`).join("") : `<p class="muted">No payments yet.</p>`}
        <div class="calc"><div class="l"><span>Price</span><span class="num">${money2(h.price)}</span></div>${h.px_value ? `<div class="l"><span>− Part exchange</span><span class="num">${money2(h.px_value)}</span></div>` : ""}<div class="l"><span>− Paid</span><span class="num">${money2(paid)}</span></div><div class="l tot"><span>Balance</span><span class="num">${money2(bal)}</span></div></div>
        <div class="btns"><button class="btn" data-pay="balance">Balance paid</button><button class="btn" data-pay="part_payment">Part-payment</button></div>
      </section>
      <button class="btn primary block" id="go">Next: checklist</button>`,
      mount() {
        const f = $("#f"); const save = async () => { const d = formData(f); d.px_reg = plateFmt(d.px_reg); await S.store.update("handovers", h.id, d); return d; };
        f.onchange = async () => { await save(); render(); };
        $$("[data-pay]").forEach(b => b.onclick = async () => { await save(); txSheet({ car_id: h.car_id, type: b.dataset.pay, amount: b.dataset.pay === "balance" && bal > 0 ? Math.round(bal * 100) / 100 : "", method: "bank", note: "Payment at handover" }); });
        $("#go").onclick = async () => { const d = await save(); if (!d.price) return toast("Enter the agreed price", true); next("checklist"); };
      },
    };
  },
  async checklist(h, next) {
    const c = await S.store.get("cars", h.car_id); const ver = `Pack v${h.version}`;
    const sig = h.signatures || {};
    return {
      html: `<section class="panel"><h2>Faults told to the buyer</h2><textarea class="i" id="faults">${esc(h.faults_disclosed ?? c.known_faults ?? "")}</textarea><p class="muted">This exact text goes in the faults box on the order form they sign. Be thorough: anything listed here can't be claimed for later. Write "None known" if there are none.</p></section>
      <section class="panel"><h2>Checklist</h2>${CHECKLIST.map(it => `<label class="row" style="min-height:44px"><input type="checkbox" data-ck="${it.key}" ${h.checklist?.[it.key] ? "checked" : ""} style="width:24px;height:24px;accent-color:var(--teal)"><span>${it.label}</span></label>`).join("")}</section>
      <section class="panel"><h2>Customer signs</h2><p class="small">${esc(ACK)}</p><button type="button" class="btn block" id="showtcs">Let the customer read the terms</button><p class="muted">Their signature goes on the order form and the terms and conditions.</p>
        ${sig.customer ? `<div class="flag ok">Signed by ${esc(sig.customer.name)} · ${fmtDT(sig.customer.at)} · ${esc(sig.customer.doc_version)}</div><button class="btn" data-re="customer">Sign again</button>` : `<canvas class="sig" id="sc" aria-label="Customer signature"></canvas><div class="btns"><button class="btn" data-clr="sc">Clear</button><button class="btn primary" data-sign="customer">Save signature</button></div>`}
      </section>
      <section class="panel"><h2>${esc(S.user.name)} signs for ${esc(S.settings.trading_name)}</h2>
        ${sig.staff ? `<div class="flag ok">Signed by ${esc(sig.staff.name)} · ${fmtDT(sig.staff.at)} · ${esc(sig.staff.doc_version)}</div><button class="btn" data-re="staff">Sign again</button>` : `<canvas class="sig" id="ss" aria-label="Your signature"></canvas><div class="btns"><button class="btn" data-clr="ss">Clear</button><button class="btn primary" data-sign="staff">Save signature</button></div>`}
      </section>
      <button class="btn primary block" id="go">Next: preview pack</button>`,
      mount() {
        const pads = {}; if ($("#sc")) pads.customer = signaturePad($("#sc")); if ($("#ss")) pads.staff = signaturePad($("#ss"));
        $$("[data-clr]").forEach(b => b.onclick = () => pads[b.dataset.clr === "sc" ? "customer" : "staff"].clear());
        $("#faults").onchange = e => S.store.update("handovers", h.id, { faults_disclosed: e.target.value });
        $$("[data-ck]").forEach(cb => cb.onchange = async () => { const cur = await S.store.get("handovers", h.id); await S.store.update("handovers", h.id, { checklist: { ...(cur.checklist || {}), [cb.dataset.ck]: cb.checked } }); });
        $$("[data-sign]").forEach(b => b.onclick = async () => {
          const role = b.dataset.sign; const pad = pads[role]; if (pad.isEmpty()) return toast("Sign in the box first", true);
          const blob = await pad.toBlob(); const path = `handovers/${h.id}/sig-${role}-${Date.now()}.png`; await S.store.putFile(path, blob);
          const cu = await S.store.get("customers", h.customer_id); const cur = await S.store.get("handovers", h.id);
          const rec = { name: role === "customer" ? cu?.name : S.user.name, email: role === "staff" ? S.user.email : undefined, at: nowIso(), path, doc_version: ver, device: /iPhone|iPad/.test(navigator.userAgent) ? "iPhone" : "this device" };
          await S.store.update("handovers", h.id, { signatures: { ...(cur.signatures || {}), [role]: rec } }); await audit("signed", { handover_id: h.id, role, doc_version: ver }); toast("Signature saved"); render();
        });
        $$("[data-re]").forEach(b => b.onclick = async () => { const cur = await S.store.get("handovers", h.id); const s = { ...(cur.signatures || {}) }; delete s[b.dataset.re]; await S.store.update("handovers", h.id, { signatures: s }); render(); });
        $("#go").onclick = async () => { await S.store.update("handovers", h.id, { faults_disclosed: $("#faults").value }); next("preview"); };
        $("#showtcs").onclick = async () => { const t = (await S.store.list("templates")); const get = k => t.find(x => x.key === k); const parts = [get("tcs"), h.sale_type !== "on_premises" ? get("distance_rights") : null].filter(Boolean); sheet(`<h2>Terms and conditions of sale</h2>${parts.map(x => x.body.replace(/\{(\w+)\}/g, (_, k) => S.settings[k] || "").split("\n").map(l => `<p class="small">${esc(l)}</p>`).join("")).join("")}<button class="btn primary" data-close>Done reading</button>`); };
      },
    };
  },
  async preview(h) {
    const ctx = await packContext(h, { preview: true });
    const flags = packFlags(ctx);
    const blob = await buildPdf(ctx, DOCS.map(d => d.key));
    const url = URL.createObjectURL(blob);
    const blockers = flags.filter(f => f.block);
    const email = ctx.customer.email; const canEmail = S.live && S.settings.email_enabled && email;
    return {
      html: `${flags.map(f => `<div class="flag ${f.block ? "red" : ""}"><div>${f.text}</div>${f.fix || ""}</div>`).join("") || `<div class="flag ok">Everything needed is in place.</div>`}
      <section class="panel"><div class="row between"><h2>Handover pack</h2><a class="small" href="${url}" target="_blank" rel="noopener">Open full screen</a></div>
      <iframe class="pack-frame" src="${url}" title="Handover pack preview"></iframe>
      <p class="muted">Contains: ${DOCS.map(d => d.name).join(", ")}. Sent as one combined PDF plus each document separately.</p></section>
      <section class="panel"><h2>Send</h2>
        <p class="small">Sending gives this pack an invoice number, saves an exact copy, marks the car Sold and records the sale. It can't be undone, only corrected with a credit note.</p>
        <label class="f">Send by<select class="i" id="via">${canEmail ? `<option value="email">Email to ${esc(email)}</option>` : ""}<option value="share">iPhone share sheet (WhatsApp, Mail, Messages, AirDrop)</option></select>${!canEmail ? `<span class="hint">${S.live ? (email ? "Email sending isn't set up yet, see Admin." : "No customer email.") : "Sample mode: the share sheet opens, nothing goes to a real customer unless you choose them."}</span>` : ""}</label>
        <button class="btn primary block" id="send" ${blockers.length ? "disabled" : ""}>Issue and send pack</button>
        ${blockers.length ? `<p class="muted">Fix the red items above to send.</p>` : ""}
      </section>`,
      mount() {
        $$("[data-approve]").forEach(b => b.onclick = async () => { await approveTemplate(b.dataset.approve); render(); });
        const send = $("#send"); send.onclick = async () => { if (send.disabled) return; send.disabled = true; send.textContent = "Issuing…"; try { await issuePack(h.id, $("#via").value); } catch (e) { console.error(e); toast(e.message || "Could not issue the pack", true); send.disabled = false; send.textContent = "Issue and send pack"; } };
      },
    };
  },
};

async function packContext(h, { preview, invoiceNo, issuedAt, version } = {}) {
  const [car, customer, txs, tpls] = await Promise.all([S.store.get("cars", h.car_id), S.store.get("customers", h.customer_id), S.store.list("transactions"), S.store.list("templates")]);
  const templates = Object.fromEntries(tpls.map(t => [t.key, t]));
  const payments = txs.filter(t => t.car_id === h.car_id && [...IN_TYPES, "refund"].includes(t.type)).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const paid = payments.reduce((s, t) => s + (t.type === "refund" ? -1 : 1) * Number(t.amount), 0);
  const balance = Math.round(((Number(h.price) || 0) - (Number(h.px_value) || 0) - paid) * 100) / 100;
  const used = ["tcs", "next_steps", ...(h.sale_type !== "on_premises" ? ["distance_rights"] : []), ...(h.warranty === "included" ? ["warranty"] : [])];
  const draft = used.some(k => !templates[k] || templates[k].status !== "approved");
  const sigImages = {}; for (const r of ["customer", "staff"]) { const s = h.signatures?.[r]; if (s?.path) { const b = await S.store.fileBlob(s.path); if (b) sigImages[r] = await blobToDataURL(b); } }
  const no = invoiceNo || "Not issued yet";
  const v = version || h.version;
  return { biz: S.settings, car, customer: customer || {}, h, payments, paid, balance, templates, used, draft, sigImages, checklistItems: CHECKLIST, ackText: ACK, invoiceNo: no, issuedAt: issuedAt || nowIso(), ref: preview ? "PREVIEW" : `Invoice ${no}`, versionLabel: `${no} · v${v} · terms v${templates.tcs ? templates.tcs.version : "?"}` };
}
const blobToDataURL = b => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });

function packFlags(ctx) {
  const f = []; const b = ctx.biz;
  const drafts = ctx.used.filter(k => ctx.templates[k]?.status !== "approved");
  if (drafts.length) f.push({ block: true, text: `<b>Wording not approved:</b> ${drafts.map(k => esc(ctx.templates[k]?.title || k)).join(", ")}. Read it in the preview, check it with your adviser, then approve.`, fix: `<div class="btns">${drafts.map(k => `<button class="btn" data-approve="${k}">Approve ${esc((ctx.templates[k]?.title || k).split(" ")[0].toLowerCase())}…</button>`).join("")}</div><a class="small" href="#admin/wording">Edit wording in Admin</a>` });
  if (!b.legal_name) f.push({ block: true, text: "<b>Owner's name missing.</b> As a sole trader using a trading name, your own full name must be on the order form. Add it in Admin > Business details.", fix: `<a class="btn" href="#admin/business">Open business details</a>` });
  if (!b.invoice_address) f.push({ block: true, text: "<b>Address missing.</b> The order form must show an address where legal documents can be sent to you.", fix: `<a class="btn" href="#admin/business">Open business details</a>` });
  if (!ctx.customer.name || !ctx.customer.address) f.push({ block: true, text: "<b>Customer name and address needed.</b>", fix: `<a class="btn" href="#handover/${ctx.h.id}/customer">Add customer</a>` });
  if (!ctx.h.signatures?.customer) f.push({ block: false, text: "The customer hasn't signed the acknowledgement. You can still send, and the pack will say it wasn't signed." });
  if (ctx.balance > 0) f.push({ block: false, text: `A balance of <b>${money2(ctx.balance)}</b> is still owed. It will show on the invoice and in Money.` });
  if (ctx.balance < 0) f.push({ block: true, text: `Payments are ${money2(-ctx.balance)} more than the price. Check the price and payments.` });
  const missing = CHECKLIST.filter(it => !ctx.h.checklist?.[it.key]); if (missing.length) f.push({ block: false, text: `${missing.length} checklist item${missing.length > 1 ? "s" : ""} not ticked. They'll show as "No" in the pack.` });
  if (ctx.h.sale_type !== "on_premises") f.push({ block: false, text: "Remote or off-site sale: the buyer may have a 14-day right to cancel. Make sure the cancellation wording and model form are approved by your adviser." });
  if (b.vat_treatment !== "not_registered" && !b.vat_number && b.vat_treatment === "standard") f.push({ block: true, text: "VAT is set to standard rate but there's no VAT number.", fix: `<a class="btn" href="#admin/business">Fix in Admin</a>` });
  return f;
}

async function approveTemplate(key) {
  const t = (await S.store.list("templates")).find(x => x.key === key); if (!t) return;
  if (!confirm(`Approve "${t.title}" (version ${t.version})?\n\nOnly approve wording you or your adviser have checked. Your name and the time are recorded.`)) return;
  await S.store.update("templates", t.id, { status: "approved", approved_by: S.user.email, approved_at: nowIso() });
  await audit("template_approved", { key, version: t.version }); toast("Approved");
}

// Issues the pack exactly once. Retries reuse the same invoice number and the saved files.
async function issuePack(hid, via) {
  let h = await S.store.get("handovers", hid);
  if (h.status !== "draft") { location.hash = `#handover/${hid}`; return; }
  if (h.issuing) throw new Error("This pack is already being issued. Wait a moment, then open it from Today.");
  await S.store.update("handovers", hid, { issuing: true });
  try {
    const invoiceNo = h.invoice_number || await S.store.nextInvoiceNumber();
    if (!h.invoice_number) await S.store.update("handovers", hid, { invoice_number: invoiceNo });
    h = await S.store.get("handovers", hid);
    const issuedAt = nowIso();
    const ctx = await packContext(h, { invoiceNo, issuedAt });
    if (ctx.draft) throw new Error("Some wording isn't approved yet.");
    const reg = ctx.car.reg.replace(/ /g, ""); const base = `handovers/${hid}/v${h.version}`;
    const files = [];
    const all = await buildPdf(ctx, DOCS.map(d => d.key)); const allName = `${invoiceNo}-${reg}-handover-pack.pdf`;
    files.push({ name: allName, path: `${base}/${allName}`, hash: await sha256(all), kind: "combined" }); await S.store.putFile(files[0].path, all);
    for (const d of DOCS) { const b = await buildPdf(ctx, [d.key]); const n = `${invoiceNo}-${reg}-${d.key.replace("_", "-")}.pdf`; files.push({ name: n, path: `${base}/${n}`, hash: await sha256(b), kind: d.key }); await S.store.putFile(`${base}/${n}`, b); }
    const issue = await S.store.insert("issues", { kind: "invoice", number: invoiceNo, handover_id: hid, car_id: h.car_id, customer_id: h.customer_id, price: Number(h.price), version: h.version, issued_by: S.user.email, issued_at: issuedAt, files, templates: Object.fromEntries(ctx.used.map(k => [k, ctx.templates[k].version])), signatures: h.signatures, delivery_status: "prepared", recipient: ctx.customer.email || "" });
    // Record the sale
    await S.store.update("cars", h.car_id, { status: "sold", sold_price: Number(h.price), sold_date: issuedAt.slice(0, 10), px_value: Number(h.px_value) || 0, customer_id: h.customer_id, invoice_number: invoiceNo });
    if (h.lead_id) await S.store.update("leads", h.lead_id, { stage: "sold" }).catch(() => { });
    if (Number(h.px_value) && h.px_reg) { const px = await S.store.insert("cars", { reg: h.px_reg, make: (h.px_desc || "").split(" ").slice(1, 2).join(" "), model: (h.px_desc || "").split(" ").slice(2).join(" "), variant: h.px_desc, status: "preparing", purchase_date: issuedAt.slice(0, 10), keys: 1, known_faults: "", added_by: S.user.email, from_px_of: invoiceNo }); await S.store.insert("transactions", { car_id: px.id, type: "purchase", amount: Number(h.px_value), date: issuedAt.slice(0, 10), method: "part_exchange", note: `Part exchange against ${invoiceNo}`, by: S.user.email }); }
    await S.store.update("handovers", hid, { status: "prepared", issue_id: issue.id, issuing: false, issued_at: issuedAt });
    await audit("pack_issued", { handover_id: hid, number: invoiceNo, hash: files[0].hash });
    await deliver(hid, issue.id, via);
  } catch (e) { await S.store.update("handovers", hid, { issuing: false }); throw e; }
  location.hash = `#handover/${hid}`; render();
}

async function deliver(hid, issueId, via) {
  const issue = await S.store.get("issues", issueId);
  const log = async (status, detail) => { await S.store.insert("audit", { action: "pack_delivery", issue_id: issueId, via, status, detail: detail || "", by: S.user.email, at: nowIso() }); await S.store.update("handovers", hid, { status }); };
  // Issued records are permanent; delivery status is tracked on the handover and in the audit log.
  try {
    if (via === "email") { await S.store.invoke("send-pack", { issue_id: issueId }); await log("sent", "email"); toast("Pack emailed"); return; }
    const blobs = []; for (const f of issue.files) { const b = await S.store.fileBlob(f.path); if (b) blobs.push(new File([b], f.name, { type: "application/pdf" })); }
    if (navigator.canShare && navigator.canShare({ files: blobs })) {
      try { await navigator.share({ files: blobs, title: `Your documents: ${issue.number}` }); await log("sent", "share sheet"); toast("Shared"); }
      catch (e) { if (e.name === "AbortError") { await log("prepared", "share cancelled"); toast("Share cancelled. The pack is saved; send it when ready."); } else throw e; }
    } else { for (const f of blobs) await saveOrShare(f, f.name); await log("sent", "downloaded"); toast("Pack saved to this device"); }
  } catch (e) { await log("failed", e.message); toast("Sending failed: " + e.message, true); }
}

async function handoverDone(h) {
  const [issues, car, cust, auditL] = await Promise.all([S.store.list("issues"), S.store.get("cars", h.car_id), S.store.get("customers", h.customer_id), S.store.list("audit")]);
  const mine = issues.filter(i => i.handover_id === h.id).sort((a, b) => a.issued_at.localeCompare(b.issued_at));
  const cur = mine.find(i => i.id === h.issue_id) || mine[mine.length - 1];
  const deliveries = auditL.filter(a => a.action === "pack_delivery" && mine.some(i => i.id === a.issue_id)).sort((a, b) => b.at.localeCompare(a.at));
  return {
    title: cur ? cur.number : "Handover", back: "#today",
    html: `<section class="panel"><div class="row between"><h1>${esc(cur?.number || "")}</h1><span class="tag ${h.status}">${{ prepared: "Prepared, not sent", sent: "Sent", failed: "Failed", corrected: "Corrected" }[h.status] || h.status}</span></div>
      <p>${esc(cust?.name || "")} · <span class="plate">${esc(car?.reg || "")}</span> ${esc(carTitle(car))}</p>
      <p class="muted">Issued ${fmtDT(cur?.issued_at)} by ${esc(nameOf(cur?.issued_by))} · price ${money2(cur?.price)}</p>
      ${h.status !== "corrected" ? `<div class="btns"><button class="btn primary" data-via="share">${h.status === "sent" ? "Share again" : "Send now"}</button>${S.live && S.settings.email_enabled && cust?.email ? `<button class="btn" data-via="email">Email</button>` : `<span></span>`}</div>
      <p class="muted">Sending again uses the exact same saved files. No new invoice is made.</p>` : ""}
    </section>
    ${mine.map(i => `<section class="panel"><div class="row between"><h2>${i.kind === "credit_note" ? "Credit note" : "Invoice"} ${esc(i.number)}</h2><span class="muted">v${i.version}</span></div>
      <div class="list" style="margin:0 -16px">${i.files.map((f, k) => `<button data-file="${i.id}:${k}"><div class="grow"><div class="t">${esc(f.kind === "combined" ? "Full pack (combined PDF)" : (DOCS.find(d => d.key === f.kind)?.name || f.kind))}</div><div class="s" style="word-break:break-all">SHA-256 ${f.hash.slice(0, 16)}…</div></div><span class="chev">›</span></button>`).join("")}</div></section>`).join("")}
    <section class="panel"><h2>Delivery history</h2>${deliveries.map(d => `<div class="row between small"><span>${fmtDT(d.at)} · ${esc(d.via)} · ${esc(nameOf(d.by))}</span><span class="tag ${d.status}">${esc(d.status)}</span></div>`).join("") || `<p class="muted">Not sent yet.</p>`}</section>
    ${h.status !== "corrected" ? `<button class="btn danger block" id="correct">Correct this sale (credit note)</button><p class="muted">Use this if a price, name or detail was wrong. It cancels ${esc(cur?.number || "")} with a credit note and starts a revised pack with a new invoice number.</p>` : ""}`,
    mount() {
      $$("[data-via]").forEach(b => b.onclick = async () => { b.disabled = true; await deliver(h.id, cur.id, b.dataset.via); render(); });
      $$("[data-file]").forEach(b => b.onclick = async () => { const [iid, k] = b.dataset.file.split(":"); const f = mine.find(i => i.id === iid).files[k]; const blob = await S.store.fileBlob(f.path); if (!blob) return toast("File not found", true); const ok = (await sha256(blob)) === f.hash; if (!ok) return toast("This file doesn't match the issued copy", true); await saveOrShare(new File([blob], f.name, { type: "application/pdf" }), f.name); });
      const c = $("#correct"); if (c) c.onclick = () => correctSale(h, cur);
    },
  };
}

async function correctSale(h, inv) {
  sheet(`<h2>Correct ${esc(inv.number)}</h2><p class="small">A credit note cancels the original invoice in full. The car goes back to Reserved and a revised handover (version ${h.version + 1}) opens with the same details for you to fix and send with a new invoice number. Payments already taken stay recorded.</p>
    <label class="f">What was wrong?<textarea class="i" id="why" required></textarea></label>
    <button class="btn danger block" id="go">Issue credit note</button><button class="btn" data-close>Cancel</button>`, (el, close) => {
    $("#go", el).onclick = async () => {
      const reason = $("#why", el).value.trim(); if (!reason) return toast("Say what was wrong", true);
      $("#go", el).disabled = true;
      const num = "CN-" + (await S.store.nextInvoiceNumber()).replace(/^\D+-?/, "");
      const ctx = await packContext(h, { invoiceNo: inv.number, issuedAt: nowIso() }); ctx.creditNote = { number: num, cancels: inv.number, reason }; ctx.ref = `Credit note ${num}`; ctx.draft = false;
      const blob = await buildPdf(ctx, ["invoice"]); const name = `${num}-cancels-${inv.number}.pdf`; const path = `handovers/${h.id}/v${h.version}/${name}`;
      await S.store.putFile(path, blob);
      await S.store.insert("issues", { kind: "credit_note", number: num, cancels: inv.number, reason, handover_id: h.id, car_id: h.car_id, customer_id: h.customer_id, price: -Number(inv.price), version: h.version, issued_by: S.user.email, issued_at: nowIso(), files: [{ name, path, hash: await sha256(blob), kind: "credit_note" }], delivery_status: "prepared" });
      await S.store.update("handovers", h.id, { status: "corrected" });
      await S.store.update("cars", h.car_id, { status: "reserved", sold_price: null, sold_date: null, invoice_number: null });
      const nh = await S.store.insert("handovers", { ...Object.fromEntries(Object.entries(h).filter(([k]) => !["id", "created_at", "updated_at", "status", "issue_id", "invoice_number", "issued_at", "signatures", "issuing"].includes(k))), status: "draft", version: h.version + 1, revises: h.id, signatures: {} });
      await audit("credit_note", { number: num, cancels: inv.number, reason });
      close(); toast(`Credit note ${num} issued. Fix the details and send the revised pack.`); location.hash = `#handover/${nh.id}/price`;
    };
  });
}

/* ---------------- Admin ---------------- */
async function admin(section) {
  const tpls = (await S.store.list("templates")).filter(t => TEMPLATE_DEFAULTS.some(d => d.key === t.key)).sort((a, b) => TEMPLATE_DEFAULTS.findIndex(t => t.key === a.key) - TEMPLATE_DEFAULTS.findIndex(t => t.key === b.key));
  const b = S.settings;
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const open = k => section === k ? "open" : "";
  return {
    title: "Admin",
    html: `
    <section class="panel"><div class="row between"><div><h2>${esc(S.user.name)}</h2><p class="muted">${esc(S.user.email)} · ${S.live ? "Live" : "Sample mode"}</p></div><button class="btn" id="out">Sign out</button></div></section>

    <details class="panel" ${open("business")} id="business"><summary><h2 style="display:inline">Business details</h2></summary>
      <form id="biz" style="display:grid;gap:12px;margin-top:12px">
        ${[["trading_name", "Trading name"], ["legal_name", "Owner's full name (the law requires it on order forms and invoices)"], ["invoice_address", "Address for legal documents (required on order forms)", "textarea"], ["phone", "Phone"], ["whatsapp", "WhatsApp number (with 44)"], ["email", "Email"], ["viewing_location", "Viewing location"], ["website", "Website (when confirmed)"], ["company_number", "Company number (if limited)"], ["vat_number", "VAT number (if registered)"]].map(([k, l, t]) => `<label class="f">${l}${t === "textarea" ? `<textarea class="i" name="${k}" style="min-height:72px">${esc(b[k])}</textarea>` : `<input class="i" name="${k}" value="${esc(b[k])}">`}</label>`).join("")}
        <label class="f">VAT<select class="i" name="vat_treatment"><option value="not_registered" ${b.vat_treatment === "not_registered" ? "selected" : ""}>Not VAT registered</option><option value="margin_scheme" ${b.vat_treatment === "margin_scheme" ? "selected" : ""}>Registered, second-hand margin scheme</option><option value="standard" ${b.vat_treatment === "standard" ? "selected" : ""}>Registered, standard VAT</option></select><span class="hint">Ask your accountant which applies.</span></label>
        <div class="btns"><label class="f">Invoice prefix<input class="i" name="invoice_prefix" value="${esc(b.invoice_prefix)}"></label><label class="f">Goodwill look-over (days)<input class="i" name="aftercare_days" type="number" value="${esc(b.aftercare_days)}"></label></div>
        ${S.live ? "" : `<label class="f">Next invoice number<input class="i" name="next_invoice_number" type="number" value="${esc(b.next_invoice_number)}"></label>`}
        <button class="btn primary block">Save business details</button></form></details>

    <details class="panel" ${open("wording")} id="wording"><summary><h2 style="display:inline">Wording for the handover pack</h2></summary>
      <p class="muted" style="margin-top:12px">Nothing here has been checked by a lawyer. Each piece starts as a draft and packs can't be sent until the wording they use is approved. Editing approved wording makes a new draft version.</p>
      <div class="list" style="margin:0 -16px">${tpls.map(t => `<button data-tpl="${t.id}"><div class="grow"><div class="t">${esc(t.title)}</div><div class="s">Version ${t.version}${t.approved_at ? ` · approved by ${esc(nameOf(t.approved_by))} ${fmtDate(t.approved_at)}` : ""}</div></div><span class="tag ${t.status === "approved" ? "sent" : "draft"}">${t.status === "approved" ? "Approved" : "Draft"}</span></button>`).join("")}</div></details>

    <details class="panel" ${open("team")}><summary><h2 style="display:inline">Team</h2></summary>
      ${S.mode === "github" ? `<div style="margin-top:12px;display:grid;gap:12px">
        <div class="list" style="margin:0 -16px">${S.team.map((t, i) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid var(--line)"><div class="grow"><div class="t">${esc(t.name)}</div><div class="s">GitHub: ${esc(t.email)}${t.email.toLowerCase() === CONFIG.GITHUB.owner.toLowerCase() ? " · owner" : t.invited ? ` · invited ${fmtDate(t.invited)}` : ""}</div></div>${t.email.toLowerCase() === CONFIG.GITHUB.owner.toLowerCase() || t.email.toLowerCase() === S.user.email.toLowerCase() ? "" : `<button class="btn danger" data-rm="${i}" style="min-height:40px">Remove</button>`}</div>`).join("")}</div>
        ${S.user.email.toLowerCase() === CONFIG.GITHUB.owner.toLowerCase() ? `<form id="addstaff" style="display:grid;gap:12px"><h3 style="margin:8px 0 0">Add a staff member</h3>
          <p class="muted" style="margin:0">They need a free GitHub account first (github.com/signup). Then put their name and GitHub username here. They'll get an email invitation from GitHub to accept, and after that they sign in at motorwisehereford.co.uk/desk.</p>
          <div class="btns"><label class="f">Name<input class="i" name="name" required placeholder="Tom"></label><label class="f">GitHub username<input class="i" name="login" required autocapitalize="off" autocomplete="off" placeholder="e.g. tom-smith"></label></div>
          <button class="btn primary block">Invite</button></form>` : `<p class="muted">Only the owner can add or remove staff.</p>`}
        <p class="muted" style="margin:0">Staff can see and edit everything in the Desk, including the accounts, and publish cars to the website.</p></div>`
      : S.live ? `<div style="margin-top:12px">${S.team.map(t => `<p>${esc(t.name)} · <span class="muted">${esc(t.email)}</span></p>`).join("")}<p class="muted">Add or remove people in Supabase (see SETUP.md, step 3).</p></div>`
        : `<form id="team" style="display:grid;gap:12px;margin-top:12px">${S.team.map((t, i) => `<div class="btns"><label class="f">Name<input class="i" name="n${i}" value="${esc(t.name)}"></label><label class="f">Email<input class="i" name="e${i}" value="${esc(t.email)}"></label></div>`).join("")}<button class="btn block">Save names</button></form>`}</details>

    <details class="panel" ${open("notify")} ${section === "notify" ? "open" : ""}><summary><h2 style="display:inline">Notifications</h2></summary>
      <div style="display:grid;gap:12px;margin-top:12px">
      ${iOS && !standalone ? `<div class="flag red">On iPhone, notifications only work once Motorwise Desk is added to your Home Screen and opened from there. See "Install on iPhone" below.</div>` : ""}
      <p>Status on this phone: <b>${{ granted: "On", denied: "Blocked in Settings", default: "Not turned on yet", unsupported: "Not supported here" }[perm]}</b></p>
      <p class="muted">What you'll get: both of you for new enquiries nobody has picked up; only the assigned person for their follow-ups and viewings. Lock-screen alerts never show customer names or numbers.</p>
      ${!S.live || !CONFIG.VAPID_PUBLIC_KEY ? `<p class="muted">Background alerts (when the app is closed) need the live setup. In sample mode you can test that this phone shows alerts.</p>` : ""}
      <div class="btns"><button class="btn primary" id="nperm" ${perm === "granted" || perm === "unsupported" ? "disabled" : ""}>Turn on</button><button class="btn" id="ntest" ${perm !== "granted" ? "disabled" : ""}>Send test</button></div></div></details>

    <details class="panel" ${open("install")}><summary><h2 style="display:inline">Install on iPhone</h2></summary>
      <ol style="margin:12px 0 0;padding-left:20px;display:grid;gap:6px">
        <li>Open the Motorwise Desk link in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (square with an arrow).</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open it from the new icon and sign in.</li><li>Go to Admin > Notifications, tap <b>Turn on</b>, then <b>Allow</b>, then <b>Send test</b>.</li></ol>
      <p class="muted">${standalone ? "You're using the installed app." : "You're in the browser, not the installed app."}</p></details>

    <details class="panel" ${open("data")}><summary><h2 style="display:inline">Reports, exports and backups</h2></summary>
      <div style="display:grid;gap:8px;margin-top:12px">
      <button class="btn" id="exp">Accountant exports (CSV)</button>
      <button class="btn" id="bak">Download full backup (records)</button>
      ${S.live ? `<p class="muted">Photos, receipts and issued PDFs are stored in Supabase. Supabase also keeps daily database backups on paid plans; on the free plan, download a backup here weekly.</p>` : `<label class="btn">Restore a backup<input type="file" accept="application/json" id="restore" hidden></label><button class="btn danger" id="reset">Reset sample data</button>`}
      </div></details>

    <details class="panel" ${open("services")}><summary><h2 style="display:inline">Connected services</h2></summary>
      <div style="display:grid;gap:8px;margin-top:12px">
      ${[["Shared data and sign-in (Supabase)", S.live], ["Notifications when the app is closed", S.live && !!CONFIG.VAPID_PUBLIC_KEY], ["Email the pack (Resend + your domain)", S.live && !!b.email_enabled], ["Vehicle lookup (DVLA)", S.live && !!b.lookup_enabled], ["Automatic WhatsApp import", false]].map(([l, on]) => `<div class="row between"><span>${l}</span><span class="tag ${on ? "sent" : ""}">${on ? "On" : "Not set up"}</span></div>`).join("")}
      ${S.live ? `<label class="row"><input type="checkbox" id="em" ${b.email_enabled ? "checked" : ""}> Email sending is set up</label><label class="row"><input type="checkbox" id="lk" ${b.lookup_enabled ? "checked" : ""}> Vehicle lookup is set up</label>` : ""}
      <p class="muted">WhatsApp messages are logged by pasting them into a lead. Automatic import needs the WhatsApp Business Platform (a separate number and a Meta business account).</p></div></details>
    <p class="muted" style="text-align:center">Motorwise Desk · ${S.live ? "Live" : "Sample mode"}</p>`,
    mount() {
      const as = $("#addstaff"); if (as) as.onsubmit = async e => {
        e.preventDefault(); const d = formData(e.target); const login = String(d.login || "").trim().replace(/^@/, "");
        if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return toast("That isn't a valid GitHub username", true);
        if (S.team.some(t => t.email.toLowerCase() === login.toLowerCase())) return toast("They're already on the team", true);
        const b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Inviting…";
        try {
          await S.store.inviteStaff(login);
          const team = [...S.team, { name: d.name.trim(), email: login, invited: new Date().toISOString() }];
          await S.store.update("settings", S.settings.id, { team }); await S.store.flush();
          await audit("staff_invited", { login }); toast(`Invited ${d.name}. Ask them to accept the GitHub email, then sign in at /desk.`); render();
        } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = "Invite"; }
      };
      $$("[data-rm]").forEach(btn => btn.onclick = async () => {
        const t = S.team[Number(btn.dataset.rm)]; if (!confirm(`Remove ${t.name}? They'll lose access to the Desk and the website admin straight away.`)) return;
        try { await S.store.removeStaff(t.email); await S.store.update("settings", S.settings.id, { team: S.team.filter(x => x !== t) }); await S.store.flush(); await audit("staff_removed", { login: t.email }); toast(`${t.name} removed`); render(); }
        catch (err) { toast(err.message, true); }
      });
      $("#out").onclick = async () => { await S.store.signOut(); S.user = null; location.hash = ""; render(); };
      $("#biz").onsubmit = async e => { e.preventDefault(); await S.store.update("settings", b.id, formData(e.target)); toast("Saved"); render(); };
      const tf = $("#team"); if (tf) tf.onsubmit = async e => { e.preventDefault(); const d = formData(e.target); const team = S.team.map((t, i) => ({ name: d["n" + i] || t.name, email: (d["e" + i] || t.email).toLowerCase() })); await S.store.update("settings", b.id, { team }); toast("Saved"); render(); };
      $$("[data-tpl]").forEach(x => x.onclick = () => templateSheet(tpls.find(t => t.id === x.dataset.tpl)));
      $("#nperm").onclick = async () => { const p = await Notification.requestPermission(); if (p === "granted") { await subscribePush(); toast("Notifications on"); } else toast("Notifications were not allowed. Change it in iPhone Settings > Notifications > MW Desk.", true); render(); };
      $("#ntest").onclick = async () => {
        if (S.live && CONFIG.VAPID_PUBLIC_KEY) { try { await S.store.invoke("notify", { type: "test", email: S.user.email }); toast("Test sent. It should arrive in a few seconds."); } catch (e) { toast("Test failed: " + e.message, true); } return; }
        const reg = await navigator.serviceWorker?.getRegistration(); if (reg) reg.showNotification("Test notification", { body: "Notifications are working.", icon: "icons/icon-192.png", badge: "icons/icon-192.png" }); else new Notification("Test notification", { body: "Notifications are working." });
        toast("Test shown on this phone");
      };
      $("#exp").onclick = exportSheet;
      $("#bak").onclick = async () => { const out = { app: "motorwise-desk", exported_at: nowIso(), mode: S.live ? "live" : "sample" }; for (const t of ["cars", "photos", "leads", "viewings", "transactions", "customers", "handovers", "issues", "templates", "settings", "audit"]) out[t] = await S.store.list(t); await downloadText(JSON.stringify(out, null, 1), `motorwise-desk-backup-${todayISO()}.json`, "application/json"); };
      const rs = $("#restore"); if (rs) rs.onchange = async e => { const data = JSON.parse(await e.target.files[0].text()); if (data.app !== "motorwise-desk") return toast("That isn't a Motorwise Desk backup", true); if (!confirm("Replace the sample data on this phone with this backup?")) return; await S.store.wipe(); for (const [t, rows] of Object.entries(data)) if (Array.isArray(rows)) for (const r of rows) await S.store.insert(t, r); toast("Restored"); render(); };
      const rz = $("#reset"); if (rz) rz.onclick = async () => { if (!confirm("Delete all sample data on this phone and start again?")) return; await S.store.wipe(); await seedSample(S.store); toast("Sample data reset"); render(); };
      const em = $("#em"); if (em) em.onchange = async () => { await S.store.update("settings", b.id, { email_enabled: em.checked }); render(); };
      const lk = $("#lk"); if (lk) lk.onchange = async () => { await S.store.update("settings", b.id, { lookup_enabled: lk.checked }); render(); };
    },
  };
}

function templateSheet(t) {
  sheet(`<h2>${esc(t.title)}</h2><p class="muted">Version ${t.version} · ${t.status === "approved" ? `approved by ${esc(nameOf(t.approved_by))} ${fmtDate(t.approved_at)}` : "draft"}. Placeholders like {phone} are filled from Business details.</p>
    <textarea class="i" id="body" style="min-height:280px">${esc(t.body)}</textarea>
    <button class="btn" id="save">Save as new draft</button>
    ${t.status !== "approved" ? `<button class="btn primary" id="appr">Approve this version</button>` : ""}
    <button class="btn" data-close>Close</button>`, (el, close) => {
    $("#save", el).onclick = async () => { const body = $("#body", el).value; if (body === t.body) return close(); await S.store.update("templates", t.id, { body, version: (t.version || 1) + 1, status: "draft", approved_by: null, approved_at: null }); await audit("template_edited", { key: t.key, version: (t.version || 1) + 1 }); close(); toast("Saved as a new draft"); render(); };
    const a = $("#appr", el); if (a) a.onclick = async () => { close(); await approveTemplate(t.key); render(); };
  });
}

async function subscribePush() {
  if (!S.live || !CONFIG.VAPID_PUBLIC_KEY || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(CONFIG.VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - CONFIG.VAPID_PUBLIC_KEY.length % 4) % 4)), c => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await S.store.savePush(sub, S.user);
}

boot();
