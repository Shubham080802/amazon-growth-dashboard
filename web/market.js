// "Market & company" tab: Amazon's own results (SEC filings), the wider market (Census/BLS via FRED),
// and an honest freshness report. Reads market.json (built by scripts/build_market_data.py).

let MK = null;
const FROM_Q = "2016-01";                       // how far back the quarterly charts go
const qLabel = (q) => `Q${(+q.slice(5, 7) - 1) / 3 + 1} ${q.slice(0, 4)}`;
const bn = (m) => "$" + (m / 1e3).toFixed(1) + "B";                       // $ millions -> "$200.6B"
const monthsAgo = (ym, add = 0) => { const n = new Date(); return n.getFullYear() * 12 + n.getMonth() - ((+ym.slice(0, 4)) * 12 + (+ym.slice(5, 7) - 1 + add)); };
const ageText = (m) => (m <= 0 ? "this month" : m === 1 ? "1 month ago" : m < 24 ? `${m} months ago` : `${(m / 12).toFixed(1)} years ago`);
const ageBadge = (m) => (m <= 4 ? '<span class="badge good">Current</span>' : m <= 12 ? '<span class="badge warn">Ageing</span>' : '<span class="badge bad">Out of date</span>');

function prepMarket(d) { MK = d; }

// year-over-year growth of a FRED series (lag 4 quarters or 12 months)
function fredYoy(id) {
  const s = MK.fred[id], lag = s.freq === "Q" ? 4 : 12;
  return { x: s.dates.slice(lag), y: s.values.slice(lag).map((v, i) => v / s.values[i] - 1) };
}
const fredLast = (id) => { const s = MK.fred[id]; return { date: s.dates.at(-1), v: s.values.at(-1) }; };
const fredLatestYoy = (id) => { const g = fredYoy(id); return { date: g.x.at(-1), v: g.y.at(-1) }; };

// the "category data is old" notice, shown on the tabs that depend on it
function renderNotices() {
  if (!F || !MK) return;
  const asof = fmt.month(F.meta.last_month), age = monthsAgo(F.meta.last_month);
  const latest = MK.fred.RSNSR.dates.at(-1);
  const html = `<span class="n-ic" aria-hidden="true">ⓘ</span><div><b>The category data ends ${asof}</b> (${ageText(age)}). Forecast months here are what the model saw from that date, not from today.
    For where Amazon and the market stand now (through ${fmt.month(latest)}), see <button type="button" class="linkbtn" data-go-tab="market">Market &amp; company</button>.</div>`;
  ["asofBrief", "asofLab"].forEach((id) => { const el = $(id); if (el) el.innerHTML = html; });
}

// thin "current company check" strip on the executive brief
function renderCompanyStrip() {
  if (!MK) return;
  const Q = MK.amazon.quarters, last = Q.at(-1), prior = Q.at(-5), g = MK.amazon.release.guidance;
  $("companyStrip").innerHTML = `
    <div class="cs-l"><span class="cs-tag">Amazon right now</span><b>${qLabel(last.q)}</b></div>
    <div><span class="cs-k">Net sales</span><b>${bn(last.revenue)}</b> ${deltaChip(last.revenue / prior.revenue - 1, pctTxt)}</div>
    <div><span class="cs-k">Operating income</span><b>${bn(last.operating_income)}</b> <span class="cs-sub">${((last.operating_income / last.revenue) * 100).toFixed(1)}% margin</span></div>
    <div><span class="cs-k">${qLabel(g.quarter)} guidance</span><b>${bn(g.sales_lo)} to ${bn(g.sales_hi)}</b></div>
    <button type="button" class="linkbtn" data-go-tab="market">Full picture →</button>`;
}

