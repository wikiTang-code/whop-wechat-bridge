# 06 — 开发流程框架 · 文档维护 · 提交 SOP

> 上级：[`README.md`](./README.md)

---

## 1. 需求生命周期

```
发现 → 04 记债/问题（可选）→ 03 登记 REQ/CHG/REJ
    → human/联审 accepted
    → 05 认领（一人一 REQ）
    → 实现 + 自测
    → 07 如需审阅
    → commit（带 REQ-NNN）→ 03 done + 05 Done + 02 刷新
```

---

## 2. 热点路径锁

| 热点 | 默认车道 | 规则 |
|------|----------|------|
| `tools/local-ops/**` | L4 | 同时 1 个 Doing Owner |
| **`tools/local-ops/catalog.yaml`** | L4 | **独占**；变更必须独立 REQ/CHG（REQ-025） |
| `tools/gex-sidecar/**` | L3 | collector 改动独占 |
| `monitoring/**` | L2 | 契约变更喊 L1 |
| ingest / `server.js` 写路径 | L1 | 最高冲突区 |
| `brokers/**` | L1 或 L5 | P5 优先新文件 |
| `docs/project/05*.md` | L0 | 高频；只追加/改自己的行 |
| `docs/project/07*.md` | L0 | 审阅专用；与 05 解耦 |
| `docs/project/03*.md` | L0 | 追加新行优先；少改历史行 |
| 生产 HITL / `.env` | human | Agent 不得代行 approve（REJ-007） |

---

## 3. 进度文档并发协议（`REQ-023`）

1. **禁止**无认领大段重排/重写整树。  
2. 多 Agent 默认可并行：**各改各的文件**（05 vs 07 vs 03 追加）。  
3. 同文件：只改自己负责的表格行；冲突时 **后写方 rebase，保留双方新增行**。  
4. 大重构 `docs/project/**`：先在 05 认领 `REQ`（如 meta），完成前他人只追加。  
5. REJ-010：无协议大段并行改总控 = 拒绝。

---

## 4. `data/gex` 提交 SOP（`REQ-024`）

- 允许：`data/gex/latest.json`  
- 禁止：`*.html`、`snapshot_*.json`、其它大快照  
- **每次提交前**：

```text
git status
# 确认无 data/gex/*.html
# 禁止习惯性 git commit -a
```

---

## 5. 测试最低线

| 车道 | 最低验证 |
|------|----------|
| L4 | `npm run test:local-ops` |
| L3 | OpenD 可达时 collect；或只读 API |
| L2 | 相关 smoke 无新假阳性 |
| L1 | 不破坏双进程只读边界 |
| L5 | 无下单符号；建议 CI grep |
| L6 | 仅 `127.0.0.1` |

---

## 6. 发布 / HITL（摘要；细则由 REQ-015/019 扩写）

1. **本机 C2**（lm/tunnel）：`confirm_token` 60s。  
2. **生产 C2**：`human-approve`（仅 human）→ 再 confirm；Agent 不代跑。  
3. **代码对齐**：ff 或 `gcp.deploy_align`（HITL）；默认可只对齐不重启，例外见 REQ-019。  
4. **具名 restart**：HITL；告警链禁止触发（REJ-004/009）。  
5. 每次生产 C2：human 填 [`05` Ops 审计行](./05-wip-board.md)。

---

## 7. 文档维护 SOP

| 何时 | 改什么 |
|------|--------|
| 新需求/变更/拒绝 | 03 |
| 发现坑未立项 | 04 |
| 认领/进度 | 05 |
| 联审结论 | 07 → 再落 03 |
| 主线事实变化 | 02 |
| 背景/展想变化 | 01 |
| 流程变化 | 06 + CHG |

专题方案（local-ops / hardening / gex）保持原位；03 必须有指针。

---

## 8. 提交说明格式

```
docs(project): REQ-014 land docs/project tree

feat(local-ops): REQ-018 wecom freeze table
```

独立文档 commit：**不夹带** GEX HTML、`.env`、`scratch` 草稿（除非明确 REQ）。
