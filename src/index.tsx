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

// ─── API: Download article ──────────────────────────────────────────

app.get("/api/download", async (c) => {
  const url = c.req.query("url");
  const format = c.req.query("format") || "markdown";

  if (!url || !url.includes("mp.weixin.qq.com")) {
    return c.json({ error: "请提供有效的微信公众号文章链接" }, 400);
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    if (!resp.ok) {
      return c.json({ error: `无法访问文章（HTTP ${resp.status}）` }, resp.status);
    }

    const html = await resp.text();

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

// ─── Frontend ───────────────────────────────────────────────────────

app.get("/", (c) => {
  return c.html(FRONTEND_HTML);
});

app.get("/healthz", (c) => c.text("ok"));

// 404
app.notFound((c) => c.text("Not Found", 404));

export default app;

// ─── Frontend HTML ──────────────────────────────────────────────────

const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>公众号文章下载 - 免费在线工具</title>
<meta name="description" content="免费在线微信公众号文章下载工具，支持导出 Markdown、HTML、纯文本格式">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #f7f8fa; color: #333; min-height: 100vh;
  }
  .container { max-width: 680px; margin: 0 auto; padding: 24px 16px; }

  .header { text-align: center; padding: 48px 0 32px; }
  .header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  .header p { color: #888; font-size: 15px; }

  .card {
    background: #fff; border-radius: 16px; padding: 28px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px;
  }

  .input-group { display: flex; gap: 12px; margin-bottom: 16px; }
  .input-group input {
    flex: 1; padding: 14px 16px; font-size: 15px;
    border: 2px solid #e5e7eb; border-radius: 12px; outline: none;
    transition: border-color 0.2s;
  }
  .input-group input:focus { border-color: #07c160; }
  .input-group input::placeholder { color: #c0c4cc; }

  .btn {
    padding: 14px 28px; font-size: 15px; font-weight: 600;
    border: none; border-radius: 12px; cursor: pointer;
    transition: all 0.2s; white-space: nowrap;
  }
  .btn-primary { background: #07c160; color: #fff; }
  .btn-primary:hover { background: #06ad56; }
  .btn-primary:disabled { background: #c0c4cc; cursor: not-allowed; }

  .formats { display: flex; gap: 8px; flex-wrap: wrap; }
  .format-btn {
    padding: 8px 16px; font-size: 13px; border: 1px solid #dcdfe6;
    border-radius: 8px; cursor: pointer; background: #fff; transition: all 0.2s;
  }
  .format-btn.active { background: #07c160; color: #fff; border-color: #07c160; }
  .format-btn:hover:not(.active) { border-color: #07c160; color: #07c160; }

  .result { margin-top: 24px; display: none; }
  .result.show { display: block; }

  .result-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 0; border-bottom: 1px solid #f0f0f0; margin-bottom: 16px;
  }
  .result-title { font-size: 18px; font-weight: 600; }
  .result-meta { color: #999; font-size: 13px; margin-top: 4px; }

  .preview {
    background: #fafafa; border-radius: 12px; padding: 20px;
    max-height: 400px; overflow-y: auto; font-size: 14px; line-height: 1.8;
    white-space: pre-wrap; word-break: break-word; color: #444;
    border: 1px solid #f0f0f0;
  }

  .download-row { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
  .dl-btn {
    flex: 1; min-width: 120px; padding: 12px; font-size: 14px; font-weight: 600;
    border: 2px solid #07c160; border-radius: 10px; cursor: pointer;
    background: #fff; color: #07c160; transition: all 0.2s; text-align: center;
    text-decoration: none; display: inline-block;
  }
  .dl-btn:hover { background: #07c160; color: #fff; }

  .error {
    background: #fef0f0; color: #f56c6c; padding: 12px 16px;
    border-radius: 8px; margin-top: 16px; font-size: 14px; display: none;
  }
  .error.show { display: block; }

  .loading {
    text-align: center; padding: 32px; color: #999; display: none;
  }
  .loading.show { display: block; }
  .spinner {
    display: inline-block; width: 24px; height: 24px;
    border: 3px solid #e5e7eb; border-top-color: #07c160;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .features {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 12px; margin-top: 32px;
  }
  @media (max-width: 480px) {
    .features { grid-template-columns: 1fr; }
    .input-group { flex-direction: column; }
  }
  .feature {
    text-align: center; padding: 20px 12px;
    background: #fff; border-radius: 12px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .feature-icon { font-size: 28px; margin-bottom: 8px; }
  .feature h3 { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .feature p { font-size: 12px; color: #999; }

  .footer {
    text-align: center; padding: 40px 0 24px;
    color: #c0c4cc; font-size: 12px;
  }
  .footer a { color: #999; text-decoration: none; }

  .tips { margin-top: 16px; padding: 16px; background: #f0f9eb; border-radius: 8px; font-size: 13px; color: #67c23a; line-height: 1.8; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>📄 公众号文章下载</h1>
    <p>粘贴微信公众号文章链接，一键导出为 Markdown、HTML 或纯文本</p>
  </div>

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
    <div class="loading" id="loading-box">
      <div class="spinner"></div>
      <p style="margin-top: 12px;">正在获取文章内容...</p>
    </div>

    <div class="result" id="result-box">
      <div class="result-header">
        <div>
          <div class="result-title" id="result-title"></div>
          <div class="result-meta" id="result-meta"></div>
        </div>
      </div>
      <div class="preview" id="preview"></div>
      <div class="download-row">
        <a class="dl-btn" id="dl-markdown" href="#" download>📥 Markdown</a>
        <a class="dl-btn" id="dl-html" href="#" target="_blank">🌐 HTML</a>
        <a class="dl-btn" id="dl-text" href="#">📝 纯文本</a>
      </div>
    </div>
  </div>

  <div class="features">
    <div class="feature">
      <div class="feature-icon">⚡</div>
      <h3>一键导出</h3>
      <p>粘贴链接即可获取</p>
    </div>
    <div class="feature">
      <div class="feature-icon">📝</div>
      <h3>Markdown 格式</h3>
      <p>保留图片和排版</p>
    </div>
    <div class="feature">
      <div class="feature-icon">🔒</div>
      <h3>无需登录</h3>
      <p>免费使用，不存数据</p>
    </div>
  </div>

  <div class="tips">
    💡 <strong>使用提示</strong><br>
    1. 打开微信文章，点击右上角「...」→「复制链接」<br>
    2. 粘贴到上方输入框，点击「下载」<br>
    3. 选择需要的格式，点击下载按钮保存到本地
  </div>

  <div class="footer">
    <a href="https://yinuo-ai.com" target="_blank">一诺 AI</a> · 免费· 不存储任何数据
  </div>
</div>

<script>
let currentUrl = '';
let currentFormat = 'markdown';
let currentData = null;

// Format selector
document.querySelectorAll('.format-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFormat = btn.dataset.format;
  });
});

// Enter key
document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') fetchArticle();
});

async function fetchArticle() {
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  const btn = document.getElementById('btn-fetch');
  const errBox = document.getElementById('error-box');
  const loadingBox = document.getElementById('loading-box');
  const resultBox = document.getElementById('result-box');

  // Reset
  errBox.classList.remove('show');
  resultBox.classList.remove('show');

  if (!url || !url.includes('mp.weixin.qq.com')) {
    showError('请输入有效的微信公众号文章链接（以 mp.weixin.qq.com 开头）');
    return;
  }

  currentUrl = url;
  btn.disabled = true;
  btn.textContent = '获取中...';
  loadingBox.classList.add('show');

  try {
    const resp = await fetch('/api/preview?url=' + encodeURIComponent(url));
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || '获取失败');
    }

    currentData = data;
    showResult(data);
  } catch (e) {
    showError(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '下载';
    loadingBox.classList.remove('show');
  }
}

function showResult(data) {
  document.getElementById('result-title').textContent = data.title || '未命名文章';
  document.getElementById('result-meta').textContent =
    (data.author ? '公众号：' + data.author : '') +
    (data.date ? ' | ' + data.date : '') +
    ' | ' + (data.length || 0) + ' 字符';

  document.getElementById('preview').textContent = data.markdown || '';

  // Download links
  const encoded = encodeURIComponent(currentUrl);
  document.getElementById('dl-markdown').href = '/api/download?url=' + encoded + '&format=markdown';
  document.getElementById('dl-html').href = '/api/download?url=' + encoded + '&format=html';
  document.getElementById('dl-text').href = '/api/download?url=' + encoded + '&format=text';

  document.getElementById('result-box').classList.add('show');
  document.getElementById('result-box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showError(msg) {
  const box = document.getElementById('error-box');
  box.textContent = '⚠ ' + msg;
  box.classList.add('show');
}
</script>
</body>
</html>`;
