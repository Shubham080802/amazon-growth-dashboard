"""Build monthly series per business segment from the raw Amazon Appliances reviews.

Segments an analytics team would plan on:
  total        the whole category
  brand        the 12 biggest brands by review volume
  price band   <$25, $25-75, $75-250, $250+  (priced products only)
  product      the 30 most-reviewed products

Output: data/segments_monthly.csv  (one row per segment per month)
Usage:  python scripts/build_segments.py data_raw data
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
LAST_COMPLETE = "2023-04-01"      # collection is incomplete after Mar-2023 (see README)
N_BRANDS, N_PRODUCTS = 12, 30
BANDS = [(0, 25, "Under $25"), (25, 75, "$25 to $75"), (75, 250, "$75 to $250"), (250, 1e9, "$250 and over")]

meta = pd.read_json(raw / "meta_Appliances.jsonl", lines=True)
prod = pd.DataFrame({
    "parent_asin": meta["parent_asin"], "title": meta["title"],
    "brand": meta["store"].fillna("Unknown"), "price": pd.to_numeric(meta["price"], errors="coerce"),
}).drop_duplicates("parent_asin").set_index("parent_asin")

parts = []
for chunk in pd.read_json(raw / "Appliances.jsonl", lines=True, chunksize=250_000):
    parts.append(chunk[["rating", "parent_asin", "timestamp", "verified_purchase"]])
rev = pd.concat(parts, ignore_index=True)
rev["month"] = pd.to_datetime(rev["timestamp"], unit="ms").dt.to_period("M").dt.to_timestamp()
rev = rev[(rev["month"] >= "2012-01-01") & (rev["month"] < LAST_COMPLETE)].copy()
rev = rev.join(prod[["title", "brand", "price"]], on="parent_asin")
rev["sales"] = rev["price"].where(rev["verified_purchase"], 0).fillna(0)
rev["neg"] = (rev["rating"] <= 2).astype(int)
rev["band"] = pd.cut(rev["price"], [b[0] for b in BANDS] + [BANDS[-1][1]], right=False, labels=[b[2] for b in BANDS])

months = pd.date_range(rev["month"].min(), rev["month"].max(), freq="MS")


def monthly(df, kind, seg, label):
    g = df.groupby("month").agg(orders=("rating", "size"), sales=("sales", "sum"),
                                rating_sum=("rating", "sum"), neg=("neg", "sum"))
    g = g.reindex(months, fill_value=0).rename_axis("month").reset_index()
    g.insert(0, "label", label); g.insert(0, "segment", seg); g.insert(0, "kind", kind)
    return g


frames = [monthly(rev, "total", "total", "All appliances")]

top_brands = rev[rev["brand"] != "Unknown"]["brand"].value_counts().head(N_BRANDS).index
for b in top_brands:
    frames.append(monthly(rev[rev["brand"] == b], "brand", f"brand:{b}", b))

for lo, hi, name in BANDS:
    frames.append(monthly(rev[rev["band"] == name], "band", f"band:{name}", name))

top_prods = rev["parent_asin"].value_counts().head(N_PRODUCTS).index
for a in top_prods:
    title = str(prod.loc[a, "title"] or a)
    short = (title[:52] + "…") if len(title) > 53 else title
    frames.append(monthly(rev[rev["parent_asin"] == a], "product", f"product:{a}", short))

seg = pd.concat(frames, ignore_index=True)
seg["month"] = seg["month"].dt.strftime("%Y-%m")
seg.to_csv(out / "segments_monthly.csv", index=False)

priced = (rev["price"].notna()).mean()
print(f"segments={seg['segment'].nunique()} rows={len(seg):,} months={len(months)} priced_share={priced:.1%}")
print(seg.groupby("kind")["orders"].sum())
