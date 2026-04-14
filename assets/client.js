// Vendored fuse.js v7 import via esm.sh for zero-build client.
import Fuse from "https://esm.sh/fuse.js@7.0.0";

// ---------- shared DOM swap (used by both WebSocket hot-reload and client nav) ----------
async function swapTo(url, { cache = "default" } = {}) {
  const res = await fetch(url, { cache });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const swap = (sel) => {
    const fresh = doc.querySelector(sel);
    const live = document.querySelector(sel);
    if (fresh && live) live.innerHTML = fresh.innerHTML;
  };
  swap("#content");
  swap("#sidebar");
  swap("#rail");
  swap("#breadcrumbs");
  if (doc.title) document.title = doc.title;
  attachDocFeatures();
}

// ---------- live reload via hot-swap (file-change driven) ----------
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/_ws`);
  let retry = 0;
  ws.onmessage = async (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.type === "reload") {
      try {
        await swapTo(location.pathname + location.search, { cache: "no-store" });
      } catch (err) {
        console.error("[md-server] reload failed", err);
      }
    }
  };
  ws.onclose = () => {
    const delay = Math.min(8000, 1000 * Math.pow(2, retry++));
    setTimeout(connectWs, delay);
  };
  ws.onerror = () => ws.close();
}
connectWs();

// ---------- client-side navigation (no-flicker link clicks) ----------
function shouldInterceptLink(a, e) {
  if (!a) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (e.button !== undefined && e.button !== 0) return false;
  if (a.target && a.target !== "" && a.target !== "_self") return false;
  if (a.hasAttribute("download")) return false;
  const href = a.getAttribute("href");
  if (!href) return false;
  // same-origin check
  let url;
  try { url = new URL(href, location.href); } catch { return false; }
  if (url.origin !== location.origin) return false;
  // skip server-internal routes
  if (url.pathname.startsWith("/_")) return false;
  // skip same-page anchor jumps (let the browser handle #section scrolling)
  if (url.pathname === location.pathname && url.hash) return false;
  return true;
}

async function navigateTo(url, { push = true } = {}) {
  try {
    await swapTo(url.pathname + url.search);
    if (push) history.pushState({}, "", url.pathname + url.search + url.hash);
    if (url.hash) {
      const el = document.querySelector(url.hash);
      if (el) el.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, 0);
    }
  } catch (err) {
    console.error("[md-server] nav failed, falling back to full load:", err);
    location.href = url.toString();
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[href]");
  if (!shouldInterceptLink(a, e)) return;
  const url = new URL(a.getAttribute("href"), location.href);
  e.preventDefault();
  navigateTo(url);
});

window.addEventListener("popstate", () => {
  navigateTo(new URL(location.href), { push: false });
});

// ---------- code block copy buttons ----------
function attachCopyButtons() {
  document.querySelectorAll(".content pre").forEach((pre) => {
    if (pre.querySelector(".copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code");
      const text = code ? code.innerText : pre.innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      } catch {}
    });
    pre.appendChild(btn);
  });
}

// ---------- anchor link hash sync + scroll-spy ----------
function attachAnchorClicks() {
  document.querySelectorAll(".content .anchor").forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href) return;
      try { navigator.clipboard.writeText(location.origin + location.pathname + href); } catch {}
    });
  });
}

function scrollRailToActive() {
  const rail = document.getElementById("rail");
  if (!rail) return;
  const active = rail.querySelector(".toc a.active");
  if (!active) return;
  // only bother if rail actually overflows
  if (rail.scrollHeight <= rail.clientHeight + 2) return;
  const railRect = rail.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  const relTop = activeRect.top - railRect.top + rail.scrollTop;
  const target = relTop - railRect.height / 2 + activeRect.height / 2;
  const maxScroll = rail.scrollHeight - rail.clientHeight;
  rail.scrollTo({
    top: Math.max(0, Math.min(maxScroll, target)),
    behavior: "smooth",
  });
}

function updateRailFade() {
  const rail = document.getElementById("rail");
  if (!rail) return;
  const overflows = rail.scrollHeight > rail.clientHeight + 2;
  if (!overflows) {
    rail.classList.remove("has-more-above", "has-more-below");
    return;
  }
  const atTop = rail.scrollTop <= 1;
  const atBottom = rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 1;
  rail.classList.toggle("has-more-above", !atTop);
  rail.classList.toggle("has-more-below", !atBottom);
}

let spyObserver = null;
function attachScrollSpy() {
  if (spyObserver) spyObserver.disconnect();
  const headings = [...document.querySelectorAll(".content h2[id], .content h3[id]")];
  const tocLinks = new Map();
  document.querySelectorAll(".toc a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("#")) tocLinks.set(href.slice(1), a);
  });
  if (headings.length === 0 || tocLinks.size === 0) {
    updateRailFade();
    return;
  }
  let lastActive = null;
  spyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          tocLinks.forEach((a) => a.classList.remove("active"));
          const a = tocLinks.get(entry.target.id);
          if (a) {
            a.classList.add("active");
            if (a !== lastActive) {
              lastActive = a;
              scrollRailToActive();
            }
          }
        }
      });
    },
    { rootMargin: "-10% 0px -75% 0px", threshold: 0 },
  );
  headings.forEach((h) => spyObserver.observe(h));
  updateRailFade();
}

// one-time bindings for rail scroll state — the #rail element persists through
// hot-swap reloads (only its innerHTML is replaced), so a single listener is enough
(function attachRailScrollListener() {
  const rail = document.getElementById("rail");
  if (!rail) return;
  rail.addEventListener("scroll", updateRailFade, { passive: true });
  window.addEventListener("resize", updateRailFade);
})();

// ---------- sidebar collapsibles (persisted across navigation) ----------
const FOLDER_STATE_KEY = "md-sidebar-folders";

function loadFolderState() {
  try {
    return JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
function saveFolderState(state) {
  try {
    localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify(state));
  } catch {}
}
function folderPathFromLi(li) {
  return li.getAttribute("data-path");
}

function applyFolderState() {
  const state = loadFolderState();
  document.querySelectorAll(".tree li.dir").forEach((li) => {
    const p = folderPathFromLi(li);
    if (!p) return;
    const pref = state[p];
    if (pref === "open") li.setAttribute("data-open", "");
    else if (pref === "closed") li.removeAttribute("data-open");
    // no preference → trust server's data-open (auto-expand along active path)
  });
}

// event delegation on document — one listener, survives hot-swap reloads
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tree .dir-toggle");
  if (!btn) return;
  const li = btn.closest("li.dir");
  if (!li) return;
  e.preventDefault();
  const isOpen = li.hasAttribute("data-open");
  if (isOpen) li.removeAttribute("data-open");
  else li.setAttribute("data-open", "");
  const p = folderPathFromLi(li);
  if (p) {
    const state = loadFolderState();
    state[p] = isOpen ? "closed" : "open";
    saveFolderState(state);
  }
});

// ---------- keyboard nav ----------
let lastG = 0;
function sidebarFiles() {
  return [...document.querySelectorAll(".tree .file a")];
}
function currentFileIndex() {
  const files = sidebarFiles();
  return files.findIndex((a) => a.closest("li").classList.contains("active"));
}

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
    if (e.key === "Escape") closeSearch();
    return;
  }
  if (e.metaKey && e.key === "k") {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === "j") {
    const files = sidebarFiles();
    const i = currentFileIndex();
    const next = files[Math.min(files.length - 1, (i < 0 ? 0 : i + 1))];
    if (next) next.click();
    return;
  }
  if (e.key === "k") {
    const files = sidebarFiles();
    const i = currentFileIndex();
    const prev = files[Math.max(0, (i < 0 ? 0 : i - 1))];
    if (prev) prev.click();
    return;
  }
  if (e.key === "g") {
    const now = Date.now();
    if (now - lastG < 500) {
      window.scrollTo({ top: 0 });
      lastG = 0;
    } else {
      lastG = now;
    }
    return;
  }
  if (e.key === "G") {
    window.scrollTo({ top: document.body.scrollHeight });
    return;
  }
});

// ---------- search palette ----------
let fuse = null;
let results = [];
let selectedIdx = 0;
const palette = document.getElementById("search-palette");
const input = document.getElementById("search-input");
const resultsEl = document.getElementById("search-results");
const trigger = document.getElementById("search-trigger");
if (trigger) trigger.addEventListener("click", openSearch);

async function ensureFuse() {
  if (fuse) return fuse;
  const res = await fetch("/_search/index.json");
  const docs = await res.json();
  fuse = new Fuse(docs, {
    keys: [
      { name: "title", weight: 0.6 },
      { name: "path", weight: 0.3 },
      { name: "excerpt", weight: 0.1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });
  return fuse;
}

async function openSearch() {
  await ensureFuse();
  palette.hidden = false;
  input.value = "";
  resultsEl.innerHTML = "";
  input.focus();
}
function closeSearch() {
  palette.hidden = true;
}
palette?.addEventListener("click", (e) => {
  if (e.target === palette) closeSearch();
});
input?.addEventListener("input", () => {
  const q = input.value.trim();
  if (!q) { resultsEl.innerHTML = ""; return; }
  results = fuse.search(q).slice(0, 12);
  selectedIdx = 0;
  render();
});
input?.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIdx = Math.min(results.length - 1, selectedIdx + 1);
    render();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIdx = Math.max(0, selectedIdx - 1);
    render();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const r = results[selectedIdx];
    if (r) { closeSearch(); navigateTo(new URL("/" + r.item.path, location.href)); }
  } else if (e.key === "Escape") {
    closeSearch();
  }
});
function render() {
  resultsEl.innerHTML = results.map((r, i) => `
    <li class="${i === selectedIdx ? "selected" : ""}" data-path="${r.item.path}">
      <div class="r-title">${escapeHtml(r.item.title)}</div>
      <div class="r-path">${escapeHtml(r.item.path)}</div>
      <div class="r-excerpt">${escapeHtml(r.item.excerpt)}</div>
    </li>
  `).join("");
  resultsEl.querySelectorAll("li").forEach((el, i) => {
    el.addEventListener("mouseenter", () => { selectedIdx = i; render(); });
    el.addEventListener("click", () => { closeSearch(); navigateTo(new URL("/" + el.dataset.path, location.href)); });
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- doc toolbar (once; element is not hot-swapped) ----------
function attachToolbar() {
  const copyBtn = document.getElementById("btn-copy-md");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const rawPath = "/_raw" + location.pathname;
      try {
        const res = await fetch(rawPath, { cache: "no-store" });
        if (!res.ok) throw new Error("raw fetch failed: " + res.status);
        const text = await res.text();
        await navigator.clipboard.writeText(text);
        copyBtn.classList.add("success");
        setTimeout(() => copyBtn.classList.remove("success"), 1400);
      } catch (err) {
        console.error("[md-server] copy-md failed", err);
      }
    });
  }
  const refreshBtn = document.getElementById("btn-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      location.reload();
    });
  }
}

// ---------- resizable sidebar ----------
const SIDEBAR_STORAGE_KEY = "md-sidebar-w";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 520;

function applySidebarWidth(px) {
  document.documentElement.style.setProperty("--sidebar-w", px + "px");
}

function attachResizer() {
  const resizer = document.getElementById("resizer");
  if (!resizer) return;

  const saved = parseInt(localStorage.getItem(SIDEBAR_STORAGE_KEY) || "", 10);
  if (!Number.isNaN(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
    applySidebarWidth(saved);
  }

  resizer.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
      10,
    ) || 260;
    document.body.classList.add("resizing");
    resizer.classList.add("resizing");
    try { resizer.setPointerCapture(e.pointerId); } catch {}

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const newW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + dx));
      applySidebarWidth(newW);
    };
    const onUp = () => {
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", onUp);
      resizer.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("resizing");
      resizer.classList.remove("resizing");
      const finalW = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
        10,
      );
      if (!Number.isNaN(finalW)) localStorage.setItem(SIDEBAR_STORAGE_KEY, String(finalW));
    };
    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", onUp);
    resizer.addEventListener("pointercancel", onUp);
  });

  // keyboard-accessible: arrow keys nudge width by 20px
  resizer.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"), 10) || 260;
    const step = e.key === "ArrowRight" ? 20 : -20;
    const newW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w + step));
    applySidebarWidth(newW);
    localStorage.setItem(SIDEBAR_STORAGE_KEY, String(newW));
  });

  // double-click to reset to default
  resizer.addEventListener("dblclick", () => {
    document.documentElement.style.removeProperty("--sidebar-w");
    localStorage.removeItem(SIDEBAR_STORAGE_KEY);
  });
}

// ---------- hover tooltip for truncated sidebar filenames ----------
function attachTooltip() {
  const tip = document.getElementById("tooltip");
  if (!tip) return;

  let current = null;

  function show(el) {
    // only show if the name is actually truncated
    if (el.scrollWidth <= el.clientWidth + 1) return;
    tip.textContent = el.textContent;
    tip.hidden = false;

    // measure after content is set
    const itemRect = el.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    // prefer to the right of the sidebar item; flip left if not enough room
    const gap = 10;
    let left = itemRect.right + gap;
    if (left + tipRect.width > window.innerWidth - 8) {
      left = Math.max(8, itemRect.left - tipRect.width - gap);
    }
    let top = itemRect.top + (itemRect.height - tipRect.height) / 2;
    top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, top));

    tip.style.left = left + "px";
    tip.style.top = top + "px";
  }
  function hide() {
    tip.hidden = true;
    current = null;
  }

  // event delegation on document — survives hot-swap without rebinding
  document.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".tree .tree-name");
    if (!el || el === current) return;
    current = el;
    show(el);
  });
  document.addEventListener("mouseout", (e) => {
    const el = e.target.closest(".tree .tree-name");
    if (!el) return;
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".tree .tree-name")) {
      hide();
    }
  });
  // hide when scrolling the sidebar or window
  document.addEventListener("scroll", hide, true);
  window.addEventListener("blur", hide);
}

// ---------- init ----------
function attachDocFeatures() {
  attachCopyButtons();
  attachAnchorClicks();
  attachScrollSpy();
  applyFolderState();
  updateRailFade();
}
attachToolbar();
attachResizer();
attachTooltip();
attachDocFeatures();
