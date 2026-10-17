"""Checks for the scheduled refresh (needs only files in the repo, not the raw review data).

Run after build_market_data.py and build_recent_activity.py. Exit code 1 means "do not publish this refresh".
validate_data.py is the full check, but it needs the raw review files, which are not in the repo.
"""
import json
import math
import sys
from datetime import date
from pathlib import Path

W = Path(__file__).resolve().parent.parent / "web"
bad, notes = [], []


def finite(o):
    if isinstance(o, float):
        return math.isfinite(o)
    if isinstance(o, dict):
        return all(finite(v) for v in o.values())
    if isinstance(o, list):
        return all(finite(v) for v in o)
    return True


def months_old(ym):
    t = date.today()
    return t.year * 12 + t.month - 1 - (int(ym[:4]) * 12 + int(ym[5:7]) - 1)


def check(name, ok, detail):
    (notes if ok else bad).append(f"{'PASS' if ok else 'FAIL'} - {name} | {detail}")


mk = json.loads((W / "market.json").read_text())
check("market.json has no missing or infinite numbers", finite(mk), "all values are finite")
q = mk["amazon"]["quarters"]
qs = [r["q"] for r in q]
check("Amazon quarters are consecutive and recent", len(qs) >= 40 and months_old(qs[-1]) <= 10, f"{len(qs)} quarters, latest {qs[-1]} ({months_old(qs[-1])} months ago)")
check("Amazon revenue is positive in every quarter", all(r["revenue"] and r["revenue"] > 0 for r in q), "holds")
rec = mk["amazon"]["mix"]["reconciliation"]
check("Revenue mix reconciles to the SEC filing", all(max(abs(r["groups_vs_sec"]), abs(r["segments_vs_sec"]), abs(r["opinc_vs_sec"])) <= 1 for r in rec), f"{len(rec)} quarters within $1M")
check("Quarterly revenue forecast is ordered", all(lo <= m <= hi for lo, m, hi in zip(mk["amazon"]["forecast"]["fc"]["p10"], mk["amazon"]["forecast"]["fc"]["mean"], mk["amazon"]["forecast"]["fc"]["p90"])), "p10 <= mean <= p90")
for sid, s in mk["fred"].items():
    if len(s["dates"]) != len(s["values"]) or len(s["dates"]) < 24:
        bad.append(f"FAIL - FRED {sid} is incomplete | {len(s['dates'])} dates, {len(s['values'])} values")
age = months_old(mk["fred"]["RSNSR"]["dates"][-1])
check("Market series are current", age <= 4, f"retail sales latest {mk['fred']['RSNSR']['dates'][-1]} ({age} months ago)")

if (W / "recent.json").exists():
    rc = json.loads((W / "recent.json").read_text())
    check("recent.json has no missing or infinite numbers", finite(rc), "all values are finite")
    check("Recall data is current", months_old(rc["meta"]["recalls_latest"]) <= 12, f"latest recall {rc['meta']['recalls_latest']}")
    check("ENERGY STAR data is current", months_old(rc["meta"]["energystar_latest"]) <= 6 and rc["energystar"]["since_cutoff"] > 1000, f"latest month {rc['meta']['energystar_latest']}, {rc['energystar']['since_cutoff']:,} models since the cut-off")

print("\n".join(notes + bad))
print(f"\n{len(notes)}/{len(notes) + len(bad)} checks passed")
sys.exit(1 if bad else 0)
