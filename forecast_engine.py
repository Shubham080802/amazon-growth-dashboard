"""Planning-grade forecasts for one monthly series.

What an analytics team would want from a forecast, beyond a single line:
  1. Model selection by rolling-origin backtest (not by how well it fits the past).
  2. A probability distribution, not just a point: simulated future paths.
  3. Intervals calibrated against how wrong the model really was in backtests.
  4. Honest accuracy numbers (error, bias, interval coverage) shown next to the forecast.
  5. A monitoring series: what the model expected each recent month vs what happened.
  6. The seasonal pattern, so plans can be shaped around peaks and troughs.
  7. Volume series are modelled on a log scale, so uncertainty is proportional to the level
     (a 10% miss means the same for a small brand and for the whole category).
"""
import warnings

import numpy as np
import pandas as pd
from statsmodels.tsa.holtwinters import ExponentialSmoothing

H = 24                                            # months forecast
QS = np.round(np.arange(0.05, 0.951, 0.05), 2)    # quantiles stored for cumulative totals (19 points)
MIN_HISTORY = 36                                  # months of data needed to forecast a series
ORIGINS = (24, 18, 12)                            # backtest: forecast from 24 / 18 / 12 months before the end
REPS = 1000                                       # simulated paths
Z80 = 1.2816                                      # z for a two-sided 80% interval

SPECS = {
    "Trend + seasonality": dict(trend="add", damped_trend=True, seasonal="add", seasonal_periods=12),
    "Seasonality only": dict(seasonal="add", seasonal_periods=12),
    "Damped trend": dict(trend="add", damped_trend=True),
    "Level only": dict(),
}


def _fit(y, spec):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return ExponentialSmoothing(np.asarray(y, float), initialization_method="estimated", **spec).fit()


def _sims(fit, steps, reps, seed):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        s = fit.simulate(steps, repetitions=reps, error="add", random_errors="bootstrap",
                         random_state=seed, anchor="end")
    return np.asarray(s).reshape(steps, reps)


def _tf(y, log):
    return np.log1p(y) if log else np.asarray(y, float)


def _inv(y, log, lo, hi):
    out = np.expm1(y) if log else np.asarray(y, float)
    return np.clip(out, lo, hi if hi is not None else np.inf)


def _score(y, spec, log, lo, hi):
    """Rolling-origin backtest: returns (wMAPE, bias, list of (k, forecast_t, actual, actual_t))."""
    runs, errs, biases = [], [], []
    for k in ORIGINS:
        n_tr = len(y) - k
        if n_tr < 30:
            continue
        h = min(12, k)
        ft = _fit(_tf(y[:n_tr], log), spec).forecast(h)
        f = _inv(ft, log, lo, hi)
        a = y[n_tr:n_tr + h]
        if a.sum() <= 0:
            continue
        runs.append((k, ft, a, _tf(a, log)))
        errs.append(np.abs(a - f).sum() / a.sum())
        biases.append((f - a).sum() / a.sum())
    if not runs:
        return np.inf, 0.0, []
    return float(np.mean(errs)), float(np.mean(biases)), runs


def _calibration(y, spec, runs, log):
    """Scale factor so the simulated 80% interval covers ~80% of backtest outcomes (in model space)."""
    zs = []
    for k, ft, a, at in runs:
        n_tr = len(y) - k
        sim = _sims(_fit(_tf(y[:n_tr], log), spec), len(ft), 300, 7)
        sd = sim.std(axis=1, ddof=1)
        sd[sd == 0] = np.nan
        zs.extend(((at - ft) / sd)[~np.isnan(sd)])
    if not zs:
        return 1.0, np.nan
    z = np.abs(np.array(zs))
    s = float(np.clip(np.quantile(z, 0.8) / Z80, 0.6, 3.0))
    return s, float(np.mean(z <= Z80 * s))


