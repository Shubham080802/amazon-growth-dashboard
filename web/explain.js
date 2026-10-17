// "Ask the dashboard" and "What am I looking at?". No language model: every answer is a template filled with numbers read
// straight from the same data the charts use, with a link to where it comes from. Typing only searches the question list
// and the segment names; anything else gets an honest "I can't answer that here" plus the questions that are available.

Object.assign(state, { ask: { q: null } });
const SRC = (label, attrs) => `<button type="button" class="linkbtn" ${attrs}>${label} →</button>`;
const nameSeg = (s) => `<b>${esc2(s.label)}</b> <span class="sub2i">${KIND[s.kind]}</span>`;
const incr = (s) => s.d.fc12 - s.d.last12;
const top5 = (arr, fn, n = 5) => arr.slice(0, n).map(fn).join("");
const actionWhy = (s, a) => {
  const d = s.d, R = state.brief.rules, pg = Math.round(d.pGrowth * 100);
  if (a.key === "risk") return `only a ${pg}% chance of growth (a risk is flagged at ${Math.round((1 - R.risk) * 100)}% or less)`;
  if (a.key === "fix") return `growth looks likely (${pg}% chance) but the rating is ${d.rNow != null ? d.rNow.toFixed(2) : "n/a"}${d.dR != null ? ` (${sgn(d.dR, (v) => v.toFixed(2))} on last year)` : ""}, below the ${R.floor.toFixed(1)}★ floor or falling by 0.10 or more`;
  if (a.key === "invest") return `a ${pg}% chance of growth (needs ${Math.round(R.invest * 100)}%) and healthy ratings`;
  return `no clear signal: ${pg}% chance of growth, between the risk and invest thresholds`;
};
const tentative = (s) => (s.d.grade === "Low" ? ' <i class="sub2i">(low model confidence)</i>' : "");

