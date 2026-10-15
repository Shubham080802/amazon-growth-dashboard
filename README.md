# Amazon Appliances Growth Dashboard

**Live demo:** https://amazon-growth-dashboard-swart.vercel.app

Streamlit + Plotly dashboard analysing growth of Amazon's Appliances category from 2.1M public customer reviews.

**Dataset:** [Amazon Reviews 2023](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (McAuley Lab, UC San Diego), Appliances category: 2,128,605 reviews, 94,327 products, 1996-2023.

## Two versions
- **`web/`** is a static site (Plotly.js, forecasts precomputed in Python). This is what is deployed on Vercel.
- **`app.py`** is the original Streamlit app, with live Python forecasting.

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
