import path from "node:path";
import fs from "node:fs/promises";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
// @ts-expect-error — no ambient types published for this plugin
import taskLists from "markdown-it-task-lists";
import { createHighlighter, type Highlighter } from "shiki";

const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".vscode"]);
const SHIKI_LANGS = [
  "typescript", "javascript", "tsx", "jsx", "json", "yaml", "toml",
  "bash", "sh", "zsh", "python", "rust", "go", "sql", "html", "css",
  "markdown", "diff", "ini",
];

export const ASSET_VERSION = Date.now().toString(36);

let siteName = "docs";
export function setSiteName(name: string): void {
  siteName = name;
}

const ICON_FOLDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_FILE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>`;
const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_SIDEBAR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>`;
const ICON_EXPAND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

let highlighter: Highlighter | null = null;
export async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: SHIKI_LANGS,
    });
  }
  return highlighter;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

export function createMd(hl: Highlighter): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight(code, lang) {
      const language = SHIKI_LANGS.includes(lang) ? lang : "text";
      try {
        return hl.codeToHtml(code, {
          lang: language,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        });
      } catch {
        return `<pre><code>${escapeHtml(code)}</code></pre>`;
      }
    },
  });
  md.use(anchor, {
    slugify: (s: string) =>
      s.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-"),
  });
  md.use(taskLists, { enabled: false, label: false, labelAfter: false });
  return md;
}

