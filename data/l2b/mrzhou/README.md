# 📚 周哥量化体系 L2b 知识原子库 (Mrzhou L2b Knowledge Atoms Registry)

> **版本状态**：`L2B-MRZHOU-V1-SEALED (已封盘归档)`  
> **数据源**：`data/curriculum/mrzhou/messages.jsonl`（1,447 条只读教材）  
> **核心属性**：所有原子 `status = hint_only`，`not = place_order`，**绝不生成可下单交易指令，绝不进入 L2a 候选订单表**。

---

## 一、知识原子汇总表 (共 18 条核准原子)

| 原子 KID | 类型 (Type) | 核心行为 / 语义 | 证据样本数 (Count) |
| :--- | :---: | :--- | :---: |
| **`regime_bias_midvol_deathzone`** | `regime` | 偏多市 × 中波动 = 高磨损死区，优先观望 | **10 次** (10/10) |
| **`regime_bias_lowvol_neutral`** | `regime` | 偏多市 × 低波动 = 模型中性区 (~60.8%) | **13 次** |
| **`regime_range_lowvol_neutral`** | `regime` | 震荡市 × 低波动 = 模型中性区 (~59.1%) | **11 次** |
| **`regime_range_midvol_neutral`** | `regime` | 震荡市 × 中波动 = 模型中性区综合判断 | **6 次** |
| **`combo_iii_bottom`** | `playbook` | 命中 `Ⅲ / 底` $\rightarrow$ `LONG_HINT` | **124 次** |
| **`combo_bottom_structure_dip`** | `playbook` | 命中 `底结构形成 / 抄底` $\rightarrow$ `LONG_HINT` | **81 次** |
| **`combo_sell_top_structure`** | `playbook` | 命中 `卖出 / 顶结构形成` $\rightarrow$ `EXIT_HINT` | **164 次** |
| **`atom_top_structure`** | `playbook` | 命中 `顶结构形成` $\rightarrow$ `RISK_HINT` | **144 次** |
| **`atom_reduce`** | `playbook` | 命中 `减仓` $\rightarrow$ `RISK_HINT` | **100 次** |
| **`atom_flatten`** | `playbook` | 命中 `清仓` $\rightarrow$ `EXIT_HINT` | **67 次** |
| **`atom_sell`** | `playbook` | 命中 `卖出` $\rightarrow$ `EXIT_HINT` | **123 次** |
| **`rule_capital_nominal_10k`** | `sizing_rule` | 单笔名义仓位固定 \$10,000 美金 | 1 次 (纪律) |
| **`rule_max_overlapping_3`** | `risk_rule` | 同标的最大并发持仓 $\le 3$ 仓，超额丢弃开仓提示 | 1 次 (纪律) |
| **`rule_neutral_limit_only`** | `risk_rule` | 中性限价贴盘挂单，严禁市价追单 | **840 次** |
| **`rule_expiry_force_flatten`** | `risk_rule` | 到期无条件平仓（时间规则） | 1 次 (纪律) |
| **`rule_scan_window_overnight_pre`**| `timing_rule` | 夜盘/盘前为批处理推荐扫描窗口 | 1 次 (纪律) |
| **`instrument_option_wall_geometry`**| `instrument_view` | 现价 $\pm 15\%$ Call/Put 最大 OI Strike 几何点位 | 329 次 (研报) |
| **`instrument_pcr_tiering_undefined_basis`**| `instrument_view` | PCR 三档：$\le 0.88$ 进攻 / $0.90 \sim 1.02$ 均衡 / $\ge 1.06$ 防守 | 329 次 (研报) |

---

## 二、红线断言与隔离机制

1. **绝对只读**：本目录所有原子仅供风控闸门与看盘层订阅；
2. **禁止写单**：CI 与脚本已建立断言，任何包含 `mrzhou` 前缀或属于该注册表的原子，写入 `l2a_order_candidates` 表均会触发直接报错退出。
