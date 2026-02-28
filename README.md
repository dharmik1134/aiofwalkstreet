# 📈 AiofWalkStreet

**AiofWalkStreet** is an autonomous, open-source AI trading platform designed to run in your browser. It combines pure Technical Analysis (TA) logic with state-of-the-art open-source LLM reasoning powered by **Groq**.

## 🚀 Key Features

- **Local Technical Analysis Engine:** Built-in calculation of indicators like RSI, MACD, Moving Averages (MA9, MA21, MA50, MA200), and Bollinger Bands — running entirely client-side.
- **Strict Consensus Execution:** The core TA agent requires at least two indicator signals to align (e.g., RSI Oversold + MACD Bullish Crossover) before making a trade, minimizing false signals.
- **Groq LLM Co-Pilot:** Optionally connect to Groq utilizing models like **openai/gpt-oss-120b**. The AI pulls live TA data to build consensus and override or confirm trades dynamically.
- **Paper Trading Interface:** Set virtual capital (USD or INR), monitor active holdings, view P&L, and track an equity curve over time seamlessly without risking real capital.

## 🛠 Setup & Usage

Since it runs primarily via client-side JavaScript, you don't need databases or backend servers.

1. **Clone the Repo**
   ```bash
   git clone https://github.com/dharmik1134/AiofWalkStreet.git
   cd AiofWalkStreet
   ```

2. **Run a Local Server**
   (Due to browser privacy restrictions on `file:///`, it works best through a local HTTP server.)
   ```bash
   python -m http.server 5500
   ```
   *Then open `http://localhost:5500` in your web browser.*

3. **Configure Your Session**
   - Select your virtual currency ($ or ₹).
   - Enter your starting virtual capital.
   - **Optional:** Enable the "Groq Reasoning Model" toggle.
   - Enter a free API key from [Groq Console](https://console.groq.com).
   - Click **Start Trading**.

## 🧠 How the Groq Co-Pilot Works

When enabled, the frontend builds a highly structured system prompt containing current stock and crypto symbols alongside real-time TA measurements. It feeds this to the chosen Groq open-source model. 

The AI responds strictly with:
- **Action:** `[BUY]`, `[SELL]`, or `[HOLD]`.
- **Reason:** A concise single-sentence justification on why it made its decision based purely on the technicals provided.

## 🔒 Security

- **API Keys:** Your Groq API key is stored locally in device memory while the tab is open and is **never** synchronized, kept, or uploaded. 

