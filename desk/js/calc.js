// Money calculations. Pure functions over records, so every figure on screen can show its working.
export const IN_TYPES = ["deposit", "part_payment", "balance"];
const sum = (a, f = x => x) => a.reduce((t, x) => t + (Number(f(x)) || 0), 0);
const r2 = n => Math.round(n * 100) / 100;

export function carFigures(car, txs, settings = {}) {
  const t = txs.filter(x => x.car_id === car.id);
  // Sale or return: the car isn't ours, so its "purchase" is the agreed amount we pay the owner when it sells.
  const sor = !!car.sor; const payout = sor ? Number(car.sor_payout) || 0 : 0;
  const ownerPaid = sum(t.filter(x => x.type === "sor_payout"), x => x.amount);
  const purchase = sor ? payout : sum(t.filter(x => x.type === "purchase"), x => x.amount);
  const expenses = sum(t.filter(x => x.type === "expense"), x => x.amount);
  const received = sum(t.filter(x => IN_TYPES.includes(x.type)), x => x.amount);
  const refunds = sum(t.filter(x => x.type === "refund"), x => x.amount);
  const cost = purchase + expenses;
  const sold = car.status === "sold";
  const salePrice = sold ? Number(car.sold_price) || 0 : 0;
  const px = sold ? Number(car.px_value) || 0 : 0;
  const owed = sold ? Math.max(0, r2(salePrice - px - (received - refunds))) : 0;
  const profit = sold ? r2(salePrice - cost - refunds) : null;
  const lines = [[sor ? "Agreed amount to owner (sale or return)" : "Purchase price", purchase], ["Preparation and other costs", expenses]];
  const cashTied = sor ? expenses : cost; const ownerOwed = sor && sold ? Math.max(0, r2(payout - ownerPaid)) : 0;
  let vat = null;
  if (sold && settings.vat_treatment === "margin_scheme") { const margin = Math.max(0, salePrice - purchase); vat = r2(margin / 6); }
  if (sold && settings.vat_treatment === "standard") vat = r2(salePrice / 6);
  return { sor, payout, ownerPaid, ownerOwed, cashTied, purchase, expenses, cost, received, refunds, owed, salePrice, px, profit, sold, vat, lines,
    working: sold ? `${fmt(salePrice)} sale − ${fmt(purchase)} ${sor ? "to owner" : "purchase"} − ${fmt(expenses)} costs${refunds ? ` − ${fmt(refunds)} refunds` : ""} = ${fmt(profit)}` : sor ? `Sale or return: nothing paid for the car. Cash tied up is just its costs, ${fmt(expenses)}. Owner gets ${fmt(payout)} when it sells.` : `Not sold yet. Cash tied up: ${fmt(purchase)} + ${fmt(expenses)} = ${fmt(cost)}` };
}
const fmt = n => (n < 0 ? "−£" : "£") + Math.abs(n).toLocaleString("en-GB", { maximumFractionDigits: 2 });

export function summary(cars, txs, settings, from, to) {
  const inRange = x => (!from || x.date >= from) && (!to || x.date <= to);
  const r = txs.filter(inRange);
  const received = sum(r.filter(x => IN_TYPES.includes(x.type)), x => x.amount) - sum(r.filter(x => x.type === "refund"), x => x.amount);
  const spent = sum(r.filter(x => ["purchase", "expense", "overhead"].includes(x.type) && x.method !== "part_exchange"), x => x.amount);
  const overheads = sum(r.filter(x => x.type === "overhead"), x => x.amount);
  const figs = cars.map(c => ({ car: c, f: carFigures(c, txs, settings) }));
  const owed = sum(figs, x => x.f.owed);
  const tied = sum(figs.filter(x => !x.f.sold && x.car.status !== "returned"), x => x.f.cashTied);
  const soldInRange = figs.filter(x => x.f.sold && (!from || (x.car.sold_date || "") >= from) && (!to || (x.car.sold_date || "") <= to));
  const grossProfit = sum(soldInRange, x => x.f.profit);
  return { received: r2(received), spent: r2(spent), overheads: r2(overheads), owed: r2(owed), tied: r2(tied), grossProfit: r2(grossProfit), netProfit: r2(grossProfit - overheads), soldCount: soldInRange.length, figs };
}

