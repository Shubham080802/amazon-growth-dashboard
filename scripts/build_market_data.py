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
    ("HOUST", "Housing starts", "M", "thousands of units, annual rate", "U.S. Census Bureau"),
    ("UMCSENT", "Consumer sentiment", "M", "index, 1966 Q1 = 100", "University of Michigan"),
    ("PCEDG", "Consumer spending on durable goods", "M", "$ billions, annual rate", "Bureau of Economic Analysis"),
    ("IPG3352S", "Household appliance production", "M", "index, 2017 = 100", "Federal Reserve Board"),
    ("CUSR0000SAD", "Consumer prices: durable goods", "M", "index, 1982-84 = 100", "Bureau of Labor Statistics"),
    ("MORTGAGE30US", "30-year mortgage rate (monthly average)", "M", "percent", "Freddie Mac"),
    ("DSPIC96", "Real disposable personal income", "M", "$ billions, chained 2017", "Bureau of Economic Analysis"),
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
    """Quarterly values with gaps filled by accounting identities, never by estimation:
         Q1 = 3-month figure; Q2 = 6-month YTD - Q1; Q3 = 9-month YTD - 6-month YTD; Q4 = full year - 9-month YTD.
       Returns ({quarter_end: value}, {quarter_end: how it was derived}) so every filled value is traceable."""
    dur = {"q": {}, "h1": {}, "m9": {}, "fy": {}}
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
            kind = "q" if 80 <= days <= 100 else "h1" if 170 <= days <= 195 else "m9" if 260 <= days <= 285 else "fy" if 350 <= days <= 380 else None
            if kind:
                dur[kind].setdefault(e, r["val"])
    q, how = dict(dur["q"]), {e: "reported" for e in dur["q"]}
    for y in sorted({e[:4] for e in list(dur["h1"]) + list(dur["m9"]) + list(dur["fy"]) + list(q)}):
        e1, e2, e3, e4 = (f"{y}-{m}" for m in ("03-31", "06-30", "09-30", "12-31"))
        get = lambda e: q.get(e)
        if get(e2) is None and e2 in dur["h1"] and get(e1) is not None:
            q[e2], how[e2] = dur["h1"][e2] - get(e1), "derived: 6-month total minus Q1"
        if get(e3) is None and e3 in dur["m9"] and e2 in dur["h1"]:
            q[e3], how[e3] = dur["m9"][e3] - dur["h1"][e2], "derived: 9-month total minus 6-month total"
        if get(e4) is None and e4 in dur["fy"]:
            if e3 in dur["m9"]:
                q[e4], how[e4] = dur["fy"][e4] - dur["m9"][e3], "derived: full year minus 9-month total"
            elif all(get(e) is not None for e in (e1, e2, e3)):
                q[e4], how[e4] = dur["fy"][e4] - sum(get(e) for e in (e1, e2, e3)), "derived: full year minus Q1-Q3"
    return q, how


def amazon_quarterly():
    try:
        raw = json.loads(get(SEC_URL, {"User-Agent": SEC_UA}))
        facts = raw["facts"]["us-gaap"]
        table, derived = {}, {}
        for name, tags in TAGS.items():
            vals, how = quarterly_from_facts(facts, tags)
            for end, v in vals.items():
                m = int(end[5:7]); key = f"{end[:4]}-{m - 2:02d}"
                table.setdefault(key, {})[name] = v / 1e6          # $ millions
                if how[end] != "reported":
                    derived.setdefault(key, {})[name] = how[end]
        df = pd.DataFrame(table).T.sort_index()
        df.index.name = "quarter"
        df.to_csv(EXT / "amazon_quarterly.csv")
        (EXT / "amazon_quarterly_derived.json").write_text(json.dumps(derived, indent=1, sort_keys=True))
        print("SEC: fetched", len(df), "quarters, latest", df.index[-1], "| values filled by accounting identities:", sum(len(v) for v in derived.values()))
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
        if len(s) > 1 and (s.index[1] - s.index[0]).days < 20:      # weekly series (mortgage rate) -> monthly average
            s = s.resample("MS").mean().dropna()
        s = s[s.index >= START + "-01"]
        out[sid] = {"label": label, "freq": freq, "unit": unit, "publisher": publisher,
                    "dates": s.index.strftime("%Y-%m").tolist(), "values": [round(float(v), 3) for v in s.values]}
        print(f"FRED {sid}: {len(s)} obs, latest {out[sid]['dates'][-1]}")
    return out


BRIDGE_IDS = ("RSNSR", "RSEAS", "RRSFS", "PCU3352233522", "HOUST", "UMCSENT", "PCEDG", "IPG3352S",
              "CUSR0000SAD", "MORTGAGE30US", "DSPIC96")


