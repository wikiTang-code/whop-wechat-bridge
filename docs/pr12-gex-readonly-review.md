# PR #12 审阅与合入说明（Cursor）

> PR：[#12](https://github.com/wikiTang-code/whop-wechat-bridge/pull/12) → 已随 [#13](https://github.com/wikiTang-code/whop-wechat-bridge/pull/13) 合入 `main`

## 结论

只读契约合格。合入后补强：

1. 双进程：`web_runner` 挂载 `/api/gex` + auth 放行 API  
2. **生产阻断修复**：Basic Auth 下放行 `/gex-summary.js`（公开时间轴脚本，否则 401 → `loadGexSummary` 未定义）  
3. UX：量化 Tab `gex-structure-bar` 默认 `hidden`；GEX 加载与 quant fetch 异常隔离  

部署后验：未登录打开 `/ticker_timeline.html?symbol=TSLL`，GEX 条应正常渲染。
