# Whop 频道自动化接入与追踪脚本

本脚本提供了一种快速、自动化的方式来发现和接入任何 Whop 体验/社群中的聊天与论坛频道。它通过 Headless 浏览器自动模拟用户登录（利用已有的 `WHOP_COOKIE`），遍历该社群下的所有频道，并拦截底层 GraphQL 请求以获取真正的 `feedId` 或 `channelId`，从而省去手动使用 Chrome 开发者工具审查网络请求的繁琐步骤。

## 🚀 快速开始

### 1. 确保配置
脚本会自动读取项目根目录下的 `.env` 文件。请确保 `.env` 中已填写有效的 `WHOP_COOKIE`：
```env
WHOP_COOKIE=whop_sig_id=xxxx; whop-core.ssk=xxxx; whop-core.access-token=xxxx; ...
```

### 2. 安装依赖
由于父项目包含了平台专属依赖，为了保证在 Windows 下运行顺畅，我们为该脚本创建了独立的依赖环境：
```bash
cd scripts/discovery
npm install
```

### 3. 运行自动发现

#### A. 干跑模式（仅展示，不写入）
默认会扫描设置好的默认 Whop 社群频道，你可以直接传入任何 Whop 社群的加入链接或应用根链接：
```bash
# 扫描指定社群
node auto_discover_whop_channels.js https://whop.com/joined/38fcb263-06a0-4976-a687-016958e3b811/
```

#### B. 写入模式（自动写入到 `.env`）
加上 `--write` 或 `-w` 参数，脚本在发现新的聊天/论坛频道后，会**自动更新根目录的 `.env` 文件**中的 `WHOP_CHAT_CHANNEL_ID` 和 `WHOP_CHANNEL_MAPPINGS`（保留已有映射，并增量追加新映射）：
```bash
node auto_discover_whop_channels.js https://whop.com/joined/38fcb263-06a0-4976-a687-016958e3b811/ --write
```

---

## 🛠️ 脚本命令配置

为了更加方便地使用，你可以通过 `package.json` 中配置的快捷命令来运行（如果你在 `scripts/discovery` 目录下）：

```bash
# 扫描（干跑模式）
npm run discover -- https://whop.com/joined/<experience_id>/

# 扫描并写入到 .env
npm run discover:write -- https://whop.com/joined/<experience_id>/
```

## 📝 工作原理与容错
1. **Cookie 动态适配**：脚本能自动识别并适配 Chrome 安全限制较严格的 `__Host-` 类型 Cookie（自动补充 `secure: true` 和 Host Url，避免 CDP 报错）。
2. **容错重试**：逐个载入 Cookie，确保个别统计/广告型 Cookie 报错时不阻碍整体登录。
3. **精准 GraphQL 捕获**：不仅捕获 REST 接口，还动态分析 Whop 特有的 `chatFetchMessages`、`chatFetchPinnedMessages`、`chatFetchChatChannel` 和 `MessagesFetchFeedPosts` 等多种 GraphQL 实体变量，智能匹配符合 `chat_feed_` / `forum_feed_` 规则的 ID。
