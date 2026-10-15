// Static dashboard: reads data.json (built by scripts/export_web_data.py) and draws everything with Plotly.
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = {
  int: (v) => Math.round(v).toLocaleString("en-US"),
  usd: (v) => "$" + Math.round(v).toLocaleString("en-US"),
  usdM: (v) => "$" + (v / 1e6).toFixed(2) + "M",
  pct: (v, d = 1) => (v * 100).toFixed(d) + "%",
  sgnPct: (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%",
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const rolling = (a, w) => a.map((_, i) => mean(a.slice(Math.max(0, i - w + 1), i + 1)));
const yearOf = (m) => +m.slice(0, 4);
const monOf = (m) => +m.slice(5, 7);

let D, M; // data, monthly rows (array of objects)
const state = { from: 2012, to: 2023, fcMetric: "sales", horizon: 12 };

function base(title, extra = {}) {
  const text = css("--text"), line = css("--line");
  return {
    title: { text: title, font: { size: 15, color: text }, x: 0.02 },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: css("--muted"), size: 12 },
    margin: { l: 56, r: 16, t: 48, b: 40 },
    legend: { orientation: "h", y: -0.18 },
    hovermode: "x unified",
    xaxis: { gridcolor: line }, yaxis: { gridcolor: line },
    ...extra,
  };
}
const draw = (id, traces, layout) =>
  Plotly.react(id, traces, layout, { displayModeBar: false, responsive: true });

function rows(cols) {
  const keys = Object.keys(cols);
  return cols[keys[0]].map((_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])));
}
const inRange = (r) => yearOf(r.month) >= state.from && yearOf(r.month) <= state.to;
const filtered = () => M.filter(inRange);

// ---------------------------------------------------------------- KPIs
function yoy(f, key, how) {
  const agg = how === "mean" ? mean : sum;
  const cur = agg(f.slice(-12).map((r) => r[key]));
  const prev = agg(f.slice(-24, -12).map((r) => r[key]));
  return { cur, prev, g: cur / prev - 1 };
}
function kpiCard(label, value, delta, goodWhenUp = true) {
  const up = parseFloat(delta) >= 0 ? goodWhenUp : !goodWhenUp;
  return `<div class="kpi"><div class="l">${label}</div><div class="v">${value}</div>
    <div class="d ${up ? "up" : "down"}">${delta}</div></div>`;
}
function renderKpis(f) {
  const s = yoy(f, "sales"), o = yoy(f, "orders"), r = yoy(f, "avg_rating", "mean");
  const n = yoy(f, "new_customers"), p = yoy(f, "pct_positive", "mean");
  document.getElementById("kpis").innerHTML = [
    kpiCard("Sales proxy (last 12 mo)", fmt.usdM(s.cur), fmt.sgnPct(s.g) + " YoY"),
    kpiCard("Orders (last 12 mo)", fmt.int(o.cur), fmt.sgnPct(o.g) + " YoY"),
    kpiCard("Avg rating", r.cur.toFixed(2) + " / 5", (r.cur - r.prev >= 0 ? "+" : "") + (r.cur - r.prev).toFixed(2) + " YoY"),
    kpiCard("New customers", fmt.int(n.cur), fmt.sgnPct(n.g) + " YoY"),
    kpiCard("Positive reviews (4-5★)", fmt.pct(p.cur), ((p.cur - p.prev) * 100 >= 0 ? "+" : "") + ((p.cur - p.prev) * 100).toFixed(1) + " pts YoY"),
  ].join("");
}

