// Executive brief + forecast lab. Reads forecast.json (built by scripts/build_forecasts.py).
// Shares helpers (fmt, draw, layout, tile, ...) with app.js, which loads first.

let F = null, SEG = {}, FMONTHS = [];
const QI = { p05: 0, p10: 1, p25: 4, p50: 9, p75: 14, p90: 17, p95: 18 };   // positions in the stored 19 quantiles
const KIND = { total: "Total", family: "Parts vs appliances", type: "Product type", brand: "Brand", band: "Price band", product: "Product" };
const pmOf = (s) => (s.series.sales ? "sales" : "orders");
const esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sgn = (v, f) => (v >= 0 ? "+" : "−") + f(Math.abs(v));

Object.assign(state, {
  brief: { filter: "all", sortKey: "last12", sortDir: -1, pulse: "sales", target: null, rules: { invest: 0.7, risk: 0.7, floor: 4.0 } },
  lab: { seg: "total", metric: "sales", h: 12, view: "monthly", band: 80, demand: 0, price: 0, elast: -1.5, target: null, touched: false },
});

// ---------------------------------------------------------------- data prep
function prepForecast(data) {
  F = data;
  const [y, m] = F.meta.hist_from.split("-").map(Number), n = F.segments[0].hist.orders.length;
  FMONTHS = Array.from({ length: n }, (_, i) => { const t = y * 12 + (m - 1) + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; });
  F.segments.forEach((s) => { SEG[s.id] = s; derive(s); });
}

// P(total >= x) from the stored quantiles (linear between them, capped at the tails)
function probAtLeast(qv, x) {
  const p = F.meta.quantiles;
  if (x <= qv[0]) return 0.97;
  if (x >= qv.at(-1)) return 0.03;
  for (let i = 1; i < qv.length; i++) {
    if (x <= qv[i]) { const w = qv[i] === qv[i - 1] ? 0 : (x - qv[i - 1]) / (qv[i] - qv[i - 1]); return 1 - (p[i - 1] + w * (p[i] - p[i - 1])); }
  }
  return 0.03;
}
const lastN = (arr, n, off = 0) => arr.slice(arr.length - n - off, arr.length - off);
function weightedRating(s, n, off = 0) {
  let num = 0, den = 0;
  const r = lastN(s.hist.rating, n, off), o = lastN(s.hist.orders, n, off);
  r.forEach((v, i) => { if (v != null) { num += v * o[i]; den += o[i]; } });
  return den ? num / den : null;
}
const gradeOf = (w) => (w <= 0.15 ? "High" : w <= 0.30 ? "Medium" : "Low");

function derive(s) {
  const pm = pmOf(s), se = s.series[pm], h = s.hist, q = se.cumq[11];
  const last12 = sum(lastN(h[pm], 12)), prior12 = sum(lastN(h[pm], 12, 12)), fc12 = sum(se.fc.mean.slice(0, 12));
  const rNow = weightedRating(s, 12), rPrev = weightedRating(s, 12, 12);
  s.d = { pm, last12, prior12, fc12, lo12: q[QI.p10], hi12: q[QI.p90], growth: fc12 / last12 - 1, pGrowth: probAtLeast(q, last12),
    rNow, rPrev, dR: rNow != null && rPrev != null ? rNow - rPrev : null, grade: gradeOf(se.wmape), wmape: se.wmape };
}

function decide(s) {
  const d = s.d, R = state.brief.rules;
  const quality = (d.rNow != null && d.rNow < R.floor) || (d.dR != null && d.dR <= -0.10);
  let key = "watch", label = "Watch";
  if (d.pGrowth <= 1 - R.risk) { key = "risk"; label = "Risk"; }
  else if (quality && d.pGrowth >= 0.5) { key = "fix"; label = "Fix quality"; }
  else if (d.pGrowth >= R.invest && !quality) { key = "invest"; label = "Invest"; }
  return { key, label, tentative: d.grade === "Low" };
}
const ACTION_CLS = { invest: "good", fix: "warn", risk: "bad", watch: "info" };
const fmtPm = (s, v) => (s.d.pm === "sales" ? fmt.usdC(v) : fmt.intC(v) + " orders");
const gradeBadge = (g) => `<span class="badge ${g === "High" ? "good" : g === "Medium" ? "warn" : "bad"}">${g} confidence</span>`;

function parseMoney(txt) {
  const t = String(txt).trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)([kmb]?)$/);
  if (!m) return NaN;
  return +m[1] * ({ "": 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]]);
}

