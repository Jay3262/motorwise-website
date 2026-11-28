// Handover pack PDFs (jsPDF, bundled locally). Every document is built from the saved records only;
// nothing is invented. Wording comes from Admin > Wording, and anything not yet approved is marked DRAFT.
const { jsPDF } = window.jspdf;
const A4W = 210, M = 18, NAVY = [16, 31, 50], TEAL = [8, 124, 112], INK = [16, 31, 50], GREY = [74, 90, 107], RED = [179, 38, 30];
let FONT_DATA = null;

async function loadFonts() {
  if (FONT_DATA !== null) return FONT_DATA;
  try {
    const get = async (w) => { const res = await fetch(`fonts/AtkinsonHyperlegibleNext-${w}.ttf`); if (!res.ok) throw new Error("no font"); const b = await res.arrayBuffer(); let s = ""; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    FONT_DATA = { r: await get(400), b: await get(700) };
  } catch { FONT_DATA = false; }
  return FONT_DATA;
}
function useFonts(doc) {
  if (!FONT_DATA) return "helvetica";
  doc.addFileToVFS("ahn-r.ttf", FONT_DATA.r); doc.addFont("ahn-r.ttf", "AHN", "normal");
  doc.addFileToVFS("ahn-b.ttf", FONT_DATA.b); doc.addFont("ahn-b.ttf", "AHN", "bold");
  return "AHN";
}

export const money = (n) => "£" + (Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d8 = (iso) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
const dt = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
export const fill = (t, biz) => (t || "").replace(/\{(\w+)\}/g, (_, k) => biz[k] != null && biz[k] !== "" ? String(biz[k]).replace(/\s*\n\s*/g, ", ") : `[${k}]`);

class Writer {
  constructor(doc, font, ctx) { this.doc = doc; this.f = font; this.ctx = ctx; this.y = 0; }
  page(title) {
    const { doc, ctx } = this;
    if (this.started) doc.addPage(); this.started = true;
    doc.setFillColor(...NAVY); doc.rect(0, 0, A4W, 30, "F");
    doc.setTextColor(255, 255, 255); doc.setFont(this.f, "bold"); doc.setFontSize(15);
    doc.text(ctx.biz.trading_name || "", M, 13);
    doc.setFont(this.f, "normal"); doc.setFontSize(9.5);
    doc.text([ctx.biz.phone, ctx.biz.email].filter(Boolean).join("   "), M, 20);
    doc.setFont(this.f, "bold"); doc.setFontSize(13); doc.text(title, A4W - M, 13, { align: "right" });
    doc.setFont(this.f, "normal"); doc.setFontSize(9.5);
    doc.text(ctx.ref || "", A4W - M, 20, { align: "right" });
    this.y = 40;
    if (ctx.draft) {
      doc.setFillColor(251, 233, 231); doc.rect(M, 34, A4W - 2 * M, 9, "F");
      doc.setTextColor(...RED); doc.setFont(this.f, "bold"); doc.setFontSize(9.5);
      doc.text("DRAFT: some wording in this pack has not been approved yet. Do not issue.", M + 3, 39.8);
      this.y = 50;
    }
    this.title = title;
  }
  need(h) { if (this.y + h > 280) { this.page(this.title + " (continued)"); } }
  h(t, size = 12.5) { this.need(12); const { doc } = this; doc.setTextColor(...INK); doc.setFont(this.f, "bold"); doc.setFontSize(size); doc.text(t, M, this.y); this.y += size * 0.5 + 2.5; }
  p(t, { size = 10, color = INK, bold = false, indent = 0, gap = 2.5 } = {}) {
    const { doc } = this; doc.setFont(this.f, bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    for (const para of String(t || "").split("\n")) {
      const lines = doc.splitTextToSize(para || " ", A4W - 2 * M - indent);
      for (const ln of lines) { this.need(size * 0.45); doc.text(ln, M + indent, this.y); this.y += size * 0.45; }
      this.y += 1;
    }
    this.y += gap;
  }
  kv(rows, w = 52) {
    const { doc } = this;
    for (const [k, v] of rows) {
      if (v == null || v === "") continue;
      doc.setFontSize(10); const lines = doc.splitTextToSize(String(v), A4W - 2 * M - w);
      this.need(lines.length * 4.6 + 1.5);
      doc.setFont(this.f, "normal"); doc.setTextColor(...GREY); doc.text(k, M, this.y);
      doc.setFont(this.f, "bold"); doc.setTextColor(...INK); doc.text(lines, M + w, this.y);
      this.y += lines.length * 4.6 + 1.5;
    }
    this.y += 2;
  }
  table(head, rows, widths, alignRight = []) {
    const { doc } = this; const x0 = M; const tw = A4W - 2 * M;
    const xs = []; let acc = x0; for (const w of widths) { xs.push(acc); acc += w * tw; }
    const line = (cells, bold, fillC) => {
      doc.setFontSize(10); doc.setFont(this.f, bold ? "bold" : "normal");
      const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c ?? ""), widths[i] * tw - 3));
      const hgt = Math.max(...wrapped.map(w => w.length)) * 4.6 + 3;
      this.need(hgt + 1);
      if (fillC) { doc.setFillColor(...fillC); doc.rect(x0, this.y - 4.2, tw, hgt, "F"); }
      doc.setTextColor(...INK);
      wrapped.forEach((w, i) => { const right = alignRight.includes(i); doc.text(w, right ? xs[i] + widths[i] * tw - 1.5 : xs[i] + 1.5, this.y, right ? { align: "right" } : undefined); });
      this.y += hgt; doc.setDrawColor(220, 227, 231); doc.line(x0, this.y - 4.2, x0 + tw, this.y - 4.2);
    };
    line(head, true, [243, 246, 247]); for (const r of rows) line(r, !!r._bold);
    this.y += 3;
  }
  footer() {
    const { doc, ctx } = this; const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont(this.f, "normal"); doc.setFontSize(8.5); doc.setTextColor(...GREY);
      const left = [ctx.biz.legal_name ? `${ctx.biz.legal_name} trading as ${ctx.biz.trading_name}` : ctx.biz.trading_name, ctx.biz.invoice_address ? ctx.biz.invoice_address.replace(/\n/g, ", ") : "", ctx.biz.company_number ? "Company no. " + ctx.biz.company_number : "", ctx.biz.vat_number ? "VAT no. " + ctx.biz.vat_number : ""].filter(Boolean).join("  ·  ");
      doc.text(doc.splitTextToSize(left, 125)[0], 14, 290);
      doc.text(`${ctx.versionLabel || ""}   Page ${i} of ${n}`, A4W - 14, 290, { align: "right" });
    }
  }
}

