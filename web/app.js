// Static dashboard: reads data.json (built by scripts/export_web_data.py) and draws it with Plotly + inline SVG.
const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const isDark = () => matchMedia("(prefers-color-scheme: dark)").matches
  ? document.documentElement.dataset.theme !== "light" : document.documentElement.dataset.theme === "dark";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = {
  int: (v) => Math.round(v).toLocaleString("en-US"),
  usd: (v) => "$" + Math.round(v).toLocaleString("en-US"),
  usdC: (v) => (v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(0) + "K" : "$" + v.toFixed(0)),
  intC: (v) => (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v))),
  pct: (v, d = 1) => (v * 100).toFixed(d) + "%",
  rating: (v) => v.toFixed(2) + " ★",
  month: (m) => MONTHS[+m.slice(5, 7) - 1] + " " + m.slice(0, 4),
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const rolling = (a, w) => a.map((_, i) => mean(a.slice(Math.max(0, i - w + 1), i + 1)));
const yearOf = (m) => +m.slice(0, 4);
const monOf = (m) => +m.slice(5, 7);
const ok = (v) => Number.isFinite(v);
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

// metric catalogue for the main trend chart
const METRICS = {
  sales: { label: "Sales proxy", f: fmt.usdC, fn: "usdC", tick: "$", tf: ".2~s", win: 12, hov: "%{y:$,.0f}", zero: true },
  orders: { label: "Orders", f: fmt.intC, fn: "intC", tick: "", tf: ".2~s", win: 12, hov: "%{y:,.0f}", zero: true },
  avg_rating: { label: "Average rating", f: fmt.rating, fn: "rating", tick: "", tf: ".1f", win: 6, hov: "%{y:.2f} ★", zero: false },
  new_customers: { label: "New customers", f: fmt.intC, fn: "intC", tick: "", tf: ".2~s", win: 12, hov: "%{y:,.0f}", zero: true },
  pct_positive: { label: "Positive reviews", f: (v) => fmt.pct(v), fn: "pct", tick: "", tf: ".0%", win: 6, hov: "%{y:.1%}", zero: false },
};
const FM = { usdC: fmt.usdC, intC: fmt.intC, int: fmt.int, rating: fmt.rating, pct: (v) => fmt.pct(v) };

let D, M, YEARS;
const state = {
  tab: "brief", from: 2012, to: 2023, metric: "sales", ma: true, cmp: false,
  search: "", sortKey: "orders", sortDir: -1, brand: null,
};

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
    hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--axis"), font: { color: css("--ink"), size: 12.5 }, namelength: -1 },
    legend: { orientation: "h", x: 0, y: 1.12, font: { color: css("--ink2"), size: 12.5 }, bgcolor: "rgba(0,0,0,0)" },
    bargap: 0.38, dragmode: "zoom",
    transition: { duration: reduceMotion ? 0 : 350, easing: "cubic-in-out" },
  };
  for (const k of Object.keys(extra)) {
    l[k] = (extra[k] && typeof extra[k] === "object" && !Array.isArray(extra[k]) && l[k]) ? { ...l[k], ...extra[k] } : extra[k];
  }
  return l;
}
const draw = (id, traces, lay) =>
  Plotly.react(id, traces, lay, { displayModeBar: false, responsive: true, scrollZoom: false });
