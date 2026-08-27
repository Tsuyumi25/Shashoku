# Shashoku — AI agent rules

Rules for AI coding assistants (Claude Code, Codex, Cursor, ...) working in
this repository.

## Comments

Default: none. Prose about code rots — the code moves, the paragraph
stays, and what was an explanation becomes a wrong one. It also lands in
the context of every future reader, human or agent, on every pass over
that file.

This is a ladder. Stop at the first rung that holds:

1. Does the code say it? → no comment
2. Does the code around it say it? → no comment
3. Would a reader with an agent over the whole repo work it out?
   → no comment
4. Does it take something outside the repo to know — an upstream bug, a
   limit of some API, a number that was measured, a line in a spec?
   → then, and only then, a comment
5. Never explain WHAT the code does. Well-named identifiers do that.

One case sits outside the ladder: a shortcut taken on purpose, whose
ceiling is known. Working code looks like the best answer, and the next
person builds on it. Mark it `TODO` or `HACK` on one line, naming the
ceiling. If it does not fit on one line it is not a shortcut, it is a
design.

All comments in English. No non-English text in code comments.

## Commit messages

The subject is required. The body is not.

- All commit messages in English.
- Format: `type(scope): short effect` — feat / fix / refactor / docs /
  style / perf / test / build / ci / chore.
- The subject is an index: imperative mood, the trade's shared
  vocabulary, ten words at most. Someone grepping the log looks for
  `migrate`, `cache`, `undo` — use the words they would type.
- **Default to no body.** The diff already says what changed, and a
  commit existing at all says the change was wanted. Apply the same
  ladder as comments: write a body only for what it takes something
  outside the repo to know.
- Never narrate process ("tried X, then Y, then Z"). Write the
  conclusion, not the journey.
- Describe the diff, not the work. Intermediate states never entered
  history; a reader cannot see the file that was renamed away before the
  commit.
- No unearned forward references ("a later commit will add Y"), and no
  identifiers that only exist locally — a `jj` change ID is a dead
  reference to anyone reading plain git.

## Crediting other projects

Attribution the licence asks for is required: when code or weights come
from somewhere else, the notice goes in. Keep it factual — upstream URL
and licence.

Do not write down that an approach was copied from a project whose code
is not in this repository. State the reason instead:

- ✗ "matching how project X does it, normalize here first"
- ✓ "normalize here, or the second call sees accumulated values"

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
