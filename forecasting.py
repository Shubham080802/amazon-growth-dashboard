"""Forecasting helpers shared by the Streamlit app and the static web export."""
import numpy as np
from statsmodels.tsa.holtwinters import ExponentialSmoothing


def forecast(series, horizon, seasonal=True):
    """Holt-Winters with damped trend; intervals from in-sample residuals."""
    kw = dict(trend="add", damped_trend=True)
    if seasonal and len(series) >= 36:
        kw.update(seasonal="add", seasonal_periods=12)
    fit = ExponentialSmoothing(series, **kw).fit()
    mean = fit.forecast(horizon)
    sd = np.std(fit.resid, ddof=1)
    band = 1.96 * sd * np.sqrt(np.arange(1, horizon + 1))
    return mean.clip(lower=0), (mean - band).clip(lower=0), mean + band


def backtest_mape(series, months=12):
    """Train on all but the last `months`, compare with what actually happened."""
    train, test = series.iloc[:-months], series.iloc[-months:]
    pred, _, _ = forecast(train, months)
    return float(np.mean(np.abs((test.values - pred.values) / test.values))), pred
