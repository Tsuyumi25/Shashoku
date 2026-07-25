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
- Body only when there is a real WHY. Do not narrate process ("tried X,
  then Y, then Z"). Write the conclusion, not the journey.

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

## Architecture

Layout as of this commit — modules land incrementally:

- `electron/` — main + preload
- `shared/` — data model, IPC channels, engine surface
- `crates/shashoku-engine` — Rust text engine, a native Node addon that
  preload requires directly rather than reaching over IPC
- `src/` — Vue renderer
