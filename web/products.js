// Product explorer: find any product with 30+ reviews and see how it grew, how its rating moved, and what customers
// talk about, over time. Data: products/index.json (list) + products/sNN.json (history, loaded on demand).

let PX = null;                         // index.json, loaded the first time the tab opens
const PXSHARD = {};                    // shard number -> promise of {asin: detail}
const STAGE_CLS = { Growing: "good", Declining: "bad", Steady: "info", New: "info", Faded: "", "Low activity": "" };
const STAGE_NOTE = {
  Growing: "Reviews in the last 12 months are well above the 12 before.",
  Declining: "Reviews in the last 12 months are well below the 12 before.",
  Steady: "Review activity is roughly stable.",
  New: "First reviewed within the last year of the data.",
  Faded: "No reviews in the last six months of the data.",
  "Low activity": "Fewer than 10 reviews in the last 12 months, too few to call a trend.",
};
Object.assign(state, { px: { q: "", type: "", stage: "", sort: "n", shown: 25, sel: null, themeView: "recent" } });
const SORTS = {
  n: ["Most reviews", (a, b) => b.n - a.n],
  c: ["Most reviews, last 12 months", (a, b) => b.c - a.c],
  gUp: ["Fastest growing", (a, b) => (b.g ?? -9) - (a.g ?? -9)],
  gDn: ["Fastest declining", (a, b) => (a.g ?? 9) - (b.g ?? 9)],
  rtHi: ["Highest rated", (a, b) => b.rt - a.rt],
  rtLo: ["Lowest rated", (a, b) => a.rt - b.rt],
  drDn: ["Biggest rating drop", (a, b) => (a.dr ?? 9) - (b.dr ?? 9)],
  new: ["Newest first review", (a, b) => b.f.localeCompare(a.f)],
};

async function loadPxIndex() {
  if (PX) return;
  PX = await fetch("products/index.json").then((r) => r.json());
  PX.byId = Object.fromEntries(PX.items.map((p) => [p.id, p]));
  PX.items.forEach((p) => { p.hay = (p.t + " " + p.b + " " + p.id).toLowerCase(); });
  $("pxType").innerHTML = '<option value="">All product types</option>' + PX.meta.types.map((t, i) => `<option value="${i}">${esc2(t)}</option>`).join("");
}
function loadShard(n) {
  if (!PXSHARD[n]) PXSHARD[n] = fetch(`products/s${String(n).padStart(2, "0")}.json`).then((r) => r.json()).then((a) => Object.fromEntries(a.map((d) => [d.a, d])));
  return PXSHARD[n];
}
const monthsFrom = (start, n) => { const [y, m] = start.split("-").map(Number); return Array.from({ length: n }, (_, i) => { const t = y * 12 + m - 1 + i; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; }); };
const rollSum = (a, w) => a.map((_, i) => sum(a.slice(Math.max(0, i - w + 1), i + 1)));
const stageBadge = (s) => `<span class="badge ${STAGE_CLS[s]}">${s}</span>`;

function filteredProducts() {
  const P = state.px, q = P.q.trim().toLowerCase();
  let list = PX.items.filter((p) => (!q || p.hay.includes(q)) && (P.type === "" || p.y === +P.type) && (!P.stage || p.st === P.stage));
  return list.sort(SORTS[P.sort][1]);
}

