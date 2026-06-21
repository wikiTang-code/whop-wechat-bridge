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
  1. **uSMART API Integration**: Obtain SDK zip/HMAC signing credentials from the user to support uSMART execution.
  2. **Quantitative Backtesting (Python Integration)**: Build a Python FastAPI helper service (using `Backtrader` or `vectorbt`) to audit strategies on historical chats archived in `whop_archive.db`.

---

## 6. 部署环境与实机调试规则
- **云平台**: Google Cloud Platform (GCP) VM
- **SSH 访问**: `ssh gcp-vm`（SSH config 别名，调试和日志分析均在服务器上操作）
- **服务端口**: 8085，通过 Cloudflare Tunnel 暴露公网
- **远程调试**: 需要查看日志、排查问题时直接 SSH 到 GCP VM 操作
- **实机调试代码同步准则**: **在服务器上进行任何实机调试、日志排查或功能测试前，必须确保首先拉取并更新至最新代码**（通过 `git pull origin main`）。防止因代码版本不一致、前后端代码缓存等引起报错误判。
- **PM2 彻底重载环境变量规则**: **修改 `.env` 配置文件后，必须使用 `pm2 restart whop-wechat-bridge --update-env` 命令重启服务。** 普通的 `pm2 restart` 不会清除并更新内存中的环境变量缓存，会导致新的 API 密钥等配置无法生效。

---

## 7. 开发协作与提效规则
- **本地大模型并行分流**：在项目的开发、调试与策略研究过程中，若遇到耗时或数据量庞大的非实时任务（如大段代码的重构思路设计、历史数据分析、量化算法方案探索等），AI 助手应主动且优先将这些任务丢给本地运行的 LM Studio/Ollama 模型并行运行。这能充分榨干本地 AMD 7900 XT 的免代币（Zero-cost）硬件算力，大幅节省云端 API Token，同时提升 Pair Programming 的协同研发效率。
- **多 Agent 并行开发容错**：在同一项目或同一 VPS 的同一份本地文件上可能有多个 Agent 并行开发。为防范代码覆盖与工作冲突，必须严格执行以下容错准则：
  - **即时确认状态**：修改文件前必须先重新读取文件最新内容，确认当前最新状态。
  - **避免并发碰撞**：严禁多个 Agent 同时并发修改同一文件的不同部分。
  - **任务协调分工**：充分利用任务状态（Task/PM 等机制）协调分工，避免重复劳动。
  - **提交精细审核**：提交与推送前必须执行 `git diff` 仔细确认变更范围，确保不覆盖其他 Agent 已经提交的成果。
  - **关键操作互斥**：在执行关键破坏性或独占性操作（如部署上线、数据库迁移、服务重启）前，应先通过进程/日志/状态确认没有其他 Agent 正在执行该操作。
