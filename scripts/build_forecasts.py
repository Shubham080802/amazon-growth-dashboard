"""Forecast every segment and write web/forecast.json for the dashboard.

Usage (from project root): python scripts/build_forecasts.py
Needs data/segments_monthly.csv  (python scripts/build_segments.py data_raw data)
"""
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from forecast_engine import H, QS, forecast_series  # noqa: E402

HIST_FROM = "2015-01"          # how much history the dashboard charts
MONITORED = {"total", "brand", "band", "type", "family"}


def _task(args):
    seg, metric, y, last_month, monitor = args
    lo, hi = (1.0, 5.0) if metric == "rating" else (0.0, None)
    return seg, metric, forecast_series(y, last_month, lo=lo, hi=hi, monitor=monitor)


def main():
    df = pd.read_csv(ROOT / "data" / "segments_monthly.csv")
    last_month = df["month"].max()
    months = sorted(df["month"].unique())
    keep = [i for i, m in enumerate(months) if m >= HIST_FROM]

    segs, tasks = {}, []
    for seg, g in df.groupby("segment", sort=False):
        g = g.sort_values("month")
        kind, label = g["kind"].iloc[0], g["label"].iloc[0]
        orders = g["orders"].to_numpy(float)
        sales = g["sales"].to_numpy(float)
        rating = np.where(orders > 0, g["rating_sum"].to_numpy(float) / np.maximum(orders, 1), np.nan)
        rating = pd.Series(rating).ffill().bfill().to_numpy()
        neg = np.where(orders > 0, g["neg"].to_numpy(float) / np.maximum(orders, 1), np.nan)
        segs[seg] = {
            "id": seg, "kind": kind, "label": label, "series": {},
            "hist": {
                "orders": [int(orders[i]) for i in keep],
                "sales": [round(float(sales[i]), 2) for i in keep],
                "rating": [None if np.isnan(rating[i]) or orders[i] == 0 else round(float(rating[i]), 3) for i in keep],
                "neg": [None if np.isnan(neg[i]) else round(float(neg[i]), 4) for i in keep],
            },
        }
        mon = kind in MONITORED
        tasks.append((seg, "orders", orders, last_month, mon))
        if sales[-12:].sum() > 0:
            tasks.append((seg, "sales", sales, last_month, mon))
        if kind != "product":                       # product ratings are too noisy to forecast
            tasks.append((seg, "rating", rating, last_month, kind == "total"))

    print(f"{len(segs)} segments, {len(tasks)} series to forecast ...", flush=True)
    with ProcessPoolExecutor(max_workers=8) as ex:
        for seg, metric, res in ex.map(_task, tasks, chunksize=2):
            if res is not None:
                segs[seg]["series"][metric] = res

    out = {
        "meta": {"last_month": last_month, "hist_from": HIST_FROM, "horizon": H,
                 "quantiles": QS.tolist(), "built": date.today().isoformat()},
        "segments": [s for s in segs.values() if s["series"]],
    }
    path = ROOT / "web" / "forecast.json"
    new_text = json.dumps(out, separators=(",", ":"), allow_nan=False)
    if path.exists():                                   # keep the previous build so the dashboard can show what changed
        old_doc = json.loads(path.read_text())
        a, b = json.loads(new_text), dict(old_doc)
        for d in (a, b):
            d["meta"] = {k: v for k, v in d["meta"].items() if k != "built"}
        if a != b:                                      # an identical rebuild must not overwrite the snapshot
            (ROOT / "web" / "forecast_prev.json").write_text(path.read_text())
    path.write_text(new_text)
    n = sum(len(s["series"]) for s in out["segments"])
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB): {len(out['segments'])} segments, {n} forecasts")


if __name__ == "__main__":
    main()
