// Performance tab: how the category is doing (sales proxy, reviews, rating), seasonality, satisfaction, and what
// customers talk about. Replaces the former Overview, Sales, Satisfaction and Customers tabs.

let TP = null;
Object.assign(state, { tp: { view: "all" } });
function prepTopics(d) { TP = d; }

// Context for trend charts. Marked as context only, never as proven causes.
const EVENTS = [
  { m: "2016-10", t: "Incentivised reviews banned" },
  { m: "2020-03", t: "COVID-19 pandemic declared" },
  { m: "2020-10", t: "Prime Day moved to October" },
  { m: "2023-03", t: "Data ends" },
];

function renderPerformance(f) {
  renderPerfTiles(f); renderTrend(f); renderAnnualAndSeason(f); renderSatisfaction(f); renderTopics();
}

function renderPerfTiles(f) {
  const s = yoy(f, "sales"), o = yoy(f, "orders"), r = yoy(f, "avg_rating", "mean"), p = yoy(f, "pct_positive", "mean"), l24 = f.slice(-24);
  const last = f.slice(-12), newShare = sum(last.map((x) => x.new_customers)) / sum(last.map((x) => x.customers));
  const prevS = f.slice(-24, -12).length ? sum(f.slice(-24, -12).map((x) => x.new_customers)) / sum(f.slice(-24, -12).map((x) => x.customers)) : NaN;
  $("tiles").innerHTML = [
    tile({ metric: "sales", label: "Sales proxy, last 12 months", value: ok(s.cur) ? counter("t-sales", s.cur, "usdC") : "–", delta: deltaChip(s.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.sales)) }),
    tile({ metric: "orders", label: "Reviews", value: counter("t-orders", o.cur, "int"), delta: deltaChip(o.g, pctTxt), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.orders)) }),
    tile({ metric: "avg_rating", label: "Average rating", value: ok(r.cur) ? counter("t-rating", r.cur, "rating") : "–", delta: deltaChip(r.diff, numTxt("", 2)), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.avg_rating)) }),
    tile({ metric: "pct_positive", label: "Positive reviews (4–5★)", value: ok(p.cur) ? counter("t-pos", p.cur, "pct") : "–", delta: deltaChip(p.diff * 100, numTxt(" pts", 1)), sub: "vs prior 12 mo", spark: sparkline(l24.map((x) => x.pct_positive)) }),
    tile({ label: "First-time reviewers", value: fmt.pct(newShare, 0), delta: ok(prevS) ? deltaChip((newShare - prevS) * 100, numTxt(" pts", 1)) : "", sub: "of reviewers, last 12 mo" }),
  ].join("");
}

function renderTrend(f) {
  const mt = METRICS[state.metric], key = state.metric;
  const x = f.map((r) => r.month), y = f.map((r) => r[key]);
  $("trendTitle").textContent = `${mt.label} over time`;
  const peak = f.reduce((a, b) => (b[key] > a[key] ? b : a), f[0]);
  const traces = [{ x, y, type: "scatter", mode: "lines", name: "Monthly", line: { color: rgba(css("--c1"), state.ma ? 0.5 : 0.95), width: state.ma ? 1.5 : 2.2 }, fill: "tozeroy", fillcolor: rgba(css("--c1"), 0.10), hovertemplate: mt.hov }];
  if (state.ma) traces.push({ x, y: rolling(y, mt.win), type: "scatter", mode: "lines", name: `${mt.win}-month average`, line: line(css("--c1"), 2.6), hovertemplate: mt.hov });
  if (state.cmp && y.length > 12) traces.push({ x: x.slice(12), y: y.slice(0, -12), type: "scatter", mode: "lines", name: "Same month last year", line: { color: css("--muted"), width: 1.8, dash: "dot" }, hovertemplate: mt.hov });
  traces.push(dot(peak.month, peak[key], css("--c2")));
  const ann = [{ x: peak.month, y: peak[key], text: `Peak ${mt.f(peak[key])}`, showarrow: false, yshift: 18, font: { color: css("--ink"), size: 12 } }], shapes = [];
  if (state.ev) {
    EVENTS.filter((e) => e.m >= x[0] && e.m <= x.at(-1)).forEach((e, i) => {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: e.m, x1: e.m, y0: 0, y1: 1, line: { color: css("--axis"), width: 1, dash: "dot" } });
      ann.push({ x: e.m, xref: "x", y: 1, yref: "paper", text: e.t, showarrow: false, textangle: -90, xanchor: "right", yanchor: "top", xshift: -3, font: { size: 11, color: css("--muted") } });
    });
  }
  draw("c-sales-trend", traces, layout({
    margin: { l: 8, r: 24, t: 28, b: 8 }, shapes, annotations: ann,
    xaxis: { rangeslider: { visible: true, thickness: 0.08, bgcolor: css("--page"), bordercolor: css("--border"), borderwidth: 1 } },
    yaxis: { tickprefix: mt.tick, tickformat: mt.tf, rangemode: mt.zero ? "tozero" : "normal" },
  }));
}

