# 02 — 现状（Current State）

> 上级：[`README.md`](./README.md) · 遗留见 [`04`](./04-leftovers-problems.md) · 需求见 [`03`](./03-requirements.md)  
> **刷新规则**：重大联调/发布后更新本页日期与表格；细节可链到专题方案。

**快照日期**：2026-09-14

---

## 1. 三层能力面（运行事实）

| 层 | 现状 | 入口 |
|----|------|------|
| 业务守护 | 生产双进程运转：ingest + web-dashboard | gcp-vm pm2 |
| 本机 Local-Ops | P0–P4.1 catalog 已实现；MCP/CLI/HTTP/企微适配器在仓 | `tools/local-ops/` |
| 企微回控 | `/ops` C0 + `gex.collect` 已手机验证；推送经 GCP IP | `wiki111.dpdns.org` → ssh -R 18789 |

---

## 2. 主线 1 — 核心业务 `L1-core`

| 模块 | 状态 | 要点 |
|------|:----:|------|
| Whop 抓取归档 | ✅ | ~25s ISR；批量切片让出事件循环 |
| 即时推送 | ✅ | TTL~33s；≤2MB 内联 / >2MB 文件；S3 原图还原 |
| AI 提取与跟单 | ✅ | 本地 14B+熔断；云端兜底；规则过滤 |
| L2 工作台 | ✅ | timeline + 审核台；`db-readonly.js` |
| 双进程 | ✅ | 写锁隔离；单体可回滚镜像保留 |

---

## 3. 主线 2 — 加固 `L2-harden`

权威：[`../system-hardening-and-monitoring-plan.md`](../system-hardening-and-monitoring-plan.md)

| 阶段 | 状态 |
|------|:----:|
| P0 止血 / P1 监测库与双进程准备 / P1-11 切流 | ✅ 生产 |
| P2-11 健康看板 / P2-12 page_smoke / P2-13 consistency / P2-15 软降级 | ✅ |
| P2-14 RUM | ⏸ 跳过（`REJ-005`） |
| P2-16 主库治理 | ⏳（`REQ-008`） |

---

## 4. 主线 3 — GEX `L3-gex`

权威：[`../gex-sidecar.md`](../gex-sidecar.md)

| 项 | 状态 | 事实 |
|----|:----:|------|
| OpenD 采集 | ✅ | **最新快照 `2026-09-14T18:49:27`**；futu-opend；**SPY 102/102**（同批 QQQ/SPX + matrix TSLA） |
| `/api/gex/latest` | ✅ | PR #12；无 ladder |
| UI 摘要 + 规则引擎 | ✅ | King/Floor/Regime |
| 开盘计划任务脚本 | ✅ 在仓 | **任务是否已挂载：见遗留 DEBT-002** |
| Git 中的 json | 📌 | 仅里程碑提交（Q-003）；盘中勿例行 commit |
| 铁律 | 🔒 | 不在 GCP 拉链；不用于自动下单 |

---

## 5. 主线 4 — Local-Ops `L4-local-ops`

权威：[`../local-ops-mcp-skill-plan.md`](../local-ops-mcp-skill-plan.md)

| 项 | 状态 |
|----|:----:|
| C0 观察（含企微友好排版） | ✅ |
| C1 `gex.collect`（企微异步+推送；OpenD 预检） | ✅ |
| C2 本机 confirm_token / 生产 HITL | ✅ |
| GCP 借道推送 `35.212.142.173` | ✅ 已验证 |
| 开机自启 `whop-local-ops-wecom` | ✅ 已注册 |
| 提交 push / 生产 ff | ✅ 已 push；ff 待 human（REQ-002） |

企微命令面：`tools/local-ops/wecom/commands.js`（非 catalog 全集）。

---

## 6. Git / 运行环境快照

| 项 | 值 |
|----|-----|
| 分支 | `main` |
| HEAD / vs origin | push 后应与 `origin/main` 同步（见 `git status -sb`） |
| 本机 OpenD `11111` | 联调日已通（会随用户启停变化） |
| 本机 `ops:http` `18789` + ssh -R | 联调日已通；靠自启任务保活 |
| 企微可信 IP | 应以 **GCP 公网** 为准 |
| 工作区常见脏文件 | `data/gex/*` 拉链产物；`scratch/*` 草稿 |

---

## 7. 「已验证」清单（防重复劳动）

- [x] 企微 `/ops gex status` → 人读摘要  
- [x] `gex.collect` 在 OpenD 登录下成功写 `latest.json`  
- [x] 主动推送经 GCP，不再依赖家宽 IP  
- [x] `npm run test:local-ops` 在框架提交前应保持绿（改 L4 必跑）
