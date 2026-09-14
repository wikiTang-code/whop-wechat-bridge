# 本机运维能力面：MCP / Skill / 企微 / UI 统一封装方案

> 状态：**联审已锁定。P0–P3 已落地（生产 C2 需 CLI human-approve HITL）。**  
> 范围：Windows 本机全部可执行能力 + **经 `ssh gcp-vm` 到达的生产全部操作**。  
> 非目标：把拉链/OpenD/OPRA 搬上 GCP；给 Agent 开任意远程 shell；自动跟单/自动 `pm2 restart`。  
> 锁定摘要见 **§13**。P0 完成定义见 **§8.1**。

---

## 0. 一句话

不要为每个脚本各做一个 MCP。在本机建一个 **Local Capability Gateway（能力网关）**：能力目录是唯一真相；MCP / Skill / 企微入站 / 小 UI 都只是适配器。生产侧不另装一套 Agent 运行时，一律 **本机网关 → 白名单 SSH 配方 → gcp-vm**。

---

## 1. 为什么要这样做

当前能力散落在：

| 位置 | 现状 | Agent 用法 |
|---|---|---|
| `tools/gex-sidecar/` | Python 拉链 + 计划任务 | 要记命令、路径、OpenD 前置 |
| `brokers/longbridge.js` | 交易 SDK | 只被跟单路径调用 |
| 富途 OpenD `:11111` | 本机行情/期权链 | 只有 sidecar 会连 |
| LM Studio + `lms` + `ssh -R` | 本机推理，反向映射到 VM `:8080` | 隧道断了要人手工修 |
| `public/` + `:8085` | 主看板 / `/monitoring` / GEX HTML / ticker | 要记 URL 和 Basic Auth |
| `ssh gcp-vm` + `scratch/gcp_*.sh` | 健康、日志、PM2、灰度、回滚 | 每次现场拼命令 |

结果：Cursor / Claude / Gemini 每次都重新发明命令；企微机器人只能出站推送、不能回控；SSH 一旦做成「任意远程执行」就会把生产打穿。

封装目标：

1. **同一套能力**给 Cursor Agent、Claude Agent、Gemini Agent、以后的移动端企微。
2. **生产功能全部可达**，但只通过配方，不通过裸 SSH。
3. **Skill 负责何时/如何解读；MCP 负责动手；Hook 负责拦住越权。**

---

## 2. 原则（审核请先批这些）

| ID | 原则 | 含义 |
|---|---|---|
| P1 | 目录单一真相 | 新增能力先改 `catalog.yaml`，再写 adapter，禁止各端各写一套 |
| P2 | 适配器无业务 | MCP / 企微 / UI 只翻译协议，不复制拉链或 PM2 逻辑 |
| P3 | SSH 是传输，不是工具 | 禁止 `ssh gcp-vm "<用户字符串>"`。只跑预注册配方，参数走枚举/正则 |
| P4 | 生产不跑 Agent 宿主 | gcp-vm 958MB，不装 MCP server、不装 IDE Agent |
| P5 | 分级默认拒绝 | C0 默认可调；C1 可调但审计；C2 需确认；C3/C4 对 Agent 默认关闭 |
| P6 | 继承现有红线 | R2：看门狗/软降级**绝不**自动 `pm2 restart`。**alert-sink / watchdog / 软降级不得调用任何 C2 配方**（含 `gcp.pm2_restart`）。C2 只接受人/确认 token，不是自愈通道 |
| P7 | 密钥不下发 | 返回值脱敏；不读 `.env` 原文给模型；SSH 用本机 `~/.ssh` 的 `gcp-vm` 别名 |
| P8 | 本地与云职责不变 | GEX/OpenD/LM 永留 Windows；云端只消费 JSON / 走既有 HTTP |

---

## 3. 目标架构