// ---------------------------------------------------------------- the questions
const QUESTIONS = [
  { id: "outlook", q: "What is the outlook for the next 12 months?", kw: ["outlook", "forecast", "next", "year", "grow", "growth", "expect", "sales"], a() {
    const t = SEG.total, d = t.d, se = t.series.sales, asof = fmt.month(F.meta.last_month);
    return { head: `From ${asof}, the model expected ${fmt.usdC(d.fc12)} of sales over the following 12 months, ${pctTxt(d.growth)} vs the ${fmt.usdC(d.last12)} in the 12 before.`,
      bullets: [`Likely range: ${fmt.usdC(d.lo12)} to ${fmt.usdC(d.hi12)} (80% range).`, `${Math.round(d.pGrowth * 100)}% chance of beating the previous 12 months.`, `Confidence: ${d.grade}; typical monthly forecast miss ±${(d.wmape * 100).toFixed(0)}%.`],
      src: SRC("Open the Forecast lab", 'data-open="total"'), caveat: `These are forecasts from the last data point (${asof}), not from today.` }; } },
  { id: "risk", q: "Which segments are at risk?", kw: ["risk", "decline", "shrink", "falling", "worst", "danger", "problem"], a() {
    const r = F.segments.filter((s) => s.kind !== "total" && s.kind !== "family").map((s) => ({ s, a: decide(s) })).filter((x) => x.a.key === "risk").sort((x, y) => incr(x.s) - incr(y.s));
    return { head: r.length ? `${r.length} segments are flagged as at risk under the current rules.` : "No segment is flagged as at risk under the current rules.",
      bullets: r.slice(0, 5).map(({ s }) => `${nameSeg(s)}: expected ${pctTxt(s.d.growth)} (${sgn(incr(s), (v) => fmtPm(s, v))}); ${Math.round(s.d.pGrowth * 100)}% chance of growth${tentative(s)}`),
      src: SRC("See the scorecard", 'data-go-tab="brief"'), caveat: `Risk means a ${Math.round(state.brief.rules.risk * 100)}% or higher chance of decline. You can change the threshold under "Decision rules" in the scorecard.` }; } },
  { id: "invest", q: "Where should we invest?", kw: ["invest", "opportunity", "best", "grow", "winners", "double", "focus"], a() {
    const r = F.segments.filter((s) => s.kind !== "total" && s.kind !== "family").map((s) => ({ s, a: decide(s) })).filter((x) => x.a.key === "invest").sort((x, y) => incr(y.s) - incr(x.s));
    return { head: r.length ? `${r.length} segments clear the growth and rating bar.` : "No segment clears the growth and rating bar under the current rules.",
      bullets: r.slice(0, 5).map(({ s }) => `${nameSeg(s)}: expected ${pctTxt(s.d.growth)} (${sgn(incr(s), (v) => fmtPm(s, v))}); ${Math.round(s.d.pGrowth * 100)}% chance of growth; rating ${s.d.rNow != null ? s.d.rNow.toFixed(2) : "n/a"}${tentative(s)}`),
      src: SRC("See the scorecard", 'data-go-tab="brief"'), caveat: "Treat segments marked low confidence as a watch-list, not a budget line." }; } },
  { id: "quality", q: "Which segments have a quality problem?", kw: ["quality", "rating", "unhappy", "complaint", "satisfaction", "fix", "problem", "problems"], a() {
    const r = F.segments.filter((s) => s.kind !== "total" && s.kind !== "family").map((s) => ({ s, a: decide(s) })).filter((x) => x.a.key === "fix").sort((x, y) => y.s.d.last12 - x.s.d.last12);
    return { head: r.length ? `${r.length} growing segments have a low or falling rating.` : "No growing segment has a low or falling rating under the current rules.",
      bullets: r.slice(0, 5).map(({ s }) => `${nameSeg(s)}: sales ${pctTxt(s.d.growth)} expected, but rating ${s.d.rNow != null ? s.d.rNow.toFixed(2) : "n/a"}${s.d.dR != null ? ` (${sgn(s.d.dR, (v) => v.toFixed(2))} vs last year)` : ""}${tentative(s)}`),
      src: SRC("See the scorecard", 'data-go-tab="brief"'), caveat: `A quality flag means a rating below ${state.brief.rules.floor.toFixed(1)}★ or a drop of 0.10 or more.` }; } },
  { id: "ontrack", q: "Is this month on track?", kw: ["track", "month", "latest", "actual", "expected", "pulse", "now"], a() {
    const mon = (m) => SEG.total.series[m].monitor.at(-1), s = mon("sales"), o = mon("orders"), st = status(s, "sales"), so = status(o, "orders");
    const outside = F.segments.filter((x) => ["brand", "band", "type"].includes(x.kind)).filter((x) => { const mm = (x.series.sales || x.series.orders).monitor.at(-1); return mm.actual > mm.hi || mm.actual < mm.lo; }).length;
    return { head: `${fmt.month(s.month)}: sales were ${fmt.usdC(s.actual)}, ${st.above ? "above" : st.below ? "below" : "within"} the range the model expected (${fmt.usdC(s.lo)} to ${fmt.usdC(s.hi)}).`,
      bullets: [`Reviews: ${fmt.int(o.actual)} vs ${fmt.int(o.expected)} expected (${so.text.toLowerCase()}).`, `${outside} brands, price bands and product types were outside their own expected range that month.`],
      src: SRC("Open the monthly check", 'data-go-tab="brief"'), caveat: "About one month in five falls outside an 80% range by chance. Several segments moving together usually means a market-wide move." }; } },
  { id: "changed", q: "What changed since the last build?", kw: ["changed", "change", "update", "new", "since", "difference", "revision"], a() {
    if (!PREV) return { head: "The previous build is still loading, or none is available yet.", bullets: [], src: "", caveat: "" };
    const prev = Object.fromEntries(PREV.segments.map((s) => [s.id, s])), tn = SEG.total.d, tp = prev.total.d;
    const mv = F.segments.filter((s) => prev[s.id] && !["total", "family"].includes(s.kind)).map((s) => ({ s, a: decide(s), b: decide(prev[s.id]) })).filter((x) => x.a.key !== x.b.key).sort((x, y) => y.s.d.last12 - x.s.d.last12);
    return { head: `Expected 12-month growth for the whole category moved from ${pctTxt(tp.growth)} to ${pctTxt(tn.growth)}; ${mv.length} segments changed their suggested action.`,
      bullets: mv.slice(0, 5).map((x) => `${nameSeg(x.s)}: ${x.b.label} → ${x.a.label} (expected growth ${pctTxt(prev[x.s.id].d.growth)} → ${pctTxt(x.s.d.growth)})`),
      src: SRC("See the full list", 'data-go-tab="brief"'), caveat: "Changes can come from new data or from method changes such as completed prices; see About the data." }; } },
  { id: "reliable", q: "How reliable is the forecast?", kw: ["reliable", "accurate", "accuracy", "trust", "confidence", "error", "miss", "wrong", "forecast", "model", "sure"], a() {
    const se = SEG.total.series.sales, am = MK.amazon.forecast;
    return { head: `For the category, the model has typically missed by about ${(se.wmape * 100).toFixed(0)}% a month in backtests (${SEG.total.d.grade} confidence).`,
      bullets: [`Its 80% ranges contained the real outcome ${Math.round(se.coverage80 * 10)} times in 10 in backtests (the aim is 8).`, Math.abs(se.bias) < 0.03 ? "No consistent tendency to over- or under-shoot." : `Past forecasts ran ${(Math.abs(se.bias) * 100).toFixed(0)}% ${se.bias > 0 ? "high" : "low"} on average.`, `Amazon's own quarterly revenue is forecast far more accurately (typical miss ${(am.wmape * 100).toFixed(1)}%).`],
      src: SRC("Open the reliability card", 'data-open="total"'), caveat: "Smaller segments and individual products are less predictable; each shows its own confidence grade." }; } },
  { id: "topics", q: "Which customer topics are getting worse?", kw: ["topic", "topics", "complain", "complaints", "leak", "durability", "service", "customers", "talk"], a() {
    const r = TP.rises.slice(0, 5);
    return { head: r.length ? `${TP.rises.length} topic shifts within product types passed a strict filter in the last 12 months.` : "No topic shifted clearly enough to list.",
      bullets: r.map((x) => `<b>${esc2(x.type)}</b>: “${esc2(x.label)}” mentioned in ${fmt.pct(x.recent, 0)} of reviews, up from ${fmt.pct(x.prior, 0)}`),
      src: SRC("Open Performance → topics", 'data-go-tab="performance"'), caveat: "Topics are counted with a fixed keyword list; a rise in a topic usually, but not always, means more complaints." }; } },
  { id: "newold", q: "Is growth coming from new or older products?", kw: ["new", "old", "older", "launch", "launches", "products", "cohort", "lifecycle"], a() {
    const Y = LC.by_year, l = Y.at(-1).b, y16 = Y.find((y) => y.year === 2016).b;
    return { head: `In the year to ${fmt.month(LC.meta.end)}, products launched within the year drew ${fmt.pct(l.new.orders, 0)} of reviews; products over three years old drew ${fmt.pct(l.old.orders, 0)}.`,
      bullets: [`In 2016 the split was ${fmt.pct(y16.new.orders, 0)} new and ${fmt.pct(y16.old.orders, 0)} older.`, `New products are ${fmt.pct(l.new.sales, 0)} of the sales proxy because they sell at higher prices on average.`],
      src: SRC("Open Lifecycle", 'data-go-tab="lifecycle"'), caveat: "Compared by product age on the same March 2023 basis." }; } },
  { id: "price", q: "What happens if we raise prices 5%?", kw: ["price", "prices", "pricing", "raise", "increase", "elasticity", "scenario", "hike", "cut", "lower", "discount", "drop"], a() {
    const e = -1.5, p = 0.05, o = Math.pow(1 + p, e), s = Math.pow(1 + p, 1 + e), d = SEG.total.d;
    return { head: `With a price elasticity of −1.5 (an assumption, not measured from this data), a 5% price rise would cut orders by about ${(Math.abs(o - 1) * 100).toFixed(1)}% and move sales by about ${sgn(s - 1, (v) => (v * 100).toFixed(1) + "%")}.`,
      bullets: [`Applied to the expected ${fmt.usdC(d.fc12)} over the next 12 months, that is about ${fmt.usdC(d.fc12 * s)}.`, "Change the elasticity, price and demand shift yourself in the scenario levers."],
      src: SRC("Try it in the Forecast lab", 'data-ask-preset="price5"'), caveat: "Elasticity is the key unknown. Nothing in the review data can estimate it, so treat this as an illustration." }; } },
  { id: "drivers", q: "What is driving the change in sales?", kw: ["drive", "driving", "driver", "drivers", "volume", "mix", "orders", "why", "sales", "growth"], a() {
    const t = SEG.total, h = 12, Ol = sum(lastN(t.hist.orders, h)), Sl = sum(lastN(t.hist.sales, h)), Of = sum(t.series.orders.fc.mean.slice(0, h)), Sf = sum(t.series.sales.fc.mean.slice(0, h));
    const vol = (Of - Ol) * (Sl / Ol), price = Sf - Sl - vol;
    return { head: `Of the expected ${sgn(Sf - Sl, fmt.usdC)} change in sales, ${sgn(vol, fmt.usdC)} comes from the number of orders and ${sgn(price, fmt.usdC)} from price and product mix.`,
      bullets: [`Orders: ${fmt.intC(Ol)} → ${fmt.intC(Of)} expected.`, `Average value per order: ${fmt.usd(Sl / Ol)} → ${fmt.usd(Sf / Of)}.`],
      src: SRC("Open the driver chart", 'data-open="total"'), caveat: "Order counts are review counts, a proxy for orders." }; } },
  { id: "amazon", q: "How is Amazon doing right now?", kw: ["amazon", "company", "aws", "revenue", "profit", "guidance", "quarter", "earnings"], a() {
    const Q = MK.amazon.quarters, l = Q.at(-1), p = Q.at(-5), g = MK.amazon.release.guidance, seg = MK.amazon.release.segments.slice().sort((a, b) => b.sales / b.sales_prior - a.sales / a.sales_prior)[0];
    return { head: `${qLabel(l.q)}: net sales ${bn(l.revenue)} (${pctTxt(l.revenue / p.revenue - 1)}), operating income ${bn(l.operating_income)} (${fmt.pct(l.operating_income / l.revenue)} margin).`,
      bullets: [`Fastest-growing segment: ${seg.name}, ${pctTxt(seg.sales / seg.sales_prior - 1)}.`, `${qLabel(g.quarter)} guidance: ${bn(g.sales_lo)} to ${bn(g.sales_hi)}.`],
      src: SRC("Open Market & company", 'data-go-tab="market"'), caveat: "From SEC filings and Amazon's earnings releases; company-wide, not appliances only." }; } },
  { id: "fresh", q: "How current is the data?", kw: ["current", "fresh", "freshness", "date", "data", "old", "recent", "latest", "stale", "updated", "how old"], a() {
    const items = [["Category reviews", F.meta.last_month, 0], ["Amazon filings", MK.meta.amazon_latest_quarter, 2], ["Market data", MK.fred.RSNSR.dates.at(-1), 0]];
    return { head: `The category review data ends ${fmt.month(F.meta.last_month)}, ${ageText(monthsAgo(F.meta.last_month))}. Amazon and market data are much more recent.`,
      bullets: items.map(([n, m, add]) => `${n}: latest ${m.length === 7 && n === "Amazon filings" ? qLabel(m) : fmt.month(m)} (${ageText(monthsAgo(m, add))})`),
      src: SRC("About the data", 'data-go-tab="quality"'), caveat: "No newer review dataset exists, and public indicators could not reliably stand in for it." }; } },
  { id: "filled", q: "What did you fill in or estimate?", kw: ["fill", "filled", "estimate", "estimated", "missing", "impute", "imputed", "price", "prices"], a() {
    const im = QL.imputation, pm = im.price_model;
    return { head: `${fmt.pct(im.price_missing_products_before, 0)} of products had no listed price; they are estimated and flagged (typical error ${fmt.pct(pm.group_level.median_abs_error_of_group_total, 0)} on brand-by-type totals).`,
      bullets: [`Product types: ${fmt.pct(im.type_missing_before, 1)} were predicted from titles (${fmt.pct(im.type_classifier_cv_accuracy, 0)} accurate on known products).`, "Amazon figures are only filled by accounting identities, never estimated.", "Category data after March 2023 is not filled at all."],
      src: SRC("About the data", 'data-go-tab="quality"'), caveat: "Listed prices alone would have overstated 2019 growth and understated the 2022 decline." }; } },
];

