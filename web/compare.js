// Products tab, "Compare" and "Brands & types" views. Built on the forecast data (F), so every brand, product type,
// price band and top product can be compared on exactly the same basis as the forecasts and decisions.

Object.assign(state, { cp: { ids: [null, null, null], mode: "actual" } });
const CP_COLORS = () => [css("--c1"), css("--c2"), css("--c4")];
const CP_GROUPS = [["brand", "Brands"], ["type", "Product types"], ["family", "Parts vs appliances"], ["band", "Price bands"], ["product", "Top products"]];

function cmpWriteHash(p) {
  const ids = state.cp.ids, def = defaultCompare();
  ids.forEach((id, i) => { if (id && id !== def[i]) p.set("c" + "abc"[i], id); });
  if (ids[2] === null && def[2] !== null) p.set("cc", "none");
}
function cmpReadHash(p) {
  const def = defaultCompare();
  state.cp.ids = [0, 1, 2].map((i) => { const v = p.get("c" + "abc"[i]); return v === "none" ? null : (v && SEG[v] ? v : def[i]); });
}
function defaultCompare() {
  const b = F.segments.filter((s) => s.kind === "brand").sort((x, y) => y.d.last12 - x.d.last12);
  return [b[0]?.id ?? null, b[1]?.id ?? null, null];
}

function initCompare() {
  const C = state.cp;
  if (!C.ids[0]) C.ids = defaultCompare();
  const opts = (sel) => `<option value="">${sel}</option>` + CP_GROUPS.map(([k, t]) => `<optgroup label="${t}">${F.segments.filter((s) => s.kind === k).map((s) => `<option value="${s.id}">${esc2(s.label)}</option>`).join("")}</optgroup>`).join("");
  ["cmpA", "cmpB", "cmpC"].forEach((id, i) => {
    $(id).innerHTML = opts(i === 2 ? "None" : "Choose…");
    $(id).onchange = (e) => { C.ids[i] = e.target.value || null; if (!C.ids[0] || !C.ids[1]) C.ids = C.ids.map((x, j) => x ?? defaultCompare()[j]); syncUI(); renderCompare(); };
  });
  $("cmpMode").onclick = (e) => { const b = e.target.closest("button"); if (b) { C.mode = b.dataset.v; renderCompare(); } };
  $("pxView").onclick = (e) => { const b = e.target.closest("button"); if (b) { state.px.view = b.dataset.v; syncUI(); renderProducts(); } };
}

// ---------------------------------------------------------------- compare
function weighted(v, w, win) {
  return v.map((_, i) => { let n = 0, d = 0; for (let k = Math.max(0, i - win + 1); k <= i; k++) if (v[k] != null) { n += v[k] * w[k]; d += w[k]; } return d >= 5 ? n / d : null; });
}

