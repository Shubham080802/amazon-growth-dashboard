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

def make_specs(season):
    return {
        "Trend + seasonality": dict(trend="add", damped_trend=True, seasonal="add", seasonal_periods=season),
        "Seasonality only": dict(seasonal="add", seasonal_periods=season),
        "Damped trend": dict(trend="add", damped_trend=True),
        "Level only": dict(),
    }


SPECS = make_specs(12)


def _fit(y, spec):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return ExponentialSmoothing(np.asarray(y, float), initialization_method="estimated", **spec).fit()


def _sims(fit, steps, reps, seed):
    """Simulated future paths. The bootstrap shocks are drawn here with a fixed seed because
    statsmodels' own bootstrap ignores random_state, which made results change from run to run."""
    rng = np.random.default_rng(seed)
    shocks = rng.choice(np.asarray(fit.resid, float), size=(steps, reps), replace=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        s = fit.simulate(steps, repetitions=reps, error="add", random_errors=shocks, anchor="end")
    return np.asarray(s).reshape(steps, reps)


def _tf(y, log):
    return np.log1p(y) if log else np.asarray(y, float)


def _inv(y, log, lo, hi):
    out = np.expm1(y) if log else np.asarray(y, float)
    return np.clip(out, lo, hi if hi is not None else np.inf)


def _score(y, spec, log, lo, hi, origins=ORIGINS, season=12):
    """Rolling-origin backtest: returns (wMAPE, bias, list of (k, forecast_t, actual, actual_t))."""
    runs, errs, biases = [], [], []
    for k in origins:
        n_tr = len(y) - k
        if n_tr < 2 * season + 6:
            continue
        h = min(season, k)
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


def seasonal_index(y, start, season=12, step=1):
    """Ratio-to-moving-average seasonal index by calendar month (mean = 1)."""
    n = min(6 * season, len(y))
    s = pd.Series(np.asarray(y, float)[-n:], index=pd.date_range(end=start, periods=n, freq=f"{step}MS"))
    cma = s.rolling(season).mean().rolling(2).mean().shift(-(season // 2))
    ratio = (s / cma).dropna()
    if len(ratio) < season:
        return None
    pos = (ratio.index.month - 1) // step
    idx = ratio.groupby(pos).mean().reindex(range(season))
    if idx.isna().any():
        return None
    return (idx / idx.mean()).round(4).tolist()


def forecast_series(y, last_month, lo=0.0, hi=None, monitor=False, log=None,
                    season=12, step=1, horizon=H, origins=ORIGINS, min_history=MIN_HISTORY, monitor_n=12):
    """y: monthly values (oldest first) ending at last_month ('YYYY-MM'). Returns a JSON-ready dict or None."""
    y = np.asarray(y, float)
    nz = np.nonzero(y)[0]
    if len(nz) == 0:
        return None
    y = y[nz[0]:]                                   # drop leading zeros before the series began
    if len(y) < min_history:
        return None
    specs = make_specs(season)
    log = (lo == 0.0) if log is None else log       # volumes on a log scale; ratings (1-5) stay linear

    # 1. pick the model that forecasts best out of sample
    best = None
    for name, spec in specs.items():
        wm, bias, runs = _score(y, spec, log, lo, hi, origins, season)
        if best is None or wm < best[1] - 0.005:    # prefer the earlier (richer) spec unless clearly beaten
            best = (name, wm, bias, runs, spec)
    name, wmape, bias, runs, spec = best
    if not np.isfinite(wmape):
        return None

    # 2. calibrate and simulate (in model space, then transform back)
    s, coverage = _calibration(y, spec, runs, log)
    fit = _fit(_tf(y, log), spec)
    center = fit.forecast(horizon)
    sims = _sims(fit, horizon, REPS, 11)
    sims = _inv(center[:, None] + s * (sims - sims.mean(axis=1, keepdims=True)), log, lo, hi)
    lo_c, hi_c = np.quantile(sims, [0.01, 0.99], axis=1)        # trimmed mean: a few extreme paths must not move the headline
    mean_path = np.clip(sims, lo_c[:, None], hi_c[:, None]).mean(axis=1)

    q = lambda p: np.quantile(sims, p, axis=1)
    cumq = np.quantile(np.cumsum(sims, axis=0), QS, axis=1).T      # (H, 19)

    # most recent backtest (forecast from 12 months before the end), for the dotted overlay
    last = next((r for r in runs if r[0] == season), runs[-1])
    months = pd.date_range(pd.Timestamp(last_month + "-01") + pd.DateOffset(months=step), periods=horizon, freq=f"{step}MS")

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
        "seasonal": seasonal_index(y, pd.Timestamp(last_month + "-01"), season, step),
    }

    # 3. monitoring: one-step-ahead expectation for each of the last 12 months
    if monitor:
        mon = []
        for i in range(monitor_n):
            origin = len(y) - monitor_n + i
            f = _fit(_tf(y[:origin], log), spec)
            e = float(f.forecast(1)[0])
            sm = _sims(f, 1, 300, 5)[0]
            sm = _inv(e + s * (sm - sm.mean()), log, lo, hi)
            mon.append({
                "month": (pd.Timestamp(last_month + "-01") - pd.DateOffset(months=step * (monitor_n - 1 - i))).strftime("%Y-%m"),
                "actual": round(float(y[origin]), 3), "expected": round(float(sm.mean()), 3),
                "lo": round(float(np.quantile(sm, 0.10)), 3), "hi": round(float(np.quantile(sm, 0.90)), 3),
            })
        out["monitor"] = mon
    return out