```
 Cursor / Claude / Gemini          企微手机           本机小 UI / 看板「运维」页
        │ MCP stdio/HTTP              │ 应用回调            │ 127.0.0.1 HTTP
        ▼                             ▼                     ▼
   MCP Adapter                 WeCom Adapter            HTTP Adapter
        └──────────────┬──────────────┴─────────────────────┘
                       ▼
            Local Capability Gateway  (仅 Windows, 127.0.0.1)
                       │
                       ├── catalog.yaml + ACL + confirm-token + audit.log
                       │
          ┌────────────┼─────────────────────┐
          ▼            ▼                     ▼
     本机平面      SSH 配方平面          （预留）gcloud 薄适配
   GEX / OpenD    ssh BatchMode         实例状态 / 串口
   LM / lms       gcp-vm 白名单 argv    默认关闭
   开看板
   长桥/富途只读
```

三层含义：

- **能力层**：纯函数，输入输出 JSON Schema。
- **传输层**：MCP、HTTP、企微 XML 回调。
- **执行层**：本机进程，或 `ssh -o BatchMode=yes gcp-vm -- <固定 argv>`。

Skill **不是**第四执行层。Skill 告诉模型：该调哪条能力、GEX 怎么读、什么时候禁止下单、SSH 配方的危险程度。

---

## 4. 能力分级

| 级 | 名称 | 默认暴露 | 例子 |
|---|---|---|---|
| **C0** | 观察 | 所有 Agent + 企微只读命令 | GEX 摘要、本机/生产 `/health`、`pm2 list`、git HEAD、磁盘内存、看板 URL |
| **C1** | 本机计算 | Agent 默开，企微需绑定用户 | `gex.collect`、`gex.summarize`、打开本机看板 |
| **C2** | 基础设施变更 | 需 `confirm_token` 或人工在 UI 点一次 | LM load/unload、`ssh -R` 隧道起停、**具名** `pm2 restart --update-env`、按 SHA 对齐代码、双进程切灰/回滚 |
| **C3** | 资金/破坏 | Agent **默认拒绝**；Skill 写明「只许人口述后走现有 Dashboard/跟单」 | 长桥/富途下单、转账、`pm2 delete all`、DROP/删库、关停 GCE |
| **C4** | 秘密 | 永远不返回原文 | `.env`、webhook key、券商 token、SSH 私钥 |

`confirm_token`：网关对 C2 先返回摘要 + 一次性 token（60s TTL）；第二次带 token 才执行。企微用「引用回复 / 确认」消耗同一 token。IDE Agent 由 Cursor Hook `beforeMCPExecution` 再挡一层。

---

## 5. 能力目录（v1 要注册的）

### 5.1 本机平面（Windows）

| ID | 级 | 动作 | 现有入口 |
|---|---|---|---|
| `gex.status` | C0 | 读 `data/gex/latest.json` 元数据：ok/stale/age/source/errors | 已有文件 + `GET /api/gex/latest` |
| `gex.summarize` | C0 | `summarize.py` 文本摘要（给模型，不含全量 ladder） | `tools/gex-sidecar/summarize.py` |
| `gex.collect` | C1 | 富途拉链；可选 `--matrix` / `--zero-dte` 枚举 | `collect_futu.py` |
| `gex.skip_open_session` | C1 | 创建/删除 `data/gex/.skip_open_session` | 已有约定 |
| `gex.open_html` | C1 | 打开本机热图 HTML | `/gex-html/*` |
| `lm.status` | C0 | `lms ps` + `/v1/models` + 本机 8080 探活 | LM Studio CLI / 现有 circuit |
| `lm.load` / `lm.unload` | C2 | `lms load <alias>` / `lms unload --all` | `server.js` GPU Scheduler 已在用 `lms unload` |
| `lm.tunnel.start` / `.stop` / `.status` | C2/C0 | 托管 `ssh -N -R 127.0.0.1:8080:127.0.0.1:8080 gcp-vm` | 现为手工；要收进网关子进程，禁止散落 |
| `dash.open` | C1 | 按枚举打开：`main` `monitoring` `gex` `ticker` `review` | `http://127.0.0.1:8085/...` |
| `dash.list` | C0 | 返回看板清单与探活 | 目录静态 |
| `broker.lb.account` / `.positions` / `.orders` | C0 | 长桥只读 | `brokers/longbridge.js` |
| `broker.futu.quote` / `.option_chain` | C0 | OpenD 只读 | sidecar 已用 OpenD |
| `broker.*.place_order` | C3 | **目录里声明但默认 `enabled: false`** | 现有 `/api/quant/trade` |