export interface TocItem {
  level: number;
  text: string;
  slug: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractToc(html: string): TocItem[] {
  const toc: TocItem[] = [];
  const re = /<h([23])[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const stripped = m[3]!.replace(/<[^>]+>/g, "").trim();
    toc.push({ level: parseInt(m[1]!, 10), text: decodeEntities(stripped), slug: m[2]! });
  }
  return toc;
}

// Regex-on-HTML is ordinarily a footgun, but markdown-it is configured with
// html: false below, so user-authored raw HTML never reaches us — the only
// producer of these attributes is markdown-it itself. If html: true is ever
// enabled, this needs to become a proper DOM walker (or an ast visitor inside
// markdown-it), because <source>, <video>, <iframe>, srcset, and attributes
// ordered before href/src would all need handling.
export function rewriteRelativeUrls(
  html: string,
  docRelPath: string,
): string {
  const docDir = path.dirname(docRelPath);
  const rewrite = (url: string): string => {
    if (/^(https?:|mailto:|#|\/)/i.test(url)) return url;
    const joined = path.posix.join("/", docDir, url);
    return joined.replace(/\\/g, "/");
  };
  return html
    .replace(/(<a[^>]+href=")([^"]+)(")/g, (_, a, url, c) => a + rewrite(url) + c)
    .replace(/(<img[^>]+src=")([^"]+)(")/g, (_, a, url, c) => a + rewrite(url) + c);
}

export interface TreeNode {
  name: string;
  relPath: string;
  isDir: boolean;
  children: TreeNode[];
}

export async function buildTree(
  root: string,
  rel = "",
  visited: Set<string> = new Set(),
): Promise<TreeNode[]> {
  const abs = path.join(root, rel);
  let realAbs: string;
  try { realAbs = await fs.realpath(abs); } catch { return []; }
  if (visited.has(realAbs)) return []; // symlink loop guard
  visited.add(realAbs);

  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const childRel = path.posix.join(rel, e.name);
    if (e.isDirectory()) {
      const children = await buildTree(root, childRel, visited);
      if (children.length > 0) {
        nodes.push({
          name: e.name,
          relPath: childRel,
          isDir: true,
          children,
        });
      }
    } else if (e.isFile() && e.name.endsWith(".md")) {
      nodes.push({
        name: e.name.replace(/\.md$/, ""),
        relPath: childRel,
        isDir: false,
        children: [],
      });
    }
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}

export function renderSidebar(tree: TreeNode[], activePath: string): string {
  const render = (nodes: TreeNode[]): string => {
    const items = nodes.map((n) => {
      if (n.isDir) {
        const isOpen = activePath.startsWith(n.relPath + "/");
        const expanded = isOpen ? " data-open" : "";
        return `<li class="dir" data-path="${escapeHtml(n.relPath)}"${expanded}>
          <button class="dir-toggle" type="button" aria-expanded="${isOpen ? "true" : "false"}">
            <span class="tree-caret" aria-hidden="true"></span>
            <span class="tree-icon" aria-hidden="true">${ICON_FOLDER}</span>
            <span class="tree-name">${escapeHtml(n.name)}</span>
          </button>
          <ul>${render(n.children)}</ul>
        </li>`;
      }
      const href = "/" + n.relPath;
      const active = activePath === n.relPath ? " active" : "";
      return `<li class="file${active}"><a href="${href}"${active ? ' aria-current="page"' : ""}>
        <span class="tree-caret" aria-hidden="true"></span>
        <span class="tree-icon" aria-hidden="true">${ICON_FILE}</span>
        <span class="tree-name">${escapeHtml(n.name)}</span>
      </a></li>`;
    });
    return items.join("");
  };
  return `<ul class="tree">${render(tree)}</ul>`;
}

export function renderToc(toc: TocItem[]): string {
  if (toc.length === 0) return "";
  const items = toc.map((t) =>
    `<li class="toc-${t.level}"><a href="#${t.slug}">${escapeHtml(t.text)}</a></li>`
  );
  return `<nav class="toc" aria-label="On this page"><div class="toc-label">On this page</div><ul>${items.join("")}</ul></nav>`;
}

export function renderBreadcrumbs(relPath: string): string {
  const root = `<a href="/">${escapeHtml(siteName)}</a>`;
  if (!relPath) return root;
  const parts = relPath.split("/");
  const crumbs = [root];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc = acc ? acc + "/" + parts[i] : parts[i]!;
    const isLast = i === parts.length - 1;
    const label = isLast ? parts[i]!.replace(/\.md$/, "") : parts[i]!;
    crumbs.push(
      isLast
        ? `<span>${escapeHtml(label)}</span>`
        : `<a href="/${acc}">${escapeHtml(label)}</a>`,
    );
  }
  return crumbs.join('<span class="crumb-sep">/</span>');
}

export interface PageOptions {
  title: string;
  contentHtml: string;
  sidebarHtml: string;
  tocHtml: string;
  breadcrumbsHtml: string;
  relPath: string;
}

export function renderPage(opts: PageOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — ${escapeHtml(siteName)}</title>
<link rel="icon" type="image/svg+xml" href="/_assets/favicon.svg?v=${ASSET_VERSION}">
<link rel="stylesheet" href="/_assets/style.css?v=${ASSET_VERSION}">
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<div class="app">
  <aside class="sidebar" id="sidebar" aria-label="Documents">
    <header class="sidebar-header">
      <a href="/" class="repo-name">${escapeHtml(siteName)}</a>
      <button class="search-trigger" type="button" id="search-trigger" aria-label="Search (Cmd-K)">
        <span>Search</span>
        <kbd>⌘K</kbd>
      </button>
    </header>
    ${opts.sidebarHtml}
  </aside>
  <div class="resizer" id="resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" tabindex="0"></div>
  <main class="content-wrap">
    <div class="doc-header">
      <button class="tool-btn sidebar-toggle" id="sidebar-toggle" type="button" aria-label="Toggle sidebar" title="Toggle sidebar (Ctrl-\\)">
        <span class="tool-icon">${ICON_SIDEBAR}</span>
      </button>
      <nav class="breadcrumbs" id="breadcrumbs">${opts.breadcrumbsHtml}</nav>
      <div class="doc-toolbar" id="doc-toolbar">
        <button class="tool-btn" id="btn-width-toggle" type="button" aria-label="Toggle content width" title="Toggle reading / wide view">
          <span class="tool-icon">${ICON_EXPAND}</span>
        </button>
        <button class="tool-btn" id="btn-copy-md" type="button" aria-label="Copy raw markdown" title="Copy raw markdown">
          <span class="tool-icon tool-icon-default">${ICON_COPY}</span>
          <span class="tool-icon tool-icon-success">${ICON_CHECK}</span>
        </button>
        <button class="tool-btn" id="btn-refresh" type="button" aria-label="Refresh" title="Refresh">
          <span class="tool-icon tool-icon-default">${ICON_REFRESH}</span>
        </button>
      </div>
    </div>
    <article class="content" id="content" tabindex="-1">${opts.contentHtml}</article>
  </main>
  <aside class="rail" id="rail">${opts.tocHtml}</aside>
</div>
<div class="tooltip" id="tooltip" hidden></div>
<div class="search-palette" id="search-palette" role="dialog" aria-modal="true" aria-label="Search docs" hidden>
  <div class="search-box">
    <input type="text" id="search-input" placeholder="Search docs…" autocomplete="off" spellcheck="false" aria-label="Search query" aria-controls="search-results" aria-autocomplete="list">
    <ul id="search-results" role="listbox" aria-label="Search results"></ul>
  </div>
</div>
<script src="/_assets/client.js?v=${ASSET_VERSION}" type="module"></script>
</body>
</html>`;
}
