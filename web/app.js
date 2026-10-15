// Static dashboard: reads data.json (built by scripts/export_web_data.py) and draws it with Plotly + inline SVG.
const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches
  ? document.documentElement.dataset.theme !== "light" : document.documentElement.dataset.theme === "dark";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = {
  int: (v) => Math.round(v).toLocaleString("en-US"),
  usd: (v) => "$" + Math.round(v).toLocaleString("en-US"),
  usdC: (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0)),
  intC: (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v))),
  pct: (v, d = 1) => (v * 100).toFixed(d) + "%",
  month: (m) => MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4),
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const rolling = (a, w) => a.map((_, i) => mean(a.slice(Math.max(0, i - w + 1), i + 1)));
const yearOf = (m) => +m.slice(0, 4);
const monOf = (m) => +m.slice(5, 7);
const ok = (v) => Number.isFinite(v);
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

let D, M;
const state = { from: 2012, to: 2023, fcMetric: "sales", horizon: 12, search: "" };

// ---------------------------------------------------------------- plotly base
function layout(extra = {}) {
  const ax = { gridcolor: css("--grid"), gridwidth: 1, zeroline: false, linecolor: css("--axis"), tickcolor: "rgba(0,0,0,0)",
    tickfont: { color: css("--muted"), size: 12 }, automargin: true };
  const l = {
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: css("--ink2"), size: 12 },
    margin: { l: 8, r: 8, t: 8, b: 8 },
    xaxis: { ...ax, showgrid: false, showline: true },
    yaxis: { ...ax, showline: false },
    hovermode: "x unified",
    hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--axis"), font: { color: css("--ink"), size: 12.5 } },
    legend: { orientation: "h", x: 0, y: 1.12, font: { color: css("--ink2"), size: 12.5 }, bgcolor: "rgba(0,0,0,0)" },
    bargap: 0.38, dragmode: "zoom",
  };
  for (const k of Object.keys(extra)) {
    l[k] = (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) && l[k]) ? { ...l[k], ...extra[k] } : extra[k];
  }
  return l;
}
const draw = (id, traces, lay) =>
  Plotly.react(id, traces, lay, { displayModeBar: false, responsive: true, scrollZoom: false });
const line = (color, w = 2) => ({ color, width: w, shape: "spline", smoothing: 0.4 });
const dot = (x, y, color, name = "") => ({ x: [x], y: [y], mode: "markers", showlegend: false, hoverinfo: "skip", name,
  marker: { size: 10, color, line: { color: css("--surface"), width: 2 } } });

// ---------------------------------------------------------------- data helpers
function rows(cols) {
  const keys = Object.keys(cols);
  return cols[keys[0]].map((_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])));
}
const inRange = (r) => yearOf(r.month) >= state.from && yearOf(r.month) <= state.to;
const filtered = () => M.filter(inRange);
function yoy(f, key, how = "sum") {
  const agg = how === "mean" ? mean : sum;
  const cur = agg(f.slice(-12).map((r) => r[key])), prev = agg(f.slice(-24, -12).map((r) => r[key]));
  return { cur, prev, g: cur / prev - 1, diff: cur - prev, ok: f.length >= 24 };
}

