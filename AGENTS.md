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

## Validation

Named tasks live in `package.json`. When to run them is not this
repository's business — that is a personal workflow, and it lives on
whichever machine has it.

Times are rounded from the individual steps of one successful warm-cache
x86_64-linux workflow run. A row that names more than one task adds those
steps up, across jobs where they ran in different ones — no composite was
itself timed, and `check:source` is the sum of the eight it calls. They are
there to compare tasks against each other, and they are not timeouts.

**What a change asks for**

| Changed | Run | Estimated warm time |
|---|---|---|
| Rust internals | `check:rust-format`, `check:rust-lints`, `test:rust` | ≈1m10s |
| The N-API surface, or behaviour visible from TypeScript | `check:source` | ≈2m57s |
| TypeScript, Vue, Electron, bundler config | `typecheck && build && test` | ≈28s |
| `python/pyproject.toml`, `python/uv.lock` | `check:python-lock && check:artifacts` | ≈1m22s |
| Python sidecar code, the model registry | `check:artifacts` | 52s |
| `flake.nix`, `flake.lock`, `nix/`, a version pin | `check:flake-eval && check:artifacts` | ≈55s |
| Before handing the work over | `check:source` | ≈2m57s |

`test` needs a current debug addon. A clean checkout, or anything that
touched the engine, wants `engine:build:debug` first — 49s in the same
run.

**What each one leaves out**

| Task | Does not cover |
|---|---|
| `check:source` | Builds no Nix package and runs nothing in `nix/checks/`, so the packaged sidecar, where the addon lands, the Electron wrapper and whether the renderer comes up are all unseen |
| `typecheck`, `test` | The Python model registry. Everything green on the Node side is not evidence that the registry and the packaged sidecar agree |
| `check:flake-eval` | Evaluation only — it builds no artifact |
| `check:artifacts` | Does not run rustfmt, clippy, `vue-tsc`, electron-vite or vitest. The engine derivation reruns the crate's tests, which does not stand in for the source layer |
| every task here | CI's orchestration: jobs, caching, matrix, timeouts |

**Contracts more than one component shares**

Editing one side of these is not the same as checking one side. Run every
component the contract reaches, even when the edit landed in a single
directory.

| Contract | Inputs | Run |
|---|---|---|
| Native engine API | `crates/shashoku-engine/`, `shared/engine/`, `electron/lib/engine.ts`, preload | `check:source` |
| OCR request and response, model names | `python/shashoku_ocr/`, `shared/ocr/`, `electron/lib/ocrSidecar.ts`, `nix/checks/sidecar.py` | `check:source && check:artifacts` |
| Installed file layout | `electron.vite.config.ts`, `nix/app.nix`, `nix/checks/{app,engine,renderer}.js` | `build && check:artifacts` |
| Tool and runtime versions | `rust-toolchain.toml`, `.nvmrc`, `package.json`, `python/.python-version`, `python/pyproject.toml`, `flake.lock` | `check:flake-eval && check:source && check:artifacts` |

## Architecture

Layout as of this commit — modules land incrementally:

- `electron/` — main + preload
- `shared/` — data model, IPC channels, engine surface
- `crates/shashoku-engine` — Rust text engine, a native Node addon that
  preload requires directly rather than reaching over IPC
- `python/shashoku_ocr` — the OCR models, in a process the main process
  spawns and talks to in JSON lines over stdio
- `src/` — Vue renderer
