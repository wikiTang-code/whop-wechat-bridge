# Whop WeChat Bridge & Quant Trader

项目主要功能：作为订阅者 Polling 监听 Whop Chat 频道消息，提取特定发言人（大V）的信息，通过 AI（支持 Gemini, Ollama, LM Studio）进行市场策略深度提炼，实时推送精美 Markdown 报告至企业微信机器人，并支持沙盒模拟及券商实盘跟单自动执行。

---

## 🛠️ 常规启动与工作流步骤

在首次运行或排查配置问题时，推荐使用常规工作流完成配置、测试与部署：

### 第一步：安装依赖
确保项目根目录下安装了运行环境所需的 npm 包：
```bash
npm install
```

### 第二步：配置环境变量
在根目录 `.env` 文件中填写您的配置。核心配置项包含：
- `AI_PROVIDER`: 使用的 AI 模型商 (`gemini` | `ollama` | `lm-studio`)
- `WHOP_COOKIE` 与 `WHOP_CHAT_CHANNEL_ID`: 用于消息拉取的数据源凭证
- `TARGET_SPEAKER_USER_IDS`: 监控的大V用户 ID（逗号分隔）
- `WECHAT_WORK_WEBHOOK_URL`: 企业微信群机器人推送 Webhook 地址

### 第三步：运行系统诊断（测试）
在正式运行前，强烈建议运行自检脚本，它会依次检查 SQLite 本地库、Whop 接口连通性、本地/云端 AI 连接速率、跟单模拟柜台和微信机器人连通性：
```bash
npm test
```
*如果所有自检均显示 `✅`，说明您的基础配置完全正确。*

---

## 🚀 运行模式选择

项目支持前台开发运行和后台生产级守护运行两种模式：

### 1. 前台运行模式（适合开发调试）
如果想要查看实时的输出并调试代码，可以在当前终端前台运行：
```bash
npm start
```
*💡 注：如果在此模式下关闭命令行窗口或终端断开连接，服务将会中断。*

### 2. 后台守护运行模式（生产推荐，防崩溃，7x24h 运行）
为了保证实时性和长期稳定性，项目引入了 `PM2` 进程管理守护。您可以使用我们为您配置好的 NPM 脚本快捷管理后台任务：

*   **前提条件**：全局安装一次 `pm2`：
    ```bash
    npm install -g pm2
    ```

*   **后台启动服务**：
    ```bash
    npm run pm2:start
    ```
    *启动后，您可以安全地关闭终端，服务会在系统后台静默且持续工作。如果发生网络波动或意外崩溃，PM2 会秒级自动重启它。*

*   **查看后台状态**（运行时间、CPU、内存等）：
    ```bash
    npm run pm2:status
    ```

*   **查看实时运行日志**（可用来追踪 AI 的详细分析耗时与下单状态）：
    ```bash
    npm run pm2:logs
    ```

*   **重启后台服务**（修改配置或代码后）：
    ```bash
    npm run pm2:restart
    ```

*   **停止后台服务**：
    ```bash
    npm run pm2:stop
    ```

---

## 💼 赵哥实盘战役与人机协同持仓系统 (Human-in-the-loop Quant)

系统内置了针对大V第一人称实盘交易的**状态机推演引擎**与**置信度人机协同审核体系**：

### 1. 核心特性
- **纯净物理频道隔离**：持仓与交割单数据 100% 唯一提取自【历史股票期权记录区】(`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`)；
- **标的专属双消息池**：
  - **🟢 已计入持仓的实战流水**：基于 FIFO 算法实时计算持仓均价、市值与浮盈，展示动态推演轨迹（`操作前 -> 买卖变动 -> 操作后`）；
  - **📥 标的专属待确认消息池**：每个标的拥有独立候选池，展示置信度得分与原始发言；
- **秒级即时联动**：
  - 在实战流水中点击 `❌ 移入候选池`，该笔交易即刻移入该标的候选池，持仓股数与成本秒级重算更新；
  - 在候选池中点击 `✅ 移入持仓`，即刻激活计入持仓；
  - 顶部提供 `🔄 同步并保存记录` 按钮，支持全量持久化与模型训练权重同步。

---

## 💻 Web 管理 Dashboard
服务启动后（无论何种模式），都可以使用浏览器访问管理后台：
```
http://localhost:8085
```

> **安全说明**：Dashboard 已启用 HTTP Basic Auth 认证。首次访问时浏览器会弹出登录框，请输入 `.env` 中配置的 `DASHBOARD_USERNAME` 和 `DASHBOARD_PASSWORD`。系统内置 IP 速率限制（15分钟内最多10次失败尝试），防止暴力破解。