// ---------------------------------------------------------------- small UI parts
const ARROW = { up: "▲", down: "▼", flat: "–" };
function chip(text, dir) { return `<span class="chip ${dir}"><span aria-hidden="true">${ARROW[dir]}</span>${text}</span>`; }
function deltaChip(value, textFn, goodWhenUp = true) {
  if (!ok(value)) return `<span class="chip flat">${ARROW.flat} n/a</span>`;
  const dir = Math.abs(value) < 1e-9 ? "flat" : value > 0 ? "up" : "down";
  const cls = dir === "flat" ? "flat" : (value > 0) === goodWhenUp ? "up" : "down";
  return `<span class="chip ${cls}"><span aria-hidden="true">${ARROW[dir]}</span>${textFn(value)}</span>`;
}
const pctTxt = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
const numTxt = (d, p = 2) => (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(p) + d;

function sparkline(values, { w = 160, h = 34, pad = 4, fill = true, color = css("--c1") } = {}) {
  const v = values.filter(ok); if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => [pad + (i / (v.length - 1)) * (w - 2 * pad), h - pad - ((y - lo) / span) * (h - 2 * pad)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts.at(-1);
  const area = fill ? `<path d="${d} L${last[0]} ${h} L${pts[0][0]} ${h} Z" fill="${rgba(color.startsWith("#") ? color : "#2a78d6", 0.10)}"/>` : "";
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend">${area}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

function tile({ label, value, delta, sub, spark }) {
  return `<div class="tile"><div class="l">${label}</div><div class="v">${value}</div>
    <div class="sub">${delta || ""}${sub ? `<span>${sub}</span>` : ""}</div>${spark ? `<div class="spark">${spark}</div>` : ""}</div>`;
}

// ---------------------------------------------------------------- hero, tiles, insights
const ICON = {
  peak: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  grow: '<path d="M12 20V6M5 13l7-7 7 7"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  next: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

function renderHero(f) {
  const s = yoy(f, "sales");
  const series = f.slice(-36).map((r) => r.sales);
  $("hero").innerHTML = `
    <div>
      <div class="hero-label">Sales proxy, last 12 months</div>
      <div class="hero-value">${ok(s.cur) ? fmt.usdC(s.cur) : "–"}</div>
      <div class="hero-row">${s.ok ? deltaChip(s.g, pctTxt) : ""}<span>${s.ok ? "vs the 12 months before" : "select 2+ years for a comparison"} · ${fmt.month(f.at(-1).month)} is the latest month</span></div>
    </div>
    <div class="hero-spark">${sparkline(series, { w: 600, h: 96, pad: 6 })}</div>`;
}

function renderTiles(f) {
  const o = yoy(f, "orders"), r = yoy(f, "avg_rating", "mean"), n = yoy(f, "new_customers"), p = yoy(f, "pct_positive", "mean");
  const last24 = f.slice(-24);
  $("tiles").innerHTML = [
    tile({ label: "Orders (reviews)", value: fmt.int(o.cur), delta: deltaChip(o.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(last24.map((x) => x.orders)) }),
    tile({ label: "Average rating", value: ok(r.cur) ? r.cur.toFixed(2) + " ★" : "–", delta: deltaChip(r.diff, numTxt("", 2)), sub: "vs prior 12 mo", spark: sparkline(last24.map((x) => x.avg_rating)) }),
    tile({ label: "New customers", value: fmt.int(n.cur), delta: deltaChip(n.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(last24.map((x) => x.new_customers)) }),
    tile({ label: "Positive reviews (4–5★)", value: ok(p.cur) ? fmt.pct(p.cur) : "–", delta: deltaChip(p.diff * 100, numTxt(" pts", 1)), sub: "vs prior 12 mo", spark: sparkline(last24.map((x) => x.pct_positive)) }),
  ].join("");
}

function renderInsights(f) {
  const items = [];
  const peak = f.reduce((a, b) => (b.sales > a.sales ? b : a), f[0]);
  items.push(["peak", "Best month", `${fmt.month(peak.month)} led all months with ${fmt.usdC(peak.sales)} in sales proxy.`]);

  const years = [...new Set(f.map((r) => yearOf(r.month)))].filter((y) => f.filter((r) => yearOf(r.month) === y).length === 12);
  const tot = (y) => sum(f.filter((r) => yearOf(r.month) === y).map((r) => r.sales));
  const growth = years.filter((y) => years.includes(y - 1) && tot(y - 1) > 0.2 * Math.max(...years.map(tot))).map((y) => [y, tot(y) / tot(y - 1) - 1]);
  if (growth.length) {
    const [by, bg] = growth.reduce((a, b) => (b[1] > a[1] ? b : a));
    items.push(["grow", "Fastest growth", `${by} grew ${pctTxt(bg).replace("+", "")} to ${fmt.usdC(tot(by))}, the strongest year in this range.`]);
  }

  const r = yoy(f, "avg_rating", "mean"), neg = yoy(f, "pct_negative", "mean");
  if (r.ok) items.push(["star", "Satisfaction", `Average rating is ${r.cur.toFixed(2)}, ${r.diff >= 0 ? "up" : "down"} ${Math.abs(r.diff).toFixed(2)} on last year. ${fmt.pct(neg.cur)} of reviews are 1–2★.`]);

  const fc = D.forecast.sales, h = 12;
  const next = sum(fc.forecast.mean.slice(0, h)), prev = sum(fc.history.value.slice(-12));
  items.push(["next", "Outlook", `The model expects ${fmt.usdC(next)} over the next 12 months, ${pctTxt(next / prev - 1)} vs the last 12.`]);

  $("insights").innerHTML = items.map(([ic, t, body]) =>
    `<li><span class="ins-ic">${icon(ic)}</span><div><b>${t}</b><span class="t">${body}</span></div></li>`).join("");
}

// ---------------------------------------------------------------- tabs
function seqBlue(i, n) { // lighter -> darker blue ramp for ordered series
  const ramp = isDark() ? ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#6da7ec"] : ["#9ec5f4", "#86b6ef", "#5598e7", "#2a78d6", "#256abf", "#184f95"];
  return ramp[Math.round((i / Math.max(1, n - 1)) * (ramp.length - 1))];
}

function renderOverview(f) {
  const x = f.map((r) => r.month), sales = f.map((r) => r.sales), avg = rolling(sales, 12);
  const peak = f.reduce((a, b) => (b.sales > a.sales ? b : a), f[0]);
  draw("c-sales-trend", [
    { x, y: sales, type: "scatter", mode: "lines", name: "Monthly", line: { color: rgba(css("--c1"), 0.55), width: 1.5 }, fill: "tozeroy", fillcolor: rgba(css("--c1"), 0.10), hovertemplate: "%{y:$,.0f}" },
    { x, y: avg, type: "scatter", mode: "lines", name: "12-month average", line: line(css("--c1"), 2.5), hovertemplate: "%{y:$,.0f}" },
    dot(peak.month, peak.sales, css("--c2"), "Peak"),
  ], layout({
    margin: { l: 8, r: 24, t: 28, b: 8 }, yaxis: { tickprefix: "$", tickformat: ".2~s", rangemode: "tozero" },
    annotations: [{ x: peak.month, y: peak.sales, text: `Peak ${fmt.usdC(peak.sales)}`, showarrow: false, yshift: 18, font: { color: css("--ink"), size: 12 } }],
  }));

  const years = [...new Set(f.map((r) => yearOf(r.month)))];
  const part = (y) => f.filter((r) => yearOf(r.month) === y).length;
  const ann = years.map((y) => sum(f.filter((r) => yearOf(r.month) === y).map((r) => r.sales)));
  const lbl = ann.map((v, i) => (i && part(years[i]) === 12 && part(years[i - 1]) === 12 ? pctTxt(v / ann[i - 1] - 1) : ""));
  draw("c-annual", [{ x: years.map((y) => (part(y) < 12 ? `${y} YTD` : String(y))), y: ann, type: "bar",
    marker: { color: years.map((_, i) => (i === years.length - 1 ? css("--c1") : rgba(css("--c1"), 0.38))), cornerradius: 4 },
    text: lbl, textposition: "outside", textfont: { color: css("--ink2"), size: 12 }, cliponaxis: false,
    hovertemplate: "%{x}: %{y:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", margin: { l: 8, r: 8, t: 24, b: 8 }, xaxis: { type: "category" }, yaxis: { tickprefix: "$", tickformat: ".2~s", range: [0, Math.max(...ann) * 1.18] } }));

  const rt = rolling(f.map((r) => r.avg_rating), 6);
  const lo = Math.min(...rt), hi = Math.max(...rt);
  draw("c-rating-trend", [
    { x, y: rt, mode: "lines", name: "Avg rating", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.2f} ★" },
    dot(x.at(-1), rt.at(-1), css("--c1")),
  ], layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { range: [Math.floor((lo - 0.1) * 10) / 10, Math.ceil((hi + 0.1) * 10) / 10], tickformat: ".1f" } }));
}

function renderSales(f) {
  const years = [...new Set(f.map((r) => yearOf(r.month)))];
  const z = years.map((y) => MONTHS.map((_, i) => f.find((r) => yearOf(r.month) === y && monOf(r.month) === i + 1)?.sales ?? null));
  const scale = isDark() ? [[0, "#0d366b"], [0.5, "#2a78d6"], [1, "#cde2fb"]] : [[0, "#cde2fb"], [0.5, "#3987e5"], [1, "#0d366b"]];
  draw("c-heat", [{ type: "heatmap", x: MONTHS, y: years.map(String), z, colorscale: scale, xgap: 2, ygap: 2, hoverongaps: false,
    colorbar: { thickness: 10, len: 0.9, tickprefix: "$", tickformat: ".2~s", tickfont: { color: css("--muted"), size: 11 }, outlinewidth: 0 },
    hovertemplate: "%{x} %{y}: %{z:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", margin: { l: 8, r: 8, t: 8, b: 8 }, xaxis: { showline: false, side: "top" }, yaxis: { type: "category", autorange: "reversed" } }));

  const ys = years.slice(-6);
  draw("c-season", ys.map((y, i) => {
    const d = f.filter((r) => yearOf(r.month) === y), latest = i === ys.length - 1;
    return { x: d.map((r) => monOf(r.month)), y: d.map((r) => r.sales), name: String(y), mode: "lines", line: line(seqBlue(i, ys.length), latest ? 3 : 1.8), hovertemplate: "%{y:$,.0f}" };
  }), layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, xaxis: { tickmode: "array", tickvals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ticktext: MONTHS.map((m) => m[0]), showline: true }, yaxis: { tickprefix: "$", tickformat: ".2~s" } }));

  const x = f.map((r) => r.month);
  draw("c-aov", [{ x, y: f.map((r) => (r.orders ? r.sales / r.orders : null)), mode: "lines", name: "Avg order value", line: line(css("--c2"), 2.5), hovertemplate: "%{y:$.2f}" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickprefix: "$", tickformat: ".0f" } }));

  const sales = f.map((r) => r.sales);
  const g = sales.map((v, i) => (i >= 12 ? v / sales[i - 12] - 1 : null));
  draw("c-yoy", [{ x, y: g, type: "bar", name: "YoY", marker: { color: g.map((v) => (v >= 0 ? css("--c1") : "#e34948")), cornerradius: 3 }, hovertemplate: "%{y:+.1%}" }],
    layout({ showlegend: false, bargap: 0.25, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickformat: ".0%" } }));
}

