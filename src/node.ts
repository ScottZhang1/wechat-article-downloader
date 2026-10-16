import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT || 3010);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`wechat-article-downloader listening on http://localhost:${info.port}`);
});