function renderAnnualAndSeason(f) {
  // annual bars always show every year; years inside the selected range are emphasised; click to focus
  const all = YEARS, part = (yr) => M.filter((r) => yearOf(r.month) === yr).length;
  const ann = all.map((yr) => sum(M.filter((r) => yearOf(r.month) === yr).map((r) => r.sales)));
  const lbl = ann.map((v, i) => (i && part(all[i]) === 12 && part(all[i - 1]) === 12 ? pctTxt(v / ann[i - 1] - 1) : ""));
  const sel = (yr) => yr >= state.from && yr <= state.to;
  draw("c-annual", [{ x: all.map((yr) => (part(yr) < 12 ? `${yr} YTD` : String(yr))), y: ann, type: "bar",
    marker: { color: all.map((yr) => (sel(yr) ? css("--c1") : rgba(css("--c1"), 0.22))), cornerradius: 4 },
    text: lbl, textposition: "outside", textfont: { color: css("--ink2"), size: 11.5 }, cliponaxis: false, hovertemplate: "%{x}: %{y:$,.0f}<extra></extra>" }],
    layout({ hovermode: "closest", margin: { l: 8, r: 8, t: 24, b: 8 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickprefix: "$", tickformat: ".2~s", range: [0, Math.max(...ann) * 1.18] } }));
  onceOn("c-annual", "plotly_click", (d) => {
    const yr = parseInt(d.points[0].x), same = state.from === yr && state.to === yr;
    setRange(same ? YEARS[0] : yr, same ? YEARS.at(-1) : yr); toast(same ? "Showing all years" : `Focused on ${yr}`);
  });

  const years = [...new Set(f.map((r) => yearOf(r.month)))], ys = years.slice(-6);
  draw("c-season", ys.map((yr, i) => {
    const d = f.filter((r) => yearOf(r.month) === yr), latest = i === ys.length - 1;
    return { x: d.map((r) => monOf(r.month)), y: d.map((r) => r.sales), name: String(yr), mode: "lines", line: line(seqBlue(i, ys.length), latest ? 3 : 1.8), hovertemplate: "%{y:$,.0f}" };
  }), layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, xaxis: { tickmode: "array", tickvals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ticktext: MONTHS.map((m) => m[0]), showline: true }, yaxis: { tickprefix: "$", tickformat: ".2~s" } }));
}

