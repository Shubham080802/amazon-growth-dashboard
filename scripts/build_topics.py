"""Category-wide topic trends: what customers talk about, and how that is shifting, by product type.

Uses the theme bit-mask recorded per review by build_reviews.py (keyword lexicon in themes.py). Nothing but counts
and rates is published. A "move" (a topic rising or fading within a product type) is only listed if it is large
enough to matter and statistically clear (two-proportion z-test), so noise is not presented as a trend.

Output: web/topics.json        Usage: python scripts/build_topics.py data
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from themes import THEME_KEYS, THEME_LABELS  # noqa: E402

data = Path(sys.argv[1])
m = pd.read_csv(data / "products_master.csv.gz", usecols=["type"])
r = pd.read_parquet(data / "reviews_lean.parquet", columns=["p", "month", "rating", "themes"])
END = int(r["month"].max())
r["year"] = r["month"] // 12
r["neg"] = (r["rating"] <= 2)
r["type"] = m["type"].to_numpy()[r["p"]]
bits = {k: ((r["themes"].to_numpy() >> i) & 1).astype(bool) for i, k in enumerate(THEME_KEYS)}

# ---- category-wide, by period (complete calendar years 2015-2022, then the latest 12 months)
periods = [(str(y), (r["year"] == y).to_numpy()) for y in range(2015, END // 12)] + [("Year to Mar 2023", (r["month"] > END - 12).to_numpy())]
neg = r["neg"].to_numpy()
series = {k: {"all": [], "neg": []} for k in THEME_KEYS}
n_rev, n_neg = [], []
for _, sel in periods:
    n_rev.append(int(sel.sum())); n_neg.append(int((sel & neg).sum()))
    for k in THEME_KEYS:
        series[k]["all"].append(round(float((bits[k] & sel).sum() / sel.sum()), 4))
        series[k]["neg"].append(round(float((bits[k] & sel & neg).sum() / max(1, (sel & neg).sum())), 4))

# ---- moves by product type: last 12 months vs the 12 before
rec = (r["month"] > END - 12).to_numpy(); pri = ((r["month"] > END - 24) & (r["month"] <= END - 12)).to_numpy()
tv = r["type"].to_numpy()
moves = []
for t in pd.Series(tv).value_counts().index:
    if t == "Other":
        continue
    st = tv == t
    n1, n0 = int((st & rec).sum()), int((st & pri).sum())
    if n1 < 400 or n0 < 400:
        continue
    for k, lab in zip(THEME_KEYS, THEME_LABELS):
        c1, c0 = int((bits[k] & st & rec).sum()), int((bits[k] & st & pri).sum())
        p1, p0 = c1 / n1, c0 / n0
        pool = (c1 + c0) / (n1 + n0)
        se = np.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n0)) or 1e-9
        z = (p1 - p0) / se
        if c1 >= 40 and abs(p1 - p0) >= 0.02 and abs(z) >= 4:
            moves.append({"type": t, "theme": k, "label": lab, "recent": round(p1, 4), "prior": round(p0, 4), "n_recent": n1, "n_prior": n0, "mentions": c1, "z": round(float(z), 1)})
rises = sorted([x for x in moves if x["recent"] > x["prior"]], key=lambda x: -(x["recent"] - x["prior"]))[:10]
falls = sorted([x for x in moves if x["recent"] < x["prior"]], key=lambda x: (x["recent"] - x["prior"]))[:6]

out = {"meta": {"end": f"{END // 12}-{END % 12 + 1:02d}", "periods": [p for p, _ in periods], "reviews": n_rev, "unhappy": n_neg,
                "themes": [{"key": k, "label": l} for k, l in zip(THEME_KEYS, THEME_LABELS)],
                "rule": "listed only if 40+ mentions, a change of 2+ points and a clear difference (z >= 4)"},
       "series": series, "rises": rises, "falls": falls, "tested_moves": len(THEME_KEYS) * int(sum(1 for t in pd.Series(tv).unique() if t != "Other"))}
(ROOT / "web" / "topics.json").write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
print(f"topics.json: {len(periods)} periods, {len(rises)} rises, {len(falls)} falls ({len(moves)} passed the filter)")
for x in rises[:5]: print("  rise:", x["type"][:30], "|", x["label"], f"{x['prior']:.1%} -> {x['recent']:.1%} (z {x['z']})")
for x in falls[:3]: print("  fall:", x["type"][:30], "|", x["label"], f"{x['prior']:.1%} -> {x['recent']:.1%} (z {x['z']})")
print("category 'Leaks' mention rate by period:", series["leak"]["all"])
