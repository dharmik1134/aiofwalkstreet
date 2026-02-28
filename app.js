// =====================================================================
// AiofWalkStreet v5 — REAL Technical Analysis Agent
// NSE/BSE Indian stocks · ₹ currency · Custom budget modal
// Agent uses pure TA: RSI · MACD · MA Crossover · Bollinger Bands
// Requires 2+ signals in agreement before acting.
// Stop-loss at -2%, take-profit at +3% per position.
// =====================================================================

// ---------- CONFIG ----------
const CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const STOCK_SYMBOLS = ['NVDA', 'TSLA', 'AAPL', 'MSFT'];
const NSE_SYMBOLS = ['JSWSTEEL.NS', 'RELIANCE.NS', 'TCS.NS', 'INFY.NS'];
const CRYPTO_LABELS = { BTCUSDT: 'BTC/USDT', ETHUSDT: 'ETH/USDT', SOLUSDT: 'SOL/USDT', BNBUSDT: 'BNB/USDT' };
const NSE_LABELS = { 'JSWSTEEL.NS': 'JSW Steel', 'RELIANCE.NS': 'Reliance', 'TCS.NS': 'TCS', 'INFY.NS': 'Infosys' };
const YF_PROXY = 'https://api.allorigins.win/raw?url=';
const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const STOP_LOSS_PCT = 0.02;   // 2% stop-loss
const TAKE_PROFIT_PCT = 0.03;   // 3% take-profit
const TRADE_SIZE_PCT = 0.06;   // 6% of cash per trade
const MIN_SIGNALS = 2;      // minimum TA signals needed to act

// ---------- GROQ CONFIG ----------
let GROQ_API_KEY = '';
let GROQ_MODEL = 'openai/gpt-oss-120b';
let groqEnabled = false;
let groqLiveEnabled = true;   // live sidebar toggle
let groqThrottle = 0;         // timestamp of last Groq call
const GROQ_COOLDOWN_MS = 10000; // max 1 call per 10s to avoid rate limiting
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// ---------- HELPERS ----------
function isIndianStock(sym) { return NSE_SYMBOLS.includes(sym); }
function getCurrency(sym) { return (sym && isIndianStock(sym)) ? '₹' : '$'; }
function getSymLabel(sym) { return CRYPTO_LABELS[sym] || NSE_LABELS[sym] || sym; }

// ---------- BUDGET ----------
let INITIAL_CASH = 100_000; // overridden by startup modal
let DEMO_GOAL = 100;      // overridden based on budget
let budgetModalDone = false;

// ---------- STATE ----------
let currentSymbol = 'BTCUSDT';
let isCrypto = true;
let isIndian = false;
let chart = null;
let candleSeries = null;
let aiOverlayOn = true;
let drawMode = false;
let drawStart = null;
let trendLines = [];
let aiMarkers = [];
let candles = [];
let binanceWS = null;
let historyLoaded = {};
let stockPollTimer = null;
let autoTradeEnabled = true;
let goalAchieved = false;

let portfolio = { cash: INITIAL_CASH, holdings: {}, peakValue: INITIAL_CASH, entryPrices: {} };
let trades = [];
let equity = [INITIAL_CASH];
let stats = { wins: 0, losses: 0, total: 0 };
let agentLog = [];   // Agent reasoning history
let livePrices = {};

// Training sim (visual only)
let epoch = 0, trainLoss = 1.0, trainAcc = 0.0;

const NEWS_POOL = [
    { text: "BTC: Spot ETF inflows hit $800M in a single session.", type: "bull" },
    { text: "ETH: Layer-2 TVL surpasses $40B milestone.", type: "bull" },
    { text: "NVDA: Export restrictions tighten on AI chips.", type: "bear" },
    { text: "Fed holds rate steady; risk assets rally.", type: "bull" },
    { text: "TSLA: Berlin Gigafactory production pause.", type: "bear" },
    { text: "BNB: Binance launches new derivatives market.", type: "bull" },
    { text: "AAPL: iPhone supply chain concerns ease.", type: "bull" },
    { text: "MSFT: Azure AI revenue up 32% YoY.", type: "bull" },
    { text: "SOL: Network congestion spikes during NFT mint.", type: "bear" },
    { text: "NVDA: Data center revenue exceeds $20B.", type: "bull" },
    { text: "TSLA: Giga Shanghai deliveries hit new record.", type: "bull" },
    { text: "BTC: 12,000 BTC moves to exchange — watch out.", type: "bear" },
];

// =====================================================================
// CORE TA ENGINE — no randomness
// =====================================================================
function computeEMA(closes, period) {
    const k = 2 / (period + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
    return ema;
}

function computeRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const d = closes[i] - closes[i - 1];
        if (d > 0) gains += d; else losses -= d;
    }
    const ag = gains / period;
    const al = losses / period || 0.0001;
    return 100 - 100 / (1 + ag / al);
}

function computeIndicators() {
    if (candles.length < 30) return null;
    const closes = candles.map(c => c.close);
    const n = closes.length;
    const price = closes[n - 1];

    // RSI (14)
    const rsi = computeRSI(closes, 14);
    const prevRsi = computeRSI(closes.slice(0, -1), 14);

    // MACD (12,26,9)
    const macdLine = computeEMA(closes.slice(-26), 12) - computeEMA(closes.slice(-26), 26);
    const prevMacdLine = computeEMA(closes.slice(-27, -1), 12) - computeEMA(closes.slice(-27, -1), 26);
    // Signal line = EMA9 of last 9 MACD values (approximated)
    const signalLine = computeEMA([...Array(9)].map((_, i) => {
        const sl = closes.slice(-(26 + i), -(i) || undefined);
        return computeEMA(sl.slice(-26), 12) - computeEMA(sl.slice(-26), 26);
    }).reverse(), 9);

    // MA crossover (9 / 21)
    const ma9 = closes.slice(-9).reduce((a, b) => a + b, 0) / 9;
    const ma21 = closes.slice(-21).reduce((a, b) => a + b, 0) / 21;
    const pMa9 = closes.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
    const pMa21 = closes.slice(-22, -1).reduce((a, b) => a + b, 0) / 21;

    // Bollinger Bands (20, 2σ)
    const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const std20 = Math.sqrt(
        closes.slice(-20).map(v => (v - ma20) ** 2).reduce((a, b) => a + b, 0) / 20
    );
    const upperBB = ma20 + 2 * std20;
    const lowerBB = ma20 - 2 * std20;
    const bbPct = (price - lowerBB) / (upperBB - lowerBB); // 0=lower, 1=upper

    return {
        price, rsi, prevRsi,
        macdLine, prevMacdLine, signalLine,
        ma9, ma21, pMa9, pMa21,
        upperBB, lowerBB, ma20, std20, bbPct,
    };
}

