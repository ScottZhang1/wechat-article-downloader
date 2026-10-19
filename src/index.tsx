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
      return {
        title: a?.mpInfo?.title || a?.title || "未命名",
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
<title>公众号文章下载 - 免费 · 单篇/批量导出</title>
<meta name="description" content="免费在线微信公众号文章下载工具，支持单篇导出 Markdown/HTML/纯文本，支持批量导出公众号全部历史文章 ZIP">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: #f7f8fa; color: #333; min-height: 100vh; }
  .container { max-width: 680px; margin: 0 auto; padding: 24px 16px; }
  .header { text-align: center; padding: 40px 0 24px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .header p { color: #888; font-size: 15px; }
  .tabs { display: flex; gap: 8px; margin-bottom: 20px; background: #fff; padding: 6px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  .tab { flex: 1; text-align: center; padding: 12px; font-size: 15px; font-weight: 600; border-radius: 8px; cursor: pointer; color: #666; transition: all .2s; }
  .tab.active { background: #07c160; color: #fff; }
  .panel { display: none; }
  .panel.show { display: block; }
  .card { background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px; }
  .input-group { display: flex; gap: 12px; margin-bottom: 16px; }
  .input-group input { flex: 1; padding: 14px 16px; font-size: 15px; border: 2px solid #e5e7eb; border-radius: 12px; outline: none; transition: border-color .2s; }
  .input-group input:focus { border-color: #07c160; }
  input::placeholder { color: #c0c4cc; }
  .btn { padding: 14px 28px; font-size: 15px; font-weight: 600; border: none; border-radius: 12px; cursor: pointer; transition: all .2s; white-space: nowrap; }
  .btn-primary { background: #07c160; color: #fff; }
  .btn-primary:hover { background: #06ad56; }
  .btn-primary:disabled { background: #c0c4cc; cursor: not-allowed; }
  .formats { display: flex; gap: 8px; flex-wrap: wrap; }
  .format-btn { padding: 8px 16px; font-size: 13px; border: 1px solid #dcdfe6; border-radius: 8px; cursor: pointer; background: #fff; transition: all .2s; }
  .format-btn.active { background: #07c160; color: #fff; border-color: #07c160; }
  .format-btn:hover:not(.active) { border-color: #07c160; color: #07c160; }
  .result { margin-top: 24px; display: none; }
  .result.show { display: block; }
  .result-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid #f0f0f0; margin-bottom: 16px; }
  .result-title { font-size: 18px; font-weight: 600; }
  .result-meta { color: #999; font-size: 13px; margin-top: 4px; }
  .preview { background: #fafafa; border-radius: 12px; padding: 20px; max-height: 400px; overflow-y: auto; font-size: 14px; line-height: 1.8; white-space: pre-wrap; word-break: break-word; color: #444; border: 1px solid #f0f0f0; }
  .download-row { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
  .dl-btn { flex: 1; min-width: 120px; padding: 12px; font-size: 14px; font-weight: 600; border: 2px solid #07c160; border-radius: 10px; cursor: pointer; background: #fff; color: #07c160; transition: all .2s; text-align: center; text-decoration: none; display: inline-block; }
  .dl-btn:hover { background: #07c160; color: #fff; }
  .error { background: #fef0f0; color: #f56c6c; padding: 12px 16px; border-radius: 8px; margin-top: 16px; font-size: 14px; display: none; }
  .error.show { display: block; }
  .loading { text-align: center; padding: 32px; color: #999; display: none; }
  .loading.show { display: block; }
  .spinner { display: inline-block; width: 28px; height: 28px; border: 3px solid #e5e7eb; border-top-color: #07c160; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tips { margin-top: 16px; padding: 16px; background: #f0f9eb; border-radius: 8px; font-size: 13px; color: #67c23a; line-height: 1.8; }
  .features { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; margin-top: 32px; }
  @media (max-width: 480px) { .features { grid-template-columns: 1fr; } .input-group { flex-direction: column; } }
  .feature { text-align: center; padding: 20px 12px; background: #fff; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
  .feature-icon { font-size: 28px; margin-bottom: 8px; }
  .feature h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .feature p { font-size: 12px; color: #999; }
  .footer { text-align: center; padding: 40px 0 24px; color: #c0c4cc; font-size: 12px; }
  .footer a { color: #999; text-decoration: none; }
  .batch-step { display: none; }
  .batch-step.show { display: block; }
  .batch-status { background: #fafafa; border: 1px solid #f0f0f0; border-radius: 12px; padding: 24px; text-align: center; }
  .batch-count { font-size: 36px; font-weight: 700; color: #07c160; margin: 10px 0; }
  .batch-count .unit { font-size: 16px; color: #999; font-weight: 400; }
  .batch-label { color: #888; font-size: 14px; }
  .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; margin: 18px auto; max-width: 300px; }
  .progress-bar .fill { height: 100%; background: repeating-linear-gradient(45deg,#07c160 0 12px,#06ad56 12px 24px); border-radius: 4px; width: 40%; animation: slide 1.2s linear infinite; }
  @keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }
  .art-list { max-height: 300px; overflow-y: auto; text-align: left; margin-top: 16px; background: #fafafa; border-radius: 12px; border: 1px solid #f0f0f0; }
  .art-item { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; font-size: 14px; display: flex; justify-content: space-between; gap: 8px; }
  .art-item a { color: #333; text-decoration: none; }
  .art-item a:hover { color: #07c160; }
  .art-item .date { color: #bbb; font-size: 12px; white-space: nowrap; }
  .big-btn { display: block; width: 100%; padding: 16px; font-size: 16px; background: #07c160; color: #fff; border: none; border-radius: 12px; font-weight: 700; cursor: pointer; margin-top: 16px; }
  .big-btn:disabled { background: #c0c4cc; cursor: not-allowed; }
  .big-btn.ghost { background: #fff; color: #07c160; border: 2px solid #07c160; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📄 公众号文章下载</h1>
    <p>单篇秒下 · 整号批量打包，导出 Markdown / HTML / 纯文本</p>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="single" onclick="switchTab('single')">单篇下载</div>
    <div class="tab" data-tab="batch" onclick="switchTab('batch')">批量导出整号</div>
  </div>

  <!-- 单篇下载 -->
  <div class="panel show" id="panel-single">
    <div class="card">
      <div class="input-group">
        <input type="url" id="url-input" placeholder="https://mp.weixin.qq.com/s/..." />
        <button class="btn btn-primary" id="btn-fetch" onclick="fetchArticle()">下载</button>
      </div>
      <div class="formats">
        <button class="format-btn active" data-format="markdown">Markdown</button>
        <button class="format-btn" data-format="html">HTML</button>
        <button class="format-btn" data-format="text">纯文本</button>
        <button class="format-btn" data-format="json">JSON</button>
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
          <a class="dl-btn" id="dl-markdown" href="#">📥 Markdown</a>
          <a class="dl-btn" id="dl-html" href="#" target="_blank">🌐 HTML</a>
          <a class="dl-btn" id="dl-text" href="#">📝 纯文本</a>
        </div>
      </div>
    </div>
    <div class="features">
      <div class="feature"><div class="feature-icon">⚡</div><h3>一键导出</h3><p>粘贴链接即可获取</p></div>
      <div class="feature"><div class="feature-icon">📝</div><h3>Markdown 格式</h3><p>保留图片和排版</p></div>
      <div class="feature"><div class="feature-icon">🔒</div><h3>无需登录</h3><p>免费使用，不存数据</p></div>
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
          <div class="batch-label" id="done-name"></div>
          <div class="batch-count"><span id="done-count">0</span><span class="unit"> 篇</span></div>
          <div class="batch-label">文章列表获取完成 ✅</div>
        </div>
        <button class="big-btn" id="btn-zip" onclick="downloadZip()">📦 打包下载全部文章 (ZIP)</button>
        <div class="art-list" id="art-list"></div>
        <button class="big-btn ghost" onclick="batchReset()">再导出一个公众号</button>
      </div>
    </div>
  </div>

  <div class="footer">
    <a href="https://yinuo-ai.com" target="_blank">一诺 AI</a> · v2.2 · 免费 · 不存数据 · <a href="/admin">管理</a>
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
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.format;
  });
});
let currentFormat = 'markdown';
document.getElementById('url-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchArticle(); });

async function fetchArticle() {
  const url = document.getElementById('url-input').value.trim();
  const btn = document.getElementById('btn-fetch');
  document.getElementById('error-box').classList.remove('show');
  document.getElementById('result-box').classList.remove('show');
  if (!url || !url.includes('mp.weixin.qq.com')) { showSingleError('请输入有效的微信公众号文章链接'); return; }
  currentUrl = url;
  btn.disabled = true; btn.textContent = '获取中...';
  document.getElementById('loading-box').classList.add('show');
  try {
    const resp = await fetch('/api/preview?url=' + encodeURIComponent(url));
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '获取失败');
    showResult(data);
  } catch (e) { showSingleError(e.message); }
  finally { btn.disabled = false; btn.textContent = '下载'; document.getElementById('loading-box').classList.remove('show'); }
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
    if (!resp.ok) throw new Error(data.error || '解析失败');
    batchArticles = data.articles || [];
    batchName = data.name || data.mpId || '公众号';
    document.getElementById('done-name').textContent = '公众号：' + batchName;
    document.getElementById('done-count').textContent = data.count || batchArticles.length;
    document.getElementById('art-list').innerHTML = batchArticles.slice(0, 50).map(a => {
      const d = a.time ? new Date(a.time * 1000).toISOString().slice(0, 10) : '';
      return '<div class="art-item"><a href="' + a.url + '" target="_blank">' + (a.title || '无标题') + '</a><span class="date">' + d + '</span></div>';
    }).join('') + (batchArticles.length > 50 ? '<div class="art-item" style="justify-content:center;color:#999">... 共 ' + batchArticles.length + ' 篇</div>' : '');
    document.getElementById('bs-progress').classList.remove('show');
    document.getElementById('bs-done').classList.add('show');
  } catch (e) {
    showBatchError(e.message);
    document.getElementById('bs-progress').classList.remove('show');
    document.getElementById('bs-input').classList.add('show');
  }
  finally {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
    btn.disabled = false; btn.textContent = '🔍 解析并获取全部文章';
  }
}

async function downloadZip() {
  if (!batchArticles.length) return;
  const btn = document.getElementById('btn-zip');
  btn.disabled = true; btn.textContent = '⏳ 正在抓取全文并打包（每 100 篇约 1~2 分钟，请勿关闭页面）...';
  try {
    const resp = await fetch('/api/batch/zip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ articles: batchArticles, name: batchName }) });
    if (!resp.ok) { const d = await resp.json().catch(() => ({})); throw new Error(d.error || resp.status); }
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = batchName + '_文章导出.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) { alert('打包失败: ' + e.message); }
  btn.disabled = false; btn.textContent = '📦 打包下载全部文章 (ZIP)';
}

function batchReset() {
  batchArticles = [];
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  document.getElementById('batch-url').value = '';
  document.getElementById('bs-done').classList.remove('show');
  document.getElementById('bs-input').classList.add('show');
}
function showBatchError(msg) { const box = document.getElementById('batch-error'); box.textContent = '⚠ ' + msg; box.classList.add('show'); }
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
