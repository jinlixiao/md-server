import path from "node:path";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import type { ServerWebSocket } from "bun";
import {
  getHighlighter,
  createMd,
  extractToc,
  rewriteRelativeUrls,
  buildTree,
  renderSidebar,
  renderToc,
  renderBreadcrumbs,
  renderPage,
  setSiteName,
} from "./template.ts";

const CLI_ARG = process.argv[2];
const DOC_ROOT = path.resolve(
  CLI_ARG || process.env.DOC_ROOT || process.cwd(),
);
try {
  await fs.access(DOC_ROOT);
} catch {
  console.error(`[md-server] root does not exist: ${DOC_ROOT}`);
  process.exit(1);
}
const REAL_ROOT = await fs.realpath(DOC_ROOT);
const REAL_HOME = process.env.HOME
  ? await fs.realpath(process.env.HOME).catch(() => null)
  : null;
const SITE_NAME = process.env.SITE_NAME || path.basename(DOC_ROOT) || "docs";
const PORT = parseInt(process.env.PORT || "4321", 10);
const HOSTNAME = process.env.HOSTNAME_BIND || "127.0.0.1";
const ASSET_DIR = path.resolve(import.meta.dir, "assets");
const MAX_MD_BYTES = 5 * 1024 * 1024;

setSiteName(SITE_NAME);

const hl = await getHighlighter();
const md = createMd(hl);

type CacheEntry = { mtimeMs: number; contentHtml: string; tocHtml: string; title: string };
const pageCache = new Map<string, CacheEntry>();
const sockets = new Set<ServerWebSocket<unknown>>();

let searchIndexCache: { mtimeMs: number; json: string } | null = null;

async function resolveSafe(reqPath: string): Promise<string | null> {
  const decoded = decodeURIComponent(reqPath);
  const cleaned = decoded.replace(/^\/+/, "");
  const literal = path.resolve(DOC_ROOT, cleaned);
  // URL-level containment: the literal path (pre-symlink) must stay inside DOC_ROOT
  // so a URL like /../.zshrc can never escape by string manipulation alone.
  if (literal !== DOC_ROOT && !literal.startsWith(DOC_ROOT + path.sep)) {
    return null;
  }
  try {
    const real = await fs.realpath(literal);
    // after symlink resolution, allow the real path to be inside DOC_ROOT, OR
    // inside $HOME — so users can symlink external notes into their doc tree
    // without the reader blocking them. Binding to 127.0.0.1 keeps this local.
    const underDocRoot = real === REAL_ROOT || real.startsWith(REAL_ROOT + path.sep);
    const underHome = REAL_HOME
      ? (real === REAL_HOME || real.startsWith(REAL_HOME + path.sep))
      : false;
    if (!underDocRoot && !underHome) return null;
    return real;
  } catch {
    return null;
  }
}

async function renderMarkdownFile(absPath: string, relPath: string): Promise<{ page: string; contentHtml: string } | null> {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_MD_BYTES) {
    const warning = `<p class="warning">File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB &gt; 5MB cap)</p>`;
    return await wrapPage(relPath, warning);
  }

  let entry = pageCache.get(relPath);
  if (!entry || entry.mtimeMs !== stat.mtimeMs) {
    const raw = await fs.readFile(absPath, "utf8");
    if (/\0/.test(raw.slice(0, 1024))) {
      return await wrapPage(relPath, `<p class="warning">Binary file — not rendered.</p>`);
    }
    let html = md.render(raw);
    html = rewriteRelativeUrls(html, relPath);
    const toc = extractToc(html);
    const title = extractTitle(raw) || relPath.replace(/\.md$/, "") || "handbook";
    entry = {
      mtimeMs: stat.mtimeMs,
      contentHtml: html,
      tocHtml: renderToc(toc),
      title,
    };
    pageCache.set(relPath, entry);
  }

  const tree = await buildTree(DOC_ROOT);
  const page = renderPage({
    title: entry.title,
    contentHtml: entry.contentHtml,
    sidebarHtml: renderSidebar(tree, relPath),
    tocHtml: entry.tocHtml,
    breadcrumbsHtml: renderBreadcrumbs(relPath),
    relPath,
  });
  return { page, contentHtml: entry.contentHtml };
}

async function wrapPage(relPath: string, contentHtml: string): Promise<{ page: string; contentHtml: string }> {
  const tree = await buildTree(DOC_ROOT);
  return {
    contentHtml,
    page: renderPage({
      title: relPath || "handbook",
      contentHtml,
      sidebarHtml: renderSidebar(tree, relPath),
      tocHtml: "",
      breadcrumbsHtml: renderBreadcrumbs(relPath),
      relPath,
    }),
  };
}

function extractTitle(raw: string): string | null {
  const m = raw.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : null;
}

async function renderDirIndex(absDir: string, relDir: string): Promise<{ page: string; contentHtml: string }> {
  const readme = path.join(absDir, "README.md");
  try {
    const stat = await fs.stat(readme);
    if (stat.isFile()) {
      const rendered = await renderMarkdownFile(readme, path.posix.join(relDir, "README.md"));
      if (rendered) return rendered;
    }
  } catch {}
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith(".") && (e.isDirectory() || e.name.endsWith(".md")))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
    .map((e) => {
      const href = "/" + path.posix.join(relDir, e.name);
      const label = e.isDirectory() ? e.name + "/" : e.name.replace(/\.md$/, "");
      return `<li><a href="${href}">${label}</a></li>`;
    })
    .join("");
  const html = `<h1>${relDir || "handbook"}</h1><ul>${items}</ul>`;
  const tree = await buildTree(DOC_ROOT);
  return {
    contentHtml: html,
    page: renderPage({
      title: relDir || "handbook",
      contentHtml: html,
      sidebarHtml: renderSidebar(tree, relDir),
      tocHtml: "",
      breadcrumbsHtml: renderBreadcrumbs(relDir),
      relPath: relDir,
    }),
  };
}