// =====================================================================
// AGENT ANALYZE — pure signal logic, no noise
// =====================================================================
function agentAnalyze() {
    const ind = computeIndicators();
    if (!ind) return { action: 'WAIT', reason: 'Loading data…', buySignals: [], sellSignals: [], score: 0, ind: null };

    const { price, rsi, prevRsi, macdLine, prevMacdLine, signalLine,
        ma9, ma21, pMa9, pMa21, upperBB, lowerBB, bbPct } = ind;

    const buySignals = [];
    const sellSignals = [];

    // ── RSI ──────────────────────────────────────────────────────
    if (rsi < 30) buySignals.push(`RSI ${rsi.toFixed(1)} → oversold`);
    if (rsi > 70) sellSignals.push(`RSI ${rsi.toFixed(1)} → overbought`);
    if (rsi < 40 && prevRsi >= 40) buySignals.push(`RSI crossed 40↓ (momentum shift)`);
    if (rsi > 60 && prevRsi <= 60) sellSignals.push(`RSI crossed 60↑ (momentum peak)`);

    // ── MACD ─────────────────────────────────────────────────────
    const macdBullCross = macdLine > signalLine && prevMacdLine <= signalLine;
    const macdBearCross = macdLine < signalLine && prevMacdLine >= signalLine;
    if (macdBullCross) buySignals.push(`MACD bullish crossover`);
    if (macdBearCross) sellSignals.push(`MACD bearish crossover`);
    if (macdLine > 0 && prevMacdLine <= 0) buySignals.push(`MACD turned positive`);
    if (macdLine < 0 && prevMacdLine >= 0) sellSignals.push(`MACD turned negative`);
    // Trend bias
    if (macdLine > 0) buySignals.push(`MACD positive (${macdLine.toFixed(2)})`);
    else sellSignals.push(`MACD negative (${macdLine.toFixed(2)})`);

    // ── MA Crossover (9/21) ───────────────────────────────────────
    const goldenCross = ma9 > ma21 && pMa9 <= pMa21;
    const deathCross = ma9 < ma21 && pMa9 >= pMa21;
    if (goldenCross) buySignals.push(`Golden cross MA9/MA21`);
    if (deathCross) sellSignals.push(`Death cross MA9/MA21`);
    if (ma9 > ma21) buySignals.push(`MA9 > MA21 (uptrend)`);
    else sellSignals.push(`MA9 < MA21 (downtrend)`);

    // ── Bollinger Bands ───────────────────────────────────────────
    if (price < lowerBB) buySignals.push(`Price below lower BB → oversold squeeze`);
    if (price > upperBB) sellSignals.push(`Price above upper BB → overbought`);
    if (bbPct < 0.1) buySignals.push(`BB% ${(bbPct * 100).toFixed(0)}% (near lower band)`);
    if (bbPct > 0.9) sellSignals.push(`BB% ${(bbPct * 100).toFixed(0)}% (near upper band)`);

    // ── Scoring ──────────────────────────────────────────────────
    const score = buySignals.length - sellSignals.length;
    let action = 'HOLD';
    let reason = '';

    if (score >= MIN_SIGNALS) {
        action = 'BUY';
        reason = buySignals.slice(0, 3).join(' · ');
    } else if (score <= -MIN_SIGNALS) {
        action = 'SELL';
        reason = sellSignals.slice(0, 3).join(' · ');
    } else {
        reason = `${buySignals.length}↑ vs ${sellSignals.length}↓ signal(s) — insufficient conviction`;
    }

    return { action, reason, buySignals, sellSignals, score, ind };
}

// =====================================================================
// POSITION MANAGEMENT — stop-loss & take-profit
// =====================================================================
function checkPositionManagement(currentPrice) {
    const sym = currentSymbol;
    const h = portfolio.holdings[sym];
    if (!h || h.shares <= 0) return;

    const entry = portfolio.entryPrices[sym] || h.avgCost;
    const pctMove = (currentPrice - entry) / entry;

    const cur = getCurrency(sym);
    if (pctMove <= -STOP_LOSS_PCT) {
        const pnl = (currentPrice - h.avgCost) * h.shares;
        portfolio.cash += h.shares * currentPrice;
        if (pnl > 0) stats.wins++; else stats.losses++;
        stats.total++;
        logTrade('SELL', sym, h.shares, currentPrice, pnl);
        addAgentLog('🛑 STOP-LOSS', `↓${(pctMove * 100).toFixed(1)}% — cut position @ ${cur}${currentPrice.toFixed(2)}`, 'red');
        delete portfolio.holdings[sym];
        delete portfolio.entryPrices[sym];
        renderPortfolio(); renderHoldings(); renderStats();
    } else if (pctMove >= TAKE_PROFIT_PCT) {
        const pnl = (currentPrice - h.avgCost) * h.shares;
        portfolio.cash += h.shares * currentPrice;
        if (pnl > 0) stats.wins++; else stats.losses++;
        stats.total++;
        logTrade('SELL', sym, h.shares, currentPrice, pnl);
        addAgentLog('✅ TAKE-PROFIT', `↑${(pctMove * 100).toFixed(1)}% — locked ${cur}${pnl.toFixed(2)} @ ${cur}${currentPrice.toFixed(2)}`, 'green');
        delete portfolio.holdings[sym];
        delete portfolio.entryPrices[sym];
        renderPortfolio(); renderHoldings(); renderStats();
    }
}

