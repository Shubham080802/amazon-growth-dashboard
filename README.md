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
| [FRED](https://fred.stlouisfed.org/) (Census Bureau, BLS, Fed, Michigan, Freddie Mac) | e-commerce, retail, appliance prices and production, housing, mortgage rates, sentiment | Sep 2026 | market context |

The category review data is the only source that is out of date. Public market indicators do **not** reliably track its growth (tested; see the "Market & company" tab), so the category series is not extended with them. Refresh the data and rebuild when a newer review dataset is published.

## Completing the data, without inventing it
Real data has gaps. Each gap is handled the most conservative way that works, every fill is flagged, and `scripts/validate_data.py` checks the result (19 checks, shown on the **Data quality** tab).
| Gap | What was done | How it is checked |
|---|---|---|
| 50% of products have no listed price (20% of review value; more in older years) | estimated from type, brand, weight, pack size and title text | tested on products whose price is known: R² 0.81, 9% median error on brand-by-type totals, no bias across product ages |
| 3.5% of products have no category | predicted from the title | 81% accurate on known products |
| Brand missing for 1% | copied from other fields that already exist; otherwise left "Unknown" | nothing is guessed |
| Amazon quarterly figures missing | accounting identities (Q2 = six-month total minus Q1, and so on) | each derived value listed in `data/external/amazon_quarterly_derived.json` |
| Amazon revenue mix and segments | transcribed from earnings releases | every quarter reconciles to the SEC filing to the dollar |
| Category data after Mar 2023 | **not filled** | no public indicator reliably tracks it (strict test on the Market tab) |

Filling prices matters: listed prices alone overstated 2019 growth (+44% vs +13% with prices completed) and understated the 2022 decline (−3% vs −13%).

## Built for decisions (web version)
- **Executive brief:** one-sentence outlook with a likely range and confidence, an annual-target tracker (chance of hitting a target), a monthly "is this on track?" check against what the model expected, suggested Invest / Fix / Risk decisions, and a scorecard for every brand, price band and top product.
- **Market & company:** Amazon's real quarterly results through Q2 2026 (SEC filings), segment results, a quarterly net sales outlook checked against Amazon's own Q3 guidance, and U.S. retail and appliance-price context through Sep 2026.
- **Product explorer:** pick any of 10,376 products with 30+ reviews (81% of all review volume) to see how it grew, where it is in its life, how its rating and unhappy-review share moved, and which topics customers talk about, recent vs earlier. A type overview covers the long tail.
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

## Rebuild everything
```bash
python scripts/build_products.py data_raw data     # product master + validated fills      (~6 min)
python scripts/build_reviews.py  data_raw data     # one pass over 2M reviews + themes     (~6 min)
python scripts/etl.py data && python scripts/build_segments.py data
python scripts/build_product_explorer.py data
python scripts/export_web_data.py
OMP_NUM_THREADS=1 python scripts/build_forecasts.py
python scripts/build_market_data.py                # needs internet (SEC, FRED)
python scripts/validate_data.py                    # fails loudly if anything is inconsistent
```