function renderCompare() {
  const C = state.cp, items = C.ids.filter(Boolean).map((id) => SEG[id]).filter(Boolean), col = CP_COLORS();
  ["cmpA", "cmpB", "cmpC"].forEach((id, i) => { $(id).value = C.ids[i] || ""; });
  document.querySelectorAll("#cmpMode button").forEach((b) => b.classList.toggle("on", b.dataset.v === C.mode));
  if (items.length < 2) { $("cmpTable").innerHTML = '<tbody><tr><td class="empty-note">Choose at least two to compare.</td></tr></tbody>'; return; }

  // side-by-side summary
  const unhappy = (s, off = 0) => { const o = lastN(s.hist.orders, 12, off), g = lastN(s.hist.neg, 12, off); let n = 0, d = 0; o.forEach((w, i) => { if (g[i] != null) { n += g[i] * w; d += w; } }); return d ? n / d : null; };
  const rows_ = [
    ["Type", (s) => KIND[s.kind]],
    ["Sales proxy, last 12 months", (s) => fmtPm(s, s.d.last12)],
    ["Change vs the 12 before", (s) => (s.d.prior12 ? deltaChip(s.d.last12 / s.d.prior12 - 1, pctTxt) : "–")],
    ["Reviews, last 12 months", (s) => fmt.int(sum(lastN(s.hist.orders, 12)))],
    ["Average rating", (s) => (s.d.rNow != null ? s.d.rNow.toFixed(2) + " ★" : "–")],
    ["Rating vs the 12 before", (s) => (s.d.dR != null ? deltaChip(s.d.dR, numTxt("", 2)) : "–")],
    ["Unhappy reviews (1–2★)", (s) => { const u = unhappy(s), p = unhappy(s, 12); return u == null ? "–" : fmt.pct(u, 0) + (p != null ? " " + deltaChip((u - p) * 100, numTxt(" pts", 0), false) : ""); }],
    ["Outlook, next 12 months", (s) => `${deltaChip(s.d.growth, pctTxt)} <span class="sub2">${(s.d.pGrowth * 100).toFixed(0)}% chance of growth</span>`],
    ["Suggested action", (s) => { const a = decide(s); return `<span class="badge ${ACTION_CLS[a.key]}">${a.label}</span>${a.tentative ? ' <span class="sub2">tentative</span>' : ""}`; }],
    ["Forecast confidence", (s) => s.d.grade],
  ];
  $("cmpTable").innerHTML = `<thead><tr><th></th>${items.map((s, i) => `<th class="n"><span class="dotk" style="background:${col[i]}"></span>${esc2(s.label)}</th>`).join("")}</tr></thead><tbody>` +
    rows_.map(([label, fn]) => `<tr><td class="rowlab">${label}</td>${items.map((s) => `<td class="n">${fn(s)}</td>`).join("")}</tr>`).join("") + "</tbody>";

  // charts
  const x = FMONTHS;
  const i19 = x.indexOf("2019-01"), indexed = C.mode === "indexed";
  $("cmpSalesTitle").textContent = indexed ? "Sales proxy, 12-month average (2019 average = 100)" : "Sales proxy, 12-month average";
  draw("c-cmp-sales", items.map((s, i) => {
    const pm = s.d.pm, y = rolling(s.hist[pm], 12), base = mean(s.hist[pm].slice(i19, i19 + 12));
    return { x, y: indexed ? (base > 0 ? y.map((v) => (v / base) * 100) : y.map(() => null)) : y, mode: "lines", name: s.label, line: line(col[i], 2.6), hovertemplate: indexed ? "%{y:.0f}" : (pm === "sales" ? "%{y:$,.0f}" : "%{y:,.0f}") };
  }), layout({ margin: { l: 8, r: 16, t: 30, b: 8 }, legend: { y: 1.18 }, xaxis: { range: ["2016-01", x.at(-1)] }, yaxis: { tickprefix: indexed ? "" : "$", tickformat: indexed ? ".0f" : ".2~s", rangemode: "tozero" } }));
  draw("c-cmp-rating", items.map((s, i) => ({ x, y: weighted(s.hist.rating, s.hist.orders, 6), mode: "lines", name: s.label, connectgaps: false, line: line(col[i], 2.6), hovertemplate: "%{y:.2f} ★" })),
    layout({ margin: { l: 8, r: 16, t: 12, b: 8 }, showlegend: false, xaxis: { range: ["2016-01", x.at(-1)] }, yaxis: { tickformat: ".1f" } }));
  draw("c-cmp-neg", items.map((s, i) => ({ x, y: weighted(s.hist.neg, s.hist.orders, 6), mode: "lines", name: s.label, connectgaps: false, line: line(col[i], 2.6), hovertemplate: "%{y:.0%}" })),
    layout({ margin: { l: 8, r: 16, t: 12, b: 8 }, showlegend: false, xaxis: { range: ["2016-01", x.at(-1)] }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));
}

// ---------------------------------------------------------------- brands: share of voice and volume vs satisfaction
function renderBrands() {
  const brands = F.segments.filter((s) => s.kind === "brand").sort((a, b) => sum(lastN(b.hist.orders, 12)) - sum(lastN(a.hist.orders, 12)));
  const top = brands.slice(0, 8), tot = SEG.total.hist.orders, x = FMONTHS;
  const yrs = [...new Set(x.map(yearOf))].filter((y) => x.filter((m) => yearOf(m) === y).length === 12);
  const labels = [...yrs.map(String), "Year to Mar 2023"];
  const share = (s) => [...yrs.map((y) => { const idx = x.map((m, i) => (yearOf(m) === y ? i : -1)).filter((i) => i >= 0); return sum(idx.map((i) => s.hist.orders[i])) / sum(idx.map((i) => tot[i])); }), sum(lastN(s.hist.orders, 12)) / sum(lastN(tot, 12))];
  const pal = [css("--c1"), css("--c2"), css("--c3"), css("--c4"), "#e87ba4", "#8a6fd6", "#008300", "#e34948"];
  draw("c-sov", top.map((s, i) => ({ x: labels, y: share(s), mode: "lines+markers", name: s.label, line: { color: pal[i], width: 2.4, dash: i < 5 ? "solid" : "dot" }, marker: { size: 6, line: { color: css("--surface"), width: 1.5 } }, hovertemplate: "%{y:.1%}" })),
    layout({ margin: { l: 8, r: 16, t: 12, b: 56 }, legend: { y: -0.2, x: 0 }, xaxis: { type: "category", tickangle: 0 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));
  const topShare = sum(brands.map((s) => sum(lastN(s.hist.orders, 12)))) / sum(lastN(tot, 12));
  $("sovNote").textContent = `The 12 biggest brands together drew ${fmt.pct(topShare, 0)} of reviews in the latest year; the rest is spread across thousands of smaller sellers, so no single brand dominates. Click a bubble below to compare that brand.`;

  const maxS = Math.max(...brands.map((s) => s.d.last12));
  draw("c-bubble", [{ x: brands.map((s) => sum(lastN(s.hist.orders, 12))), y: brands.map((s) => s.d.rNow), text: brands.map((s) => s.label), customdata: brands.map((s) => s.id), mode: "markers+text", textposition: "top center", textfont: { color: css("--ink2"), size: 11 },
    marker: { size: brands.map((s) => 12 + (s.d.last12 / maxS) * 34), color: rgba(css("--c1"), 0.7), line: { color: css("--surface"), width: 2 } }, hovertemplate: "%{text}<br>%{x:,} reviews · %{y:.2f} ★<extra></extra>" }],
    layout({ hovermode: "closest", showlegend: false, margin: { l: 8, r: 16, t: 16, b: 8 }, xaxis: { type: "log", title: { text: "Reviews, last 12 months (log scale)", font: { color: css("--muted"), size: 12 } }, showgrid: true, showline: true }, yaxis: { title: { text: "Average rating", font: { color: css("--muted"), size: 12 } }, tickformat: ".1f" } }));
  onceOn("c-bubble", "plotly_click", (d) => {
    const id = d.points[0].customdata, C = state.cp;
    if (!C.ids.includes(id)) C.ids[1] = id === C.ids[0] ? C.ids[1] : id;
    state.px.view = "compare"; syncUI(); renderProducts(); toast("Added to Compare");
  });
}
