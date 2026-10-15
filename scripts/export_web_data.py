"""Export the processed tables to web/data.json for the static site (forecasts live in web/forecast.json).

Usage: python scripts/export_web_data.py   (run from the project root)
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

D = ROOT / "data"


def cols(df, round_to=4):
    """DataFrame -> {column: list}, dates as YYYY-MM strings."""
    out = {}
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_datetime64_any_dtype(s):
            out[c] = s.dt.strftime("%Y-%m").tolist()
        elif pd.api.types.is_float_dtype(s):
            out[c] = [None if pd.isna(v) else round(v, round_to) for v in s]
        else:
            out[c] = s.tolist()
    return out


monthly = pd.read_csv(D / "monthly.csv", parse_dates=["month"])
mrating = pd.read_csv(D / "monthly_rating.csv", parse_dates=["month"])
brand_m = pd.read_csv(D / "brand_monthly.csv", parse_dates=["month"])
products = pd.read_csv(D / "products.csv").head(100)

payload = {
    "monthly": cols(monthly),
    "rating_mix": cols(mrating),
    "brand_monthly": cols(brand_m),
    "products": cols(products),
}
out = ROOT / "web" / "data.json"
out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
