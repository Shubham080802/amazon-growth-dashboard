// "About the data" page: what was filled, how accurate each fill is, and which consistency checks pass.
// Reads quality.json (built by scripts/validate_data.py).

let QL = null;
function prepQuality(d) { QL = d; }

function renderQuality() {
  const im = QL.imputation, pm = im.price_model, last12 = QL.annual.at(-1);
  const checks = QL.checks, passed = checks.filter((c) => c.status === "pass").length, warns = checks.filter((c) => c.status === "warn").length, fails = checks.filter((c) => c.status === "fail").length;
  const mon = M.slice(-12), est12 = 1 - sum(mon.map((r) => r.sales_obs)) / sum(mon.map((r) => r.sales));
  $("qlTiles").innerHTML = [
    tile({ label: "Consistency checks passed", value: `${passed} of ${checks.length}`, sub: fails ? `${fails} failing` : warns ? `${warns} warning` : "no failures" }),
    tile({ label: "Products with no price, before → after", value: `${fmt.pct(im.price_missing_products_before, 0)} → 0%`, sub: `${fmt.int(im.price_estimated_products)} prices estimated and flagged` }),
    tile({ label: "Sales proxy resting on estimated prices", value: fmt.pct(est12, 0), sub: "last 12 months of data (older years are higher)" }),
    tile({ label: "Price estimate accuracy", value: fmt.pct(pm.group_level.median_abs_error_of_group_total, 0), sub: "typical error on brand-by-type totals" }),
  ].join("");

  // the headline finding: observed-only vs completed growth
  const A = QL.annual, yrs = A.slice(1).map((a) => a.year);
  const g = (k) => A.slice(1).map((a, i) => a[k] / A[i][k] - 1);
  draw("c-ql-growth", [
    { x: yrs, y: g("observed"), type: "bar", name: "Listed prices only", marker: { color: rgba(css("--muted"), 0.55), cornerradius: 3 }, hovertemplate: "%{y:+.0%}" },
    { x: yrs, y: g("completed"), type: "bar", name: "With estimated prices filled in", marker: { color: css("--c1"), cornerradius: 3 }, hovertemplate: "%{y:+.0%}" },
  ], layout({ barmode: "group", bargap: 0.25, margin: { l: 8, r: 8, t: 30, b: 8 }, yaxis: { tickformat: "+.0%" }, xaxis: { type: "category" } }));
  draw("c-ql-est", [{ x: A.map((a) => a.year), y: A.map((a) => a.est_share), mode: "lines+markers", name: "Estimated share", line: line(css("--c2"), 2.5), marker: { size: 7, color: css("--c2"), line: { color: css("--surface"), width: 2 } }, hovertemplate: "%{y:.0%}" }],
    layout({ showlegend: false, margin: { l: 8, r: 16, t: 12, b: 8 }, yaxis: { tickformat: ".0%", range: [0, 0.7] }, xaxis: { type: "category" } }));

  // how good are the fills
  const coh = Object.entries(im.price_model_by_launch_cohort);
  $("qlModel").innerHTML = `<thead><tr><th>Launch cohort</th><th class="n">Products with a known price</th><th class="n">Bias of the total</th><th class="n">Typical error per product</th></tr></thead><tbody>` +
    coh.map(([k, v]) => `<tr><td>${k}</td><td class="n">${fmt.int(v.products)}</td><td class="n">${v.bias_of_review_weighted_total >= 0 ? "+" : "−"}${Math.abs(v.bias_of_review_weighted_total * 100).toFixed(1)}%</td><td class="n">${fmt.pct(v.median_abs_pct_error, 0)}</td></tr>`).join("") + "</tbody>";
  $("qlFills").innerHTML = [
    ["Price", `${fmt.pct(im.price_missing_products_before, 1)} of products had no listed price. A model using product type, brand, weight, pack size and title text estimates them; it was trained on the ${fmt.int(pm.trained_on_products)} products whose price is known and judged only on those (R² ${pm.r2_log_price}).`],
    ["Product type", `${fmt.pct(im.type_missing_before, 1)} had no category path; their type is predicted from the title (${fmt.pct(im.type_classifier_cv_accuracy, 0)} accurate when tested on products whose type is known).`],
    ["Brand", `${fmt.pct(im.brand_missing_before, 1)} had no store name. Fields that already existed (brand, manufacturer) were copied across, leaving ${fmt.pct(im.brand_missing_after, 1)} as “Unknown”. No brand is guessed.`],
    ["Amazon quarterly figures", `Gaps are filled only by accounting identities (for example Q2 = six-month total minus Q1), never estimated, and each filled value is listed in data/external/amazon_quarterly_derived.json.`],
    ["What is not filled", `April 2023 onward in the category data. No public source reliably stands in for it (see Market &amp; company), so it stays empty rather than invented.`],
  ].map(([k, v]) => `<li><b>${k}.</b> ${v}</li>`).join("");

  const badge = { pass: '<span class="badge good">Pass</span>', warn: '<span class="badge warn">Note</span>', fail: '<span class="badge bad">Fail</span>' };
  $("qlChecks").innerHTML = `<thead><tr><th>Check</th><th>Result</th><th></th></tr></thead><tbody>` +
    checks.map((c) => `<tr><td><b>${c.name}</b></td><td class="wrap">${c.detail}</td><td class="n">${badge[c.status]}</td></tr>`).join("") + "</tbody>";
}
