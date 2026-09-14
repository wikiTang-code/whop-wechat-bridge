# 企微自建应用回调（本机 P4）

群机器人 webhook **不能**做入站。要用手机发 `/ops health`，必须：自建应用 + 本机 `ops:http` +（可选）公网隧道。

## 1. 本机已生成（在仓库根 `.env`）

- `WECOM_OPS_TOKEN`
- `WECOM_OPS_ENCODING_AES_KEY`（43 位）
- 仍需你填：`WECOM_OPS_CORP_ID`、`WECOM_OPS_USERIDS`

## 2. 企微管理后台（你点）

1. 打开 [企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. **我的企业 → 企业信息** → 复制「企业 ID」→ 填进 `.env` 的 `WECOM_OPS_CORP_ID`
3. **通讯录** → 点开你自己 → 账号即 `UserId` → 填进 `WECOM_OPS_USERIDS`（多人用逗号）
4. **应用管理 → 自建 → 创建应用**
   - 名称如 `本机运维`
   - 可见范围：仅你自己
5. 进入应用 → **接收消息 → 设置 API 接收**
   - URL：先起隧道后再填，形如 `https://xxxx.trycloudflare.com/wecom/callback`
   - Token：粘贴 `.env` 里的 `WECOM_OPS_TOKEN`
   - EncodingAESKey：粘贴 `.env` 里的 `WECOM_OPS_ENCODING_AES_KEY`（或点随机生成后**反过来**写回 `.env`）
6. 保存前必须先完成本机服务 + 公网隧道（企微会立刻 GET 验签）

## 3. 本机服务 + 隧道

```powershell
cd C:\Users\86597\.gemini\antigravity\scratch\whop-wechat-bridge
npm run ops:http
```

另开终端（需已装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)）：

```powershell
cloudflared tunnel --url http://127.0.0.1:18789
```

把打印的 `https://....trycloudflare.com` 拼上 `/wecom/callback` 填回企微 URL，保存。

手机打开该自建应用对话框，发：`/ops help` 或 `/ops health`。

## 主动推送（异步任务完成后通知）

在应用详情页复制：

- **AgentId** → `.env` `WECOM_OPS_AGENT_ID`
- **Secret** → `.env` `WECOM_OPS_SECRET`

然后重启 `npm run ops:http`。`/healthz` 应出现 `wecom_push_enabled: true`。

同步命令仍走回调被动回复；`/ops collect` 等异步任务完成后会再推一条应用到本会话。