def seasonal_index(y, start):
    """Ratio-to-moving-average seasonal index by calendar month (mean = 1)."""
    s = pd.Series(np.asarray(y, float)[-72:], index=pd.date_range(end=start, periods=min(72, len(y)), freq="MS"))
    cma = s.rolling(12).mean().rolling(2).mean().shift(-6)
    ratio = (s / cma).dropna()
    if len(ratio) < 12:
        return None
    idx = ratio.groupby(ratio.index.month).mean().reindex(range(1, 13))
    if idx.isna().any():
        return None
    return (idx / idx.mean()).round(4).tolist()


def forecast_series(y, last_month, lo=0.0, hi=None, monitor=False, log=None):
    """y: monthly values (oldest first) ending at last_month ('YYYY-MM'). Returns a JSON-ready dict or None."""
    y = np.asarray(y, float)
    nz = np.nonzero(y)[0]
    if len(nz) == 0:
        return None
    y = y[nz[0]:]                                   # drop leading zeros before the series began
    if len(y) < MIN_HISTORY:
        return None
    log = (lo == 0.0) if log is None else log       # volumes on a log scale; ratings (1-5) stay linear

    # 1. pick the model that forecasts best out of sample
    best = None
    for name, spec in SPECS.items():
        wm, bias, runs = _score(y, spec, log, lo, hi)
        if best is None or wm < best[1] - 0.005:    # prefer the earlier (richer) spec unless clearly beaten
            best = (name, wm, bias, runs, spec)
    name, wmape, bias, runs, spec = best
    if not np.isfinite(wmape):
        return None

    # 2. calibrate and simulate (in model space, then transform back)
    s, coverage = _calibration(y, spec, runs, log)
    fit = _fit(_tf(y, log), spec)
    center = fit.forecast(H)
    sims = _sims(fit, H, REPS, 11)
    sims = _inv(center[:, None] + s * (sims - sims.mean(axis=1, keepdims=True)), log, lo, hi)
    mean_path = sims.mean(axis=1)

    q = lambda p: np.quantile(sims, p, axis=1)
    cumq = np.quantile(np.cumsum(sims, axis=0), QS, axis=1).T      # (H, 19)

    # most recent backtest (forecast from 12 months before the end), for the dotted overlay
    last = next((r for r in runs if r[0] == 12), runs[-1])
    months = pd.date_range(pd.Timestamp(last_month + "-01") + pd.DateOffset(months=1), periods=H, freq="MS")

    out = {
        "model": name, "wmape": round(wmape, 4), "bias": round(bias, 4),
        "coverage80": None if np.isnan(coverage) else round(coverage, 3), "calib": round(s, 2),
        "fc": {
            "month": months.strftime("%Y-%m").tolist(),
            "mean": np.round(mean_path, 3).tolist(),
            "p05": np.round(q(0.05), 3).tolist(), "p10": np.round(q(0.10), 3).tolist(),
            "p90": np.round(q(0.90), 3).tolist(), "p95": np.round(q(0.95), 3).tolist(),
        },
        "cumq": np.round(cumq, 2).tolist(),
        "backtest": {"k": last[0], "mean": np.round(_inv(last[1], log, lo, hi), 3).tolist()},
        "seasonal": seasonal_index(y, pd.Timestamp(last_month + "-01")),
    }

    # 3. monitoring: one-step-ahead expectation for each of the last 12 months
    if monitor:
        mon = []
        for i in range(12):
            origin = len(y) - 12 + i
            f = _fit(_tf(y[:origin], log), spec)
            e = float(f.forecast(1)[0])
            sm = _sims(f, 1, 300, 5)[0]
            sm = _inv(e + s * (sm - sm.mean()), log, lo, hi)
            mon.append({
                "month": (pd.Timestamp(last_month + "-01") - pd.DateOffset(months=11 - i)).strftime("%Y-%m"),
                "actual": round(float(y[origin]), 3), "expected": round(float(sm.mean()), 3),
                "lo": round(float(np.quantile(sm, 0.10)), 3), "hi": round(float(np.quantile(sm, 0.90)), 3),
            })
        out["monitor"] = mon
    return out
