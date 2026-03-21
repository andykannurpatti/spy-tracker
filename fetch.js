// SPY Bottom Tracker — Data Fetcher
// Runs via GitHub Actions twice daily. No paid APIs required.
// Optional: set FRED_API_KEY env var (free at fred.stlouisfed.org) for 2Y yield + credit spreads.
// Data sources: Yahoo Finance (free, no key) + FRED (free key optional)

const https = require('https');
const fs = require('fs');

// ── CONFIGURE HERE ───────────────────────────────────────────────────────────
const SPY_ATH = 697.84; // Intraday all-time high. Update manually when new ATH is set.
const FED_RATE = '3.50-3.75%'; // Update when Fed changes rates.
// ────────────────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json,*/*'
      }
    }, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`JSON parse failed for ${url.slice(0,60)}: ${data.slice(0,100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url.slice(0,60)}`)); });
  });
}

async function yahooChart(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const data = await get(url);
  const result = data.chart.result[0];
  // Filter out null closes, keep paired with timestamps
  const pairs = result.timestamp
    .map((ts, i) => ({ ts, close: result.indicators.quote[0].close[i] }))
    .filter(p => p.close !== null && p.close !== undefined && !isNaN(p.close));
  return { closes: pairs.map(p => p.close), timestamps: pairs.map(p => p.ts), meta: result.meta };
}