function vehicleLine(c) { return [c.year, c.make, c.model, c.variant].filter(Boolean).join(" "); }
function sellerBlock(biz) { return [biz.legal_name || biz.trading_name, biz.legal_name && biz.legal_name !== biz.trading_name ? "trading as " + biz.trading_name : "", biz.invoice_address || "[invoice address to confirm]", biz.phone, biz.email].filter(Boolean).join("\n"); }
function customerBlock(cu) { return [cu.name, cu.address, cu.postcode, cu.phone, cu.email].filter(Boolean).join("\n"); }

function vatNote(biz, price) {
  if (biz.vat_treatment === "margin_scheme") return { rows: [], note: "Second-hand margin scheme: VAT is included in the price and is not shown separately. It cannot be reclaimed." };
  if (biz.vat_treatment === "standard") { const vat = Math.round(price / 6 * 100) / 100; return { rows: [["VAT at 20% included", money(vat)]], note: `VAT registration number ${biz.vat_number || "[to confirm]"}.` }; }
  return { rows: [], note: "The seller is not registered for VAT. No VAT is charged." };
}

const SECTIONS = {
  invoice(w, ctx) {
    const { biz, car, customer: cu, h } = ctx;
    w.page(ctx.creditNote ? "Credit note" : "Invoice");
    w.kv([[ctx.creditNote ? "Credit note no." : "Invoice no.", ctx.creditNote ? ctx.creditNote.number : ctx.invoiceNo], ["Date", d8(ctx.issuedAt)], ctx.creditNote ? ["Cancels invoice", ctx.creditNote.cancels] : ["Sale type", { on_premises: "At our premises", distance: "Distance sale (agreed remotely)", off_premises: "Off-premises" }[h.sale_type] || ""]]);
    w.h("From", 10.5); w.p(sellerBlock(biz)); w.h("To", 10.5); w.p(customerBlock(cu));
    const price = Number(h.price) || 0, px = Number(h.px_value) || 0;
    const rows = [[`${vehicleLine(car)}\nRegistration ${car.reg}${car.vin ? "\nVIN " + car.vin : ""}\nMileage at sale ${Number(h.mileage || car.mileage || 0).toLocaleString("en-GB")}`, money(ctx.creditNote ? -price : price)]];
    if (h.warranty === "included") rows.push(["Warranty as set out in the warranty terms in this pack", "Included"]);
    w.table(["Description", "Amount"], rows, [0.75, 0.25], [1]);
    const v = vatNote(biz, price);
    const tot = [["Total price", money(ctx.creditNote ? -price : price)], ...v.rows];
    if (!ctx.creditNote) {
      if (px) tot.push([`Part exchange: ${h.px_reg || ""}`.trim(), "− " + money(px)]);
      tot.push(["Paid", "− " + money(ctx.paid)]); tot.push(["Balance due", money(ctx.balance)]);
    }
    w.kv(tot.map(([a, b]) => [a, b]), 120);
    w.p(v.note, { size: 9, color: GREY });
    if (ctx.creditNote) w.p(`Reason: ${ctx.creditNote.reason || ""}`, { size: 10 });
    w.p("No admin, preparation or other fees have been added to this price.", { size: 9, color: GREY });
  },
  receipt(w, ctx) {
    w.page("Receipt");
    w.kv([["Invoice no.", ctx.invoiceNo], ["Customer", ctx.customer.name], ["Vehicle", `${vehicleLine(ctx.car)} (${ctx.car.reg})`]]);
    const rows = ctx.payments.map(p => [d8(p.date), { deposit: "Deposit", part_payment: "Part-payment", balance: "Balance", refund: "Refund" }[p.type] || p.type, { cash: "Cash", bank: "Bank transfer", card: "Card", other: "Other" }[p.method] || p.method || "", (p.type === "refund" ? "− " : "") + money(p.amount)]);
    if (Number(ctx.h.px_value)) rows.push([d8(ctx.issuedAt), "Part exchange " + (ctx.h.px_reg || ""), "Vehicle", money(ctx.h.px_value)]);
    w.table(["Date", "Payment", "Method", "Amount"], rows.length ? rows : [["", "No payments recorded", "", ""]], [0.25, 0.35, 0.2, 0.2], [3]);
    w.kv([["Total received", money(ctx.paid + (Number(ctx.h.px_value) || 0))], ["Balance due", money(ctx.balance)]], 120);
    w.p(ctx.balance > 0 ? "A balance is still due. Ownership and collection arrangements for the balance are as agreed with the seller." : "Paid in full. Thank you.", { bold: true });
  },
  vehicle(w, ctx) {
    const c = ctx.car, h = ctx.h;
    w.page("Vehicle summary");
    w.kv([["Registration", c.reg], ["Vehicle", vehicleLine(c)], ["VIN", c.vin], ["Colour", c.colour], ["Fuel", c.fuel], ["Gearbox", c.gearbox], ["Engine", c.engine], ["Mileage at sale", Number(h.mileage || c.mileage || 0).toLocaleString("en-GB") + (h.mileage ? "" : c.mileage_approx ? " (approx.)" : "")], ["MOT expires", d8(c.mot_expiry)], ["Keys supplied", h.keys ?? c.keys], ["Service history", c.service_history]]);
    w.h("Faults and condition points we told you about before the sale");
    w.p(h.faults_disclosed || c.known_faults || "None recorded.", { size: 10.5 });
    if (c.condition) { w.h("Condition notes", 11); w.p(c.condition); }
    w.p("Check the MOT history at GOV.UK using the registration number.", { size: 9, color: GREY });
  },
  checklist(w, ctx) {
    const h = ctx.h;
    w.page("Handover checklist");
    const items = ctx.checklistItems.map(it => [h.checklist && h.checklist[it.key] ? "Yes" : "No", it.label]);
    w.table(["Done", "Item"], items, [0.15, 0.85]);
    w.h("Acknowledgement", 11.5);
    w.p(ctx.ackText);
    for (const role of ["customer", "staff"]) {
      const s = h.signatures && h.signatures[role]; if (!s) continue;
      w.need(46);
      w.p(`${role === "customer" ? "Customer" : "For " + ctx.biz.trading_name}: ${s.name}`, { bold: true, gap: 1 });
      if (ctx.sigImages && ctx.sigImages[role]) { try { w.doc.addImage(ctx.sigImages[role], "PNG", M, w.y, 70, 26); } catch { } w.y += 28; }
      w.p(`Signed ${dt(s.at)} on ${s.device || "phone"}. Document version: ${s.doc_version}.`, { size: 8.5, color: GREY });
    }
    if (!h.signatures || !h.signatures.customer) w.p("Not signed by the customer.", { color: RED, bold: true });
  },
  terms(w, ctx) {
    w.page("Terms and your rights");
    const keys = ["sales_terms", "buyer_info"];
    if (ctx.h.sale_type && ctx.h.sale_type !== "on_premises") keys.push("distance_rights");
    if (ctx.h.warranty === "included") keys.push("warranty");
    keys.push("complaints", "privacy");
    for (const k of keys) { const t = ctx.templates[k]; if (!t) continue; w.h(t.title + (t.status !== "approved" ? "  [DRAFT]" : ""), 11.5); w.p(fill(t.body, ctx.biz)); }
  },
  next_steps(w, ctx) {
    w.page("Next steps");
    const t = ctx.templates.next_steps; w.p(fill(t ? t.body : "", ctx.biz));
    w.p("Official guidance: gov.uk/vehicle-tax · gov.uk/sold-bought-vehicle · gov.uk/check-mot-history", { size: 9, color: GREY });
  },
};


