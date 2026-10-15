"""Amazon Appliances growth dashboard (Streamlit + Plotly).

Run:  streamlit run app.py
"""
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from statsmodels.tsa.holtwinters import ExponentialSmoothing

DATA = Path(__file__).parent / "data"
BLUE, GREEN, RED, AMBER, GREY = "#2a6fdb", "#1f9d6b", "#d64545", "#e0a526", "#8a94a6"

st.set_page_config(page_title="Amazon Appliances Growth Dashboard", layout="wide")


@st.cache_data
def load():
    m = pd.read_csv(DATA / "monthly.csv", parse_dates=["month"])
    mr = pd.read_csv(DATA / "monthly_rating.csv", parse_dates=["month"])
    bm = pd.read_csv(DATA / "brand_monthly.csv", parse_dates=["month"])
    pr = pd.read_csv(DATA / "products.csv")
    return m, mr, bm, pr


def layout(fig, title, h=360):
    fig.update_layout(
        title=title, height=h, margin=dict(l=10, r=10, t=50, b=10),
        legend=dict(orientation="h", y=-0.15), hovermode="x unified",
    )
    return fig


def yoy(df, col, how="sum"):
    """Latest 12 months vs the previous 12 months."""
    agg = (lambda s: s.sum()) if how == "sum" else (lambda s: s.mean())
    cur, prev = agg(df[col].iloc[-12:]), agg(df[col].iloc[-24:-12])
    return cur, (cur / prev - 1) if prev else np.nan


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


monthly, mrating, brand_m, products = load()

# ---------------------------------------------------------------- sidebar
st.sidebar.title("Filters")
years = sorted(monthly["month"].dt.year.unique())
start_year, end_year = st.sidebar.select_slider(
    "Year range", options=years, value=(2012, years[-1])
)
f = monthly[(monthly.month.dt.year >= start_year) & (monthly.month.dt.year <= end_year)].copy()
st.sidebar.caption(
    "Data: Amazon Reviews 2023 (McAuley Lab), Appliances category, 2.1M reviews. "
    "**Sales is a proxy**: list price of each verified-purchase review, "
    "so it is a lower bound on true revenue. Months after Mar 2023 are excluded "
    "because the dataset's collection is incomplete there."
)

st.title("Amazon Appliances: Growth Analysis")
st.caption(f"{len(monthly):,} months of history · {int(monthly.orders.sum()):,} reviews · "
           f"{start_year}-{end_year} selected")

# ---------------------------------------------------------------- KPIs
sales_v, sales_g = yoy(f, "sales")
ord_v, ord_g = yoy(f, "orders")
rat_v, rat_g = yoy(f, "avg_rating", "mean")
new_v, new_g = yoy(f, "new_customers")
pos_v, pos_g = yoy(f, "pct_positive", "mean")

c = st.columns(5)
c[0].metric("Sales proxy (last 12 mo)", f"${sales_v/1e6:,.2f}M", f"{sales_g:+.1%} YoY")
c[1].metric("Orders (last 12 mo)", f"{ord_v:,.0f}", f"{ord_g:+.1%} YoY")
c[2].metric("Avg rating", f"{rat_v:.2f} / 5", f"{rat_g*rat_v:+.2f} YoY")
c[3].metric("New customers", f"{new_v:,.0f}", f"{new_g:+.1%} YoY")
c[4].metric("Positive reviews (4-5★)", f"{pos_v:.1%}", f"{(pos_v - f.pct_positive.iloc[-24:-12].mean())*100:+.1f} pts YoY")

tab_over, tab_sales, tab_sat, tab_cust, tab_fc, tab_prod = st.tabs(
    ["Overview", "Sales", "Customer satisfaction", "Customers", "Forecast", "Brands & products"]
)