function renderSatisfaction(f) {
  const mix = rows(D.rating_mix).filter(inRange), months = [...new Set(mix.map((r) => r.month))];
  const col = { 1: "#e34948", 2: "#f0908f", 3: isDark() ? "#4a4a46" : "#cfcdc5", 4: "#86b6ef", 5: css("--c1") };
  const totals = Object.fromEntries(months.map((m) => [m, sum(mix.filter((r) => r.month === m).map((r) => r.n))]));
  draw("c-mix", [1, 2, 3, 4, 5].map((k) => ({ x: months, name: k + "★", stackgroup: "one", mode: "lines", line: { width: 0.6, color: css("--surface") }, fillcolor: col[k], hovertemplate: "%{y:.0%}",
    y: months.map((m) => (mix.find((r) => r.month === m && r.rating === k)?.n || 0) / totals[m]) })),
    layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".0%", range: [0, 1] } }));
  const x = f.map((r) => r.month);
  draw("c-posneg", [
    { x, y: rolling(f.map((r) => r.pct_positive), 6), mode: "lines", name: "Positive (4–5★)", line: line(css("--c1"), 2.5), hovertemplate: "%{y:.1%}" },
    { x, y: rolling(f.map((r) => r.pct_negative), 6), mode: "lines", name: "Negative (1–2★)", line: line("#e34948", 2.5), hovertemplate: "%{y:.1%}" },
  ], layout({ margin: { l: 8, r: 8, t: 28, b: 8 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));
  const nps = (a) => mean(a.map((r) => r.pct_positive - r.pct_negative)) * 100, cur = nps(f.slice(-12)), prev = nps(f.slice(-24, -12));
  const lastMix = mix.filter((r) => months.slice(-12).includes(r.month)), shareOf = (k) => sum(lastMix.filter((r) => r.rating === k).map((r) => r.n)) / sum(lastMix.map((r) => r.n));
  $("satTiles").innerHTML = [
    tile({ label: "Net satisfaction score", value: (cur >= 0 ? "+" : "") + cur.toFixed(0), delta: deltaChip(cur - prev, numTxt(" pts", 0)), sub: "positive% − negative%", spark: sparkline(f.slice(-24).map((r) => r.pct_positive - r.pct_negative)) }),
    tile({ label: "5★ share, last 12 mo", value: fmt.pct(shareOf(5), 0), sub: "of all reviews" }),
    tile({ label: "1★ share, last 12 mo", value: fmt.pct(shareOf(1), 0), sub: "of all reviews" }),
  ].join("");
}

// ---------------------------------------------------------------- what customers talk about, category-wide
const TOPIC_DEFAULT = ["leak", "durability", "service", "fit", "install", "performance"];
const TOPIC_COLORS = () => [css("--c1"), css("--c2"), css("--c3"), css("--c4"), "#e87ba4", "#8a6fd6", "#008300", "#e34948", "#3aa9c9", "#8a94a6", "#b08a2e", "#5b6b8c"];
function renderTopics() {
  const v = state.tp.view, P = TP.meta.periods, col = TOPIC_COLORS();
  document.querySelectorAll("#topicSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  draw("c-topics", TP.meta.themes.map((t, i) => ({ x: P, y: TP.series[t.key][v], mode: "lines+markers", name: t.label, visible: TOPIC_DEFAULT.includes(t.key) ? true : "legendonly",
    line: { color: col[i], width: 2.4, dash: i < 8 ? "solid" : "dot" }, marker: { size: 6, line: { color: css("--surface"), width: 1.5 } }, hovertemplate: "%{y:.1%}" })),
    layout({ margin: { l: 8, r: 16, t: 12, b: 64 }, legend: { y: -0.22, x: 0 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));
  $("topicSub").textContent = v === "all"
    ? `Share of each period's reviews that mention each topic. ${fmt.int(TP.meta.reviews.at(-1))} reviews in the latest year. Click a legend entry to show or hide a topic.`
    : `Share of each period's unhappy (1–2★) reviews that mention each topic. ${fmt.int(TP.meta.unhappy.at(-1))} unhappy reviews in the latest year.`;

  const row = (x, dir) => `<tr class="click" data-lctype="${esc2(x.type)}"><td><b>${esc2(x.type)}</b></td><td>${esc2(x.label)}</td><td class="n">${fmt.pct(x.prior, 0)} → ${fmt.pct(x.recent, 0)}</td>
    <td class="n"><span class="chip ${dir === "up" ? "down" : "up"}">${dir === "up" ? "▲" : "▼"} ${Math.abs((x.recent - x.prior) * 100).toFixed(1)} pts</span></td><td class="n">${fmt.int(x.mentions)}</td></tr>`;
  const rises = TP.rises.map((x) => row(x, "up")), falls = TP.falls.map((x) => row(x, "down"));
  $("topicMoves").innerHTML = `<thead><tr><th>Product type</th><th>Topic</th><th class="n">12 months before → last 12 months</th><th class="n">Change</th><th class="n">Mentions</th></tr></thead><tbody>` +
    (rises.concat(falls).join("") || '<tr><td colspan="5" class="empty-note">No topic moved clearly enough to list.</td></tr>') + "</tbody>";
  $("topicMovesNote").textContent = `${TP.rises.length} rising and ${TP.falls.length} fading topics passed a strict filter (${TP.meta.rule}; ${TP.tested_moves} type-and-topic pairs were tested, so only large, clear shifts are shown). Red marks a rise in a topic, which for most topics means more complaints or more friction; click a row to see that type's products.`;
}

function initPerformance() {
  $("topicSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.tp.view = b.dataset.v; renderTopics(); } };
  $("topicMoves").onclick = (e) => { const tr = e.target.closest("[data-lctype]"); if (tr) openProductsForType(tr.dataset.lctype); };
}
