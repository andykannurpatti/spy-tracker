# SPY Bottom Tracker — Setup Guide

## What this is
A fully free, automated S&P 500 bottom analysis tracker.
- GitHub Actions fetches real market data twice daily (8:45 AM + 4:15 PM ET, weekdays)
- Data comes from Yahoo Finance (free, no key) + FRED (free key optional)
- All signals are computed deterministically — no AI, no variability
- Users open the web app and see the latest shared snapshot — no API key needed

## Cost: $0.00/month

---

## One-time setup (15 minutes)

### Step 1 — Create a GitHub account
Go to github.com and sign up if you don't have one.

### Step 2 — Create a new repository
- Click the + icon → New repository
- Name it: `spy-tracker`
- Set to **Public** (required for free raw file access)
- Click Create repository

### Step 3 — Upload the files
Upload these files to your repo root:
- `fetch.js`
- `data.json`
- `index.html`

Create the folder structure `.github/workflows/` and upload:
- `update.yml` into that folder

GitHub has a web interface for uploading files — no command line needed.

### Step 4 — Add your FRED API key (optional but recommended)
FRED provides the US 2-year Treasury yield and credit spreads.
Without it, the app uses approximations.

1. Get a free key at fred.stlouisfed.org (takes 2 minutes)
2. In your GitHub repo, go to Settings → Secrets and variables → Actions
3. Click New repository secret
4. Name: `FRED_API_KEY`, Value: your key
5. Click Add secret

### Step 5 — Update index.html with your GitHub username
Open `index.html` and find this line near the top of the script:
```
var DATA_URL = 'https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/spy-tracker/main/data.json';
```
Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.

### Step 6 — Run the workflow once manually
In your GitHub repo, go to Actions → Update SPY market data → Run workflow.
This populates `data.json` with real data immediately (don't wait for the schedule).

### Step 7 — Deploy index.html to Netlify
Drag just the `index.html` file onto app.netlify.com (same as before).
Rename to `index.html` first. Your Netlify URL stays the same.

---

## How it works day to day
- GitHub Actions runs at 8:45 AM and 4:15 PM ET on weekdays automatically
- It fetches data, computes all signals, writes `data.json` to the repo
- When users open the app and tap Refresh, it fetches `data.json` from GitHub
- On weekends, data shows the last Friday close

## Updating the ATH
When SPY sets a new all-time high, update this line in `fetch.js`:
```
const SPY_ATH = 697.84;
```
Then commit the change to GitHub.

## Updating the Fed rate
When the Fed changes rates, update this line in `fetch.js`:
```
const FED_RATE = '3.50-3.75%';
```

---

## Data sources
| Signal | Source |
|--------|--------|
| SPY price, change%, RSI, MA50, MA200, MACD | Yahoo Finance (calculated from 1-year daily history) |
| VIX | Yahoo Finance (^VIX) |
| US 10Y yield | Yahoo Finance (^TNX) |
| WTI crude oil | Yahoo Finance (CL=F) |
| US 2Y yield | FRED: DGS2 (requires free FRED key) |
| HY credit spread | FRED: BAMLH0A0HYM2 (requires free FRED key) |
| IG credit spread | FRED: BAMLC0A0CM (requires free FRED key) |
