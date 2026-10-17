// Core of the dashboard: shared helpers, tabs, URL state and start-up. Each tab's logic lives in its own file.
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
const esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sgn = (v, f) => (v >= 0 ? "+" : "−") + f(Math.abs(v));
const store = {                                   // small per-viewer conveniences (saved targets); never required
  get(k) { try { return localStorage.getItem("dash." + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem("dash." + k, v); } catch (e) {} },
};

// metrics for the Performance trend chart
const METRICS = {
  sales: { label: "Sales proxy", f: fmt.usdC, fn: "usdC", tick: "$", tf: ".2~s", win: 12, hov: "%{y:$,.0f}", zero: true },
  orders: { label: "Reviews", f: fmt.intC, fn: "intC", tick: "", tf: ".2~s", win: 12, hov: "%{y:,.0f}", zero: true },
  avg_rating: { label: "Average rating", f: fmt.rating, fn: "rating", tick: "", tf: ".1f", win: 6, hov: "%{y:.2f} ★", zero: false },
  pct_positive: { label: "Positive reviews", f: (v) => fmt.pct(v), fn: "pct", tick: "", tf: ".0%", win: 6, hov: "%{y:.1%}", zero: false },
};
const FM = { usdC: fmt.usdC, intC: fmt.intC, int: fmt.int, rating: fmt.rating, pct: (v) => fmt.pct(v) };

let D, M, YEARS;
const state = { tab: "brief", from: 2012, to: 2023, metric: "sales", ma: true, cmp: false, ev: false };
const TABS = ["brief", "market", "lab", "products", "lifecycle", "performance", "quality"];   // quality is "About the data" (footer link)
const TAB_ALIAS = { overview: "performance", sales: "performance", satisfaction: "performance", customers: "performance", brands: "products" };

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
function onceOn(id, evt, fn) { const el = $(id); if (!el._bound) el._bound = {}; if (!el._bound[evt]) { el._bound[evt] = 1; el.on(evt, fn); } }
const line = (color, w = 2) => ({ color, width: w, shape: "spline", smoothing: 0.4 });
const dot = (x, y, color) => ({ x: [x], y: [y], mode: "markers", showlegend: false, hoverinfo: "skip",
  marker: { size: 10, color, line: { color: css("--surface"), width: 2 } } });
function seqBlue(i, n) { // lighter -> darker blue ramp for ordered series
  const ramp = isDark() ? ["#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5", "#6da7ec"] : ["#9ec5f4", "#86b6ef", "#5598e7", "#2a78d6", "#256abf", "#184f95"];
  return ramp[Math.round((i / Math.max(1, n - 1)) * (ramp.length - 1))];
}

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
const info = (text) => `<button type="button" class="tip" aria-label="${esc2(text)}" data-tip="${esc2(text)}">i</button>`;   // short explanation on hover or focus

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

// numbers count up when they change; key identifies the element across re-renders
const lastVals = {};
function counter(key, value, fn) { return `<span data-count="${value}" data-fn="${fn}" data-key="${key}">${FM[fn](value)}</span>`; }
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

function tile({ label, value, delta, sub, spark, metric }) {
  const tag = metric ? "button" : "div", attrs = metric ? ` type="button" data-metric="${metric}" aria-label="Show ${label} in the main chart"` : "";
  return `<${tag} class="tile${metric && metric === state.metric ? " sel" : ""}"${attrs}><div class="l">${label}</div><div class="v">${value}</div>
    <div class="sub">${delta || ""}${sub ? `<span>${sub}</span>` : ""}</div>${spark ? `<div class="spark">${spark}</div>` : ""}</${tag}>`;
}

// ---------------------------------------------------------------- shared header: how fresh is each source?
function renderFreshness() {
  if (!F || !MK) return;
  const items = [
    ["Reviews", fmt.month(F.meta.last_month), monthsAgo(F.meta.last_month)],
    ["Amazon", qLabel(MK.meta.amazon_latest_quarter), monthsAgo(MK.meta.amazon_latest_quarter, 2)],
    ["Market", fmt.month(MK.fred.RSNSR.dates.at(-1)), monthsAgo(MK.fred.RSNSR.dates.at(-1))],
  ];
  const cls = (a) => (a <= 4 ? "good" : a <= 12 ? "warn" : "bad");
  const worst = items.some(([, , a]) => a > 12) ? "bad" : items.some(([, , a]) => a > 4) ? "warn" : "good";
  $("freshChips").innerHTML = `<button type="button" class="fchip all ${worst}" data-go-tab="quality" title="About the data"><span class="fdot"></span>Data</button>` +
    items.map(([n, v, a]) => `<button type="button" class="fchip ${cls(a)}" data-go-tab="quality" title="${n} data: latest ${v} (${ageText(a)}). Click for details."><span class="fdot"></span><b>${n}</b> ${v}</button>`).join("");
}

// ---------------------------------------------------------------- tabs, URL, rendering
const renderers = {
  brief: () => renderBrief(), market: () => renderMarket(), lab: () => renderLab(), products: () => renderProducts(),
  lifecycle: () => renderLifecycle(), performance: (f) => renderPerformance(f), quality: () => renderQuality(),
};
const PRESETS = () => {
  const lo = YEARS[0], hi = YEARS.at(-1);
  return { all: [lo, hi], last5: [hi - 4, hi], last3: [hi - 2, hi], pre2020: [lo, 2019], since2020: [2020, hi] };
};

function syncUI() {
  $("yFrom").value = state.from; $("yTo").value = state.to;
  document.querySelectorAll("#presets [data-p]").forEach((b) => { const [a, c] = PRESETS()[b.dataset.p]; b.classList.toggle("on", a === state.from && c === state.to); });
  document.querySelectorAll("#metricSeg button").forEach((b) => { const on = b.dataset.m === state.metric; b.classList.toggle("on", on); b.setAttribute("aria-checked", on); });
  $("maToggle").setAttribute("aria-pressed", state.ma); $("cmpToggle").setAttribute("aria-pressed", state.cmp); $("evToggle").setAttribute("aria-pressed", state.ev);
  document.querySelectorAll("#tabs button").forEach((b) => { const on = b.dataset.tab === state.tab; b.classList.toggle("active", on); b.setAttribute("aria-selected", on); });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + state.tab));
  document.querySelectorAll(".tile[data-metric]").forEach((t) => t.classList.toggle("sel", t.dataset.metric === state.metric));
  document.body.dataset.tab = state.tab;
  writeHash();
}