// attach a plotly event handler exactly once per chart element
function onceOn(id, evt, fn) { const el = $(id); if (!el._bound) el._bound = {}; if (!el._bound[evt]) { el._bound[evt] = 1; el.on(evt, fn); } }
const line = (color, w = 2) => ({ color, width: w, shape: "spline", smoothing: 0.4 });
const dot = (x, y, color) => ({ x: [x], y: [y], mode: "markers", showlegend: false, hoverinfo: "skip",
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
function deltaChip(value, textFn, goodWhenUp = true) {
  if (!ok(value)) return `<span class="chip flat">${ARROW.flat} n/a</span>`;
  const dir = Math.abs(value) < 1e-9 ? "flat" : value > 0 ? "up" : "down";
  const cls = dir === "flat" ? "flat" : (value > 0) === goodWhenUp ? "up" : "down";
  return `<span class="chip ${cls}"><span aria-hidden="true">${ARROW[dir]}</span>${textFn(value)}</span>`;
}
const pctTxt = (v) => (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%";
const numTxt = (d, p = 2) => (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(p) + d;

function sparkline(values, { w = 160, h = 34, pad = 4, color = css("--c1") } = {}) {
  const v = values.filter(ok); if (v.length < 2) return "";
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((y, i) => [pad + (i / (v.length - 1)) * (w - 2 * pad), h - pad - ((y - lo) / span) * (h - 2 * pad)]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts.at(-1);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend">
    <path d="${d} L${last[0]} ${h} L${pts[0][0]} ${h} Z" fill="${rgba(color, 0.10)}"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// value shown with a count-up when it changes; key identifies the element across re-renders
const lastVals = {};
function counter(key, value, fn) {
  return `<span data-count="${value}" data-fn="${fn}" data-key="${key}">${FM[fn](value)}</span>`;
}
function runCounters(root = document) {
  root.querySelectorAll("[data-count]").forEach((el) => {
    const to = +el.dataset.count, key = el.dataset.key, fn = FM[el.dataset.fn];
    const from = lastVals[key] ?? 0; lastVals[key] = to;
    if (reduceMotion || from === to || !ok(to)) return;
    const t0 = performance.now(), dur = 650;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fn(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function tile({ label, value, delta, sub, spark, metric, key }) {
  const tag = metric ? "button" : "div", attrs = metric ? ` type="button" data-metric="${metric}" aria-label="Show ${label} in the main chart"` : "";
  return `<${tag} class="tile${metric && metric === state.metric ? " sel" : ""}"${attrs}><div class="l">${label}</div><div class="v">${value}</div>
    <div class="sub">${delta || ""}${sub ? `<span>${sub}</span>` : ""}</div>${spark ? `<div class="spark">${spark}</div>` : ""}</${tag}>`;
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
  $("hero").classList.toggle("sel", state.metric === "sales");
  $("hero").innerHTML = `
    <div>
      <div class="hero-label">Sales proxy, last 12 months</div>
      <div class="hero-value">${ok(s.cur) ? counter("hero", s.cur, "usdC") : "–"}</div>
      <div class="hero-row">${s.ok ? deltaChip(s.g, pctTxt) : ""}<span>${s.ok ? "vs the 12 months before" : "select 2+ years for a comparison"} · ${fmt.month(f.at(-1).month)} is the latest month</span></div>
    </div>
    <div class="hero-spark">${sparkline(f.slice(-36).map((r) => r.sales), { w: 600, h: 96, pad: 6 })}</div>`;
}

function renderTiles(f) {
  const o = yoy(f, "orders"), r = yoy(f, "avg_rating", "mean"), n = yoy(f, "new_customers"), p = yoy(f, "pct_positive", "mean");
  const l24 = f.slice(-24);
  $("tiles").innerHTML = [
    tile({ metric: "orders", label: "Orders (reviews)", value: counter("t-orders", o.cur, "int"), delta: deltaChip(o.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.orders)) }),
    tile({ metric: "avg_rating", label: "Average rating", value: ok(r.cur) ? counter("t-rating", r.cur, "rating") : "–", delta: deltaChip(r.diff, numTxt("", 2)), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.avg_rating)) }),
    tile({ metric: "new_customers", label: "New customers", value: counter("t-new", n.cur, "int"), delta: deltaChip(n.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.new_customers)) }),
    tile({ metric: "pct_positive", label: "Positive reviews (4–5★)", value: ok(p.cur) ? counter("t-pos", p.cur, "pct") : "–", delta: deltaChip(p.diff * 100, numTxt(" pts", 1)), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.pct_positive)) }),
  ].join("");
}

function renderInsights(f) {
  const items = [];
  const peak = f.reduce((a, b) => (b.sales > a.sales ? b : a), f[0]);
  items.push(["peak", "sales", "Best month", `${fmt.month(peak.month)} led all months with ${fmt.usdC(peak.sales)} in sales proxy.`]);

  const years = [...new Set(f.map((r) => yearOf(r.month)))].filter((y) => f.filter((r) => yearOf(r.month) === y).length === 12);
  const tot = (y) => sum(f.filter((r) => yearOf(r.month) === y).map((r) => r.sales));
  const growth = years.filter((y) => years.includes(y - 1) && tot(y - 1) > 0.2 * Math.max(...years.map(tot))).map((y) => [y, tot(y) / tot(y - 1) - 1]);
  if (growth.length) {
    const [by, bg] = growth.reduce((a, b) => (b[1] > a[1] ? b : a));
    items.push(["grow", "overview", "Fastest growth", `${by} grew ${pctTxt(bg).replace("+", "")} to ${fmt.usdC(tot(by))}, the strongest year in this range.`]);
  }
  const r = yoy(f, "avg_rating", "mean"), neg = yoy(f, "pct_negative", "mean");
  if (r.ok) items.push(["star", "satisfaction", "Satisfaction", `Average rating is ${r.cur.toFixed(2)}, ${r.diff >= 0 ? "up" : "down"} ${Math.abs(r.diff).toFixed(2)} on last year. ${fmt.pct(neg.cur)} of reviews are 1–2★.`]);

  const td = SEG.total.d;
  items.push(["next", "lab", "Outlook", `The model expects ${fmt.usdC(td.fc12)} over the next 12 months, ${pctTxt(td.growth)} vs the last 12.`]);

  $("insights").innerHTML = items.map(([ic, tab, t, body]) =>
    `<li class="go" data-go="${tab}" tabindex="0" role="button"><span class="ins-ic">${icon(ic)}</span><div><b>${t}</b><span class="t">${body}</span></div></li>`).join("");
}

// ---------------------------------------------------------------- tabs
function seqBlue(i, n) { // lighter -> darker blue ramp for ordered series
  const ramp = isDark() ? ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#6da7ec"] : ["#9ec5f4", "#86b6ef", "#5598e7", "#2a78d6", "#256abf", "#184f95"];
  return ramp[Math.round((i / Math.max(1, n - 1)) * (ramp.length - 1))];
}

function renderOverview(f) {
  const mt = METRICS[state.metric], key = state.metric;
  const x = f.map((r) => r.month), y = f.map((r) => r[key]);
  $("trendTitle").textContent = `${mt.label} over time`;
  const peak = f.reduce((a, b) => (b[key] > a[key] ? b : a), f[0]);
  const traces = [
    { x, y, type: "scatter", mode: "lines", name: "Monthly", line: { color: rgba(css("--c1"), state.ma ? 0.5 : 0.95), width: state.ma ? 1.5 : 2.2 }, fill: "tozeroy", fillcolor: rgba(css("--c1"), 0.10), hovertemplate: mt.hov },
  ];
  if (state.ma) traces.push({ x, y: rolling(y, mt.win), type: "scatter", mode: "lines", name: `${mt.win}-month average`, line: line(css("--c1"), 2.6), hovertemplate: mt.hov });
  if (state.cmp && y.length > 12) traces.push({ x: x.slice(12), y: y.slice(0, -12), type: "scatter", mode: "lines", name: "Same month last year", line: { color: css("--muted"), width: 1.8, dash: "dot" }, hovertemplate: mt.hov });
  traces.push(dot(peak.month, peak[key], css("--c2")));
  draw("c-sales-trend", traces, layout({
    margin: { l: 8, r: 24, t: 28, b: 8 },
    xaxis: { rangeslider: { visible: true, thickness: 0.08, bgcolor: css("--page"), bordercolor: css("--border"), borderwidth: 1 } },
    yaxis: { tickprefix: mt.tick, tickformat: mt.tf, rangemode: mt.zero ? "tozero" : "normal" },
    annotations: [{ x: peak.month, y: peak[key], text: `Peak ${mt.f(peak[key])}`, showarrow: false, yshift: 18, font: { color: css("--ink"), size: 12 } }],
  }));

  // annual bars always show every year; years inside the selected range are emphasised
  const all = YEARS, part = (yr) => M.filter((r) => yearOf(r.month) === yr).length;
  const ann = all.map((yr) => sum(M.filter((r) => yearOf(r.month) === yr).map((r) => r.sales)));
  const lbl = ann.map((v, i) => (i && part(all[i]) === 12 && part(all[i - 1]) === 12 ? pctTxt(v / ann[i - 1] - 1) : ""));
  const sel = (yr) => yr >= state.from && yr <= state.to;
  draw("c-annual", [{ x: all.map((yr) => (part(yr) < 12 ? `${yr} YTD` : String(yr))), y: ann, type: "bar",
    marker: { color: all.map((yr) => (sel(yr) ? css("--c1") : rgba(css("--c1"), 0.22))), cornerradius: 4 },
    text: lbl, textposition: "outside", textfont: { color: css("--ink2"), size: 11.5 }, cliponaxis: false,
    hovertemplate: "%{x}: %{y:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", margin: { l: 8, r: 8, t: 24, b: 8 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickprefix: "$", tickformat: ".2~s", range: [0, Math.max(...ann) * 1.18] } }));
  onceOn("c-annual", "plotly_click", (d) => {
    const yr = parseInt(d.points[0].x);
    const same = state.from === yr && state.to === yr;
    setRange(same ? YEARS[0] : yr, same ? YEARS.at(-1) : yr);
    toast(same ? "Showing all years" : `Focused on ${yr}`);
  });

  const rt = rolling(f.map((r) => r.avg_rating), 6), lo = Math.min(...rt), hi = Math.max(...rt);
  draw("c-rating-trend", [
    { x, y: rt, mode: "lines", name: "Avg rating", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.2f} ★" },
    dot(x.at(-1), rt.at(-1), css("--c1")),
  ], layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { range: [Math.floor((lo - 0.1) * 10) / 10, Math.ceil((hi + 0.1) * 10) / 10], tickformat: ".1f" } }));
}

function renderSales(f) {
  const years = [...new Set(f.map((r) => yearOf(r.month)))];
  const z = years.map((yr) => MONTHS.map((_, i) => f.find((r) => yearOf(r.month) === yr && monOf(r.month) === i + 1)?.sales ?? null));
  const scale = isDark() ? [[0, "#0d366b"], [0.5, "#2a78d6"], [1, "#cde2fb"]] : [[0, "#cde2fb"], [0.5, "#3987e5"], [1, "#0d366b"]];
  draw("c-heat", [{ type: "heatmap", x: MONTHS, y: years.map(String), z, colorscale: scale, xgap: 2, ygap: 2, hoverongaps: false,
    colorbar: { thickness: 10, len: 0.9, tickprefix: "$", tickformat: ".2~s", tickfont: { color: css("--muted"), size: 11 }, outlinewidth: 0 },
    hovertemplate: "%{x} %{y}: %{z:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", margin: { l: 8, r: 8, t: 8, b: 8 }, xaxis: { showline: false, side: "top" }, yaxis: { type: "category", autorange: "reversed" } }));

  const ys = years.slice(-6);
  draw("c-season", ys.map((yr, i) => {
    const d = f.filter((r) => yearOf(r.month) === yr), latest = i === ys.length - 1;
    return { x: d.map((r) => monOf(r.month)), y: d.map((r) => r.sales), name: String(yr), mode: "lines", line: line(seqBlue(i, ys.length), latest ? 3 : 1.8), hovertemplate: "%{y:$,.0f}" };
  }), layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, xaxis: { tickmode: "array", tickvals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ticktext: MONTHS.map((m) => m[0]), showline: true }, yaxis: { tickprefix: "$", tickformat: ".2~s" } }));

  const x = f.map((r) => r.month);
  draw("c-aov", [{ x, y: f.map((r) => (r.orders ? r.sales / r.orders : null)), mode: "lines", name: "Avg order value", line: line(css("--c2"), 2.5), hovertemplate: "%{y:$.2f}" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickprefix: "$", tickformat: ".0f" } }));

  const sales = f.map((r) => r.sales), g = sales.map((v, i) => (i >= 12 ? v / sales[i - 12] - 1 : null));
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
  const lastMix = mix.filter((r) => months.slice(-12).includes(r.month));
  const shareOf = (k) => sum(lastMix.filter((r) => r.rating === k).map((r) => r.n)) / sum(lastMix.map((r) => r.n));
  $("satTiles").innerHTML = [
    tile({ label: "Net satisfaction score", value: (cur >= 0 ? "+" : "") + cur.toFixed(0), delta: deltaChip(cur - prev, numTxt(" pts", 0)), sub: "positive% − negative%", spark: sparkline(f.slice(-24).map((r) => r.pct_positive - r.pct_negative)) }),
    tile({ label: "5★ share, last 12 mo", value: fmt.pct(shareOf(5), 0), sub: "of all reviews" }),
    tile({ label: "1★ share, last 12 mo", value: fmt.pct(shareOf(1), 0), sub: "of all reviews" }),
  ].join("");
}