// ---------------------------------------------------------------- list + type overview
function renderProducts() {
  if (!PX) {
    $("pxList").innerHTML = '<tr><td class="empty-note">Loading products…</td></tr>';
    loadPxIndex().then(() => { renderProducts(); }).catch((e) => { $("pxList").innerHTML = `<tr><td>Could not load the product list: ${esc2(e)}</td></tr>`; });
    return;
  }
  const P = state.px, m = PX.meta;
  $("pxIntro").textContent = `${fmt.int(m.products_listed)} products with ${m.min_reviews}+ reviews, covering ${fmt.pct(m.reviews_covered_share, 0)} of all review volume across ${fmt.int(m.products_total)} products. Data to ${fmt.month(m.end)}. The rest have too few reviews for a trend; use the type overview for them.`;
  $("pxSort").innerHTML = Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${k === P.sort ? " selected" : ""}>${l}</option>`).join("");
  $("pxType").value = P.type; $("pxSearch").value = P.q;
  document.querySelectorAll("#pxStage button").forEach((b) => b.classList.toggle("on", (b.dataset.s || "") === P.stage));

  renderTypeOverview();
  const list = filteredProducts(), shown = list.slice(0, P.shown);
  $("pxCount").textContent = `${fmt.int(list.length)} product${list.length === 1 ? "" : "s"}`;
  const head = `<thead><tr><th>Product</th><th class="n">Reviews</th><th class="n">Last 12 mo</th><th class="n">Change</th><th class="n">Rating</th><th class="n">Stage</th><th class="n">Price</th></tr></thead>`;
  $("pxList").innerHTML = head + "<tbody>" + (shown.map((p) => {
    const dr = p.dr == null ? "" : p.dr <= -0.1 ? ' <span class="down-t">▼</span>' : p.dr >= 0.1 ? ' <span class="up-t">▲</span>' : "";
    return `<tr class="click${P.sel === p.id ? " sel-row" : ""}" data-pid="${p.id}"><td class="pt"><b title="${esc2(p.t)}">${esc2(p.t)}</b><span class="sub2">${esc2(p.b)} · ${esc2(PX.meta.types[p.y])}</span></td>
      <td class="n">${fmt.int(p.n)}</td><td class="n">${fmt.int(p.c)}</td><td class="n">${p.g == null ? "–" : deltaChip(p.g, pctTxt)}</td>
      <td class="n">${p.rt.toFixed(2)}${dr}</td><td class="n">${stageBadge(p.st)}</td><td class="n">${p.pe ? "~" : ""}$${p.pr.toFixed(2)}</td></tr>`;
  }).join("") || '<tr><td colspan="7" class="empty-note">No products match these filters.</td></tr>') + "</tbody>";
  $("pxMore").style.display = list.length > shown.length ? "" : "none";
  $("pxMore").textContent = `Show ${Math.min(25, list.length - shown.length)} more`;
  if (P.sel) renderProductDetail(P.sel); else $("pxDetail").hidden = true;
}

function renderTypeOverview() {
  const rows = F.segments.filter((s) => s.kind === "type" || s.kind === "family").map((s) => {
    const d = s.d, idx = PX.meta.types.indexOf(s.label === "General parts & accessories" ? "Parts & Accessories" : s.label);
    return { s, d, idx };
  }).sort((a, b) => b.d.last12 - a.d.last12);
  const share = (x) => x.d.last12 / SEG.total.d.last12;
  $("pxTypes").innerHTML = `<thead><tr><th>Type</th><th class="n">Sales proxy, last 12 mo</th><th class="n">Share</th><th class="n">Change vs prior 12</th><th class="n">Rating</th><th class="n">Products listed</th></tr></thead><tbody>` +
    rows.map(({ s, d, idx }) => {
      const prior = d.prior12, growth = prior ? d.last12 / prior - 1 : null, listed = idx >= 0 ? PX.items.filter((p) => p.y === idx).length : "–";
      return `<tr class="${idx >= 0 ? "click" : ""}" ${idx >= 0 ? `data-ptype="${idx}"` : ""}><td><b>${esc2(s.label)}</b><span class="sub2">${KIND[s.kind]}</span></td><td class="n">${fmt.usdC(d.last12)}</td><td class="n">${fmt.pct(share({ d }), 0)}</td>
        <td class="n">${growth == null ? "–" : deltaChip(growth, pctTxt)}</td><td class="n">${d.rNow != null ? d.rNow.toFixed(2) : "–"}</td><td class="n">${listed}</td></tr>`;
    }).join("") + "</tbody>";
}

// ---------------------------------------------------------------- one product
async function renderProductDetail(id) {
  const p = PX.byId[id]; if (!p) return;
  const box = $("pxDetail"); box.hidden = false;
  $("pxTitle").textContent = p.t;
  $("pxMeta").innerHTML = `${esc2(p.b)} · ${esc2(PX.meta.types[p.y])} · ${stageBadge(p.st)} ${p.pe ? '<span class="badge warn" title="Amazon did not list a price; estimated from similar products">price estimated</span>' : ""}
    <a class="linkbtn" href="https://www.amazon.com/dp/${esc2(p.id)}" target="_blank" rel="noopener">ASIN ${esc2(p.id)} ↗</a>`;
  const d = (await loadShard(p.sh))[id]; if (!d || state.px.sel !== id) return;
  const n = d.n, rs = d.rs, ng = d.ng, x = monthsFrom(d.s, n.length), total = sum(n);
  const cur = sum(n.slice(-12)), pri = sum(n.slice(-24, -12)), growth = pri >= 5 ? cur / pri - 1 : null;
  const peakI = rolling(n, 3).reduce((b, v, i, a) => (v > a[b] ? i : b), 0), peakRate = rolling(n, 3)[peakI];
  const nowRate = mean(n.slice(-3)), ofPeak = peakRate ? nowRate / peakRate : null;
  const rCur = cur >= 10 ? sum(rs.slice(-12)) / cur : null, rPri = pri >= 10 ? sum(rs.slice(-24, -12)) / pri : null;
  const negCur = cur >= 10 ? sum(ng.slice(-12)) / cur : null, negPri = pri >= 10 ? sum(ng.slice(-24, -12)) / pri : null;
  const age = n.length - 1;

  // benchmark against the product's type
  const tyName = PX.meta.types[p.y], tseg = F.segments.find((s) => s.kind === "type" && (s.label === tyName || (s.label === "General parts & accessories" && tyName === "Parts & Accessories")));
  const tg = tseg ? tseg.d.last12 / tseg.d.prior12 - 1 : null;

  $("pxTiles").innerHTML = [
    tile({ label: "Reviews, all time", value: fmt.int(total), sub: `first reviewed ${fmt.month(d.s)}${p.la ? " · launched " + fmt.month(p.la) : ""}` }),
    tile({ label: "Reviews, last 12 months", value: fmt.int(cur), delta: growth == null ? "" : deltaChip(growth, pctTxt), sub: tg == null || growth == null ? "vs the 12 before" : `type ${pctTxt(tg)}` }),
    tile({ label: "Average rating, last 12 months", value: rCur == null ? "–" : rCur.toFixed(2) + " ★", delta: rCur != null && rPri != null ? deltaChip(rCur - rPri, numTxt("", 2)) : "", sub: "vs the 12 before" }),
    tile({ label: "Unhappy reviews (1–2★)", value: negCur == null ? "–" : fmt.pct(negCur, 0), delta: negCur != null && negPri != null ? deltaChip((negCur - negPri) * 100, numTxt(" pts", 0), false) : "", sub: "last 12 months" }),
    tile({ label: "Where it is in its life", value: p.st, sub: ofPeak == null ? STAGE_NOTE[p.st] : `now ${fmt.pct(ofPeak, 0)} of its ${fmt.month(x[peakI])} peak` }),
  ].join("");

  // plain-language reading
  const notes = [];
  notes.push(`<b>${p.st}.</b> ${STAGE_NOTE[p.st]}${growth != null ? ` (${pctTxt(growth)}; its type moved ${tg == null ? "n/a" : pctTxt(tg)}).` : ""}`);
  if (age >= 6) notes.push(`<b>Peak.</b> Review activity peaked around ${fmt.month(x[peakI])} at about ${peakRate.toFixed(1)} reviews a month; it now runs at ${nowRate.toFixed(1)} (${ofPeak == null ? "n/a" : fmt.pct(ofPeak, 0)} of peak).`);
  if (rCur != null && rPri != null) notes.push(`<b>Rating.</b> ${rCur.toFixed(2)}★ over the last 12 months, ${Math.abs(rCur - rPri) < 0.05 ? "unchanged" : (rCur > rPri ? "up " : "down ") + Math.abs(rCur - rPri).toFixed(2)} on the year before.`);
  if (d.th) {
    const [nA, nN, nR, nP] = d.N, th = PX.meta.themes;
    if (nR >= 15 && nP >= 15) {
      const rise = d.th.map((t, i) => ({ i, a: t[2] / nR, b: t[3] / nP, c: t[2] })).filter((o) => o.c >= 4).sort((a, b) => (b.a - b.b) - (a.a - a.b));
      if (rise[0] && rise[0].a - rise[0].b >= 0.04) notes.push(`<b>Rising topic.</b> “${th[rise[0].i].label}” is mentioned in ${fmt.pct(rise[0].a, 0)} of recent reviews, up from ${fmt.pct(rise[0].b, 0)}.`);
      const fall = rise.at(-1); if (fall && fall.b - fall.a >= 0.04) notes.push(`<b>Fading topic.</b> “${th[fall.i].label}” fell from ${fmt.pct(fall.b, 0)} to ${fmt.pct(fall.a, 0)} of reviews.`);
    }
    if (nN >= 10) {
      const top = d.th.map((t, i) => ({ i, s: t[1] / nN, all: t[0] / nA })).filter((o) => o.s >= 0.1).sort((a, b) => (b.s / Math.max(b.all, 0.01)) - (a.s / Math.max(a.all, 0.01)))[0];
      if (top) notes.push(`<b>What unhappy customers raise.</b> “${th[top.i].label}” appears in ${fmt.pct(top.s, 0)} of 1–2★ reviews (${fmt.pct(top.all, 0)} of all reviews).`);
    }
  }
  $("pxNotes").innerHTML = notes.map((t) => `<li>${t}</li>`).join("");
  $("pxSimilar").innerHTML = similarProducts(p).map((q) => `<button type="button" class="simbtn" data-pid="${q.id}"><b title="${esc2(q.t)}">${esc2(q.t)}</b><span>${fmt.int(q.n)} reviews · ${q.rt.toFixed(2)}★ ${stageBadge(q.st)}</span></button>`).join("") || '<p class="empty-note">No other listed products of this type.</p>';

  // charts
  draw("c-px-vol", [
    { x, y: n, type: "bar", name: "Reviews per month", marker: { color: rgba(css("--c1"), 0.4), cornerradius: 2 }, hovertemplate: "%{y}" },
    { x, y: rolling(n, 12), type: "scatter", mode: "lines", name: "12-month average", line: line(css("--c1"), 2.6), hovertemplate: "%{y:.1f}" },
    dot(x[peakI], n[peakI], css("--c2")),
  ], layout({ bargap: 0.15, margin: { l: 8, r: 16, t: 28, b: 8 }, yaxis: { rangemode: "tozero" }, annotations: age >= 6 ? [{ x: x[peakI], y: Math.max(n[peakI], 1), text: `Peak ${fmt.month(x[peakI])}`, showarrow: false, yshift: 16, font: { size: 11.5, color: css("--ink") } }] : [] }));
  const rN = rollSum(n, 6), rR = rollSum(rs, 6), rG = rollSum(ng, 6);
  const rating = rN.map((v, i) => (v >= 5 ? rR[i] / v : null)), negS = rN.map((v, i) => (v >= 5 ? rG[i] / v : null));
  draw("c-px-rating", [{ x, y: rating, mode: "lines", name: "Rating", connectgaps: false, line: line(css("--c1"), 2.5), hovertemplate: "%{y:.2f} ★" }, dot(x.at(-1), rating.at(-1) ?? 0, css("--c1"))].slice(0, rating.at(-1) == null ? 1 : 2),
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, yaxis: { range: [Math.max(1, Math.floor((Math.min(...rating.filter((v) => v != null), 5) - 0.25) * 2) / 2), 5], tickformat: ".1f" } }));
  draw("c-px-neg", [{ x, y: negS, mode: "lines", name: "Unhappy share", line: line("#e34948", 2.5), hovertemplate: "%{y:.0%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, yaxis: { tickformat: ".0%", rangemode: "tozero" } }));
  const cum = n.reduce((a, v, i) => (a.push((a[i - 1] || 0) + v), a), []);
  draw("c-px-life", [{ x, y: cum.map((v) => v / total), mode: "lines", name: "Share of lifetime reviews", line: line(css("--c1"), 2.6), fill: "tozeroy", fillcolor: rgba(css("--c1"), 0.1), hovertemplate: "%{y:.0%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, yaxis: { tickformat: ".0%", range: [0, 1.02] } }));
  renderThemes(d);
}

function renderThemes(d) {
  const P = state.px, th = PX.meta.themes;
  document.querySelectorAll("#pxThemeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.themeView));
  if (!d.th) {
    Plotly.purge("c-px-themes"); $("c-px-themes").innerHTML = `<p class="empty-note" style="padding:24px">Theme analysis needs ${PX.meta.min_theme_reviews}+ reviews; this product has ${fmt.int(sum(d.n))}.</p>`;
    $("pxThemeSub").textContent = "Not enough reviews to say what customers talk about."; return;
  }
  if ($("c-px-themes").querySelector("p")) $("c-px-themes").innerHTML = "";
  const [nA, nN, nR, nP] = d.N, v = P.themeView, rate = (i, k, N) => (N ? d.th[i][k] / N : 0);
  const order = th.map((_, i) => i).sort((a, b) => (v === "neg" ? rate(b, 1, nN) - rate(a, 1, nN) : v === "all" ? rate(b, 0, nA) - rate(a, 0, nA) : rate(b, 2, nR) - rate(a, 2, nR)));
  const labels = order.map((i) => th[i].label).reverse();
  let traces;
  if (v === "recent") {
    const ok = nR >= 15 && nP >= 15;
    $("pxThemeSub").textContent = ok ? `Share of reviews mentioning each topic: last 12 months (${nR} reviews) vs the 12 before (${nP}).` : `Not enough reviews in both periods (${nR} recent, ${nP} earlier); showing all reviews instead.`;
    traces = ok ? [
      { y: labels, x: order.map((i) => rate(i, 3, nP)).reverse(), type: "bar", orientation: "h", name: "12 months before", marker: { color: rgba(css("--c1"), 0.35), cornerradius: 3 }, hovertemplate: "%{x:.0%}" },
      { y: labels, x: order.map((i) => rate(i, 2, nR)).reverse(), type: "bar", orientation: "h", name: "Last 12 months", marker: { color: css("--c1"), cornerradius: 3 }, hovertemplate: "%{x:.0%}" },
    ] : [{ y: labels, x: order.map((i) => rate(i, 0, nA)).reverse(), type: "bar", orientation: "h", name: "All reviews", marker: { color: css("--c1"), cornerradius: 3 }, hovertemplate: "%{x:.0%}" }];
  } else {
    const k = v === "neg" ? 1 : 0, N = v === "neg" ? nN : nA;
    $("pxThemeSub").textContent = v === "neg" ? `Share of the ${nN} unhappy (1–2★) reviews mentioning each topic.` : `Share of all ${nA} reviews mentioning each topic.`;
    traces = [{ y: labels, x: order.map((i) => rate(i, k, N)).reverse(), type: "bar", orientation: "h", name: v === "neg" ? "Unhappy reviews" : "All reviews", marker: { color: v === "neg" ? "#e34948" : css("--c1"), cornerradius: 3 }, hovertemplate: "%{x:.0%}" }];
  }
  draw("c-px-themes", traces, layout({ barmode: "group", bargap: 0.25, hovermode: "closest", showlegend: traces.length > 1, legend: { y: 1.1 }, margin: { l: 8, r: 16, t: 28, b: 8 },
    xaxis: { tickformat: ".0%", showgrid: true, showline: false }, yaxis: { showgrid: false, automargin: true } }));
}

function similarProducts(p) {
  return PX.items.filter((q) => q.y === p.y && q.id !== p.id).slice(0, 5);
}

function selectProduct(id, scroll = true) {
  state.px.sel = id; writeHash();
  renderProducts();
  if (scroll) setTimeout(() => $("pxDetail").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }), 60);
}

function initProducts() {
  const P = state.px, redo = () => { P.shown = 25; renderProducts(); };
  $("pxSearch").oninput = (e) => { P.q = e.target.value; redo(); };
  $("pxType").onchange = (e) => { P.type = e.target.value; redo(); };
  $("pxSort").onchange = (e) => { P.sort = e.target.value; redo(); };
  $("pxStage").onclick = (e) => { const b = e.target.closest("button"); if (b) { P.stage = b.dataset.s || ""; redo(); } };
  $("pxMore").onclick = () => { P.shown += 25; renderProducts(); };
  $("pxList").onclick = (e) => { const tr = e.target.closest("[data-pid]"); if (tr) selectProduct(tr.dataset.pid); };
  $("pxTypes").onclick = (e) => { const tr = e.target.closest("[data-ptype]"); if (tr) { P.type = tr.dataset.ptype; P.stage = ""; redo(); $("pxList").scrollIntoView({ behavior: "smooth", block: "start" }); } };
  $("pxClose").onclick = () => { P.sel = null; writeHash(); renderProducts(); };
  $("pxThemeSeg").onclick = async (e) => { const b = e.target.closest("button"); if (!b) return; P.themeView = b.dataset.v; const p = PX.byId[P.sel]; renderThemes((await loadShard(p.sh))[P.sel]); };
  $("pxSimilar").onclick = (e) => { const b = e.target.closest("[data-pid]"); if (b) selectProduct(b.dataset.pid); };
}