function writeHash() {
  const p = new URLSearchParams();
  if (state.tab !== "brief") p.set("tab", state.tab);
  if (state.from !== YEARS[0]) p.set("from", state.from);
  if (state.to !== YEARS.at(-1)) p.set("to", state.to);
  if (state.metric !== "sales") p.set("m", state.metric);
  labWriteHash(p);
  if (state.px.sel) p.set("pid", state.px.sel);
  if (state.px.view !== "find") p.set("pv", state.px.view);
  cmpWriteHash(p);
  const s = p.toString();
  try { history.replaceState(null, "", s ? "#" + s : location.pathname + location.search); } catch (e) {}
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)), lo = YEARS[0], hi = YEARS.at(-1);
  const num = (k, d, a, b) => { const v = parseInt(p.get(k)); return Number.isFinite(v) && v >= a && v <= b ? v : d; };
  let tab = p.get("tab"); tab = TAB_ALIAS[tab] || tab;
  if (TABS.includes(tab)) state.tab = tab;
  if (p.get("tab") === "brands") state.px.view = "brands";
  state.from = num("from", lo, lo, hi); state.to = num("to", hi, lo, hi);
  if (state.from > state.to) { state.from = lo; state.to = hi; }
  if (METRICS[p.get("m")]) state.metric = p.get("m");
  labReadHash(p);
  if (p.get("pid")) state.px.sel = p.get("pid");
  if (["find", "compare", "brands"].includes(p.get("pv"))) state.px.view = p.get("pv");
  cmpReadHash(p);
}