def bridge_test(fred):
    """Can a public indicator stand in for the category data we are missing (Apr 2023 onward)?
    Deliberately strict, because the honest alternative is to say we do not know:
      * non-overlapping calendar years (2013-2022, n = 10), not overlapping 12-month windows
      * leave-one-year-out error compared with a naive average-growth guess
      * robustness: survives dropping the launch-phase year 2013 and removing the maturing trend
      * Bonferroni correction for the number of indicators tested
      * a real out-of-sample check: Jan-Mar 2023 is observed in the category data but was not used to fit, so the
        model's implied growth for Q1 2023 (vs Q1 2022) must land within 0.15 (log points) of what actually happened
    Verdict 'Yes' needs all of them; 'Suggestive' needs a significant raw correlation only."""
    from scipy import stats
    cat = pd.read_csv(ROOT / "data" / "monthly.csv", parse_dates=["month"]).set_index("month")
    cat = cat[(cat.index >= "2012-01-01") & (cat.index < "2023-01-01")]
    allcat = pd.read_csv(ROOT / "data" / "monthly.csv", parse_dates=["month"]).set_index("month")["sales"]
    q1 = lambda s, y: s[f"{y}-01-01":f"{y}-03-01"]
    actual_q1 = float(np.log(q1(allcat, 2023).sum() / q1(allcat, 2022).sum()))                       # observed Q1 2023 vs Q1 2022
    gy = np.log(cat["sales"].groupby(cat.index.year).sum()).diff().dropna()          # 2013..2022
    alpha = 0.05 / len(BRIDGE_IDS)
    rows = []
    for sid in BRIDGE_IDS:
        s = pd.Series(fred[sid]["values"], index=pd.to_datetime([d + "-01" for d in fred[sid]["dates"]]))
        s = s[(s.index >= "2012-01-01") & (s.index < "2023-01-01")]
        ym = s.groupby(s.index.year).mean()
        gx = np.log(ym).diff().dropna() if (ym > 0).all() else ym.diff().dropna()
        d = pd.concat([gy, gx], axis=1, keys=["y", "x"]).dropna()
        r, p = stats.pearsonr(d["y"], d["x"])
        ex = d.drop(2013, errors="ignore")
        r_ex, p_ex = stats.pearsonr(ex["y"], ex["x"])
        t_ = np.arange(len(d)); resid = d["y"] - np.polyval(np.polyfit(t_, d["y"], 1), t_)
        r_dt, p_dt = stats.pearsonr(resid, d["x"])
        err, naive = [], []
        for yr in d.index:
            tr = d.drop(yr); b = np.polyfit(tr["x"], tr["y"], 1)
            err.append(abs(d["y"][yr] - np.polyval(b, d["x"][yr]))); naive.append(abs(d["y"][yr] - tr["y"].mean()))
        loo, nv = float(np.mean(err)), float(np.mean(naive))
        sfull = pd.Series(fred[sid]["values"], index=pd.to_datetime([d_ + "-01" for d_ in fred[sid]["dates"]]))
        a_, b_ = q1(sfull, 2023).mean(), q1(sfull, 2022).mean()
        x_q1 = float(np.log(a_ / b_)) if a_ > 0 and b_ > 0 else float(a_ - b_)
        pred_q1 = float(np.polyval(np.polyfit(d["x"], d["y"], 1), x_q1))
        holdout_ok = abs(pred_q1 - actual_q1) <= 0.15
        yes = p < alpha and p_ex < 0.05 and p_dt < 0.05 and loo < 0.7 * nv and holdout_ok
        verdict = "Yes" if yes else "Suggestive" if (p < 0.05 and r > 0) else "No"
        rows.append({"id": sid, "label": fred[sid]["label"], "n": int(len(d)), "r": round(float(r), 2), "p": round(float(p), 3),
                     "r_ex": round(float(r_ex), 2), "p_dt": round(float(p_dt), 3), "loo": round(loo, 3), "naive": round(nv, 3),
                     "q1_pred": round(pred_q1, 2), "q1_actual": round(actual_q1, 2), "verdict": verdict})
    return {"alpha": round(alpha, 4), "q1_actual": round(actual_q1, 3), "rows": rows}


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
    mix = json.loads((EXT / "amazon_quarterly_detail.json").read_text())
    recon = []
    for k, v in mix["quarters"].items():
        grp, seg_sum = sum(v["groups"].values()), sum(x["sales"] for x in v["segments"].values())
        oi = sum(x["opinc"] for x in v["segments"].values())
        sec_rev, sec_oi = float(q.loc[k, "revenue"]), float(q.loc[k, "operating_income"])
        recon.append({"q": k, "groups_vs_sec": round(grp - sec_rev, 3), "segments_vs_sec": round(seg_sum - sec_rev, 3), "opinc_vs_sec": round(oi - sec_oi, 3)})
        if abs(grp - sec_rev) > 1 or abs(seg_sum - sec_rev) > 1 or abs(oi - sec_oi) > 1:
            raise SystemExit(f"Revenue mix for {k} does not reconcile to the SEC filing: {recon[-1]}")
    out = {
        "meta": {"built": dt.date.today().isoformat(), "amazon_latest_quarter": last_q,
                 "sec_url": SEC_URL, "release_url": rel["source"]},
        "amazon": {
            "quarters": [{"q": i, **{k: (None if pd.isna(v) else round(float(v), 1)) for k, v in r.items()}} for i, r in q.iterrows()],
            "forecast": fc, "release": rel, "guidance_check": guidance_check,
            "mix": {"quarters": mix["quarters"], "sources": mix["sources"], "reconciliation": recon},
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