function renderMarket() {
  const A = MK.amazon, Q = A.quarters, last = Q.at(-1), rel = A.release, fc = A.forecast;
  const rev = Q.map((r) => r.revenue), at = (i) => Q[Q.length + i];
  const ttm = (k, off = 0) => sum(Q.slice(Q.length - 4 - off, Q.length - off).map((r) => r[k]));
  const prior = at(-5);

  // ---- freshness report
  const rows = [
    ["Category reviews (Amazon Appliances)", "Amazon Reviews 2023, UC San Diego", F.meta.last_month, fmt.month(F.meta.last_month), monthsAgo(F.meta.last_month), "No newer release exists; this drives the category forecasts"],
    ["Amazon financial results", "SEC EDGAR filings (10-Q, 10-K)", last.q, `${qLabel(last.q)} (to ${["31 Mar", "30 Jun", "30 Sep", "31 Dec"][(+last.q.slice(5, 7) - 1) / 3]} ${last.q.slice(0, 4)})`, monthsAgo(last.q, 2), "Official, audited-quarter figures"],
    ["U.S. e-commerce sales", "U.S. Census Bureau via FRED", MK.fred.ECOMSA.dates.at(-1), qLabel(MK.fred.ECOMSA.dates.at(-1)), monthsAgo(MK.fred.ECOMSA.dates.at(-1), 2), "Quarterly"],
    ["Retail sales and appliance prices", "Census Bureau and BLS via FRED", MK.fred.RSNSR.dates.at(-1), fmt.month(MK.fred.RSNSR.dates.at(-1)), monthsAgo(MK.fred.RSNSR.dates.at(-1)), "Monthly"],
  ];
  $("fresh").innerHTML = `<table><thead><tr><th>Source</th><th>Publisher</th><th>Latest data</th><th>Age</th><th></th></tr></thead><tbody>` +
    rows.map(([n, p, , latest, age, note]) => `<tr><td><b>${n}</b><span class="sub2">${note}</span></td><td>${p}</td><td>${latest}</td><td>${ageText(age)}</td><td>${ageBadge(age)}</td></tr>`).join("") + "</tbody></table>";

  // ---- Amazon tiles
  const yoy = last.revenue / prior.revenue - 1, mNow = last.operating_income / last.revenue, mPrev = prior.operating_income / prior.revenue;
  $("amzTiles").innerHTML = [
    tile({ label: `Net sales, ${qLabel(last.q)}`, value: bn(last.revenue), delta: deltaChip(yoy, pctTxt), sub: "vs a year earlier", spark: sparkline(Q.slice(-12).map((r) => r.revenue)) }),
    tile({ label: "Operating income", value: bn(last.operating_income), delta: deltaChip((mNow - mPrev) * 100, numTxt(" pts", 1)), sub: `${(mNow * 100).toFixed(1)}% margin`, spark: sparkline(Q.slice(-12).map((r) => r.operating_income)) }),
    tile({ label: "Net sales, last 4 quarters", value: bn(ttm("revenue")), delta: deltaChip(ttm("revenue") / ttm("revenue", 4) - 1, pctTxt), sub: "vs the 4 before" }),
    tile({ label: "Capital spending, last 4 quarters", value: bn(ttm("capex")), delta: deltaChip(ttm("capex") / ttm("capex", 4) - 1, pctTxt, false), sub: "vs the 4 before" }),
  ].join("");

  // ---- revenue chart with forecast
  const hist = Q.filter((r) => r.q >= FROM_Q), hx = hist.map((r) => qLabel(r.q)), fx = fc.fc.month.map(qLabel);
  const all = [...hx, ...fx];
  const tv = all.filter((l) => l.startsWith("Q1")), ttxt = tv.map((l) => l.slice(3));
  const B = (a) => a.map((v) => v / 1e3);
  draw("c-amz-rev", [
    { x: hx, y: B(hist.map((r) => r.revenue)), type: "bar", name: "Actual", marker: { color: hist.map((_, i) => (i === hist.length - 1 ? css("--c1") : rgba(css("--c1"), 0.55))), cornerradius: 3 }, hovertemplate: "$%{y:.1f}B" },
    { x: fx, y: B(fc.fc.p90), mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    { x: fx, y: B(fc.fc.p10), mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(css("--c2"), 0.18), name: "80% range", hoverinfo: "skip" },
    { x: fx, y: B(fc.fc.mean), mode: "lines+markers", name: "Expected", line: { color: css("--c2"), width: 2.6, dash: "dash" }, marker: { size: 7, color: css("--c2"), line: { color: css("--surface"), width: 2 } }, hovertemplate: "$%{y:.1f}B" },
  ], layout({
    bargap: 0.3, margin: { l: 8, r: 16, t: 28, b: 8 },
    xaxis: { type: "category", tickmode: "array", tickvals: tv, ticktext: ttxt, tickangle: 0, showline: true },
    yaxis: { tickprefix: "$", ticksuffix: "B", tickformat: ".0f" },
    shapes: [{ type: "line", xref: "x", x0: hx.length - 0.5, x1: hx.length - 0.5, yref: "paper", y0: 0, y1: 1, line: { color: css("--axis"), width: 1, dash: "dot" } }],
    annotations: [{ x: hx.length - 0.5, xref: "x", y: 1, yref: "paper", text: "Forecast", showarrow: false, xanchor: "left", xshift: 6, yshift: -4, font: { color: css("--muted"), size: 11.5 } }],
  }));
  $("amzRevSub").textContent = `Quarterly net sales from Amazon's filings, with the model's outlook for the next ${fc.fc.month.length} quarters.`;

  // ---- growth & margin
  const gx = Q.filter((r) => r.q >= FROM_Q).map((r) => r.q), idx = (q) => Q.findIndex((r) => r.q === q);
  const growth = gx.map((q) => (idx(q) >= 4 ? Q[idx(q)].revenue / Q[idx(q) - 4].revenue - 1 : null));
  const margin = gx.map((q) => Q[idx(q)].operating_income / Q[idx(q)].revenue);
  draw("c-amz-growth", [
    { x: gx.map(qLabel), y: growth, mode: "lines", name: "Net sales growth (YoY)", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.1%}" },
    { x: gx.map(qLabel), y: margin, mode: "lines", name: "Operating margin", line: line(css("--c2"), 2.5), hovertemplate: "%{y:.1%}" },
  ], layout({ margin: { l: 8, r: 16, t: 28, b: 8 }, xaxis: { type: "category", tickmode: "array", tickvals: tv.filter((l) => hx.includes(l)), ticktext: ttxt.slice(0, tv.filter((l) => hx.includes(l)).length), tickangle: 0, showline: true }, yaxis: { tickformat: ".0%" } }));

  // ---- segments
  const seg = rel.segments, totalSales = sum(seg.map((s) => s.sales));
  $("segSub").textContent = `${qLabel(rel.quarter)}, from Amazon's earnings release of ${rel.published}. Advertising (included in the segments above) was ${bn(rel.advertising.sales)}, up ${((rel.advertising.sales / rel.advertising.sales_prior - 1) * 100).toFixed(0)}%.`;
  $("segTable").innerHTML = `<thead><tr><th>Segment</th><th class="n">Net sales</th><th class="n">vs a year ago</th><th class="n">Share of sales</th><th class="n">Operating income</th><th class="n">Margin</th></tr></thead><tbody>` +
    seg.map((s) => `<tr><td><b>${s.name}</b></td><td class="n">${bn(s.sales)}</td><td class="n">${deltaChip(s.sales / s.sales_prior - 1, pctTxt)}</td><td class="n">${fmt.pct(s.sales / totalSales, 0)}</td><td class="n">${bn(s.opinc)}</td><td class="n">${fmt.pct(s.opinc / s.sales)}</td></tr>`).join("") + "</tbody>";

  // ---- outlook tiles
  const f = fc.fc, next4 = sum(f.mean.slice(0, 4)), last4 = ttm("revenue");
  const q4i = f.month.findIndex((m) => m.endsWith("-10")), q4prev = Q.find((r) => r.q === `${+f.month[q4i].slice(0, 4) - 1}-10`);
  const grade = fc.wmape <= 0.05 ? "Very accurate" : fc.wmape <= 0.15 ? "Good" : "Moderate";
  $("amzFcTiles").innerHTML = [
    tile({ label: "Net sales, next 4 quarters", value: bn(next4), delta: deltaChip(next4 / last4 - 1, pctTxt), sub: "vs the last 4 quarters" }),
    tile({ label: `${qLabel(f.month[0])} (model)`, value: bn(f.mean[0]), sub: `range ${bn(f.p10[0])} to ${bn(f.p90[0])}` }),
    tile({ label: `${qLabel(f.month[q4i])} holiday quarter`, value: bn(f.mean[q4i]), delta: q4prev ? deltaChip(f.mean[q4i] / q4prev.revenue - 1, pctTxt) : "", sub: "vs the same quarter last year" }),
    tile({ label: "Model reliability", value: `±${(fc.wmape * 100).toFixed(1)}%`, sub: `${grade} · typical quarterly miss` }),
  ].join("");

  // ---- model vs guidance
  const gc = A.guidance_check, mid = (gc.guidance_lo + gc.guidance_hi) / 2;
  $("guideTitle").textContent = `${qLabel(gc.quarter)}: our model vs Amazon's own guidance`;
  $("guideSub").textContent = `Amazon guides ${bn(gc.guidance_lo)} to ${bn(gc.guidance_hi)}; the model's likely range is ${bn(gc.model_p10)} to ${bn(gc.model_p90)}.`;
  draw("c-amz-guide", [
    { type: "bar", orientation: "h", y: ["Amazon guidance", "Our model (80% range)"], base: [gc.guidance_lo / 1e3, gc.model_p10 / 1e3], x: [(gc.guidance_hi - gc.guidance_lo) / 1e3, (gc.model_p90 - gc.model_p10) / 1e3],
      marker: { color: [css("--c1"), css("--c2")], cornerradius: 4 }, width: 0.5, hovertemplate: "%{y}<extra></extra>", showlegend: false },
    { type: "scatter", mode: "markers", x: [gc.model_mean / 1e3], y: ["Our model (80% range)"], marker: { size: 12, color: css("--ink"), line: { color: css("--surface"), width: 2 } }, name: "Model expected", hovertemplate: "Model expected: $%{x:.1f}B<extra></extra>" },
    { type: "scatter", mode: "markers", x: [last.revenue / 1e3], y: ["Amazon guidance"], marker: { size: 12, symbol: "diamond", color: css("--muted"), line: { color: css("--surface"), width: 2 } }, name: `${qLabel(last.q)} actual`, hovertemplate: `${qLabel(last.q)} actual: $%{x:.1f}B<extra></extra>` },
  ], layout({ hovermode: "closest", margin: { l: 150, r: 24, t: 28, b: 30 }, xaxis: { tickprefix: "$", ticksuffix: "B", showgrid: true, range: [Math.min(gc.guidance_lo, last.revenue, gc.model_p10) / 1e3 - 6, Math.max(gc.guidance_hi, gc.model_p90) / 1e3 + 6] }, yaxis: { showgrid: false, automargin: true } }));
  const above = gc.model_mean > gc.guidance_hi;
  $("guideNote").textContent = `${above ? "The model sits above Amazon's range." : "The model sits within or below Amazon's range."} Amazon notes that, excluding Prime Day in both years, ${qLabel(gc.quarter)} growth would be nearly 4 points higher, and event timing like that is invisible to a seasonal model. Read the gap as a reason to watch the quarter, not as an error in either number.`;

  // ---- wider market
  const e = fredLatestYoy("ECOMSA"), n = fredLatestYoy("RSNSR"), a = fredLatestYoy("RSEAS"), r = fredLatestYoy("RRSFS"), p = fredLatestYoy("PCU3352233522");
  $("mktTiles").innerHTML = [
    tile({ label: `U.S. e-commerce growth, ${qLabel(e.date)}`, value: pctTxt(e.v), sub: `vs all retail · ${MK.fred.ECOMPCTSA.values.at(-1).toFixed(1)}% share`, delta: deltaChip((e.v - r.v) * 100, numTxt(" pts", 1)) }),
    tile({ label: `Online & mail-order growth, ${fmt.month(n.date)}`, value: pctTxt(n.v), sub: "vs all retail", delta: deltaChip((n.v - r.v) * 100, numTxt(" pts", 1)) }),
    tile({ label: `Appliance & electronics stores growth, ${fmt.month(a.date)}`, value: pctTxt(a.v), sub: "vs all retail", delta: deltaChip((a.v - r.v) * 100, numTxt(" pts", 1)) }),
    tile({ label: `Appliance producer prices, ${fmt.month(p.date)}`, value: pctTxt(p.v), sub: `all retail ${pctTxt(r.v)}`, delta: "" }),
  ].join("");
  const gcol = { ECOMSA: css("--c2"), RSNSR: css("--c1"), RSEAS: "#8a6fd6", RRSFS: css("--muted") };
  draw("c-mkt-growth", ["RSNSR", "RSEAS", "RRSFS", "ECOMSA"].map((id) => {
    const g = fredYoy(id), k = g.x.findIndex((d) => d >= "2019-01");
    return { x: g.x.slice(k), y: g.y.slice(k), mode: "lines", name: { RSNSR: "Online & mail-order", RSEAS: "Appliance & electronics stores", RRSFS: "All retail", ECOMSA: "E-commerce (quarterly)" }[id], line: id === "RRSFS" ? { color: gcol[id], width: 2, dash: "dot" } : line(gcol[id], 2.4), hovertemplate: "%{y:.1%}" };
  }), layout({ margin: { l: 8, r: 16, t: 36, b: 8 }, legend: { y: 1.18 }, yaxis: { tickformat: ".0%" }, xaxis: { type: "date" } }));

  const rebase = (id) => { const s = MK.fred[id], k0 = s.dates.indexOf("2020-01"), k = k0 >= 0 ? k0 : 0; return { x: s.dates.slice(k), y: s.values.slice(k).map((v) => (v / s.values[k]) * 100) }; };
  const m1 = rebase("PCU3352233522"), m2 = rebase("PCU449210449210A3");
  draw("c-mkt-ppi", [
    { ...m1, mode: "lines", name: "Appliance manufacturers", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.1f}" },
    { ...m2, mode: "lines", name: "Appliance retailers", line: line(css("--c2"), 2.5), hovertemplate: "%{y:.1f}" },
  ], layout({ margin: { l: 8, r: 16, t: 28, b: 8 }, xaxis: { type: "date" }, yaxis: { tickformat: ".0f" } }));

  // ---- the honest explanation of why the category forecast was not stretched
  $("bridge").innerHTML = `<thead><tr><th>Public indicator</th><th class="n">Tracks category growth?</th><th class="n">Error with it</th><th class="n">Error of a naive guess</th><th class="n">Usable?</th></tr></thead><tbody>` +
    MK.bridge_test.map((b) => { const good = b.corr >= 0.5 && b.mae_model < b.mae_naive;
      return `<tr><td>${b.label}</td><td class="n">${b.corr >= 0 ? "+" : "−"}${Math.abs(b.corr).toFixed(2)}</td><td class="n">${b.mae_model.toFixed(3)}</td><td class="n">${b.mae_naive.toFixed(3)}</td><td class="n"><span class="badge ${good ? "good" : "bad"}">${good ? "Yes" : "No"}</span></td></tr>`; }).join("") + "</tbody>";
}
