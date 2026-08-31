# 资产读写边界与下一步（2026-08-30）

状态以 `0bb2da8` 指针为准。本文只锁边界，不启动 L2b 全量切窗、不调用 place_order。

## 1. 增量是否收口

### 已完成（跟单 L2a）

- 母库唯一 id：`forum_feed_1CTr7SqVMzFfuFiiRJLEHN`
- 基线：`data/runs/l2a_broadcast_candidates_1195_cleaned.jsonl`（N=1195，只读）
- 增量：`data/runs/l2a_cleaned_20260828_incr01.jsonl`（N=246，只读）
- `20260830_incr02` dry-cut = **0 窗**（周末无新交易帖；8-29 00:47 一条已被 incr01_00246 覆盖）
- `wm_l2a_cut` 已对齐 `wm_raw`：08/30 23:58 ET（ts `1788148694825`）
- 工作台读两份 jsonl 合成一条日期流；1195 与 246 **业务权限相同**

### 未做（不要冒充「全资产增量完成」）

- `l2b_cut` 仍 `paused: 2064`，无全频道知识窗
- 历史配图：真图约 35 张；media `skipped: 411`（过期签）
- 7 月后 messages 中 `[IMAGE:` 仍为 0（入库 attachments 链路需事后验收）
- `timeline` 队列 pending 98，与 L2a 离线流水线无关，不得用它冲水印
- exec / 券商：exit code 2，零实盘

## 2. 四类资产谁读谁写

| 资产 | 读 | 写 | 禁止 |
|---|---|---|---|
| L2a 候选流（1195+246） | 工作台、抽检、人审 | 仅离线 pipeline 追加 incr；人审 append jsonl | 自动 place_order；改 1195/246 原文 |
| L2b 战法（25 hits + 金标种子 + 周哥 hint_only） | 工作台右列闸门、看盘 | 仅 proposed 增量；gold 需人审 | 当 BUY/SELL；写入 registry；混进 L2a actions |
| 图 | 金标配图、人眼核 | 近窗活签 + size>15KB + SHA 去重 | 占位图训练；老帖硬打 S3 |
| 人审 `l2a_human_verified_actions.jsonl` | 工作台左/中列状态 | 仅 ack/dismiss append | 当成成交回写 L2a jsonl |

`filled_speech` = 口播已成交，等券商 fills。  
`planned` = 待审。  
`human_verified` 仍不等于下单。

## 3. exec 进口（未打开）

必须同时满足才能讨论 exec：

1. L2a `human_verified`
2. ticker 白名单
3. L2b 闸门未拒（死区/叠仓/事件纪律）
4. 券商 fills 对账不再 exit 2

缺一不进。

## 4. 工程下一步（只做规范落地，不跑模型）

1. 工作台「同步离线批次」确认徽章为 08/30 23:58，日期下拉含 08-28。
2. 把本表写进 `SYSTEM_INTEGRATION_AND_ASSET_INDEX_SPEC.md` 的 exec 章节引用，禁止改 L2a 产物。
3. L2b 全频道切窗仍挂起，等切窗规范单独审批。
4. 新消息入库必须带 `feed_id` + `attachments[]`；近窗图仍走活签门槛。