function renderCustomers(f) {
  const x = f.map((r) => r.month), ret = f.map((r) => Math.max(0, r.customers - r.new_customers));
  draw("c-cust", [
    { x, y: f.map((r) => r.new_customers), type: "bar", name: "New customers", marker: { color: css("--c1") }, hovertemplate: "%{y:,}" },
    { x, y: ret, type: "bar", name: "Returning customers", marker: { color: seqBlue(0, 6) }, hovertemplate: "%{y:,}" },
  ], layout({ barmode: "stack", bargap: 0.18, margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".2~s" } }));
  draw("c-newshare", [{ x, y: rolling(f.map((r) => r.new_customers / r.customers), 6), mode: "lines", name: "New share", line: line(css("--c4"), 2.5), hovertemplate: "%{y:.1%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 12, b: 8 }, yaxis: { tickformat: ".0%", range: [0.8, 1] } }));

  const last = f.slice(-12), prev = f.slice(-24, -12);
  const act = sum(last.map((r) => r.customers)), actP = sum(prev.map((r) => r.customers));
  const newShare = sum(last.map((r) => r.new_customers)) / act;
  $("custTiles").innerHTML = [
    tile({ label: "Active customer-months", value: fmt.int(act), delta: deltaChip(act / actP - 1, pctTxt), sub: "vs prior 12 mo", spark: sparkline(f.slice(-24).map((r) => r.customers)) }),
    tile({ label: "First-time share", value: fmt.pct(newShare), sub: "of active customers" }),
    tile({ label: "Returning share", value: fmt.pct(1 - newShare), sub: "reviewed before" }),
  ].join("");
}

function brandAgg(bm) {
  const agg = {};
  bm.forEach((r) => { const a = (agg[r.brand] ||= { orders: 0, sales: 0, rs: 0 }); a.orders += r.orders; a.sales += r.sales; a.rs += r.rating_sum; });
  return agg;
}

function renderBrands() {
  const bm = rows(D.brand_monthly).filter(inRange), agg = brandAgg(bm);
  const top = Object.entries(agg).sort((a, b) => b[1].sales - a[1].sales).slice(0, 12), rev = [...top].reverse();
  const picked = state.brand;
  draw("c-brands", [{ y: rev.map((t) => t[0]), x: rev.map((t) => t[1].sales), type: "bar", orientation: "h",
    marker: { color: rev.map((t) => (!picked || t[0] === picked ? css("--c1") : rgba(css("--c1"), 0.28))), cornerradius: 4 },
    text: rev.map((t) => fmt.usdC(t[1].sales)), textposition: "outside", textfont: { color: css("--ink2"), size: 12 }, cliponaxis: false,
    hovertemplate: "%{y}: %{x:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", bargap: 0.3, margin: { l: 8, r: 56, t: 8, b: 8 }, xaxis: { showgrid: true, tickprefix: "$", tickformat: ".2~s", showline: false }, yaxis: { showgrid: false, automargin: true } }));
  onceOn("c-brands", "plotly_click", (d) => setBrand(d.points[0].y));

  const maxS = Math.max(...top.map((t) => t[1].sales));
  draw("c-bubble", [{ x: top.map((t) => t[1].orders), y: top.map((t) => t[1].rs / t[1].orders), text: top.map((t) => t[0]), mode: "markers+text", textposition: "top center",
    textfont: { color: css("--ink2"), size: 11 },
    marker: { size: top.map((t) => 12 + (t[1].sales / maxS) * 34), color: top.map((t) => (!picked || t[0] === picked ? rgba(css("--c1"), 0.7) : rgba(css("--c1"), 0.2))), line: { color: css("--surface"), width: 2 } },
    hovertemplate: "%{text}<br>%{x:,} reviews · %{y:.2f} ★<extra></extra>" }],
    layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 16, t: 16, b: 8 },
      xaxis: { type: "log", title: { text: "Reviews (log scale)", font: { color: css("--muted"), size: 12 } }, showgrid: true, showline: true },
      yaxis: { title: { text: "Average rating", font: { color: css("--muted"), size: 12 } }, tickformat: ".1f" } }));
  onceOn("c-bubble", "plotly_click", (d) => setBrand(d.points[0].text));

  renderBrandDetail(bm, agg);
  renderTable();
}

