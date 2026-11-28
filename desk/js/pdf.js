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
// Dealer order form in the layout main dealers use (Keyloop Sales Docs style): grey label cells, ruled boxes, a priced summary ledger.
const GREYF = [233, 236, 240], BOX = [150, 160, 172], DK = [30, 38, 48];
const dd = iso => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-") : "";
function kHead(w, title) {
  const { doc, ctx } = w; const b = ctx.biz;
  if (w.started) doc.addPage(); w.started = true;
  if (LOGO) try { doc.addImage(LOGO, "PNG", A4W / 2 - 39, 10, 11, 11); } catch { }
  doc.setTextColor(...NAVY); doc.setFont(w.f, "bold"); doc.setFontSize(19); doc.text(b.trading_name || "", A4W / 2 - 25.5, 18.6);
  doc.setFont(w.f, "normal"); doc.setFontSize(6.8); doc.setTextColor(...DK);
  const addr = (b.invoice_address || b.viewing_location || "").replace(/\s*\(.*\)$/, "").split(/,\s*|\n/).filter(Boolean);
  doc.text([...addr, b.phone || "", b.email || ""], A4W - L, 10.5, { align: "right", lineHeightFactor: 1.25 });
  doc.setFont(w.f, "bold"); doc.setFontSize(10); doc.text(title, L, 27);
  doc.setFont(w.f, "normal"); doc.setFontSize(7.4); doc.text(`Order ID: ${ctx.invoiceNo || ""}`, L, 31.5);
  // footer
  doc.setDrawColor(...BOX); doc.setLineWidth(0.15); doc.line(L, 285.5, A4W - L, 285.5);
  doc.setFontSize(6.3); doc.setTextColor(...LAB);
  const legal = [b.legal_name ? `${b.trading_name} is a trading name of ${b.legal_name}.` : "", b.vat_treatment === "not_registered" ? "Not VAT registered." : b.vat_number ? `VAT no. ${b.vat_number}.` : "", b.website || ""].filter(Boolean).join("  ");
  doc.text(legal, L, 289); doc.text(`Generated ${dt(ctx.issuedAt || new Date().toISOString())}${ctx.versionLabel ? "  ·  " + ctx.versionLabel : ""}`, A4W - L, 289, { align: "right" });
  w.y = 34;
  if (ctx.draft) { doc.setFillColor(251, 233, 231); doc.rect(L, w.y, FW, 5.5, "F"); doc.setTextColor(...RED); doc.setFont(w.f, "bold"); doc.setFontSize(7.5); doc.text("DRAFT: the terms wording has not been approved yet (Admin > Wording). Do not issue.", L + 2, w.y + 3.8); w.y += 7; }
}
// one labelled cell: grey label part, white value part
function kc(w, x, y, cw, lw, label, val, h = 5, o = {}) {
  const { doc } = w;
  doc.setDrawColor(...BOX); doc.setLineWidth(0.15);
  doc.setFillColor(...GREYF); doc.rect(x, y, lw, h, "FD"); doc.rect(x + lw, y, cw - lw, h);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.4); doc.setTextColor(...DK); doc.text(label, x + 1.2, y + h / 2 + 1.1);
  doc.setFont(w.f, o.b ? "bold" : "normal"); let fs = o.s || 7.2; doc.setFontSize(fs);
  const v = String(val ?? ""); while (fs > 5.4 && doc.getTextWidth(v) > cw - lw - 2.2) { fs -= 0.2; doc.setFontSize(fs); }
  doc.text(v, o.r ? x + cw - 1.2 : x + lw + 1.2, y + h / 2 + 1.1, o.r ? { align: "right" } : {});
}
function kSec(w, t) { const { doc } = w; doc.setFillColor(...GREYF); doc.setDrawColor(...BOX); doc.setLineWidth(0.15); doc.rect(L, w.y, FW, 5, "FD"); doc.setFont(w.f, "bold"); doc.setFontSize(7.8); doc.setTextColor(...NAVY); doc.text(t, L + 1.5, w.y + 3.6); w.y += 5; }
function kBox(w, x, y, cw, h, label, lines) {
  const { doc } = w; doc.setDrawColor(...BOX); doc.setLineWidth(0.15); doc.rect(x, y, cw, h);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.4); doc.setTextColor(...DK); doc.text(label, x + 1.2, y + 3);
  doc.setFont(w.f, "normal"); doc.setFontSize(7.2); doc.text(lines.filter(Boolean), x + 1.2, y + 6.6, { lineHeightFactor: 1.25 });
}

