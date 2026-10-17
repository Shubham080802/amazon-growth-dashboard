// "Recent appliance activity": CPSC recalls and ENERGY STAR new models through the present.
// Optional and additive: reads recent.json (scripts/build_recent_activity.py); the tab is unchanged if it is missing.

let RC = null;
function prepRecent(d) { RC = d; }

function renderRecent() {
  const sec = $("recentSec");
  if (!RC || !sec) return;
  sec.hidden = false;
  const R = RC.recalls, E = RC.energystar, m = RC.meta;
  $("recentTo").textContent = fmt.month(m.recalls_latest.slice(0, 7));
  const chg = (a, b) => (b ? a / b - 1 : 0);
  $("recTiles").innerHTML = [
    tile({ label: "Appliance recalls, last 12 months", value: R.last12, sub: `prior 12 months: ${R.prior12}`, delta: deltaChip(chg(R.last12, R.prior12), pctTxt, false) }),
    tile({ label: "Recalls since Apr 2023", value: R.since_cutoff, sub: "after the review data ends" }),
    tile({ label: "New ENERGY STAR models, last 12 months", value: E.last12.toLocaleString(), sub: `prior 12 months: ${E.prior12.toLocaleString()}`, delta: deltaChip(chg(E.last12, E.prior12), pctTxt) }),
    tile({ label: "Certified models launched since Apr 2023", value: E.since_cutoff.toLocaleString(), sub: `${E.top_brands_since_cutoff[0].brand} leads with ${E.top_brands_since_cutoff[0].models}` }),
  ].join("");

  const ys = Object.keys(R.by_year), pal = [css("--c1"), css("--c2"), css("--c3"), css("--c4"), "#e87ba4", "#8a94a6"];
  const tot = (g) => sum(ys.map((y) => R.by_year[y][g])), top = R.groups.slice().sort((a, b) => tot(b) - tot(a)).slice(0, 5);   // five biggest groups, the rest as "Other"
  const series = [...top.map((g) => [g, ys.map((y) => R.by_year[y][g])]), ["Other", ys.map((y) => sum(R.groups.filter((g) => !top.includes(g)).map((g) => R.by_year[y][g])))]];
  draw("c-rec-year", series.map(([g, v], i) => ({ x: ys, y: v, type: "bar", name: g, marker: { color: pal[i] }, hovertemplate: "%{y}" })),
    layout({ barmode: "stack", margin: { l: 8, r: 8, t: 8, b: 8 }, legend: { y: -0.18, yanchor: "top" }, xaxis: { type: "category" } }));
  const cat = ["#2a6df4", "#e8590c", "#12a594", "#8a6fd6", "#d9a441", "#e87ba4"];
  draw("c-es-year", E.categories.map((c, i) => ({ x: E.years, y: E.by_year[c], type: "bar", name: c, marker: { color: cat[i % cat.length] }, hovertemplate: "%{y}" })),
    layout({ barmode: "stack", margin: { l: 8, r: 8, t: 8, b: 8 }, legend: { y: -0.18, yanchor: "top" }, xaxis: { type: "category" } }));
  const tb = E.top_brands_since_cutoff.slice().reverse();
  draw("c-es-brand", [{ y: tb.map((b) => b.brand), x: tb.map((b) => b.models), type: "bar", orientation: "h", marker: { color: css("--c1") }, hovertemplate: "%{x} models" }],
    layout({ margin: { l: 8, r: 16, t: 8, b: 8 }, hovermode: "closest", xaxis: { type: "linear" }, yaxis: { type: "category" } }));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  $("recTable").innerHTML = `<thead><tr><th>Date</th><th>Recall</th><th>Group</th></tr></thead><tbody>` +
    R.recent.map((r) => `<tr><td>${r.date}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.title.slice(0, 90))}</b></a>${r.hazard ? `<span class="sub2">${esc(r.hazard)}</span>` : ""}</td><td>${esc(r.group)}</td></tr>`).join("") + "</tbody>";
  $("recNote").innerHTML = `${esc(m.notes.recalls)} ${esc(m.notes.energystar)} Sources: <a href="${m.recalls_url}">CPSC</a>, <a href="${m.energystar_url}">ENERGY STAR</a>. These are activity signals, not sales, and they are not used by the forecast.`;
}
