# Fixed public URL for WeCom callback

## 当前（已启用）

- 固定域名：`https://unhelpful-footsie-identify.ngrok-free.dev`
- 企微回调：`https://unhelpful-footsie-identify.ngrok-free.dev/wecom/callback`
- 本机：`npm run ops:http`（127.0.0.1:18789）
- 隧道：`ngrok http --url=unhelpful-footsie-identify.ngrok-free.dev 18789`

免费账号注册后会在 Domains 自动出现一条 **dev domain**，一般不用再点 New Domain。付费才能自定义名字或绑自有域名。

## 备选 — Cloudflare Named Tunnel

需 Cloudflare 上已有域名。无自有域名时用上面的 ngrok 即可。