// ---------------------------------------------------------------- segment profile
function segmentAnswer(s) {
  const d = s.d, a = decide(s), tp = TP.rises.filter((x) => x.type === s.label), lcRow = LC.types.find((x) => x.key === s.label);
  const unh = (() => { const o = lastN(s.hist.orders, 12), g = lastN(s.hist.neg, 12); let n = 0, w = 0; o.forEach((v, i) => { if (g[i] != null) { n += g[i] * v; w += v; } }); return w ? n / w : null; })();
  const bullets = [
    `Last 12 months: ${fmtPm(s, d.last12)}, ${d.prior12 ? pctTxt(d.last12 / d.prior12 - 1) + " vs the 12 before" : "no prior period"}.`,
    `Outlook: ${pctTxt(d.growth)} expected (likely range ${fmtPm(s, d.lo12)} to ${fmtPm(s, d.hi12)}), ${Math.round(d.pGrowth * 100)}% chance of growth. Confidence: ${d.grade}.`,
    `Rating ${d.rNow != null ? d.rNow.toFixed(2) + "★" : "n/a"}${d.dR != null ? " (" + sgn(d.dR, (v) => v.toFixed(2)) + " vs last year)" : ""}${unh != null ? `; ${fmt.pct(unh, 0)} of reviews are 1–2★` : ""}.`,
    `Suggested action: <span class="badge ${ACTION_CLS[a.key]}">${a.label}</span> ${actionWhy(s, a)}.${tentative(s)}`,
  ];
  if (lcRow) bullets.push(`${fmt.pct(lcRow.new24_share, 0)} of its reviews come from products under two years old${lcRow.hit50 != null ? `; ${fmt.pct(lcRow.hit50, 0)} of recent launches reached 50+ reviews in year one` : ""}.`);
  if (tp.length) bullets.push(`Topic shift: “${esc2(tp[0].label)}” rose from ${fmt.pct(tp[0].prior, 0)} to ${fmt.pct(tp[0].recent, 0)} of reviews.`);
  const links = [SRC("Forecast lab", `data-open="${s.id}"`), SRC("Compare it", `data-ask-cmp="${s.id}"`)];
  if (s.kind === "type" && PX) links.push(SRC("Its products", `data-ask-type="${esc2(s.label)}"`));
  return { head: `${esc2(s.label)} (${KIND[s.kind].toLowerCase()})`, bullets, src: links.join(" · "), caveat: `As of ${fmt.month(F.meta.last_month)}; forecasts run from that date.`, raw: true };
}