async function buildSearchIndex(): Promise<string> {
  const latestMtime = await walkLatestMtime(DOC_ROOT);
  if (searchIndexCache && searchIndexCache.mtimeMs === latestMtime) {
    return searchIndexCache.json;
  }
  const docs: { title: string; path: string; excerpt: string }[] = [];
  async function walk(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (["node_modules", ".git", ".obsidian"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) await walk(abs, r);
      else if (e.isFile() && e.name.endsWith(".md")) {
        try {
          const raw = await fs.readFile(abs, "utf8");
          const title = extractTitle(raw) || e.name.replace(/\.md$/, "");
          const excerpt = raw.replace(/^#.*$/m, "").replace(/[`*_>#\-\[\]\(\)]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
          docs.push({ title, path: r, excerpt });
        } catch {}
      }
    }
  }
  await walk(DOC_ROOT, "");
  const json = JSON.stringify(docs);
  searchIndexCache = { mtimeMs: latestMtime, json };
  return json;
}

async function walkLatestMtime(root: string): Promise<number> {
  let latest = 0;
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (["node_modules", ".git"].includes(e.name)) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walk(abs);
      else if (e.isFile() && e.name.endsWith(".md")) {
        const s = await fs.stat(abs);
        if (s.mtimeMs > latest) latest = s.mtimeMs;
      }
    }
  }
  await walk(root);
  return latest;
}

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".ico": "image/x-icon",
  })[ext] || "application/octet-stream";
}

let debounceTimer: Timer | null = null;
let pendingPaths = new Set<string>();
function onFileChange(filename: string | null) {
  if (!filename) return;
  pendingPaths.add(filename);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    for (const f of pendingPaths) {
      const rel = path.relative(DOC_ROOT, path.resolve(DOC_ROOT, f));
      pageCache.delete(rel);
    }
    pendingPaths.clear();
    searchIndexCache = null;
    for (const ws of sockets) {
      try { ws.send(JSON.stringify({ type: "reload" })); } catch {}
    }
  }, 50);
}

try {
  watch(DOC_ROOT, { recursive: true }, (_event, filename) => onFileChange(filename));
  console.log(`[md-server] watching ${DOC_ROOT}`);
} catch (e) {
  console.error(`[md-server] watcher failed: ${e}`);
}

async function renderErrorPage(code: number, message: string): Promise<Response> {
  const tree = await buildTree(DOC_ROOT);
  const contentHtml = `<div class="error-state">
    <div class="error-code">${code}</div>
    <p class="error-message">${message}</p>
    <p class="error-back"><a href="/">&larr; Back to home</a></p>
  </div>`;
  const page = renderPage({
    title: `${code} — ${message}`,
    contentHtml,
    sidebarHtml: renderSidebar(tree, ""),
    tocHtml: "",
    breadcrumbsHtml: `<span>${code}</span>`,
    relPath: "",
  });
  return new Response(page, {
    status: code,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOSTNAME,
  async fetch(req, srv) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    if (pathname === "/_ws") {
      if (srv.upgrade(req)) return undefined as unknown as Response;
      return new Response("ws upgrade failed", { status: 400 });
    }

    if (pathname.startsWith("/_assets/")) {
      const assetRel = pathname.slice("/_assets/".length);
      const assetPath = path.resolve(ASSET_DIR, assetRel);
      if (!assetPath.startsWith(ASSET_DIR + path.sep)) return await renderErrorPage(403, "Forbidden");
      try {
        const data = await fs.readFile(assetPath);
        return new Response(data, {
          headers: {
            "content-type": mimeFor(assetPath),
            "cache-control": "no-cache",
          },
        });
      } catch {
        return await renderErrorPage(404, "Not found");
      }
    }

    if (pathname.startsWith("/_raw/")) {
      const rawRel = pathname.slice("/_raw".length);
      const abs = await resolveSafe(rawRel);
      if (!abs || !abs.endsWith(".md")) return await renderErrorPage(404, "Not found");
      try {
        const data = await fs.readFile(abs);
        return new Response(data, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      } catch {
        return await renderErrorPage(404, "Not found");
      }
    }

    if (pathname === "/_search/index.json") {
      const json = await buildSearchIndex();
      return new Response(json, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      });
    }

    if (pathname === "/") pathname = "/";

    const abs = await resolveSafe(pathname);
    if (!abs) return await renderErrorPage(404, "Not found");

    let stat;
    try { stat = await fs.stat(abs); } catch {
      return await renderErrorPage(404, "Not found");
    }

    const rel = path.relative(DOC_ROOT, abs).split(path.sep).join("/");

    if (stat.isDirectory()) {
      const { page } = await renderDirIndex(abs, rel);
      return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (abs.endsWith(".md")) {
      const rendered = await renderMarkdownFile(abs, rel);
      if (!rendered) return await renderErrorPage(404, "Not found");
      return new Response(rendered.page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    const data = await fs.readFile(abs);
    return new Response(data, {
      headers: {
        "content-type": mimeFor(abs),
        "cache-control": "public, max-age=3600",
      },
    });
  },
  websocket: {
    open(ws) { sockets.add(ws); },
    close(ws) { sockets.delete(ws); },
    message() {},
  },
});

console.log(`[md-server] ${SITE_NAME} → http://${HOSTNAME}:${server.port}`);
console.log(`[md-server] serving: ${DOC_ROOT}`);
