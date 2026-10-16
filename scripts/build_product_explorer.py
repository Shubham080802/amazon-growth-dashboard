"""Per-product review analytics for the dashboard's Products tab.

Every product with at least MIN_REVIEWS reviews gets: monthly review volume and rating history, launch/peak/stage,
growth and rating drift over the last 12 months, and (with at least MIN_THEME_REVIEWS reviews) which themes customers
mention and how that shifted. Review text is never published: only counts of theme mentions.

Output (committed): web/products/index.json  (searchable list)  and  web/products/s00.json ... s31.json  (details)
Usage:  python scripts/build_product_explorer.py data        (after build_products.py and build_reviews.py)
"""
import json
import sys
import zlib
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from themes import THEME_KEYS, THEME_LABELS  # noqa: E402

data = Path(sys.argv[1])
web = ROOT / "web" / "products"
web.mkdir(parents=True, exist_ok=True)
MIN_REVIEWS, MIN_THEME_REVIEWS, SHARDS = 30, 100, 32

m = pd.read_csv(data / "products_master.csv.gz")
r = pd.read_parquet(data / "reviews_lean.parquet")
END = int(r["month"].max())                                   # last complete month in the data (Mar 2023)
ym = lambda mi: f"{mi // 12}-{mi % 12 + 1:02d}"
r["neg"] = (r["rating"] <= 2).astype(np.int8)
r["rec"] = (r["month"] > END - 12).astype(np.int8)
r["pri"] = ((r["month"] > END - 24) & (r["month"] <= END - 12)).astype(np.int8)

counts = r.groupby("p").size()
keep = counts[counts >= MIN_REVIEWS].index
print(f"{len(keep):,} products with {MIN_REVIEWS}+ reviews cover {counts[keep].sum() / counts.sum():.1%} of all reviews")
r = r[r["p"].isin(keep)]

# ---- monthly history per product
mon = r.groupby(["p", "month"]).agg(n=("rating", "size"), rs=("rating", "sum"), ng=("neg", "sum"), v=("ver", "sum"),
                                    help_=("helpful", "sum")).reset_index()

# ---- theme counts: all / negative reviews / last 12 months / the 12 before
tbits = r["themes"].to_numpy()
tcols = {}
for i, k in enumerate(THEME_KEYS):
    tcols[k] = ((tbits >> i) & 1).astype(np.int8)
tdf = pd.DataFrame(tcols); tdf["p"] = r["p"].to_numpy()
neg_m, rec_m, pri_m = r["neg"].to_numpy() == 1, r["rec"].to_numpy() == 1, r["pri"].to_numpy() == 1
th_all = tdf.groupby("p")[THEME_KEYS].sum()
th_neg = tdf[neg_m].groupby("p")[THEME_KEYS].sum().reindex(th_all.index, fill_value=0)
th_rec = tdf[rec_m].groupby("p")[THEME_KEYS].sum().reindex(th_all.index, fill_value=0)
th_pri = tdf[pri_m].groupby("p")[THEME_KEYS].sum().reindex(th_all.index, fill_value=0)
n_all = r.groupby("p").size(); n_neg = r[neg_m].groupby("p").size().reindex(n_all.index, fill_value=0)
n_rec = r[rec_m].groupby("p").size().reindex(n_all.index, fill_value=0); n_pri = r[pri_m].groupby("p").size().reindex(n_all.index, fill_value=0)

types = m["type"].value_counts().index.tolist()
type_ix = {t: i for i, t in enumerate(types)}

index, shards = [], {s: [] for s in range(SHARDS)}
for p, g in mon.groupby("p"):
    g = g.sort_values("month")
    first, last = int(g["month"].iloc[0]), int(g["month"].iloc[-1])
    span = np.arange(first, END + 1)                                    # from the first review to the end of the data
    full = g.set_index("month").reindex(span, fill_value=0)
    n = full["n"].to_numpy(); rs = full["rs"].to_numpy()
    cur, pri = int(n[-12:].sum()), int(n[-24:-12].sum()) if len(n) > 12 else 0
    growth = (cur / pri - 1) if pri >= 5 else None
    r_cur = rs[-12:].sum() / cur if cur >= 10 else None
    r_pri = rs[-24:-12].sum() / pri if (len(n) > 12 and pri >= 10) else None
    smooth = pd.Series(n).rolling(3, min_periods=1).mean().to_numpy()
    peak = int(span[int(np.argmax(smooth))])
    age = END - first
    if age <= 11:
        stage = "New"
    elif last < END - 5:
        stage = "Faded"
    elif cur < 10:
        stage = "Low activity"
    elif growth is not None and growth >= 0.25:
        stage = "Growing"
    elif growth is not None and growth <= -0.25:
        stage = "Declining"
    else:
        stage = "Steady"
    row = m.iloc[p]
    asin = row["parent_asin"]; sh = zlib.crc32(asin.encode()) % SHARDS
    total = int(n.sum())
    index.append({
        "id": asin, "t": str(row["title"])[:92], "b": row["brand"], "y": type_ix[row["type"]], "n": total,
        "f": ym(first), "l": ym(last), "rt": round(float(rs.sum() / total), 2), "pr": round(float(row["price"]), 2),
        "pe": int(row["price_src"] == "estimated"), "g": None if growth is None else round(float(growth), 3), "c": cur, "pc": pri,
        "dr": None if (r_cur is None or r_pri is None) else round(float(r_cur - r_pri), 2), "st": stage, "pk": ym(peak),
        "la": row["launch"] if isinstance(row["launch"], str) else None,
        "rk": None if pd.isna(row["bsr_rank"]) else int(row["bsr_rank"]), "ra": int(row["rating_number"]), "sh": sh,
    })
    d = {"a": asin, "s": ym(first), "n": n.tolist(), "rs": rs.tolist(), "ng": full["ng"].tolist(), "v": full["v"].tolist(), "hv": int(full["help_"].sum())}
    if total >= MIN_THEME_REVIEWS:
        d["th"] = [[int(th_all.at[p, k]), int(th_neg.at[p, k]), int(th_rec.at[p, k]), int(th_pri.at[p, k])] for k in THEME_KEYS]
        d["N"] = [int(n_all[p]), int(n_neg[p]), int(n_rec[p]), int(n_pri[p])]
    shards[sh].append(d)

index.sort(key=lambda x: -x["n"])
meta = {"end": ym(END), "min_reviews": MIN_REVIEWS, "min_theme_reviews": MIN_THEME_REVIEWS, "shards": SHARDS,
        "types": types, "themes": [{"key": k, "label": l} for k, l in zip(THEME_KEYS, THEME_LABELS)],
        "products_total": int(len(m)), "products_listed": len(index), "reviews_covered_share": round(float(counts[keep].sum() / counts.sum()), 4)}
(web / "index.json").write_text(json.dumps({"meta": meta, "items": index}, separators=(",", ":"), allow_nan=False))
for s, items in shards.items():
    (web / f"s{s:02d}.json").write_text(json.dumps(items, separators=(",", ":"), allow_nan=False))
sizes = [(web / f"s{s:02d}.json").stat().st_size for s in range(SHARDS)]
print(f"index {len(index):,} products ({(web / 'index.json').stat().st_size / 1e6:.1f} MB) | shards {SHARDS} x ~{np.mean(sizes) / 1e3:.0f} KB (total {sum(sizes) / 1e6:.1f} MB)")
print(pd.Series([x["st"] for x in index]).value_counts().to_dict())