// ---------------------------------------------------------------- UI
function showAnswer(ans, qtext) {
  const box = $("askAnswer");
  box.innerHTML = `<div class="ask-q">${esc2(qtext)}</div><div class="ask-head">${ans.raw ? ans.head : ans.head}</div>
    ${ans.bullets.length ? `<ul>${ans.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` : ""}
    <div class="ask-foot">${ans.src ? `<span>${ans.src}</span>` : ""}${ans.caveat ? `<span class="ask-cav">${esc2(ans.caveat)}</span>` : ""}</div>`;
  box.hidden = false;
}

const STOP = new Set(["what", "will", "the", "how", "are", "is", "do", "does", "did", "we", "can", "you", "which", "where", "when", "why", "our", "for", "this", "that", "with", "about", "from", "tell", "show", "give", "any", "has", "have", "and", "who", "should", "would", "could", "there", "their", "them", "than", "then", "its", "was", "were", "been", "please", "me", "my", "get", "next", "happens", "happen", "going", "go", "much", "many", "some", "way", "lot"]);
const OUT_OF_SCOPE = [
  { test: (t) => /\b(stock|stocks|shares?|share price|ticker|dividends?|crypto|bitcoin|etf|portfolio)\b/.test(t), msg: "I don't answer questions about stock prices or investments. The Market & company tab shows Amazon's reported results and guidance." },
  { test: (t) => /\b202[4-9]\b/.test(t) && !/\b(amazon|aws|company|market|retail|quarter|quarterly|guidance|earnings)\b/.test(t), msg: "The category review data ends in March 2023, so I can't say what happened in 2024 or later. For recent periods, see Market & company (Amazon's results and U.S. retail data)." },
  { test: (t) => /\b(weather|recipe|sports?|news|politics|joke)\b/.test(t), msg: "That's outside what this dashboard covers." },
];
function declineAnswer(text, why) {
  $("askAnswer").innerHTML = `<div class="ask-q">${esc2(text)}</div><div class="ask-head">I can't answer that from this dashboard.</div><p class="note">${esc2(why)} Try one of the questions above, or type a brand, product type or price band, for example “ice makers”, “GE” or “under $25”.</p>`;
  $("askAnswer").hidden = false;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();
function askRun(text) {
  const t = norm(text); if (!t) { $("askAnswer").hidden = true; return; }
  // an exact name wins outright; otherwise every typed word must start a word in the segment's name ("ge" matches "GE", never "refriGErator")
  if (["help", "hi", "hello", "hey", "what can you do", "how does this work", "?"].includes(t)) {
    $("askAnswer").innerHTML = `<div class="ask-q">${esc2(text)}</div><div class="ask-head">Here is what I can answer.</div><p class="note">Pick one of the questions above, or type a brand, product type or price band (for example “ice makers”, “GE” or “under $25”) to get its profile. Every answer is built from the numbers on these pages and links back to them. I don't guess, and I don't cover anything after March 2023 for the category.</p>`;
    $("askAnswer").hidden = false; return;
  }
  const all = F.segments.filter((s) => s.kind !== "total"), qw = t.split(" ").filter((w) => w && !STOP.has(w));
  const exact = all.filter((s) => norm(s.label) === t || (qw.length && norm(s.label) === qw.join(" ")));
  const segs = exact.length ? exact : all.filter((s) => { const lw = norm(s.label).split(" "); return qw.length && qw.every((w) => lw.some((x) => x.startsWith(w))); });
  if (segs.length === 1) { showAnswer(segmentAnswer(segs[0]), text); return; }
  if (segs.length > 1) {
    $("askAnswer").innerHTML = `<div class="ask-q">${esc2(text)}</div><div class="ask-head">Several segments match. Pick one:</div><div class="ask-chips">${segs.slice(0, 8).map((s) => `<button type="button" class="chipbtn" data-ask-seg="${esc2(s.id)}">${esc2(s.label)} <span class="sub2i">${KIND[s.kind]}</span></button>`).join("")}</div>`;
    $("askAnswer").hidden = false; return;
  }
  // things this dashboard will not speak to, whatever other words appear
  const oos = OUT_OF_SCOPE.find((o) => o.test(t));
  if (oos) { declineAnswer(text, oos.msg); return; }
  const words = t.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
  const scored = words.length ? QUESTIONS.map((q) => ({ q, hit: words.filter((w) => q.kw.some((k) => k.startsWith(w) || w.startsWith(k))).length })).filter((x) => x.hit / words.length >= 0.5)
    .sort((a, b) => b.hit / words.length - a.hit / words.length || b.hit - a.hit) : [];
  if (scored.length) { const best = scored[0].q; showAnswer(best.a(), best.q); return; }
  declineAnswer(text, "I only answer from the numbers on these pages, so I'd rather say so than guess.");
}

function renderAsk() {
  $("askChips").innerHTML = QUESTIONS.map((q) => `<button type="button" class="chipbtn${state.ask.q === q.id ? " on" : ""}" data-ask="${q.id}">${esc2(q.q)}</button>`).join("");
}

function initAsk() {
  renderAsk();
  $("askChips").onclick = (e) => { const b = e.target.closest("[data-ask]"); if (!b) return; const q = QUESTIONS.find((x) => x.id === b.dataset.ask); state.ask.q = q.id; $("askInput").value = ""; renderAsk(); showAnswer(q.a(), q.q); };
  let timer; $("askInput").oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.ask.q = null; renderAsk(); askRun(e.target.value); }, 250); };
  $("askInput").onkeydown = (e) => { if (e.key === "Enter") { state.ask.q = null; renderAsk(); askRun(e.target.value); } };
  $("askAnswer").onclick = (e) => {
    const t = (sel) => e.target.closest(sel);
    if (t("[data-ask-seg]")) { showAnswer(segmentAnswer(SEG[t("[data-ask-seg]").dataset.askSeg]), SEG[t("[data-ask-seg]").dataset.askSeg].label); return; }
    if (t("[data-open]")) { openLab(t("[data-open]").dataset.open); return; }
    if (t("[data-ask-cmp]")) { const id = t("[data-ask-cmp]").dataset.askCmp, C = state.cp; C.ids[0] = id; if (!C.ids[1] || C.ids[1] === id) C.ids[1] = defaultCompare().find((x) => x !== id) || C.ids[1]; state.px.view = "compare"; goTab("products"); return; }
    if (t("[data-ask-type]")) { openProductsForType(t("[data-ask-type]").dataset.askType); return; }
    if (t("[data-ask-preset]")) { const L = state.lab; Object.assign(L, { seg: "total", metric: "sales", price: 5, demand: 0, elast: -1.5, touched: false, target: null }); goTab("lab"); document.getElementById("scenarioBox").open = true; }
  };
}