// =====================================================================
// AGENT LOG
// =====================================================================
function addAgentLog(label, reason, color) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    agentLog.unshift({ label, reason, color, time });
    if (agentLog.length > 8) agentLog.pop();
    renderAgentLog();
}

function renderAgentLog() {
    const el = document.getElementById('agentLog');
    if (!el) return;
    el.innerHTML = agentLog.map(entry => `
    <div class="agent-entry">
      <div class="agent-entry-top">
        <span class="agent-label ${entry.color}">${entry.label}</span>
        <span class="agent-time">${entry.time}</span>
      </div>
      <div class="agent-reason">${entry.reason}</div>
    </div>`).join('');
}

// =====================================================================
// GROQ AI — Open-Source Reasoning Model Integration
// =====================================================================
async function groqAnalyze(ind, sym) {
    const { price, rsi, macdLine, signalLine, ma9, ma21, bbPct, upperBB, lowerBB } = ind;
    const cur = getCurrency(sym);
    const label = getSymLabel(sym);

    const systemPrompt = `You are an expert quantitative trading analyst. \
Given technical indicator values, you must output a trading decision for a paper trading simulation. \
Respond ONLY with a JSON object in this exact format (no markdown, no extra text):
{"action":"BUY"|"HOLD"|"SELL","reason":"<one concise sentence explaining why>"}`;

    const userMsg = `Asset: ${label} | Price: ${cur}${price.toFixed(2)}\
RSI(14): ${rsi.toFixed(1)} | MACD Line: ${macdLine.toFixed(4)} | MACD Signal: ${signalLine.toFixed(4)}\
MA9: ${ma9.toFixed(2)} | MA21: ${ma21.toFixed(2)} | BB%: ${(bbPct * 100).toFixed(1)}% | Upper BB: ${upperBB.toFixed(2)} | Lower BB: ${lowerBB.toFixed(2)}\
Analyze these indicators and decide: BUY, HOLD, or SELL. Output only the JSON object.`;

    try {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMsg },
                ],
                temperature: 0.3,
                max_tokens: 256,
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        let content = data?.choices?.[0]?.message?.content || '';

        // Strip <think>…</think> reasoning blocks (DeepSeek-R1, QwQ produce these)
        content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // Extract JSON — handle cases where model still wraps in markdown
        const jsonMatch = content.match(/\{[\s\S]*?\}/);
        if (!jsonMatch) throw new Error('No JSON in response');
        const parsed = JSON.parse(jsonMatch[0]);

        const action = ['BUY', 'HOLD', 'SELL'].includes(parsed.action?.toUpperCase())
            ? parsed.action.toUpperCase() : 'HOLD';
        const reason = parsed.reason || 'No reason provided';
        return { action, reason };

    } catch (e) {
        console.warn('Groq error:', e.message);
        return { action: 'HOLD', reason: `Groq error: ${e.message}` };
    }
}

function updateGroqInsight({ action, reason }) {
    const badge = document.getElementById('groqActionBadge');
    const reasonEl = document.getElementById('groqReason');
    const modelTag = document.getElementById('groqModelTag');
    if (!badge) return;
    badge.textContent = action;
    badge.className = 'groq-action-badge ' + action;
    reasonEl.textContent = reason;
    modelTag.textContent = GROQ_MODEL;
}

function toggleGroqLive() {
    groqLiveEnabled = document.getElementById('groqLiveToggle').checked;
    addAgentLog(groqLiveEnabled ? '🧠 GROQ ON' : '⏸ GROQ OFF',
        groqLiveEnabled ? 'Groq reasoning re-enabled' : 'Groq paused — using TA only', 'cyan');
}

function toggleGroqFields() {
    const checked = document.getElementById('groqToggle').checked;
    document.getElementById('groqFields').style.display = checked ? 'block' : 'none';
}

// =====================================================================
// MAIN AGENT CYCLE
// =====================================================================
function runAICycle(candle) {
    // Position management first (stop-loss / take-profit)
    checkPositionManagement(candle.close);

    const analysis = agentAnalyze();
    renderSignalFromAnalysis(analysis);

    if (autoTradeEnabled && analysis.action !== 'WAIT') {
        executeAgentTrade(analysis, candle.close);
        if (aiOverlayOn && analysis.action !== 'HOLD') addAiMarker(candle, analysis.action);
    }

    // --- GROQ REASONING MODEL ---
    const now = Date.now();
    if (groqEnabled && groqLiveEnabled && GROQ_API_KEY && (now - groqThrottle) > GROQ_COOLDOWN_MS) {
        groqThrottle = now;
        const ind = computeIndicators();
        if (ind) {
            updateGroqInsight({ action: 'THINKING', reason: 'Groq is reasoning…' });
            groqAnalyze(ind, currentSymbol).then(groqResult => {
                addAgentLog('🧠 GROQ', `[${groqResult.action}] ${groqResult.reason}`, 'cyan');
                updateGroqInsight(groqResult);
                // Groq overrides TA trade when enabled + autopilot on
                if (autoTradeEnabled && groqResult.action !== 'HOLD') {
                    executeAgentTrade(groqResult, candle.close);
                    if (aiOverlayOn) addAiMarker(candle, groqResult.action);
                }
            });
        }
    }

    renderPortfolio(); renderHoldings(); renderStats();
    simulateTraining();
    const cur = getCurrency(currentSymbol);
    updateManualInfo(`Live: ${cur}${candle.close.toLocaleString(undefined, { maximumFractionDigits: 2 })} — ready to trade`, 'muted');
}

