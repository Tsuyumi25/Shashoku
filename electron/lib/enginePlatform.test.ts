import { describe, expect, it } from "vitest";
import { resolveLaunchSpec, resolveSidecarEnv } from "./enginePlatform";

describe("resolveLaunchSpec", () => {
  describe("development", () => {
    it("joins the venv with backslashes on Windows, and gives it a cwd", () => {
      expect(resolveLaunchSpec("win32", false, "C:\\repo", undefined)).toEqual({
        interpreter: "C:\\repo\\python\\.venv\\Scripts\\python.exe",
        cwd: "C:\\repo\\python",
      });
    });

    it("joins the venv with forward slashes elsewhere, and gives it a cwd", () => {
      expect(resolveLaunchSpec("linux", false, "/repo", undefined)).toEqual({
        interpreter: "/repo/python/.venv/bin/python",
        cwd: "/repo/python",
      });
    });

    it("uses the target platform's separator even when it differs from the host", () => {
      // This test itself runs on Linux; the assertion only holds if the
      // separator came from the `platform` argument, not `process.platform`.
      const spec = resolveLaunchSpec("win32", false, "C:\\repo", undefined);
      expect(spec.interpreter).toContain("\\");
      expect(spec.interpreter).not.toContain("/");
    });
  });

  describe("packaged", () => {
    it("points at the unpacked payload on Windows, with no cwd and a module search path", () => {
      expect(resolveLaunchSpec("win32", true, "C:\\Install", undefined)).toEqual({
        interpreter: "C:\\Install\\py\\python.exe",
        pythonPath: ["C:\\Install\\site"],
      });
    });

    it("does not set a module search path on a non-Windows packaged build", () => {
      const spec = resolveLaunchSpec("linux", true, "/opt/app", undefined);
      expect(spec.pythonPath).toBeUndefined();
    });

    it("carries no cwd, on either platform", () => {
      expect(resolveLaunchSpec("win32", true, "C:\\Install", undefined).cwd).toBeUndefined();
      expect(resolveLaunchSpec("linux", true, "/opt/app", undefined).cwd).toBeUndefined();
    });
  });

  describe("a user-supplied interpreter", () => {
    it("wins over the packaged shape", () => {
      expect(resolveLaunchSpec("win32", true, "C:\\Install", "C:\\my\\python.exe")).toEqual({
        interpreter: "C:\\my\\python.exe",
      });
    });

    it("wins over the development shape", () => {
      expect(resolveLaunchSpec("linux", false, "/repo", "/usr/bin/python3")).toEqual({
        interpreter: "/usr/bin/python3",
      });
    });
  });
});