// ---------------------------------------------------------------- tabs
function renderOverview(f) {
  const x = f.map((r) => r.month), sales = f.map((r) => r.sales);
  draw("c-sales-trend", [
    { x, y: sales, type: "bar", name: "Monthly sales proxy", marker: { color: css("--blue"), opacity: 0.35 } },
    { x, y: rolling(sales, 12), type: "scatter", mode: "lines", name: "12-mo average", line: { color: css("--blue"), width: 3 } },
  ], base("Sales over time (past → present)"));

  const years = [...new Set(f.map((r) => yearOf(r.month)))];
  const ann = years.map((y) => sum(f.filter((r) => yearOf(r.month) === y).map((r) => r.sales)));
  const labels = ann.map((v, i) => (i ? fmt.sgnPct(v / ann[i - 1] - 1) : ""));
  draw("c-annual", [{ x: years, y: ann, type: "bar", text: labels, textposition: "outside",
    marker: { color: css("--blue") }, hovertemplate: "%{x}: $%{y:,.0f}<extra></extra>" }],
    base("Annual sales (label = YoY growth)", { xaxis: { type: "category", gridcolor: css("--line") }, yaxis: { gridcolor: css("--line"), range: [0, Math.max(...ann) * 1.15] } }));

  draw("c-rating-trend", [{ x, y: rolling(f.map((r) => r.avg_rating), 6), mode: "lines", line: { color: css("--green"), width: 3 }, name: "Avg rating" }],
    base("Customer satisfaction: avg rating (6-mo smoothed)", { yaxis: { gridcolor: css("--line"), range: [3, 5] }, showlegend: false }));
}

function renderSales(f) {
  const x = f.map((r) => r.month);
  const ys = [...new Set(f.map((r) => yearOf(r.month)))].slice(-6);
  const palette = [css("--blue"), css("--green"), css("--amber"), css("--red"), "#8a6fd6", "#3aa9c9"];
  draw("c-season", ys.map((y, i) => {
    const d = f.filter((r) => yearOf(r.month) === y);
    return { x: d.map((r) => monOf(r.month)), y: d.map((r) => r.sales), name: String(y), mode: "lines+markers", line: { color: palette[i] } };
  }), base("Seasonality: monthly sales, last 6 years", { xaxis: { tickmode: "array", tickvals: [1,2,3,4,5,6,7,8,9,10,11,12], ticktext: ["J","F","M","A","M","J","J","A","S","O","N","D"], gridcolor: css("--line") } }));

  const sales = f.map((r) => r.sales);
  const g = sales.map((v, i) => (i >= 12 ? v / sales[i - 12] - 1 : null));
  draw("c-yoy", [{ x, y: g, type: "bar", marker: { color: g.map((v) => (v >= 0 ? css("--green") : css("--red"))) } }],
    base("Year-over-year sales growth by month", { yaxis: { tickformat: ".0%", gridcolor: css("--line") }, showlegend: false }));

  draw("c-aov", [{ x, y: f.map((r) => (r.orders ? r.sales / r.orders : null)), mode: "lines", line: { color: css("--amber"), width: 3 } }],
    base("Average order value ($ per verified review)", { showlegend: false }));
}

function renderSatisfaction(f) {
  const mix = rows(D.rating_mix).filter(inRange);
  const months = [...new Set(mix.map((r) => r.month))];
  const colors = { 1: css("--red"), 2: "#e8896a", 3: css("--amber"), 4: "#7cc7a4", 5: css("--green") };
  const totals = Object.fromEntries(months.map((m) => [m, sum(mix.filter((r) => r.month === m).map((r) => r.n))]));
  draw("c-mix", [1, 2, 3, 4, 5].map((k) => ({
    x: months, name: k + "★", stackgroup: "one", mode: "lines", line: { width: 0.5, color: colors[k] }, fillcolor: colors[k],
    y: months.map((m) => (mix.find((r) => r.month === m && r.rating === k)?.n || 0) / totals[m]),
  })), base("Rating mix over time", { yaxis: { tickformat: ".0%", gridcolor: css("--line") } }));

  const x = f.map((r) => r.month);
  draw("c-posneg", [
    { x, y: rolling(f.map((r) => r.pct_positive), 6), name: "Positive (4-5★)", mode: "lines", line: { color: css("--green"), width: 3 } },
    { x, y: rolling(f.map((r) => r.pct_negative), 6), name: "Negative (1-2★)", mode: "lines", line: { color: css("--red"), width: 3 } },
  ], base("Positive vs negative share (6-mo smoothed)", { yaxis: { tickformat: ".0%", gridcolor: css("--line") } }));

  const dist = [1, 2, 3, 4, 5].map((k) => sum(mix.filter((r) => r.rating === k).map((r) => r.n)));
  draw("c-dist", [{ x: [1, 2, 3, 4, 5].map((k) => k + "★"), y: dist, type: "bar", marker: { color: [1, 2, 3, 4, 5].map((k) => colors[k]) } }],
    base("Rating distribution (selected years)", { hovermode: "closest", showlegend: false }));

  const last = f.slice(-12);
  const nps = mean(last.map((r) => r.pct_positive - r.pct_negative)) * 100;
  document.getElementById("nps").innerHTML = `Net satisfaction score (positive% − negative%) over the last 12 months: <b>${nps >= 0 ? "+" : ""}${nps.toFixed(0)}</b>`;
}