function renderSatisfaction(f) {
  const mix = rows(D.rating_mix).filter(inRange);
  const months = [...new Set(mix.map((r) => r.month))];
  const col = { 1: "#e34948", 2: "#f0908f", 3: isDark() ? "#4a4a46" : "#cfcdc5", 4: "#86b6ef", 5: css("--c1") };
  const totals = Object.fromEntries(months.map((m) => [m, sum(mix.filter((r) => r.month === m).map((r) => r.n))]));
  draw("c-mix", [1, 2, 3, 4, 5].map((k) => ({
    x: months, name: k + "★", stackgroup: "one", mode: "lines", line: { width: 0.6, color: css("--surface") }, fillcolor: col[k], hovertemplate: "%{y:.0%}",
    y: months.map((m) => (mix.find((r) => r.month === m && r.rating === k)?.n || 0) / totals[m]),
  })), layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".0%", range: [0, 1] } }));

  const x = f.map((r) => r.month), pos = rolling(f.map((r) => r.pct_positive), 6), neg = rolling(f.map((r) => r.pct_negative), 6);
  draw("c-posneg", [
    { x, y: pos, mode: "lines", name: "Positive (4–5★)", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.1%}" },
    { x, y: neg, mode: "lines", name: "Negative (1–2★)", line: line("#e34948", 2.5), hovertemplate: "%{y:.1%}" },
  ], layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));

  const dist = [1, 2, 3, 4, 5].map((k) => sum(mix.filter((r) => r.rating === k).map((r) => r.n))), tot = sum(dist);
  draw("c-dist", [{ x: [1, 2, 3, 4, 5].map((k) => k + "★"), y: dist, type: "bar", marker: { color: [1, 2, 3, 4, 5].map((k) => col[k]), cornerradius: 4 },
    text: dist.map((v) => fmt.pct(v / tot, 0)), textposition: "outside", textfont: { color: css("--ink2"), size: 12 }, cliponaxis: false,
    hovertemplate: "%{x}: %{y:,} reviews<extra></extra>" }],
    layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 8, t: 24, b: 8 }, yaxis: { tickformat: ".2~s", range: [0, Math.max(...dist) * 1.15] } }));

  const nps = (a) => mean(a.map((r) => r.pct_positive - r.pct_negative)) * 100;
  const cur = nps(f.slice(-12)), prev = nps(f.slice(-24, -12));
  const five = yoy(f, "pct_positive", "mean");
  const lastMix = mix.filter((r) => months.slice(-12).includes(r.month));
  const shareOf = (k) => sum(lastMix.filter((r) => r.rating === k).map((r) => r.n)) / sum(lastMix.map((r) => r.n));
  $("satTiles").innerHTML = [
    tile({ label: "Net satisfaction score", value: (cur >= 0 ? "+" : "") + cur.toFixed(0), delta: deltaChip(cur - prev, numTxt(" pts", 0)), sub: "positive% − negative%", spark: sparkline(f.slice(-24).map((r) => r.pct_positive - r.pct_negative)) }),
    tile({ label: "5★ share, last 12 mo", value: fmt.pct(shareOf(5), 0), sub: "of all reviews", delta: "" }),
    tile({ label: "1★ share, last 12 mo", value: fmt.pct(shareOf(1), 0), sub: "of all reviews", delta: "" }),
  ].join("");
}

