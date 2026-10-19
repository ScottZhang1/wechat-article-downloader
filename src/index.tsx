import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  SITE_NAME?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// ─── HTML to Markdown ───────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

function sanitizeFilename(name: string, maxLen = 80): string {
  return name
    .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen) || "untitled";
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).trim();
}

function htmlToMarkdown(html: string, baseUrl: string): string {
  let md = html;

  // Remove script/style/noscript blocks
  md = md.replace(/<script[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[\s\S]*?<\/style>/gi, "");
  md = md.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  md = md.replace(/<!--[\s\S]*?-->/g, "");

  // WeChat video/audio placeholders
  md = md.replace(/<iframe[^>]*src="([^"]*)"[^>]*>[\s\S]*?<\/iframe>/gi, (_m, src) => `\n[视频](${src})\n`);
  md = md.replace(/<mpvoice[^>]*name="([^"]*)"[^>]*>[\s\S]*?<\/mpvoice>|<mpvoice[^>]*>[\s\S]*?<\/mpvoice>/gi, (_m, name) => `\n[音频: ${name || "未命名"}]\n`);
  md = md.replace(/<mp-common-videosnap[^>]*>[\s\S]*?<\/mp-common-videosnap>/gi, "\n[视频]\n");

  // Images — preserve data-src fallback, use full URL
  md = md.replace(/<img[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/(?:data-src|src)\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) return "";
    let src = srcMatch[1];
    if (src.startsWith("//")) src = "https:" + src;
    if (!src.startsWith("http")) return "";
    // Skip tiny icons, WeChat emoji assets and data URIs
    if (src.includes("icon") && !src.includes("wx_fmt=png")) return "";
    if (src.includes("wx_fed") || src.includes("/Expression/")) return "";
    const altMatch = tag.match(/alt\s*=\s*["']([^"']*)["']/i);
    const alt = altMatch ? altMatch[1] : "image";
    return `![${alt}](${src})`;
  });

  // Headings
  md = md.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, text) => {
    const t = stripTags(text);
    return t ? `\n${"#".repeat(parseInt(level))} ${t}\n` : "";
  });

  // Bold / italic
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _, text) => `**${stripTags(text)}**`);
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _, text) => `*${stripTags(text)}*`);

  // Links
  md = md.replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
    const t = stripTags(text);
    if (!t) return "";
    let url = href;
    if (url.startsWith("//")) url = "https:" + url;
    if (url.startsWith("/")) {
      try { url = new URL(url, baseUrl).href; } catch { return t; }
    }
    return `[${t}](${url})`;
  });

  // Code blocks
  md = md.replace(/<pre[^>]*>[\s\S]*?<code[^>]*class\s*=\s*["'][^"']*language-(\w+)[^"']*["'][^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi,
    (_m, lang, code) => `\n\`\`\`${lang}\n${decodeEntities(stripTags(code))}\n\`\`\`\n`);
  md = md.replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi,
    (_m, code) => `\n\`\`\`\n${decodeEntities(stripTags(code))}\n\`\`\`\n`);
  md = md.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code) => `\n\`\`\`\n${decodeEntities(stripTags(code))}\n\`\`\`\n`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, code) => `\`${decodeEntities(stripTags(code))}\``);

  // Blockquote
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m, content) => {
    const inner = content.replace(/<[^>]*>/g, "").trim();
    if (!inner) return "";
    return inner.split("\n").map((l: string) => `> ${l.trim()}`).join("\n");
  });

  // Lists
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, content) => {
    const items: string[] = [];
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m2, item) => {
      items.push(`- ${stripTags(item)}`);
      return "";
    });
    return items.length ? "\n" + items.join("\n") + "\n" : "";
  });
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, content, offset, full) => {
    const items: string[] = [];
    let idx = 1;
    content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, () => {
      items.push(`${idx++}. ${stripTags(arguments[1])}`);
      return "";
    });
    return items.length ? "\n" + items.join("\n") + "\n" : "";
  });

  // Horizontal rule
  md = md.replace(/<hr[^>]*>/gi, "\n---\n");

  // Line break
  md = md.replace(/<br\s*\/?>/gi, "\n");

  // Paragraphs and sections
  md = md.replace(/<\/(p|div|section|article|header|footer|li|tr)>/gi, "\n");
  md = md.replace(/<(p|div|section|article|header|footer|li|tr)[^>]*>/gi, "\n");

  // Strip all remaining tags
  md = md.replace(/<[^>]*>/g, "");

  // Decode entities in remaining text
  md = decodeEntities(md);

  // Clean up whitespace
  md = md.replace(/\n{4,}/g, "\n\n\n");
  md = md.replace(/[ \t]+/g, " ");
  md = md.replace(/^[ \t]+$/gm, "");

  return md.trim();
}

// ─── Article extractor ──────────────────────────────────────────────

function extractArticle(html: string): { title: string; author: string; content: string; date: string } {
  // Title
  let title = "";
  const titleMatch = html.match(/<h1[^>]*id="activity-name"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<h1[^>]*class="rich_media_title"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = stripTags(titleMatch[1]);

  // Author
  let author = "";
  const authorMatch = html.match(/<a[^>]*id="js_name"[^>]*>([\s\S]*?)<\/a>/i)
    || html.match(/<span[^>]*class="rich_media_meta rich_media_meta_nickname"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)
    || html.match(/<span[^>]*id="profileBt"[^>]*>([\s\S]*?)<\/span>/i);
  if (authorMatch) author = stripTags(authorMatch[1]);

  // Date
  let date = "";
  const dateMatch = html.match(/<em[^>]*id="publish_time"[^>]*>([\s\S]*?)<\/em>/i)
    || html.match(/var\s+publish_time\s*=\s*["']([^"']+)["']/i)
    || html.match(/createTime\s*=\s*['"]([^'"]+)['"]/i);
  if (dateMatch) date = stripTags(dateMatch[1]);

  // Content — find #js_content
  let content = "";
  const contentMatch = html.match(/<div[^>]*id="js_content"[^>]*>([\s\S]*?)\s*<\/div>\s*(?:<script|<div class="rich_media_tool"|<\/div>\s*<script)/i);
  if (contentMatch) {
    content = contentMatch[1];
  } else {
    // Fallback: find by class
    const classMatch = html.match(/<div[^>]*class="rich_media_content[^"]*"[^>]*>([\s\S]*?)\s*(?:<\/div>\s*<script|<\/div>\s*<\/div>\s*<script)/i);
    if (classMatch) content = classMatch[1];
    else {
      // Last resort: grab everything between body tags
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) content = bodyMatch[1];
    }
  }

  return { title, author, content, date };
}

// ─── Smart article fetcher: UA rotation + skeleton detection + backoff ──

const FETCH_UAS = [
  // 微信读书墨水屏设备 UA —— 微信对其返回完整正文（weread-omni 同款方案）
  "WeRead/2.1.2 WRBrand/Onyx wr_eink Dalvik/2.1.0 (Linux; U; Android 11; BOOX Build/onyx)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f36) NetType/WIFI Language/zh_CN",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

async function fetchArticleHtmlSmart(url: string, maxAttempts = 3): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": FETCH_UAS[attempt % FETCH_UAS.length],
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const { content } = extractArticle(html);
      // 正文超过 300 字视为真实内容；空壳页只有几百字节框架
      if (content && content.replace(/\s/g, "").length > 300) return html;
      // 空壳/被限流 → 退避后换 UA 重试
      await new Promise((r) => setTimeout(r, 1500 + attempt * 2500));
    } catch { /* retry */ }
  }
  return "";
}

