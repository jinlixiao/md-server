# md-server

A lightweight local markdown reader. Point it at any directory of `.md` files
and browse them in a tab with a sidebar tree, fuzzy search, in-page table of
contents, live reload, and keyboard navigation. No build step, no framework,
no CDN dependencies at runtime.

Built as a personal handbook reader, but it works on any markdown tree.

## Features

- **Refined editorial minimalism** — Charter (system serif) for prose,
  bundled JetBrains Mono for code, warm palette, paired light/dark via
  `prefers-color-scheme`. Seamless ASCII box-drawing (`┌─┐│└┘`) at
  readable line-height. Respects `prefers-reduced-motion`.
- **Three-column layout** — sidebar tree (drag to resize, persisted),
  prose pane in the center, in-page TOC on the right with scroll-spy
  and auto-scroll to keep the active section centered. Soft fade
  indicators when the TOC overflows.
- **Client-side navigation** — link clicks swap DOM in place (no page
  flicker), preserving CSS/JS/font caches. `history.pushState` keeps
  the URL and back/forward in sync. Cmd/Ctrl/Shift/middle-click fall
  through to the browser for new-tab flows.
- **Live reload** — edit a `.md` file and the browser hot-swaps the
  content via WebSocket, preserving scroll position and sidebar
  expand state.
- **Fuzzy search** — `Cmd-K` / `Ctrl-K` / `/` opens a command palette
  over titles, paths, and excerpts (fuse.js). Focus-trapped dialog.
- **Keyboard navigation** — see the [Keyboard](#keyboard) table below.
  `j`/`k` step through docs, `g g` / `G` jump to top / bottom, arrow
  keys on the resize handle nudge sidebar width.
- **GitHub-flavored task lists** — `- [ ]` / `- [x]` render as custom
  checkboxes (accent-filled when checked, no OS browser chrome).
- **Syntax highlighting** — [Shiki](https://shiki.style) with
  `github-light` + `github-dark` paired themes.
- **Copy buttons** — each code block gets a copy-to-clipboard button;
  each doc page has a "copy raw markdown" and "refresh" button.
  Announcements go through a single polite aria-live region.
- **Accessibility** — semantic landmarks, skip-to-content link,
  focus-visible rings, aria-expanded on sidebar folders,
  aria-current on the active file, aria-modal + focus trap + focus
  restoration on the search palette, WCAG AA contrast.
- **Safe by default** — binds to `127.0.0.1` (no LAN exposure),
  URL-level path-traversal blocked, 5 MB markdown cap, binary guard.
  Symlinks inside the doc tree may resolve anywhere under `$HOME` for
  markdown rendering and known-mime assets (images, fonts, CSS,
  JSON). Non-markdown symlinks to files with executable mimes (`.js`,
  `.svg`, `.html`) reached via `$HOME` are downgraded to
  `text/plain` + `no-cache` to block same-origin script execution.

## Install

Requires [Bun](https://bun.sh).

```
git clone https://github.com/jinlixiao/md-server.git
cd md-server
bun install
```

## Run

```
bun start                      # serve the current directory
bun start ~/notes              # or pass a path as the first argument
DOC_ROOT=~/notes bun start     # or set via environment
PORT=7070 bun start            # change the port
SITE_NAME='My notes' bun start # override the header/title label
```

Then open <http://localhost:4321>.

## Configuration

| Env var         | Default             | Purpose                               |
|-----------------|---------------------|---------------------------------------|
| `DOC_ROOT`      | CLI arg, or `cwd`   | Directory to serve                    |
| `SITE_NAME`     | basename of root    | Name in header, breadcrumbs, `<title>`|
| `PORT`          | `4321`              | Server port                           |
| `HOSTNAME_BIND` | `127.0.0.1`         | Bind address (don't expose to LAN)    |

The first positional argument to `bun start` overrides `DOC_ROOT`.

## Keyboard

| Key                        | Action                                        |
|----------------------------|-----------------------------------------------|
| `Cmd-K` / `Ctrl-K` / `/`   | Open search palette                           |
| `j` / `k`                  | Next / prev doc in sidebar                    |
| `g g`                      | Top of current doc                            |
| `G`                        | Bottom of current doc                         |
| `Esc`                      | Close search palette                          |
| `Tab` onto resize handle → `←`/`→` | Nudge sidebar width (20px step)       |
| Double-click resize handle | Reset sidebar width to default                |

## URL routes

- `/` — renders `README.md` at the root.
- `/<dir>` — renders `<dir>/README.md`, else an auto-listing of children.
- `/<path>.md` — renders the markdown file.
- `/_raw/<path>.md` — raw markdown, `text/plain`.
- `/_search/index.json` — search index (titles + paths + excerpts).
- `/_assets/*` — bundled CSS, JS, fonts, favicon.
- `/_ws` — WebSocket endpoint for live reload.

## Stack

- **Runtime** — [Bun](https://bun.sh), native recursive `fs.watch`.
- **Markdown** — [markdown-it](https://github.com/markdown-it/markdown-it)
  with [markdown-it-anchor](https://github.com/valeriangalliat/markdown-it-anchor)
  for heading IDs.
- **Syntax highlighting** — [Shiki](https://shiki.style) with
  `github-light` + `github-dark` paired themes.
- **Client-side search** — [fuse.js](https://fusejs.io) (loaded from
  `esm.sh` at runtime; swap to a vendored copy if you want zero external
  CDN dependency).
- **Live reload** — native `WebSocket`; the client re-fetches the current
  URL and swaps `#sidebar`, `#content`, `#rail`, and `#breadcrumbs` into
  place. Preserves scroll position and sidebar collapse state.
- **Typography** — Charter (system-installed on macOS) for prose,
  JetBrains Mono (bundled in `assets/fonts/`) for code.

## Layout

```
md-server/
├── server.ts        — HTTP + WebSocket + file watching + routing
├── template.ts      — markdown rendering + sidebar + TOC + HTML shell
├── assets/
│   ├── style.css    — three-column layout, palette, typography
│   ├── client.js    — live reload, hot-swap, keyboard nav, search
│   ├── favicon.svg
│   └── fonts/       — JetBrains Mono woff2 + OFL.txt
├── package.json
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Jinli Xiao.

### Third-party

- **JetBrains Mono** (`assets/fonts/JetBrainsMono-*.woff2`) — copyright ©
  JetBrains s.r.o., licensed under the SIL Open Font License 1.1. See
  [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt).
- **Charter** — designed by Matthew Carter, bundled by macOS; loaded via
  the system font stack.
- **markdown-it**, **markdown-it-anchor**, **Shiki**, **fuse.js** — MIT
  licensed; see `node_modules/*/LICENSE` after `bun install`.
