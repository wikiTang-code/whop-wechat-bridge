# L1 智能跟单沙盒到实盘切换检查表与 Human 门禁（REQ-021）

> 上级：[`../03-requirements.md`](../03-requirements.md) · 方案：[`../follow-hitl-plan.md`](../follow-hitl-plan.md) · 规格：[`../../data/specs/follow_execution_spec.md`](../../data/specs/follow_execution_spec.md)  
> **最高安全原则**：**实盘严禁全自动下单，实盘严禁一键全跟**。未达门禁指标 **绝对禁止** 开启实盘确认通道。

---

## 1. 模拟仓（Paper Account）准入硬指标

在允许将跟单系统接入真实券商（Live Account）前，系统必须在沙盒模拟状态下运行，并满足以下量化基线：

| 评估维度 | 合格门限 | 判据来源 | 检查方式 |
|---------|:--------:|----------|----------|
| **提取方向准确率** | $\ge 97\%$ | `follow_decisions.decision_state` | 解析错误率 $\le 3\%$ |
| **标的代码准确率** | $\ge 99\%$ | 标的映射与行情报价 | 无无效 Ticker 报警 |
| **模拟运行样本量** | $\ge 15$ 笔有效信号 | 连续交易日沉淀 | `calculateFollowQualityMetrics()` |
| **滑点拒单率容差** | $\le 15\%$ | 正常滑点分布 | `SLIP_REJECT` 占比受控 |
| **超时废弃率** | $\le 10\%$ | 90s TTL 窗口 | `EXPIRED` 占比受控 |

> [!CAUTION]
> 任何一项指标未达成，系统判定为 **NO-GO**，禁止开启实盘确认卡片通道。

---

## 2. 实盘切换检查清单（Go / No-Go Checklist）

切换实盘必须由 **Human Operator** 逐项人工签署确认：

### Step 1: 量化指标与沙盒审计
- [ ] 运行指标审计命令：`node -e "import('./follow-decision-engine.js').then(m => console.log(m.calculateFollowQualityMetrics()))"`
- [ ] 输出确认 `qualified: true`
- [ ] `parseErrorRate <= 0.03`

### Step 2: 凭据与鉴权审计
- [ ] 检查券商环境：长桥生产凭据（`LONGBRIDGE_APP_KEY`, `LONGBRIDGE_ACCESS_TOKEN`）配置完毕且有效
- [ ] 检查鉴权白名单：`WECOM_FOLLOW_USERIDS` 仅包含授权实操人的企业微信 UserID，严禁留空（留空将拒绝一切操作）
- [ ] 检查卡片签名密钥：`WECOM_HITL_SECRET` 已设置强密钥，杜绝空默认值

### Step 3: 风控与仓位防线
- [ ] 单笔最大风险比例（`RISK_PER_TRADE_PCT`）限制在 1%~2% 以内
- [ ] 单标的最大集中度（`MAX_CONCENTRATION_PCT`）限制在 20% 以内
- [ ] 现金安全缓冲（`CASH_BUFFER_PCT`）保留 $\ge 15\%$ 现金

### Step 4: 切换配置并平滑生效
- [ ] 修改 `.env` 中 `MOCK_TRADING_MODE=false`
- [ ] **注意**：即使 `MOCK_TRADING_MODE=false`，系统底层仍由 `follow-hitl.js` 施加强制红线：**无人工卡片点击授权 (isApprovedReal=true) 的任何全自动指令均会被硬拦截并记为 REJECTED**。

---

## 3. 盘中熔断与紧急回退 SOP（Rollback）

如果在实盘运行期间发生以下任何异常情况，操作人员必须立即执行熔断：

### 熔断触发条件（任一）：
1. 连续发生 2 笔标的错码或方向逆转的解析反馈（`PARSE_ERROR`）；
2. 企微接口延迟异常，导致连续 3 笔信号超过 90s 超时失效；
3. 券商柜台返回资金不足或异常报错；
4. 市场发生黑天鹅事件，买卖点价差剧烈失真。

### 熔断执行步骤（30秒内）：
1. 在生产环境立即将 `MOCK_TRADING_MODE` 重置为 `true`：
   ```bash
   # 快速切回沙盒模拟，阻断所有实盘长桥调用
   sed -i 's/MOCK_TRADING_MODE=false/MOCK_TRADING_MODE=true/' .env
   ```
2. 检查当前活跃实盘持仓：
   通过长桥手机 App 或 `/api/positions` 检查最新实盘持仓，若有错单立即通过官方券商 App 人工市价平仓。
3. 在 `docs/project/05-wip-board.md` 登记事故行，并启动排查复盘。
