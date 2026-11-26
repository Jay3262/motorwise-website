// Small UI helpers shared by every screen.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const money = (n, dp = 0) => (n < 0 ? "−" : "") + "£" + Math.abs(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const money2 = (n) => money(n, 2);
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? iso + "T12:00" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
export const fmtDay = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";
export const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
export const fmtDT = (iso) => iso ? `${fmtDay(iso)}, ${fmtTime(iso)}` : "";
export const localDT = (d = new Date()) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
export const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
export const plateFmt = (s) => { const t = String(s || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim(); const n = t.replace(/ /g, ""); return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(n) ? n.slice(0, 4) + " " + n.slice(4) : t; };
export const telHref = (p) => "tel:" + String(p || "").replace(/[^\d+]/g, "");
export const waHref = (p, text = "") => { let n = String(p || "").replace(/\D/g, ""); if (n.startsWith("0")) n = "44" + n.slice(1); return `https://wa.me/${n}${text ? "?text=" + encodeURIComponent(text) : ""}`; };

export const I = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M8 14l2.5 2.5L16 12"/></svg>',
  cars: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M3 17v-5l2-5h14l2 5v5"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M3 12h18"/></svg>',
  leads: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 6.5A5 5 0 0 0 9 10v9"/><path d="M6 13h8M6 19h12"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  addcar: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h13M3 15v-5l2-4h9"/><circle cx="7" cy="15" r="2"/><path d="M19 5v8M15 9h8"/></svg>',
  addlead: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>',
  viewing: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4M12 13v4M10 15h4"/></svg>',
  handover: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};

let toastTimer;
export function toast(msg, err = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "toast" + (err ? " err" : ""); t.setAttribute("role", err ? "alert" : "status"); t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), err ? 6000 : 3000);
}

export function sheet(html, mount) {
  const el = document.createElement("div"); el.className = "sheet"; el.innerHTML = `<div role="dialog" aria-modal="true">${html}</div>`;
  const close = () => el.remove();
  el.addEventListener("click", e => { if (e.target === el || e.target.closest("[data-close]")) close(); });
  document.body.appendChild(el); mount && mount(el.firstElementChild, close);
  const f = el.querySelector("input,select,textarea,button"); f && f.focus({ preventScroll: true });
  return close;
}

export function formData(form) {
  const o = {}; for (const el of form.elements) { if (!el.name) continue; if (el.type === "checkbox") o[el.name] = el.checked; else if (el.type === "number") o[el.name] = el.value === "" ? null : Number(el.value); else o[el.name] = el.value.trim(); } return o;
}

export async function saveOrShare(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: title || name }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return "downloaded";
}

// Image processing: keep the original, make a listing copy (max 1600px) and a thumbnail (400px).
export async function resizeImage(file, max, q = 0.82) {
  const bmp = await (window.createImageBitmap ? createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null) : null) || await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
  const w = bmp.width, h = bmp.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", q));
}

export function signaturePad(canvas) {
  const ctx = canvas.getContext("2d"); let drawing = false, dirty = false, last;
  const fit = () => { const r = canvas.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = r.width * dpr; canvas.height = r.height * dpr; ctx.scale(dpr, dpr); ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#101F32"; };
  fit();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener("pointerdown", e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke(); last = p; dirty = true; });
  const end = () => { drawing = false; }; canvas.addEventListener("pointerup", end); canvas.addEventListener("pointercancel", end);
  return { clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; }, isEmpty: () => !dirty, toBlob: () => new Promise(r => canvas.toBlob(r, "image/png")), toDataURL: () => canvas.toDataURL("image/png") };
}

export function downloadText(text, name, type = "text/csv") { return saveOrShare(new Blob([text], { type }), name); }
export function csv(rows) { return rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\r\n"); }