// ---------------------------------------------------------------- shared chart: actual vs expected
function monitorChart(id, mon, metric) {
  const x = mon.map((r) => r.month), isR = metric === "rating";
  const hov = metric === "sales" ? "%{y:$,.0f}" : metric === "orders" ? "%{y:,.0f}" : "%{y:.2f} ★";
  const out = mon.map((r) => r.actual > r.hi || r.actual < r.lo);
  draw(id, [
    { x, y: mon.map((r) => r.hi), mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    { x, y: mon.map((r) => r.lo), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(css("--c2"), 0.15), name: "Expected range", hoverinfo: "skip" },
    { x, y: mon.map((r) => r.expected), mode: "lines", name: "Expected", line: { color: css("--c2"), width: 2, dash: "dot" }, hovertemplate: hov },
    { x, y: mon.map((r) => r.actual), mode: "lines+markers", name: "Actual", line: line(css("--c1"), 2.5),
      marker: { size: out.map((o) => (o ? 11 : 7)), color: out.map((o) => (o ? css("--bad") : css("--c1"))), line: { color: css("--surface"), width: 2 } }, hovertemplate: hov },
  ], layout({ margin: { l: 8, r: 16, t: 28, b: 8 }, yaxis: { tickprefix: metric === "sales" ? "$" : "", tickformat: isR ? ".2f" : ".2~s", rangemode: isR ? "normal" : "tozero" } }));
}

function status(m, metric) {
  const above = m.actual > m.hi, below = m.actual < m.lo, diff = m.actual / m.expected - 1;
  return { above, below, diff, cls: above ? "good" : below ? "bad" : "info",
    text: above ? "Above expected range" : below ? "Below expected range" : "Within expected range", metric };
}

// ---------------------------------------------------------------- executive brief
function renderBrief() {
  const B = state.brief, t = SEG.total, d = t.d, se = t.series.sales, q12 = se.cumq[11];
  if (B.target == null) B.target = Math.round((d.last12 * 1.10) / 1e4) * 1e4;
  const pT = probAtLeast(q12, B.target), pG = d.pGrowth;
  const flat = Math.abs(d.growth) < 0.03;
  const asof = fmt.month(F.meta.last_month);
  const head = flat ? `As of ${asof}, sales were set to be roughly flat over the following 12 months`
    : `As of ${asof}, sales were set to ${d.growth > 0 ? "grow" : "shrink"} ${Math.abs(d.growth * 100).toFixed(0)}% over the following 12 months`;
  const gcol = pT >= 0.65 ? "var(--good)" : pT >= 0.35 ? "var(--c4)" : "var(--bad)";
  const gword = pT >= 0.65 ? "Likely" : pT >= 0.35 ? "Toss-up" : "Unlikely";
  const ang = Math.PI * Math.min(0.999, Math.max(0.001, pT)), gx = 66 - 52 * Math.cos(ang), gy = 66 - 52 * Math.sin(ang);
  $("verdict").innerHTML = `
    <div>
      <h2>${head}</h2>
      <p class="lead"><b>${fmt.usdC(d.fc12)}</b> expected, with a likely range of <b>${fmt.usdC(d.lo12)} to ${fmt.usdC(d.hi12)}</b>, compared with <b>${fmt.usdC(d.last12)}</b> in the 12 months to ${asof}.</p>
      <div class="badges">
        <span class="badge ${pG >= 0.65 ? "good" : pG >= 0.35 ? "warn" : "bad"}">${(pG * 100).toFixed(0)}% chance of beating last year</span>
        ${gradeBadge(d.grade)}
        <span class="badge">Typical forecast miss ±${(d.wmape * 100).toFixed(0)}%</span>
      </div>
    </div>
    <div class="vt">
      <div class="l">Annual target tracker</div>
      <div class="vt-input"><input id="briefTarget" type="text" inputmode="decimal" value="${fmt.usd(B.target)}" aria-label="Annual sales target"></div>
      <div class="quick" id="briefQuick">${[0, 5, 10, 15].map((p) => `<button type="button" class="chipbtn small" data-p="${p}">+${p}% vs last year</button>`).join("")}</div>
      <div class="gauge">
        <svg viewBox="0 0 132 78" role="img" aria-label="${(pT * 100).toFixed(0)} percent chance of reaching the target">
          <path d="M14 66 A52 52 0 0 1 118 66" fill="none" stroke="var(--grid)" stroke-width="12" stroke-linecap="round"/>
          <path d="M14 66 A52 52 0 0 1 ${gx.toFixed(1)} ${gy.toFixed(1)}" fill="none" stroke="${gcol}" stroke-width="12" stroke-linecap="round"/>
        </svg>
        <div><div class="gv">${(pT * 100).toFixed(0)}%</div><div class="gt"><b>${gword}</b> to reach ${fmt.usdC(B.target)}</div></div>
      </div>
    </div>`;
  $("briefTarget").onchange = (e) => { const v = parseMoney(e.target.value); if (Number.isFinite(v) && v > 0) { B.target = v; writeHash(); } renderBrief(); };
  $("briefQuick").onclick = (e) => { const b = e.target.closest("[data-p]"); if (!b) return; B.target = Math.round(d.last12 * (1 + b.dataset.p / 100)); writeHash(); renderBrief(); };

  renderNotices(); renderCompanyStrip();
  renderPulse(); renderDecisions(); renderScorecard();
}

function renderPulse() {
  const B = state.brief, m = B.pulse, t = SEG.total, se = t.series[m], mon = se.monitor, last = mon.at(-1), st = status(last, m);
  const f = m === "sales" ? fmt.usdC : m === "orders" ? fmt.int : (v) => v.toFixed(2) + " ★";
  $("pulseSub").textContent = `${fmt.month(last.month)}, whole category. The model's expectation uses data up to the month before.`;
  $("pulseStat").innerHTML = `<div class="pulse-stat"><span class="big">${f(last.actual)}</span>
    <span class="small">expected ${f(last.expected)} (${f(last.lo)} to ${f(last.hi)})</span>
    <span class="badge ${st.cls}">${st.above ? "▲" : st.below ? "▼" : "●"} ${st.text} · ${sgn(st.diff, (v) => (v * 100).toFixed(1) + "%")}</span></div>`;
  document.querySelectorAll("#pulseSeg button").forEach((b) => { const on = b.dataset.m === m; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  monitorChart("c-pulse", mon, m);

  // segments outside their expected range in the latest month
  const rows = F.segments.filter((s) => (s.kind === "brand" || s.kind === "band" || s.kind === "type")).map((s) => {
    const mm = (s.series.sales || s.series.orders).monitor.at(-1), metric = s.series.sales ? "sales" : "orders";
    return { s, mm, metric, ...status(mm, metric) };
  });
  const out = rows.filter((r) => r.above || r.below).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const totalOut = st.above || st.below;
  $("alertSub").textContent = `${out.length} of ${rows.length} brands, price bands and product types are outside the range the model expected in ${fmt.month(last.month)}.` +
    (totalOut && out.length > 3 ? " The whole category is also outside its range, so much of this is a market-wide move rather than separate problems." : "");
  $("alerts").innerHTML = out.length ? `<div class="alist">${out.slice(0, 6).map((r) => `
    <div class="arow" data-open="${r.s.id}" role="button" tabindex="0">
      <div><b>${esc2(r.s.label)}</b><small>${KIND[r.s.kind]} · ${fmt.month(r.mm.month)}: ${r.metric === "sales" ? fmt.usdC(r.mm.actual) : fmt.int(r.mm.actual)} vs expected ${r.metric === "sales" ? fmt.usdC(r.mm.expected) : fmt.int(r.mm.expected)}</small></div>
      <span class="badge ${r.above ? "good" : "bad"}">${r.above ? "▲" : "▼"} ${sgn(r.diff, (v) => (v * 100).toFixed(0) + "%")}</span></div>`).join("")}</div>`
    : `<p class="empty-note">Everything monitored is behaving as expected this month.</p>`;
}

function pickDecisions() {
  const cand = F.segments.filter((s) => s.kind !== "total" && s.kind !== "family").map((s) => ({ s, a: decide(s), inc: s.d.fc12 - s.d.last12 }));
  const best = (key, cmp) => {
    const all = cand.filter((c) => c.a.key === key);
    const solid = all.filter((c) => c.s.kind !== "product" && !c.a.tentative);
    return (solid.length ? solid : all).sort(cmp)[0];
  };
  return {
    invest: best("invest", (a, b) => b.inc - a.inc),
    risk: best("risk", (a, b) => a.inc - b.inc),
    fix: best("fix", (a, b) => b.s.d.last12 - a.s.d.last12),
  };
}

function renderDecisions() {
  const pk = pickDecisions(), cards = [];
  const card = (c, badgeCls, tag, title, body) => c
    ? `<button type="button" class="dcard" data-open="${c.s.id}"><span class="badge ${badgeCls}">${tag}</span><h4>${title}</h4><p>${body}</p><span class="go">Open in Forecast lab →</span></button>` : "";
  const empty = (tag, text) => `<div class="dcard empty"><span class="badge">${tag}</span><p>${text}</p></div>`;
  const tent = (c) => (c.a.tentative ? " <i>(tentative: low model confidence)</i>" : "");
  const r = (s) => (s.d.rNow != null ? `Rating ${s.d.rNow.toFixed(2)}${s.d.dR != null ? " (" + sgn(s.d.dR, (v) => v.toFixed(2)) + " vs last year)" : ""}.` : "");

  const i = pk.invest;
  cards.push(i ? card(i, "good", "Invest", `${esc2(i.s.label)}`, `Expected ${sgn(i.s.d.growth, (v) => (v * 100).toFixed(0) + "%")} (${sgn(i.inc, (v) => fmtPm(i.s, v))}) over 12 months, with a ${(i.s.d.pGrowth * 100).toFixed(0)}% chance of growth. ${r(i.s)}${tent(i)}`) : empty("Invest", "No segment clears the growth and rating bar under the current rules."));
  const x = pk.risk;
  cards.push(x ? card(x, "bad", "Risk", `${esc2(x.s.label)}`, `Expected ${sgn(x.s.d.growth, (v) => (v * 100).toFixed(0) + "%")} (${sgn(x.inc, (v) => fmtPm(x.s, v))}); only a ${(x.s.d.pGrowth * 100).toFixed(0)}% chance of growth. Worth reviewing price, availability and competition.${tent(x)}`) : empty("Risk", "No segment is likely to shrink under the current rules."));
  const fx = pk.fix;
  cards.push(fx ? card(fx, "warn", "Fix quality", `${esc2(fx.s.label)}`, `Sales are not the problem (${sgn(fx.s.d.growth, (v) => (v * 100).toFixed(0) + "%")}), satisfaction is. ${r(fx.s)} Look at what customers complain about before pushing more volume.${tent(fx)}`) : empty("Fix quality", "No growing segment has a low or falling rating under the current rules."));

  const si = SEG.total.series.sales.seasonal;
  if (si) {
    const hi = si.indexOf(Math.max(...si)), lo = si.indexOf(Math.min(...si)), M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    cards.push(`<button type="button" class="dcard" data-lab="seas"><span class="badge info">Plan for the season</span><h4>${M[hi]} is the peak</h4>
      <p>${M[hi]} runs ${((si[hi] - 1) * 100).toFixed(0)}% above an average month; ${M[lo]} is ${((1 - si[lo]) * 100).toFixed(0)}% below. Line up stock, staffing and promotions accordingly.</p><span class="go">See the seasonal pattern →</span></button>`);
  }
  $("decisions").innerHTML = cards.join("");
}

function renderScorecard() {
  const B = state.brief, k = B.sortKey, dir = B.sortDir;
  let list = F.segments.filter((s) => s.kind !== "total" && (B.filter === "all" || s.kind === B.filter || (B.filter === "type" && s.kind === "family"))).map((s) => ({ s, a: decide(s) }));
  const val = { label: (c) => c.s.label.toLowerCase(), last12: (c) => c.s.d.last12, fc12: (c) => c.s.d.fc12, growth: (c) => c.s.d.growth, pGrowth: (c) => c.s.d.pGrowth,
    rNow: (c) => c.s.d.rNow ?? -1, wmape: (c) => c.s.d.wmape, action: (c) => ["invest", "fix", "watch", "risk"].indexOf(c.a.key) };
  list.sort((a, b) => { const x = val[k](a), y = val[k](b); return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir; });
  const cols = [["label", "Segment"], ["last12", "Last 12 mo"], ["fc12", "Following 12 mo"], ["growth", "Change"], ["pGrowth", "Chance of growth"], ["rNow", "Rating"], ["wmape", "Confidence"], ["action", "Suggested action"]];
  const head = cols.map(([key, l]) => `<th class="sortable${key === k ? " sorted" : ""}${key === "label" ? "" : " n"}" data-sort="${key}">${l}${key === k ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  const body = list.map(({ s, a }) => {
    const d = s.d, arrow = d.dR == null ? "" : d.dR <= -0.05 ? " ▼" : d.dR >= 0.05 ? " ▲" : "";
    return `<tr class="click" data-open="${s.id}"><td><b>${esc2(s.label)}</b><span class="sub2">${KIND[s.kind]}${d.pm === "orders" ? " · no price data, shown in orders" : ""}</span></td>
      <td class="n">${fmtPm(s, d.last12)}</td><td class="n">${fmtPm(s, d.fc12)}</td>
      <td class="n">${deltaChip(d.growth, pctTxt)}</td>
      <td class="n">${(d.pGrowth * 100).toFixed(0)}%</td>
      <td class="n">${d.rNow != null ? d.rNow.toFixed(2) + arrow : "–"}</td>
      <td class="n">${d.grade}</td>
      <td class="n"><span class="badge ${ACTION_CLS[a.key]}">${a.label}</span>${a.tentative ? '<span class="sub2">tentative</span>' : ""}</td></tr>`;
  }).join("");
  $("scorecard").innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="8">No segments.</td></tr>'}</tbody>`;
  document.querySelectorAll("#scFilter button").forEach((b) => b.classList.toggle("on", b.dataset.k === B.filter));
}

// ---------------------------------------------------------------- forecast lab
function openLab(id, scrollTo) {
  const L = state.lab; L.seg = id; L.metric = pmOf(SEG[id]); L.touched = false; L.target = null;
  goTab("lab");
  if (scrollTo) setTimeout(() => $(scrollTo).scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" }), 150);
}

function labCtx() {
  const L = state.lab, s = SEG[L.seg];
  if (!s.series[L.metric]) L.metric = pmOf(s);
  const m = L.metric, se = s.series[m], h = L.h, isR = m === "rating";
  const p = L.price / 100, d = L.demand / 100;
  const mult = m === "sales" ? (1 + d) * Math.pow(1 + p, 1 + L.elast) : m === "orders" ? (1 + d) * Math.pow(1 + p, L.elast) : 1;
  const hist = s.hist[m], base = se.fc.mean.slice(0, h);
  const lastH = isR ? weightedRating(s, h) : sum(lastN(hist, h));
  const baseTotal = isR ? mean(base) : sum(base), cq = se.cumq[h - 1], cum = isR ? cq.map((v) => v / h) : cq;
  if (!L.touched || L.target == null) L.target = isR ? lastH : (() => { const step = lastH > 1e5 ? 1e4 : lastH > 1e3 ? 100 : 1; return Math.round(lastH * 1.10 / step) * step; })();
  return { L, s, m, se, h, isR, mult, hist, base, lastH, baseTotal, cum, scen: mult !== 1 };
}

function labFmt(m, v, compact = true) {
  return m === "sales" ? (compact ? fmt.usdC(v) : fmt.usd(v)) : m === "orders" ? (compact ? fmt.intC(v) : fmt.int(v)) : v.toFixed(2) + " ★";
}

function renderLab() {
  const c = labCtx(), { L, s, m, se, h, isR, mult, scen, base } = c;
  const name = { sales: "Sales proxy", orders: "Orders", rating: "Average rating" }[m];
  const scaled = (a) => a.map((v) => v * mult);
  const bandKeys = L.band === 95 ? ["p05", "p95"] : ["p10", "p90"], bi = L.band === 95 ? [QI.p05, QI.p95] : [QI.p10, QI.p90];
  const fx = se.fc.month.slice(0, h), nH = 36;
  const hx = FMONTHS.slice(-nH), hy = c.hist.slice(-nH);
  const hov = m === "sales" ? "%{y:$,.0f}" : m === "orders" ? "%{y:,.0f}" : "%{y:.2f} ★";
  const VIOLET = "#8a6fd6";

  $("labTitle").textContent = `${s.label}: ${name.toLowerCase()}, ${h} months after ${fmt.month(F.meta.last_month)}`;
  $("labSub").textContent = `${L.view === "cum" && !isR ? "Running total from the first forecast month. " : ""}Shaded area is the ${L.band}% range; hover for values.${scen ? " Purple shows your scenario." : ""}`;

  if (L.view === "cum" && !isR) {
    const cumMean = base.reduce((a, v, i) => (a.push((a[i - 1] || 0) + v), a), []);
    const lo = se.cumq.slice(0, h).map((r) => r[bi[0]] * mult), hi = se.cumq.slice(0, h).map((r) => r[bi[1]] * mult);
    const ly = []; let acc = 0; for (let i = 0; i < h; i++) { acc += i < 12 ? c.hist.at(-12 + i) : se.fc.mean[i - 12]; ly.push(acc); }
    const tr = [
      { x: fx, y: hi, mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
      { x: fx, y: lo, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(css("--c2"), 0.15), name: `${L.band}% range`, hoverinfo: "skip" },
      { x: fx, y: ly, mode: "lines", name: "Same period last year", line: { color: css("--muted"), width: 1.8, dash: "dot" }, hovertemplate: hov },
      { x: fx, y: cumMean, mode: "lines", name: "Expected", line: line(css("--c2"), 2.6), hovertemplate: hov },
    ];
    if (scen) tr.push({ x: fx, y: scaled(cumMean), mode: "lines", name: "Scenario", line: { color: VIOLET, width: 2.6, dash: "dash" }, hovertemplate: hov });
    tr.push(dot(fx.at(-1), (scen ? scaled(cumMean) : cumMean).at(-1), scen ? VIOLET : css("--c2")));
    draw("c-lab", tr, layout({
      margin: { l: 8, r: 28, t: 28, b: 8 }, yaxis: { tickprefix: m === "sales" ? "$" : "", tickformat: ".2~s", rangemode: "tozero" },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: L.target, y1: L.target, line: { color: css("--ink"), width: 1.5, dash: "dash" } }],
      annotations: [{ xref: "paper", x: 0, y: L.target, yref: "y", text: `Target ${labFmt(m, L.target)}`, showarrow: false, xanchor: "left", yanchor: "bottom", font: { color: css("--ink"), size: 12 } }],
    }));
  } else {
    const tr = [
      { x: hx, y: hy.map((v) => v), name: "Actual", mode: "lines", line: line(css("--c1"), 2.5), hovertemplate: hov, connectgaps: true },
      { x: fx, y: scaled(se.fc[bandKeys[1]].slice(0, h)), mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
      { x: fx, y: scaled(se.fc[bandKeys[0]].slice(0, h)), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(css("--c2"), 0.15), name: `${L.band}% range`, hoverinfo: "skip" },
      { x: fx, y: base, name: "Expected", mode: "lines", line: { color: css("--c2"), width: 2.6, dash: "dash" }, hovertemplate: hov },
      { x: FMONTHS.slice(-12), y: se.backtest.mean.slice(0, 12), name: "Backtest", mode: "lines", line: { color: css("--muted"), width: 1.6, dash: "dot" }, hovertemplate: hov },
    ];
    if (scen) tr.push({ x: fx, y: scaled(c.base), name: "Scenario", mode: "lines", line: { color: VIOLET, width: 2.6 }, hovertemplate: hov });
    tr.push(dot(fx.at(-1), (scen ? scaled(c.base) : c.base).at(-1), scen ? VIOLET : css("--c2")));
    const last = FMONTHS.at(-1);
    draw("c-lab", tr, layout({
      margin: { l: 8, r: 24, t: 28, b: 8 },
      yaxis: { tickprefix: m === "sales" ? "$" : "", tickformat: isR ? ".1f" : ".2~s", rangemode: isR ? "normal" : "tozero" },
      shapes: [{ type: "line", xref: "x", yref: "paper", x0: last, x1: last, y0: 0, y1: 1, line: { color: css("--axis"), width: 1, dash: "dot" } }],
      annotations: [{ x: last, y: 1, yref: "paper", text: "Forecast starts", showarrow: false, xanchor: "left", xshift: 6, yshift: -4, font: { color: css("--muted"), size: 11.5 } }],
    }));
  }
  renderNotices(); renderLabTiles(c); renderBridge(c); renderSeasonal(c); renderPlan(c); renderTrust(c);
  syncLabUI(c);
}

function renderLabTiles(c) {
  const { L, m, h, isR, mult, scen, cum, lastH, baseTotal } = c;
  const total = baseTotal * mult;
  const lo = cum[QI.p10] * mult, hi = cum[QI.p90] * mult;
  const tgt = isR ? lastH : L.target, pT = probAtLeast(isR ? cum.map((v) => v * mult) : cum.map((v) => v * mult), tgt);
  const word = pT >= 0.65 ? "Likely" : pT >= 0.35 ? "Toss-up" : "Unlikely";
  const se = c.se, g = se.wmape, grade = gradeOf(g);
  const unitFmt = (v) => labFmt(m, v);
  $("labTiles").innerHTML = [
    tile({ label: isR ? `Expected rating, ${h} mo after ${fmt.month(F.meta.last_month)}` : `Expected, ${h} mo after ${fmt.month(F.meta.last_month)}${scen ? " (scenario)" : ""}`, value: unitFmt(total),
      delta: deltaChip(total / lastH - 1, pctTxt), sub: `vs last ${h} mo${scen ? ` · base ${unitFmt(baseTotal)}` : ""}` }),
    tile({ label: "Likely range (80%)", value: `${unitFmt(lo)} – ${unitFmt(hi)}`, sub: "10th to 90th percentile" }),
    tile({ label: isR ? "Chance rating improves" : "Chance of reaching target", value: `${(pT * 100).toFixed(0)}%`, sub: `${word}${isR ? "" : " · target " + unitFmt(L.target)}` }),
    tile({ label: "Model reliability", value: `±${(g * 100).toFixed(0)}%`, sub: `${grade} confidence · typical monthly miss` }),
  ].join("");
}

function renderBridge(c) {
  const { s, m, h, L, se, mult, scen } = c;
  const ctn = $("c-bridge");
  if (m === "sales" && s.series.orders) {
    $("bridgeSub").textContent = `Is growth coming from more orders or from higher prices and mix? (next ${h} months vs last ${h})`;
    const oSe = s.series.orders, Ol = sum(lastN(s.hist.orders, h)), Sl = sum(lastN(s.hist.sales, h));
    const Of = sum(oSe.fc.mean.slice(0, h)), Sf = sum(se.fc.mean.slice(0, h));
    const aovL = Sl / Ol, vol = (Of - Ol) * aovL, price = Sf - Sl - vol;
    const xs = [`Last ${h} mo`, "More/fewer orders", "Price & mix", `Expected`], ys = [Sl, vol, price, Sf], meas = ["absolute", "relative", "relative", "total"];
    if (scen) { xs.push("Scenario effect", "Scenario"); ys.push(Sf * mult - Sf, Sf * mult); meas.push("relative", "total"); }
    draw("c-bridge", [{ type: "waterfall", x: xs, y: ys, measure: meas, connector: { line: { color: css("--axis"), width: 1 } },
      increasing: { marker: { color: css("--c1") } }, decreasing: { marker: { color: "#e34948" } }, totals: { marker: { color: css("--muted") } },
      text: ys.map((v, i) => (meas[i] === "relative" ? sgn(v, fmt.usdC) : fmt.usdC(v))), textposition: "outside", textfont: { color: css("--ink2"), size: 12 }, cliponaxis: false,
      hovertemplate: "%{x}: %{text}<extra></extra>" }],
      layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 8, t: 26, b: 8 }, yaxis: { tickprefix: "$", tickformat: ".2~s", rangemode: "tozero" } }));
  } else {
    $("bridgeSub").textContent = "Expected change versus the same month last year.";
    const fx = se.fc.month.slice(0, h), ly = fx.map((_, i) => (i < 12 ? c.hist.at(-12 + i) : se.fc.mean[i - 12]));
    const delta = fx.map((_, i) => se.fc.mean[i] * mult - ly[i]), isR = m === "rating";
    draw("c-bridge", [{ x: fx, y: delta, type: "bar", marker: { color: delta.map((v) => (v >= 0 ? css("--c1") : "#e34948")), cornerradius: 3 },
      hovertemplate: isR ? "%{y:+.2f} ★<extra></extra>" : "%{y:+,.0f}<extra></extra>" }],
      layout({ hovermode: "closest", showlegend: false, bargap: 0.25, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickformat: isR ? "+.2f" : "+.2~s" } }));
  }
}

function renderSeasonal(c) {
  const { se, m } = c, si = se.seasonal, M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!si || Math.max(...si) - Math.min(...si) < 0.04) {
    $("seasSub").textContent = "No meaningful seasonal pattern for this measure.";
    Plotly.purge("c-seas"); $("c-seas").innerHTML = '<p class="empty-note" style="padding:24px">The month-to-month swings here are too small to plan around.</p>'; return;
  }
  if ($("c-seas").querySelector("p.empty-note")) $("c-seas").innerHTML = "";
  const hi = si.indexOf(Math.max(...si)), lo = si.indexOf(Math.min(...si));
  $("seasSub").textContent = `${M[hi]} runs ${((si[hi] - 1) * 100).toFixed(0)}% above an average month; ${M[lo]} is ${((1 - si[lo]) * 100).toFixed(0)}% below.`;
  const dv = si.map((v) => v - 1);
  draw("c-seas", [{ x: M, y: dv, type: "bar", marker: { color: dv.map((v) => (v >= 0 ? css("--c1") : rgba(css("--c1"), 0.3))), cornerradius: 4 },
    text: dv.map((v) => sgn(v, (x) => (x * 100).toFixed(0) + "%")), textposition: "outside", textfont: { color: css("--ink2"), size: 11.5 }, cliponaxis: false,
    hovertemplate: "%{x}: %{text} vs an average month<extra></extra>" }],
    layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 8, t: 22, b: 8 }, yaxis: { tickformat: "+.0%" } }));
}

