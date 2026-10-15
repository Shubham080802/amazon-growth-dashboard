"""Fetch current public data and write web/market.json.

Sources (all free, official, no login):
  * SEC EDGAR "company facts" for Amazon (CIK 1018724): quarterly revenue, operating income, net income,
    operating cash flow and capital spending, straight from Amazon's 10-Q / 10-K filings.
  * FRED (St. Louis Fed) series that republish U.S. Census Bureau and Bureau of Labor Statistics data:
    e-commerce sales, online/nonstore retail, appliance-store sales, appliance producer prices.
  * data/external/amazon_q2_2026_release.json: segment results and Q3 guidance, transcribed from Amazon's
    own Q2 2026 earnings release (the SEC "facts" feed does not carry segment detail).

Also forecasts Amazon's quarterly revenue with the same backtested engine used for the category data.

Usage (project root):  python scripts/build_market_data.py
Network is only needed to refresh; fetched series are cached as small CSVs in data/external/.
"""
import datetime as dt
import io
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from forecast_engine import forecast_series  # noqa: E402

EXT = ROOT / "data" / "external"
EXT.mkdir(parents=True, exist_ok=True)
SEC_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK0001018724.json"
SEC_UA = "amazon-growth-dashboard personal-research-project"     # SEC asks for a descriptive User-Agent
START = "2012-01"

FRED = [  # id, label, frequency, unit, who publishes it
    ("ECOMSA", "U.S. e-commerce retail sales", "Q", "$ millions, seasonally adjusted", "U.S. Census Bureau"),
    ("ECOMPCTSA", "E-commerce share of total retail sales", "Q", "percent, seasonally adjusted", "U.S. Census Bureau"),
    ("RSNSR", "Online and mail-order (nonstore) retail sales", "M", "$ millions, seasonally adjusted", "U.S. Census Bureau"),
    ("RSEAS", "Electronics and appliance store sales", "M", "$ millions, seasonally adjusted", "U.S. Census Bureau"),
    ("RRSFS", "Total retail and food services sales", "M", "$ millions, seasonally adjusted", "U.S. Census Bureau"),
    ("PCU3352233522", "Producer prices: major household appliance manufacturing", "M", "index, Dec 2003 = 100", "Bureau of Labor Statistics"),
    ("PCU449210449210A3", "Producer prices: retailing of major household appliances", "M", "index, May 2019 = 100", "Bureau of Labor Statistics"),
]


