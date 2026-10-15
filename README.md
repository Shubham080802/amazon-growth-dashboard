# Amazon Appliances Growth Dashboard

**Live demo:** https://amazon-growth-dashboard-swart.vercel.app

Streamlit + Plotly dashboard analysing growth of Amazon's Appliances category from 2.1M public customer reviews.

**Dataset:** [Amazon Reviews 2023](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (McAuley Lab, UC San Diego), Appliances category: 2,128,605 reviews, 94,327 products, 1996-2023.

## Two versions
- **`web/`** is a static site (Plotly.js, forecasts precomputed in Python). This is what is deployed on Vercel.
- **`app.py`** is the original Streamlit app, with live Python forecasting.

## Data sources and how current they are
| Source | Covers | Latest | Used for |
|---|---|---|---|
| [Amazon Reviews 2023](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (UC San Diego) | 2.1M Appliances reviews | **Mar 2023** (no newer release exists) | category forecasts, brands, products |
| [SEC EDGAR](https://www.sec.gov/edgar/sec-api-documentation) | Amazon quarterly financials | Q2 2026 | Amazon actuals and revenue outlook |
| [Amazon Q2 2026 release](https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Second-Quarter-Results) | segments, guidance | Q2 2026 | segment table, guidance check (transcribed by hand) |
| [FRED](https://fred.stlouisfed.org/) (Census Bureau, BLS) | e-commerce, online retail, appliance stores, appliance prices | Sep 2026 | market context |

The category review data is the only source that is out of date. Public market indicators do **not** reliably track its growth (tested; see the "Market & company" tab), so the category series is not extended with them. Refresh the data and rebuild when a newer review dataset is published.

## Built for decisions (web version)
- **Executive brief:** one-sentence outlook with a likely range and confidence, an annual-target tracker (chance of hitting a target), a monthly "is this on track?" check against what the model expected, suggested Invest / Fix / Risk decisions, and a scorecard for every brand, price band and top product.
- **Market & company:** Amazon's real quarterly results through Q2 2026 (SEC filings), segment results, a quarterly net sales outlook checked against Amazon's own Q3 guidance, and U.S. retail and appliance-price context through Sep 2026.
- **Forecast lab:** pick any segment and measure, choose the horizon, see a month-by-month or running-total view with 80%/95% ranges, test scenarios (demand, price, elasticity), see what drives the change (orders vs price and mix), the seasonal pattern, a downloadable monthly plan, and how reliable the model has been.
- How the model works and its limits: [docs/MODEL.md](docs/MODEL.md).

## Interactions in the web version
- Click a metric card (or the headline number) to switch the main chart; use the Sales/Orders/Rating/New customers/Positive % switcher, a smoothed-average toggle and a "compare with last year" overlay; drag the range slider to zoom
- Year range: dropdowns, quick presets (All, Last 5, Last 3, Before 2020, 2020 on) or click an annual bar to focus on one year
- Click a brand (bar or bubble) for a drill-down panel; sort and search the product table
- Click an insight to jump to the matching tab; copy a link that restores your exact view; download the selected years as CSV; light/dark theme

## Deploy the web version on Vercel
1. Import this GitHub repo at vercel.com/new (no framework, no build command).
2. `vercel.json` sets the output directory to `web/`, so just click **Deploy**.
3. To refresh the numbers: `python scripts/export_web_data.py`, commit `web/data.json`, push.

Preview locally: `python -m http.server 8600 --directory web`

## Run the Streamlit version
```bash
pip install -r requirements.txt
# one-time: download Appliances.jsonl and meta_Appliances.jsonl from the dataset's raw/ folders into data_raw/
python scripts/etl.py data_raw data      # builds the small tables in data/
streamlit run app.py
```
`data/` already holds the pre-built tables, so you can skip straight to `streamlit run app.py`.

## What's inside
- **KPIs:** sales proxy, orders, avg rating, new customers, positive-review share, each with YoY change
- **Sales:** history, seasonality, YoY growth, average order value
- **Customer satisfaction:** rating mix, positive vs negative share, net satisfaction score
- **Customers:** new vs returning
- **Forecast:** damped Holt-Winters for sales / orders / rating, with 95% interval and a 12-month backtest (MAPE)
- **Brands & products:** top brands, volume vs satisfaction, product table

## Caveats
- The dataset has no transactions. **Sales = list price of each verified-purchase review**, a lower-bound proxy for revenue.
- Months after Mar 2023 are dropped: volume collapses there because collection at the end of the snapshot is incomplete.