describe("resolveSidecarEnv", () => {
  it("passes through a variable that is not on the blocklist", () => {
    const env = resolveSidecarEnv("linux", { CUSTOM_VAR: "kept" }, "/home/a/models");
    expect(env.CUSTOM_VAR).toBe("kept");
  });

  it("strips PYTHON*, VIRTUAL_ENV, and CONDA* by exact and prefix match", () => {
    const env = resolveSidecarEnv(
      "linux",
      {
        PYTHONPATH: "/leaked",
        PYTHONHOME: "/leaked",
        VIRTUAL_ENV: "/leaked/venv",
        CONDA_PREFIX: "/leaked/conda",
        CONDA_DEFAULT_ENV: "base",
      },
      "/home/a/models",
    );
    expect(env.PYTHONPATH).toBeUndefined();
    expect(env.PYTHONHOME).toBeUndefined();
    expect(env.VIRTUAL_ENV).toBeUndefined();
    expect(env.CONDA_PREFIX).toBeUndefined();
    expect(env.CONDA_DEFAULT_ENV).toBeUndefined();
  });

  it("strips a blocked name case-insensitively when the target is Windows", () => {
    const env = resolveSidecarEnv("win32", { virtual_env: "/leaked/venv" }, "C:\\models");
    expect(env.virtual_env).toBeUndefined();
  });

  it("does not strip a differently-cased name when the target is POSIX", () => {
    // Real POSIX environment variable names are case-sensitive; a lowercase
    // `virtual_env` there is a distinct variable from `VIRTUAL_ENV` and is
    // not what the blocklist means to catch.
    const env = resolveSidecarEnv("linux", { virtual_env: "/kept" }, "/home/a/models");
    expect(env.virtual_env).toBe("/kept");
  });

  it("sets PYTHONUTF8 on every platform", () => {
    expect(resolveSidecarEnv("win32", {}, "C:\\models").PYTHONUTF8).toBe("1");
    expect(resolveSidecarEnv("linux", {}, "/models").PYTHONUTF8).toBe("1");
  });

  it("turns progress bars on, not off, on every platform", () => {
    expect(resolveSidecarEnv("win32", {}, "C:\\models").HF_HUB_DISABLE_PROGRESS_BARS).toBe("0");
    expect(resolveSidecarEnv("linux", {}, "/models").HF_HUB_DISABLE_PROGRESS_BARS).toBe("0");
  });

  describe("HF_HUB_DISABLE_SYMLINKS", () => {
    it("is set on Windows, where creating a symlink is a privilege", () => {
      expect(resolveSidecarEnv("win32", {}, "C:\\models").HF_HUB_DISABLE_SYMLINKS).toBe("1");
    });

    it("is not set on other platforms, where existing installs use symlinks already", () => {
      expect(resolveSidecarEnv("linux", {}, "/models").HF_HUB_DISABLE_SYMLINKS).toBeUndefined();
      expect(resolveSidecarEnv("darwin", {}, "/models").HF_HUB_DISABLE_SYMLINKS).toBeUndefined();
    });
  });

  describe("the module search path", () => {
    it("is joined with semicolons when set for a Windows target", () => {
      const env = resolveSidecarEnv("win32", {}, "C:\\models", ["C:\\Install\\site", "C:\\extra"]);
      expect(env.PYTHONPATH).toBe("C:\\Install\\site;C:\\extra");
    });

    it("is joined with colons when set for a POSIX target", () => {
      const env = resolveSidecarEnv("linux", {}, "/models", ["/opt/app/site", "/opt/extra"]);
      expect(env.PYTHONPATH).toBe("/opt/app/site:/opt/extra");
    });

    it("is left unset when nothing is given, on either platform", () => {
      expect(resolveSidecarEnv("win32", {}, "C:\\models").PYTHONPATH).toBeUndefined();
      expect(resolveSidecarEnv("linux", {}, "/models").PYTHONPATH).toBeUndefined();
    });
  });

  describe("the dynamic library path", () => {
    it("prefers NIX_LD_LIBRARY_PATH over LD_LIBRARY_PATH on non-Windows, unchanged from before this ticket", () => {
      const env = resolveSidecarEnv(
        "linux",
        { NIX_LD_LIBRARY_PATH: "/nix/ld", LD_LIBRARY_PATH: "/usr/lib" },
        "/models",
      );
      expect(env.LD_LIBRARY_PATH).toBe("/nix/ld");
    });

    it("falls back to LD_LIBRARY_PATH when there is no nix-ld path, unchanged from before this ticket", () => {
      const env = resolveSidecarEnv("linux", { LD_LIBRARY_PATH: "/usr/lib" }, "/models");
      expect(env.LD_LIBRARY_PATH).toBe("/usr/lib");
    });

    it("resolves to the empty string, not undefined, when neither is set, unchanged from before this ticket", () => {
      const env = resolveSidecarEnv("linux", {}, "/models");
      expect(env.LD_LIBRARY_PATH).toBe("");
    });

    it("drops whatever was inherited on Windows, e.g. left over from WSL or a manual export", () => {
      const env = resolveSidecarEnv("win32", { LD_LIBRARY_PATH: "/mnt/wsl/lib" }, "C:\\models");
      expect(env.LD_LIBRARY_PATH).toBeUndefined();
    });
  });

  describe("HF_HOME", () => {
    it("is set to the platform's model home on Windows when the user has not set one", () => {
      const env = resolveSidecarEnv("win32", {}, "C:\\Users\\a\\AppData\\Local\\Shashoku\\models");
      expect(env.HF_HOME).toBe("C:\\Users\\a\\AppData\\Local\\Shashoku\\models");
    });

    it("never overrides a user-supplied HF_HOME on Windows", () => {
      const env = resolveSidecarEnv(
        "win32",
        { HF_HOME: "D:\\my\\own\\cache" },
        "C:\\Users\\a\\AppData\\Local\\Shashoku\\models",
      );
      expect(env.HF_HOME).toBe("D:\\my\\own\\cache");
    });

    // Non-Windows installs today have their weights sitting wherever the hub
    // puts them by default. Pointing HF_HOME at our own directory would make
    // those gigabytes orphans and force a redownload — a migration this
    // ticket does not do, not a one-line env assignment.
    it("is left unset on non-Windows even though a model home was computed for it", () => {
      expect(resolveSidecarEnv("linux", {}, "/home/a/.local/share/shashoku/models").HF_HOME).toBeUndefined();
      expect(
        resolveSidecarEnv("darwin", {}, "/Users/a/Library/Application Support/Shashoku/models")
          .HF_HOME,
      ).toBeUndefined();
    });
  });
});
