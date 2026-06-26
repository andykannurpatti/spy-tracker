# SPY Tracker — Market Condition Monitor

A fully free, automated S&P 500 market condition tracker built by Andy Kannurpatti · [Mandala Sustainable Solutions](https://www.mandalasustainablesolutions.com/principal)

Live at: **https://spy-tracker-andy.netlify.app**

---

## What it does

SPY Tracker assesses current S&P 500 market conditions and signals whether the environment is **Healthy**, **Stretched**, **Caution**, or **Stressed** — regardless of which direction the market is headed. It works equally well at all-time highs or in a correction.

GitHub Actions fetches real market data every hour during market hours on weekdays. All signals and the overall condition are computed deterministically in JavaScript — no AI, no variability. Users open the app and tap Refresh to see the latest shared snapshot. No API key or account needed.

**Total monthly cost: $0.00**

---

## Signal framework

The overall condition is derived from three axes:

**Trend** (weighted ×2 — primary indicators)
- 50-day moving average vs price
- 200-day moving average vs price
- MACD (12/26-day EMA difference)
- Distance from 52-week high

**Breadth** (is the rally broad or narrow?)
- % of S&P 500 sector ETFs above their 200-day MA
- Put/Call ratio (complacency vs hedging)

**Stress** (are risk signals elevated?)
- VIX (CBOE volatility index)
- HY credit spreads (bps over Treasuries)
- Yield curve (10Y − 2Y Treasury spread)
- RSI (14-day relative strength index)

**Macro context**
- Fed funds rate (fetched from FRED)
- US 10Y and 2Y Treasury yields
- WTI crude oil

---

## Conditions explained

| Condition | What it means |
|---|---|
| **Healthy** | Trend intact, breadth broad, stress indicators quiet |
| **Stretched** | Rally extended, RSI overbought or put/call complacent |
| **Caution** | Mixed signals, some deterioration — wait for clarity |
| **Stressed** | Multiple warning signals firing — capital preservation priority |

---

## Tabs

- **Signals** — Full scorecard across Trend, Breadth, and Stress axes with ⓘ icons for inline explanations
- **Chart** — 90-day SPY price vs 50-day and 200-day moving averages
- **Technical** — RSI gauge, moving averages, MACD, breadth bar, put/call
- **Macro** — Fed rate, yields, yield curve, oil, VIX, credit spreads
- **Glossary** — Plain-English explanation of every indicator and condition, including data source and series ID for each
- **History** — Timestamped log of all snapshots (saved locally per device)

---

## Data sources

| Signal | Source |
|---|---|
| SPY price, RSI, MA50, MA200, MACD, ATH | Yahoo Finance (calculated from 5-year daily history) |
| VIX | Yahoo Finance (^VIX) |
| US 10Y yield | Yahoo Finance (^TNX) |
| WTI crude oil | Yahoo Finance (CL=F) |
| Sector breadth | 11 SPDR sector ETFs vs their own 200-day MAs |
| US 2Y yield | FRED: DGS2 |
| HY credit spread | FRED: BAMLH0A0HYM2 |
| IG credit spread | FRED: BAMLC0A0CM |
| Put/Call ratio | CBOE totalpc.csv (cdn.cboe.com) · Updated previous trading day |
| Fed funds rate | FRED: DFEDTARL + DFEDTARU |

---

## Setup (one-time, ~15 minutes)

### 1. GitHub repo
Create a public repository called `spy-tracker` at github.com.

### 2. Upload files
Upload these files to the repo root:
- `fetch.js`
- `data.json`
- `index.html`

Create the folder `.github/workflows/` and upload:
- `update.yml`

### 3. FRED API key (recommended)
Get a free key at [fred.stlouisfed.org](https://fred.stlouisfed.org).
In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `FRED_API_KEY`
- Value: your key

Without this, 2Y yield and credit spreads use approximations.

### 4. First run
Go to **Actions → Update SPY market data → Run workflow** to populate `data.json` with real data immediately.

### 5. Deploy to Netlify
Drag `index.html` onto [app.netlify.com](https://app.netlify.com). Rename to `index.html` first.

---

## Ongoing maintenance

**SPY ATH** — calculated dynamically from 5-year historical data. Updates automatically as new highs are set.

**Fed funds rate** — fetched dynamically from FRED after every FOMC meeting. No manual update needed.

**Node.js deprecation warnings** — if GitHub Actions warns about Node.js versions, the workflow uses `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` and `actions/checkout@v4.2.2` / `actions/setup-node@v4.4.0`.

---

## Schedule

GitHub Actions runs automatically on weekdays:

| Time (ET) | Run |
|---|---|
| 8:45 AM | Pre-market |
| 9:30 AM – 3:30 PM | Hourly during market hours |
| 4:15 PM | Closing snapshot |

---

## Tech stack

- **Data fetch**: Node.js (`fetch.js`) running on GitHub Actions — free tier
- **Frontend**: Static HTML (`index.html`) deployed on Netlify — free tier
- **APIs**: Yahoo Finance (no key) + FRED (free key)
- **No backend, no database, no AI, no paid services**

---

## Disclaimer

Educational market analysis only — not investment advice. Data from Yahoo Finance and FRED (free public APIs). Consult a qualified financial advisor before making portfolio decisions.
