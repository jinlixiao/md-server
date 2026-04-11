// Vendored fuse.js v7 import via esm.sh for zero-build client.
import Fuse from "https://esm.sh/fuse.js@7.0.0";

// ---------- live reload via hot-swap ----------
function connectWs() {
  const ws = new WebSocket(`ws://${location.host}/_ws`);
  let retry = 0;
  ws.onmessage = async (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }
    if (data.type === "reload") {
      try {
        const res = await fetch(location.pathname, { cache: "no-store" });
        if (!res.ok) return;
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
        attachDocFeatures();
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

let spyObserver = null;
function attachScrollSpy() {
  if (spyObserver) spyObserver.disconnect();
  const headings = [...document.querySelectorAll(".content h2[id], .content h3[id]")];
  const tocLinks = new Map();
  document.querySelectorAll(".toc a").forEach((a) => {
    const href = a.getAttribute("href");
    if (href && href.startsWith("#")) tocLinks.set(href.slice(1), a);
  });
  if (headings.length === 0 || tocLinks.size === 0) return;
  spyObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          tocLinks.forEach((a) => a.classList.remove("active"));
          const a = tocLinks.get(entry.target.id);
          if (a) a.classList.add("active");
        }
      });
    },
    { rootMargin: "-10% 0px -75% 0px", threshold: 0 },
  );
  headings.forEach((h) => spyObserver.observe(h));
}

// ---------- sidebar collapsibles ----------
function attachSidebarToggles() {
  document.querySelectorAll(".tree .dir-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest("li.dir");
      if (!li) return;
      if (li.hasAttribute("data-open")) li.removeAttribute("data-open");
      else li.setAttribute("data-open", "");
    });
  });
}

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
    if (r) location.href = "/" + r.item.path;
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
    el.addEventListener("click", () => { location.href = "/" + el.dataset.path; });
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

// ---------- init ----------
function attachDocFeatures() {
  attachCopyButtons();
  attachAnchorClicks();
  attachScrollSpy();
  attachSidebarToggles();
}
attachToolbar();
attachDocFeatures();