function renderCustomers(f) {
  const x = f.map((r) => r.month), ret = f.map((r) => Math.max(0, r.customers - r.new_customers));
  draw("c-cust", [
    { x, y: f.map((r) => r.new_customers), type: "bar", name: "New customers", marker: { color: css("--c1") }, hovertemplate: "%{y:,}" },
    { x, y: ret, type: "bar", name: "Returning customers", marker: { color: seqBlue(0, 6) }, hovertemplate: "%{y:,}" },
  ], layout({ barmode: "stack", bargap: 0.18, margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".2~s" } }));
  const share = rolling(f.map((r) => r.new_customers / r.customers), 6);
  draw("c-newshare", [{ x, y: share, mode: "lines", name: "New share", line: line(css("--c4"), 2.5), hovertemplate: "%{y:.1%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickformat: ".0%", range: [0.8, 1] } }));

  const last = f.slice(-12), prev = f.slice(-24, -12);
  const act = sum(last.map((r) => r.customers)), actP = sum(prev.map((r) => r.customers));
  const newShare = sum(last.map((r) => r.new_customers)) / act;
  $("custTiles").innerHTML = [
    tile({ label: "Active customer-months", value: fmt.int(act), delta: deltaChip(act / actP - 1, pctTxt), sub: "vs prior 12 mo", spark: sparkline(f.slice(-24).map((r) => r.customers)) }),
    tile({ label: "First-time share", value: fmt.pct(newShare), sub: "of active customers", delta: "" }),
    tile({ label: "Returning share", value: fmt.pct(1 - newShare), sub: "reviewed before", delta: "" }),
  ].join("");
}

function renderForecast() {
  const m = state.fcMetric, h = state.horizon, fc = D.forecast[m];
  const fx = fc.forecast.month.slice(0, h), mu = fc.forecast.mean.slice(0, h), lo = fc.forecast.lo.slice(0, h), hi = fc.forecast.hi.slice(0, h);
  const name = { sales: "Sales proxy", orders: "Orders", avg_rating: "Average rating" }[m];
  const hov = m === "sales" ? "%{y:$,.0f}" : m === "orders" ? "%{y:,.0f}" : "%{y:.2f}";
  $("fcTitle").textContent = `${name}: next ${h} months`;
  const lastActual = fc.history.month.at(-1), lastVal = fc.history.value.at(-1);
  const rangeStart = "2017-01";
  draw("c-forecast", [
    { x: fc.history.month, y: fc.history.value, name: "Actual", mode: "lines", line: line(css("--c1"), 2.5), hovertemplate: hov },
    { x: fx, y: hi, mode: "lines", line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
    { x: fx, y: lo, mode: "lines", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(css("--c2"), 0.14), name: "95% interval", hoverinfo: "skip" },
    { x: fx, y: mu, name: "Forecast", mode: "lines", line: { color: css("--c2"), width: 2.5, dash: "dash" }, hovertemplate: hov },
    { x: fc.backtest.month, y: fc.backtest.value, name: "Backtest", mode: "lines", line: { color: css("--muted"), width: 1.8, dash: "dot" }, hovertemplate: hov },
    dot(fx.at(-1), mu.at(-1), css("--c2")),
  ], layout({
    margin: { l: 8, r: 24, t: 28, b: 8 },
    xaxis: { range: [rangeStart, fx.at(-1)], showspikes: true, spikemode: "across", spikecolor: css("--axis"), spikethickness: 1, spikedash: "solid" },
    yaxis: { tickprefix: m === "sales" ? "$" : "", tickformat: m === "avg_rating" ? ".1f" : ".2s", rangemode: m === "avg_rating" ? "normal" : "tozero" },
    shapes: [{ type: "line", xref: "x", yref: "paper", x0: lastActual, x1: lastActual, y0: 0, y1: 1, line: { color: css("--axis"), width: 1, dash: "dot" } }],
    annotations: [{ x: lastActual, y: 1, yref: "paper", text: "Forecast starts", showarrow: false, xanchor: "left", xshift: 6, yshift: -4, font: { color: css("--muted"), size: 11.5 } }],
  }));

  const total = m === "avg_rating" ? mean(mu) : sum(mu), prevT = m === "avg_rating" ? mean(fc.history.value.slice(-h)) : sum(fc.history.value.slice(-h));
  const f = (v) => (m === "sales" ? fmt.usdC(v) : m === "orders" ? fmt.intC(v) : v.toFixed(2) + " ★");
  const quality = fc.mape < 0.05 ? "Very accurate" : fc.mape < 0.15 ? "Good" : fc.mape < 0.3 ? "Moderate" : "Low";
  const endW = (hi.at(-1) - lo.at(-1)) / 2;
  $("fcTiles").innerHTML = [
    tile({ label: m === "avg_rating" ? `Avg rating, next ${h} mo` : `Projected total, next ${h} mo`, value: f(total), delta: deltaChip(total / prevT - 1, pctTxt), sub: `vs last ${h} mo` }),
    tile({ label: "Forecast at the end", value: f(mu.at(-1)), sub: `${fmt.month(fx.at(-1))} · monthly`, delta: "" }),
    tile({ label: "Backtest error (MAPE)", value: fmt.pct(fc.mape), sub: `${quality} · last 12 months`, delta: "" }),
    tile({ label: "Uncertainty at the end", value: "± " + f(endW), sub: "95% interval half-width", delta: "" }),
  ].join("");
}

function renderBrands() {
  const bm = rows(D.brand_monthly).filter(inRange), agg = {};
  bm.forEach((r) => { const a = (agg[r.brand] ||= { orders: 0, sales: 0, rs: 0 }); a.orders += r.orders; a.sales += r.sales; a.rs += r.rating_sum; });
  const top = Object.entries(agg).sort((a, b) => b[1].sales - a[1].sales).slice(0, 12);
  const rev = [...top].reverse();
  draw("c-brands", [{ y: rev.map((t) => t[0]), x: rev.map((t) => t[1].sales), type: "bar", orientation: "h",
    marker: { color: css("--c1"), cornerradius: 4 }, text: rev.map((t) => fmt.usdC(t[1].sales)), textposition: "outside", textfont: { color: css("--ink2"), size: 12 }, cliponaxis: false,
    hovertemplate: "%{y}: %{x:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", bargap: 0.3, margin: { l: 8, r: 56, t: 8, b: 8 }, xaxis: { showgrid: true, tickprefix: "$", tickformat: ".2~s", showline: false }, yaxis: { showgrid: false, automargin: true } }));

  const maxS = Math.max(...top.map((t) => t[1].sales));
  draw("c-bubble", [{ x: top.map((t) => t[1].orders), y: top.map((t) => t[1].rs / t[1].orders), text: top.map((t) => t[0]), mode: "markers+text", textposition: "top center",
    textfont: { color: css("--ink2"), size: 11 }, marker: { size: top.map((t) => 12 + (t[1].sales / maxS) * 34), color: rgba(css("--c1"), 0.6), line: { color: css("--surface"), width: 2 } },
    hovertemplate: "%{text}<br>%{x:,} reviews · %{y:.2f} ★<extra></extra>" }],
    layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 16, t: 16, b: 8 },
      xaxis: { type: "log", title: { text: "Reviews (log scale)", font: { color: css("--muted"), size: 12 } }, showgrid: true, showline: true },
      yaxis: { title: { text: "Average rating", font: { color: css("--muted"), size: 12 } }, tickformat: ".1f" } }));
  renderTable();
}