后续券商（uSMART 等）只加 `BrokerPort` 实现，不新开 MCP server。

### 5.2 SSH 配方平面（生产 gcp-vm 的「全部功能」）

「全部功能」= **今天人在本机对生产会做的所有事**，不是 Google Cloud 产品全家桶。  
执行形态统一：

```
ssh -o BatchMode=yes -o ConnectTimeout=8 gcp-vm -- /usr/bin/env bash /home/wikitang628/whop-wechat-bridge/tools/local-ops/remote/<recipe>.sh <validated-args>
```

配方脚本 **入仓**，在 VM 上与代码一起部署。本机网关 **只传配方名 + 已校验参数**，不传 shell 片段。

#### C0 观察（Agent 默开）

| 配方 ID | 远程做什么 | 对应人肉操作 |
|---|---|---|
| `gcp.health` | `curl -sS http://127.0.0.1:8085/health` | 看总灯 |
| `gcp.monitor` | `curl .../api/monitoring/dashboard` | 健康看板 JSON |
| `gcp.pm2_status` | `pm2 jlist` 裁剪 name/status/rss/uptime/restarts | `pm2 list` |
| `gcp.git_head` | `git log -1 --format=...` + `git status -sb` | 代码是否对齐 |
| `gcp.resources` | `free -m`、磁盘、loadavg | 958MB 预算 |
| `gcp.logs` | `pm2 logs <name> --lines N --nostream`，N≤80，进程名枚举 | 查 ingest/web 日志 |
| `gcp.watchdog` | `tail` `logs/watchdog.log` 等，有上限 | 看门狗是否在叫 |
| `gcp.crontab` | `crontab -l` | 三重 cron 是否还在 |
| `gcp.tunnel_hint` | 从 web 进程日志解析当前 CF URL（脱敏后返回） | 找公网看板 |
| `gcp.smoke_page` | `WATCHDOG_DRY_RUN=1 page_smoke.sh` | 页壳假绿 |
| `gcp.smoke_consistency` | dry-run consistency | 媒体一致性 |
| `gcp.queue_snapshot` | 只读 SQL：task_queue / pipeline_tasks 计数 | 积压 |
| `gcp.asset_lag` | `/health` 或资产探针字段 | Persona/L2a/News 滞后 |

以上覆盖：生产 HTTP API、PM2、git、资源、日志、cron、冒烟、队列。**生产看板「功能」通过这些 JSON/URL 对 Agent 可用**，不必在云上再开 MCP。

打开生产看板（给人看，不是给模型看 HTML）：

| `dash.open_prod` | C1 | 本机浏览器打开 CF Tunnel URL；若 URL 未知则先 `gcp.tunnel_hint`，或 `ssh -L 18085:127.0.0.1:8085` 再开 `localhost:18085` |

#### C2 变更（确认后才跑；禁止看门狗调用）

| 配方 ID | 远程做什么 | 约束 |
|---|---|---|
| `gcp.pm2_restart` | `pm2 restart <name> --update-env` | name ∈ {`whop-web-dashboard`,`whop-ingest-worker`,`whop-wechat-bridge`}；**禁止** `all` / `delete` |
| `gcp.deploy_align` | `git fetch` + `git reset --hard <sha>` | **必须** 40 位 SHA，禁止 `origin/main` 漂浮指针；对齐后默认 **不** 自动重启 |
| `gcp.cutover_dual` | Runbook §3：停单体 → 起双进程 | 逐步确认；RSS 验收失败则停 |
| `gcp.rollback_mono` | Runbook §5：停双 → 起单体 | 禁止 `pm2 delete all` |
| `gcp.env_set` | 改 `.env` 单个 **非密钥** 或已登记键 | 密钥键只允许「已设置/未设置」布尔，不回显 |
| `gcp.offline_sync` | `run_offline_asset_sync.js` | 休市窗口建议；C2 |
| `gcp.restart_failed_tasks` | 调已有失败任务重启 API **或** 等价脚本 | 只清失败态，不 `task-queue/clear` 全表 |
| `gcp.lm_probe_remote` | 在 VM 上探 `127.0.0.1:8080` | 验证反向隧道是否通 |

