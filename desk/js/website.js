// Website publishing: turns a Desk car into a listing on motorwisehereford.co.uk.
// The listing lives in the website repo as data/stock.json + images/stock/<reg>/<photo>.jpg.
// One commit per publish; Netlify puts it live about 30 seconds later.
import { resizeImage } from "./ui.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = iso => { if (!iso) return null; const d = new Date(iso + "T12:00"); return isNaN(d) ? null : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const lines = t => String(t || "").split(/\r?\n|;/).map(x => x.replace(/^[-•*\s]+/, "").trim()).filter(Boolean);
const slugReg = reg => String(reg || "").replace(/\s+/g, "").toLowerCase() || "car";
const plateAge = reg => { const m = String(reg || "").replace(/\s/g, "").toUpperCase().match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/); return m ? m[1] : null; };
const regText = c => { const a = plateAge(c.reg); return c.year ? `${c.year}${a ? ` (${a})` : ""}` : (a ? `(${a})` : ""); };
const num = v => (v === "" || v == null || isNaN(Number(v))) ? null : Number(v);

// A plain, honest description built only from what has been entered.
export function writeUp(c) {
  const title = [c.year, c.make, c.model].filter(Boolean).join(" ");
  const bits = [];
  const spec = [c.variant, c.colour ? `in ${c.colour.toLowerCase()}` : ""].filter(Boolean).join(" ");
  const miles = num(c.mileage) != null ? `${c.mileage_approx ? "about " : ""}${Number(c.mileage).toLocaleString("en-GB")} miles` : "";
  const gear = c.gearbox ? `a ${c.gearbox.toLowerCase()} gearbox` : "";
  bits.push(`A ${title}${spec ? " " + spec : ""}${miles || gear ? ", with " + [miles, gear].filter(Boolean).join(" and ") : ""}.`);
  const eq = lines(c.equipment);
  if (eq.length) bits.push(`It comes with ${eq.length > 1 ? eq.slice(0, -1).join(", ").toLowerCase() + " and " + eq.slice(-1)[0].toLowerCase() : eq[0].toLowerCase()}.`);
  if (c.mot_expiry) bits.push(`MOT until ${longDate(c.mot_expiry)}.`);
  if (c.service_history) bits.push(`Service history: ${String(c.service_history).replace(/\.$/, "").toLowerCase()}.`);
  bits.push(lines(c.known_faults).length ? "Every fault we know about is listed below, so there are no surprises." : "Come and have a look, or ask us anything you'd like checked first.");
  bits.push("Viewings by appointment on Ramsden Road, Hereford.");
  return bits.join(" ");
}