function renderCustomers(f) {
  const x = f.map((r) => r.month);
  draw("c-cust", [
    { x, y: f.map((r) => r.new_customers), type: "bar", name: "New customers", marker: { color: css("--blue") } },
    { x, y: f.map((r) => Math.max(0, r.customers - r.new_customers)), type: "bar", name: "Returning customers", marker: { color: css("--blue"), opacity: 0.35 } },
  ], base("Active customers: new vs returning", { barmode: "stack" }));
  draw("c-newshare", [{ x, y: rolling(f.map((r) => r.new_customers / r.customers), 6), mode: "lines", line: { color: css("--amber"), width: 3 } }],
    base("New-customer share of active customers", { yaxis: { tickformat: ".0%", gridcolor: css("--line") }, showlegend: false }));
}

function renderForecast() {
  const fc = D.forecast[state.fcMetric], h = state.horizon, m = state.fcMetric;
  const fx = fc.forecast.month.slice(0, h), mean_ = fc.forecast.mean.slice(0, h);
  const lo = fc.forecast.lo.slice(0, h), hi = fc.forecast.hi.slice(0, h);
  draw("c-forecast", [
    { x: fc.history.month, y: fc.history.value, name: "Actual", mode: "lines", line: { color: css("--blue"), width: 2.5 } },
    { x: fx, y: hi, mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    { x: fx, y: lo, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(91,149,240,0.18)", name: "95% interval", hoverinfo: "skip" },
    { x: fx, y: mean_, name: "Forecast", mode: "lines", line: { color: css("--amber"), width: 3, dash: "dash" } },
    { x: fc.backtest.month, y: fc.backtest.value, name: "Backtest (last 12 mo)", mode: "lines", line: { color: css("--muted"), width: 1.5, dash: "dot" } },
  ], base(`${h}-month forecast (damped Holt-Winters)`));

  const total = m === "avg_rating" ? mean(mean_).toFixed(2) : (m === "sales" ? fmt.usd(sum(mean_)) : fmt.int(sum(mean_)));
  const lastM = new Date(fc.history.month.at(-1) + "-01T00:00:00");
  const card = (l, v) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  document.getElementById("fcKpis").innerHTML =
    card(m === "avg_rating" ? `Avg rating, next ${h} mo` : `Total, next ${h} mo`, total) +
    card("Backtest error (MAPE, last 12 mo)", fmt.pct(fc.mape)) +
    card("Last data month", lastM.toLocaleString("en-US", { month: "short", year: "numeric" }));
}

function renderBrands() {
  const bm = rows(D.brand_monthly).filter(inRange);
  const agg = {};
  bm.forEach((r) => {
    const a = (agg[r.brand] ||= { orders: 0, sales: 0, rs: 0 });
    a.orders += r.orders; a.sales += r.sales; a.rs += r.rating_sum;
  });
  const top = Object.entries(agg).sort((a, b) => b[1].sales - a[1].sales).slice(0, 15);
  draw("c-brands", [{ y: top.map((t) => t[0]).reverse(), x: top.map((t) => t[1].sales).reverse(), type: "bar", orientation: "h", marker: { color: css("--blue") } }],
    base("Top brands by sales proxy", { hovermode: "closest", margin: { l: 130, r: 16, t: 48, b: 40 } }));
  const max = Math.max(...top.map((t) => t[1].sales));
  draw("c-bubble", [{ x: top.map((t) => t[1].orders), y: top.map((t) => t[1].rs / t[1].orders), text: top.map((t) => t[0]), mode: "markers+text", textposition: "top center",
    marker: { size: top.map((t) => (t[1].sales / max) * 40 + 8), color: css("--green"), opacity: 0.6 } }],
    base("Brand volume vs satisfaction (bubble = sales)", { hovermode: "closest", showlegend: false, xaxis: { type: "log", title: "Orders", gridcolor: css("--line") }, yaxis: { title: "Avg rating", gridcolor: css("--line") } }));

  const p = rows(D.products);
  const head = `<tr><th>ASIN</th><th>Title</th><th>Brand</th><th class="n">Price</th><th class="n">Reviews</th><th class="n">Sales proxy</th><th class="n">Avg rating</th></tr>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  document.getElementById("products").innerHTML = head + p.map((r) =>
    `<tr><td>${esc(r.parent_asin)}</td><td class="t" title="${esc(r.title)}">${esc(r.title)}</td><td>${esc(r.brand)}</td>
     <td class="n">${r.price == null ? "-" : "$" + r.price.toFixed(2)}</td><td class="n">${fmt.int(r.orders)}</td>
     <td class="n">${fmt.usd(r.sales)}</td><td class="n">${r.avg_rating.toFixed(2)}</td></tr>`).join("");
}

// ---------------------------------------------------------------- wiring
const renderers = {
  overview: (f) => renderOverview(f), sales: (f) => renderSales(f), satisfaction: (f) => renderSatisfaction(f),
  customers: (f) => renderCustomers(f), forecast: () => renderForecast(), brands: () => renderBrands(),
};
function activeTab() { return document.querySelector(".tabs .active").dataset.tab; }
function renderAll() {
  const f = filtered();
  document.getElementById("subtitle").textContent =
    `${M.length} months of history · ${fmt.int(sum(M.map((r) => r.orders)))} reviews · ${state.from}-${state.to} selected`;
  renderKpis(f);
  renderers[activeTab()](f);
}

fetch("data.json").then((r) => r.json()).then((data) => {
  D = data; M = rows(D.monthly);
  const years = [...new Set(M.map((r) => yearOf(r.month)))];
  state.to = years.at(-1);
  ["yFrom", "yTo"].forEach((id) => {
    document.getElementById(id).innerHTML = years.map((y) => `<option>${y}</option>`).join("");
  });
  yFrom.value = state.from; yTo.value = state.to;
  const onYears = () => {
    state.from = +yFrom.value; state.to = +yTo.value;
    if (state.from > state.to) { state.from = state.to; yFrom.value = state.from; }
    renderAll();
  };
  yFrom.onchange = onYears; yTo.onchange = onYears;

  document.getElementById("tabs").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll(".tabs button, .panel").forEach((el) => el.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("tab-" + b.dataset.tab).classList.add("active");
    renderAll();
  };
  document.getElementById("fcMetric").onchange = (e) => { state.fcMetric = e.target.value; renderForecast(); };
  document.getElementById("horizon").oninput = (e) => {
    state.horizon = +e.target.value; document.getElementById("hLabel").textContent = state.horizon; renderForecast();
  };
  matchMedia("(prefers-color-scheme: dark)").onchange = renderAll;
  renderAll();
}).catch((e) => { document.getElementById("subtitle").textContent = "Failed to load data.json: " + e; });