# ---------------------------------------------------------------- overview
with tab_over:
    f["sales_ma"] = f["sales"].rolling(12, min_periods=1).mean()
    fig = go.Figure()
    fig.add_bar(x=f.month, y=f.sales, name="Monthly sales proxy", marker_color="#bcd2f5")
    fig.add_scatter(x=f.month, y=f.sales_ma, name="12-mo average", line=dict(color=BLUE, width=3))
    st.plotly_chart(layout(fig, "Sales over time (past → present)"), use_container_width=True)

    a, b = st.columns(2)
    ann = f.groupby(f.month.dt.year).agg(sales=("sales", "sum"), orders=("orders", "sum"),
                                         rating=("avg_rating", "mean"))
    ann["growth"] = ann["sales"].pct_change()
    fig = go.Figure(go.Bar(x=ann.index, y=ann.sales, marker_color=BLUE,
                           text=[f"{g:+.0%}" if pd.notna(g) else "" for g in ann.growth],
                           textposition="outside"))
    a.plotly_chart(layout(fig, "Annual sales (label = YoY growth)"), use_container_width=True)
    fig = go.Figure(go.Scatter(x=f.month, y=f.avg_rating.rolling(6, min_periods=1).mean(),
                               line=dict(color=GREEN, width=3)))
    fig.update_yaxes(range=[3, 5])
    b.plotly_chart(layout(fig, "Customer satisfaction: avg rating (6-mo smoothed)"),
                   use_container_width=True)

# ---------------------------------------------------------------- sales
with tab_sales:
    f["year"], f["mon"] = f.month.dt.year, f.month.dt.month
    fig = go.Figure()
    for y in sorted(f.year.unique())[-6:]:
        d = f[f.year == y]
        fig.add_scatter(x=d.mon, y=d.sales, name=str(y), mode="lines+markers")
    fig.update_xaxes(tickmode="array", tickvals=list(range(1, 13)),
                     ticktext=list("JFMAMJJASOND"))
    st.plotly_chart(layout(fig, "Seasonality: monthly sales, last 6 years"), use_container_width=True)

    f["yoy"] = f["sales"].pct_change(12)
    fig = go.Figure(go.Bar(x=f.month, y=f.yoy, marker_color=np.where(f.yoy >= 0, GREEN, RED)))
    fig.update_yaxes(tickformat=".0%")
    st.plotly_chart(layout(fig, "Year-over-year sales growth by month"), use_container_width=True)

    f["aov"] = f.sales / f.orders.replace(0, np.nan)
    fig = go.Figure(go.Scatter(x=f.month, y=f.aov, line=dict(color=AMBER, width=3)))
    st.plotly_chart(layout(fig, "Average order value ($ per verified review)"),
                    use_container_width=True)

# ---------------------------------------------------------------- satisfaction
with tab_sat:
    mrf = mrating[(mrating.month.dt.year >= start_year) & (mrating.month.dt.year <= end_year)]
    share = mrf.pivot(index="month", columns="rating", values="n").fillna(0)
    share = share.div(share.sum(axis=1), axis=0)
    colors = {1: RED, 2: "#e8896a", 3: AMBER, 4: "#7cc7a4", 5: GREEN}
    fig = go.Figure()
    for r in [1, 2, 3, 4, 5]:
        fig.add_scatter(x=share.index, y=share[r], name=f"{r}★", stackgroup="one",
                        line=dict(width=0.5, color=colors[r]))
    fig.update_yaxes(tickformat=".0%")
    st.plotly_chart(layout(fig, "Rating mix over time"), use_container_width=True)

    a, b = st.columns(2)
    fig = go.Figure()
    fig.add_scatter(x=f.month, y=f.pct_positive.rolling(6, min_periods=1).mean(),
                    name="Positive (4-5★)", line=dict(color=GREEN, width=3))
    fig.add_scatter(x=f.month, y=f.pct_negative.rolling(6, min_periods=1).mean(),
                    name="Negative (1-2★)", line=dict(color=RED, width=3))
    fig.update_yaxes(tickformat=".0%")
    a.plotly_chart(layout(fig, "Positive vs negative share (6-mo smoothed)"),
                   use_container_width=True)
    dist = mrf.groupby("rating")["n"].sum()
    fig = go.Figure(go.Bar(x=[f"{r}★" for r in dist.index], y=dist.values,
                           marker_color=[colors[r] for r in dist.index]))
    b.plotly_chart(layout(fig, "Rating distribution (selected years)"), use_container_width=True)

    nps = (f.pct_positive - f.pct_negative).iloc[-12:].mean() * 100
    st.info(f"Net satisfaction score (positive% − negative%) over the last 12 months: **{nps:+.0f}**")

# ---------------------------------------------------------------- customers
with tab_cust:
    f["returning"] = (f.customers - f.new_customers).clip(lower=0)
    fig = go.Figure()
    fig.add_bar(x=f.month, y=f.new_customers, name="New customers", marker_color=BLUE)
    fig.add_bar(x=f.month, y=f.returning, name="Returning customers", marker_color="#bcd2f5")
    fig.update_layout(barmode="stack")
    st.plotly_chart(layout(fig, "Active customers: new vs returning"), use_container_width=True)
    fig = go.Figure(go.Scatter(x=f.month, y=(f.new_customers / f.customers).rolling(6, min_periods=1).mean(),
                               line=dict(color=AMBER, width=3)))
    fig.update_yaxes(tickformat=".0%")
    st.plotly_chart(layout(fig, "New-customer share of active customers"), use_container_width=True)

