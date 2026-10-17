# To do

## On hold: a grounded Q&A agent (step 2)

**Status:** deliberately postponed. Step 1 (suggested questions, segment search and "What am I looking at?" explainers, all template-based with no language model) is live. Build step 2 only if people actually want to type free-form questions.

### Decisions needed first
- [ ] **Access.** The site is public today. Decide whether it stays public or goes behind a login (Vercel's access protection, a shared password, or SSO). A model-backed endpoint on an open site can be used by anyone.
- [ ] **Budget.** A monthly spend cap you are comfortable with, set as a hard limit on the API account, not just a target.
- [ ] **API key.** Stored only as a server-side secret (never in the page or the repo).
- [ ] **Real questions.** A list of 10 to 20 questions your executives would actually ask. This drives the tools and the test set.

### Design principles (do not relax these)
1. **The model never calculates or recalls numbers.** It calls read-only tools that return exact values from the dashboard's own JSON files; the answer may only restate what the tools returned.
2. **Every answer cites its source** (which tab, segment and measure) with a link that opens that view.
3. **It refuses what the data cannot support** (anything after March 2023 for the category, stock or investment advice, causes the data cannot show) and says why, pointing to the right tab when there is one.
4. **It states uncertainty the way the dashboard does:** range, confidence, and the March 2023 cut-off.
5. **Scenarios stay in the Forecast lab,** where the assumptions are visible. The agent can open the lab with levers pre-set, but does not invent scenario numbers.

### Tools to expose (read-only, JSON in and out)
- [ ] `get_segment(id)`: summary, outlook, rating, suggested action and why (reuses `segmentAnswer` logic)
- [ ] `list_segments(kind, sort_by, limit)` and `compare(ids)`
- [ ] `get_forecast(id, metric, horizon)`: expected, range, chance of target, model reliability
- [ ] `topic_shifts(type?)` and `lifecycle_summary(type?)`
- [ ] `market_snapshot()` (Amazon results and guidance, market context) and `data_freshness()`
- [ ] `data_quality()` (what was filled, check results)
- [ ] `search_products(query)` and `get_product(asin)`
- [ ] Reuse the 14 step-1 question templates as the first tool results and as worked examples in the prompt

### Build
- [ ] Serverless function (for example a Vercel function) that holds the key, runs the tool-use loop with a hard cap on tool calls, and streams the answer.
- [ ] Chat panel that replaces the Ask input while keeping the suggested-question chips and the "Source" links.
- [ ] **Number check:** after the model answers, verify every number in the text appears in the tool outputs; if not, discard the answer and show a safe fallback.
- [ ] Rate limit per visitor, daily spend cap, and a kill switch (an environment flag that turns the agent off and leaves step 1 working).
- [ ] Minimal logging (question, tools called, whether a number check failed) with no personal data, for reviewing failures.
- [ ] Pick the smallest, fastest model that passes the test set; revisit when models change.

### Evaluation (before any launch)
- [ ] A **golden set of about 50 questions** with known answers: the 14 existing questions, the executives' own list, segment look-ups, comparisons, and deliberately unanswerable or tricky ones ("what will Amazon's stock do?", "sales in 2025?", "which product should I buy?").
- [ ] Score: exact-number match, correct refusal, citation present, no number outside the tool outputs.
- [ ] Re-run the set whenever the data or the model is rebuilt; fail the build if scores drop.
- [ ] Read 20 real transcripts with an executive before widening access.

### Acceptance criteria
- 100% of numbers in sampled answers trace to a tool output.
- Every unanswerable question in the golden set is declined with a reason.
- Median answer time is acceptable to the people using it (agree a target with them).
- Spend stays under the cap in a week of real use.

### Not planned
Free-form forecasting through chat; real-time or streaming data; anything that changes the data or the model from the chat.

---

## Smaller open items
- [ ] **Quarterly:** update `data/external/amazon_quarterly_detail.json` and the latest release file by hand after each Amazon earnings release, then run `python scripts/build_market_data.py`. Consider automating the transcription with a parser plus the existing SEC reconciliation as the safety net.
- [ ] **If a newer review dataset appears:** run the rebuild order in the README, then re-run the bridge test (it may start to pass) and revisit the "as of March 2023" labels.
- [ ] **Explainers:** add "What am I looking at?" to the remaining charts (satisfaction, lifecycle curves, market drivers).
- [ ] **Accessibility:** keyboard access to chart points, and a table view for each chart.
- [ ] **Continuous checks:** run the page-integrity part of `validate_data.py` on every push (the full run needs the raw data, which is not in the repo).
- [ ] **Print:** a clean print layout for tabs other than the Executive brief.
- [ ] **Size:** `products/index.json` is about 3.4 MB; split it or load it on demand if the Products tab feels slow on mobile networks.