您可以在 Web Dashboard 上直观地查看：
- 大V的历史发言汇总
- AI 策略报告的生成时间与详细 Markdown 汇总内容
- 模拟交易的持仓、资金净值图表与交易历史
- 直接在页面修改配置（会自动同步到 `.env` 并重启后台任务）
- 下单和重置账户操作受 CSRF 令牌保护

### 🌐 公网访问（Cloudflare Tunnel）
服务启动后会自动创建 Cloudflare 快速隧道，无需域名或端口转发即可从公网访问。隧道地址会在启动日志中输出，也可通过 `npm run pm2:logs` 查看。如需固定域名，建议使用 Cloudflare Named Tunnel 或 Nginx 反向代理。

---

## 📈 本机 GEX sidecar（不部署到 GCP）

期权 NetGEX 拉链跑在 Windows：富途 OpenD 拉链 + 长桥 CLI 补指数现货，写出 `data/gex/latest.json`。交易仍走长桥 OpenAPI，不要把 OpenD 搬上云。

思路来自长桥帖 [做末日的兄弟看过来！基于 longbridge CLI 实现 @LongbridgeAI](https://longbridge.com/zh-CN/topics/43511616?channel=OWNN00030)：[heatseeker-lb](https://github.com/NineLooms/heatseeker-lb)（SPY/QQQ 热图）、[gex-matrix-lb](https://github.com/NineLooms/gex-matrix-lb)（个股 GEX 矩阵）。

v1 样例 `data/gex/latest.json` 已是富途 OpenD 成功拉链（`source=futu-opend`，`errors=[]`），不是长桥 OPRA 失败空壳。

```powershell
pip install -r tools/gex-sidecar/requirements.txt
$env:PYTHONIOENCODING='utf-8'
$env:LONGBRIDGE_REGION='global'
python tools/gex-sidecar/collect_futu.py
python tools/gex-sidecar/summarize.py
```

环境变量模板：`tools/gex-sidecar/env.example`。读图与 JSON 字段：`tools/gex-sidecar/README.md`。接入边界：`docs/gex-sidecar.md`。

---

## 交互式点位 K 线图看板 (Level Chart)

基于 Plotly 离线渲染的交互式美股 K 线图，深度融合多源点位数据（GEX 矩阵、波动哥日内点位、SPXL 3x 杠杆非线性映射与交易员手动标记），支持图层分组显隐与日内最近上下支撑阻力实时距离测算。

### 核心特性
- **周期无缝切换**：内嵌日线 (1D) 与 1 小时线 (1H) 按钮，一键动态切换视图。
- **真离线独立渲染**：输出目录自动生成并共用本地 `plotly.min.js`，无外部 CDN 依赖，页面轻量且在离线环境可完整交互。
- **可插拔点位源协议 (`LevelSource`)**：
  - `GexLevelSource`：自动提取 0DTE / Matrix 快照中 KING（最负 Gamma 磁吸点）、FLOOR（正 Gamma 顶部阻尼）、前 3 大正墙及负墙（排除 KING/FLOOR 叠线，标注金额与到期日）。默认寻址最新快照，支持 `--snapshot` 手动覆盖复现。
  - `BodonggeLevelSource`：解析外部专家最新日内 5 档点位（支持环境变量 `BODONGGE_PATH` 配置），并在 SPXL 图上自动按 3x 公式非线性映射。
  - `SPXLMappingLevelSource`：动态依据参数生成并计算 `SPXL = base_spxl * (1 + factor * (SPX / base_spx - 1))` 关键锚点。
  - `ManualLevelSource`：支持在 `config/level_chart.yaml` 中随时追加自定义点位。
- **现价最近阻力/支撑高亮**：以最新收盘价为基准自动识别离现价最近的上下各一条关键线，加粗高亮并显示点数与百分比（快照 spot 作为参考展示）。
- **标的快速切换与防 404**：下拉列表仅列出实际已生成的标的，直达框输入未生成标的时给出指引提示，避免 404 错误。

### 依赖与运行
```bash
# 安装依赖 (建议 yfinance，跨平台开箱即用；kaleido 为可选无头图片渲染引擎，无需 Chrome)
pip install -r requirements-level-chart.txt

# 1. 运行核心验收标的 (SPY, SPX, SPXL, NVDA) 并导出 PNG 静态图 (可指定快照复现)
python scripts/level_chart.py --symbols SPY,SPX,SPXL,NVDA --snapshot data/gex/20261111/snapshot_20261111_081039.json --png

# 2. 绘制任意不在快照内的代码 (优雅降级只画 K 线与手动点位)
python scripts/level_chart.py --symbol PLTR --png

# 3. 运行全量单元测试 (基于 test/fixtures 纯相对路径独立样本)
python -m pytest test/test_level_chart.py
```
