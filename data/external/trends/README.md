# Google Trends files (you add these by hand)

Google has no official free API for historical Trends, and automated scraping breaks its terms, so this folder is filled manually.

1. Open https://trends.google.com/trends/explore, set **United States**, **2004 - present** (Google then gives monthly values) and a term such as `dishwasher`, `refrigerator`, `washing machine`, `air fryer`.
2. Use **Download (.csv)** and save it here as `<term>.csv` (any name ending in `.csv`).
3. Run `python scripts/test_trends.py`.

Use one term per file, and the same date range for all. The files are small and safe to commit.