let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function renderAll() {
  const f = filtered();
  $("subtitle").textContent = `Amazon Appliances · ${fmt.int(sum(M.map((r) => r.orders)))} customer reviews`;
  renderers[state.tab](f);
  runCounters();
}
function setRange(a, b) { state.from = a; state.to = b; syncUI(); renderAll(); }
function goTab(t) { state.tab = t; syncUI(); renderAll(); window.scrollTo({ top: 0, behavior: "auto" }); }
function selectMetric(m) { state.metric = m; syncUI(); renderAll(); }

function downloadCsv() {
  const cols = ["month", "orders", "sales", "sales_obs", "avg_rating", "pct_positive", "pct_negative", "customers", "new_customers"];
  const csv = [cols.join(",")].concat(filtered().map((r) => cols.map((c) => r[c]).join(","))).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `amazon-appliances-${state.from}-${state.to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  toast("CSV downloaded");
}

function start() { Promise.all(["data.json", "forecast.json", "market.json", "quality.json", "cohorts.json", "topics.json"].map((u) => fetch(u).then((r) => r.json()))).then(([data, fdata, mdata, qdata, cdata, tdata]) => {
  D = data; M = rows(D.monthly); prepForecast(fdata); prepMarket(mdata); prepQuality(qdata); prepLifecycle(cdata); prepTopics(tdata);
  YEARS = [...new Set(M.map((r) => yearOf(r.month)))].filter((y) => y >= 2012);        // years before 2012 have almost no data
  state.from = YEARS[0]; state.to = YEARS.at(-1);
  readHash();
  ["yFrom", "yTo"].forEach((id) => { $(id).innerHTML = YEARS.map((y) => `<option>${y}</option>`).join(""); });
  renderFreshness();

  $("yFrom").onchange = () => { const a = +$("yFrom").value; setRange(a, Math.max(a, state.to)); };
  $("yTo").onchange = () => { const b = +$("yTo").value; setRange(Math.min(b, state.from), b); };
  $("presets").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { const [a, c] = PRESETS()[b.dataset.p]; setRange(a, c); } };
  $("csvBtn").onclick = downloadCsv;
  $("tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) goTab(b.dataset.tab); };
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-go-tab]"); if (b) goTab(b.dataset.goTab); });

  // Performance: tiles and the chart's own controls
  $("tiles").onclick = (e) => { const t = e.target.closest("[data-metric]"); if (t) selectMetric(t.dataset.metric); };
  $("metricSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) selectMetric(b.dataset.m); };
  $("maToggle").onclick = () => { state.ma = !state.ma; syncUI(); renderAll(); };
  $("cmpToggle").onclick = () => { state.cmp = !state.cmp; syncUI(); renderAll(); };
  $("evToggle").onclick = () => { state.ev = !state.ev; syncUI(); renderAll(); };

  initLab(); initProducts(); initLifecycle(); initPerformance(); initCompare();
  loadPrevious();                                                                       // for the "what changed" box; not needed to render the page

  $("printBtn").onclick = () => window.print();
  window.addEventListener("beforeprint", () => { $("printStamp").textContent = `${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · category data to ${fmt.month(F.meta.last_month)} · Amazon to ${qLabel(MK.meta.amazon_latest_quarter)}`; });
  $("shareBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link to this view copied"); }
    catch (err) { toast("Copy the address bar to share this view"); }
  };
  $("themeBtn").onclick = () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    try { localStorage.setItem("theme", next); } catch (err) {}
    renderAll();
  };
  matchMedia("(prefers-color-scheme: dark)").onchange = renderAll;
  window.addEventListener("hashchange", () => { readHash(); syncUI(); renderAll(); });
  syncUI(); renderAll();
}).catch((e) => { $("subtitle").textContent = "Failed to load data: " + e; }); }
window.addEventListener("DOMContentLoaded", start);   // after every script file has run
