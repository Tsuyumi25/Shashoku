# Shashoku — AI agent rules

Rules for AI coding assistants (Claude Code, Codex, Cursor, ...) working in
this repository.

## Comments

- Default: write no comments. Add one only when the WHY is non-obvious
  — a hidden constraint, a subtle invariant, a workaround for a specific
  bug, or behavior that would surprise a reader.
- Never explain WHAT the code does — well-named identifiers do that.
- All comments in English. No non-English text in code comments.

## Commit messages

- All commit messages in English.
- Format: `type(scope): short effect` — feat / fix / refactor / docs /
  style / perf / test / build / ci / chore.
- The subject is an index: imperative mood, the trade's shared
  vocabulary, ten words at most. Someone grepping the log knows
  `migrate`, `cache`, `undo` — not our metaphors.
- The prose goes in the body: the effect, the invariant that now holds,
  the WHY. Body only when there is a real WHY. Do not narrate process
  ("tried X, then Y, then Z"). Write the conclusion, not the journey.

## Language

- Code identifiers, file names, type names, comments: English.
- User-facing strings (UI labels, tooltips, dialogs, errors): the default
  locale today is 繁體中文, but treat everything user-visible as
  translatable content — i18n is planned. Do not hard-code locale-specific
  formatting when a locale-aware alternative exists.

## Setup

```
pnpm install
pnpm engine:build
pnpm sidecar:sync
pnpm dev
```

`pnpm install` triggers `postinstall` which downloads the Electron binary.
Electron 42+ removed its own postinstall hook, so downstream repositories
have to install the binary explicitly.

`pnpm engine:build` compiles the native addon and is a separate step on
purpose: a cold Rust build takes minutes and should not be charged to
everyone who installs. Working on the repository therefore needs a Rust
toolchain (the flake's devShell provides one); people running a packaged
build do not, since the `.node` ships inside it.

`pnpm test` needs it to have run at least once. The selection's coverage and
every layer's pixels live in the engine's tiles, so the tests that drive them
require the real addon — a stand-in there would be a second implementation of
the invariants the tiles exist to keep, and one that agreed with the store and
disagreed with the engine would pass while the application was broken.
`vue-tsc` still needs nothing built: the addon's surface is declared by hand
rather than imported from the generated typings.

`pnpm sidecar:sync` builds the OCR environment with `uv`, and is separate for
the same reason: it is a gigabyte of PyTorch that a session may never reach
for. Weights are not part of it — each model downloads itself the first time
something asks for it.

## Architecture

Layout as of this commit — modules land incrementally:

- `electron/` — main + preload
- `shared/` — data model, IPC channels, engine surface
- `crates/shashoku-engine` — Rust text engine, a native Node addon that
  preload requires directly rather than reaching over IPC
- `python/shashoku_ocr` — the OCR models, in a process the main process
  spawns and talks to in JSON lines over stdio
- `src/` — Vue renderer