#### 明确不做（目录里写 `forbidden`，测试要静态扫描）

- 任意 `ssh gcp-vm -- $cmd`
- `pm2 delete all` / `pm2 kill`
- `gcloud compute instances delete/stop`（停机单独人工）
- 生产 SQLite 写、VACUUM 全库、删 `whop_archive.db`
- 从 Agent 改 `DASHBOARD_PASSWORD` / webhook / 券商三件套原文
- 把 OpenD / GEX collect 丢到 VM

#### 可选：本机 `gcloud` 薄层（默认 `enabled: false`）

若本机已登录 `gcloud`，可加 C0：`gcp.instance.describe`（状态、外网 IP、磁盘）。**不**把 Cloud Run / IAM / Billing / GCS 全家桶塞进 v1。生产应用功能走 SSH 配方已经足够。

### 5.3 为什么这样算「用上 GCP 的全部功能」

生产功能分三类，全部由本机网关触达：

1. **应用 HTTP**（健康、监控 JSON、只读业务 API）→ `ssh` + `curl 127.0.0.1:8085`（不依赖漂浮的 Quick Tunnel 域名）。
2. **进程与部署**（PM2、git SHA、切灰/回滚、cron）→ 入仓 remote 脚本。
3. **给人看的 UI** → `dash.open_prod` 或 SSH 本地端口转发。

Agent 不需要登录 GCP Console，也不需要在 VM 上常驻 MCP。

---

## 6. MCP / Skill / Hook / 企微 / UI 怎么拆

### 6.1 MCP（手）

一个 server：`tools/local-ops/mcp-server.js`（Node ESM，`@modelcontextprotocol/sdk`）。

对外工具建议 **少而稳**，按域聚合，避免 80 个 tool 撑爆模型上下文：

| MCP tool | 内部 |
|---|---|
| `ops.catalog` | 列出当前 ACL 下可用能力 |
| `ops.invoke` | `{ id, args, confirm_token? }` |
| `ops.confirm` | 对 C2 二次确认 |
| `ops.audit_tail` | 最近审计（脱敏） |

实现上 `ops.invoke` 按 catalog 分发。若某模型不擅长通用 invoke，可为高频 C0 再导出别名：`gex_status`、`gcp_health`、`lm_status`。别名仍走同一分发器。

传输：

- **stdio**：Cursor / Claude Code / Gemini CLI 本地进程。
- **Streamable HTTP `127.0.0.1:18789`**：企微适配器、本机 UI、MCP Inspector。鉴权：本机 token，不绑公网。

配置（同一命令，三套文件）：

```json
{ "mcpServers": { "whop-local-ops": {
  "command": "node",
  "args": ["tools/local-ops/mcp-server.js"]
}}}
```

- Cursor：`.cursor/mcp.json`
- Claude Code：`.mcp.json`
- Gemini CLI / Antigravity：`.gemini/settings.json` 的 `mcpServers`

**不要**把生产 `.env` 注入 MCP 进程环境后再让工具回显。

### 6.2 Skill（脑）

项目级 Skill，随仓库走，三家 Agent 都能读 Markdown：

| Skill | 何时用 |
|---|---|
| `.cursor/skills/local-ops/SKILL.md` | 「查生产」「开看板」「拉 GEX」「隧道断了」 |
| `.cursor/skills/gex-sidecar/SKILL.md` | 读 king/floor；OI 昨收；禁止当买卖指令 |
| `.cursor/skills/gcp-ssh-ops/SKILL.md` | 只调配方；先 C0 再考虑 C2；重启前看 RSS 与 `/health`；禁止 delete all |
| `CLAUDE.md` / `GEMINI.md` 各 10 行指针 | 指向上述 Skill，避免三份正文 |

Skill 写清：

- 先 `ops.catalog` 再 invoke。
- GEX 墙不对齐赵哥点位不加权；负 GEX ≠ 做空。
- 生产异常：先 `gcp.health` + `gcp.pm2_status` + `gcp.lm_probe_remote`，**不要**直接 restart。
- 下单：拒绝，引导人用 Dashboard。