// ---------------------------------------------------------------- "What am I looking at?" under key charts
const argmax = (a) => a.reduce((b, v, i) => (v > a[b] ? i : b), 0);
const EXPLAIN = {
  "c-sales-trend": () => {
    const f = filtered(), key = state.metric, mt = METRICS[key], y = f.map((r) => r[key]), isSum = key === "sales" || key === "orders";
    const cur = isSum ? sum(y.slice(-12)) : mean(y.slice(-12)), prev = y.length >= 24 ? (isSum ? sum(y.slice(-24, -12)) : mean(y.slice(-24, -12))) : null, pk = argmax(y);
    return { read: `The pale line is each month; the bold line is the ${mt.win}-month average, which smooths seasonal ups and downs so the direction is easier to see. "Compare with last year" overlays the same months a year earlier.`,
      now: `${mt.label} over the last 12 months: ${mt.f(cur)}${prev != null ? (isSum ? `, ${pctTxt(cur / prev - 1)} vs the 12 before` : `, ${sgn(cur - prev, (v) => (key === "pct_positive" ? (v * 100).toFixed(1) + " pts" : v.toFixed(2)))} vs the 12 before`) : ""}. The highest month in ${state.from}–${state.to} was ${fmt.month(f[pk].month)} (${mt.f(y[pk])}).`,
      note: key === "sales" ? "Sales is a proxy: the price of each verified-purchase review, with missing prices estimated (see About the data)." : "Based on review activity, which follows real sales with a lag." };
  },
  "c-annual": () => {
    const part = (yr) => M.filter((r) => yearOf(r.month) === yr).length, tot = (yr) => sum(M.filter((r) => yearOf(r.month) === yr).map((r) => r.sales));
    const full = YEARS.filter((y) => part(y) === 12), best = full.reduce((b, y) => (tot(y) > tot(b) ? y : b), full[0]), last = full.at(-1);
    return { read: "Each bar is a calendar year of the sales proxy; the label is growth on the year before. Years inside your selected range are bold. Click a bar to focus the whole page on that year.",
      now: `The biggest full year was ${best} (${fmt.usdC(tot(best))}). The latest full year, ${last}, was ${fmt.usdC(tot(last))}, ${pctTxt(tot(last) / tot(last - 1) - 1)} on ${last - 1}.`, note: "The last bar covers only part of a year, so it has no growth label." };
  },
  "c-topics": () => {
    const v = state.tp.view, P = TP.meta.periods, th = TP.meta.themes, last = P.length - 1;
    const rank = th.map((t) => ({ t, last: TP.series[t.key][v][last], first: TP.series[t.key][v][0] })).sort((a, b) => b.last - a.last), rise = th.map((t) => ({ t, d: TP.series[t.key][v][last] - TP.series[t.key][v][0] })).sort((a, b) => b.d - a.d)[0];
    return { read: `Each line is the share of ${v === "neg" ? "unhappy (1–2★) " : ""}reviews that mention a topic. Topics are counted with a fixed keyword list. Click a legend entry to show or hide a line.`,
      now: `In the latest period the most-mentioned topic is "${rank[0].t.label}" (${fmt.pct(rank[0].last, 0)}). Over ${P[0]} to ${P[last]} the biggest rise is "${rise.t.label}" (${sgn(rise.d * 100, (x) => x.toFixed(1))} points).`, note: "A rise in a topic is not always bad: topics like performance and value are mentioned in praise too." };
  },
  "c-lab": () => {
    const c = labCtx(), { L, m, h, isR, mult, scen, cum, lastH, baseTotal, se } = c, f = (v) => labFmt(m, v), total = baseTotal * mult;
    const tgt = isR ? lastH : L.target, pT = probAtLeast(cum.map((v) => v * mult), tgt);
    return { read: `The blue line is history; the orange dashed line is the expected path and the shaded band the ${L.band}% range. The dotted grey line shows what the model would have predicted for the last 12 months, so you can judge its record.${L.view === "cum" ? " The running-total view adds the months up and shows your target as a dashed line." : ""}`,
      now: `Expected over the ${h} months after ${fmt.month(F.meta.last_month)}: ${f(total)}${scen ? " (with your scenario)" : ""}, ${pctTxt(total / lastH - 1)} vs the ${h} before. Likely range ${f(cum[QI.p10] * mult)} to ${f(cum[QI.p90] * mult)}. ${isR ? `Chance the rating improves: ${Math.round(pT * 100)}%.` : `Chance of reaching ${f(L.target)}: ${Math.round(pT * 100)}%.`} Model: ${se.model}, typical miss ±${(se.wmape * 100).toFixed(0)}%.`,
      note: "Forecasts start from the last data point (March 2023), not from today." };
  },
  "c-bridge": () => {
    const c = labCtx(), { s, m, h } = c;
    if (m !== "sales" || !s.series.orders) return { read: "Bars show the expected change versus the same month a year earlier.", now: "Green bars are expected gains; red are expected falls.", note: "" };
    const Ol = sum(lastN(s.hist.orders, h)), Sl = sum(lastN(s.hist.sales, h)), Of = sum(s.series.orders.fc.mean.slice(0, h)), Sf = sum(s.series.sales.fc.mean.slice(0, h)), vol = (Of - Ol) * (Sl / Ol);
    return { read: "A waterfall: it starts at last period's sales, adds the effect of more or fewer orders, then the effect of price and product mix, and ends at the expected total.",
      now: `For ${s.label}: orders explain ${sgn(vol, fmt.usdC)} and price and mix ${sgn(Sf - Sl - vol, fmt.usdC)} of the expected ${sgn(Sf - Sl, fmt.usdC)} change.`, note: "Order counts are review counts, a proxy for orders." };
  },
  "c-lc-share": () => {
    const Y = LC.by_year, l = Y.at(-1).b, k = state.lc.share === "sales" ? "sales" : "orders";
    return { read: "Each bar is a year of " + (k === "sales" ? "the sales proxy" : "reviews") + ", split by how old the product was when it was reviewed: launched within 12 months, one to three years, or older.",
      now: `In the year to ${fmt.month(LC.meta.end)}: ${fmt.pct(l.new[k], 0)} from products launched within the year, ${fmt.pct(l.mid[k], 0)} from one to three years, ${fmt.pct(l.old[k], 0)} from older products.`, note: "Age is counted from Amazon's listed launch date, or the first review when none is listed." };
  },
  "c-cmp-sales": () => {
    const items = state.cp.ids.filter(Boolean).map((id) => SEG[id]).filter(Boolean);
    return { read: `Each line is a segment's ${state.cp.mode === "indexed" ? "sales proxy as an index (its 2019 average = 100), so segments of different size can be compared by growth" : "12-month average sales proxy, in dollars"}.`,
      now: items.map((s) => `${s.label}: ${fmtPm(s, s.d.last12)} in the last 12 months (${s.d.prior12 ? pctTxt(s.d.last12 / s.d.prior12 - 1) : "n/a"} vs the 12 before), expected ${pctTxt(s.d.growth)} next.`).join(" "), note: "Segments without price data are shown in orders." };
  },
  "c-amz-rev": () => {
    const Q = MK.amazon.quarters, l = Q.at(-1), p = Q.at(-5), fc = MK.amazon.forecast, n4 = sum(fc.fc.mean.slice(0, 4)), l4 = sum(Q.slice(-4).map((r) => r.revenue));
    return { read: "Bars are Amazon's actual quarterly net sales from its SEC filings. The orange dashed line is the model's expectation, with the shaded 80% range.",
      now: `${qLabel(l.q)} net sales were ${bn(l.revenue)}, ${pctTxt(l.revenue / p.revenue - 1)} on a year earlier. The model expects ${bn(n4)} over the next four quarters (${pctTxt(n4 / l4 - 1)}); its typical quarterly miss in backtests is ±${(fc.wmape * 100).toFixed(1)}%.`, note: "Company-wide figures, not appliances only." };
  },
  "c-amz-guide": () => {
    const g = MK.amazon.guidance_check;
    return { read: "The blue bar is Amazon's own guidance range for the coming quarter; the orange bar is the model's likely range, with a dot at its expected value. The diamond is the latest actual quarter.",
      now: `${qLabel(g.quarter)}: Amazon guides ${bn(g.guidance_lo)} to ${bn(g.guidance_hi)}; the model expects ${bn(g.model_mean)} (${bn(g.model_p10)} to ${bn(g.model_p90)}).`, note: "Amazon says Prime Day timing weighs on this quarter's growth, an event a seasonal model cannot see." };
  },
  "c-pulse": () => {
    const m = state.brief.pulse, mon = SEG.total.series[m].monitor, l = mon.at(-1), st = status(l, m), f = m === "sales" ? fmt.usdC : m === "orders" ? fmt.int : (v) => v.toFixed(2) + " ★";
    return { read: "The blue line is what actually happened each month; the dotted line is what the model expected using data up to the month before, with the shaded 80% range. A red dot is a month outside that range.",
      now: `${fmt.month(l.month)}: ${f(l.actual)} against an expected ${f(l.expected)} (${f(l.lo)} to ${f(l.hi)}), so ${st.text.toLowerCase()}.`, note: "About one month in five lands outside an 80% range by chance." };
  },
};