function renderTable() {
  const q = state.search.trim().toLowerCase();
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const p = rows(D.products).filter((r) => !q || (r.title + " " + r.brand).toLowerCase().includes(q));
  $("products").innerHTML = `<thead><tr><th>Product</th><th>Brand</th><th class="n">Price</th><th class="n">Reviews</th><th class="n">Sales proxy</th><th class="n">Rating</th></tr></thead><tbody>` +
    (p.length ? p.map((r) => `<tr><td class="t" title="${esc(r.title)}">${esc(r.title)}</td><td>${esc(r.brand)}</td>
      <td class="n">${r.price == null ? "–" : "$" + r.price.toFixed(2)}</td><td class="n">${fmt.int(r.orders)}</td>
      <td class="n">${fmt.usd(r.sales)}</td><td class="n"><span class="pill">${r.avg_rating.toFixed(2)} ★</span></td></tr>`).join("")
      : `<tr><td colspan="6">No products match "${esc(state.search)}".</td></tr>`) + "</tbody>";
}

// ---------------------------------------------------------------- wiring
const renderers = {
  overview: renderOverview, sales: renderSales, satisfaction: renderSatisfaction,
  customers: renderCustomers, forecast: () => renderForecast(), brands: () => renderBrands(),
};
const activeTab = () => document.querySelector(".tabs .active").dataset.tab;