### 6.3 Hook（闸）

Cursor project hooks：

- `beforeMCPExecution`：C3 一律 deny；C2 无 `confirm_token` deny。
- `beforeShellExecution`：拦截裸 `ssh gcp-vm` 里带 `pm2 delete` / `rm -rf` / 无配方的远程 bash -lc。

Claude / Gemini 若无同等 hook，靠网关 ACL（失败关闭：未知能力 = deny）。

### 6.4 企微（手机）

现状：群机器人 Webhook **只能出站**（GEX 开盘预告已写明）。要「手机指挥本机」，必须另开 **企业微信自建应用回调**（AES 加解密 + 签名），**不要**幻想群机器人能可靠收「同意」。

建议命令面（默认只 C0/C1）：

```
/ops help
/ops health          → gcp.health + 本机 lm.status
/ops gex             → gex.summarize
/ops gex run         → gex.collect（C1，绑定 userid 白名单）
/ops tunnel          → lm.tunnel.status
/ops boards          → 看板链接（生产 CF URL 或本机提示）
```

C2 流程：机器人出站发摘要 + token → 用户 **回复该条**「确认」→ 适配器带 token `ops.confirm`。  
C3 不接企微。  
公网只暴露 Cloudflare **独立 path** `/wecom/callback`，验签；网关本身仍只听 127.0.0.1，由本机 sidecar 转发。生产 VM **不要**承担企微→本机 GEX/OpenD 的反向控制（拉链必须在 Windows）。

### 6.5 UI

v1 不写新 Electron。

1. MCP Inspector 调通 catalog。
2. 现有 Dashboard 加「本机运维」页：只在 `127.0.0.1` 显示，调网关 HTTP；生产 web_runner **不挂** 这些写接口（符合只读铁律）。
3. 可选：Windows 托盘显示隧道/OpenD/GEX 年龄。

---

## 7. 仓库布局

```
tools/local-ops/
  catalog.yaml              # 唯一能力表：id/class/where/schema/recipe
  gateway.js                # ACL、confirm、审计、分发
  mcp-server.js             # stdio + 可选 HTTP
  http-server.js            # 127.0.0.1:18789
  adapters/
    gex.js
    lm.js
    dashboard.js
    broker-longbridge.js
    broker-futu.js
    ssh.js                  # 只允许 catalog 里的 recipe
  remote/                   # 部署到 VM，与 app 同树
    gcp_health.sh
    gcp_pm2_status.sh
    gcp_logs.sh
    gcp_deploy_align.sh
    ...
  wecom/
    crypto.js               # WXBizMsgCrypt
    commands.js             # /ops → C0 only
    callback.js             # 验签 + userid 白名单
  http-server.js            # 127.0.0.1 WeCom/HTTP adapter
  audit/.gitignore
.cursor/mcp.json
.cursor/skills/local-ops/SKILL.md
.cursor/skills/gex-sidecar/SKILL.md
.cursor/skills/gcp-ssh-ops/SKILL.md
.cursor/hooks.json
.mcp.json
.gemini/settings.json
docs/local-ops-mcp-skill-plan.md   # 本文
```

`remote/*.sh` 必须：`set -euo pipefail`、无 `pm2 delete all`、无未加引号变量、stdout 有上限。测试用静态扫描（与现有 watchdog 「禁止 pm2 restart」同款）。

---

## 8. 分阶段（联审锁定）

| 阶段 | 内容 | 完成定义 |
|---|---|---|
| **P0** | 只读 catalog + gateway + MCP stdio；C0 观察面 | 见 §8.1；**不含** C2 / 企微 / 部署 |
| **P1** | C1 `gex.collect`、开看板；SSH C0 日志/资源/冒烟 | 开盘可口头「跑 GEX / 看生产灯」 |
| **P2** | 本地 C2：LM load/unload + 托管 `ssh -R` | Hook + `confirm_token`；circuit 与网关一致 |
| **P3** | 生产 C2：具名 restart、SHA deploy；切灰/回滚推迟到人肉演练后 | **必须人在 UI/企微点**；IDE token 不够 |
| **P4** | 企微入站 **仅 C0**；`gex.collect` 放 P4.1 + userid 白名单 | 群 webhook 不当入站 |
| **P5** | 券商只读 MCP | **目录永不出现** `place_order` |
| **P6** | Dashboard 本机运维页 | 人不用记命令 |

