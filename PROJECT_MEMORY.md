# Antigravity Project Context Memory: Whop WeChat Bridge & Quant Trader

This document serves as a context bootstrapper (project memory) for any AI coding assistant (like Antigravity or Gemini) opening this project. It outlines the architecture, decisions, and development roadmap established so far.

---

## 1. Project Goal & Target
- **Bridge Whop Chat to Enterprise WeChat (企业微信):** Periodically polls a Whop native chat channel (using personal bearer session tokens as a subscriber/buyer), filters messages from specific target speaker IDs (e.g., group owners/大V), and runs them through AI.
- **AI Financial Analyst:** AI summarizes the speaker's investment view, trading setups, option/stock parameters, stop loss/take profit levels, and posts a premium Markdown report to WeChat group robots.
- **Sandbox Paper-Trading Simulator:** The system parses structured trade signals and runs them through a local risk engine (position sizing, cash buffers, concentration limits), simulating orders in an SQLite database and printing portfolios/timeline feeds on a modern Web Dashboard.

---

## 2. Technical Stack
- **Backend:** Node.js (ES Modules, `"type": "module"`) + Express.
- **Database:** SQLite (`better-sqlite3` library). Database file is `whop_archive.db` in the root folder.
- **Frontend Panel:** Vanilla HTML + CSS + JS served in `/public` directory (sleek dark mode, glassmorphism, responsive grid, visual timeline, positions tab, manual trader, configurations manager).
- **Process Manager:** `pm2` for continuous running and automatic recovery on Windows host.
- **Containerization:** `Dockerfile` is prepared for deployment.

---

## 3. Core Architectural Decisions

### 3.1 AI Providers Support (Gemini, Ollama, LM Studio)
The system supports three AI engines, configurable in the `.env` settings:
1. **Google Gemini API (`gemini`):** For fast, high-quality, long-context reviews and multi-modal image chart analysis.
2. **Local Ollama API (`ollama`):** Free local LLM runs (e.g., `deepseek-r1`) utilizing ROCm GPU acceleration on host (AMD 7900XT).
3. **Local LM Studio API (`lm-studio`):** Standard OpenAI-compatible API (at `http://localhost:1234/v1`). Optimized for the local **`Qwen3.5 35B A3B Q5_K_M`** model, utilizing 20GB VRAM on the host's AMD 7900XT for ultra-fast, zero-cost reasoning.

### 3.2 Intelligent Adaptive Scheduler
To avoid spamming requests and rate limits during US stock quiet hours, `server.js` implements a dynamic timer:
- **Weekend Hibernation:** Pauses/slows down polling to once every 4 hours from Saturday 12:00 PM to Monday 7:00 AM (Beijing Time).
- **Weekday Backoff:** Starts at 5-minute intervals. If no new messages arrive, it backs off exponentially up to 30 minutes. If a new message is detected, it instantly resets to **3-minute high-frequency polling** to capture rapid, consecutive trades.

---

## 4. Database Table Schemas (SQLite)
- `messages`: Archived raw Whop messages.
- `reports`: Historic AI-generated markdown reports.
- `orders`: Paper-trading transaction logs (FILLED, REJECTED with risk failure reason, PENDING).
- `positions`: Active stock positions (quantity, avg entry price, current price, unrealized PnL).
- `portfolio`: Account metrics (stored key-values for cash, deposit).

---

## 5. Development Status & Next Steps
- **Version 1.0.0 Completed:**
  1. **Intelligent Polling & DB Archiving:** Full integration of Whop API messaging and sqlite3 storage.
  2. **Double AI Stage Pipeline:** Automatically generates a comprehensive Markdown report AND extracts structured JSON signals from Whop messages using Gemini/Ollama/LM Studio.
  3. **Auto & Sandbox Copy-Trading:** Auto-executes the extracted signals via the risk control check in `trading.js`. If in sandbox mode, updates sqlite portfolio; if in real-money mode, interfaces with the `longbridge` Node.js SDK.
  4. **Multi-Channel Alerts:** Pushes summaries, trade execution fills, and risk rejection warnings to WeChat Work webhook.
  5. **Premium Web Dashboard:** Seamless dark glassmorphic control center for real-time monitoring and parameter modifications.
- **Future Enhancements:**
  1. **uSMART API Integration:** Obtain SDK zip/HMAC signing credentials from the user to support uSMART execution.
  2. **Quantitative Backtesting (Python Integration):** Build a Python FastAPI helper service (using `Backtrader` or `vectorbt`) to audit strategies on historical chats archived in `whop_archive.db`.