function executeAgentTrade(analysis, price) {
    const sym = currentSymbol;

    if (analysis.action === 'BUY') {
        // Only buy if we have no position in this symbol
        if (portfolio.holdings[sym]?.shares > 0) {
            addAgentLog('⏭ SKIP BUY', `Already holding ${sym}`, 'muted');
            return;
        }
        const tradeVal = portfolio.cash * TRADE_SIZE_PCT;
        if (tradeVal < price) return;
        const shares = price > 1000
            ? parseFloat((tradeVal / price).toFixed(6))
            : Math.floor(tradeVal / price);
        if (shares <= 0) return;

        portfolio.cash -= shares * price;
        portfolio.holdings[sym] = { shares, avgCost: price };
        portfolio.entryPrices[sym] = price;
        logTrade('BUY', sym, shares, price, null);
        addAgentLog('🟢 BUY', analysis.reason, 'green');

    } else if (analysis.action === 'SELL') {
        const h = portfolio.holdings[sym];
        if (!h || h.shares <= 0) {
            addAgentLog('⏭ SKIP SELL', `No ${sym} position to sell`, 'muted');
            return;
        }
        const cur = getCurrency(sym);
        const pnl = (price - h.avgCost) * h.shares;
        portfolio.cash += h.shares * price;
        if (pnl > 0) stats.wins++; else stats.losses++;
        stats.total++;
        logTrade('SELL', sym, h.shares, price, pnl);
        addAgentLog('🔴 SELL', `${analysis.reason} | PnL: ${pnl >= 0 ? '+' : ''}${cur}${pnl.toFixed(2)}`, pnl >= 0 ? 'green' : 'red');
        delete portfolio.holdings[sym];
        delete portfolio.entryPrices[sym];

    } else if (analysis.action === 'HOLD') {
        // Log a periodic scan note (only every 5th candle to avoid spam)
        if (candles.length % 5 === 0) {
            addAgentLog('🔍 SCAN', analysis.reason, 'muted');
        }
    }
}

// =====================================================================
// AI CHART MARKERS
// =====================================================================
function addAiMarker(candle, signal) {
    aiMarkers.push({
        time: candle.time,
        position: signal === 'BUY' ? 'belowBar' : 'aboveBar',
        color: signal === 'BUY' ? '#10b981' : '#ef4444',
        shape: signal === 'BUY' ? 'arrowUp' : 'arrowDown',
        text: signal, size: 1,
    });
    if (aiMarkers.length > 60) aiMarkers.shift();
    if (candleSeries) candleSeries.setMarkers(aiMarkers);
}

// =====================================================================
// BINANCE WEBSOCKET
// =====================================================================
function connectBinance(symbol) {
    if (binanceWS) { try { binanceWS.close(); } catch (e) { } }
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`);
    binanceWS = ws;
    ws.onopen = () => { setWsStatus('live'); if (!historyLoaded[symbol]) fetchBinanceHistory(symbol); };
    ws.onerror = () => setWsStatus('error');
    ws.onclose = () => {
        setWsStatus('reconnecting');
        if (isCrypto && currentSymbol === symbol && ws === binanceWS)
            setTimeout(() => connectBinance(symbol), 3000);
    };
    ws.onmessage = (evt) => {
        const k = JSON.parse(evt.data).k;
        if (!k) return;
        const candle = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c };
        livePrices[symbol] = candle.close;
        if (currentSymbol !== symbol || !candleSeries) return;
        candleSeries.update(candle);
        updatePriceDisplay(candle);
        const last = candles[candles.length - 1];
        if (last && last.time === candle.time) candles[candles.length - 1] = candle;
        else { candles.push(candle); runAICycle(candle); }
        updateIndicators();
        renderTickers();
    };
}

async function fetchBinanceHistory(symbol) {
    try {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=200`);
        const data = await res.json();
        candles = data.map(d => ({ time: Math.floor(d[0] / 1000), open: +d[1], high: +d[2], low: +d[3], close: +d[4] }));
        if (currentSymbol === symbol && candleSeries) {
            candleSeries.setData(candles);
            chart.timeScale().fitContent();
            livePrices[symbol] = candles[candles.length - 1].close;
            updatePriceDisplay(candles[candles.length - 1]);
            renderTickers();
            addAgentLog('📡 READY', `Historical data loaded (${candles.length} candles). Agent scanning…`, 'muted');
        }
        historyLoaded[symbol] = true;
    } catch (e) { console.warn('Binance history failed', e); }
}

// =====================================================================
// YAHOO FINANCE — stock data
// =====================================================================
async function fetchYahooHistory(symbol) {
    try {
        const url = `${YF_BASE}${symbol}?interval=1m&range=1d&includePrePost=false`;
        const res = await fetch(YF_PROXY + encodeURIComponent(url));
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) throw new Error('No result');
        const times = result.timestamp;
        const q = result.indicators.quote[0];
        candles = times.map((t, i) => ({
            time: t, open: q.open[i] || q.close[i - 1] || 0,
            high: q.high[i] || 0, low: q.low[i] || 0, close: q.close[i] || 0,
        })).filter(c => c.close > 0);
        if (currentSymbol === symbol && candleSeries && candles.length > 0) {
            candleSeries.setData(candles);
            chart.timeScale().fitContent();
            livePrices[symbol] = candles[candles.length - 1].close;
            updatePriceDisplay(candles[candles.length - 1]);
            renderTickers();
            addAgentLog('📡 READY', `${symbol} loaded (${candles.length} candles). Agent scanning…`, 'muted');
        }
        historyLoaded[symbol] = true;
        setWsStatus('live');
        return true;
    } catch (e) { setWsStatus('error'); return false; }
}

async function pollYahooLatest(symbol) {
    if (currentSymbol !== symbol || !candleSeries) return;
    try {
        const url = `${YF_BASE}${symbol}?interval=1m&range=1d&includePrePost=false`;
        const res = await fetch(YF_PROXY + encodeURIComponent(url));
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) return;
        const times = result.timestamp;
        const q = result.indicators.quote[0];
        const lc = {
            time: times[times.length - 1],
            open: q.open[times.length - 1] || 0, high: q.high[times.length - 1] || 0,
            low: q.low[times.length - 1] || 0, close: q.close[times.length - 1] || 0,
        };
        if (lc.close <= 0) return;
        livePrices[symbol] = lc.close;
        candleSeries.update(lc);
        updatePriceDisplay(lc);
        const last = candles[candles.length - 1];
        if (last && last.time === lc.time) candles[candles.length - 1] = lc;
        else { candles.push(lc); runAICycle(lc); }
        updateIndicators(); renderTickers(); setWsStatus('live');
    } catch (e) { setWsStatus('reconnecting'); }
}