function planRows(c) {
  const { se, h, m, mult, hist } = c;
  return se.fc.month.slice(0, h).map((mo, i) => {
    const base = se.fc.mean[i], ly = i < 12 ? hist.at(-12 + i) : se.fc.mean[i - 12];
    return { month: mo, base, lo: se.fc.p10[i], hi: se.fc.p90[i], scen: base * mult, ly, vs: ly ? base * mult / ly - 1 : NaN };
  });
}
function renderPlan(c) {
  const { m, scen } = c, rows = planRows(c), f = (v) => labFmt(m, v, false);
  $("plan").innerHTML = `<thead><tr><th>Month</th><th class="n">Expected</th><th class="n">Low case</th><th class="n">High case</th>${scen ? '<th class="n">Scenario</th>' : ""}<th class="n">vs same month last year</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${fmt.month(r.month)}</td><td class="n">${f(r.base)}</td><td class="n">${f(r.lo)}</td><td class="n">${f(r.hi)}</td>${scen ? `<td class="n">${f(r.scen)}</td>` : ""}<td class="n">${deltaChip(r.vs, pctTxt)}</td></tr>`).join("") + "</tbody>";
}

function renderTrust(c) {
  const { se, m, s } = c, g = se.wmape, grade = gradeOf(g), b = se.bias, cov = se.coverage80;
  const verdict = { High: "Reliable enough to plan budgets against.", Medium: "Plan against the range, not the single number.", Low: "Directional only: use it to rank and watch, not to budget." }[grade];
  $("trustSub").textContent = `${s.label} · ${verdict}`;
  const biasTxt = Math.abs(b) < 0.03 ? "No consistent bias" : `Ran ${(Math.abs(b) * 100).toFixed(0)}% ${b > 0 ? "high" : "low"}`;
  const biasSub = Math.abs(b) < 0.03 ? "over- and under-shoots cancel out" : b > 0 ? "past forecasts were optimistic; consider the lower half of the range" : "past forecasts were cautious; upside is plausible";
  $("trust").innerHTML = [
    ["Model chosen", se.model, "best of 4 on unseen data"],
    ["Typical monthly miss", `±${(g * 100).toFixed(0)}%`, `${grade} confidence`],
    ["Direction of error", biasTxt, biasSub],
    ["Range reliability", cov == null ? "n/a" : `${Math.round(cov * 10)} in 10`, "backtest outcomes inside the 80% range (aim: 8)"],
  ].map(([l, v, sub]) => `<div class="tg"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join("");
  if (se.monitor) { if ($("c-monitor").querySelector("p")) $("c-monitor").innerHTML = ""; monitorChart("c-monitor", se.monitor, m); }
  else { Plotly.purge("c-monitor"); $("c-monitor").innerHTML = '<p class="empty-note" style="padding:20px">Month-by-month monitoring is available for the total, brands and price bands.</p>'; }
}

function syncLabUI(c) {
  const L = state.lab, s = SEG[L.seg];
  $("labSeg").value = L.seg;
  document.querySelectorAll("#labMetric button").forEach((b) => {
    const has = !!s.series[b.dataset.m], on = b.dataset.m === L.metric;
    b.disabled = !has; b.style.opacity = has ? "" : ".4"; b.classList.toggle("on", on); b.setAttribute("aria-checked", on);
  });
  document.querySelectorAll("#labView button").forEach((b) => b.classList.toggle("on", b.dataset.v === L.view));
  document.querySelectorAll("#labBand button").forEach((b) => b.classList.toggle("on", b.dataset.b === String(L.band)));
  $("labH").value = L.h; $("labHLabel").textContent = L.h + " months";
  const isR = L.metric === "rating";
  $("labTarget").closest(".field").style.display = isR ? "none" : "";
  $("labTarget").value = isR ? "" : labFmt(L.metric, L.target, false);
  $("labView").closest(".field").style.display = isR ? "none" : "";
  $("scenarioBox").style.display = isR ? "none" : "";
  $("lDemand").value = L.demand; $("lDemandL").textContent = sgn(L.demand, (v) => v + "%").replace("+0%", "0%").replace("−0%", "0%");
  $("lPrice").value = L.price; $("lPriceL").textContent = L.price === 0 ? "0%" : sgn(L.price, (v) => v + "%");
  $("lElast").value = L.elast; $("lElastL").textContent = L.elast.toFixed(1).replace("-", "−");
  const active = L.demand !== 0 || L.price !== 0;
  $("scenarioTag").textContent = active ? `· active (${L.metric === "sales" ? "sales" : "orders"} ${sgn((c.mult - 1), (v) => (v * 100).toFixed(1) + "%")})` : "";
  const o = Math.pow(1 + L.price / 100, L.elast), sl = Math.pow(1 + L.price / 100, 1 + L.elast);
  $("scenarioNote").textContent = `Price ${L.price >= 0 ? "+" : "−"}${Math.abs(L.price)}% with elasticity ${L.elast.toFixed(1)}: orders ${sgn(o - 1, (v) => (v * 100).toFixed(1) + "%")}, sales ${sgn(sl - 1, (v) => (v * 100).toFixed(1) + "%")} (before the demand shift). Elasticity is your assumption, not measured from this data.`;
}

function labWriteHash(p) {
  const L = state.lab, B = state.brief;
  if (L.seg !== "total") p.set("seg", L.seg);
  if (L.metric !== pmOf(SEG[L.seg])) p.set("lm", L.metric);
  if (L.h !== 12) p.set("lh", L.h);
  if (L.view !== "monthly") p.set("lv", L.view);
  if (L.band !== 80) p.set("lb", L.band);
  if (L.demand) p.set("ld", L.demand);
  if (L.price) p.set("lp", L.price);
  if (L.elast !== -1.5) p.set("le", L.elast);
  if (L.touched && L.target != null) p.set("lt", Math.round(L.target * 100) / 100);
  if (B.target != null) p.set("bt", Math.round(B.target));
}
function labReadHash(p) {
  const L = state.lab, B = state.brief, num = (k, d, a, b) => { const v = parseFloat(p.get(k)); return Number.isFinite(v) && v >= a && v <= b ? v : d; };
  if (SEG[p.get("seg")]) L.seg = p.get("seg");
  const mt = p.get("lm"); L.metric = SEG[L.seg].series[mt] ? mt : pmOf(SEG[L.seg]);
  L.h = Math.round(num("lh", 12, 3, 24)); L.view = p.get("lv") === "cum" ? "cum" : "monthly"; L.band = p.get("lb") === "95" ? 95 : 80;
  L.demand = num("ld", 0, -30, 30); L.price = num("lp", 0, -20, 20); L.elast = num("le", -1.5, -3, 0);
  if (p.get("lt")) { L.target = num("lt", null, 0, 1e12); L.touched = L.target != null; }
  if (p.get("bt")) B.target = num("bt", null, 0, 1e12);
}

function initLab() {
  const L = state.lab, B = state.brief;
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-go-tab]"); if (b) goTab(b.dataset.goTab); });
  // segment picker
  const groups = [["total", "Whole category"], ["family", "Parts vs appliances"], ["type", "Product types"], ["brand", "Brands"], ["band", "Price bands"], ["product", "Top products"]];
  $("labSeg").innerHTML = groups.map(([k, t]) => `<optgroup label="${t}">${F.segments.filter((s) => s.kind === k).map((s) => `<option value="${s.id}">${esc2(s.label)}</option>`).join("")}</optgroup>`).join("");
  const redo = () => { writeHash(); renderLab(); };
  $("labSeg").onchange = (e) => { L.seg = e.target.value; L.metric = pmOf(SEG[L.seg]); L.touched = false; redo(); };
  $("labMetric").onclick = (e) => { const b = e.target.closest("button"); if (b && !b.disabled) { L.metric = b.dataset.m; L.touched = false; redo(); } };
  $("labH").oninput = (e) => { L.h = +e.target.value; if (!L.touched) L.target = null; redo(); };
  $("labView").onclick = (e) => { const b = e.target.closest("button"); if (b) { L.view = b.dataset.v; redo(); } };
  $("labBand").onclick = (e) => { const b = e.target.closest("button"); if (b) { L.band = +b.dataset.b; redo(); } };
  $("labTarget").onchange = (e) => { const v = parseMoney(e.target.value); if (Number.isFinite(v) && v > 0) { L.target = v; L.touched = true; } redo(); };
  [["lDemand", "demand"], ["lPrice", "price"], ["lElast", "elast"]].forEach(([id, k]) => { $(id).oninput = (e) => { L[k] = +e.target.value; redo(); }; });
  $("scenarioReset").onclick = () => { L.demand = 0; L.price = 0; L.elast = -1.5; redo(); };
  $("planCsv").onclick = () => {
    const c = labCtx(), rows = planRows(c);
    const csv = ["month,expected,low_case,high_case,scenario,vs_same_month_last_year"].concat(rows.map((r) => [r.month, r.base, r.lo, r.hi, r.scen, r.vs].join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `plan-${L.seg.replace(/\W+/g, "-")}-${L.metric}.csv`; a.click(); URL.revokeObjectURL(a.href); toast("Plan downloaded");
  };

  // brief interactions (delegated, elements are re-rendered)
  $("pulseSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { B.pulse = b.dataset.m; renderPulse(); } };
  const open = (e) => { const t = e.target.closest("[data-open]"); if (t) openLab(t.dataset.open); const g = e.target.closest("[data-lab]"); if (g) { state.lab.seg = "total"; state.lab.metric = "sales"; goTab("lab"); setTimeout(() => $("c-seas").scrollIntoView({ behavior: "smooth", block: "center" }), 200); } };
  $("alerts").onclick = open; $("decisions").onclick = open;
  $("scorecard").onclick = (e) => {
    const th = e.target.closest("[data-sort]");
    if (th) { const k = th.dataset.sort; B.sortDir = B.sortKey === k ? -B.sortDir : (k === "label" ? 1 : -1); B.sortKey = k; renderScorecard(); return; }
    open(e);
  };
  $("scFilter").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { B.filter = b.dataset.k; renderScorecard(); } };
  [["ruleInvest", "invest", (v) => v + "%"], ["ruleRisk", "risk", (v) => v + "%"], ["ruleFloor", "floor", (v) => (+v).toFixed(1) + " ★"]].forEach(([id, k, f]) => {
    $(id).oninput = (e) => { B.rules[k] = k === "floor" ? +e.target.value : e.target.value / 100; $(id + "L").textContent = f(e.target.value); renderDecisions(); renderScorecard(); };
  });
}
