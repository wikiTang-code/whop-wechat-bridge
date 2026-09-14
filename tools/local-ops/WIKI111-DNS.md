# wiki111.dpdns.org → 本机 WeCom 回调

DigitalPlat **不提供普通 DNS 面板**时，要把域名委派到 Cloudflare，再用 Named Tunnel。

## 你现在要做（约 5 分钟）

### A. Cloudflare 接入域名
1. 打开 https://dash.cloudflare.com → **Add a site**
2. 输入：`wiki111.dpdns.org`
3. 选 **Free** → Continue
4. 记下 Cloudflare 给你的两个 NS（形如 `xxx.ns.cloudflare.com`）

### B. DigitalPlat 改成外部 NS
1. 打开 DigitalPlat 域名管理里的 `wiki111.dpdns.org`
2. 委派改成 **外部名称服务器 / External Name Server**
3. NS1 / NS2 填 Cloudflare 那两个
4. 保存（生效可能要几分钟到几小时）

### C. 告诉我「A+B 已完成」
我会在本机：
- 创建 Named Tunnel
- 把 `wiki111.dpdns.org` 路由到 `127.0.0.1:18789`
- 给你企微 URL：`https://wiki111.dpdns.org/wecom/callback`

## 预期
- 技术验签：有机会通过（无 ngrok 拦截页）
- 企微备案政策：`.dpdns.org` **仍可能被拒**；若再失败就是备案墙，不是隧道问题
