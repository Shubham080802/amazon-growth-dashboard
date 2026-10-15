"""Turn the raw Amazon Reviews 2023 (Appliances) JSONL files into small dashboard tables.

Usage: python scripts/etl.py <raw_dir> <out_dir>
"""
import sys
from pathlib import Path

import pandas as pd

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(exist_ok=True)

# --- products -------------------------------------------------------------
meta = pd.read_json(raw / "meta_Appliances.jsonl", lines=True)
products = pd.DataFrame(
    {
        "parent_asin": meta["parent_asin"],
        "title": meta["title"],
        "brand": meta["store"].fillna("Unknown"),
        "price": pd.to_numeric(meta["price"], errors="coerce"),
    }
)
price = products.set_index("parent_asin")["price"]
brand = products.set_index("parent_asin")["brand"]

# --- reviews (text columns dropped while streaming) ------------------------
cols = ["rating", "parent_asin", "user_id", "timestamp", "helpful_vote", "verified_purchase"]
parts = []
for chunk in pd.read_json(raw / "Appliances.jsonl", lines=True, chunksize=250_000):
    parts.append(chunk[cols])
rev = pd.concat(parts, ignore_index=True)
rev["date"] = pd.to_datetime(rev["timestamp"], unit="ms")
rev["month"] = rev["date"].dt.to_period("M").dt.to_timestamp()
rev["price"] = rev["parent_asin"].map(price)
rev["brand"] = rev["parent_asin"].map(brand).fillna("Unknown")
# Review-implied sales: price of each verified-purchase review (a lower-bound proxy
# for revenue, since only a fraction of buyers leave a review).
rev["sales"] = rev["price"].where(rev["verified_purchase"], 0).fillna(0)
rev["first_month"] = rev.groupby("user_id")["month"].transform("min")
rev["is_new_customer"] = rev["month"] == rev["first_month"]

# Monthly volume collapses after Mar-2023 (~$1.4M -> $0.2M by Aug-2023), which is a
# collection artefact at the end of the dataset snapshot, not real demand. Keep complete months.
rev = rev[rev["month"] < "2023-04-01"]

# --- monthly table ---------------------------------------------------------
g = rev.groupby("month")
monthly = pd.DataFrame(
    {
        "orders": g.size(),
        "sales": g["sales"].sum(),
        "avg_rating": g["rating"].mean(),
        "pct_positive": g["rating"].apply(lambda s: (s >= 4).mean()),
        "pct_negative": g["rating"].apply(lambda s: (s <= 2).mean()),
        "customers": g["user_id"].nunique(),
        "new_customers": g["is_new_customer"].sum(),
        "verified_share": g["verified_purchase"].mean(),
    }
).reset_index()
monthly.to_csv(out / "monthly.csv", index=False)

# --- monthly x rating (for stacked satisfaction chart) ---------------------
mr = rev.groupby(["month", rev["rating"].astype(int)]).size().rename("n").reset_index()
mr.to_csv(out / "monthly_rating.csv", index=False)

# --- brand x month (top brands only) ---------------------------------------
top = rev[rev["brand"] != "Unknown"].groupby("brand").size().nlargest(25).index
bm = (
    rev[rev["brand"].isin(top)]
    .groupby(["month", "brand"])
    .agg(orders=("rating", "size"), sales=("sales", "sum"), rating_sum=("rating", "sum"))
    .reset_index()
)
bm.to_csv(out / "brand_monthly.csv", index=False)

# --- product leaderboard ---------------------------------------------------
pg = rev.groupby("parent_asin").agg(
    orders=("rating", "size"), sales=("sales", "sum"), avg_rating=("rating", "mean")
)
pg = pg[pg["orders"] >= 50].join(products.set_index("parent_asin")[["title", "brand", "price"]])
pg.reset_index().nlargest(2000, "orders").to_csv(out / "products.csv", index=False)

print(f"reviews={len(rev):,} products={len(products):,} months={len(monthly)}")
print(monthly.tail(3).to_string())
