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

SECTIONS.order = (w, ctx) => {
  const { doc } = w; const { biz: b, car: c, customer: cu, h } = ctx;
  headerBand(w, ctx.creditNote ? "Credit note" : "Vehicle order form", `${ctx.invoiceNo} · ${d8(ctx.issuedAt)}`);
  let y = w.y;
  // Seller / buyer
  const half = (FW - 4) / 2;
  box(w, L, y, half, 31, "Seller"); box(w, L + half + 4, y, half, 31, "Buyer");
  doc.setFont(w.f, "bold"); doc.setFontSize(9.5); doc.setTextColor(...INK);
  doc.text(doc.splitTextToSize(`${b.legal_name || "[owner's name]"} trading as ${b.trading_name}`, half - 6).slice(0, 2), L + 3, y + 10);
  doc.setFont(w.f, "normal"); doc.setFontSize(8.5);
  doc.text(doc.splitTextToSize([b.invoice_address || "[address]", b.phone].filter(Boolean).join("\n"), half - 6).slice(0, 4), L + 3, y + 19);
  doc.setFont(w.f, "bold"); doc.setFontSize(9.5); doc.text(cu.name || "", L + half + 7, y + 10);
  doc.setFont(w.f, "normal"); doc.setFontSize(8.5);
  doc.text(doc.splitTextToSize([[cu.address, cu.postcode].filter(Boolean).join(", "), cu.phone, cu.email].filter(Boolean).join("\n"), half - 6).slice(0, 5), L + half + 7, y + 15);
  y += 35;
  // Vehicle
  box(w, L, y, FW, 25, "Vehicle");
  const col = FW / 4;
  const vf = [["Registration", c.reg], ["Make and model", [c.make, c.model, c.variant].filter(Boolean).join(" ")], ["Year", c.year], ["Colour", c.colour],
    ["Mileage at sale", Number(h.mileage || c.mileage || 0).toLocaleString("en-GB")], ["Fuel", c.fuel], ["MOT expires", c.mot_expiry ? d8(c.mot_expiry) : ""], ["Keys", h.keys ?? c.keys]];
  vf.forEach(([k, v], i) => field(w, L + 3 + (i % 4) * col, y + 9.5 + Math.floor(i / 4) * 9.5, k, v, col - 5));
  y += 29;
  // Faults
  doc.setFontSize(9.5); const fl = doc.splitTextToSize(h.faults_disclosed || c.known_faults || "None known.", FW - 6).slice(0, 9);
  const fh = Math.max(17, 10 + fl.length * 4.4);
  doc.setFillColor(255, 243, 214); doc.roundedRect(L, y, FW, fh, 1.5, 1.5, "F"); box(w, L, y, FW, fh, "Faults and condition points told to the buyer before sale");
  doc.setFont(w.f, "normal"); doc.setFontSize(9.5); doc.setTextColor(...INK); doc.text(fl, L + 3, y + 10);
  y += fh + 4;
  // Price + checks
  const pw = FW * 0.46, cw = FW - pw - 4, ph = 52;
  box(w, L, y, pw, ph, "Price and payment"); box(w, L + pw + 4, y, cw, ph, "Handover checks");
  const price = Number(h.price) || 0, px = Number(h.px_value) || 0;
  const rows = [["Vehicle price", money(price)]];
  if (px) rows.push([`Part exchange ${h.px_reg || ""}`.trim(), "− " + money(px)]);
  for (const p of ctx.payments.slice(0, 4)) rows.push([`${{ deposit: "Deposit", part_payment: "Part-payment", balance: "Payment", refund: "Refund" }[p.type] || p.type} (${{ cash: "cash", bank: "bank", card: "card" }[p.method] || p.method || ""}) ${new Date(p.date + "T12:00").toLocaleDateString("en-GB")}`, (p.type === "refund" ? "+ " : "− ") + money(p.amount)]);
  if (ctx.payments.length > 4) rows.push([`${ctx.payments.length - 4} more payments`, "− " + money(ctx.payments.slice(4).reduce((s, p) => s + (p.type === "refund" ? -1 : 1) * Number(p.amount), 0))]);
  let ry = y + 10; doc.setFontSize(9);
  for (const [k, v] of rows) { doc.setFont(w.f, "normal"); doc.setTextColor(...INK); doc.text(doc.splitTextToSize(k, pw - 32)[0], L + 3, ry); doc.text(v, L + pw - 3, ry, { align: "right" }); ry += 5; }
  doc.setDrawColor(191, 203, 210); doc.line(L + 3, ry - 2.5, L + pw - 3, ry - 2.5);
  doc.setFont(w.f, "bold"); doc.setFontSize(10.5); doc.text(ctx.balance > 0 ? "Balance due" : "Paid in full", L + 3, ry + 2.5); doc.text(money(Math.max(0, ctx.balance)), L + pw - 3, ry + 2.5, { align: "right" });
  doc.setFont(w.f, "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
  const vn = b.vat_treatment === "not_registered" ? "Not VAT registered. No VAT is charged. No extra fees added." : b.vat_treatment === "margin_scheme" ? "Second-hand margin scheme: VAT is not shown separately." : `Includes VAT at 20%: ${money(price / 6)}. VAT no. ${b.vat_number}`;
  doc.text(doc.splitTextToSize(vn, pw - 6), L + 3, y + ph - 5.5);
  let cy = y + 10; doc.setFontSize(8.5);
  for (const it of ctx.checklistItems) {
    const on = h.checklist && h.checklist[it.key];
    doc.setDrawColor(...(on ? TEAL : GREY)); doc.setLineWidth(0.35); doc.rect(L + pw + 7, cy - 2.9, 3.3, 3.3, "S");
    if (on) { doc.setDrawColor(...TEAL); doc.setLineWidth(0.6); doc.line(L + pw + 7.6, cy - 1.2, L + pw + 8.6, cy); doc.line(L + pw + 8.6, cy, L + pw + 10, cy - 2.4); }
    doc.setFont(w.f, "normal"); doc.setTextColor(...INK); const t = doc.splitTextToSize(it.short || it.label, cw - 14); doc.text(t[0], L + pw + 12.5, cy); cy += 5.1;
  }
  doc.setLineWidth(0.3);
  y += ph + 4;
  // Declaration + signatures
  doc.setFont(w.f, "normal"); doc.setFontSize(8.8); doc.setTextColor(...INK);
  const dec = doc.splitTextToSize("Buyer's declaration: I agree to buy the vehicle above at this price and on the terms and conditions on page 2, which I have read. The faults and condition points above were explained to me before I agreed to buy. I have inspected the vehicle and received it with the keys stated. This does not affect my statutory rights.", FW);
  doc.text(dec, L, y + 3); y += dec.length * 4 + 3;
  sigBlock(w, L, y, half, "Buyer signature", h.signatures && h.signatures.customer, ctx.sigImages && ctx.sigImages.customer);
  sigBlock(w, L + half + 4, y, half, `For ${b.trading_name}`, h.signatures && h.signatures.staff, ctx.sigImages && ctx.sigImages.staff);
  y += 36;
  // Next steps
  const ns = ctx.templates.next_steps;
  if (ns && y < 262) { doc.setFont(w.f, "bold"); doc.setFontSize(8.5); doc.setTextColor(...TEAL); doc.text("BEFORE YOU DRIVE AWAY", L, y + 2); doc.setFont(w.f, "normal"); doc.setTextColor(...INK); doc.setFontSize(8.5); doc.text(doc.splitTextToSize(fill(ns.body, b), FW).slice(0, 6), L, y + 6.5); }
};

SECTIONS.tcs = (w, ctx) => {
  const { doc } = w; const b = ctx.biz;
  headerBand(w, "Terms and conditions of sale", `${ctx.invoiceNo} · ${d8(ctx.issuedAt)}`);
  const parts = [ctx.templates.tcs];
  if (ctx.h.sale_type && ctx.h.sale_type !== "on_premises") parts.push(ctx.templates.distance_rights);
  if (ctx.h.warranty === "included") parts.push(ctx.templates.warranty);
  let size = 8.6; const text = parts.filter(Boolean).map(t => fill(t.body, b)).join("\n");
  // shrink slightly so terms + signature fit on one page where possible
  for (; size > 7.4; size -= 0.2) { doc.setFontSize(size); const n = text.split("\n").reduce((s, p) => s + doc.splitTextToSize(p || " ", FW).length, 0); if (w.y + n * size * 0.42 + text.split("\n").length * 1.1 < 238) break; }
  doc.setFontSize(size); doc.setTextColor(...INK);
  for (const para of text.split("\n")) {
    const m = para.match(/^(\d+\.\s*[^.]+\.)(.*)$/);
    const lines = doc.splitTextToSize(para || " ", FW);
    for (const [i, ln] of lines.entries()) {
      if (w.y > 280) { headerBand(w, "Terms and conditions (continued)", ctx.invoiceNo); doc.setFontSize(size); }
      if (i === 0 && m && ln.startsWith(m[1])) { doc.setFont(w.f, "bold"); doc.text(m[1], L, w.y); const bw = doc.getTextWidth(m[1] + " "); doc.setFont(w.f, "normal"); doc.text(ln.slice(m[1].length).trimStart(), L + bw, w.y); }
      else { doc.setFont(w.f, "normal"); doc.text(ln, L, w.y); }
      w.y += size * 0.42;
    }
    w.y += 1.1;
  }
  if (w.y > 248) headerBand(w, "Terms and conditions (signature)", ctx.invoiceNo);
  w.y += 2; doc.setFont(w.f, "bold"); doc.setFontSize(9); doc.text("I have read, received and agree to these terms and conditions.", L, w.y + 2);
  const half = (FW - 4) / 2;
  sigBlock(w, L, w.y + 5, half, "Buyer signature", ctx.h.signatures && ctx.h.signatures.customer, ctx.sigImages && ctx.sigImages.customer);
  sigBlock(w, L + half + 4, w.y + 5, half, `For ${b.trading_name}`, ctx.h.signatures && ctx.h.signatures.staff, ctx.sigImages && ctx.sigImages.staff);
};

export const DOCS = [
  { key: "order", name: "Vehicle order form" }, { key: "tcs", name: "Terms and conditions" },
];

export async function buildPdf(ctx, keys) {
  await loadFonts();
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const f = useFonts(doc); doc.setFont(f, "normal");
  doc.setProperties({ title: `${ctx.biz.trading_name} ${ctx.ref}`, creator: "Motorwise Desk" });
  const w = new Writer(doc, f, ctx);
  for (const k of keys) SECTIONS[k](w, ctx);
  w.footer();
  return doc.output("blob");
}

export async function sha256(blob) {
  const buf = await blob.arrayBuffer(); const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
