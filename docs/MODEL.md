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
```