export function siteEntry(c, photoPaths) {
  const status = c.status === "reserved" ? "reserved" : c.status === "sold" ? "sold" : "available";
  const e = {
    id: c.stock_id, status, plate: c.reg || undefined, make: c.make, model: c.model, trim: c.variant || "",
    year: num(c.year), reg: regText(c), price: num(c.asking_price), mileage: num(c.mileage), mileageApprox: !!c.mileage_approx,
    fuel: c.fuel || undefined, trans: c.gearbox || undefined, engine: c.engine || undefined, engineCc: num(c.engine_cc) || undefined,
    colour: c.colour || undefined, body: c.body || undefined, doors: num(c.doors) || undefined,
    motFull: longDate(c.mot_expiry) || undefined, motNotes: c.mot_notes || undefined,
    desc: c.description || writeUp(c), equip: lines(c.equipment), issues: lines(c.known_faults),
    photos: photoPaths.map(p => "/" + p), featured: !!c.web_featured, valetPreview: !!c.valet_preview || undefined,
    added: (c.published_at || new Date().toISOString()).slice(0, 10),
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

export function nextStockId(siteCars, deskCars) {
  const n = [...siteCars.map(c => c.id), ...deskCars.map(c => c.stock_id)].map(id => Number(String(id || "").replace(/\D/g, ""))).filter(Boolean);
  return "MW" + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
}

// Publish or update. Returns the patch to save on the car.
export async function publishCar(store, c, photos, deskCars, { remove = false } = {}) {
  const stock = await store.readSiteStock();
  const cars = stock.cars || [];
  const stockId = c.stock_id || nextStockId(cars, deskCars);
  const folder = `images/stock/${slugReg(c.reg)}`;
  const files = {}; const paths = []; const photoPatch = [];
  if (!remove) for (const p of photos) {
    let path = p.web_path;
    if (!path) {
      const blob = await store.fileBlob(p.listing_path); if (!blob) continue;
      path = `${folder}/${p.id.slice(0, 12)}.jpg`; files[path] = blob; photoPatch.push([p.id, path]);
    }
    paths.push(path);
  }
  for (const old of c.web_paths || []) if (!paths.includes(old)) files[old] = null;
  const others = cars.filter(x => x.id !== stockId);
  const next = remove ? others : [siteEntry({ ...c, stock_id: stockId }, paths), ...others];
  files["data/stock.json"] = JSON.stringify({ cars: next }, null, 2) + "\n";
  await store.commitSite(files, `Stock: ${remove ? "remove" : c.stock_id ? "update" : "publish"} ${c.reg || stockId}`);
  return { stockId, paths: remove ? [] : paths, photoPatch };
}

// Bring the cars already on the website into the Desk (first run).
export async function importFromSite(store, siteUrl, progress = () => { }, { skipIds = [] } = {}) {
  const stock = await store.readSiteStock(); const made = [];
  const todo = (stock.cars || []).filter(e => !skipIds.includes(e.id));
  const inv = { Manual: "Manual", Automatic: "Automatic" };
  for (const [ci, e] of todo.entries()) {
    const motIso = e.motFull ? (() => { const d = new Date(e.motFull + " 12:00"); return isNaN(d) ? null : d.toISOString().slice(0, 10); })() : null;
    const car = await store.insert("cars", {
      reg: e.plate || "", make: e.make, model: e.model, variant: e.trim || "", year: e.year, colour: e.colour || "", fuel: e.fuel || "", gearbox: inv[e.trans] || e.trans || "",
      mileage: e.mileage, mileage_approx: !!e.mileageApprox, mot_expiry: motIso, mot_notes: e.motNotes || "", asking_price: e.price, engine: e.engine || "", engine_cc: e.engineCc || null,
      body: e.body || "", doors: e.doors || null, equipment: (e.equip || []).join("\n"), known_faults: (e.issues || []).join("\n"), description: e.desc || "",
      status: e.status === "sold" ? "sold" : e.status === "reserved" ? "reserved" : "available", stock_id: e.id, published: e.status !== "sold", published_at: (e.added || "") + "T12:00:00Z",
      web_paths: (e.photos || []).map(p => p.replace(/^\//, "")), web_featured: !!e.featured, valet_preview: !!e.valetPreview, keys: 1, purchase_date: e.added || null,
    });
    for (const [i, src] of (e.photos || []).entries()) {
      progress(`Copying photos for ${e.make} ${e.model} (${i + 1} of ${e.photos.length})`);
      const r = await fetch(src).catch(() => null) || await fetch(siteUrl.replace(/\/$/, "") + src).catch(() => null); if (!r || !r.ok) continue;
      const blob = await r.blob(); const pid = crypto.randomUUID(); const base = `cars/${car.id}/${pid}`;
      const thumb = await resizeImage(blob, 480, 0.75);
      await store.putFile(`${base}/listing.jpg`, blob); await store.putFile(`${base}/thumb.jpg`, thumb);
      await store.insert("photos", { id: pid, car_id: car.id, slot: i === 0 ? "exterior" : "other", order: i, original_path: `${base}/listing.jpg`, listing_path: `${base}/listing.jpg`, thumb_path: `${base}/thumb.jpg`, web_path: src.replace(/^\//, "") });
    }
    made.push(car); progress(`Imported ${ci + 1} of ${todo.length} cars`);
  }
  return made;
}