function explainFill(id) {
  const wrap = document.querySelector(`.explain-wrap[data-for="${id}"]`); if (!wrap || wrap.querySelector(".explain").hidden) return;
  try {
    const e = EXPLAIN[id]();
    wrap.querySelector(".explain").innerHTML = `<p><b>How to read it.</b> ${e.read}</p><p><b>What it shows now.</b> ${e.now}</p>${e.note ? `<p class="note">${e.note}</p>` : ""}`;
  } catch (err) { wrap.querySelector(".explain").innerHTML = "<p class='note'>Not available for this view.</p>"; }
}
function explainTouch(id) { if (EXPLAIN[id]) explainFill(id); }          // called after a chart redraws so an open explanation never goes stale

function initExplain() {
  Object.keys(EXPLAIN).forEach((id) => {
    const plot = $(id); if (!plot || plot.nextElementSibling?.classList.contains("explain-wrap")) return;
    const wrap = document.createElement("div"); wrap.className = "explain-wrap"; wrap.dataset.for = id;
    wrap.innerHTML = `<button type="button" class="explain-btn" aria-expanded="false">What am I looking at?</button><div class="explain" hidden></div>`;
    plot.insertAdjacentElement("afterend", wrap);
    wrap.querySelector(".explain-btn").onclick = (e) => {
      const box = wrap.querySelector(".explain"), open = box.hidden;
      box.hidden = !open; e.currentTarget.setAttribute("aria-expanded", open); e.currentTarget.textContent = open ? "Hide explanation" : "What am I looking at?";
      if (open) explainFill(id);
    };
  });
}