`gcp.cutover_dual` / `gcp.rollback_mono` / `gcp.env_set`：**推迟**，不进 P0–P2 catalog。  
`gcloud` 薄层：v1 不做。

### 8.1 P0 Done（收窄，三方锁定）

```text
P0 Done =
1) catalog.yaml 仅含约定 C0（含 gex.freshness / gcp.health_bundle / ops.whoami / lm.circuit_status）
2) gateway + ops.catalog / ops.invoke；未注册与一切 C2 → Deny
3) MCP stdio：ops.invoke + 别名上限 6（ops_catalog, gcp_health, gcp_pm2_status, gex_status, gex_summarize, lm_status）
4) 真实：ops.invoke gex.status 或 gex.summarize（读已有 latest.json）
5) 真实：ops.invoke gcp.health（BatchMode ssh + remote 脚本 curl 127.0.0.1:8085）
6) 静态扫描：无任意 ssh 用户串；catalog 0 个 place_order
7) 故意 invoke 未注册 id → deny；故意 invoke C2/forbidden → deny
```

P0 **不要包含**：confirm_token 全链路、企微、deploy_align、pm2 restart、lms load、双进程切灰。

强制点在 **gateway ACL**，不在某家 IDE 的 Hook。P0 验收以「无 token 调 C2 → 网关拒绝」为准。

### 8.2 P1 Done

```text
P1 Done =
1) catalog phase=P1 max_class=C1；含 gex.collect / dash.* / gcp.resources|logs|smoke_*
2) gex.collect 参数枚举锁定；非法 ticker → invoke_failed
3) dash.list / dash.open（board 枚举）本机可用
4) gcp.logs 仅具名进程 + lines≤80，经 LOCAL_OPS_* 环境变量传入
5) C2 仍 deny；place_order 仍不在 catalog
6) 单测 PASS；可选真实 gcp.resources / gcp.logs 联调
```

### 8.3 P2 Done

```text
P2 Done =
1) catalog phase=P2 max_class=C2；仅本地 C2：lm.load / unload / tunnel.start|stop
2) confirm_token：无 token → confirm_required；一次性 60s；args hash 绑定
3) 托管 ssh -R 隧道（detached + state 文件）；lm.tunnel.status / gcp.lm_probe_remote
4) 生产 C2 仍 forbidden；place_order 仍不在 catalog
5) ops.confirm MCP tool；Cursor beforeMCPExecution 软闸
6) 单测 PASS（含 confirm 流）
```

### 8.4 P3 Done

```text
P3 Done =
1) catalog phase=P3；gcp.pm2_restart + gcp.deploy_align（cutover/rollback/env_set 仍不注册）
2) 生产 C2：human_confirm_required → CLI human-approve（非 MCP）→ confirm_token 执行
3) deploy_align：40 位小写 hex + ancestor of origin/main；不自动 restart
4) pm2_restart：仅三进程名 + --update-env；配方外禁止 pm2 restart
5) MCP 不暴露 human-approve；shell hook 对 human-approve/restart 要求 ask
6) 单测 PASS；联调只验证闸门，不默认真重启生产
```

### 8.5 P4 Done

```text
P4 Done =
1) catalog phase=P4；能力面与 P3 相同（无新 C2）
2) 本机 HTTP 127.0.0.1:/wecom/callback（自建应用回调，非群 webhook）
3) WXBizMsgCrypt 验签/加解密；WECOM_OPS_USERIDS 白名单；空名单拒全部
4) 文本命令仅映射 C0；collect/restart/deploy/load 等明确拒绝
5) npm run ops:http；单测 crypto + 命令 + allowlist + HTTP /healthz
6) 不做默认真公网挂载（Cloudflare 由人另开）；gex.collect 仍属 P4.1
```

