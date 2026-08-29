import { posix, win32 } from "node:path";

/**
 * Where the engine's interpreter lives and what has to travel with it.
 *
 * The packaged shape and the development shape are unrelated on disk: dev
 * runs out of a venv this repo builds locally, packaged runs out of an
 * unpacked payload that sits beside the install, never inside `app.asar` —
 * that is not a directory the OS can `chdir` into or exec out of.
 */
export interface EngineLaunchSpec {
  interpreter: string;
  cwd?: string;
  /** Extra `sys.path` entries the interpreter needs to find its own packages. */
  pythonPath?: string[];
}

/**
 * Picks the interpreter and its launch shape for one platform.
 *
 * `platform` is a parameter rather than `process.platform` so the Windows
 * shape can be exercised from Linux — the only way this gets tested before a
 * Windows CI run or a VM. Paths are joined with the target platform's own
 * separator, not the one this process happens to run on.
 */
export function resolveLaunchSpec(
  platform: NodeJS.Platform,
  packaged: boolean,
  root: string,
  supplied: string | undefined,
): EngineLaunchSpec {
  if (supplied) return { interpreter: supplied };

  const path = platform === "win32" ? win32 : posix;

  if (packaged) {
    if (platform === "win32") {
      return {
        interpreter: path.join(root, "py", "python.exe"),
        pythonPath: [path.join(root, "site")],
      };
    }
    // Unreached today: the only packaged build is Windows's NSIS installer,
    // and the Nix build always supplies `SHASHOKU_PYTHON` before this branch
    // would run. Kept total, on the same shape as `win32`, rather than
    // throwing on a platform nothing ships for yet.
    return { interpreter: path.join(root, "py", "bin", "python3") };
  }

  return {
    interpreter:
      platform === "win32"
        ? path.join(root, "python", ".venv", "Scripts", "python.exe")
        : path.join(root, "python", ".venv", "bin", "python"),
    cwd: path.join(root, "python"),
  };
}

/** Names that must not survive into the engine's environment. */
const BLOCKED_EXACT = new Set(["VIRTUAL_ENV"]);
const BLOCKED_PREFIXES = ["PYTHON", "CONDA"];

/**
 * Name segments that mark a variable as carrying a secret.
 *
 * Compared segment by segment after splitting on `_`, not as substrings: a
 * substring test for `KEY` also swallows `MONKEY_BUSINESS`, and a variable
 * the engine needed going missing fails far more quietly than a leak does.
 */
const CREDENTIAL_SEGMENTS = new Set([
  "TOKEN",
  "TOKENS",
  "SECRET",
  "SECRETS",
  "KEY",
  "KEYS",
  "APIKEY",
  "PASSWORD",
  "PASSWD",
  "PASSPHRASE",
  "CREDENTIAL",
  "CREDENTIALS",
  "AUTH",
]);

function isCredentialVar(name: string): boolean {
  // Uppercased on every platform, unlike the rule below it. That rule is
  // about names Python itself reads, so POSIX's case-sensitivity is the whole
  // point of it; this one is about secrets, and a secret is a secret whatever
  // it is spelled like.
  return name
    .toUpperCase()
    .split("_")
    .some((segment) => CREDENTIAL_SEGMENTS.has(segment));
}

function isBlockedVar(name: string, platform: NodeJS.Platform): boolean {
  if (isCredentialVar(name)) return true;
  // Windows treats environment variable names as case-insensitive; POSIX
  // does not, so a hypothetical lowercase `virtual_env` there is a distinct
  // variable and is left alone.
  const compare = platform === "win32" ? name.toUpperCase() : name;
  if (BLOCKED_EXACT.has(compare)) return true;
  return BLOCKED_PREFIXES.some((prefix) => compare.startsWith(prefix));
}

/**
 * The environment the engine gets, built by starting from everything this
 * process inherited and removing what would interfere — not by listing
 * every variable the engine might need.
 *
 * An allowlist cannot keep up: on Windows alone, libuv's own
 * `make_program_env()` force-fills eleven names whenever the caller's own
 * list omits them (`HOMEDRIVE` `HOMEPATH` `LOGONSERVER` `PATH` `SYSTEMDRIVE`
 * `SYSTEMROOT` `TEMP` `USERDOMAIN` `USERNAME` `USERPROFILE` `WINDIR`), but
 * that list was drawn up for winsock — it has nothing for `APPDATA` or
 * `LOCALAPPDATA`, and nothing for proxy or CA configuration either. Naming
 * every variable a Python process, a proxy, and a certificate store between
 * them might care about is not a list that stays finished.
 *
 * What that argument does not excuse is handing the engine secrets. It loads
 * at least one model with `trust_remote_code=True`, so code this repo did not
 * write runs in that process, and "everything the launching shell was
 * carrying" is a poor thing to give it. Hence `CREDENTIAL_SEGMENTS`: still a
 * blocklist, so `APPDATA` and the proxy and CA variables keep arriving on
 * their own, but one that reads names rather than enumerating them.
 */
export function resolveSidecarEnv(
  platform: NodeJS.Platform,
  inherited: NodeJS.ProcessEnv,
  modelHome: string,
  pythonPath: string[] = [],
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (!isBlockedVar(key, platform)) env[key] = value;
  }

  env.PYTHONUNBUFFERED = "1";
  // Windows's console code page is not moved by LANG; this is what actually
  // forces UTF-8 stdio. Set on every platform, since it costs nothing where
  // stdio is UTF-8 already.
  env.PYTHONUTF8 = "1";
  // The download of a model's weights is the one stretch of a request where
  // "still running" and "already dead" look identical from the outside, and
  // the engine log now has somewhere for a progress bar to land — see
  // `engineLog.ts` and `lineSplitter.ts`. "0" rather than left unset: the
  // sidecar has its own default that would otherwise turn it back off.
  env.HF_HUB_DISABLE_PROGRESS_BARS = "0";

  if (platform === "win32") {
    // Creating a symlink on Windows is a privilege, not a permission an
    // ordinary account has; huggingface_hub's fallback to copying does not
    // cover the snapshot-download path.
    env.HF_HUB_DISABLE_SYMLINKS = "1";
    // A user-supplied HF_HOME always wins; this only fills in what they
    // never set. Non-Windows never assigns HF_HOME here at all — existing
    // installs' weights already sit at the hub's default location, and
    // pointing elsewhere would orphan them until a redownload.
    if (!env.HF_HOME) env.HF_HOME = modelHome;
    // Whatever leaked in from WSL or a manual export does not apply here.
    delete env.LD_LIBRARY_PATH;
  } else {
    // The wheels are manylinux builds that expect a distribution's shared
    // libraries, which on NixOS live wherever nix-ld was told to put them.
    env.LD_LIBRARY_PATH = inherited.NIX_LD_LIBRARY_PATH ?? inherited.LD_LIBRARY_PATH ?? "";
  }

  if (pythonPath.length > 0) {
    env.PYTHONPATH = pythonPath.join(platform === "win32" ? ";" : ":");
  }

  return env;
}
