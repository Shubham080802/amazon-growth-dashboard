"""Export the processed tables plus precomputed forecasts to web/data.json for the static site.

Usage: python scripts/export_web_data.py   (run from the project root)
"""
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from forecasting import backtest_mape, forecast  # noqa: E402

D = ROOT / "data"
HORIZON = 24


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

fc = {}
for metric in ["sales", "orders", "avg_rating"]:
    s = monthly.set_index("month")[metric]
    s = s[s.index >= "2012-01-01"].asfreq("MS")
    mean, lo, hi = forecast(s, HORIZON)
    mape, bt = backtest_mape(s)
    fc[metric] = {
        "history": {"month": s.index.strftime("%Y-%m").tolist(), "value": s.round(4).tolist()},
        "forecast": {
            "month": mean.index.strftime("%Y-%m").tolist(),
            "mean": mean.round(4).tolist(),
            "lo": lo.round(4).tolist(),
            "hi": hi.round(4).tolist(),
        },
        "backtest": {"month": bt.index.strftime("%Y-%m").tolist(), "value": bt.round(4).tolist()},
        "mape": round(mape, 4),
    }

payload = {
    "monthly": cols(monthly),
    "rating_mix": cols(mrating),
    "brand_monthly": cols(brand_m),
    "products": cols(products),
    "forecast": fc,
}
out = ROOT / "web" / "data.json"
out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False))
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
