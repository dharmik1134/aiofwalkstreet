# AegisAI — Project Changelog & Handoff Notes
**Project:** AegisAI — AI Paper Trading Platform
**Author:** Dharmik (Product)
**CoAuthor:** Tanmay(Idea)
**Built by:** Antigravity (AI Pair Programmer)
**Location:** `D:\TradingXD\`
**Server:** `python -m http.server 3000` in `D:\TradingXD\` → open [http://localhost:3000](http://localhost:3000)
**Session Date:** 2026-02-27

---

## 📁 File Structure

```
D:\TradingXD\
├── index.html       — Main UI shell (navbar, sidebar, chart area, right panel)
├── app.js           — All trading logic, data feeds, agent engine
├── style.css        — Dark-theme design system (~1150 lines)
└── CHANGELOG.md     — This file
```

---

## 🔄 Full Version History

### v1.0 — Initial Demo (Session Start)
- **Who:** Dharmik requested, Antigravity built
- Basic candlestick chart using TradingView Lightweight Charts
- Simulated prices for NVDA and TSLA (no real data)
- Simple random AI signal (BUY/SELL/HOLD prediction meter)
- $100M virtual paper portfolio, trade log, equity curve
- Dark mode glassmorphism UI with Inter + JetBrains Mono fonts

---

### v2.0 — Live Charting Library Upgrade
- **Trigger:** User linked [https://github.com/tradingview/lightweight-charts](https://github.com/tradingview/lightweight-charts)
- Upgraded from v4 to **Lightweight Charts v5** API
  - Changed `chart.addCandlestickSeries()` → `chart.addSeries(CandlestickSeries)`
  - Changed `chart.addLineSeries()` → `chart.addSeries(LineSeries)`
- Added **Binance WebSocket** → real-time 1-minute candle feed for BTC, ETH, SOL, BNB
- NVDA and TSLA remained simulated (labelled SIM)
- Added ✏️ **Trend Line drawing tool** — click two chart points to draw a dashed line
- Added 🗑️ Clear button to remove drawings
- WebSocket status indicator (green dot = live, yellow = reconnecting)
- LIVE/SIM symbol group labels in the selector

---

### v3.0 — All Symbols Live (NYSE Real Data)
- **Trigger:** User: "i want live for all stocks"
- Added **Yahoo Finance v8 API** via `api.allorigins.win` CORS proxy
  - Fetches real 1-minute OHLCV candles for NVDA, TSLA, AAPL, MSFT
  - Polls every **15 seconds** for latest candle (REST, no WS for stocks)
  - Works during NYSE market hours: 9:30 AM–4:00 PM ET (7 PM–1:30 AM IST)
- Added **AAPL** and **MSFT** to the symbol list (4 NYSE stocks total)
- SIM label replaced with **NYSE** (cyan color)
- Prefetch loop loads ticker bar prices for non-active symbols on boot
- Python HTTP server required: `python -m http.server 3000` (file:// URLs block WebSocket)

---

### v3.1 — Manual Trade Controls + Demo Goal
- **Trigger:** User: "add buy sell button and toggle switch for auto simulation"
- Added **▲ BUY / ▼ SELL** manual trade buttons with qty input field
- Added **Auto Trade (AI) toggle switch** — disables AI auto-trading when OFF
- Added **🎯 Demo Goal** tracker: `$X / $100` with animated gradient progress bar
- Added **🏆 Celebration Overlay** when $100 profit is reached (animated popup)
- Agent updates `manualInfo` status line after every trade (✅ or ❌)
- Holdings now show SL/TP prices per position
- CSS: toggle switch, BUY/SELL buttons, goal box, celebration animation

---

### v4.0 — Real Technical Analysis Agent (Current Version)
- **Trigger:** User: "create an agent that does all thing, don't rely on prediction meter"
- **Completely removed** the random prediction engine (`aiPredict()` with noise)
- Built **pure TA agent** in `app.js`:

  | Indicator | Logic |
  |---|---|
  | **RSI (14)** | < 30 → oversold (BUY), > 70 → overbought (SELL) |
  | **MACD (12,26,9)** | Signal line crossover → BUY/SELL, positive/negative bias |
  | **MA9 / MA21** | Golden cross (BUY), Death cross (SELL), trend bias |
  | **Bollinger Bands (20,2σ)** | Price < Lower BB → squeeze buy, > Upper BB → sell |

- **Minimum 2 signals** must agree before any trade fires (`MIN_SIGNALS = 2`)
- **Position management:**
  - Stop-loss: **−2%** from entry → auto-exits position
  - Take-profit: **+3%** from entry → auto-locks gains
- **Agent Reasoning Log** — timestamped entries for every decision (🟢 BUY / 🔴 SELL / 🛑 STOP / ✅ TP / 🔍 SCAN)
- **Agent Score badge** next to panel header (e.g. `+3` in green = bullish bias)
- Signal bar now shows real TA signal counts (not fake confidence %)
- `checkPositionManagement()` called on every new candle before analysis
- Holdings card now shows SL and TP price targets

---

## 🚀 How to Resume Tomorrow

### 1. Start the local server
```powershell
cd D:\TradingXD
python -m http.server 3000
```
Then open: **http://localhost:3000**

### 2. What to test first
- [ ] BTC chart loads (Binance WebSocket green dot in top-right)
- [ ] Switch to NVDA — chart loads 1-min candles from Yahoo Finance
- [ ] Watch "Agent Reasoning" panel (right side) for 🔍 SCAN entries
- [ ] When RSI < 30 or MACD crossover fires → agent auto-BUYs
- [ ] Buy 100 BTC manually to quickly hit the $100 Demo Goal
- [ ] Stop-loss fires if position drops 2%

### 3. Known limitations to fix next session
- [ ] **NVDA/TSLA may show "No price available"** outside NYSE hours (9:30 AM–4 PM ET). Normal — only historical candles load, no live updates until market opens.
- [ ] **CORS errors** in console for Yahoo Finance — harmless, allorigins proxy handles it. Consider switching to a paid API (Finnhub free tier) for reliability.
- [ ] **Agent doesn't trade multiple symbols simultaneously** — only trades whichever symbol is currently active in the chart view.
- [ ] **No persistence** — portfolio resets to $100M on page refresh. Next: add `localStorage` save/restore.
- [ ] **Training progress bar** is visual only — not real ML. Consider adding actual model training (TensorFlow.js) in future.

### 4. Ideas for next session (in priority order)
1. **Portfolio persistence** — save to `localStorage` so refresh doesn't reset trades
2. **Multi-symbol agent** — run agent on all symbols simultaneously, not just the active chart
3. **Backtesting mode** — run agent on historical data and show P&L curve
4. **Real ML model** — TensorFlow.js LSTM trained on OHLCV data
5. **Alerts/notifications** — browser notification when agent fires a trade
6. **Performance report page** — full breakdown of all trades, win/loss by symbol

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Charts | TradingView Lightweight Charts v5 |
| Crypto data | Binance WebSocket + REST API (free, no key) |
| Stock data | Yahoo Finance v8 API via allorigins.win CORS proxy (free, no key) |
| TA Engine | Custom JS: RSI, EMA, MACD, Bollinger Bands |
| Fonts | Google Fonts — Inter (UI) + JetBrains Mono (numbers) |
| Server | Python `http.server` on port 3000 |
| Framework | Vanilla HTML + CSS + JS (no build step, no npm) |

---

*Last updated: 2026-02-27 22:43 IST*

---

### v5.0 — NSE/BSE Indian Stocks · ₹ Currency · Custom Budget Modal
- **Session Date:** 2026-02-28
- **Trigger:** User: "add nse and bse also in rupees and add option in start that give you your paper budget"

#### New Symbols Added (NSE via Yahoo Finance `.NS`)
| Ticker | Name |
|---|---|
| `JSWSTEEL.NS` | JSW Steel |
| `RELIANCE.NS` | Reliance Industries |
| `TCS.NS` | Tata Consultancy Services |
| `INFY.NS` | Infosys |

#### New Features (app.js — v5 complete)
- Added `NSE_SYMBOLS`, `NSE_LABELS` arrays
- Added helper functions: `isIndianStock()`, `getCurrency()`, `getSymLabel()`
- **Dynamic currency** — all price displays, trade logs, holdings, SL/TP, PnL now show `₹` for Indian stocks and `$` for Crypto/NYSE
- **Startup Budget Modal** (`showBudgetModal()` / `startApp()`):
  - User enters any amount (e.g. ₹10) and selects currency (₹ or $)
  - `INITIAL_CASH` set to entered value
  - `DEMO_GOAL` auto-set to 10% of budget
  - If ₹ selected → defaults to JSW Steel chart on start
- `prefetchStockPrices()` now also fetches all NSE symbols for ticker bar
- `renderTickers()` shows ₹ for Indian stocks
- `renderPortfolio()`, `renderHoldings()`, `logTrade()`, `manualTrade()`, `checkPositionManagement()` all use dynamic currency
- Equity curve `isUp` comparison uses `INITIAL_CASH` (not hardcoded $100M)

#### Pending (index.html + style.css — session stopped before completing)
- [ ] Add NSE symbol buttons in chart selector
- [ ] Add startup budget modal HTML to `index.html`
- [ ] Add modal overlay CSS to `style.css`

---

*Last updated: 2026-02-28 09:43 IST*
*Session stopped at user request — resume from "Pending" items above.*