// quick self-check used while testing: every answer and explainer must be free of broken numbers
function selfTestAsk() {
  const bad = [], strip = (h) => String(h).replace(/<[^>]*>/g, " ");
  const test = (name, o) => { const text = strip([o.head, ...(o.bullets || []), o.caveat, o.read, o.now, o.note].join(" | ")); if (/NaN|undefined|Infinity|\bnull\b|\[object/.test(text) || !text.trim()) bad.push(name + ": " + text.slice(0, 160)); };
  QUESTIONS.forEach((q) => { try { test("Q " + q.id, q.a()); } catch (e) { bad.push("Q " + q.id + " threw " + e.message); } });
  F.segments.filter((s) => s.kind !== "total").forEach((s) => { try { test("seg " + s.id, segmentAnswer(s)); } catch (e) { bad.push("seg " + s.id + " threw " + e.message); } });
  Object.keys(EXPLAIN).forEach((id) => { try { test("explain " + id, EXPLAIN[id]()); } catch (e) { bad.push("explain " + id + " threw " + e.message); } });
  return bad;
}

// search regression set: the matcher must pick the right answer or decline; run in the console while changing keywords
function selfTestSearch() {
  const cases = [["what will amazon stock do", "decline"], ["weather in paris", "decline"], ["sales in 2025", "decline"], ["amazon 2025 revenue", "amazon"], ["outlook", "outlook"], ["at risk", "risk"], ["who should we invest in", "invest"],
    ["customer complaints", "topics"], ["prices up 5%", "price"], ["is the data old", "fresh"], ["how accurate is the forecast", "reliable"], ["what changed", "changed"], ["are we on track this month", "ontrack"], ["how is amazon doing", "amazon"],
    ["new vs old products", "newold"], ["what did you estimate", "filled"], ["what is driving sales", "drivers"], ["quality problems", "quality"], ["tell me a joke", "decline"], ["what happens if we cut prices", "price"], ["how much will sales grow", "outlook"]];
  const bad = [];
  cases.forEach(([q, want]) => {
    const t = norm(q), oos = OUT_OF_SCOPE.find((o) => o.test(t)); let got = "decline";
    if (!oos) {
      const words = t.split(" ").filter((w) => w.length > 2 && !STOP.has(w));
      const sc = words.length ? QUESTIONS.map((x) => ({ x, hit: words.filter((w) => x.kw.some((k) => k.startsWith(w) || w.startsWith(k))).length })).filter((s) => s.hit / words.length >= 0.5).sort((a, b) => b.hit / words.length - a.hit / words.length || b.hit - a.hit) : [];
      if (sc.length) got = sc[0].x.id;
    }
    if (got !== want) bad.push(`"${q}" → ${got}, expected ${want}`);
  });
  return bad;
}