function setBrand(b) {
  state.brand = state.brand === b ? null : b;
  renderBrands(); syncUI();
  if (state.brand) $("brandDetail").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
}

function renderBrandDetail(bm, agg) {
  const box = $("brandDetail"), b = state.brand;
  box.hidden = !b || !agg[b];
  if (box.hidden) return;
  $("brandName").textContent = b;
  const mine = bm.filter((r) => r.brand === b).sort((a, c) => a.month.localeCompare(c.month));
  const a = agg[b], totalSales = sum(Object.values(agg).map((v) => v.sales));
  $("brandTiles").innerHTML = [
    tile({ label: "Sales proxy", value: fmt.usdC(a.sales), sub: "selected years" }),
    tile({ label: "Reviews", value: fmt.int(a.orders), sub: "selected years" }),
    tile({ label: "Average rating", value: fmt.rating(a.rs / a.orders), sub: "weighted by reviews" }),
    tile({ label: "Share of top-25 brands", value: fmt.pct(a.sales / totalSales), sub: "by sales proxy" }),
  ].join("");
  const x = mine.map((r) => r.month);
  draw("c-brand-sales", [{ x, y: mine.map((r) => r.sales), mode: "lines", name: "Sales proxy", line: line(css("--c1"), 2.2), fill: "tozeroy", fillcolor: rgba(css("--c1"), 0.10), hovertemplate: "%{y:$,.0f}" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 22, b: 8 }, title: { text: "Monthly sales proxy", x: 0.01, font: { size: 13, color: css("--ink2") } }, yaxis: { tickprefix: "$", tickformat: ".2~s", rangemode: "tozero" } }));
  draw("c-brand-rating", [{ x, y: rolling(mine.map((r) => r.rating_sum / r.orders), 6), mode: "lines", name: "Rating", line: line(css("--c2"), 2.2), hovertemplate: "%{y:.2f} ★" }],
    layout({ showlegend: false, margin: { l: 8, r: 8, t: 22, b: 8 }, title: { text: "Average rating (6-month smoothed)", x: 0.01, font: { size: 13, color: css("--ink2") } }, yaxis: { tickformat: ".1f" } }));
}

