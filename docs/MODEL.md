# How the forecasting works

This is written for someone who has to defend the numbers in a meeting.

## What is forecast
Monthly **sales proxy**, **orders** and **average rating** for 46 segments: the whole category, the 12 biggest brands, 4 price bands and the 30 most-reviewed products. The data is Amazon review activity (2.1M reviews), not transactions. Sales proxy = list price of each verified-purchase review, a lower bound on real revenue.

## Pipeline
1. `scripts/build_segments.py` turns the raw reviews into one monthly series per segment (`data/segments_monthly.csv`).
2. `forecast_engine.py` forecasts one series; `scripts/build_forecasts.py` runs it for every segment and writes `web/forecast.json`.
3. The dashboard (`web/lab.js`) turns those results into decisions. Nothing is computed on a server.

## Model per series (`forecast_engine.py`)
- **Candidates:** four exponential-smoothing models: level only, damped trend, seasonality only, damped trend + seasonality.
- **Selection by backtest:** each candidate is refitted from 24, 18 and 12 months before the end and scored on the following 12 months (weighted MAPE). The lowest score wins; a simpler model must be clearly better to displace a richer one.
- **Log scale:** volumes are modelled as `log(1 + x)`, so errors are proportional and forecasts cannot go negative. Ratings stay linear and are clipped to 1-5.
- **Simulation:** 1,000 future paths are simulated by bootstrapping the model's own residuals. Ranges, running totals and "chance of reaching target" come from those paths.
- **Calibration:** simulated ranges are scaled (0.6x to 3x) until an 80% range would have contained the real outcome about 80% of the time in the backtests. The scale factor and the observed coverage are reported per segment.
- **Minimum history:** 36 months. Newer products are not forecast.

## Amazon's own results (company level)
`scripts/build_market_data.py` pulls Amazon's quarterly net sales, operating income, net income, operating cash flow and capital spending from SEC EDGAR (Q4 is derived as the full year minus Q1-Q3, because 10-Ks report only the year). The same engine forecasts quarterly net sales with a 4-quarter season, 8-quarter horizon and backtests from 8, 6 and 4 quarters back. Its next-quarter range is compared with Amazon's published guidance. Amazon has noted that Prime Day timing moves its Q3 growth by nearly 4 points, which a seasonal model cannot see, so a gap to guidance is a prompt to watch the quarter, not proof of error.

## Why the category series is not extended to today
The review data ends Mar 2023 and no newer release exists. We tested eleven public indicators (retail, appliance prices and production, housing starts, mortgage rates, sentiment, income, durable-goods spending) on whole calendar years 2013-2022 (n = 10): correlation with category growth, leave-one-year-out error against a naive guess, robustness to dropping the launch-phase year 2013 and to removing the maturing trend, a Bonferroni correction, and a real out-of-sample check on Jan-Mar 2023 (in the data, not used to fit). None passed. Housing starts came closest (r = +0.83, p = 0.003) but implied a 113-point collapse for Q1 2023 when the data show +10, because the link is driven by two extreme years. The verdict flipped between the observed-price and completed-price series, which is itself a sign of fragility. The results are rebuilt into the dashboard's Market & company tab. Extending the category with them would present a guess as data.

## Reproducibility
Simulated paths use shocks drawn here with a fixed seed (statsmodels' built-in bootstrap ignores its seed, which made small-segment numbers change between runs). The expected value is a 1%-99% trimmed mean so a few extreme simulated paths cannot move it. Two consecutive builds produce identical output.

## Completing missing values
**Prices** (`scripts/build_products.py`). A two-stage model: a ridge regression on the title, brand and type text feeds a gradient-boosting model that also sees type, brand, weight, pack size, rating count and launch year. It predicts log price; the prediction is converted to an expected price with a smearing factor that is then calibrated so the held-out estimates sum to the true value (aggregate bias under 1%). Every estimated price is flagged (`price_src = estimated`) with an 80% interval. It is judged only on products whose price is known, including by launch cohort. The assumption that cannot be tested is that products with missing prices resemble similar products with prices.
**Why it matters.** Missing prices are not random: older products lose their listed price. Using listed prices alone, the sales proxy for 2016 rested on 59% estimated value in the completed series versus 24% in 2022, so the observed-only series overstated early growth.
**Product type** comes from the product's own category path; the 3.5% without one are predicted from the title.

## What customers talk about
`themes.py` holds twelve keyword lists (fit, leaks, durability, noise, installation, water and taste, performance, value, delivery, service and returns, genuine vs fake, ease of use). A review "mentions" a theme if its title or text matches. Matches are counted per product for all reviews, unhappy (1-2 star) reviews, the last 12 months and the 12 before; no review text is published. It is a lexicon, not language understanding: it will miss paraphrases and occasionally over-match, but it is inspectable, and sanity checks hold (service and returns is 8.7 times more common in 1-2 star reviews, durability 3.5 times, performance 0.4 times).

## Product lifecycle
For every product with 30+ reviews: first and last review, peak (3-month average), reviews and rating in the last 12 months vs the 12 before, and a stage: New (first reviewed in the last year), Faded (no reviews in six months), Low activity (under 10 in the last year), Growing or Declining (25% or more change), otherwise Steady. Reviews follow sales with a lag and measure engagement, not units.

## Monitoring ("is this month on track?")
For each of the last 12 months the chosen model is refitted on data up to the previous month and asked what it expected. A month outside the 10th-90th percentile range is flagged. About 20% of months should be flagged by chance; a cluster of flags across many segments usually means a market-wide move.

## Decision rules (`decide()` in `web/lab.js`)
Thresholds are adjustable in the dashboard.
| Action | Rule |
|---|---|
| Risk | chance of beating last year is at most 30% (1 minus the risk threshold) |
| Fix quality | growing (chance of growth at least 50%), but rating is below the floor (4.0) or fell by 0.10 or more |
| Invest | chance of growth at least 70% and rating is healthy |
| Watch | everything else |

"Tentative" is added when the segment's typical monthly miss is above 30%.

## Scenario levers
`sales x (1 + demand) x (1 + price)^(1 + elasticity)` and `orders x (1 + demand) x (1 + price)^elasticity`. Elasticity is an assumption entered by the user (default -1.5), not estimated from this data. The levers rescale the forecast; they are not a second model.

## Known limits
- Review activity is a proxy for sales; a promotion that drives reviews would look like demand.
- Months after Mar 2023 are excluded because collection is incomplete.
- Product-level forecasts are noisy by nature; treat them as watch-lists.
- Monthly data cannot support daily decisions. The monitoring view is the closest thing to a daily check.

## Rebuild
```bash
python scripts/build_segments.py data_raw data        # needs the raw JSONL files, see README
OMP_NUM_THREADS=1 python scripts/build_forecasts.py   # ~90 seconds
python scripts/export_web_data.py
python scripts/build_market_data.py                   # internet needed; refreshes SEC + FRED data
```
