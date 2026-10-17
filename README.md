# Amazon Appliances Growth Dashboard

**Live demo:** https://amazon-growth-dashboard-swart.vercel.app

A decision dashboard for Amazon's Appliances category, built from 2.1M public customer reviews, Amazon's own SEC filings and public U.S. market data. It is a static site (plain HTML, JavaScript and Plotly) with all the heavy analysis precomputed in Python.

## What's in it

Six tabs, plus an "About the data" page linked from the footer and the header's freshness chips.

| Tab | Answers |
|---|---|
| **Executive brief** | Where is the category heading, how sure are we, what should we do? Outlook with a likely range and confidence, an annual-target tracker (chance of reaching a target, remembered between visits), a monthly "is this on track?" check, suggested Invest / Fix / Risk decisions, what changed since the previous build, and a scorecard of every brand, price band, product type and top product. Save it as a one-page PDF. |
| **Market & company** | Amazon's real quarterly results through Q2 2026 (SEC filings), revenue mix and segments, a quarterly net sales outlook checked against Amazon's own guidance, U.S. retail and appliance-price context, and demand drivers (housing, mortgage rates, sentiment) through Sep 2026. |
| **Forecast lab** | Pick any segment and measure; month-by-month or running-total view with 80% / 95% ranges; scenario levers (demand, price, elasticity); what drives the change; seasonality; a downloadable monthly plan; and how reliable the model has been. |
| **Products** | *Find a product*: any of 10,376 products with 30+ reviews (81% of review volume): growth, lifecycle stage, rating shift, launch position, and what customers talk about, recent vs earlier. *Compare*: two or three brands, types, price bands or products side by side. *Brands & types*: brand share of voice and the type overview. |
| **Lifecycle** | Old vs new products on the same March 2023 basis, compared by product age: where reviews come from, how launches build an audience, hit rates, survival, time to peak, launch quality, and which types and brands depend on new launches. |
| **Performance** | Sales proxy, reviews, rating and positive share over time (with optional event markers), annual sales, seasonality, satisfaction, and category-wide topic trends with the topic shifts inside each product type. |

A shared header shows how current each data source is (green, amber or red). Old links keep working (`#tab=overview`, `#tab=brands` and so on map to the new tabs).

## Data sources and how current they are

| Source | Covers | Latest | Used for |
|---|---|---|---|
| [Amazon Reviews 2023](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (UC San Diego) | 2.1M Appliances reviews, 94K products | **Mar 2023** (no newer release exists) | category forecasts, products, cohorts, topics |
| [SEC EDGAR](https://www.sec.gov/edgar/sec-api-documentation) | Amazon quarterly financials | Q2 2026 | Amazon actuals and revenue outlook |
| [Amazon Q2 2026 release](https://ir.aboutamazon.com/news-release/news-release-details/2026/Amazon-com-Announces-Second-Quarter-Results) and earlier releases | revenue mix, segments, guidance | Q2 2026 | transcribed by hand; reconciled to the SEC filings |
| [FRED](https://fred.stlouisfed.org/) (Census Bureau, BLS, Federal Reserve, Michigan, Freddie Mac) | e-commerce, retail, appliance prices and production, housing, mortgage rates, sentiment | Sep 2026 | market context |

**The category review data is the only source that is out of date.** Public market indicators do not reliably track its growth (11 tested strictly; see the Market tab), so the category series is not extended with them. Forecasts and cohorts are labelled "as of Mar 2023". Refresh and rebuild when a newer review dataset is published.

## Completing the data, without inventing it

Each gap is handled in the most conservative way that works, every fill is flagged, and `scripts/validate_data.py` checks the result (30 checks, shown on the About-the-data page).

| Gap | What was done | How it is checked |
|---|---|---|
| 50% of products have no listed price (20% of review value; more in older years) | estimated from type, brand, weight, pack size and title text | tested on products whose price is known: R² 0.81, 9% median error on brand-by-type totals, no bias across product ages |
| 3.5% of products have no category | predicted from the title | 81% accurate on known products |
| Brand missing for 1% | copied from other fields that already exist; otherwise "Unknown" | nothing is guessed |
| Amazon quarterly figures missing | accounting identities (Q2 = six-month total minus Q1, and so on) | every derived value is listed in `data/external/amazon_quarterly_derived.json` |
| Amazon revenue mix and segments | transcribed from earnings releases | every quarter reconciles to the SEC filing to the dollar |
| Category data after Mar 2023 | **not filled** | no public indicator reliably tracks it |

Filling prices matters: listed prices alone overstated 2019 growth (+44% vs +13% with prices completed) and understated the 2022 decline (−3% vs −13%).

The method, including the forecasting model, decision rules, topics and cohorts, is in [docs/MODEL.md](docs/MODEL.md).

## Run it

```bash
pip install -r requirements.txt
python -m http.server 8600 --directory web      # then open http://localhost:8600
```
`web/` already holds every precomputed file, so no build is needed to view the dashboard.

## Rebuild everything

Needs the two raw files from the [dataset page](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (`Appliances.jsonl` and `meta_Appliances.jsonl`, about 1.2 GB) in `data_raw/`.

```bash
python scripts/build_products.py data_raw data     # product master + validated fills      (~6 min)
python scripts/build_reviews.py  data_raw data     # one pass over 2M reviews + topics     (~6 min)
python scripts/etl.py data && python scripts/build_segments.py data
python scripts/build_cohorts.py data               # launch cohorts, new vs old products
python scripts/build_product_explorer.py data
python scripts/build_topics.py data
python scripts/export_web_data.py
OMP_NUM_THREADS=1 python scripts/build_forecasts.py   # keeps the previous build for the "what changed" box
python scripts/build_market_data.py                # needs internet (SEC, FRED)
python scripts/validate_data.py                    # fails loudly if anything is inconsistent
```

## Deploy

Import the repo at vercel.com/new (no framework, no build command). `vercel.json` serves `web/`. Every push to `main` redeploys.

## Caveats

- The sales figure is a **proxy**: the price of each verified-purchase review (about a fifth of recent value rests on estimated prices). Amazon does not publish category sales.
- Reviews measure engagement, which follows sales with a lag.
- Months after Mar 2023 are excluded from the category data because collection is incomplete there.
- Amazon's segment detail and guidance are transcribed from its earnings releases and need a manual update each quarter (`data/external/`).
