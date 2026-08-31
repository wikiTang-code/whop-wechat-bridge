# 渠道权威登记册 (Channel Registry)

> **核心原则**：全系统全链路以 `feed_id`（Whop 真实 ID）为唯一法定主键。
> 中文名称仅作为人类可读展示，禁止通过正文子串猜测频道归属。

| feed_id (主键) | 网页原名 (name) | channel_class | 用途 (purpose) |
|---|---|---|---|
| `chat_feed_1CTr7QocNpDZ9FXZ6fvWe4` | 不用翻墙美股发布 | `broadcast` | L2a 交易口播与发布核心区 |
| `forum_feed_1CTr7SqVMzFfuFiiRJLEHN` | 历史股票期权记录区 | `record` | 历史股票期权记录区 (原名)，独立产物与长文记录 |
| `chat_feed_1CTrCEx44dP13jW3RVkYiS` | 不用翻墙期权 | `option` | 期权讨论与实时短播，默认不进 L2a |
| `chat_feed_1CTr5VAdNHtbZAFaTitvoT` | 不用翻墙美股讨论区 | `discuss` | 群友美股综合讨论区，不进 L2a |
| `chat_feed_1CU95KbtifP1JtuqTiVXZb` | 讨论区股票记录 | `discuss_record` | 讨论区股票记录存档 |
| `chat_feed_1CWLuNUVYVVYttro8gAvJ5` | 历史股票期权记录区(备份) | `record_backup` | 历史备份区 |
| `chat_feed_1CabPvHkbHhMwHft19jd83` | 财报日提醒 | `notification` | 财报日自动提醒 |
| `chat_feed_1CaPyASfSWTuruMgL2u3sT` | 股票分析 | `analysis` | 股票分析专区 |
| `chat_feed_1CaEnj8BrNBr95YSbgabYZ` | 日内波段信号检测 | `signal` | 日内量化信号检测 |
| `chat_feed_1CaChz8Ru2cjRfAFKi7KbF` | 每日选股 | `stock_pick` | 每日精选股票推荐 |

---

### 🛡️ 架构与数据流铁律
1. **入库 Messages**: 必须携带严格的 `feed_id`，`channel_name` 强制读取本登记册原名，严禁写入未登记的伪名或旧别名；
2. **ISR 上半部**: 判定分类严格使用 `registry[feed_id].class`，严禁使用 `content.includes('期权')` 反向猜测；
3. **切窗与上下文**: 上下文查询 (`getMessageContext`) 严格限定同 `channel_id`，绝不允许跨频道混串；
4. **前端徽章**: 页面一律根据消息的 `feed_id` / `channel_id` 在登记册中查找规范名称并渲染专属徽章，杜绝前端死代码写死。