### 8.6 P4.1 Done

```text
P4.1 Done =
1) catalog phase=P4.1；企微在 userid 白名单下可调 gex.collect（仅此 C1）
2) /ops collect 与 /ops gex run → 异步启动 + 立即 ack（满足企微 ~5s 回包）
3) 并发 collect 有 in-flight 拒绝；restart/deploy/load 仍 deny
4) gcp.health_bundle 修复 pm2|python heredoc 抢 stdin（避免 empty_remote_output）
5) 单测 PASS；Skill/README 更新
```

---

## 9. 安全与失败模式

| 风险 | 做法 |
|---|---|
| 模型拼出 `rm -rf` / 任意 SSH | 无通用 exec；argv 白名单；Hook 再挡 |
| 看门狗变相自愈 | 网关 C2 **不是** alert-sink 的调用方；R2 仍在 |
| Quick Tunnel 域名漂 | 运维 API 走 SSH+localhost curl，不走公网 |
| 958MB 上再跑服务 | VM 只多一些 `remote/*.sh`，零常驻 Agent |
| 审计爆炸 | 结构化 JSONL，轮转；默认不记业务报文全文 |
| 确认被重放 | token 一次性、绑定 capability id + args hash |
| 多 Agent 并发 restart | 网关全局互斥锁；C2 排队 |
| 密钥进上下文 | 统一 redaction；`ops.audit_tail` 预脱敏 |

---

## 10. 六个问题（已拍板）

| # | 议题 | 锁定 |
|---|---|---|
| 1 | invoke vs 展开 tool | `ops.invoke` + **最多 6 个** C0 别名：`ops_catalog` `gcp_health` `gcp_pm2_status` `gex_status` `gex_summarize` `lm_status` |
| 2 | IDE 能否单独过 C2 | **分层**：本地 C2（`lm.*`）可用 Hook + token；**生产 C2**（`pm2_restart` / `deploy_align` / cutover / rollback）必须人在 UI 或企微点，IDE 单独 token 不够 |
| 3 | deploy_align | 有条件允许（P3）：40 位小写 hex SHA；`merge-base --is-ancestor` 证明已在 `origin`；**不自动 restart**；全局互斥锁；禁止分支名/tag |
| 4 | 企微 v1 | P4 **只 C0**；collect 放 P4.1 + userid 白名单 |
| 5 | 长桥只读 | P5；**catalog 删除一切 `place_order`（含 disabled 占位）** |
| 6 | gcloud 薄层 | v1 不做 |

---

## 11. 明确不在本方案

- 云上 OpenD / 云上 GEX 拉链。
- 把 MCP 进程部署到 gcp-vm。
- Agent 自动跟单、自动对齐 GEX 墙下单。
- 用群机器人 webhook 当双向 RPC。
- 为「好看」重写现有 Dashboard。

---

## 12. 建议审核结论格式

三家批注已收齐，格式保留备查。锁定见 §13。

---

## 13. 联审锁定（2026-09-06）

| 来源 | 结论 |
|---|---|
| Cursor | 骨架：一份 catalog、一个网关、SSH 配方、P0–P6 |
| Grok | 原则同意；强制点在网关；删 place_order；收窄 P0；告警不得调 C2 |
| Gemini | 全面背书；生产 C2 必须 HITL；参数强校验；采纳 health_bundle / freshness |

**原则 P1–P8：全体同意。** P6 收紧为告警链与 C2 物理隔离。P3（无通用 remote exec）为最高红线。

**能力表锁定（P0 仅下列 C0）：**

- `ops.whoami` `gex.status` `gex.summarize` `gex.freshness`
- `lm.status` `lm.circuit_status`
- `gcp.health` `gcp.pm2_status` `gcp.git_head` `gcp.health_bundle`

**永不注册：** `broker.*.place_order`、通用 shell、`pm2 delete` / `kill` / `all`。  
**推迟：** cutover / rollback / env_set。

三句核心修正（实施必须遵守）：

1. 强制点在网关，不在某家 IDE 的 Hook。
2. 下单能力不要出现在目录里。
3. P0 只做观察面，先跑通再长肉。
