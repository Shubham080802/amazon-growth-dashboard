// The decision rules, kept free of anything to do with the page so the dashboard (here) and the Tableau export
// (scripts/export_tableau.py, checked against this file by scripts/validate_data.py) always agree.
// Needs: a global F (forecast.json), `sum`, and `state.brief.rules`.

const QI = { p05: 0, p10: 1, p25: 4, p50: 9, p75: 14, p90: 17, p95: 18 };   // positions in the stored 19 quantiles
const pmOf = (s) => (s.series.sales ? "sales" : "orders");
const DEFAULT_RULES = { invest: 0.7, risk: 0.7, floor: 4.0 };

// P(total >= x) from the stored quantiles (linear between them, capped at the tails)
function probAtLeast(qv, x) {
  const p = F.meta.quantiles;
  if (x <= qv[0]) return 0.97;
  if (x >= qv.at(-1)) return 0.03;
  for (let i = 1; i < qv.length; i++) {
    if (x <= qv[i]) { const w = qv[i] === qv[i - 1] ? 0 : (x - qv[i - 1]) / (qv[i] - qv[i - 1]); return 1 - (p[i - 1] + w * (p[i] - p[i - 1])); }
  }
  return 0.03;
}
const lastN = (arr, n, off = 0) => arr.slice(arr.length - n - off, arr.length - off);
function weightedRating(s, n, off = 0) {
  let num = 0, den = 0;
  const r = lastN(s.hist.rating, n, off), o = lastN(s.hist.orders, n, off);
  r.forEach((v, i) => { if (v != null) { num += v * o[i]; den += o[i]; } });
  return den ? num / den : null;
}
const gradeOf = (w) => (w <= 0.15 ? "High" : w <= 0.30 ? "Medium" : "Low");

function derive(s) {
  const pm = pmOf(s), se = s.series[pm], h = s.hist, q = se.cumq[11];
  const last12 = sum(lastN(h[pm], 12)), prior12 = sum(lastN(h[pm], 12, 12)), fc12 = sum(se.fc.mean.slice(0, 12));
  const rNow = weightedRating(s, 12), rPrev = weightedRating(s, 12, 12);
  s.d = { pm, last12, prior12, fc12, lo12: q[QI.p10], hi12: q[QI.p90], growth: fc12 / last12 - 1, pGrowth: probAtLeast(q, last12),
    rNow, rPrev, dR: rNow != null && rPrev != null ? rNow - rPrev : null, grade: gradeOf(se.wmape), wmape: se.wmape };
}

function decide(s) {
  const d = s.d, R = state.brief.rules;
  const quality = (d.rNow != null && d.rNow < R.floor) || (d.dR != null && d.dR <= -0.10);
  let key = "watch", label = "Watch";
  if (d.pGrowth <= 1 - R.risk) { key = "risk"; label = "Risk"; }
  else if (quality && d.pGrowth >= 0.5) { key = "fix"; label = "Fix quality"; }
  else if (d.pGrowth >= R.invest && !quality) { key = "invest"; label = "Invest"; }
  return { key, label, tentative: d.grade === "Low" };
}
