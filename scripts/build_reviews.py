"""One pass over the raw reviews -> a compact cache every later step reads (seconds instead of minutes).

For each review we keep: product index, month, rating, verified flag, helpful votes, reviewer id code, and a bit-mask
of which themes (themes.py) the review mentions. Review text itself is read here and then discarded.

Output: data/reviews_lean.parquet  (not committed)
Usage:  python scripts/build_reviews.py data_raw data
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from themes import THEMES  # noqa: E402

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
LAST_COMPLETE = "2023-04-01"          # collection is incomplete after Mar-2023 (see README)

master = pd.read_csv(out / "products_master.csv.gz", usecols=["parent_asin"])
index = pd.Index(master["parent_asin"])
patterns = [(i, rx) for i, (_, _, rx) in enumerate(THEMES)]

parts = []
for n, chunk in enumerate(pd.read_json(raw / "Appliances.jsonl", lines=True, chunksize=250_000)):
    ts = pd.to_datetime(chunk["timestamp"], unit="ms")
    keep = (ts >= "2012-01-01") & (ts < LAST_COMPLETE)
    chunk, ts = chunk[keep], ts[keep]
    txt = (chunk["title"].fillna("") + " " + chunk["text"].fillna("")).str.lower()
    mask = np.zeros(len(chunk), dtype=np.int32)
    for i, rx in patterns:
        mask |= txt.str.contains(rx, regex=True).to_numpy().astype(np.int32) << i
    parts.append(pd.DataFrame({
        "p": index.get_indexer(chunk["parent_asin"]).astype(np.int32),
        "month": (ts.dt.year * 12 + ts.dt.month - 1).astype(np.int32).to_numpy(),
        "rating": chunk["rating"].astype(np.int8).to_numpy(),
        "ver": chunk["verified_purchase"].astype(np.int8).to_numpy(),
        "helpful": chunk["helpful_vote"].clip(0, 30000).astype(np.int16).to_numpy(),
        "uid": chunk["user_id"].to_numpy(),
        "themes": mask,
    }))
    print(f"chunk {n}: {len(chunk):,} reviews", flush=True)

df = pd.concat(parts, ignore_index=True)
df["uid"] = pd.factorize(df["uid"])[0].astype(np.int32)
assert (df["p"] >= 0).all(), "reviews for products missing from the metadata"
df.to_parquet(out / "reviews_lean.parquet", index=False)
print(f"{len(df):,} reviews, {df['p'].nunique():,} products, {df['uid'].nunique():,} reviewers -> reviews_lean.parquet")
