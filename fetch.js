// SPY Tracker — Market Condition Monitor
// Mandala Sustainable Solutions · mandalasustainablesolutions.com
// Runs via GitHub Actions hourly during market hours. No paid APIs required.
// FRED API key optional (free at fred.stlouisfed.org) — improves 2Y yield + credit spread accuracy.

const https = require('https');
const fs = require('fs');

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
        catch(e) { reject(new Error(`JSON parse failed for ${url.slice(0,60)}: ${data.slice(0,80)}`)); }
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
  if (!result) throw new Error(`Symbol not found on Yahoo Finance: ${symbol}`);
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
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / period, avgLoss = losses / period;
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
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return ema;
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12), ema26 = calcEMA(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  return ema12 - ema26;
}

// ── Signal functions ─────────────────────────────────────────────────────────
function maSignal(p, m) {
  if (!p || !m) return '—';
  const pct = (p - m) / m * 100;
  if (pct > 0.5) return 'Above'; if (pct < -0.5) return 'Below'; return 'At';
}
function rsiSignal(v)      { const r=+v; if(r<=30)return'Oversold'; if(r<=42)return'Near oversold'; if(r<=58)return'Neutral'; if(r<=70)return'Near overbought'; return'Overbought'; }
function vixSignal(v)      { const n=+v; if(n<15)return'Low'; if(n<20)return'Normal'; if(n<30)return'Elevated'; if(n<40)return'High'; return'Extreme'; }
function spreadSignal(v)   { const n=+v; if(n<250)return'Tight'; if(n<400)return'Normal'; if(n<600)return'Wide'; return'Very Wide'; }
function ycSignal(s)       { return s<-0.1?'Inverted':s<0.2?'Flat':'Steepening'; }
function macdSignal(v)     { return +v>0?'Bullish':'Bearish'; }
function oilSignal(v)      { const n=+v; if(n>100)return'Elevated'; if(n>85)return'Rising'; return'Stable'; }
function breadthSignal(v)  { const n=+v; if(n>=70)return'Broad'; if(n>=55)return'Healthy'; if(n>=40)return'Narrowing'; return'Thin'; }
function putCallSignal(v)  { const n=+v; if(n<0.7)return'Complacent'; if(n<=1.0)return'Normal'; if(n<=1.3)return'Hedging'; return'Fearful'; }
function dist52wSignal(v)  { const n=+v; if(n<=2)return'At high'; if(n<=5)return'Near high'; if(n<=10)return'Pulling back'; if(n<=20)return'Correcting'; return'Bear territory'; }

// ── Market condition — the core new framework ─────────────────────────────────
// Replaces Bullish/Neutral/Bearish. Works regardless of market direction.
function calcCondition(sig) {
  let stressScore = 0, stretchScore = 0, trendScore = 0, breadthScore = 0;

  // TREND
  if (sig.ma50s === 'Above') trendScore += 2; else if (sig.ma50s === 'Below') trendScore -= 2;
  if (sig.ma200s === 'Above') trendScore += 2; else if (sig.ma200s === 'Below') trendScore -= 2;
  if (sig.macdSig === 'Bullish') trendScore += 1; else trendScore -= 1;
  if (sig.dist52wSig === 'At high' || sig.dist52wSig === 'Near high') trendScore += 1;

  // STRESS
  if (sig.vixSig === 'Extreme') stressScore += 3;
  else if (sig.vixSig === 'High') stressScore += 2;
  else if (sig.vixSig === 'Elevated') stressScore += 1;
  if (sig.spreadSig === 'Very Wide') stressScore += 2;
  else if (sig.spreadSig === 'Wide') stressScore += 1;
  if (sig.ycSig === 'Inverted') stressScore += 1;
  if (sig.rsiSig === 'Oversold') stressScore += 1;

  // BREADTH
  if (sig.breadthSig === 'Broad') breadthScore += 2;
  else if (sig.breadthSig === 'Healthy') breadthScore += 1;
  else if (sig.breadthSig === 'Narrowing') breadthScore -= 1;
  else if (sig.breadthSig === 'Thin') breadthScore -= 2;
  if (sig.putCallSig === 'Fearful') breadthScore += 1; // contrarian signal
  else if (sig.putCallSig === 'Complacent') breadthScore -= 1;

  // STRETCH
  if (sig.rsiSig === 'Overbought') stretchScore += 2;
  else if (sig.rsiSig === 'Near overbought') stretchScore += 1;
  if (sig.putCallSig === 'Complacent') stretchScore += 1;
  if (sig.dist52wSig === 'At high' && sig.vixSig === 'Low') stretchScore += 1;

  // Determine condition
  if (stressScore >= 3 || trendScore <= -3) return 'Stressed';
  if (stressScore >= 2 || (stressScore >= 1 && breadthScore < 0)) return 'Stressed';
  if (stressScore >= 1 || trendScore <= 0 || breadthScore < 0) return 'Caution';
  if (trendScore >= 3 && stretchScore >= 2) return 'Stretched';
  if (trendScore >= 4 && breadthScore >= 1 && stressScore === 0 && stretchScore <= 1) return 'Healthy';
  if (trendScore >= 3 && stretchScore >= 1) return 'Stretched';
  if (trendScore >= 3 && breadthScore >= 1) return 'Healthy';
  return 'Caution';
}