function startStockFeed(symbol) {
    if (stockPollTimer) clearInterval(stockPollTimer);
    setWsStatus('reconnecting');
    fetchYahooHistory(symbol).then(() => {
        stockPollTimer = setInterval(() => pollYahooLatest(symbol), 15000);
    });
}

// =====================================================================
// STATUS
// =====================================================================
function setWsStatus(state) {
    const dot = document.getElementById('wsDot');
    const label = document.getElementById('wsLabel');
    const pill = document.getElementById('livePill');
    const map = {
        live: { cls: 'connected', txt: 'Live Feed', pill: '⚡ LIVE', pc: 'var(--accent-green)' },
        reconnecting: { cls: 'disconnected', txt: 'Connecting…', pill: '⏳ LOADING', pc: 'var(--accent-yellow)' },
        error: { cls: 'disconnected', txt: 'Retrying…', pill: '⚠ MARKET HRS', pc: 'var(--accent-red)' },
    };
    const s = map[state] || map.reconnecting;
    dot.className = 'dot ' + s.cls;
    label.textContent = s.txt;
    pill.textContent = s.pill;
    pill.style.color = s.pc;
}

// =====================================================================
// CHART INIT (v5 API)
// =====================================================================
function initChart() {
    const container = document.getElementById('chartContainer');
    container.innerHTML = '';
    aiMarkers = []; candles = []; drawStart = null;
    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,
        layout: { background: { color: '#0a0e1a' }, textColor: '#94a3b8', fontFamily: 'Inter, sans-serif' },
        grid: { vertLines: { color: '#1e2d47' }, horzLines: { color: '#1e2d47' } },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: { color: '#3b82f6', labelBackgroundColor: '#3b82f6' },
            horzLine: { color: '#3b82f6', labelBackgroundColor: '#3b82f6' },
        },
        rightPriceScale: { borderColor: '#1e2d47' },
        timeScale: { borderColor: '#1e2d47', timeVisible: true },
    });
    candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: '#10b981', downColor: '#ef4444',
        borderUpColor: '#10b981', borderDownColor: '#ef4444',
        wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });
    chart.subscribeClick((param) => {
        if (!drawMode || !param.time) return;
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (!drawStart) { drawStart = { time: param.time, price }; }
        else { addTrendLine(drawStart, { time: param.time, price }); drawStart = null; }
    });
    window.addEventListener('resize', () => {
        if (chart) chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
}

// =====================================================================
// DRAWING TOOLS
// =====================================================================
function toggleDraw() {
    drawMode = !drawMode; drawStart = null;
    document.getElementById('drawBtn').classList.toggle('active', drawMode);
    document.getElementById('chartContainer').style.cursor = drawMode ? 'crosshair' : 'default';
}
function addTrendLine(p1, p2) {
    const tl = chart.addSeries(LightweightCharts.LineSeries, {
        color: '#f59e0b', lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed,
        crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false,
    });
    tl.setData([
        { time: Math.min(p1.time, p2.time), value: p1.time < p2.time ? p1.price : p2.price },
        { time: Math.max(p1.time, p2.time), value: p1.time < p2.time ? p2.price : p1.price },
    ]);
    trendLines.push(tl);
}
function clearDrawings() {
    trendLines.forEach(tl => chart.removeSeries(tl));
    trendLines = []; drawStart = null; drawMode = false;
    document.getElementById('drawBtn').classList.remove('active');
    document.getElementById('chartContainer').style.cursor = 'default';
}
function toggleAiOverlay() {
    aiOverlayOn = document.getElementById('aiOverlay').checked;
    if (!aiOverlayOn && candleSeries) { aiMarkers = []; candleSeries.setMarkers([]); }
}
function toggleAutoTrade() {
    autoTradeEnabled = document.getElementById('autoTradeSwitch').checked;
    const row = document.getElementById('autoTradeSwitch').closest('.auto-toggle-row');
    row.querySelector('.auto-label').style.color = autoTradeEnabled ? 'var(--accent-green)' : 'var(--text-muted)';
    addAgentLog(autoTradeEnabled ? '🤖 AGENT ON' : '⏸ AGENT OFF',
        autoTradeEnabled ? 'Autonomous trading enabled' : 'Manual mode — agent analysis still running', 'muted');
}

// =====================================================================
// SYMBOL SWITCHING
// =====================================================================
function switchSymbol(sym, btn) {
    currentSymbol = sym;
    isCrypto = CRYPTO_SYMBOLS.includes(sym);
    isIndian = isIndianStock(sym);
    document.querySelectorAll('.sym-btn').forEach(b => b.classList.remove('active'));
    (btn || document.querySelector(`.sym-btn[data-sym="${sym}"]`))?.classList.add('active');
    trendLines = []; aiMarkers = []; drawStart = null; drawMode = false;
    document.getElementById('drawBtn').classList.remove('active');
    if (stockPollTimer) { clearInterval(stockPollTimer); stockPollTimer = null; }
    if (binanceWS) { try { binanceWS.close(); } catch (e) { } binanceWS = null; }
    agentLog = [];
    renderAgentLog();
    initChart();
    if (isCrypto) connectBinance(sym); else startStockFeed(sym);
}

// =====================================================================
// RENDER: SIGNAL PANEL (reflects real TA scores)
// =====================================================================
function renderSignalFromAnalysis({ action, reason, buySignals, sellSignals, score }) {
    const sv = document.getElementById('signalValue');
    sv.textContent = action;
    sv.className = 'signal-value ' + (action === 'WAIT' ? 'HOLD' : action);

    const total = buySignals.length + sellSignals.length || 1;
    const buyPct = buySignals.length / total;
    const sellPct = sellSignals.length / total;
    const holdPct = Math.max(0, 1 - buyPct - sellPct);

    document.getElementById('signalConfidence').textContent =
        `${buySignals.length}↑ BUY · ${sellSignals.length}↓ SELL signals`;
    document.getElementById('buyBar').style.width = (buyPct * 100) + '%';
    document.getElementById('sellBar').style.width = (sellPct * 100) + '%';
    document.getElementById('holdBar').style.width = (holdPct * 100) + '%';

    // Update agent score badge
    const scoreEl = document.getElementById('agentScore');
    if (scoreEl) {
        scoreEl.textContent = score >= 0 ? `+${score}` : `${score}`;
        scoreEl.className = 'agent-score ' + (score > 0 ? 'bull' : score < 0 ? 'bear' : 'neutral');
    }
}

// =====================================================================
// RENDER: PORTFOLIO
// =====================================================================
function renderPortfolio() {
    const val = getPortfolioValue();
    const pnl = val - INITIAL_CASH;
    const pct = (pnl / INITIAL_CASH * 100).toFixed(2);
    const cur = getCurrency(currentSymbol);
    document.getElementById('portfolioValue').textContent = cur + val.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const pEl = document.getElementById('portfolioPnl');
    pEl.textContent = `${pnl >= 0 ? '+' : ''}${cur}${Math.abs(pnl).toLocaleString('en-IN', { maximumFractionDigits: 2 })} (${pct}%)`;
    pEl.className = 'portfolio-pnl' + (pnl < 0 ? ' red' : '');
    if (val > portfolio.peakValue) portfolio.peakValue = val;
    document.getElementById('maxDrawdown').textContent =
        ((portfolio.peakValue - val) / portfolio.peakValue * 100).toFixed(2) + '%';
    equity.push(val); if (equity.length > 100) equity.shift();
    renderEquityCurve();
    renderDemoGoal(pnl);
}

function getPortfolioValue() {
    return portfolio.cash + Object.entries(portfolio.holdings)
        .reduce((sum, [sym, h]) => sum + h.shares * (livePrices[sym] || 0), 0);
}

// =====================================================================
// RENDER: HOLDINGS
// =====================================================================
function renderHoldings() {
    const el = document.getElementById('holdingsList');
    const entries = Object.entries(portfolio.holdings).filter(([, h]) => h.shares > 0);
    if (!entries.length) { el.innerHTML = '<div class="empty-state">No active positions</div>'; return; }
    el.innerHTML = entries.map(([sym, h]) => {
        const liveP = livePrices[sym] || h.avgCost;
        const val = h.shares * liveP;
        const pnl = val - h.shares * h.avgCost;
        const pct = (pnl / (h.shares * h.avgCost) * 100).toFixed(2);
        const label = getSymLabel(sym);
        const cur = getCurrency(sym);
        const slPrice = (h.avgCost * (1 - STOP_LOSS_PCT)).toFixed(2);
        const tpPrice = (h.avgCost * (1 + TAKE_PROFIT_PCT)).toFixed(2);
        return `<div class="holding-row">
      <div>
        <div class="holding-sym">${label}</div>
        <div class="holding-shares">${h.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })} units</div>
        <div class="holding-sl-tp">SL ${cur}${slPrice} · TP ${cur}${tpPrice}</div>
      </div>
      <div>
        <div class="holding-val">${cur}${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
        <div class="holding-pnl ${pnl >= 0 ? 'green' : 'red'}">${pnl >= 0 ? '+' : ''}${pct}%</div>
      </div>
    </div>`;
    }).join('');
}

// =====================================================================
// RENDER: TRADE LOG
// =====================================================================
function logTrade(type, sym, shares, price, pnl) {
    const label = getSymLabel(sym);
    const cur = getCurrency(sym);
    trades.unshift({ type, sym: label, shares, price, pnl, cur });
    if (trades.length > 20) trades.pop();
    renderTradeLog();
}
function renderTradeLog() {
    document.getElementById('tradeLog').innerHTML = trades.map(t => `
    <div class="trade-row">
      <span class="trade-type ${t.type}">${t.type}</span>
      <span>${t.sym}</span>
      <span class="${t.pnl != null ? (t.pnl >= 0 ? 'green' : 'red') : ''}" style="font-family:var(--font-mono);font-size:10px">
        ${t.pnl != null ? (t.pnl >= 0 ? '+' : '') + t.cur + Math.abs(t.pnl).toFixed(2) : '@' + t.cur + t.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </span>
    </div>`).join('');
}

// =====================================================================
// RENDER: STATS
// =====================================================================
function renderStats() {
    const wr = stats.total === 0 ? '--' : (stats.wins / stats.total * 100).toFixed(1) + '%';
    document.getElementById('winRate').textContent = wr;
    document.getElementById('totalTrades').textContent = stats.total;
    if (equity.length > 2) {
        const rets = equity.slice(1).map((v, i) => (v - equity[i]) / equity[i]);
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const std = Math.sqrt(rets.map(r => (r - mean) ** 2).reduce((a, b) => a + b, 0) / rets.length) || 0.0001;
        document.getElementById('sharpeRatio').textContent = (mean / std * Math.sqrt(252)).toFixed(2);
    }
}

// =====================================================================
// MANUAL TRADE
// =====================================================================
function manualTrade(side) {
    const price = livePrices[currentSymbol];
    const sym = currentSymbol;
    const cur = getCurrency(sym);
    if (!price) { updateManualInfo('❌ No price available.', 'red'); return; }
    const qty = parseFloat(document.getElementById('tradeQty').value);
    if (!qty || qty <= 0) { updateManualInfo('❌ Enter a valid quantity.', 'red'); return; }

    if (side === 'BUY') {
        const cost = qty * price;
        if (cost > portfolio.cash) { updateManualInfo(`❌ Need ${cur}${cost.toFixed(2)} (have ${cur}${portfolio.cash.toFixed(2)})`, 'red'); return; }
        portfolio.cash -= cost;
        const h = portfolio.holdings[sym] || { shares: 0, avgCost: 0 };
        const tot = h.shares + qty;
        h.avgCost = ((h.avgCost * h.shares) + (price * qty)) / tot;
        h.shares = tot;
        portfolio.holdings[sym] = h;
        if (!portfolio.entryPrices[sym]) portfolio.entryPrices[sym] = price;
        logTrade('BUY', sym, qty, price, null);
        updateManualInfo(`✅ Bought ${qty} @ ${cur}${price.toFixed(2)}`, 'green');
        addAgentLog('👤 MANUAL BUY', `${qty} ${getSymLabel(sym)} @ ${cur}${price.toFixed(2)}`, 'green');
    } else {
        const h = portfolio.holdings[sym];
        if (!h || h.shares < qty) { updateManualInfo(`❌ Only ${h?.shares?.toFixed(4) || 0} available`, 'red'); return; }
        const pnl = (price - h.avgCost) * qty;
        portfolio.cash += qty * price;
        h.shares -= qty;
        if (h.shares <= 0.000001) { delete portfolio.holdings[sym]; delete portfolio.entryPrices[sym]; }
        if (pnl > 0) stats.wins++; else stats.losses++;
        stats.total++;
        logTrade('SELL', sym, qty, price, pnl);
        updateManualInfo(`✅ Sold ${qty} | PnL: ${pnl >= 0 ? '+' : ''}${cur}${pnl.toFixed(2)}`, pnl >= 0 ? 'green' : 'red');
        addAgentLog('👤 MANUAL SELL', `PnL: ${pnl >= 0 ? '+' : ''}${cur}${pnl.toFixed(2)}`, pnl >= 0 ? 'green' : 'red');
    }
    renderPortfolio(); renderHoldings(); renderStats();
}
function updateManualInfo(msg, color) {
    const el = document.getElementById('manualInfo');
    el.textContent = msg;
    el.style.color = color === 'green' ? 'var(--accent-green)' : color === 'red' ? 'var(--accent-red)' : 'var(--text-muted)';
}

// =====================================================================
// DEMO GOAL
// =====================================================================
function renderDemoGoal(totalPnl) {
    const cur = getCurrency(currentSymbol);
    const pct = Math.max(0, Math.min(totalPnl / DEMO_GOAL * 100, 100));
    document.getElementById('goalAmount').textContent = `${cur}${totalPnl.toFixed(2)} / ${cur}${DEMO_GOAL}`;
    document.getElementById('goalBarFill').style.width = pct + '%';
    const statusEl = document.getElementById('goalStatus');
    if (totalPnl >= DEMO_GOAL && !goalAchieved) {
        goalAchieved = true;
        statusEl.textContent = `🎉 GOAL REACHED! +${cur}${DEMO_GOAL} Profit!`;
        statusEl.style.color = 'var(--accent-green)';
        showGoalCelebration(cur);
    } else if (!goalAchieved) {
        const remaining = (DEMO_GOAL - totalPnl).toFixed(2);
        statusEl.textContent = totalPnl < 0
            ? `📉 Down ${cur}${Math.abs(totalPnl).toFixed(2)} — keep trading!`
            : `${cur}${remaining} to goal`;
        statusEl.style.color = totalPnl >= 0 ? 'var(--accent-cyan)' : 'var(--accent-red)';
    }
}
function showGoalCelebration(cur) {
    const overlay = document.createElement('div');
    overlay.className = 'goal-celebration';
    overlay.innerHTML = `
    <div class="goal-cel-box">
      <div class="cel-icon">🏆</div>
      <div class="cel-title">Demo Goal Achieved!</div>
      <div class="cel-sub">AI earned +${cur || '$'}${DEMO_GOAL} profit on paper trading</div>
      <div class="cel-sub" style="color:var(--accent-cyan);margin-top:6px">Model is ready for live validation</div>
      <button class="cel-close" onclick="this.closest('.goal-celebration').remove()">Continue Trading →</button>
    </div>`;
    document.body.appendChild(overlay);
    setTimeout(() => overlay?.remove(), 8000);
}

// =====================================================================
// INDICATORS (display row)
// =====================================================================
function updateIndicators() {
    if (candles.length < 26) return;
    const ind = computeIndicators();
    if (!ind) return;
    const { rsi, macdLine, ma20, price } = ind;
    const rEl = document.getElementById('rsiPill');
    rEl.textContent = `RSI: ${rsi.toFixed(1)}`;
    rEl.style.color = rsi > 70 ? '#ef4444' : rsi < 30 ? '#10b981' : '#94a3b8';
    const mEl = document.getElementById('macdPill');
    mEl.textContent = `MACD: ${macdLine.toFixed(2)}`;
    mEl.style.color = macdLine > 0 ? '#10b981' : '#ef4444';
    document.getElementById('bbPill').textContent = `BB%: ${(ind.bbPct * 100).toFixed(0)}%`;
    document.getElementById('vwapPill').textContent = `MA20: $${ma20.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// =====================================================================
// TICKER BAR
// =====================================================================
function renderTickers() {
    const allSyms = [...CRYPTO_SYMBOLS, ...STOCK_SYMBOLS, ...NSE_SYMBOLS];
    document.getElementById('tickerRow').innerHTML = allSyms.map(sym => {
        const p = livePrices[sym];
        if (!p) return '';
        const label = getSymLabel(sym);
        const cur = getCurrency(sym);
        return `<div class="ticker-item" onclick="switchSymbol('${sym}',null)">
      <span class="ticker-sym">${label}</span>
      <span class="ticker-price">${cur}${p.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
    </div>`;
    }).join('');
}

// =====================================================================
// PRICE DISPLAY
// =====================================================================
function updatePriceDisplay(candle) {
    const prev = candles[candles.length - 2]?.close || candle.open;
    const chg = candle.close - prev;
    const pct = (chg / prev * 100).toFixed(2);
    const cur = getCurrency(currentSymbol);
    document.getElementById('currentPrice').textContent =
        cur + candle.close.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    const pEl = document.getElementById('priceChange');
    pEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)} (${pct}%)`;
    pEl.className = 'price-change ' + (chg >= 0 ? 'up' : 'down');
}

// =====================================================================
// EQUITY CURVE
// =====================================================================
function renderEquityCurve() {
    const canvas = document.getElementById('equityCanvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (equity.length < 2) return;
    const min = Math.min(...equity), max = Math.max(...equity), range = max - min || 1;
    const pts = equity.map((v, i) => ({ x: (i / (equity.length - 1)) * w, y: h - ((v - min) / range) * (h - 10) - 5 }));
    const isUp = equity[equity.length - 1] >= INITIAL_CASH;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, isUp ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
    ctx.strokeStyle = isUp ? '#10b981' : '#ef4444'; ctx.lineWidth = 2; ctx.stroke();
}

// =====================================================================
// TRAINING SIM (visual only — not used for decisions)
// =====================================================================
function simulateTraining() {
    if (epoch >= 100) return;
    epoch++; trainLoss = Math.max(0.04, trainLoss - Math.random() * 0.018); trainAcc = Math.min(0.97, trainAcc + Math.random() * 0.011);
    document.getElementById('epochNum').textContent = `${epoch} / 100`;
    document.getElementById('progressFill').style.width = epoch + '%';
    document.getElementById('lossVal').textContent = trainLoss.toFixed(4);
    document.getElementById('accVal').textContent = (trainAcc * 100).toFixed(1) + '%';
    if (epoch >= 100) document.getElementById('aiStatus').innerHTML = '<span class="pulse-dot"></span><span>Agent: LIVE</span>';
}

// =====================================================================
// NEWS
// =====================================================================
let newsIdx = 0;
function addNews() {
    const item = NEWS_POOL[newsIdx++ % NEWS_POOL.length];
    const el = document.getElementById('newsFeed');
    const div = document.createElement('div');
    div.className = `news-item ${item.type}`;
    div.innerHTML = `<div>${item.text}</div><div class="news-time">${new Date().toLocaleTimeString()}</div>`;
    el.prepend(div); if (el.children.length > 6) el.lastChild.remove();
}

// PREFETCH STOCK + NSE TICKERS
async function prefetchStockPrices() {
    for (const sym of [...STOCK_SYMBOLS, ...NSE_SYMBOLS]) {
        if (livePrices[sym]) continue;
        try {
            const url = `${YF_BASE}${sym}?interval=1m&range=1d&includePrePost=false`;
            const res = await fetch(YF_PROXY + encodeURIComponent(url));
            const data = await res.json();
            const q = data?.chart?.result?.[0]?.indicators?.quote?.[0];
            if (q) { const c = q.close.filter(Boolean); if (c.length) { livePrices[sym] = c[c.length - 1]; renderTickers(); } }
        } catch (e) { }
        await new Promise(r => setTimeout(r, 600));
    }
}

// =====================================================================
// BUDGET MODAL
// =====================================================================
function showBudgetModal() {
    document.getElementById('budgetModal').style.display = 'flex';
}

function startApp() {
    const raw = parseFloat(document.getElementById('budgetInput').value);
    if (!raw || raw <= 0) { document.getElementById('budgetError').textContent = '⚠ Enter a valid amount'; return; }
    const cur = document.getElementById('budgetCurrency').value;

    INITIAL_CASH = raw;
    DEMO_GOAL = Math.max(1, parseFloat((raw * 0.1).toFixed(2)));  // goal = 10% of budget

    portfolio = { cash: INITIAL_CASH, holdings: {}, peakValue: INITIAL_CASH, entryPrices: {} };
    equity = [INITIAL_CASH];
    goalAchieved = false;

    // --- Read Groq config ---
    const groqToggleEl = document.getElementById('groqToggle');
    groqEnabled = groqToggleEl?.checked || false;
    if (groqEnabled) {
        const key = document.getElementById('groqApiKey')?.value?.trim();
        if (!key) {
            document.getElementById('budgetError').textContent = '⚠ Enter your Groq API key or disable Groq';
            return;
        }
        GROQ_API_KEY = key;
        GROQ_MODEL = document.getElementById('groqModel')?.value || 'openai/gpt-oss-120b';
        groqLiveEnabled = true;
        // Show Groq badge + insight panel
        document.getElementById('groqBadge').style.display = 'flex';
        document.getElementById('groqSection').style.display = 'block';
        document.getElementById('groqModelTag').textContent = GROQ_MODEL;
    }

    // If INR currency selected, default to JSW Steel
    const defaultSym = (cur === '₹') ? 'JSWSTEEL.NS' : 'BTCUSDT';

    document.getElementById('budgetModal').style.display = 'none';
    document.getElementById('portfolioValue').textContent = cur + raw.toLocaleString('en-IN');
    document.getElementById('goalAmount').textContent = `${cur}0 / ${cur}${DEMO_GOAL}`;
    document.getElementById('goalStatus').textContent = `Trade to earn ${cur}${DEMO_GOAL} profit`;

    if (groqEnabled) addAgentLog('🧠 GROQ READY', `Model: ${GROQ_MODEL}`, 'cyan');

    bootApp(defaultSym);
}

function bootApp(defaultSym) {
    switchSymbol(defaultSym, null);
    setWsStatus('reconnecting');
    addNews();
    setInterval(addNews, 8000);
    setInterval(() => {
        document.getElementById('timeDisplay').textContent =
            new Date().toLocaleTimeString('en-IN', { hour12: false });
    }, 1000);
    if (!CRYPTO_SYMBOLS.includes(defaultSym)) startStockFeed(defaultSym);
    prefetchStockPrices();
}

// =====================================================================
// BOOT
// =====================================================================
window.addEventListener('load', () => {
    initChart();        // chart init before modal
    showBudgetModal();
});
