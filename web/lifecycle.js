// "Product lifecycle" tab: old vs new products on the same basis as the category model (reviews to Mar 2023).
// Everything is aligned by product AGE, never calendar date. Reads cohorts.json (scripts/build_cohorts.py).

let LC = null;
Object.assign(state, { lc: { share: "orders", curve: "mean", group: "type" } });
function prepLifecycle(d) { LC = d; }
const pctOf = (v, d = 0) => (v == null ? "–" : (v * 100).toFixed(d) + "%");
const BUCKET = { new: "Launched within 12 months", mid: "1 to 3 years since launch", old: "3+ years since launch" };
const cohortLabel = (c) => String(c.year) + (c.partial ? " (Q1)" : "");

function renderLifecycle() {
  const C = LC.cohorts, Y = LC.by_year, latest = Y.at(-1), prevFull = Y.filter((y) => !y.partial && !y.latest);
  const full = C.filter((c) => !c.partial), rep = LC.meta.report;
  const hit = (c, t) => c.first12?.hit?.[String(t)];
  const c15 = C.find((c) => c.year === 2015), c20 = C.find((c) => c.year === 2020), c22 = C.find((c) => c.year === 2022), c12 = C.find((c) => c.year === 2012);
  const y16 = Y.find((y) => y.year === 2016), y19 = Y.find((y) => y.year === 2019);
  const peakOf = (y) => C.find((c) => c.year === y)?.peak?.median;
  const earlyPeak = mean([2012, 2013, 2014].map(peakOf).filter((v) => v != null)), recentPeak = mean([2018, 2019, 2020].map(peakOf).filter((v) => v != null));

  // ---- verdict and tiles
  const nowNew = latest.b.new.orders, nowNewS = latest.b.new.sales, nowOld = latest.b.old.orders;
  const f = (x) => pctOf(x, 0);
  $("lcVerdict").innerHTML = `
    <h2>New products supply about ${f(nowNew)} of the reviews, and older products still carry ${f(nowOld)}</h2>
    <ul class="notes-list lead-list">
      <li><b>Where attention goes.</b> In the 12 months to ${fmt.month(LC.meta.end)}, products launched within the year drew ${f(nowNew)} of reviews (${f(nowNewS)} of the sales proxy, since newer products sell at higher prices on average), versus ${f(y16.b.new.orders)} in 2016. Products over three years old fell from ${f(Y[0].b.old.orders)} of reviews in 2013 to ${f(nowOld)}.</li>
      <li><b>Launches are catching on more often, but big winners are rare.</b> ${f(hit(c20, 10))} of 2020 launches reached 10+ reviews in their first year (${f(hit(c15, 10))} in 2015), yet only about ${pctOf(hit(c20, 50), 0)} reach 50+ and that has not moved since 2016: a few products take most of the attention.</li>
      <li><b>Products peak sooner.</b> Those that build an audience peaked about ${recentPeak.toFixed(0)} months after launch for 2018 to 2020 launches, against about ${earlyPeak.toFixed(0)} for 2012 to 2014.</li>
      <li><b>Quality of launches.</b> First-year ratings peaked at ${full.reduce((b, c) => (c.first12_quality && c.first12_quality.rating > b ? c.first12_quality.rating : b), 0).toFixed(2)}★ and are ${(C.find((c) => c.year === 2021).first12_quality.rating).toFixed(2)}★ for 2021 launches.</li>
    </ul>`;
  $("lcTiles").innerHTML = [
    tile({ label: "Reviews from products launched in the last 12 months", value: f(nowNew), sub: `2016: ${f(y16.b.new.orders)} · 2019: ${f(y19.b.new.orders)}` }),
    tile({ label: "Reviews from products over 3 years old", value: f(nowOld), sub: `2013: ${f(Y[0].b.old.orders)}` }),
    tile({ label: "Launches reaching 10+ reviews in year one", value: pctOf(hit(c22, 10), 0), delta: deltaChip((hit(c22, 10) - hit(c20, 10)) * 100, numTxt(" pts", 0)), sub: `2022 launches (to Mar) vs 2020: ${f(hit(c20, 10))}` }),
    tile({ label: "Typical months to peak", value: `${recentPeak.toFixed(0)}`, sub: `2018 to 2020 launches · 2012 to 2014: ${earlyPeak.toFixed(0)}` }),
  ].join("");

  // ---- where the reviews come from, by year
  const key = state.lc.share === "sales" ? "sales" : "orders";
  const xs = Y.map((y) => y.label), col = { new: css("--c1"), mid: seqBlue(1, 5), old: rgba(css("--muted"), 0.55) };
  draw("c-lc-share", ["new", "mid", "old"].map((b) => ({ x: xs, y: Y.map((y) => y.b[b]?.[key] ?? 0), type: "bar", name: BUCKET[b], marker: { color: col[b] },
    text: b === "new" ? Y.map((y) => pctOf(y.b.new[key], 0)) : undefined, textposition: "inside", textfont: { color: "#fff", size: 11.5 }, hovertemplate: "%{y:.0%}" })),
    layout({ barmode: "stack", bargap: 0.25, margin: { l: 8, r: 8, t: 36, b: 8 }, legend: { y: 1.18 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickformat: ".0%", range: [0, 1] }, hovermode: "x unified" }));
  document.querySelectorAll("#lcShareSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.lc.share));

  // ---- cohort curves aligned by age
  const curveYears = C.filter((c) => c.year >= 2015 && c.year <= 2022), ck = state.lc.curve;
  draw("c-lc-curve", curveYears.map((c, i) => {
    const y = c.curve[ck], months = y.map((_, k) => k + 1);
    return { x: months, y, mode: "lines", name: cohortLabel(c), line: line(seqBlue(i, curveYears.length), c.year === 2022 ? 3 : 2), connectgaps: false, hovertemplate: "%{y:.1f} reviews" };
  }), layout({ margin: { l: 8, r: 16, t: 36, b: 28 }, legend: { y: 1.18 }, xaxis: { title: { text: "Months since launch", font: { size: 12, color: css("--muted") } }, range: [1, 36] }, yaxis: { rangemode: "tozero", tickformat: ".0f" } }));
  $("lcCurveNote").textContent = ck === "mean"
    ? "Average reviews per launched product. A few hit products pull the average well above what a typical product gets."
    : "The middle product, using only products observed for 3+ years, so launches since 2021 are not shown. The typical product earns very few reviews.";
  document.querySelectorAll("#lcCurveSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === state.lc.curve));

  // ---- hit rate by cohort
  const hc = C.filter((c) => c.first12);
  draw("c-lc-hit", [10, 50].map((t, i) => ({ x: hc.map((c) => String(c.year)), y: hc.map((c) => hit(c, t)), mode: "lines+markers", name: `${t}+ reviews in year one`, line: line(i ? css("--c2") : css("--c1"), 2.5),
    marker: { size: 7, line: { color: css("--surface"), width: 2 } }, customdata: hc.map((c) => c.first12.n), hovertemplate: "%{y:.1%} of %{customdata:,} launches" })),
    layout({ margin: { l: 8, r: 16, t: 36, b: 8 }, legend: { y: 1.18 }, xaxis: { type: "category" }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));

  // ---- survival of established products
  const sc = C.filter((c) => Object.keys(c.survival || {}).length), scol = { 24: css("--c1"), 36: css("--c2"), 48: "#8a6fd6" };
  draw("c-lc-surv", ["24", "36", "48"].map((a) => {
    const pts = sc.filter((c) => c.survival[a]);
    return { x: pts.map((c) => String(c.year)), y: pts.map((c) => c.survival[a].active), mode: "lines+markers", name: `${a / 12} years after launch`, line: line(scol[a], 2.5), marker: { size: 7, line: { color: css("--surface"), width: 2 } },
      customdata: pts.map((c) => c.survival[a].n), hovertemplate: "%{y:.0%} of %{customdata} established products" };
  }), layout({ margin: { l: 8, r: 16, t: 36, b: 8 }, legend: { y: 1.18 }, xaxis: { type: "category" }, yaxis: { tickformat: ".0%", range: [0, 1] } }));

  // ---- time to peak
  const pc = C.filter((c) => c.peak);
  draw("c-lc-peak", [{ x: pc.map((c) => String(c.year)), y: pc.map((c) => c.peak.median), mode: "markers", name: "Median", marker: { size: 11, color: css("--c1"), line: { color: css("--surface"), width: 2 } },
    error_y: { type: "data", symmetric: false, array: pc.map((c) => c.peak.q3 - c.peak.median), arrayminus: pc.map((c) => c.peak.median - c.peak.q1), color: css("--axis"), thickness: 2, width: 5 },
    customdata: pc.map((c) => [c.peak.n, c.peak.still_climbing]), hovertemplate: "median %{y:.0f} months (middle half shown by the bar)<br>%{customdata[0]} products; %{customdata[1]:.0%} still climbing at 3 years<extra></extra>" }],
    layout({ showlegend: false, hovermode: "closest", margin: { l: 8, r: 16, t: 12, b: 8 }, xaxis: { type: "category" }, yaxis: { title: { text: "Months from launch to peak", font: { size: 12, color: css("--muted") } }, rangemode: "tozero" } }));

  // ---- quality of launches
  const qc = C.filter((c) => c.first12_quality);
  draw("c-lc-rating", [{ x: qc.map(cohortLabel), y: qc.map((c) => c.first12_quality.rating), mode: "lines+markers", line: line(css("--c1"), 2.5), marker: { size: 7, line: { color: css("--surface"), width: 2 } }, hovertemplate: "%{y:.2f} ★" }],
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickformat: ".1f", range: [3.8, 4.5] } }));
  draw("c-lc-neg", [{ x: qc.map(cohortLabel), y: qc.map((c) => c.first12_quality.neg), mode: "lines+markers", line: line("#e34948", 2.5), marker: { size: 7, line: { color: css("--surface"), width: 2 } }, hovertemplate: "%{y:.1%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));

  renderLifecycleTable();
}

function renderLifecycleTable() {
  const g = state.lc.group, rows = g === "type" ? LC.types : LC.brands;
  document.querySelectorAll("#lcGroupSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === g));
  $("lcTable").innerHTML = `<thead><tr><th>${g === "type" ? "Product type" : "Brand"}</th><th class="n">Reviews, last 12 mo</th><th class="n">From products under 2 years old</th><th class="n">Launches reaching 50+ reviews in year one</th><th class="n">Rating: newer vs older</th></tr></thead><tbody>` +
    rows.map((r) => {
      const idx = g === "type" && PX ? PX.meta.types.indexOf(r.key) : -1;
      const d = r.rating_new != null && r.rating_old != null ? r.rating_new - r.rating_old : null;
      return `<tr ${g === "type" ? `class="click" data-lctype="${esc2(r.key)}"` : ""}><td><b>${esc2(r.key)}</b><span class="sub2">${r.launches ? fmt.int(r.launches) + " launches in 2019-22" : "too few launches to rate"}</span></td>
        <td class="n">${fmt.int(r.reviews)}</td><td class="n">${pctOf(r.new24_share, 0)}</td><td class="n">${r.hit50 == null ? "–" : pctOf(r.hit50, 0)}</td>
        <td class="n">${r.rating_new != null ? r.rating_new.toFixed(2) : "–"} vs ${r.rating_old != null ? r.rating_old.toFixed(2) : "–"} ${d == null ? "" : d >= 0.05 ? '<span class="up-t">▲</span>' : d <= -0.05 ? '<span class="down-t">▼</span>' : ""}</td></tr>`;
    }).join("") + "</tbody>";
}

function initLifecycle() {
  $("lcShareSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.lc.share = b.dataset.v; renderLifecycle(); } };
  $("lcCurveSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.lc.curve = b.dataset.v; renderLifecycle(); } };
  $("lcGroupSeg").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.lc.group = b.dataset.v; renderLifecycleTable(); } };
  $("lcTable").onclick = (e) => { const tr = e.target.closest("[data-lctype]"); if (tr) openProductsForType(tr.dataset.lctype); };
}