// ---------- Simple pack: one-page order form + one-page terms, both signed ----------
function box(w, x, y, wd, ht, label) {
  const { doc } = w; doc.setDrawColor(191, 203, 210); doc.setLineWidth(0.3); doc.roundedRect(x, y, wd, ht, 1.5, 1.5, "S");
  if (label) { doc.setFont(w.f, "bold"); doc.setFontSize(7.5); doc.setTextColor(...TEAL); doc.text(label.toUpperCase(), x + 3, y + 4.6); }
}
function field(w, x, y, label, value, maxW) {
  const { doc } = w; doc.setFont(w.f, "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text(label, x, y);
  doc.setFont(w.f, "bold"); doc.setFontSize(9.5); doc.setTextColor(...INK);
  const v = String(value ?? "") || "–"; let fs = 9.5; while (fs > 7 && doc.getTextWidth(v) > maxW) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(doc.splitTextToSize(v, maxW)[0], x, y + 4.4);
}
function sigBlock(w, x, y, wd, title, s, img) {
  const { doc } = w; box(w, x, y, wd, 32, title);
  if (img) { try { doc.addImage(img, "PNG", x + 3, y + 6, 52, 15); } catch { } }
  else { doc.setFont(w.f, "normal"); doc.setFontSize(8.5); doc.setTextColor(...RED); doc.text("Not signed", x + 3, y + 15); }
  doc.setDrawColor(191, 203, 210); doc.line(x + 3, y + 22, x + wd - 3, y + 22);
  doc.setFont(w.f, "bold"); doc.setFontSize(9); doc.setTextColor(...INK); doc.text(s ? s.name || "" : "", x + 3, y + 26.4);
  doc.setFont(w.f, "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
  if (s) doc.text(`Signed ${dt(s.at)} · ${s.doc_version}`, x + 3, y + 30);
}
function headerBand(w, title, sub) {
  const { doc, ctx } = w; const b = ctx.biz;
  if (w.started) doc.addPage(); w.started = true; w.title = title;
  doc.setFillColor(...NAVY); doc.rect(0, 0, A4W, 24, "F");
  doc.setTextColor(255, 255, 255); doc.setFont(w.f, "bold"); doc.setFontSize(15); doc.text(b.trading_name || "", 14, 11);
  doc.setFont(w.f, "normal"); doc.setFontSize(8.5);
  doc.text([b.phone, b.email].filter(Boolean).join("   "), 14, 17.5);
  doc.setFont(w.f, "bold"); doc.setFontSize(12.5); doc.text(title, A4W - 14, 11, { align: "right" });
  doc.setFont(w.f, "normal"); doc.setFontSize(8.5); doc.text(sub || "", A4W - 14, 17.5, { align: "right" });
  w.y = 30;
  if (ctx.draft) { doc.setFillColor(251, 233, 231); doc.rect(14, 27, A4W - 28, 7, "F"); doc.setTextColor(...RED); doc.setFont(w.f, "bold"); doc.setFontSize(8.5); doc.text("DRAFT: the terms wording has not been approved yet. Do not give this to a customer.", 17, 31.6); w.y = 37; }
}
const L = 14, FW = A4W - 28;

// ---------- Dealer-style order form + small-print terms (letterhead, ruled grid) ----------
const RULE = [201, 209, 217], LAB = [91, 102, 117], PALE = [238, 243, 246];
let LOGO = null;
async function loadLogo() { if (LOGO !== null) return LOGO; try { const r = await fetch("icons/icon-192.png"); const b = await r.blob(); LOGO = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch { LOGO = false; } return LOGO; }
function letterhead(w, title, rows) {
  const { doc, ctx } = w; const b = ctx.biz;
  if (w.started) doc.addPage(); w.started = true; w.title = title;
  if (LOGO) try { doc.addImage(LOGO, "PNG", L, 13, 14, 14); } catch { }
  doc.setTextColor(...NAVY); doc.setFont(w.f, "bold"); doc.setFontSize(15); doc.text(b.trading_name || "", L + 17, 18.5);
  doc.setFont(w.f, "normal"); doc.setFontSize(7.6); doc.setTextColor(...LAB);
  const addr = (b.invoice_address || b.viewing_location || "").replace(/\s*\(.*\)$/, "").replace(/\n/g, ", ");
  doc.text([addr, [b.phone, b.website].filter(Boolean).join("  ·  "), b.email || ""], L + 17, 22.8, { lineHeightFactor: 1.3 });
  doc.setTextColor(...NAVY); doc.setFont(w.f, "bold"); doc.setFontSize(14); doc.text(title, A4W - L, 17.5, { align: "right" });
  const tw = 72, tx = A4W - L - tw, rh = 4.9; let ty = 20.5;
  doc.setLineWidth(0.18);
  for (const [k, v] of rows) {
    doc.setDrawColor(...RULE); doc.rect(tx, ty, tw, rh); doc.line(tx + 26, ty, tx + 26, ty + rh);
    doc.setFont(w.f, "bold"); doc.setFontSize(6.6); doc.setTextColor(...LAB); doc.text(k, tx + 1.8, ty + 3.3);
    doc.setFont(w.f, "normal"); doc.setFontSize(8); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(String(v ?? ""), tw - 29)[0] || "", tx + 28, ty + 3.4);
    ty += rh;
  }
  const ry = Math.max(ty, 36) + 3.5;
  doc.setDrawColor(...NAVY); doc.setLineWidth(0.55); doc.line(L, ry, A4W - L, ry);
  doc.setDrawColor(...TEAL); doc.setLineWidth(0.3); doc.line(L, ry + 0.9, A4W - L, ry + 0.9);
  doc.setLineWidth(0.18);
  doc.setDrawColor(...RULE); doc.line(L, 284, A4W - L, 284);
  doc.setFont(w.f, "normal"); doc.setFontSize(6.8); doc.setTextColor(...LAB);
  doc.text(`${b.trading_name}  ·  ${addr}  ·  ${b.phone || ""}  ·  ${b.email || ""}`, L, 288);
  const legal = [b.legal_name ? `${b.trading_name} is a trading name of ${b.legal_name}.` : "", b.company_number ? `Company no. ${b.company_number}.` : "", b.vat_treatment === "not_registered" ? "Not VAT registered." : b.vat_number ? `VAT no. ${b.vat_number}.` : ""].filter(Boolean).join("  ");
  if (legal) doc.text(legal, L, 291.5);
  if (ctx.versionLabel) doc.text(ctx.versionLabel, A4W - L, 291.5, { align: "right" });
  w.y = ry + 6;
  if (ctx.draft) { doc.setFillColor(251, 233, 231); doc.rect(L, w.y - 3, FW, 6.5, "F"); doc.setTextColor(...RED); doc.setFont(w.f, "bold"); doc.setFontSize(8); doc.text("DRAFT: the terms wording has not been approved yet (Admin > Wording). Do not issue.", L + 2, w.y + 1.3); w.y += 6; }
}
function secHead(w, t) { const { doc } = w; doc.setFont(w.f, "bold"); doc.setFontSize(9); doc.setTextColor(...NAVY); doc.text(t, L, w.y + 3.2); doc.setDrawColor(...NAVY); doc.setLineWidth(0.3); doc.line(L, w.y + 4.6, L + FW, w.y + 4.6); doc.setLineWidth(0.18); w.y += 4.6; }
function grid(w, cells, h = 9.2) {
  const { doc } = w; let x = L;
  for (const [frac, lab, val, opt = {}] of cells) {
    const cw = FW * frac; doc.setDrawColor(...RULE); doc.rect(x, w.y, cw, h);
    doc.setFont(w.f, "bold"); doc.setFontSize(6.2); doc.setTextColor(...LAB); doc.text(lab, x + 1.6, w.y + 2.9);
    doc.setFont(w.f, opt.b ? "bold" : "normal"); let fs = opt.s || 8.8; doc.setFontSize(fs); doc.setTextColor(...INK);
    const v = String(val ?? ""); while (fs > 6.5 && doc.getTextWidth(v) > cw - 3.2) { fs -= 0.3; doc.setFontSize(fs); }
    doc.text(v, x + 1.6, w.y + h - 2.1); x += cw;
  }
  w.y += h;
}
const PAYNAME = { deposit: "deposit", part_payment: "part-payment", balance: "payment", refund: "refund" };
const PAYMETHOD = { cash: "cash", bank: "bank transfer", card: "card", other: "other", part_exchange: "part exchange" };

function sigImg(doc, img, x, y, w, h) { try { const p = doc.getImageProperties(img); const k = Math.min(w / p.width, h / p.height); const iw = p.width * k, ih = p.height * k; doc.addImage(img, "PNG", x, y + (h - ih), iw, ih); } catch { } }
SECTIONS.order = (w, ctx) => {
  const { doc } = w; const { biz: b, car: c, customer: cu, h } = ctx;
  letterhead(w, ctx.creditNote ? "Credit Note" : "Vehicle Order Form", [["Order no.", ctx.invoiceNo], ["Order date", d8(ctx.issuedAt)], ["Stock no.", c.stock_id || ""], ["Sale type", { on_premises: "Used · retail · in person", distance: "Used · retail · remote", off_premises: "Used · retail · off premises" }[h.sale_type] || "Used · retail"]]);
  secHead(w, "Customer");
  grid(w, [[.42, "Name", cu.name, { b: 1 }], [.24, "Mobile", cu.phone], [.34, "Email", cu.email]]);
  grid(w, [[.42, "Address", (cu.address || "").replace(/\n/g, ", ")], [.24, "Postcode", cu.postcode], [.34, "Delivery address", h.delivery_fee ? (h.delivery_address || "As customer address") : "Collection from us"]]);
  w.y += 5; secHead(w, "Vehicle");
  grid(w, [[.2, "Registration", c.reg, { b: 1 }], [.2, "Make", c.make], [.3, "Model / derivative", [c.model, c.variant].filter(Boolean).join(" ")], [.15, "Year", c.year], [.15, "Colour", c.colour]]);
  grid(w, [[.2, "Odometer reading", `${Number(h.mileage || c.mileage || 0).toLocaleString("en-GB")} miles`], [.2, "Transmission", c.gearbox], [.3, "Body", c.body || ""], [.15, "Fuel", c.fuel], [.15, "Keys", h.keys ?? c.keys ?? ""]]);
  grid(w, [[.4, "VIN", c.vin], [.3, "MOT expiry", c.mot_expiry ? d8(c.mot_expiry) : ""], [.3, "Service history", c.service_history || ""]]);
  const faults = String(h.faults_disclosed || c.known_faults || "None known.").split(/\r?\n/).map(x => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
  doc.setFontSize(8.2); const colW = FW / 2 - 4;
  const fl = faults.map((f, i) => doc.splitTextToSize(`${i + 1}.  ${f}`, colW));
  const rowsN = Math.ceil(fl.length / 2); let fh = 6;
  for (let r = 0; r < rowsN; r++) fh += Math.max(fl[2 * r]?.length || 1, fl[2 * r + 1]?.length || 1) * 3.6 + 0.8;
  fh = Math.max(fh + 1.5, 12);
  doc.setDrawColor(...RULE); doc.rect(L, w.y, FW, fh);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.2); doc.setTextColor(...LAB); doc.text("Known faults and condition notes (disclosed to the customer before sale)", L + 1.6, w.y + 2.9);
  doc.setFont(w.f, "normal"); doc.setFontSize(8.2); doc.setTextColor(...INK);
  let fy = w.y + 7;
  for (let r = 0; r < rowsN; r++) { const a = fl[2 * r] || [], bb = fl[2 * r + 1] || []; doc.text(a, L + 1.6, fy); doc.text(bb, L + FW / 2 + 1.6, fy); fy += Math.max(a.length, bb.length, 1) * 3.6 + 0.8; }
  w.y += fh;
  w.y += 5; secHead(w, "Part exchange");
  const px = Number(h.px_value) || 0;
  grid(w, [[.2, "Registration", h.px_reg || "None"], [.35, "Make / model", h.px_model || ""], [.15, "Mileage", h.px_mileage || ""], [.15, "Settlement", ""], [.15, "Allowance", px ? money(px) : ""]], 8.6);
  w.y += 5; secHead(w, "Price and payment");
  const price = Number(h.price) || 0, del = Number(h.delivery_fee) || 0, total = price + del;
  const rows = [["Cash price of vehicle", money(price)], ["Delivery charge", money(del)], ["Admin / preparation fees", money(0)], ["Part exchange allowance", px ? `(${money(px)})` : money(0)], ["Total price", money(total - px), "tot"]];
  for (const p of ctx.payments) rows.push([`Less ${PAYNAME[p.type] || p.type} paid (${PAYMETHOD[p.method] || p.method || ""}, ${d8(p.date)})`, p.type === "refund" ? money(p.amount) : `(${money(p.amount)})`]);
  rows.push([ctx.balance > 0 ? "Balance due before handover" : "Paid in full", money(Math.max(0, ctx.balance)), "bal"]);
  const pw = FW * 0.54, px0 = L + FW - pw, rh = 5.6; let ry = w.y;
  for (const [k, v, t] of rows) {
    if (t === "bal") { doc.setFillColor(...PALE); doc.rect(px0, ry, pw, rh, "F"); }
    doc.setDrawColor(...RULE); doc.rect(px0, ry, pw, rh);
    if (t === "tot") { doc.setDrawColor(...NAVY); doc.setLineWidth(0.35); doc.line(px0, ry, px0 + pw, ry); doc.setLineWidth(0.18); }
    doc.setFont(w.f, t ? "bold" : "normal"); doc.setFontSize(t ? 8.6 : 8); doc.setTextColor(...INK);
    doc.text(doc.splitTextToSize(k, pw - 30)[0], px0 + 2, ry + 3.9); doc.text(v, px0 + pw - 2, ry + 3.9, { align: "right" }); ry += rh;
  }
  const lw = FW - pw - 4, lh = ry - w.y;
  doc.setDrawColor(...RULE); doc.rect(L, w.y, lw, lh);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.2); doc.setTextColor(...LAB); doc.text("Delivery and notes", L + 1.6, w.y + 2.9);
  doc.setFont(w.f, "normal"); doc.setFontSize(7.8); doc.setTextColor(...INK);
  const notes = [h.delivery_fee ? `Delivery date: ${h.delivery_date ? d8(h.delivery_date) : "to be agreed"}` : "Collection from Motorwise Hereford",
    h.warranty === "included" ? "Warranty: included (see warranty terms)" : "Warranty: none",
    `Goodwill look-over: ${b.aftercare_days || 14} days (terms, clause 16)`,
    b.vat_treatment === "not_registered" ? "VAT: not applicable, seller not VAT registered" : b.vat_treatment === "margin_scheme" ? "VAT: second-hand margin scheme" : `VAT no. ${b.vat_number || ""}`,
    "Balance to be paid in cleared funds before handover"];
  doc.text(notes.map(n => doc.splitTextToSize(n, lw - 4)[0]), L + 1.8, w.y + 7.5, { lineHeightFactor: 1.55 });
  w.y = ry + 5; secHead(w, "Customer declaration");
  doc.setFont(w.f, "normal"); doc.setFontSize(7.6); doc.setTextColor(...INK);
  const dec = doc.splitTextToSize("I agree to purchase the vehicle described above at the price shown, on the " + b.trading_name + " terms and conditions of sale overleaf, which I have read and accept. I confirm that the faults and condition notes above were disclosed to me before I agreed to buy, that I understand the vehicle is used and priced for its age, mileage and condition, and that the details on this form are correct. Ownership passes on payment of the balance in full. This does not affect my statutory rights.", FW);
  doc.text(dec, L, w.y + 4, { lineHeightFactor: 1.35 }); w.y += 4 + dec.length * 3.6 + 2;
  const sh = 17; const cols = [[.38, "Customer signature", "customer"], [.12, "Date", "cd"], [.38, `Signed for ${b.trading_name}`, "staff"], [.12, "Date", "sd"]];
  let x = L; const sig = h.signatures || {};
  for (const [frac, lab, key] of cols) {
    const cw = FW * frac; doc.setDrawColor(...RULE); doc.rect(x, w.y, cw, sh);
    doc.setFont(w.f, "bold"); doc.setFontSize(6.2); doc.setTextColor(...LAB); doc.text(lab, x + 1.6, w.y + 2.9);
    const role = key === "customer" || key === "staff" ? key : null, s = sig[role || (key === "cd" ? "customer" : "staff")];
    if (role && ctx.sigImages && ctx.sigImages[role]) sigImg(doc, ctx.sigImages[role], x + 2, w.y + 3.8, cw - 4, 12);
    if (!role && s) { doc.setFont(w.f, "normal"); doc.setFontSize(8); doc.setTextColor(...INK); doc.text(d8(s.at), x + 1.6, w.y + sh - 2.5); }
    x += cw;
  }
  w.y += sh + 3.5;
  doc.setFont(w.f, "normal"); doc.setFontSize(6.8); doc.setTextColor(...LAB);
  const cs = sig.customer;
  doc.text(`Customer name (print): ${cu.name || ""}${cs ? `   ·   Signed ${dt(cs.at)}${cs.method === "esign" ? ` by e-signature (IP ${cs.ip || "recorded"})` : cs.device ? ` on ${cs.device}` : ""}   ·   ${cs.doc_version || ""}` : ""}`, L, w.y);
};

SECTIONS.tcs = (w, ctx) => {
  const { doc } = w; const b = ctx.biz;
  letterhead(w, "Terms and Conditions of Sale", [["Order no.", ctx.invoiceNo], ["Vehicle", ctx.car.reg || ""]]);
  const parts = [ctx.templates.tcs]; if (ctx.h.warranty === "included") parts.push(ctx.templates.warranty);
  const paras = parts.filter(Boolean).map(t => fill(t.body, b)).join("\n").split("\n").filter(Boolean);
  const gap = 4, cw = (FW - 2 * gap) / 3, top = w.y, bottom = 262, fs = 5.3, lh = fs * 0.3528 * 1.28;
  let col = 0, y = top + 1;
  const put = (ln, bold, x) => { doc.setFont(w.f, bold ? "bold" : "normal"); doc.text(ln, x, y); };
  doc.setFontSize(5.6); doc.setFont(w.f, "bold"); doc.setTextColor(...NAVY);
  const intro = doc.splitTextToSize("These terms form part of the vehicle order form overleaf. Please read them carefully. Your statutory rights are not affected.", cw);
  doc.text(intro, L, y + 1.5); y += intro.length * lh + 2.5;
  doc.setFontSize(fs); doc.setTextColor(42, 52, 65);
  for (const para of paras) {
    const m = para.match(/^(\d+\.\s*[^.]+\.)\s*(.*)$/);
    const lines = doc.splitTextToSize(para, cw - 2.2);
    for (const [i, ln] of lines.entries()) {
      if (y > bottom) { col++; y = top + 1; if (col > 2) { letterhead(w, "Terms and Conditions of Sale (continued)", [["Order no.", ctx.invoiceNo]]); doc.setFontSize(fs); doc.setTextColor(42, 52, 65); col = 0; } }
      const x = L + col * (cw + gap);
      if (i === 0 && m && ln.startsWith(m[1])) { doc.setTextColor(...NAVY); put(m[1], true, x); const bw = doc.getTextWidth(m[1] + " "); doc.setTextColor(42, 52, 65); put(ln.slice(m[1].length).trimStart(), false, x + bw); }
      else put(ln, false, x);
      y += lh;
    }
    y += 1.05;
  }
  doc.setDrawColor(...RULE); for (const k of [1, 2]) doc.line(L + k * (cw + gap) - gap / 2, top, L + k * (cw + gap) - gap / 2, bottom + 1);
  const sy = 266, s = (ctx.h.signatures || {}).customer;
  doc.rect(L, sy, FW, 14);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.2); doc.setTextColor(...LAB); doc.text("Customer signature", L + 1.6, sy + 2.9); doc.text("Date", L + 92, sy + 2.9);
  if (ctx.sigImages && ctx.sigImages.customer) sigImg(doc, ctx.sigImages.customer, L + 2, sy + 3.4, 70, 10);
  if (s) { doc.setFont(w.f, "normal"); doc.setFontSize(8); doc.setTextColor(...INK); doc.text(d8(s.at), L + 92, sy + 10.5); }
  doc.setFont(w.f, "normal"); doc.setFontSize(7.5); doc.setTextColor(...LAB); doc.text("Your statutory rights are not affected.", A4W - L - 2, sy + 10.5, { align: "right" });
};

export const DOCS = [
  { key: "order", name: "Vehicle order form" }, { key: "tcs", name: "Terms and conditions" },
];

export async function buildPdf(ctx, keys) {
  await loadFonts();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const f = useFonts(doc); doc.setFont(f, "normal");
  doc.setProperties({ title: `${ctx.biz.trading_name} ${ctx.ref}`, creator: "Motorwise Desk" });
  await loadLogo();
  const w = new Writer(doc, f, ctx);
  for (const k of keys) SECTIONS[k](w, ctx);
  if (keys.some(k => !["order", "tcs"].includes(k))) w.footer();
  return doc.output("blob");
}

export async function sha256(blob) {
  const buf = await blob.arrayBuffer(); const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