// ── Rule-based comment — condition language, no AI ────────────────────────────
function generateComment(signals, raw, condition) {
  const parts = [];
  const p = raw.price.toFixed(0), m50 = raw.ma50.toFixed(0), m200 = raw.ma200.toFixed(0);
  const ddPct = raw.drawdown;

  // Sentence 1: trend and condition context
  if (condition === 'Healthy') {
    if (raw.breadthPct >= 70) {
      parts.push(`SPY ($${p}) is above both key moving averages with ${raw.breadthPct.toFixed(0)}% of S&P 500 stocks above their 200-day MA — the rally is broad and technically sound.`);
    } else {
      parts.push(`SPY ($${p}) is above both the 50-day MA ($${m50}) and 200-day MA ($${m200}), confirming an intact uptrend with broad participation.`);
    }
  } else if (condition === 'Stretched') {
    if (signals.rsiSig === 'Overbought') {
      parts.push(`SPY ($${p}) is ${Math.abs(ddPct).toFixed(1)}% from its ATH with RSI at ${raw.rsi.toFixed(1)} — momentum is overbought and the rally may be extended.`);
    } else if (signals.putCallSig === 'Complacent') {
      parts.push(`SPY ($${p}) is near its highs with the put/call ratio at ${raw.putCall.toFixed(2)} — options market complacency suggests limited hedging activity, a classic late-rally warning.`);
    } else {
      parts.push(`SPY ($${p}) is above both moving averages but breadth is narrowing — the rally is increasingly concentrated, watch for confirmation from small caps and sector rotation.`);
    }
  } else if (condition === 'Caution') {
    if (signals.ma50s === 'Below' && signals.ma200s === 'Above') {
      parts.push(`SPY ($${p}) has slipped below its 50-day MA ($${m50}) but holds above the 200-day MA ($${m200}) — short-term momentum is weakening within a longer-term uptrend.`);
    } else if (signals.vixSig === 'Elevated') {
      parts.push(`SPY ($${p}) is showing mixed signals — volatility is elevated (VIX ${raw.vix.toFixed(1)}) and market internals warrant caution even if price action looks stable.`);
    } else if (signals.breadthSig === 'Narrowing' || signals.breadthSig === 'Thin') {
      parts.push(`SPY ($${p}) price is holding but only ${raw.breadthPct.toFixed(0)}% of S&P 500 stocks are above their 200-day MA — a narrow, potentially fragile rally.`);
    } else {
      parts.push(`SPY ($${p}) is showing mixed signals — trend and breadth indicators are not confirming each other. Monitor for clarification before adding risk.`);
    }
  } else if (condition === 'Stressed') {
    if (signals.vixSig === 'High' || signals.vixSig === 'Extreme') {
      parts.push(`SPY ($${p}) is under pressure with VIX at ${raw.vix.toFixed(1)} — fear is elevated, and the market is in a stress environment. Risk management is the priority.`);
    } else if (signals.spreadSig === 'Wide' || signals.spreadSig === 'Very Wide') {
      parts.push(`SPY ($${p}) is in a stressed environment — HY credit spreads at ${Math.round(raw.hy)} bps signal institutional concern about credit quality and economic risk.`);
    } else {
      parts.push(`SPY ($${p}) is below key moving averages with deteriorating internals — the technical structure is broken and defensive positioning is warranted.`);
    }
  }

  // Sentence 2: the single most important watchpoint right now
  if (signals.rsiSig === 'Oversold') {
    parts.push(`RSI at ${raw.rsi.toFixed(1)} is oversold — selling exhaustion may be near, but wait for breadth confirmation before stepping in.`);
  } else if (signals.rsiSig === 'Overbought' && condition !== 'Stressed') {
    parts.push(`Watch for RSI to unwind from overbought (${raw.rsi.toFixed(1)}) — a pullback to test moving average support is a healthy outcome in a bull market.`);
  } else if (signals.spreadSig === 'Very Wide') {
    parts.push(`HY credit spreads at ${Math.round(raw.hy)} bps are at stress levels — this is the most important signal to watch for systemic risk.`);
  } else if (signals.breadthSig === 'Thin') {
    parts.push(`Only ${raw.breadthPct.toFixed(0)}% of S&P 500 stocks are above their 200-day MA — thin breadth historically precedes more significant corrections.`);
  } else if (signals.putCallSig === 'Complacent') {
    parts.push(`Put/call at ${raw.putCall.toFixed(2)} reflects low hedging activity — complacency at market highs has historically preceded volatility spikes.`);
  } else if (signals.putCallSig === 'Fearful') {
    parts.push(`Put/call at ${raw.putCall.toFixed(2)} reflects elevated hedging — extreme fear readings like this have historically been contrarian buy signals near market lows.`);
  } else if (signals.ycSig === 'Inverted') {
    parts.push(`The yield curve remains inverted (${raw.ycSpread.toFixed(2)}%) — a historically reliable 12-18 month leading indicator of recession risk.`);
  } else if (signals.vixSig === 'Elevated') {
    parts.push(`VIX at ${raw.vix.toFixed(1)} is above normal — the options market is pricing in more risk than the price action currently suggests.`);
  } else if (signals.oilSig === 'Elevated') {
    parts.push(`Oil at $${raw.oil.toFixed(0)} remains elevated — energy costs are a headwind to consumer spending and corporate margins.`);
  } else {
    parts.push(`Credit spreads at ${Math.round(raw.hy)} bps are ${signals.spreadSig.toLowerCase()} — no systemic stress visible in institutional credit markets.`);
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
  if (et >= 4 && et < 9.5) return 'Pre-market';
  if (et >= 9.5 && et < 16) return 'Market open';
  if (et >= 16 && et < 20) return 'Post-market';
  return 'Market closed';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('SPY Tracker — Market Condition Monitor · Mandala Sustainable Solutions');
  console.log('Data fetch starting...\n');

  // 1. SPY historical prices (5 year for ATH + technicals)
  console.log('Fetching SPY history (5y)...');
  const spy = await yahooChart('SPY', '5y');
  const closes = spy.closes;
  if (closes.length < 200) throw new Error(`Insufficient SPY data: ${closes.length} days`);

  const price     = closes[closes.length - 1];
  const prev      = closes[closes.length - 2];
  const changePct = ((price - prev) / prev) * 100;
  const SPY_ATH   = Math.max(...closes); // Dynamic — auto-updates as new highs are set
  const high52w   = Math.max(...closes.slice(-252));
  const dist52w   = ((price - high52w) / high52w) * 100; // negative = below 52w high
  const rsi       = calcRSI(closes);
  const ma50      = calcSMA(closes, 50);
  const ma200     = calcSMA(closes, 200);
  const macd      = calcMACD(closes);
  const drawdown  = ((price - SPY_ATH) / SPY_ATH) * 100;
  console.log(`  SPY: $${price.toFixed(2)} (${changePct.toFixed(2)}%) | RSI: ${rsi.toFixed(1)} | MA50: $${ma50.toFixed(2)} | MA200: $${ma200.toFixed(2)} | ATH: $${SPY_ATH.toFixed(2)}`);

  // 2. VIX
  console.log('Fetching VIX...');
  const vixData = await yahooChart('^VIX', '5d');
  const vix = vixData.closes[vixData.closes.length - 1];
  console.log(`  VIX: ${vix.toFixed(1)}`);

  // 3. 10Y yield
  console.log('Fetching 10Y yield...');
  const tnxData = await yahooChart('^TNX', '5d');
  const tnxRaw = tnxData.closes[tnxData.closes.length - 1];
  const us10y = tnxRaw > 10 ? tnxRaw / 10 : tnxRaw;
  console.log(`  US 10Y: ${us10y.toFixed(2)}%`);

  // 4. Oil (WTI)
  console.log('Fetching WTI oil...');
  const oilData = await yahooChart('CL=F', '5d');
  const oil = oilData.closes[oilData.closes.length - 1];
  console.log(`  Oil: $${oil.toFixed(2)}`);

  // 5. Breadth — % of S&P 500 sector ETFs above their own 200-day MA
  // Uses all 11 SPDR sector ETFs as a legitimate sector breadth proxy.
  // First tries ^SPXA200R direct; falls back to sector ETF calculation.
  console.log('Fetching market breadth...');
  let breadthPct = null;
  const breadthTickers = ['^SPXA200R', 'SPXA200R'];
  for (const ticker of breadthTickers) {
    try {
      const breadthData = await yahooChart(ticker, '5d');
      const val = breadthData.closes[breadthData.closes.length - 1];
      if (val > 0 && val <= 100) { breadthPct = val; break; }
    } catch(e) { /* try next */ }
  }
  if (breadthPct !== null) {
    console.log(`  Breadth: ${breadthPct.toFixed(1)}% above 200d MA (direct)`);
  } else {
    // Sector ETF breadth proxy — fetch all 11 SPDR sectors, check each vs its own 200d MA
    const sectors = ['XLC','XLY','XLP','XLE','XLF','XLV','XLI','XLB','XLRE','XLK','XLU'];
    let aboveCount = 0, totalFetched = 0;
    await Promise.all(sectors.map(async (ticker) => {
      try {
        const sd = await yahooChart(ticker, '1y');
        const sc = sd.closes;
        const sma = calcSMA(sc, 200);
        const sPrice = sc[sc.length - 1];
        if (sma && sPrice) {
          totalFetched++;
          if (sPrice > sma) aboveCount++;
        }
      } catch(e) { /* skip failed sector */ }
    }));
    if (totalFetched > 0) {
      breadthPct = (aboveCount / totalFetched) * 100;
      console.warn(`  Breadth: ${aboveCount}/${totalFetched} sectors above 200d MA = ${breadthPct.toFixed(0)}% (sector proxy)`);
    } else {
      breadthPct = 55; // neutral fallback if all fetches fail
      console.warn(`  Breadth: all fetches failed — using neutral fallback 55%`);
    }
  }

  // 6. Put/Call ratio — CBOE total put/call ratio
  console.log('Fetching Put/Call ratio...');
  let putCall = null;
  const pcTickers = ['^CPC', '^CPCE', '^CPCI', 'CPC'];
  for (const ticker of pcTickers) {
    try {
      const pcData = await yahooChart(ticker, '5d');
      const val = pcData.closes[pcData.closes.length - 1];
      if (val > 0 && val < 5) { putCall = val; break; }
    } catch(e) { /* try next */ }
  }
  if (putCall !== null) {
    console.log(`  Put/Call: ${putCall.toFixed(2)}`);
  } else {
    // Derive VIX-based proxy: high VIX = more puts being bought
    putCall = vix > 30 ? 1.2 : vix > 25 ? 1.05 : vix > 20 ? 0.95 : vix > 15 ? 0.85 : 0.75;
    console.warn(`  Put/Call tickers unavailable — VIX-based proxy: ${putCall.toFixed(2)}`);
  }

  // 7. FRED data — 2Y yield, credit spreads, Fed rate
  let us2y = null, hy = null, ig = null, fedRate = '3.50-3.75%';
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    console.log('Fetching FRED data...');
    try {
      us2y = await fredSeries('DGS2', fredKey);
      const hyPct = await fredSeries('BAMLH0A0HYM2', fredKey);
      const igPct = await fredSeries('BAMLC0A0CM', fredKey);
      hy = hyPct !== null ? hyPct * 100 : null;
      ig = igPct !== null ? igPct * 100 : null;
      const fedLower = await fredSeries('DFEDTARL', fredKey);
      const fedUpper = await fredSeries('DFEDTARU', fredKey);
      if (fedLower !== null && fedUpper !== null) fedRate = fedLower.toFixed(2) + '-' + fedUpper.toFixed(2) + '%';
      console.log(`  2Y: ${us2y?.toFixed(2)}% | HY: ${hy?.toFixed(0)} bps | IG: ${ig?.toFixed(0)} bps | Fed: ${fedRate}`);
    } catch(e) { console.warn('  FRED fetch failed:', e.message); }
  } else {
    console.log('No FRED_API_KEY — using fallback values');
  }
  if (us2y === null) us2y = us10y - 0.45;
  if (hy === null) hy = 290;
  if (ig === null) ig = 85;

  // 8. Compute all signals deterministically
  const ycSpread  = us10y - us2y;
  const ma50s     = maSignal(price, ma50);
  const ma200s    = maSignal(price, ma200);
  const rsiSig    = rsiSignal(rsi);
  const vixSig    = vixSignal(vix);
  const spreadSig = spreadSignal(hy);
  const ycSig     = ycSignal(ycSpread);
  const macdSig   = macdSignal(macd);
  const oilSig    = oilSignal(oil);
  const breadthSig = breadthSignal(breadthPct);
  const putCallSig = putCallSignal(putCall);
  const dist52wSig = dist52wSignal(Math.abs(dist52w));

  const signals = { ma50s, ma200s, rsiSig, vixSig, spreadSig, ycSig, macdSig, oilSig, breadthSig, putCallSig, dist52wSig };

  // 9. Overall condition
  const condition = calcCondition(signals);

  // 10. Comment
  const raw = { price, changePct, rsi, ma50, ma200, macd, vix, us10y, us2y, oil, hy, ig, ycSpread, drawdown, breadthPct, putCall, dist52w };
  const comment = generateComment(signals, raw, condition);

  // 11. Chart data (90 days)
  const chartDays = 90;
  const chartCloses = closes.slice(-chartDays);
  const chartLabels = spy.timestamps.slice(-chartDays).map(ts => {
    const d = new Date(ts * 1000);
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  });
  const chartMA50 = chartCloses.map((_, i) => {
    const idx = closes.length - chartDays + i;
    if (idx < 49) return null;
    return parseFloat(calcSMA(closes.slice(0, idx + 1), 50).toFixed(2));
  });
  const chartMA200 = chartCloses.map((_, i) => {
    const idx = closes.length - chartDays + i;
    if (idx < 199) return null;
    return parseFloat(calcSMA(closes.slice(0, idx + 1), 200).toFixed(2));
  });

  const output = {
    _at: new Date().toISOString(),
    _session: getSession(),
    _source: fredKey ? 'Yahoo Finance + FRED' : 'Yahoo Finance (FRED fallback)',
    condition,
    signals,
    comment,
    chart: {
      labels: chartLabels,
      closes: chartCloses.map(v => parseFloat(v.toFixed(2))),
      ma50: chartMA50,
      ma200: chartMA200
    },
    display: {
      price:     '$' + price.toFixed(2),
      changePct: (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%',
      ath:       '$' + SPY_ATH.toFixed(2),
      drawdown:  drawdown.toFixed(1) + '%',
      high52w:   '$' + high52w.toFixed(2),
      dist52w:   dist52w.toFixed(1) + '%',
      rsi:       rsi.toFixed(1),
      ma50:      '$' + ma50.toFixed(2),
      ma200:     '$' + ma200.toFixed(2),
      macd:      (macd >= 0 ? '+' : '') + macd.toFixed(2),
      vix:       vix.toFixed(1),
      us10y:     us10y.toFixed(2) + '%',
      us2y:      us2y.toFixed(2) + '%',
      ycSpread:  (ycSpread >= 0 ? '+' : '') + ycSpread.toFixed(2) + '%',
      oil:       '$' + oil.toFixed(2),
      hy:        Math.round(hy) + ' bps',
      ig:        Math.round(ig) + ' bps',
      fedRate,
      breadthPct: breadthPct.toFixed(1) + '%',
      putCall:    putCall.toFixed(2)
    },
    _raw: raw
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log(`\ndata.json written · Condition: ${condition}`);
  console.log(`Comment: ${comment.slice(0, 100)}...`);
}

main().catch(e => { console.error('Fatal error:', e.message); process.exit(1); });