SECTIONS.order = (w, ctx) => {
  const { doc } = w; const { biz: b, car: c, customer: cu, h } = ctx;
  kHead(w, ctx.creditNote ? "Credit Note" : "Vehicle Order Form");
  const third = FW / 3;
  kc(w, L, w.y, third, 22, "Order Date", dd(ctx.issuedAt));
  kc(w, L + third, w.y, third, 30, "Estimated Delivery", h.delivery_date ? dd(h.delivery_date) : (Number(h.delivery_fee) ? "To be agreed" : "Collection"));
  kc(w, L + 2 * third, w.y, third, 22, "Sales Person", `${b.trading_name.split(" ")[0]} team`);
  w.y += 7;
  // customer
  kSec(w, "Customer Details");
  const half = FW / 2, addr = (cu.address || "").split(/\n|,\s*/).filter(Boolean);
  const delAddr = Number(h.delivery_fee) ? (h.delivery_address ? h.delivery_address.split(/\n|,\s*/) : [cu.name, ...addr, cu.postcode]) : ["Collection from", b.trading_name, ...(b.invoice_address || b.viewing_location || "").replace(/\s*\(.*\)$/, "").split(/,\s*|\n/)];
  kBox(w, L, w.y, half, 24, "Supply To / Invoice To", [cu.name, ...addr, cu.postcode]);
  kBox(w, L + half, w.y, half, 24, Number(h.delivery_fee) ? "Deliver To" : "Collection", delAddr);
  w.y += 24;
  kc(w, L, w.y, half, 22, "Mobile No.", cu.phone); kc(w, L + half, w.y, half, 22, "Order No.", ctx.invoiceNo); w.y += 5;
  kc(w, L, w.y, half, 22, "Email", cu.email); kc(w, L + half, w.y, half, 22, "Sale Type", { on_premises: "In person, on premises", distance: "Distance (remote)", off_premises: "Off premises" }[h.sale_type] || ""); w.y += 7;
  // vehicle
  kSec(w, "Vehicle Details");
  const vrows = [
    [["Make", c.make], ["Model", [c.model, c.variant].filter(Boolean).join(" ")], ["Reg No.", c.reg, { b: 1 }]],
    [["Colour", c.colour], ["Body", c.body], ["Year", c.year]],
    [["Stock No.", c.stock_id], ["Chassis No.", c.vin], ["MOT Expiry", c.mot_expiry ? dd(c.mot_expiry) : ""]],
    [["Mileage", `${Number(h.mileage || c.mileage || 0).toLocaleString("en-GB")} miles`], ["Fuel / Gearbox", [c.fuel, c.gearbox].filter(Boolean).join(" / ")], ["New / Used", "Used"]],
    [["Warranty Status", h.warranty === "included" ? "Warranty included" : "No warranty"], ["Keys", String(h.keys ?? c.keys ?? "")], ["Service History", c.service_history || ""]],
  ];
  for (const r of vrows) { r.forEach(([k, v, o], i) => kc(w, L + i * third, w.y, third, 22, k, v, 5, o || {})); w.y += 5; }
  // faults
  const faults = String(h.faults_disclosed || c.known_faults || "None known.").split(/\r?\n/).map(x => x.replace(/^[-•*\d.)\s]+/, "").trim()).filter(Boolean);
  doc.setFontSize(7); const fl = doc.splitTextToSize(faults.map((f, i) => `${i + 1}. ${f}`).join("   "), FW - 2.4);
  const fh = 5 + fl.length * 3.1 + 1.2;
  doc.setDrawColor(...BOX); doc.rect(L, w.y, FW, fh);
  doc.setFont(w.f, "bold"); doc.setFontSize(6.4); doc.setTextColor(...DK); doc.text("Known Faults / Condition (disclosed before sale)", L + 1.2, w.y + 3);
  doc.setFont(w.f, "normal"); doc.setFontSize(7); doc.text(fl, L + 1.2, w.y + 6.4, { lineHeightFactor: 1.25 }); w.y += fh + 2;
  // summary ledger
  kSec(w, "Summary");
  const price = Number(h.price) || 0, del = Number(h.delivery_fee) || 0, px = Number(h.px_value) || 0, total = price + del - px;
  const lines = [
    ["Total Vehicle Price", "", money(price)],
    ["Adjustments", "Customer saving", money(0)],
    ["Vehicle Sub Total", "", money(price), 1],
    ["Other", "Admin fee", money(0)],
    ["", "Delivery charge", money(del)],
    ["", "Road fund licence", "Customer to tax"],
    ["Part Exchange", h.px_reg ? `${h.px_reg} ${h.px_model || ""}`.trim() : "None", px ? `(${money(px)})` : money(0)],
    ["Sub Total", "", money(price + del - px), 1],
    ["VAT", b.vat_treatment === "not_registered" ? "Seller not VAT registered, no VAT charged" : b.vat_treatment === "margin_scheme" ? "Second-hand margin scheme, VAT not shown" : "", money(0)],
    ["Invoice Total", "", money(total), 1],
  ];
  for (const p of ctx.payments) lines.push([p.type === "refund" ? "Refund" : "Less Deposit", `${PAYMETHOD[p.method] || p.method || ""} ${dd(p.date)}${p.reference ? " · ref " + p.reference : ""}`, p.type === "refund" ? money(p.amount) : `(${money(p.amount)})`]);
  lines.push(["Balance Due", "Payable in cleared funds before handover", money(Math.max(0, ctx.balance)), 2]);
  const rh = 4.3, c2 = L + 46, c3 = L + FW - 1.5;
  doc.setDrawColor(...BOX); doc.rect(L, w.y, FW, lines.length * rh + 1.5); let y = w.y + 1;
  for (const [a1, a2, a3, bold] of lines) {
    if (bold === 2) { doc.setFillColor(...GREYF); doc.rect(L, y - 0.3, FW, rh + 0.6, "F"); }
    doc.setFont(w.f, bold ? "bold" : "normal"); doc.setFontSize(bold ? 7.6 : 7.1); doc.setTextColor(...DK);
    doc.text(a1, L + 2, y + 3); doc.setFont(w.f, "normal"); doc.text(a2, c2, y + 3); doc.setFont(w.f, bold ? "bold" : "normal"); doc.text(a3, c3, y + 3, { align: "right" });
    doc.setDrawColor(215, 220, 226); doc.line(c2, y + rh, c3, y + rh); y += rh;
  }
  w.y = y + 3;
  // notes
  const notes = [h.notes, Number(h.delivery_fee) ? `Delivery ${h.delivery_date ? "on " + d8(h.delivery_date) : "date to be agreed"}.` : "", `${b.aftercare_days || 14}-day goodwill look-over (terms, clause 16).`].filter(Boolean).join("  ");
  kBox(w, L, w.y, FW, 10, "Notes", doc.splitTextToSize(notes, FW - 3).slice(0, 1)); w.y += 12;
  // acceptance
  kSec(w, "Acceptance of Terms");
  doc.setFont(w.f, "normal"); doc.setFontSize(6.8); doc.setTextColor(...DK);
  const acc = doc.splitTextToSize(`I/We acknowledge receipt of a copy of this order and accept the terms and conditions of sale overleaf, which form part of this contract. I confirm the known faults above were disclosed to me before I agreed to buy, and that the vehicle is used and priced for its age, mileage and condition. Ownership passes when the balance is paid in full. My statutory rights are not affected. We will use your details to deal with this sale and your aftercare; tick below if you are happy for us to contact you about other cars and offers.`, FW - 3);
  doc.text(acc, L + 1.5, w.y + 3.4, { lineHeightFactor: 1.25 }); w.y += acc.length * 2.95 + 2.6;
  // contact preferences
  doc.setFont(w.f, "bold"); doc.setFontSize(6.6); doc.text("Contact preferences", L + 1.5, w.y + 2.8);
  const prefs = h.contact_prefs || {}; let px0 = L + 30;
  for (const [k, lab] of [["post", "by Letter"], ["sms", "by SMS"], ["email", "by Email"], ["phone", "by Phone"]]) {
    doc.setFont(w.f, "normal"); doc.text(lab, px0, w.y + 2.8); doc.setDrawColor(...BOX); doc.rect(px0 + doc.getTextWidth(lab) + 1.2, w.y + 0.4, 2.8, 2.8);
    if (prefs[k]) { doc.setDrawColor(...DK); doc.setLineWidth(0.35); const bx = px0 + doc.getTextWidth(lab) + 1.2; doc.line(bx + 0.5, w.y + 1.9, bx + 1.2, w.y + 2.7); doc.line(bx + 1.2, w.y + 2.7, bx + 2.4, w.y + 0.9); doc.setLineWidth(0.15); }
    px0 += 24;
  }
  w.y += 5.5;
  // signatures
  const sig = h.signatures || {}, cs = sig.customer, ss = sig.staff, sh = 22;
  const cols = [[0.4, "Customer's Signature", "customer"], [0.15, "Date", "cd"], [0.45, "Sales Person's Signature", "staff"]];
  let x = L;
  for (const [fr, lab, key] of cols) {
    const cw = FW * fr; doc.setDrawColor(...BOX); doc.setFillColor(...GREYF); doc.rect(x, w.y, cw, 4.2, "FD"); doc.rect(x, w.y + 4.2, cw, sh);
    doc.setFont(w.f, "bold"); doc.setFontSize(6.4); doc.setTextColor(...DK); doc.text(lab, x + 1.2, w.y + 3);
    if (key !== "cd" && ctx.sigImages && ctx.sigImages[key]) sigImg(doc, ctx.sigImages[key], x + 2, w.y + 5, cw - 4, sh - 2);
    if (key === "cd" && cs) { doc.setFont(w.f, "normal"); doc.setFontSize(7.2); doc.text(dd(cs.at), x + 1.2, w.y + 4.2 + sh / 2 + 1); }
    x += cw;
  }
  w.y += 4.2 + sh;
  kc(w, L, w.y, FW * 0.55, 30, "Customer Print Name", cu.name); kc(w, L + FW * 0.55, w.y, FW * 0.45, 30, "Signed for", `${b.trading_name}${ss ? ` · ${dd(ss.at)}` : ""}`); w.y += 8.5;
  doc.setFont(w.f, "normal"); doc.setFontSize(6.2); doc.setTextColor(...LAB);
  const stamp = cs ? `Customer signed ${dt(cs.at)}${cs.method === "esign" ? ` by online e-signature (IP ${cs.ip || "recorded"})` : cs.device ? ` in person on ${cs.device}` : ""}. ${cs.doc_version || ""}` : "";
  doc.text(doc.splitTextToSize(`This document contains the terms of a contract and includes the terms and conditions overleaf. Sign it only if you wish to be legally bound by them.${stamp ? "  " + stamp : ""}`, FW), L, w.y, { lineHeightFactor: 1.25 });
};

SECTIONS.tcs = (w, ctx) => {
  const { doc } = w; const b = ctx.biz;
  kHead(w, "Terms and Conditions of Sale");
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
      if (y > bottom) { col++; y = top + 1; if (col > 2) { kHead(w, "Terms and Conditions of Sale (continued)"); doc.setFontSize(fs); doc.setTextColor(42, 52, 65); col = 0; } }
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