const COLS = [["title", "Product", false], ["brand", "Brand", false], ["price", "Price", true], ["orders", "Reviews", true], ["sales", "Sales proxy", true], ["avg_rating", "Rating", true]];
function renderTable() {
  const q = state.search.trim().toLowerCase(), k = state.sortKey, dir = state.sortDir;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const p = rows(D.products).filter((r) => !q || (r.title + " " + r.brand).toLowerCase().includes(q))
    .sort((a, b) => {
      const x = a[k] ?? -Infinity, y = b[k] ?? -Infinity;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir;
    });
  const head = COLS.map(([key, label, num]) => `<th class="sortable${num ? " n" : ""}${key === k ? " sorted" : ""}" data-sort="${key}" aria-sort="${key === k ? (dir > 0 ? "ascending" : "descending") : "none"}">${label}${key === k ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("");
  $("products").innerHTML = `<thead><tr>${head}</tr></thead><tbody>` +
    (p.length ? p.map((r) => `<tr><td class="t" title="${esc(r.title)}">${esc(r.title)}</td><td>${esc(r.brand)}</td>
      <td class="n">${r.price == null ? "–" : "$" + r.price.toFixed(2)}</td><td class="n">${fmt.int(r.orders)}</td>
      <td class="n">${fmt.usd(r.sales)}</td><td class="n"><span class="pill">${r.avg_rating.toFixed(2)} ★</span></td></tr>`).join("")
      : `<tr><td colspan="6">No products match "${esc(state.search)}".</td></tr>`) + "</tbody>";
}

// ---------------------------------------------------------------- state, sync, URL
const renderers = {
  overview: renderOverview, sales: renderSales, satisfaction: renderSatisfaction,
  customers: renderCustomers, brief: () => renderBrief(), lab: () => renderLab(), brands: () => renderBrands(),
};

const PRESETS = () => {
  const lo = YEARS[0], hi = YEARS.at(-1);
  return { all: [lo, hi], last5: [hi - 4, hi], last3: [hi - 2, hi], pre2020: [lo, 2019], since2020: [2020, hi] };
};

function syncUI() {
  $("yFrom").value = state.from; $("yTo").value = state.to;
  document.querySelectorAll("#presets [data-p]").forEach((b) => {
    const [a, c] = PRESETS()[b.dataset.p]; b.classList.toggle("on", a === state.from && c === state.to);
  });
  document.querySelectorAll("#metricSeg button").forEach((b) => { const on = b.dataset.m === state.metric; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  $("maToggle").setAttribute("aria-pressed", state.ma); $("cmpToggle").setAttribute("aria-pressed", state.cmp);
  document.querySelectorAll("#tabs button").forEach((b) => { const on = b.dataset.tab === state.tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + state.tab));
  document.querySelectorAll(".tile[data-metric]").forEach((t) => t.classList.toggle("sel", t.dataset.metric === state.metric));
  $("hero").classList.toggle("sel", state.metric === "sales");
  document.body.dataset.tab = state.tab;
  writeHash();
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.tab !== "brief") p.set("tab", state.tab);
  if (state.from !== YEARS[0]) p.set("from", state.from);
  if (state.to !== YEARS.at(-1)) p.set("to", state.to);
  if (state.metric !== "sales") p.set("m", state.metric);
  if (state.brand) p.set("brand", state.brand);
  labWriteHash(p);
  const s = p.toString();
  try { history.replaceState(null, "", s ? "#" + s : location.pathname + location.search); } catch (e) {}
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)), lo = YEARS[0], hi = YEARS.at(-1);
  const num = (k, d, a, b) => { const v = parseInt(p.get(k)); return Number.isFinite(v) && v >= a && v <= b ? v : d; };
  if (renderers[p.get("tab")]) state.tab = p.get("tab");
  state.from = num("from", lo, lo, hi); state.to = num("to", hi, lo, hi);
  if (state.from > state.to) { state.from = lo; state.to = hi; }
  if (METRICS[p.get("m")]) state.metric = p.get("m");
  labReadHash(p);
  if (p.get("brand")) state.brand = p.get("brand");
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function renderAll() {
  const f = filtered();
  $("subtitle").textContent = `Amazon · ${fmt.int(sum(M.map((r) => r.orders)))} customer reviews · ${state.from}–${state.to}`;
  if (state.tab === "overview") { renderHero(f); renderTiles(f); renderInsights(f); }
  renderers[state.tab](f);
  runCounters();
}
function setRange(a, b) { state.from = a; state.to = b; syncUI(); renderAll(); }
function goTab(t) { state.tab = t; syncUI(); renderAll(); }
function selectMetric(m) { state.metric = m; state.tab = "overview"; syncUI(); renderAll(); }

function downloadCsv() {
  const cols = ["month", "orders", "sales", "avg_rating", "pct_positive", "pct_negative", "customers", "new_customers"];
  const csv = [cols.join(",")].concat(filtered().map((r) => cols.map((c) => r[c]).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `amazon-appliances-${state.from}-${state.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast("CSV downloaded");
}

Promise.all([fetch("data.json").then((r) => r.json()), fetch("forecast.json").then((r) => r.json())]).then(([data, fdata]) => {
  D = data; M = rows(D.monthly); prepForecast(fdata); // years before 2012 have almost no data, so the range controls start at 2012
  YEARS = [...new Set(M.map((r) => yearOf(r.month)))].filter((y) => y >= 2012);
  state.from = YEARS[0]; state.to = YEARS.at(-1);
  readHash();
  ["yFrom", "yTo"].forEach((id) => { $(id).innerHTML = YEARS.map((y) => `<option>${y}</option>`).join(""); });

  $("yFrom").onchange = () => { const a = +$("yFrom").value; setRange(a, Math.max(a, state.to)); };
  $("yTo").onchange = () => { const b = +$("yTo").value; setRange(Math.min(b, state.from), b); };
  $("presets").onclick = (e) => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    const [a, c] = PRESETS()[b.dataset.p]; setRange(a, c);
  };
  $("csvBtn").onclick = downloadCsv;
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) goTab(b.dataset.tab); };

  // metric selection from tiles, hero, segmented control
  const pick = (e) => { const t = e.target.closest("[data-metric]"); if (t) selectMetric(t.dataset.metric); };
  $("tiles").onclick = pick; $("hero").onclick = pick;
  $("hero").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMetric("sales"); } };
  $("metricSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.metric = b.dataset.m; syncUI(); renderAll(); } };
  $("maToggle").onclick = () => { state.ma = !state.ma; syncUI(); renderAll(); };
  $("cmpToggle").onclick = () => { state.cmp = !state.cmp; syncUI(); renderAll(); };

  // insights jump to the relevant tab
  const go = (e) => { const li = e.target.closest("[data-go]"); if (li) goTab(li.dataset.go); };
  $("insights").onclick = go;
  $("insights").onkeydown = (e) => { if (e.key === "Enter") go(e); };

  initLab();

  // brands & products
  $("brandClose").onclick = () => { state.brand = null; syncUI(); renderBrands(); };
  $("prodSearch").oninput = (e) => { state.search = e.target.value; renderTable(); };
  $("products").onclick = (e) => {
    const th = e.target.closest("[data-sort]"); if (!th) return;
    const k = th.dataset.sort;
    state.sortDir = state.sortKey === k ? -state.sortDir : (k === "title" || k === "brand" ? 1 : -1); state.sortKey = k;
    renderTable();
  };

  $("shareBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link to this view copied"); }
    catch (err) { toast("Copy the address bar to share this view"); }
  };
  $("themeBtn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (err) {}
    renderAll();
  };
  matchMedia("(prefers-color-scheme: dark)").onchange = renderAll;
  window.addEventListener("hashchange", () => { readHash(); syncUI(); renderAll(); });
  syncUI(); renderAll();
}).catch((e) => { $("subtitle").textContent = "Failed to load data: " + e; });
