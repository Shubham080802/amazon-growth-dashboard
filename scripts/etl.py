"""Monthly tables for the dashboard, from the review cache and the product master.

Sales proxy = price of each verified-purchase review. `sales` uses the completed price (observed where Amazon
lists one, otherwise the validated estimate from build_products.py); `sales_obs` uses observed prices only, and
`est_share` is the fraction of `sales` that rests on estimated prices, so nothing is hidden.

Usage: python scripts/etl.py data      (run build_products.py and build_reviews.py first)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

out = Path(sys.argv[1])
m = pd.read_csv(out / "products_master.csv.gz", usecols=["parent_asin", "title", "brand", "price", "price_obs"])
r = pd.read_parquet(out / "reviews_lean.parquet")
r["price"] = m["price"].to_numpy()[r["p"]]
r["price_obs"] = m["price_obs"].to_numpy()[r["p"]]
r["brand"] = m["brand"].to_numpy()[r["p"]]
r["sales"] = np.where(r["ver"] == 1, r["price"], 0.0)
r["sales_obs"] = np.where(r["ver"] == 1, np.nan_to_num(r["price_obs"]), 0.0)
r["month_ts"] = pd.to_datetime({"year": r["month"] // 12, "month": r["month"] % 12 + 1, "day": 1})
r["is_new"] = r["month"] == r.groupby("uid")["month"].transform("min")

g = r.groupby("month_ts")
monthly = pd.DataFrame({
    "orders": g.size(), "sales": g["sales"].sum(), "sales_obs": g["sales_obs"].sum(),
    "avg_rating": g["rating"].mean(), "pct_positive": g["rating"].apply(lambda s: (s >= 4).mean()),
    "pct_negative": g["rating"].apply(lambda s: (s <= 2).mean()),
    "customers": g["uid"].nunique(), "new_customers": g["is_new"].sum(), "verified_share": g["ver"].mean(),
}).reset_index().rename(columns={"month_ts": "month"})
monthly["est_share"] = 1 - monthly["sales_obs"] / monthly["sales"].replace(0, np.nan)
monthly.to_csv(out / "monthly.csv", index=False)

mr = r.groupby(["month_ts", "rating"]).size().rename("n").reset_index().rename(columns={"month_ts": "month"})
mr.to_csv(out / "monthly_rating.csv", index=False)

top = r[r["brand"] != "Unknown"].groupby("brand").size().nlargest(25).index
bm = (r[r["brand"].isin(top)].groupby(["month_ts", "brand"])
      .agg(orders=("rating", "size"), sales=("sales", "sum"), rating_sum=("rating", "sum")).reset_index()
      .rename(columns={"month_ts": "month"}))
bm.to_csv(out / "brand_monthly.csv", index=False)

pg = r.groupby("p").agg(orders=("rating", "size"), sales=("sales", "sum"), avg_rating=("rating", "mean"))
pg = pg[pg["orders"] >= 50].nlargest(2000, "orders")
prod = m.iloc[pg.index][["parent_asin", "title", "brand", "price", "price_obs"]].reset_index(drop=True).join(pg.reset_index(drop=True))
prod["price_estimated"] = prod["price_obs"].isna().astype(int)
prod.drop(columns="price_obs").to_csv(out / "products.csv", index=False)

print(f"reviews={len(r):,} months={len(monthly)} estimated-price share of all sales={1 - monthly['sales_obs'].sum() / monthly['sales'].sum():.1%}")
print(monthly[["orders", "sales", "sales_obs", "est_share"]].tail(3).round(3).to_string())