async function fredSeries(seriesId, apiKey) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${apiKey}&limit=5&sort_order=desc&file_type=json`;
  const data = await get(url);
  const obs = data.observations.filter(o => o.value !== '.' && o.value !== '');
  return obs.length > 0 ? parseFloat(obs[0].value) : null;
}

// ── Technical calculations ───────────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 2) return null;
  // Initial averages over first period
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder smoothing for remaining data
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcSMA(closes, period) {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  return ema12 - ema26;
}

// ── Signal functions (must match index.html exactly) ─────────────────────────
function rsiSignal(v)    { if(v<=30)return'Oversold';if(v<=42)return'Near oversold';if(v<=58)return'Neutral';if(v<=70)return'Near overbought';return'Overbought'; }
function vixSignal(v)    { if(v<15)return'Low';if(v<20)return'Normal';if(v<30)return'Elevated';if(v<40)return'High';return'Extreme'; }
function spreadSignal(v) { if(v<250)return'Tight';if(v<400)return'Normal';if(v<600)return'Wide';return'Very Wide'; }
function maSignal(p, m)  { return p >= m ? 'Above' : 'Below'; }
function ycSignal(s)     { return s < -0.1 ? 'Inverted' : s < 0.2 ? 'Flat' : 'Steepening'; }
function macdSignal(v)   { return v > 0 ? 'Bullish' : 'Bearish'; }
function oilSignal(v)    { if(v>100)return'Rising';if(v>85)return'Elevated';return'Stable'; }

function overallSignal(rsiS, ma50s, ma200s, vixS, spreadS, ycS) {
  let bull = 0, bear = 0;
  if(ma50s==='Above')bull+=2;else if(ma50s==='Below')bear+=2;
  if(ma200s==='Above')bull+=2;else if(ma200s==='Below')bear+=2;
  if(rsiS==='Oversold'||rsiS==='Near oversold')bull+=1;else if(rsiS==='Overbought'||rsiS==='Near overbought')bear+=1;
  if(vixS==='Low'||vixS==='Normal')bull+=1;else if(vixS==='Elevated')bear+=1;else if(vixS==='High'||vixS==='Extreme')bear+=2;
  if(spreadS==='Tight')bull+=1;else if(spreadS==='Wide')bear+=1;else if(spreadS==='Very Wide')bear+=2;
  if(ycS==='Steepening')bull+=1;else if(ycS==='Inverted')bear+=1;
  if(bull>bear)return'Bullish';if(bear>bull)return'Bearish';return'Neutral';
}

// ── Rule-based comment — fully deterministic, no AI ─────────────────────────
function generateComment(signals, raw) {
  const parts = [];

  // Sentence 1: Trend status based on MA crossovers
  const p = raw.price.toFixed(0), m50 = raw.ma50.toFixed(0), m200 = raw.ma200.toFixed(0);
  if (signals.ma200s === 'Below' && signals.ma50s === 'Below') {
    parts.push(`SPY ($${p}) is below both the 50-day MA ($${m50}) and 200-day MA ($${m200}), confirming a downtrend.`);
  } else if (signals.ma200s === 'Above' && signals.ma50s === 'Above') {
    parts.push(`SPY ($${p}) is above both the 50-day MA ($${m50}) and 200-day MA ($${m200}), confirming an uptrend.`);
  } else if (signals.ma200s === 'Below' && signals.ma50s === 'Above') {
    parts.push(`SPY ($${p}) has reclaimed its 50-day MA ($${m50}) but remains below the 200-day MA ($${m200}) — recovery is tentative.`);
  } else {
    parts.push(`SPY ($${p}) has slipped below the 50-day MA ($${m50}) but holds above the 200-day MA ($${m200}) — short-term weakness in a longer-term uptrend.`);
  }

  // Sentence 2: Most important risk or momentum signal
  if (signals.vixSig === 'Extreme') {
    parts.push(`VIX at ${raw.vix.toFixed(1)} signals panic-level fear — historically associated with capitulation and potential near-term bottoms.`);
  } else if (signals.vixSig === 'High') {
    parts.push(`VIX at ${raw.vix.toFixed(1)} is high — watch for a spike above 40 as a potential capitulation signal and buying opportunity.`);
  } else if (signals.spreadSig === 'Very Wide') {
    parts.push(`HY credit spreads at ${Math.round(raw.hy)} bps are very wide — institutional credit markets are pricing in significant recession risk.`);
  } else if (signals.spreadSig === 'Wide') {
    parts.push(`HY credit spreads at ${Math.round(raw.hy)} bps are widening — an early warning that institutional credit markets are pricing in stress.`);
  } else if (signals.rsiSig === 'Oversold') {
    parts.push(`RSI at ${raw.rsi.toFixed(1)} is oversold — selling may be approaching exhaustion, but trend confirmation is needed before calling a bottom.`);
  } else if (signals.rsiSig === 'Near oversold') {
    parts.push(`RSI at ${raw.rsi.toFixed(1)} is approaching oversold levels — momentum is weakening; watch for stabilization in VIX and credit spreads as confirmation.`);
  } else if (signals.rsiSig === 'Overbought') {
    parts.push(`RSI at ${raw.rsi.toFixed(1)} is overbought — upside momentum may be stretched; watch for a pullback toward moving average support.`);
  } else if (signals.ycSig === 'Inverted') {
    parts.push(`The yield curve is inverted (10Y−2Y: ${raw.ycSpread.toFixed(2)}%) — a historically reliable leading indicator of recession within 12–18 months.`);
  } else if (signals.spreadSig === 'Tight' && signals.ma200s === 'Above') {
    parts.push(`Credit spreads at ${Math.round(raw.hy)} bps are tight and trend is intact — no systemic stress signals; current conditions favor the bull case.`);
  } else {
    parts.push(`Credit spreads at ${Math.round(raw.hy)} bps are normal; watch for widening above 400 bps as an early warning of deepening stress.`);
  }

  return parts.join(' ');
}

// ── Session detection ─────────────────────────────────────────────────────────
function getSession() {
  const n = new Date();
  const day = n.getUTCDay();
  const month = n.getUTCMonth() + 1;
  const offset = (month >= 3 && month <= 11) ? -4 : -5;
  const et = ((n.getUTCHours() + n.getUTCMinutes() / 60 + offset) + 24) % 24;
  if (day === 0 || day === 6) return 'Market closed';
  if (et >= 4 && et < 9.5)  return 'Pre-market';
  if (et >= 9.5 && et < 16) return 'Market open';
  if (et >= 16 && et < 20)  return 'Post-market';
  return 'Market closed';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('SPY Bottom Tracker — data fetch starting...');

  // 1. SPY historical prices (1 year for MA200)
  console.log('Fetching SPY history...');
  const spy = await yahooChart('SPY', '1y');
  const closes = spy.closes;
  if (closes.length < 200) throw new Error(`Not enough SPY data: ${closes.length} days`);

  const price   = closes[closes.length - 1];
  const prev    = closes[closes.length - 2];
  const changePct = ((price - prev) / prev) * 100;
  const rsi     = calcRSI(closes);
  const ma50    = calcSMA(closes, 50);
  const ma200   = calcSMA(closes, 200);
  const macd    = calcMACD(closes);
  console.log(`  SPY: $${price.toFixed(2)} (${changePct.toFixed(2)}%), RSI: ${rsi.toFixed(1)}, MA50: $${ma50.toFixed(2)}, MA200: $${ma200.toFixed(2)}`);

  // 2. VIX
  console.log('Fetching VIX...');
  const vixData = await yahooChart('^VIX', '5d');
  const vixCloses = vixData.closes;
  const vix = vixCloses[vixCloses.length - 1];
  console.log(`  VIX: ${vix.toFixed(1)}`);

  // 3. US 10Y yield (^TNX on Yahoo = yield * 10, e.g. 42.7 = 4.27%)
  console.log('Fetching 10Y yield...');
  const tnxData = await yahooChart('^TNX', '5d');
  const tnxCloses = tnxData.closes;
  const tnxRaw = tnxCloses[tnxCloses.length - 1];
  const us10y = tnxRaw > 10 ? tnxRaw / 10 : tnxRaw; // normalize
  console.log(`  US 10Y: ${us10y.toFixed(2)}% (raw: ${tnxRaw})`);

  // 4. Oil (WTI)
  console.log('Fetching WTI oil...');
  const oilData = await yahooChart('CL=F', '5d');
  const oilCloses = oilData.closes;
  const oil = oilCloses[oilCloses.length - 1];
  console.log(`  Oil: $${oil.toFixed(2)}`);

  // 5. FRED data (optional — 2Y yield + credit spreads)
  let us2y = null, hy = null, ig = null;
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    console.log('Fetching FRED data...');
    try {
      us2y = await fredSeries('DGS2', fredKey);
      const hyPct = await fredSeries('BAMLH0A0HYM2', fredKey);
      const igPct = await fredSeries('BAMLC0A0CM', fredKey);
      hy = hyPct !== null ? hyPct * 100 : null; // FRED returns %, convert to bps
      ig = igPct !== null ? igPct * 100 : null;
      console.log(`  2Y: ${us2y?.toFixed(2)}%, HY: ${hy?.toFixed(0)} bps, IG: ${ig?.toFixed(0)} bps`);
    } catch(e) {
      console.warn('  FRED fetch failed:', e.message, '— using fallback values');
    }
  } else {
    console.log('No FRED_API_KEY set — using fallback values for 2Y yield and credit spreads');
  }

  // Fallbacks if FRED unavailable
  if (us2y === null) us2y = us10y - 0.49; // approximate — replace with real FRED data for accuracy
  if (hy === null)   hy = 330;             // approximate — last known value
  if (ig === null)   ig = 100;             // approximate

  // 6. Derived calculations — all deterministic
  const drawdown  = ((price - SPY_ATH) / SPY_ATH) * 100;
  const ycSpread  = us10y - us2y;
  const ma50s     = maSignal(price, ma50);
  const ma200s    = maSignal(price, ma200);
  const rsiSig    = rsiSignal(rsi);
  const vixSig    = vixSignal(vix);
  const spreadSig = spreadSignal(hy);
  const ycSig     = ycSignal(ycSpread);
  const macdSig   = macdSignal(macd);
  const oilSig    = oilSignal(oil);
  const overall   = overallSignal(rsiSig, ma50s, ma200s, vixSig, spreadSig, ycSig);

  const raw     = { price, changePct, rsi, ma50, ma200, macd, vix, us10y, us2y, oil, hy, ig, ycSpread, drawdown };
  const signals = { ma50s, ma200s, rsiSig, vixSig, spreadSig, ycSig, macdSig, oilSig, overallSig: overall };
  const comment = generateComment(signals, raw);

  const output = {
    _at: new Date().toISOString(),
    _session: getSession(),
    _source: fredKey ? 'Yahoo Finance + FRED' : 'Yahoo Finance (FRED fallback)',
    signals,
    comment,
    display: {
      price:    '$' + price.toFixed(2),
      changePct:(changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
      ath:      '$' + SPY_ATH.toFixed(2),
      drawdown: drawdown.toFixed(1) + '%',
      rsi:      rsi.toFixed(1),
      ma50:     '$' + ma50.toFixed(2),
      ma200:    '$' + ma200.toFixed(2),
      macd:     (macd >= 0 ? '+' : '') + macd.toFixed(2),
      vix:      vix.toFixed(1),
      us10y:    us10y.toFixed(2) + '%',
      us2y:     us2y.toFixed(2) + '%',
      ycSpread: (ycSpread >= 0 ? '+' : '') + ycSpread.toFixed(2) + '%',
      oil:      '$' + oil.toFixed(2),
      hy:       Math.round(hy) + ' bps',
      ig:       Math.round(ig) + ' bps',
      fedRate:  FED_RATE
    },
    _raw: raw
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('\ndata.json written successfully');
  console.log('Signal:', overall);
  console.log('Comment:', comment.slice(0, 80) + '...');
}

main().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