// ─── API: Download article ──────────────────────────────────────────

app.get("/api/download", async (c) => {
  const url = c.req.query("url");
  const format = c.req.query("format") || "markdown";

  if (!url || !url.includes("mp.weixin.qq.com")) {
    return c.json({ error: "请提供有效的微信公众号文章链接" }, 400);
  }

  try {
    const html = await fetchArticleHtmlSmart(url);
    if (!html) {
      return c.json({ error: "无法获取文章内容（可能被微信限流，请稍后再试）" }, 429);
    }

    if (html.includes("环境异常") || html.includes("请输入验证")) {
      return c.json({ error: "请求被微信限制，请稍后再试" }, 429);
    }

    const { title, author, content, date } = extractArticle(html);

    if (!content) {
      return c.json({ error: "未找到文章正文，链接可能已失效" }, 404);
    }

    // Build markdown
    const markdownBody = htmlToMarkdown(content, url);
    const fullMarkdown = [
      `# ${title}`,
      "",
      `> **公众号**：${author || "未知"}`,
      date ? `> **日期**：${date}` : "",
      `> **原文**：${url}`,
      "",
      "---",
      "",
      markdownBody,
    ].filter(Boolean).join("\n");

    if (format === "json") {
      return c.json({
        title,
        author,
        date,
        url,
        markdown: fullMarkdown,
        html: content,
      });
    }

    if (format === "html") {
      const htmlContent = buildHtmlPage(title, author, date, url, content);
      return new Response(htmlContent, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (format === "text") {
      const plain = stripTags(content);
      return new Response(plain, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(title + ".txt")}`,
        },
      });
    }

    // Default: markdown
    return new Response(fullMarkdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(title + ".md")}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e: any) {
    return c.json({ error: `下载失败: ${e.message}` }, 500);
  }
});

// ─── API: Preview article ───────────────────────────────────────────

app.get("/api/preview", async (c) => {
  const url = c.req.query("url");
  if (!url || !url.includes("mp.weixin.qq.com")) {
    return c.json({ error: "请提供有效的微信公众号文章链接" }, 400);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      redirect: "follow",
    });

    const html = await resp.text();

    if (html.includes("环境异常")) {
      return c.json({ error: "请求被微信限制，请稍后再试" }, 429);
    }

    const { title, author, content, date } = extractArticle(html);
    if (!content) {
      return c.json({ error: "未找到文章正文" }, 404);
    }

    const markdown = htmlToMarkdown(content, url);

    return c.json({
      title,
      author,
      date,
      url,
      markdown: markdown.slice(0, 50000), // limit preview
      length: markdown.length,
    });
  } catch (e: any) {
    return c.json({ error: `获取失败: ${e.message}` }, 500);
  }
});

// ─── HTML page builder ──────────────────────────────────────────────

function buildHtmlPage(title: string, author: string, date: string, url: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} - 公众号文章下载</title>
<style>
  body { max-width: 680px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.8; color: #333; }
  .meta { color: #888; font-size: 14px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee; }
  .meta a { color: #576b95; text-decoration: none; }
  img { max-width: 100%; height: auto; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 14px; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #ddd; margin: 0; padding: 8px 16px; color: #666; background: #fafafa; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
</style>
</head>
<body>
<div class="meta">
  <strong>${title}</strong><br>
  公众号：${author || "未知"}${date ? ` | ${date}` : ""} | <a href="${url}" target="_blank">查看原文</a>
</div>
<div id="content">${content}</div>
</body>
</html>`;
}

// ─── WeRead (weread-omni SDK) integration ───────────────────────────

const NODE_ENV2: Record<string, string> =
  typeof process !== "undefined" ? (process.env as any) : {};
const ADMIN_CODE2 = NODE_ENV2.ADMIN_CODE || "";

type WereadModule = typeof import("weread-omni");
let _weread: WereadModule | null = null;
async function weread(): Promise<WereadModule> {
  if (!_weread) _weread = (await import("weread-omni")) as any;
  return _weread;
}

interface LoginState {
  status: "idle" | "pending" | "done" | "error";
  qrDataUrl?: string;
  vid?: string;
  error?: string;
  promise?: Promise<any>;
}
const loginState: LoginState = { status: "idle" };

function checkAdmin2(c: any): boolean {
  const code = c.req.header("x-admin-code") || c.req.query("code");
  return !!ADMIN_CODE2 && code === ADMIN_CODE2;
}

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** AccountManager 需要 descriptor + client state 文件，登录后手动补齐（旧版迁移兼容）。 */
function ensureWereadAccountFiles(creds: any): void {
  const root = NODE_ENV2.WEREAD_CONFIG_DIR || join(homedir(), ".config", "weread");
  const dir = join(root, "accounts", "default");
  mkdirSync(join(dir, "clients"), { recursive: true, mode: 0o700 });
  const state = {
    version: 1,
    eink: {
      vid: String(creds.vid),
      refreshToken: creds.refreshToken,
      deviceId: creds.deviceId,
      ...(creds.accessToken ? { accessToken: creds.accessToken } : {}),
    },
  };
  writeFileSync(join(dir, "account.json"), JSON.stringify({ version: 1, client: "eink" }), { mode: 0o600 });
  writeFileSync(join(dir, "clients", "eink.json"), JSON.stringify(state), { mode: 0o600 });
  writeFileSync(join(root, "config.json"), JSON.stringify({ version: 1, defaultAccount: "default" }), { mode: 0o600 });
}

async function getCanonicalClient() {
  const m = await weread();
  try {
    const account = await new m.AccountManager().open("default");
    return account.canonical;
  } catch (e: any) {
    // 迁移：老式 credentials 文件存在但缺 descriptor 时自动补
    try {
      const creds = m.loadCredentials({ store: "default" });
      ensureWereadAccountFiles(creds);
      const account = await new m.AccountManager().open("default");
      return account.canonical;
    } catch {
      throw e;
    }
  }
}

app.post("/api/weread/login/start", async (c) => {
  if (!checkAdmin2(c)) return c.json({ error: "unauthorized" }, 401);
  if (loginState.status === "pending") {
    return c.json({ already: true, qr: loginState.qrDataUrl });
  }
  try {
    const m = await weread();
    loginState.status = "pending";
    loginState.error = undefined;
    loginState.qrDataUrl = undefined;
    const qrcode = await import("qrcode");
    loginState.promise = m
      .login({
        onQr: async (confirmUrl: string) => {
          loginState.qrDataUrl = await (qrcode as any).toDataURL(confirmUrl, { width: 260 });
        },
      })
      .then(async (credentials: any) => {
        m.saveCredentials(credentials, { store: "default" });
        try { ensureWereadAccountFiles(credentials); } catch { /* non-fatal */ }
        loginState.status = "done";
        loginState.vid = String(credentials.vid);
        return credentials;
      })
      .catch((err: any) => {
        loginState.status = "error";
        loginState.error = err?.message || String(err);
        throw err;
      });
    // wait briefly for the QR to arrive
    for (let i = 0; i < 20 && !loginState.qrDataUrl && loginState.status === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!loginState.qrDataUrl) {
      const err = loginState.error || "二维码生成失败";
      loginState.status = "idle";
      return c.json({ error: err }, 500);
    }
    return c.json({ qr: loginState.qrDataUrl });
  } catch (e: any) {
    loginState.status = "idle";
    return c.json({ error: e?.message || "login start failed" }, 500);
  }
});

app.get("/api/weread/login/status", async (c) => {
  if (!checkAdmin2(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    status: loginState.status,
    vid: loginState.vid,
    error: loginState.error,
  });
});

app.get("/api/weread/status", async (c) => {
  if (!checkAdmin2(c)) return c.json({ error: "unauthorized" }, 401);
  try {
    const m = await weread();
    const credentials = m.loadCredentials({ store: "default" });
    return c.json({ loggedIn: true, vid: String(credentials.vid) });
  } catch {
    return c.json({ loggedIn: false });
  }
});

// 公开轻量状态：只暴露是否已登录，不含任何敏感信息
app.get("/api/weread/public-status", async (c) => {
  try {
    const m = await weread();
    m.loadCredentials({ store: "default" });
    return c.json({ loggedIn: true });
  } catch {
    return c.json({ loggedIn: false });
  }
});

// ─── Batch export via weread-omni ───────────────────────────────────

app.post("/api/batch/start", async (c) => {
  const body = await c.req.json().catch(() => ({ url: "" }));
  const url: string = body.url || "";
  const name: string = (body.name || "").trim();
  if ((!url || !url.includes("mp.weixin.qq.com")) && !name) {
    return c.json({ error: "请粘贴该公众号任意一篇文章的微信链接，或输入公众号名称" }, 400);
  }
  try {
    const weread = await getCanonicalClient();
    let accountId = "";
    let displayName = "";
    if (name && (!url || !url.includes("mp.weixin.qq.com"))) {
      // 按名称搜索公众号（scope 2）
      const results = await (weread as any).search.books(name, { scope: 2, count: 10 });
      const items = results?.books || results?.items || [];
      const arr = Array.isArray(items) ? items : [];
      const hit = arr.find((b: any) =>
        String(b?.bookInfo?.bookId || b?.bookId || "").startsWith("MP_WXS_")
      );
      accountId = hit?.bookInfo?.bookId || hit?.bookId || "";
      if (!accountId) return c.json({ error: `未找到公众号「${name}」，请尝试粘贴该号任意文章链接` }, 404);
      displayName = hit?.bookInfo?.title || name;
      console.log("[batch] 名称搜索命中:", displayName, "=>", accountId);
    } else {
      // 1. resolve article → reviewId → accountId
      const resolution = await weread.publicAccounts.resolveArticle(url);
      console.log("[batch] reviewId =", resolution.reviewId);
      const m = /^MP_WXS_(\d+)_/.exec(resolution.reviewId);
      if (m) {
        accountId = "MP_WXS_" + m[1];  // 去掉尾部下划线
        console.log("[batch] URL 分支 accountId =", accountId);
      } else {
        // 非标准 reviewId：通过 review 元数据取 bookId（即 accountId）
        const review = await (weread as any).review.single(resolution.reviewId).catch(() => null);
        const bookId = review?.bookId || review?.review?.bookId || "";
        if (!bookId || !/^MP_WXS_\d+$/.test(bookId)) {
          return c.json({ error: "无法解析该公众号 ID（reviewId: " + resolution.reviewId.slice(0, 50) + "）" }, 400);
        }
        accountId = bookId;
      }
    }

    // 2. ensure subscription (articles API may require it)
    console.log("[batch] subscribe+articles accountId =", accountId);
    try {
      await weread.publicAccounts.subscribe(accountId);
    } catch (e: any) { console.log("[batch] subscribe 失败(忽略):", e?.message?.slice(0, 80)); }

    // 3. page through all articles
    const articles: any[] = [];
    let offset: number | undefined = undefined;
    for (let i = 0; i < 60; i++) {
      const page = await weread.publicAccounts.articles(accountId, {
        count: 50,
        ...(offset !== undefined ? { offset } : {}),
      } as any);
      articles.push(...(page.articles || []));
      if (page.nextOffset === undefined || !(page.articles || []).length) break;
      offset = page.nextOffset;
      if (articles.length >= 2000) break;
    }
    if (!articles.length) return c.json({ error: "未获取到文章列表，请稍后重试" }, 404);

    const firstName = displayName || articles.find((a) => a?.mpInfo?.mp_name)?.mpInfo?.mp_name || accountId;
    const items = articles.map((a) => {
      const rid = a?.reviewId || "";
      const docId = rid ? rid.replace(/^MP_WXS_\d+_/, "") : "";
      const fallbackUrl = docId ? "https://mp.weixin.qq.com/s/" + docId : "";
      const rawTitle = a?.mpInfo?.title || a?.title || "未命名";
      const hasRealTitle = rawTitle.length <= 64;
      return {
        title: hasRealTitle ? rawTitle : rawTitle.slice(0, 40) + "…",
        url: a?.mpInfo?.doc_url || fallbackUrl,
        reviewId: rid,
        pic: a?.mpInfo?.pic_url || "",
        time: a?.createTime || a?.mpInfo?.time || 0,
        name: a?.mpInfo?.mp_name || firstName,
      };
    });
    return c.json({ mpId: accountId, name: firstName, count: items.length, articles: items });
  } catch (e: any) {
    const msg = e?.message || "解析失败";
    if (msg.includes("-2041") || msg.includes("验证")) {
      return c.json({ error: "微信读书触发人机验证，请在微信读书 App 完成验证后重试" }, 429);
    }
    if (msg.includes("credentials") || msg.includes("login") || msg.includes("登录")) {
      return c.json({ error: "微信读书账号未登录或已失效，请到管理页重新扫码" }, 401);
    }
    return c.json({ error: msg }, 500);
  }
});

// ZIP of every article fetched from its original URL and converted to markdown
app.post("/api/batch/zip", async (c) => {
  const { articles, name } = await c.req.json().catch(() => ({ articles: [] as any[], name: "公众号" }));
  if (!Array.isArray(articles) || !articles.length) return c.json({ error: "缺少文章列表" }, 400);
  try {
    const jszipMod: any = await import("jszip");
    const JSZip = jszipMod.JSZip || jszipMod.default?.JSZip || jszipMod.default;
    const zip = new JSZip();
    const queue = [...articles];
    let done = 0;
    let wereadClient: any = null;
    try { wereadClient = await getCanonicalClient(); } catch { /* 未登录时只能用公开链接 */ }
    async function resolveRealUrl(art: any): Promise<string> {
      if (wereadClient && art.reviewId) {
        try {
          const rev = await wereadClient.review.single(art.reviewId);
          const mpUrl = rev?.review?.mpInfo?.doc_url || rev?.mpInfo?.doc_url;
          if (mpUrl) return mpUrl;
        } catch { /* fall through */ }
      }
      return art.url || "";
    }
    async function worker() {
      while (queue.length) {
        const art = queue.shift()!;
        try {
          const fetchUrl = await resolveRealUrl(art);
          let html = fetchUrl ? await fetchArticleHtmlSmart(fetchUrl) : "";
          let fullTitle = "";
          let fullAuthor = "";
          let fullBody = "";
          let fullDate = "";
          if (html) {
            const extracted = extractArticle(html);
            fullTitle = extracted.title;
            fullAuthor = extracted.author;
            fullDate = extracted.date;
            if (extracted.content) fullBody = htmlToMarkdown(extracted.content, fetchUrl);
          }
          const hasRealContent = fullBody.replace(/\s/g, "").length > 150;
          if (hasRealContent) {
            const body = fullBody;
            const title = fullTitle;
            const author = fullAuthor;
            const t = fullDate || (art.time ? new Date(art.time * 1000).toISOString().slice(0, 10) : "");
            zip.file(
              `${String(done + 1).padStart(4, "0")}_${sanitizeFilename(title || art.title, 60)}.md`,
              `# ${title || art.title}\n\n> 公众号：${author || art.name || name} | 日期：${t}\n> 原文：${fetchUrl}\n\n---\n\n${body}\n`
            );
          } else {
            // 图片消息/特殊格式：嵌入封面海报 + 说明
            const t = art.time ? new Date(art.time * 1000).toISOString().slice(0, 10) : "";
            const cover = art.pic || "";
            const body = cover
              ? `![文章海报图](${cover})\n\n> ⚠️ 此篇为图片/特殊格式消息，正文以海报图形式呈现，请点击原文查看完整内容。\n`
              : `> ⚠️ 此篇为图片/特殊格式消息，无法提取文字内容，请点击原文查看。\n`;
            zip.file(
              `${String(done + 1).padStart(4, "0")}_${sanitizeFilename(art.title, 60)}.md`,
              `# ${art.title || "未命名"}\n\n> 公众号：${art.name || name} | 日期：${t}\n> 原文：${fetchUrl || art.url}\n\n---\n\n${body}\n`
            );
          }
        } catch { /* skip failures */ }
        done++;
        // 请求间隔，降低触发风控概率
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    await Promise.all(Array.from({ length: 3 }, worker));

    const manifest = {
      account: name,
      total: articles.length,
      exportedAt: new Date().toISOString(),
      articles: articles.map((a: any, i: number) => ({
        index: i + 1, title: a.title, url: a.url,
        publishTime: a.time ? new Date(a.time * 1000).toISOString() : null,
      })),
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return new Response(buf as any, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${sanitizeFilename(name, 50)}_文章导出.zip`)}`,
      },
    });
  } catch (e: any) {
    return c.json({ error: e?.message || "打包失败" }, 500);
  }
});


app.get("/", (c) => {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.html(FRONTEND_HTML);
});

app.get("/admin", (c) => {
  c.header("Cache-Control", "no-cache, no-store, must-revalidate");
  return c.html(ADMIN_HTML);
});

app.get("/healthz", (c) => c.text("ok"));

app.notFound((c) => c.text("Not Found", 404));

export default app;

const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>公众号文章下载 - 一诺 AI 工具站</title>
<meta name="description" content="免费在线微信公众号文章下载工具，单篇导出 Markdown/HTML/纯文本，批量导出公众号全部历史文章 ZIP">
<style>
  :root {
    --grad: linear-gradient(135deg, #2f6fca 0%, #5b9ef4 48%, #8b5cf6 100%);
    --brand: #2f6fca;
    --brand-soft: #5b9ef4;
    --violet: #8b5cf6;
    --glow: 0 12px 26px rgba(47, 111, 202, .26);
    --glow-hover: 0 16px 34px rgba(47, 111, 202, .34);
    --ease: cubic-bezier(.2, .75, .25, 1);
    --bg: #f6f8fc;
    --card: #ffffff;
    --line: #e9edf5;
    --text-1: #1b2333;
    --text-2: #5a6478;
    --text-3: #98a1b3;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  body {
    font-family: "Inter", "Punctuation SC", ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: var(--bg); color: var(--text-1); min-height: 100vh;
  }
  .bg-deco { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
  .bg-deco::before { content: ""; position: absolute; top: -220px; left: 50%; transform: translateX(-50%); width: 900px; height: 480px; border-radius: 50%; background: radial-gradient(closest-side, rgba(91,158,244,.16), rgba(139,92,246,.08), transparent 70%); }
  .bg-deco::after { content: ""; position: absolute; bottom: -260px; right: -160px; width: 640px; height: 420px; border-radius: 50%; background: radial-gradient(closest-side, rgba(139,92,246,.08), transparent 70%); }

  .container { max-width: 760px; margin: 0 auto; padding: 48px 20px 40px; }

  /* ───── Hero ───── */
  .hero { text-align: center; padding: 28px 0 36px; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 3px; color: var(--brand); margin-bottom: 14px; }
  .hero h1 { font-size: 40px; line-height: 1.25; font-weight: 800; letter-spacing: .5px; margin-bottom: 14px; }
  .grad-text { background: var(--grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .hero .sub { color: var(--text-2); font-size: 16px; }
  .src-chip { display: inline-flex; align-items: center; gap: 7px; margin-top: 20px; padding: 7px 16px; font-size: 13px; font-weight: 500; border-radius: 999px; background: rgba(255,255,255,.8); border: 1px solid var(--line); cursor: pointer; color: var(--text-2); transition: border-color .25s var(--ease), box-shadow .25s var(--ease); backdrop-filter: blur(6px); }
  .src-chip:hover { border-color: var(--brand-soft); box-shadow: 0 4px 14px rgba(47,111,202,.12); }
  .src-chip .dot { width: 8px; height: 8px; border-radius: 50%; }
  .src-chip .dot.ok { background: #22b573; box-shadow: 0 0 0 3px rgba(34,181,115,.16); }
  .src-chip .dot.bad { background: #f56c6c; box-shadow: 0 0 0 3px rgba(245,108,108,.16); animation: blink 1.1s infinite; }
  @keyframes blink { 50% { opacity: .35 } }

  /* ───── Tabs ───── */
  .tabs { display: flex; gap: 6px; margin-bottom: 22px; background: rgba(255,255,255,.85); padding: 6px; border-radius: 14px; border: 1px solid var(--line); box-shadow: 0 2px 10px rgba(27,35,51,.04); backdrop-filter: blur(6px); }
  .tab { flex: 1; text-align: center; padding: 12px; font-size: 15px; font-weight: 600; border-radius: 10px; cursor: pointer; color: var(--text-2); transition: all .25s var(--ease); }
  .tab:hover { color: var(--brand); }
  .tab.active { background: var(--grad); background-size: 170% 170%; color: #fff; box-shadow: var(--glow); }

  .panel { display: none; }
  .panel.show { display: block; animation: fadeUp .3s var(--ease); }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }

  /* ───── Card ───── */
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 30px; box-shadow: 0 4px 20px rgba(27,35,51,.05); margin-bottom: 24px; }

  /* ───── Buttons ───── */
  .btn { padding: 0 26px; height: 48px; font-size: 15px; font-weight: 600; border: none; border-radius: 12px; cursor: pointer; transition: all .25s var(--ease); white-space: nowrap; }
  .btn-primary { position: relative; overflow: hidden; background: var(--grad); background-size: 170% 170%; color: #fff !important; box-shadow: var(--glow); }
  .btn-primary:hover { box-shadow: var(--glow-hover); transform: translateY(-1px); background-position: 100% 50%; }
  .btn-primary:active { transform: translateY(0); }
  .btn-primary:disabled { background: #c6cede; box-shadow: none; cursor: not-allowed; transform: none; }
  .btn-primary::after { content: ""; position: absolute; inset: 0; background: linear-gradient(120deg, transparent 32%, rgba(255,255,255,.35) 50%, transparent 68%); transform: translateX(-130%); transition: transform .6s var(--ease); }
  .btn-primary:hover::after { transform: translateX(130%); }
  .input-group { display: flex; gap: 12px; margin-bottom: 18px; }
  .input-group input { flex: 1; min-width: 0; padding: 0 16px; height: 48px; font-size: 15px; border: 1.5px solid var(--line); border-radius: 12px; outline: none; transition: border-color .25s var(--ease), box-shadow .25s var(--ease); background: #fbfcfe; }
  .input-group input:focus { border-color: var(--brand-soft); box-shadow: 0 0 0 3px rgba(91,158,244,.15); background: #fff; }
  input::placeholder { color: #b6bed0; }

  /* ───── Results / errors ───── */
  .result { margin-top: 24px; display: none; }
  .result.show { display: block; animation: fadeUp .3s var(--ease); }
  .result-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
  .result-title { font-size: 17px; font-weight: 700; }
  .result-meta { color: var(--text-3); font-size: 13px; margin-top: 4px; }
  .preview { background: #f8fafd; border: 1px solid var(--line); border-radius: 12px; padding: 20px; max-height: 420px; overflow-y: auto; font-size: 14px; line-height: 1.9; white-space: pre-wrap; word-break: break-word; color: var(--text-2); }
  .download-row { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
  .dl-btn { flex: 1; min-width: 130px; padding: 13px; font-size: 14px; font-weight: 600; border: none; border-radius: 12px; cursor: pointer; background: var(--grad); background-size: 170% 170%; color: #fff !important; box-shadow: var(--glow); transition: all .25s var(--ease); text-align: center; text-decoration: none; display: inline-block; }
  .dl-btn:hover { box-shadow: var(--glow-hover); transform: translateY(-1px); background-position: 100% 50%; }
  .error { background: #fef1f1; color: #e05252; padding: 12px 16px; border-radius: 10px; margin-top: 16px; font-size: 14px; display: none; border: 1px solid #fadcdc; }
  .error.show { display: block; }
  .loading { text-align: center; padding: 30px; color: var(--text-3); display: none; }
  .loading.show { display: block; }
  .spinner { display: inline-block; width: 26px; height: 26px; border: 3px solid var(--line); border-top-color: var(--brand); border-radius: 50%; animation: spin .75s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ───── Features ───── */
  .features { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; margin-top: 26px; }
  @media (max-width: 520px) { .features { grid-template-columns: 1fr; } .input-group { flex-direction: column; } .hero h1 { font-size: 30px; } }
  .feature { text-align: center; padding: 22px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; transition: transform .25s var(--ease), box-shadow .25s var(--ease); }
  .feature:hover { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(27,35,51,.07); }
  .feature svg { width: 26px; height: 26px; stroke: var(--brand); margin-bottom: 10px; }
  .feature h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .feature p { font-size: 12px; color: var(--text-3); }

  .footer { text-align: center; padding: 44px 0 20px; color: var(--text-3); font-size: 12px; }
  .footer a { color: var(--text-2); text-decoration: none; transition: color .2s; }
  .footer a:hover { color: var(--brand); }

  .tips { margin-top: 16px; padding: 14px 16px; background: #f3f8ff; border: 1px solid #e3eefc; border-radius: 10px; font-size: 13px; color: var(--brand); line-height: 1.9; }

  /* ───── Batch ───── */
  .batch-step { display: none; }
  .batch-step.show { display: block; }
  .batch-status { background: #f8fafd; border: 1px solid var(--line); border-radius: 14px; padding: 26px; text-align: center; position: relative; }
  .batch-close { position: absolute; top: 10px; right: 12px; width: 28px; height: 28px; border: none; border-radius: 50%; background: #eef1f6; color: var(--text-3); font-size: 14px; cursor: pointer; transition: all .2s var(--ease); line-height: 1; }
  .batch-close:hover { background: #f56c6c; color: #fff; }
  .batch-count { font-size: 38px; font-weight: 800; margin: 10px 0; background: var(--grad); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .batch-count .unit { font-size: 16px; color: var(--text-3); font-weight: 400; -webkit-text-fill-color: var(--text-3); }
  .batch-label { color: var(--text-2); font-size: 14px; }
  .progress-bar { height: 6px; background: #e9edf5; border-radius: 3px; overflow: hidden; margin: 18px auto; max-width: 300px; }
  .progress-bar .fill { height: 100%; background: var(--grad); border-radius: 3px; width: 40%; animation: slide 1.2s linear infinite; }
  @keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
  .cancel-btn { display: none; width: 100%; margin-top: 10px; padding: 12px; font-size: 14px; background: #fff; color: var(--text-3); border: 1.5px solid var(--line); border-radius: 12px; cursor: pointer; transition: all .2s var(--ease); }
  .cancel-btn.show { display: block; }
  .cancel-btn:hover { color: #e05252; border-color: #f3b3b3; background: #fef1f1; }
  .art-list { max-height: 320px; overflow-y: auto; text-align: left; margin-top: 16px; background: #f8fafd; border-radius: 12px; border: 1px solid var(--line); }
  .art-item { padding: 11px 16px; border-bottom: 1px solid #eef1f6; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .art-item:last-child { border-bottom: none; }
  .art-item a { flex: 1; min-width: 0; color: var(--text-1); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .2s; }
  .art-item a:hover { color: var(--brand); }
  .art-item .date { color: var(--text-3); font-size: 12px; white-space: nowrap; }
  .art-item.cover-note a { color: var(--text-3); }
  .big-btn { display: block; width: 100%; padding: 15px; font-size: 15px; background: var(--grad); background-size: 170% 170%; color: #fff; border: none; border-radius: 12px; font-weight: 700; cursor: pointer; margin-top: 16px; box-shadow: var(--glow); transition: all .25s var(--ease); position: relative; overflow: hidden; }
  .big-btn::after { content: ""; position: absolute; inset: 0; background: linear-gradient(120deg, transparent 32%, rgba(255,255,255,.35) 50%, transparent 68%); transform: translateX(-130%); transition: transform .6s var(--ease); }
  .big-btn:hover:not(:disabled) { box-shadow: var(--glow-hover); transform: translateY(-1px); }
  .big-btn:hover:not(:disabled)::after { transform: translateX(130%); }
  .big-btn:disabled { background: #c6cede; box-shadow: none; cursor: not-allowed; transform: none; }
  .big-btn.ghost { background: #fff; color: var(--brand); border: 1.5px solid var(--line); box-shadow: none; }
  .big-btn.ghost:hover { border-color: var(--brand-soft); }

  /* ───── Renew button ───── */
  .renew-btn { display: none; margin-top: 12px; padding: 13px 20px; font-size: 14px; font-weight: 600; background: #fff; color: #e6a23c; border: 1.5px solid #f3d19e; border-radius: 12px; cursor: pointer; width: 100%; transition: all .22s var(--ease); }
  .renew-btn.show { display: block; }
  .renew-btn:hover { background: #fdf6ec; }

  /* ───── Modal ───── */
  .modal-overlay { position: fixed; inset: 0; background: rgba(20, 28, 45, .5); backdrop-filter: blur(4px); z-index: 999; display: none; align-items: center; justify-content: center; padding: 16px; }
  .modal-overlay.show { display: flex; }
  .modal-card { background: #fff; border-radius: 20px; padding: 30px; max-width: 400px; width: 100%; position: relative; max-height: 90vh; overflow-y: auto; box-shadow: 0 24px 60px rgba(27,35,51,.2); animation: fadeUp .3s var(--ease); }
  .modal-close { position: absolute; top: 14px; right: 18px; font-size: 20px; color: var(--text-3); cursor: pointer; background: none; border: none; line-height: 1; }
  .modal-close:hover { color: var(--text-1); }
  .modal-card h3 { font-size: 17px; margin-bottom: 18px; text-align: center; font-weight: 700; }
  .modal-card input { width: 100%; padding: 0 14px; height: 46px; font-size: 15px; border: 1.5px solid var(--line); border-radius: 10px; outline: none; margin-bottom: 14px; transition: border-color .25s, box-shadow .25s; }
  .modal-card input:focus { border-color: var(--brand-soft); box-shadow: 0 0 0 3px rgba(91,158,244,.15); }
  .modal-card .qr-box { text-align: center; padding: 6px 0; }
  .modal-card .qr-box img { width: 220px; height: 220px; border-radius: 10px; }
  .modal-card .hint { color: var(--text-2); font-size: 13px; margin-top: 10px; line-height: 1.7; text-align: center; }
  .modal-card .warn { color: #e6a23c; font-size: 13px; text-align: center; margin-top: 8px; }
  .modal-card .ok { color: #22b573; font-size: 14px; text-align: center; }
</style>
</head>
<body>
<div class="bg-deco"></div>
<div class="container">
  <header class="hero">
    <div class="eyebrow">WECHAT ARTICLE TOOLKIT</div>
    <h1>公众号文章，<span class="grad-text">一键导出</span></h1>
    <p class="sub">单篇秒下 · 整号批量打包 · Markdown / HTML / 纯文本</p>
    <button class="src-chip" id="src-chip" onclick="openLoginModal()" title="点击管理数据源授权">
      <span class="dot" id="src-dot"></span><span id="src-text">数据源检测中...</span>
    </button>
  </header>

  <div class="tabs">
    <div class="tab active" data-tab="single" onclick="switchTab('single')">单篇下载</div>
    <div class="tab" data-tab="batch" onclick="switchTab('batch')">批量导出整号</div>
  </div>

  <!-- 单篇下载 -->
  <div class="panel show" id="panel-single">
    <div class="card">
      <div class="input-group">
        <input type="url" id="url-input" placeholder="https://mp.weixin.qq.com/s/..." />
        <button class="btn btn-primary" id="btn-fetch" onclick="fetchArticle()">解析</button>
      </div>
      <div class="error" id="error-box"></div>
      <div class="loading" id="loading-box"><div class="spinner"></div><p style="margin-top:12px">正在获取文章内容...</p></div>
      <div class="result" id="result-box">
        <div class="result-header">
          <div>
            <div class="result-title" id="result-title"></div>
            <div class="result-meta" id="result-meta"></div>
          </div>
        </div>
        <div class="preview" id="preview"></div>
        <div class="download-row">
          <a class="dl-btn" id="dl-markdown" href="#">⬇ 下载 Markdown</a>
          <a class="dl-btn" id="dl-html" href="#" target="_blank">⬇ 下载 HTML</a>
          <a class="dl-btn" id="dl-text" href="#">⬇ 下载 纯文本</a>
        </div>
      </div>
    </div>
    <div class="features">
      <div class="feature">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" stroke="currentColor"/></svg>
        <h3>一键导出</h3><p>粘贴链接即可获取</p>
      </div>
      <div class="feature">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor"/></svg>
        <h3>Markdown 格式</h3><p>保留图片和排版</p>
      </div>
      <div class="feature">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z" stroke="currentColor"/><path d="M9 12l2 2 4-4" stroke="currentColor"/></svg>
        <h3>本地处理</h3><p>不存储任何数据</p>
      </div>
    </div>
  </div>

  <!-- 批量导出 -->
  <div class="panel" id="panel-batch">
    <div class="card">
      <div class="batch-step show" id="bs-input">
        <div class="input-group">
          <input type="text" id="batch-url" placeholder="公众号名称，或粘贴该号任意文章链接" />
        </div>
        <button class="big-btn" id="btn-batch" onclick="batchStart()">🔍 解析并获取全部文章</button>
        <div class="error" id="batch-error"></div>
        <button class="renew-btn" id="renew-btn" onclick="openLoginModal()">📱 微信读书未登录，点击扫码登录</button>
        <div class="tips" style="margin-top:16px">
          💡 <strong>怎么导出一个公众号的全部文章？</strong><br>
          1. 直接输入公众号名称（如「遇见一诺」），或粘贴该号任意一篇文章链接<br>
          2. 点击解析，等待文章列表出现（约 10~60 秒）<br>
          3. 点击「打包下载 ZIP」，每 100 篇约需 1~2 分钟
        </div>
      </div>

      <div class="batch-step" id="bs-progress">
        <div class="batch-status">
          <div class="spinner"></div>
          <div class="batch-label" id="batch-name" style="margin-top:14px">正在解析公众号...</div>
          <div class="batch-count"><span id="batch-elapsed">0</span><span class="unit"> 秒</span></div>
          <div class="progress-bar"><div class="fill"></div></div>
          <div class="batch-label">正在拉取全部文章列表，请勿关闭页面...</div>
        </div>
      </div>

      <div class="batch-step" id="bs-done">
        <div class="batch-status">
          <button class="batch-close" onclick="batchReset()" title="关闭，返回输入">✕</button>
          <div class="batch-label" id="done-name"></div>
          <div class="batch-count"><span id="done-count">0</span><span class="unit"> 篇</span></div>
          <div class="batch-label">文章列表获取完成 ✅</div>
        </div>
        <button class="big-btn" id="btn-zip" onclick="downloadZip()">📦 打包下载全部文章 (ZIP)</button>
        <button class="cancel-btn" id="btn-zip-cancel" onclick="cancelZip()">✕ 取消打包</button>
        <div class="art-list" id="art-list"></div>
      </div>
    </div>
  </div>

  <div class="footer">
    <a href="https://yinuo-ai.com" target="_blank">一诺 AI</a> · v2.3
  </div>
</div>

<div class="modal-overlay" id="login-modal">
  <div class="modal-card">
    <button class="modal-close" onclick="closeLoginModal()">×</button>
    <h3>📱 微信读书授权</h3>
    <div id="modal-pwd-step">
      <p style="font-size:13px;color:var(--text-3);margin-bottom:12px;text-align:center">此操作需站长授权密码（访客无需理会）</p>
      <input type="password" id="modal-code" placeholder="输入授权密码" />
      <button class="big-btn" style="padding:12px" onclick="modalAuth()">确认</button>
      <p class="hint" id="modal-err" style="color:#e05252;display:none"></p>
    </div>
    <div id="modal-qr-step" style="display:none">
      <div class="qr-box"><img id="modal-qr-img" alt="二维码" /></div>
      <p class="hint">请用 <b>微信</b> 扫码，打开微信读书完成授权<br>扫码成功后本页面自动继续</p>
      <p class="warn" id="modal-status">等待扫码...</p>
      <button class="big-btn ghost" style="padding:10px" onclick="closeLoginModal()">取消</button>
    </div>
    <div id="modal-done-step" style="display:none">
      <p class="ok" style="font-size:15px">✓ 授权成功，可以继续导出了</p>
      <button class="big-btn" style="padding:10px" onclick="closeLoginModal()">好的，去导出</button>
    </div>
  </div>
</div>

<script>
// ============ tabs ============
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
  document.getElementById('panel-' + name).classList.add('show');
}

// ============ 单篇下载 ============
let currentUrl = '';
document.getElementById('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchArticle(); });

async function fetchArticle() {
  const url = document.getElementById('url-input').value.trim();
  const btn = document.getElementById('btn-fetch');
  document.getElementById('error-box').classList.remove('show');
  document.getElementById('result-box').classList.remove('show');
  if (!url || !url.includes('mp.weixin.qq.com')) { showSingleError('请输入有效的微信公众号文章链接'); return; }
  currentUrl = url;
  btn.disabled = true; btn.textContent = '解析中...';
  document.getElementById('loading-box').classList.add('show');
  try {
    const resp = await fetch('/api/preview?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '获取失败');
    showResult(data);
  } catch (e) { showSingleError(e.message); }
  finally { btn.disabled = false; btn.textContent = '解析'; document.getElementById('loading-box').classList.remove('show'); }
}
function showResult(data) {
  document.getElementById('result-title').textContent = data.title || '未命名文章';
  document.getElementById('result-meta').textContent = (data.author ? '公众号：' + data.author : '') + (data.date ? ' | ' + data.date : '') + ' | ' + (data.length || 0) + ' 字符';
  document.getElementById('preview').textContent = data.markdown || '';
  const enc = encodeURIComponent(currentUrl);
  document.getElementById('dl-markdown').href = '/api/download?url=' + enc + '&format=markdown';
  document.getElementById('dl-html').href = '/api/download?url=' + enc + '&format=html';
  document.getElementById('dl-text').href = '/api/download?url=' + enc + '&format=text';
  document.getElementById('result-box').classList.add('show');
}
function showSingleError(msg) { const box = document.getElementById('error-box'); box.textContent = '⚠ ' + msg; box.classList.add('show'); }

// ============ 批量导出 ============
let batchArticles = [];
let batchName = '';
let elapsedTimer = null;

async function batchStart() {
  const input = document.getElementById('batch-url').value.trim();
  const btn = document.getElementById('btn-batch');
  const errBox = document.getElementById('batch-error');
  errBox.classList.remove('show');
  document.getElementById('renew-btn').classList.remove('show');
  const isUrl = input.includes('mp.weixin.qq.com');
  const payload = isUrl ? { url: input } : { name: input };
  if (!input) { showBatchError('请输入公众号名称或文章链接'); return; }
  btn.disabled = true;
  document.getElementById('bs-input').classList.remove('show');
  document.getElementById('bs-progress').classList.add('show');
  document.getElementById('batch-name').textContent = isUrl ? '正在解析文章链接...' : ('正在搜索公众号「' + input + '」...');
  let sec = 0;
  document.getElementById('batch-elapsed').textContent = '0';
  elapsedTimer = setInterval(() => { sec++; document.getElementById('batch-elapsed').textContent = String(sec); }, 1000);
  try {
    const resp = await fetch('/api/batch/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (!resp.ok) {
      const err = new Error(data.error || '解析失败');
      err.status = resp.status;
      throw err;
    }
    batchArticles = data.articles || [];
    batchName = data.name || data.mpId || '公众号';
    document.getElementById('done-name').textContent = '公众号：' + batchName;
    document.getElementById('done-count').textContent = data.count || batchArticles.length;
    document.getElementById('art-list').innerHTML = batchArticles.slice(0, 50).map(a => {
      const d = a.time ? new Date(a.time * 1000).toISOString().slice(0, 10) : '';
      const t = (a.title || '无标题');
      const esc = t.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
      const isCover = !a.url || a.url.length < 10;
      const mark = isCover ? '🖼️ ' : '';
      return '<div class="art-item' + (isCover ? ' cover-note' : '') + '"><a href="' + (a.url || 'javascript:void(0)') + '" target="_blank" title="' + esc + '">' + mark + t + '</a><span class="date">' + d + '</span></div>';
    }).join('') + (batchArticles.length > 50 ? '<div class="art-item" style="justify-content:center;color:#999">... 共 ' + batchArticles.length + ' 篇</div>' : '');
    document.getElementById('bs-progress').classList.remove('show');
    document.getElementById('bs-done').classList.add('show');
  } catch (e) {
    showBatchError(e.message);
    if (e.status === 401) document.getElementById('renew-btn').classList.add('show');
    document.getElementById('bs-progress').classList.remove('show');
    document.getElementById('bs-input').classList.add('show');
  }
  finally {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    btn.disabled = false; btn.textContent = '🔍 解析并获取全部文章';
  }
}

let zipAbort = null;

async function downloadZip() {
  if (!batchArticles.length) return;
  const btn = document.getElementById('btn-zip');
  const cancelBtn = document.getElementById('btn-zip-cancel');
  btn.disabled = true; btn.textContent = '⏳ 正在抓取全文并打包，可随时取消...';
  cancelBtn.classList.add('show');
  zipAbort = new AbortController();
  let canceled = false;
  try {
    const resp = await fetch('/api/batch/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ articles: batchArticles, name: batchName }), signal: zipAbort.signal });
    if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || resp.status); }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = batchName + '_文章导出.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) {
    if (e.name === 'AbortError') { canceled = true; }
    else { alert('打包失败: ' + e.message); }
  }
  finally {
    zipAbort = null;
    cancelBtn.classList.remove('show');
    btn.disabled = false; btn.textContent = '📦 打包下载全部文章 (ZIP)';
    if (canceled) showBatchError('已取消打包。文章列表仍保留，可重新点击打包。');
  }
}

function cancelZip() {
  if (zipAbort) { zipAbort.abort(); }
}

function batchReset() {
  if (zipAbort) zipAbort.abort();
  batchArticles = [];
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  document.getElementById('btn-zip-cancel').classList.remove('show');
  document.getElementById('batch-url').value = '';
  document.getElementById('bs-done').classList.remove('show');
  document.getElementById('bs-input').classList.add('show');
}
function showBatchError(msg) { const box = document.getElementById('batch-error'); box.textContent = '⚠ ' + msg; box.classList.add('show'); }

// ============ 数据源状态徽章 + 授权弹窗 ============
let modalPollTimer = null;

async function refreshSrcChip() {
  const dot = document.getElementById('src-dot');
  const text = document.getElementById('src-text');
  try {
    const r = await fetch('/api/weread/public-status');
    const d = await r.json();
    if (d.loggedIn) { dot.className = 'dot ok'; text.textContent = '数据源正常'; }
    else { dot.className = 'dot bad'; text.textContent = '未登录 · 点击登录'; }
  } catch { dot.className = 'dot bad'; text.textContent = '数据源状态未知'; }
}
refreshSrcChip();

function openLoginModal() {
  document.getElementById('renew-btn').classList.remove('show');
  document.getElementById('login-modal').classList.add('show');
  const saved = localStorage.getItem('admin_code');
  if (saved) { modalAuthWith(saved); }
  else {
    document.getElementById('modal-pwd-step').style.display = 'block';
    document.getElementById('modal-qr-step').style.display = 'none';
    document.getElementById('modal-done-step').style.display = 'none';
  }
}
function closeLoginModal() {
  document.getElementById('login-modal').classList.remove('show');
  if (modalPollTimer) { clearInterval(modalPollTimer); modalPollTimer = null; }
}

function modalAuth() {
  const code = document.getElementById('modal-code').value.trim();
  if (!code) return;
  modalAuthWith(code);
}

async function modalApi(path, opts = {}) {
  const resp = await fetch(path, { ...opts, headers: { 'x-admin-code': localStorage.getItem('admin_code') || '', ...(opts.headers||{}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw Object.assign(new Error(data.error || resp.status), { status: resp.status });
  return data;
}

async function modalAuthWith(code) {
  localStorage.setItem('admin_code', code);
  const errEl = document.getElementById('modal-err');
  errEl.style.display = 'none';
  try {
    const data = await modalApi('/api/weread/login/start', { method: 'POST' });
    if (data.error) throw new Error(data.error);
    document.getElementById('modal-pwd-step').style.display = 'none';
    document.getElementById('modal-qr-step').style.display = 'block';
    document.getElementById('modal-qr-img').src = data.qr;
    document.getElementById('modal-status').textContent = '等待扫码...';
    modalPollTimer = setInterval(modalCheckLogin, 3000);
  } catch (e) {
    if (e.status === 401) { errEl.textContent = '密码错误'; errEl.style.display = 'block'; localStorage.removeItem('admin_code'); }
    else { errEl.textContent = '启动失败: ' + e.message; errEl.style.display = 'block'; }
  }
}

async function modalCheckLogin() {
  try {
    const data = await modalApi('/api/weread/login/status');
    if (data.status === 'done') {
      if (modalPollTimer) { clearInterval(modalPollTimer); modalPollTimer = null; }
      document.getElementById('modal-qr-step').style.display = 'none';
      document.getElementById('modal-done-step').style.display = 'block';
      refreshSrcChip();
    } else if (data.status === 'error') {
      if (modalPollTimer) { clearInterval(modalPollTimer); modalPollTimer = null; }
      document.getElementById('modal-status').innerHTML = '<span style="color:#e05252">登录失败: ' + (data.error||'') + '</span>';
    }
  } catch { /* keep polling */ }
}
</script>
</body>
</html>`;


// ─── Admin page HTML ────────────────────────────────────────────────

// ─── Admin page HTML ────────────────────────────────────────────────

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>管理后台 - 微信读书账号</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; min-height: 100vh; padding: 32px 16px; }
  .container { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 24px; text-align: center; }
  .card { background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 16px; }
  input { width: 100%; padding: 12px 14px; font-size: 15px; border: 2px solid #e5e7eb; border-radius: 10px; outline: none; }
  input:focus { border-color: #07c160; }
  button { padding: 12px 20px; font-size: 14px; font-weight: 600; border: none; border-radius: 10px; cursor: pointer; background: #07c160; color: #fff; }
  button:disabled { background: #c0c4cc; }
  button.gray { background: #909399; }
  .qr-box { text-align: center; padding: 20px; }
  .qr-box img { width: 240px; height: 240px; border-radius: 8px; }
  .hint { color: #888; font-size: 13px; margin-top: 12px; line-height: 1.8; text-align: center; }
  .acct { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
  .acct-name { font-weight: 600; }
  .acct-id { color: #999; font-size: 12px; }
  .ok { color: #07c160; font-size: 13px; }
  .warn { color: #e6a23c; font-size: 13px; }
  .err { color: #f56c6c; font-size: 13px; margin-top: 8px; display: none; }
  .err.show { display: block; }
</style>
</head>
<body>
<div class="container">
  <h1>🔐 管理后台</h1>
  <div class="card" id="login-card">
    <input type="password" id="code" placeholder="输入管理密码" />
    <div style="margin-top:12px"><button onclick="saveCode()">进入</button></div>
    <div class="err" id="err1"></div>
  </div>
  <div id="main" style="display:none">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>微信读书账号</b>
        <button onclick="startLogin()" id="addBtn">+ 扫码添加账号</button>
      </div>
      <div id="acct-list">加载中...</div>
      <p class="hint" style="text-align:left">• 扫码登录微信读书后，即可批量导出公众号文章<br>• 登录状态长期有效，失效时回到此页重新扫码</p>
    </div>
    <div class="card qr-box" id="qr-card" style="display:none">
      <img id="qr-img" alt="二维码" />
      <p class="hint">请用<b>微信</b>扫描二维码，打开微信读书授权登录<br>扫码后此页面会自动完成添加</p>
      <p class="warn" id="login-status" style="margin-top:8px">等待扫码...</p>
      <button class="gray" style="margin-top:8px" onclick="cancelLogin()">取消</button>
    </div>
  </div>
</div>
<script>
let ADMIN = localStorage.getItem('admin_code') || '';
let pollTimer = null;

if (ADMIN) { tryEnter(); }

function saveCode() {
  ADMIN = document.getElementById('code').value.trim();
  tryEnter();
}
function showErr(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.add('show'); }

async function api(path, opts = {}) {
  const resp = await fetch(path, { ...opts, headers: { 'x-admin-code': ADMIN, ...(opts.headers||{}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || resp.status);
  return data;
}

async function tryEnter() {
  try {
    await api('/api/weread/status');
    localStorage.setItem('admin_code', ADMIN);
    document.getElementById('login-card').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    loadAccounts();
  } catch (e) { showErr('err1', '密码错误：' + e.message); }
}

async function loadAccounts() {
  try {
    const data = await api('/api/weread/status');
    const el = document.getElementById('acct-list');
    if (!data.loggedIn) { el.innerHTML = '<p class="warn">暂无账号，点击上方按钮扫码添加</p>'; return; }
    el.innerHTML = '<div class="acct"><div><div class="acct-name">微信读书账号</div><div class="acct-id">vid ' + data.vid + '</div></div><span class="ok">已登录</span></div>';
  } catch (e) { document.getElementById('acct-list').textContent = '加载失败: ' + e.message; }
}

async function startLogin() {
  const btn = document.getElementById('addBtn');
  btn.disabled = true;
  try {
    const data = await api('/api/weread/login/start', { method: 'POST' });
    if (data.error) throw new Error(data.error);
    document.getElementById('qr-img').src = data.qr;
    document.getElementById('qr-card').style.display = 'block';
    document.getElementById('login-status').textContent = '等待扫码...';
    pollTimer = setInterval(checkLogin, 3000);
  } catch (e) { alert('启动登录失败: ' + e.message); }
  btn.disabled = false;
}

async function checkLogin() {
  try {
    const data = await api('/api/weread/login/status');
    if (data.status === 'done') {
      clearInterval(pollTimer);
      document.getElementById('login-status').innerHTML = '<span class="ok">✓ 登录成功（vid ' + data.vid + '）</span>';
      setTimeout(() => { document.getElementById('qr-card').style.display = 'none'; loadAccounts(); }, 1500);
    } else if (data.status === 'error') {
      clearInterval(pollTimer);
      document.getElementById('login-status').innerHTML = '<span class="err show">登录失败: ' + (data.error||'') + '</span>';
    }
  } catch (e) { /* keep polling */ }
}

function cancelLogin() {
  if (pollTimer) clearInterval(pollTimer);
  document.getElementById('qr-card').style.display = 'none';
}
</script>
</body>
</html>`;
