"""Run Google Trends downloads through the same strict bridge test used for the FRED indicators.

Question: can search interest stand in for the category data we are missing (Apr 2023 onward)?
Reads every CSV in data/external/trends/ (manual downloads, see the README there), applies build_market_data.bridge_test
unchanged, and writes data/external/trends_bridge.json. It does NOT touch web/market.json or any dashboard file:
include a term on the dashboard only if it earns a "Yes", and that is a separate, deliberate step.

Usage: python scripts/test_trends.py [folder]
"""
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_market_data as bm

ROOT = bm.ROOT


def read_trends(path):
    """Google's export: a few preamble lines, then 'Month,<term>: (United States)', then YYYY-MM rows ('<1' means under 1)."""
    rows = list(csv.reader(open(path, encoding="utf-8-sig")))
    k = next((i for i, r in enumerate(rows) if r and r[0].strip() in ("Month", "Week", "Day", "Time")), None)
    if k is None or len(rows[k]) < 2:
        raise ValueError("no 'Month,<term>' header found")
    if rows[k][0].strip() != "Month":
        raise ValueError("needs monthly data: choose the 2004 - present range so Google returns months")
    term = rows[k][1].split(":")[0].strip()
    dates, vals = [], []
    for r in rows[k + 1:]:
        if len(r) < 2 or not r[0].strip():
            continue
        v = r[1].strip().replace("<1", "0.5")
        try:
            dates.append(r[0].strip()[:7]); vals.append(float(v))
        except ValueError:
            continue
    return term, dates, vals


def main():
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "external" / "trends"
    files = sorted(folder.glob("*.csv"))
    if not files:
        print(f"No CSV files in {folder}. See its README.md for how to download them.")
        return 0
    series = {}
    for f in files:
        try:
            term, d, v = read_trends(f)
        except Exception as e:
            print(f"skipped {f.name}: {e}"); continue
        if d[0] > "2013-01" or d[-1] < "2023-03" or len(d) < 120:
            print(f"skipped {f.name}: needs monthly data covering 2013 to Mar 2023 (has {d[0]} to {d[-1]})"); continue
        series[f"TRENDS_{f.stem}"] = {"label": f"Google search interest: {term}", "dates": d, "values": v}
    if not series:
        return 1
    bm.BRIDGE_IDS = list(series)                        # the Bonferroni correction counts only the terms tested here
    res = bm.bridge_test(series)
    (ROOT / "data" / "external" / "trends_bridge.json").write_text(json.dumps(res, indent=1))
    print(f"Strict bridge test, {len(series)} search term(s), alpha {res['alpha']} (actual Q1 2023 growth {res['q1_actual']:+.2f})")
    for r in res["rows"]:
        print(f"  {r['verdict']:<10} {r['label']:<48} r={r['r']:+.2f} p={r['p']:.3f} LOO {r['loo']:.3f} vs naive {r['naive']:.3f}  Q1-23 predicted {r['q1_pred']:+.2f}")
    print("Only 'Yes' would justify using a term; 'Suggestive' and 'No' do not.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
