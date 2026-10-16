# 公众号文章下载

免费在线微信公众号文章下载工具。部署在 Cloudflare Workers 上，无需服务器，绑定自己域名即可使用。

## 部署步骤

### 1. 安装依赖 & 部署

```bash
npm install
npx wrangler login
npm run deploy
```

首次部署后你会得到一个地址，如：
`https://wechat-article-downloader.你的用户名.workers.dev`

### 2. 绑定你的域名

在腾讯云 DNS 添加一条记录：

| 字段 | 值 |
|---|---|
| 记录类型 | CNAME |
| 主机记录 | `down` |
| 记录值 | `wechat-article-downloader.你的用户名.workers.dev` |

然后在 `wrangler.toml` 中取消注释 `routes`：

```toml
routes = [
  { pattern = "down.yinuo-ai.com", custom_domain = true }
]
```

再运行一次：

```bash
npm run deploy
```

### 3. 完成

访问 `https://down.yinuo-ai.com` 即可使用。

## API

```bash
# 获取文章 Markdown
curl "https://down.yinuo-ai.com/api/download?url=https://mp.weixin.qq.com/s/xxx"

# 获取 JSON（含原始 HTML）
curl "https://down.yinuo-ai.com/api/download?url=https://mp.weixin.qq.com/s/xxx&format=json"

# 获取 HTML 页面
curl "https://down.yinuo-ai.com/api/download?url=https://mp.weixin.qq.com/s/xxx&format=html"

# 获取纯文本
curl "https://down.yinuo-ai.com/api/download?url=https://mp.weixin.qq.com/s/xxx&format=text"

# 本地开发
npm run dev
```

## 注意事项

- Cloudflare Workers 免费额度：每天 100,000 次请求，足够日常使用
- 微信可能对高频请求限流，Worker 已内置请求头伪装
- 如需后续收费，可在 Worker 中加入 Cloudflare Access 或 Stripe 集成
