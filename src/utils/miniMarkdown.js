// 受限 Markdown → 白名单 HTML（零依赖）。
//
// 题面 description 是「受限 Markdown 源文本」（api-12），需要白名单渲染：
// 支持 标题 / 段落 / 强调 / 行内代码 / 围栏代码 / 列表 / 引用 / 表格 / 分隔线 / 链接 / 图片；
// 不解析任何原始 HTML —— 输入里的标签一律转义成文本，输出标签全部由本文件拼出，
// 因此结果可以直接交给 v-html，不存在注入面。
//
// 标题统一降一级（# → h2），保证页面只有一个 H1（题目名）。

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// 转义 HTML 特殊字符，防止注入。
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// 只放行 http(s)、mailto、站内绝对路径（/foo）与页内锚点；其余（javascript:、data:、//host）一律丢弃。
function safeUrl(raw) {
  const url = String(raw ?? "").trim();
  if (!url) return "";
  if (/^(https?:\/\/|mailto:)/i.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("#")) return url;
  return "";
}

// 行内元素正则：代码、图片、链接、加粗、斜体。
const INLINE_RE =
  /`([^`\n]+)`|!\[([^\]\n]*)\]\(([^)\s]*)\)|\[([^\]\n]*)\]\(([^)\s]*)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<![\w*])\*([^*\n]+)\*(?![\w*])|(?<![\w_])_([^_\n]+)_(?![\w_])/g;

// 渲染行内元素（代码、图片、链接、加粗、斜体）。
function renderInline(raw) {
  const text = String(raw ?? "");
  let html = "";
  let cursor = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    html += escapeHtml(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const [
      ,
      code,
      imageAlt,
      imageUrl,
      linkText,
      linkUrl,
      strongA,
      strongB,
      emA,
      emB,
    ] = match;

    if (code !== undefined) {
      html += `<code>${escapeHtml(code)}</code>`;
      continue;
    }
    if (imageAlt !== undefined) {
      const url = safeUrl(imageUrl);
      html += url
        ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(imageAlt)}" loading="lazy" />`
        : escapeHtml(match[0]);
      continue;
    }
    if (linkText !== undefined) {
      const url = safeUrl(linkUrl);
      html += url
        ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${renderInline(linkText)}</a>`
        : escapeHtml(match[0]);
      continue;
    }
    if (strongA !== undefined || strongB !== undefined) {
      html += `<strong>${renderInline(strongA ?? strongB)}</strong>`;
      continue;
    }
    html += `<em>${renderInline(emA ?? emB)}</em>`;
  }

  return html + escapeHtml(text.slice(cursor));
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^\s{0,3}[-*+]\s+(.*)$/;
const OL_RE = /^\s{0,3}\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isBlockStart(line, next = "") {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    (line.includes("|") && TABLE_SEP_RE.test(next))
  );
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderTable(header, rows) {
  const head = `<tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr>`;
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function renderMarkdown(source) {
  if (typeof source !== "string") return "";
  const text = source.replace(/\r\n?/g, "\n");
  if (!text.trim()) return "";

  const lines = text.split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0];
      const language = fence[2];
      const closing = new RegExp(`^\\s{0,3}${marker}{3,}\\s*$`);
      const body = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      const className = language
        ? ` class="language-${escapeHtml(language)}"`
        : "";
      html.push(
        `<pre><code${className}>${escapeHtml(body.join("\n"))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = Math.min(heading[1].length + 1, 6);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      html.push("<hr />");
      index += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const body = [];
      while (index < lines.length && QUOTE_RE.test(lines[index])) {
        body.push(lines[index].match(QUOTE_RE)[1]);
        index += 1;
      }
      html.push(`<blockquote>${renderMarkdown(body.join("\n"))}</blockquote>`);
      continue;
    }

    if (line.includes("|") && TABLE_SEP_RE.test(lines[index + 1] ?? "")) {
      const header = splitRow(line);
      index += 2;
      const rows = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        lines[index].includes("|")
      ) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      html.push(renderTable(header, rows));
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = OL_RE.test(line);
      const pattern = ordered ? OL_RE : UL_RE;
      const items = [];
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].match(pattern)[1]);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`,
      );
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index], lines[index + 1] ?? "")
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(
      `<p>${renderInline(paragraph.join("\n")).replace(/\n/g, "<br />")}</p>`,
    );
  }

  return html.join("\n");
}

export default renderMarkdown;