function renderAll() {
  const f = filtered();
  $("subtitle").textContent = `Amazon · ${fmt.int(sum(M.map((r) => r.orders)))} customer reviews · ${state.from}–${state.to}`;
  renderHero(f); renderTiles(f); renderInsights(f);
  renderers[activeTab()](f);
}

fetch("data.json").then((r) => r.json()).then((data) => {
  D = data; M = rows(D.monthly);
  const years = [...new Set(M.map((r) => yearOf(r.month)))];
  state.to = years.at(-1);
  ["yFrom", "yTo"].forEach((id) => { $(id).innerHTML = years.map((y) => `<option>${y}</option>`).join(""); });
  $("yFrom").value = state.from; $("yTo").value = state.to;
  const onYears = (e) => {
    state.from = +$("yFrom").value; state.to = +$("yTo").value;
    if (state.from > state.to) { if (e.target.id === "yFrom") state.to = state.from; else state.from = state.to; $("yFrom").value = state.from; $("yTo").value = state.to; }
    renderAll();
  };
  $("yFrom").onchange = onYears; $("yTo").onchange = onYears;

  $("tabs").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll(".tabs button").forEach((el) => { el.classList.toggle("active", el === b); el.setAttribute("aria-selected", el === b); });
    document.querySelectorAll(".panel").forEach((el) => el.classList.remove("active"));
    $("tab-" + b.dataset.tab).classList.add("active");
    renderAll();
  };
  $("fcMetric").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.fcMetric = b.dataset.m;
    document.querySelectorAll("#fcMetric button").forEach((el) => { el.classList.toggle("on", el === b); el.setAttribute("aria-checked", el === b); });
    renderForecast();
  };
  $("horizon").oninput = (e) => { state.horizon = +e.target.value; $("hLabel").textContent = state.horizon + " months"; renderForecast(); };
  $("prodSearch").oninput = (e) => { state.search = e.target.value; renderTable(); };

  $("themeBtn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (err) {}
    renderAll();
  };
  matchMedia("(prefers-color-scheme: dark)").onchange = renderAll;
  renderAll();
}).catch((e) => { $("subtitle").textContent = "Failed to load data.json: " + e; });