// Forecast: unsold stock only. Assumptions are editable and shown with the result.
export function forecast(cars, txs, settings, a) {
  const stock = cars.filter(c => c.status !== "sold");
  const rows = stock.map(c => {
    const f = carFigures(c, txs, settings);
    const price = (Number(c.asking_price) || 0) * (1 - (a.discount_pct || 0) / 100);
    const days = Math.max(0, (a.days_to_sell || 30) - ageDays(c));
    return { car: c, price: r2(price), cost: f.cost, profit: r2(price - f.cost), days };
  });
  const within = n => rows.filter(r => r.days <= n);
  const months = (a.horizon_days || 90) / 30;
  return {
    rows, assumptions: a,
    cashIn30: r2(sum(within(30), r => r.price)), cashIn60: r2(sum(within(60), r => r.price)), cashIn90: r2(sum(within(90), r => r.price)),
    profit: r2(sum(rows, r => r.profit)), overheads: r2((a.monthly_overheads || 0) * months),
    net: r2(sum(rows, r => r.profit) - (a.monthly_overheads || 0) * months),
  };
}
export function ageDays(c) { const d = c.purchase_date || (c.created_at || "").slice(0, 10); if (!d) return 0; return Math.max(0, Math.floor((Date.now() - new Date(d + "T12:00").getTime()) / 864e5)); }
export function avgDaysToSell(cars) {
  const s = cars.filter(c => c.status === "sold" && c.sold_date && c.purchase_date && !c.sample);
  if (s.length < 3) return null;
  return Math.round(sum(s, c => (new Date(c.sold_date) - new Date(c.purchase_date)) / 864e5) / s.length);
}

// Month-by-month profit and loss and cash, for the last `n` months (oldest first).
const ym = d => String(d || "").slice(0, 7);
export function monthKeys(n, offset = 0) { const out = []; const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset - (n - 1)); for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 7)); d.setMonth(d.getMonth() + 1); } return out; }
export const monthLabel = k => new Date(k + "-15").toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
export function monthly(cars, txs, settings, n = 12) {
  const real = cars.filter(c => !c.sample); const rtx = txs.filter(t => !t.sample);
  return monthKeys(n).map(k => {
    const sold = real.filter(c => c.status === "sold" && ym(c.sold_date) === k).map(c => ({ c, f: carFigures(c, rtx, settings) }));
    const t = rtx.filter(x => ym(x.date) === k);
    const revenue = sum(sold, x => x.f.salePrice), costOfSales = sum(sold, x => x.f.cost), gross = sum(sold, x => x.f.profit);
    const overheads = sum(t.filter(x => x.type === "overhead"), x => x.amount);
    const cashIn = sum(t.filter(x => IN_TYPES.includes(x.type)), x => x.amount) - sum(t.filter(x => x.type === "refund"), x => x.amount);
    const cashOut = sum(t.filter(x => ["purchase", "expense", "overhead", "sor_payout"].includes(x.type) && x.method !== "part_exchange"), x => x.amount);
    const bought = t.filter(x => x.type === "purchase").length;
    return { key: k, sold: sold.length, bought, revenue: r2(revenue), costOfSales: r2(costOfSales), gross: r2(gross), overheads: r2(overheads), net: r2(gross - overheads), cashIn: r2(cashIn), cashOut: r2(cashOut), cashNet: r2(cashIn - cashOut) };
  });
}

// Unsold stock: what each car has cost so far and what it should make.
export function stockValuation(cars, txs, settings) {
  const rows = cars.filter(c => !["sold", "returned"].includes(c.status) && !c.sample).map(c => {
    const f = carFigures(c, txs, settings); const ask = Number(c.asking_price) || 0;
    return { car: c, sor: f.sor, days: ageDays(c), cost: f.cashTied, asking: ask, margin: ask ? r2(ask - f.cost) : null, pct: ask && f.cost ? Math.round((ask - f.cost) / ask * 100) : null, noCost: !f.purchase };
  }).sort((a, b) => b.days - a.days);
  return { rows, cost: r2(sum(rows, r => r.cost)), asking: r2(sum(rows, r => r.asking)), margin: r2(sum(rows.filter(r => r.margin != null), r => r.margin)) };
}

// Forward projection, month by month. Every input is an editable assumption shown with the result.
export function projection(cars, txs, settings, a = {}) {
  const hist = monthly(cars, txs, settings, 6).filter(m => m.sold || m.overheads);
  const soldHist = hist.reduce((t, m) => t + m.sold, 0);
  const histPerMonth = hist.length ? soldHist / Math.max(1, hist.length) : null;
  const histProfit = soldHist ? hist.reduce((t, m) => t + m.gross, 0) / soldHist : null;
  const val = stockValuation(cars, txs, settings);
  const costed = val.rows.filter(r => r.margin != null && !r.noCost);
  const stockMargin = costed.length ? costed.reduce((t, r) => t + r.margin, 0) / costed.length : null;
  const perMonth = Number(a.cars_per_month) || Math.round((histPerMonth || 2) * 10) / 10;
  const perCar = Number(a.profit_per_car) || Math.round(histProfit || stockMargin || 400);
  const over = Number(a.monthly_overheads) || 0;
  const months = Math.min(24, Number(a.months) || 6);
  let cum = 0;
  const rows = monthKeys(months, months).map(k => { const gross = r2(perMonth * perCar), net = r2(gross - over); cum = r2(cum + net); return { key: k, cars: perMonth, gross, overheads: over, net, cumulative: cum }; });
  return { rows, perMonth, perCar, over, months, basis: { histPerMonth, histProfit, stockMargin }, total: cum };
}
