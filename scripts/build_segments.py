"""Monthly series per business segment, from the review cache and the completed product master.

Segments an analytics team would plan on:
  total      the whole category
  family     parts & accessories vs appliances & equipment
  type       product types (the category path: "Dryer Parts & Accessories", "Range Hoods", ...)
  brand      the 12 biggest brands by review volume
  band       price bands: <$25, $25-75, $75-250, $250+ (every product, using observed or estimated price)
  product    the 30 most-reviewed products

`sales` uses completed prices; `sales_obs` uses observed prices only.

Output: data/segments_monthly.csv
Usage:  python scripts/build_segments.py data      (run build_products.py and build_reviews.py first)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

out = Path(sys.argv[1])
N_BRANDS, N_PRODUCTS, MIN_TYPE_REVIEWS = 12, 30, 3000
BANDS = [(0, 25, "Under $25"), (25, 75, "$25 to $75"), (75, 250, "$75 to $250"), (250, 1e9, "$250 and over")]

m = pd.read_csv(out / "products_master.csv.gz")
r = pd.read_parquet(out / "reviews_lean.parquet")
for c in ("price", "price_obs", "brand", "type", "is_parts", "title", "parent_asin"):
    r[c] = m[c].to_numpy()[r["p"]]
r["sales"] = np.where(r["ver"] == 1, r["price"], 0.0)
r["sales_obs"] = np.where(r["ver"] == 1, np.nan_to_num(r["price_obs"]), 0.0)
r["neg"] = (r["rating"] <= 2).astype(int)
r["band"] = pd.cut(r["price"], [b[0] for b in BANDS] + [BANDS[-1][1]], right=False, labels=[b[2] for b in BANDS])
r["family"] = np.where(r["is_parts"] == 1, "Parts & accessories", "Appliances & equipment")
months = np.arange(r["month"].min(), r["month"].max() + 1)
label_of = lambda mi: f"{mi // 12}-{mi % 12 + 1:02d}"


def monthly(df, kind, seg, label):
    g = df.groupby("month").agg(orders=("rating", "size"), sales=("sales", "sum"), sales_obs=("sales_obs", "sum"),
                                rating_sum=("rating", "sum"), neg=("neg", "sum"))
    g = g.reindex(months, fill_value=0).rename_axis("month").reset_index()
    g["month"] = g["month"].map(label_of)
    g.insert(0, "label", label); g.insert(0, "segment", seg); g.insert(0, "kind", kind)
    return g


frames = [monthly(r, "total", "total", "All appliances")]
for fam in ("Parts & accessories", "Appliances & equipment"):
    frames.append(monthly(r[r["family"] == fam], "family", f"family:{fam}", fam))

tvc = r.groupby("type").size()
for t in tvc[tvc >= MIN_TYPE_REVIEWS].sort_values(ascending=False).index:
    if t != "Other":
        frames.append(monthly(r[r["type"] == t], "type", f"type:{t}", "General parts & accessories" if t == "Parts & Accessories" else t))

for b in r[r["brand"] != "Unknown"]["brand"].value_counts().head(N_BRANDS).index:
    frames.append(monthly(r[r["brand"] == b], "brand", f"brand:{b}", b))
for _, _, name in BANDS:
    frames.append(monthly(r[r["band"] == name], "band", f"band:{name}", name))
for a in r["parent_asin"].value_counts().head(N_PRODUCTS).index:
    title = str(r.loc[r["parent_asin"] == a, "title"].iloc[0] or a)
    frames.append(monthly(r[r["parent_asin"] == a], "product", f"product:{a}", (title[:52] + "…") if len(title) > 53 else title))

seg = pd.concat(frames, ignore_index=True)
seg.to_csv(out / "segments_monthly.csv", index=False)
print(f"segments={seg['segment'].nunique()} rows={len(seg):,} months={len(months)}")
print(seg.groupby("kind")["segment"].nunique().to_dict())
tot = seg[seg.segment == "total"]
print("total orders", int(tot.orders.sum()), "| sales", round(tot.sales.sum()), "| observed-only sales", round(tot.sales_obs.sum()),
      "| estimated share", f"{1 - tot.sales_obs.sum() / tot.sales.sum():.1%}")
