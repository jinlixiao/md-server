// Vendored fuse.js v7 import via esm.sh for zero-build client.
import Fuse from "https://esm.sh/fuse.js@7.0.0";

// ---------- shared DOM swap (used by both WebSocket hot-reload and client nav) ----------
let swapToken = 0;
let currentAbort = null;
async function swapTo(url, { cache = "default" } = {}) {
  // only the latest-issued swap wins — earlier in-flight fetches are aborted
  // and their results (even if they arrive) are discarded. Prevents a
  // WebSocket reload + link click from racing and painting mixed state.
  const myToken = ++swapToken;
  if (currentAbort) currentAbort.abort();
  currentAbort = new AbortController();
  const res = await fetch(url, { cache, signal: currentAbort.signal });
  if (myToken !== swapToken) throw new Error("superseded");
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const html = await res.text();
  if (myToken !== swapToken) throw new Error("superseded");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const swap = (sel) => {
    const fresh = doc.querySelector(sel);
    const live = document.querySelector(sel);
    if (fresh && live) live.innerHTML = fresh.innerHTML;
  };
  // preserve sidebar scroll position across hot-swap / client nav
  const sidebar = document.getElementById("sidebar");
  const savedScroll = sidebar ? sidebar.scrollTop : 0;
  swap("#content");
  swap("#sidebar");
  swap("#rail");
  swap("#breadcrumbs");
  if (sidebar) sidebar.scrollTop = savedScroll;
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

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
function prefersReducedMotion() { return !!(reducedMotion && reducedMotion.matches); }

async function navigateTo(url, { push = true } = {}) {
  const fromPopstate = !push;
  try {
    await swapTo(url.pathname + url.search);
    if (push) history.pushState({}, "", url.pathname + url.search + url.hash);
    const smooth = !prefersReducedMotion();
    if (url.hash) {
      const el = document.querySelector(url.hash);
      if (el) el.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
      else window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    } else {
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    }
  } catch (err) {
    const superseded = err && (err.message === "superseded" || err.name === "AbortError");
    if (superseded && fromPopstate) {
      // popstate already mutated location.pathname. If our swap was cancelled,
      // the DOM no longer matches the URL — force a full reload to re-sync
      // rather than leaving the user on a mismatched page.
      location.reload();
      return;
    }
    if (superseded) return;
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
function getCopyStatus() {
  let live = document.getElementById("copy-status");
  if (!live) {
    live = document.createElement("div");
    live.id = "copy-status";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.className = "sr-only";
    document.body.appendChild(live);
  }
  return live;
}
let copyAnnounceTimer = null;
function announceCopied(label) {
  const text = label || "Copied to clipboard";
  const live = getCopyStatus();
  // rapid repeat clicks shouldn't stutter ("Code copied, Code copied, ...") —
  // coalesce and only re-announce if the content actually differs
  if (copyAnnounceTimer) clearTimeout(copyAnnounceTimer);
  live.textContent = "";
  copyAnnounceTimer = setTimeout(() => {
    live.textContent = text;
    copyAnnounceTimer = null;
  }, 10);
}
function attachCopyButtons() {
  document.querySelectorAll(".content pre").forEach((pre) => {
    if (pre.querySelector(".copy-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code");
      const text = code ? code.innerText : pre.innerText;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = "Copied";
        btn.classList.add("copied");
        announceCopied("Code copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("copied");
        }, 1400);
      } catch {}
    });
    pre.appendChild(btn);
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
    behavior: prefersReducedMotion() ? "auto" : "smooth",
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
  let lastActive = null; // reset on every rebind so scroll-to-active fires on first intersection after a swap
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
    const raw = localStorage.getItem(FOLDER_STATE_KEY);
    return JSON.parse(raw || "{}") || {};
  } catch {
    // localStorage may throw on access in private/sandboxed modes — fall back to empty
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
  const liveKeys = new Set();
  document.querySelectorAll(".tree li.dir").forEach((li) => {
    const p = folderPathFromLi(li);
    if (!p) return;
    liveKeys.add(p);
    const pref = state[p];
    if (pref === "open") li.setAttribute("data-open", "");
    else if (pref === "closed") li.removeAttribute("data-open");
    // reflect aria-expanded on the toggle for screen readers
    const btn = li.querySelector(":scope > .dir-toggle");
    if (btn) btn.setAttribute("aria-expanded", li.hasAttribute("data-open") ? "true" : "false");
  });
  // prune entries for folders that no longer exist in the current tree
  let changed = false;
  for (const k of Object.keys(state)) {
    if (!liveKeys.has(k)) { delete state[k]; changed = true; }
  }
  if (changed) saveFolderState(state);
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
  btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
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
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) {
    if (e.key === "Escape") closeSearch();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    openSearch();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
    e.preventDefault();
    document.getElementById("sidebar-toggle")?.click();
    return;
  }
  if (e.key === "/") {
    e.preventDefault();
    openSearch();
    return;
  }
  if (e.key === "j" || e.key === "k") {
    const files = sidebarFiles();
    const i = currentFileIndex();
    // no-op on pages without an active sidebar file (404, empty dir, etc.) —
    // otherwise pressing k silently jumps to the first doc, which feels like
    // accidental data loss when you're oriented on a 404 page.
    if (i < 0) return;
    const target = e.key === "j"
      ? files[Math.min(files.length - 1, i + 1)]
      : files[Math.max(0, i - 1)];
    if (target) target.click();
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

let fuseLoading = null;
async function ensureFuse() {
  if (fuse) return fuse;
  if (fuseLoading) return fuseLoading;
  fuseLoading = (async () => {
    try {
      const res = await fetch("/_search/index.json");
      if (!res.ok) throw new Error("search index " + res.status);
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
    } catch (err) {
      console.error("[md-server] search index load failed:", err);
      fuseLoading = null; // allow retry on next open
      throw err;
    }
  })();
  return fuseLoading;
}

let searchReturnFocus = null;
async function openSearch() {
  // show the palette immediately — load fuse in the background. On slow CDN /
  // offline, the palette still opens and search reports a friendly state.
  searchReturnFocus = document.activeElement;
  palette.hidden = false;
  input.value = "";
  resultsEl.innerHTML = '<li class="r-loading" role="status" aria-live="polite">Loading search…</li>';
  input.focus();
  try {
    await ensureFuse();
    resultsEl.innerHTML = "";
  } catch {
    resultsEl.innerHTML = '<li class="r-loading r-error" role="status" aria-live="polite">Search unavailable (offline?)</li>';
  }
}
function closeSearch() {
  if (palette.hidden) return;
  palette.hidden = true;
  // restore focus to whatever opened the palette (trigger button, sidebar link, etc.)
  if (searchReturnFocus && typeof searchReturnFocus.focus === "function") {
    try { searchReturnFocus.focus(); } catch {}
  }
  searchReturnFocus = null;
}

// simple focus trap while the palette is open — keeps Tab / Shift+Tab inside.
// Also recovers if focus ever escapes (devtools pulled it away, etc.).
palette?.addEventListener("keydown", (e) => {
  if (palette.hidden) return;
  if (e.key !== "Tab") return;
  const focusables = palette.querySelectorAll('input, button, [href], [tabindex]:not([tabindex="-1"])');
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  // if focus has escaped the palette, pull it back to the input
  if (!palette.contains(active)) {
    e.preventDefault();
    input.focus();
    return;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});
palette?.addEventListener("click", (e) => {
  if (e.target === palette) closeSearch();
});
input?.addEventListener("input", () => {
  const q = input.value.trim();
  if (!q) { resultsEl.innerHTML = ""; return; }
  if (!fuse) { resultsEl.innerHTML = '<li class="r-loading r-error">Search unavailable</li>'; return; }
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
    <li class="${i === selectedIdx ? "selected" : ""}" role="option" id="r-option-${i}" aria-selected="${i === selectedIdx ? "true" : "false"}" data-path="${r.item.path}">
      <div class="r-title">${escapeHtml(r.item.title)}</div>
      <div class="r-path">${escapeHtml(r.item.path)}</div>
      <div class="r-excerpt">${escapeHtml(r.item.excerpt)}</div>
    </li>
  `).join("");
  // keep input's aria-activedescendant pointing at the selected option so
  // screen readers announce which result is focused as user arrows
  if (input) {
    if (results.length > 0) input.setAttribute("aria-activedescendant", "r-option-" + selectedIdx);
    else input.removeAttribute("aria-activedescendant");
  }
  resultsEl.querySelectorAll("li").forEach((el, i) => {
    el.addEventListener("mouseenter", () => { selectedIdx = i; render(); });
    el.addEventListener("click", () => { closeSearch(); navigateTo(new URL("/" + el.dataset.path, location.href)); });
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- sidebar toggle (overlay show/hide) ----------
const SIDEBAR_COLLAPSED_KEY = "md-sidebar-collapsed";
function attachSidebarToggle() {
  const toggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  if (!toggle || !sidebar) return;

  // restore persisted state
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
      sidebar.classList.add("collapsed");
      document.body.classList.add("sidebar-hidden");
    }
  } catch {}

  toggle.addEventListener("click", () => {
    const willCollapse = !sidebar.classList.contains("collapsed");
    sidebar.classList.toggle("collapsed", willCollapse);
    document.body.classList.toggle("sidebar-hidden", willCollapse);
    toggle.setAttribute("aria-label", willCollapse ? "Show sidebar" : "Hide sidebar");
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, willCollapse ? "1" : "0"); } catch {}
  });
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
        announceCopied("Markdown copied");
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
    const activePointerId = e.pointerId;
    const startX = e.clientX;
    const startW = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
      10,
    ) || 260;
    document.body.classList.add("resizing");
    resizer.classList.add("resizing");
    try { resizer.setPointerCapture(activePointerId); } catch {}

    const onMove = (ev) => {
      if (ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - startX;
      const newW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + dx));
      applySidebarWidth(newW);
      // resizer is position:fixed — sync its left to the sidebar width
      resizer.style.left = newW + "px";
    };
    const onUp = (ev) => {
      if (ev && ev.pointerId !== undefined && ev.pointerId !== activePointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      document.body.classList.remove("resizing");
      resizer.classList.remove("resizing");
      try { resizer.releasePointerCapture(activePointerId); } catch {}
      const finalW = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w"),
        10,
      );
      if (!Number.isNaN(finalW)) {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(finalW)); } catch {}
      }
    };
    // bind on window so a fast drag that leaves the resizer still ends cleanly,
    // even if setPointerCapture failed (which would otherwise lock the UI)
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
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
  attachScrollSpy();
  applyFolderState();
  updateRailFade();
}
attachSidebarToggle();
attachToolbar();
attachResizer();
attachTooltip();
attachDocFeatures();