def get(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    return urllib.request.urlopen(req, timeout=60).read()


# ---------------------------------------------------------------- SEC: Amazon quarterly financials
TAGS = {
    "revenue": ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"],
    "operating_income": ["OperatingIncomeLoss"],
    "net_income": ["NetIncomeLoss"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquireProductiveAssets", "PaymentsToAcquirePropertyPlantAndEquipment"],
}


def quarterly_from_facts(facts, tags):
    """Quarterly values; Q4 is derived as full year minus Q1-Q3 because 10-Ks report only the year."""
    q, a = {}, {}
    for tag in tags:                                     # earlier tags win; later ones fill older history
        rows = facts.get(tag, {}).get("units", {}).get("USD", [])
        best = {}
        for r in rows:
            if "start" not in r:
                continue
            k = (r["start"], r["end"])
            if k not in best or r["filed"] > best[k]["filed"]:
                best[k] = r
        for (s, e), r in best.items():
            days = (dt.date.fromisoformat(e) - dt.date.fromisoformat(s)).days
            if 80 <= days <= 100:
                q.setdefault(e, r["val"])
            elif 350 <= days <= 380:
                a.setdefault(e, r["val"])
    for e, v in list(a.items()):
        y = e[:4]
        parts = [q.get(f"{y}-{m}") for m in ("03-31", "06-30", "09-30")]
        if e.endswith("12-31") and e not in q and all(p is not None for p in parts):
            q[e] = v - sum(parts)
    return q


def amazon_quarterly():
    try:
        raw = json.loads(get(SEC_URL, {"User-Agent": SEC_UA}))
        facts = raw["facts"]["us-gaap"]
        table = {}
        for name, tags in TAGS.items():
            for end, v in quarterly_from_facts(facts, tags).items():
                m = int(end[5:7])
                table.setdefault(f"{end[:4]}-{m - 2:02d}", {})[name] = v / 1e6          # $ millions
        df = pd.DataFrame(table).T.sort_index()
        df.index.name = "quarter"
        df.to_csv(EXT / "amazon_quarterly.csv")
        print("SEC: fetched", len(df), "quarters, latest", df.index[-1])
    except Exception as e:                                                              # offline: use the cache
        print("SEC fetch failed, using cached CSV:", e)
        df = pd.read_csv(EXT / "amazon_quarterly.csv", index_col=0)
    return df[df.index >= START].dropna(subset=["revenue"])


def fred_series():
    out = {}
    for sid, label, freq, unit, publisher in FRED:
        path = EXT / f"fred_{sid}.csv"
        try:
            txt = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}").decode()
            if not txt.startswith("observation_date"):
                raise ValueError("unexpected response")
            path.write_text(txt)
        except Exception as e:
            print(f"FRED {sid} fetch failed, using cache:", e)
            txt = path.read_text()
        s = pd.read_csv(io.StringIO(txt), parse_dates=[0], index_col=0).iloc[:, 0]
        s = pd.to_numeric(s, errors="coerce").dropna()
        s = s[s.index >= START + "-01"]
        out[sid] = {"label": label, "freq": freq, "unit": unit, "publisher": publisher,
                    "dates": s.index.strftime("%Y-%m").tolist(), "values": [round(float(v), 3) for v in s.values]}
        print(f"FRED {sid}: {len(s)} obs, latest {out[sid]['dates'][-1]}")
    return out


def bridge_test(fred):
    """Can public market indicators stand in for the category data we are missing (Apr 2023 onward)?
    Test on the years we do have: does 12-month growth in each indicator track 12-month growth in the
    category, and does a model built on it beat a naive guess out of sample (fit to 2020, test 2021-Mar 2023)?"""
    cat = pd.read_csv(ROOT / "data" / "monthly.csv", parse_dates=["month"]).set_index("month")
    cat = cat[cat.index >= "2012-01-01"]
    rows = []
    for sid in ("RSNSR", "RSEAS", "RRSFS", "PCU3352233522"):
        s = pd.Series(fred[sid]["values"], index=pd.to_datetime([d + "-01" for d in fred[sid]["dates"]]))
        df = pd.DataFrame({"y": cat["sales"], "x": s}).dropna()
        g = np.log(df.rolling(12).mean().dropna()).diff(12).dropna()
        tr, te = g[g.index <= "2020-12-01"], g[g.index > "2020-12-01"]
        b = np.polyfit(tr["x"], tr["y"], 1)
        rows.append({"id": sid, "label": fred[sid]["label"], "corr": round(float(g["y"].corr(g["x"])), 3),
                     "mae_model": round(float(np.mean(np.abs(te["y"] - np.polyval(b, te["x"])))), 3),
                     "mae_naive": round(float(np.mean(np.abs(te["y"] - tr["y"].mean()))), 3)})
    return rows


def main():
    q = amazon_quarterly()
    fred = fred_series()
    rel = json.loads((EXT / "amazon_q2_2026_release.json").read_text())

    # Same engine as the category forecasts, on a quarterly clock (season length 4, 3 months per step)
    last_q = q.index[-1]
    fc = forecast_series(q["revenue"].to_numpy(float), last_q, season=4, step=3, horizon=8, origins=(8, 6, 4),
                         min_history=24, monitor=True, monitor_n=8)
    g = rel["guidance"]
    first = fc["fc"]
    guidance_check = {
        "quarter": g["quarter"], "guidance_lo": g["sales_lo"], "guidance_hi": g["sales_hi"],
        "model_mean": first["mean"][0], "model_p10": first["p10"][0], "model_p90": first["p90"][0],
    }
    out = {
        "meta": {"built": dt.date.today().isoformat(), "amazon_latest_quarter": last_q,
                 "sec_url": SEC_URL, "release_url": rel["source"]},
        "amazon": {
            "quarters": [{"q": i, **{k: (None if pd.isna(v) else round(float(v), 1)) for k, v in r.items()}} for i, r in q.iterrows()],
            "forecast": fc, "release": rel, "guidance_check": guidance_check,
        },
        "fred": fred,
        "bridge_test": bridge_test(fred),
    }
    path = ROOT / "web" / "market.json"
    path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    print(f"wrote {path} ({path.stat().st_size / 1024:.0f} KB)")
    print("Amazon revenue model:", fc["model"], "wMAPE", fc["wmape"], "| next quarter model",
          round(first["mean"][0]), f"({round(first['p10'][0])}-{round(first['p90'][0])})", "vs guidance", g["sales_lo"], "-", g["sales_hi"])


if __name__ == "__main__":
    main()