# ---------------------------------------------------------------- forecast
with tab_fc:
    metric = st.radio("Forecast metric", ["sales", "orders", "avg_rating"], horizontal=True,
                      format_func={"sales": "Sales proxy ($)", "orders": "Orders",
                                   "avg_rating": "Avg rating"}.get)
    horizon = st.slider("Months ahead", 3, 24, 12)
    s = monthly.set_index("month")[metric]
    s = s[s.index >= "2012-01-01"]
    s = s.asfreq("MS")
    mean, lo, hi = forecast(s, horizon)

    # backtest: train through 12 months ago, compare with the last 12 months
    test, train = s.iloc[-12:], s.iloc[:-12]
    bt, _, _ = forecast(train, 12)
    mape = float(np.mean(np.abs((test.values - bt.values) / test.values)))

    fig = go.Figure()
    fig.add_scatter(x=s.index, y=s.values, name="Actual", line=dict(color=BLUE, width=2.5))
    fig.add_scatter(x=hi.index, y=hi.values, mode="lines", line=dict(width=0), showlegend=False, hoverinfo="skip")
    fig.add_scatter(x=lo.index, y=lo.values, mode="lines", fill="tonexty", fillcolor="rgba(42,111,219,0.15)",
                    line=dict(width=0), name="95% interval", hoverinfo="skip")
    fig.add_scatter(x=mean.index, y=mean.values, name="Forecast", mode="lines",
                    line=dict(color=AMBER, width=3, dash="dash"))
    fig.add_scatter(x=bt.index, y=bt.values, name="Backtest (last 12 mo)", mode="lines",
                    line=dict(color=GREY, width=1.5, dash="dot"))
    st.plotly_chart(layout(fig, f"{horizon}-month forecast (damped Holt-Winters)", 460),
                    use_container_width=True)

    k = st.columns(3)
    unit = "$" if metric == "sales" else ""
    if metric == "avg_rating":
        k[0].metric(f"Avg rating, next {horizon} mo", f"{mean.mean():.2f}")
    else:
        k[0].metric(f"Total, next {horizon} mo", f"{unit}{mean.sum():,.0f}")
    k[1].metric("Backtest error (MAPE, last 12 mo)", f"{mape:.1%}")
    k[2].metric("Last data month", s.index[-1].strftime("%b %Y"))
    st.caption("Model: additive damped trend + 12-month seasonality, fitted on 2012 onward. "
               "Intervals widen with horizon using in-sample residuals; treat them as indicative. "
               "Forecasts are from review activity, not true sales.")

# ---------------------------------------------------------------- brands
with tab_prod:
    bf = brand_m[(brand_m.month.dt.year >= start_year) & (brand_m.month.dt.year <= end_year)]
    bt_ = bf.groupby("brand").agg(orders=("orders", "sum"), sales=("sales", "sum"),
                                  rs=("rating_sum", "sum"))
    bt_["avg_rating"] = bt_.rs / bt_.orders
    bt_ = bt_.sort_values("sales", ascending=False).head(15)
    a, b = st.columns(2)
    fig = go.Figure(go.Bar(y=bt_.index[::-1], x=bt_.sales[::-1], orientation="h", marker_color=BLUE))
    a.plotly_chart(layout(fig, "Top brands by sales proxy", 460), use_container_width=True)
    fig = go.Figure(go.Scatter(x=bt_.orders, y=bt_.avg_rating, mode="markers+text", text=bt_.index,
                               textposition="top center", marker=dict(size=bt_.sales / bt_.sales.max() * 40 + 8, color=GREEN, opacity=0.6)))
    fig.update_xaxes(title="Orders", type="log")
    fig.update_yaxes(title="Avg rating")
    b.plotly_chart(layout(fig, "Brand volume vs satisfaction (bubble = sales)", 460),
                   use_container_width=True)
    st.subheader("Top products (2,000 most-reviewed)")
    st.dataframe(products.rename(columns={"parent_asin": "ASIN"})
                 [["ASIN", "title", "brand", "price", "orders", "sales", "avg_rating"]]
                 .head(200), use_container_width=True, hide_index=True)
