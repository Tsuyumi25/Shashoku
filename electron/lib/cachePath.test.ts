import { describe, expect, it } from "vitest";
import { resolveCacheRoot } from "./cachePath";

describe("resolveCacheRoot", () => {
  it("follows XDG_CACHE_HOME on Linux", () => {
    expect(
      resolveCacheRoot("linux", { XDG_CACHE_HOME: "/run/user/1000/cache" }, "/home/a"),
    ).toBe("/run/user/1000/cache/shashoku");
  });

  it("falls back to ~/.cache when the variable is unset", () => {
    expect(resolveCacheRoot("linux", {}, "/home/a")).toBe("/home/a/.cache/shashoku");
  });

  it("ignores an empty XDG_CACHE_HOME", () => {
    expect(resolveCacheRoot("linux", { XDG_CACHE_HOME: "" }, "/home/a")).toBe(
      "/home/a/.cache/shashoku",
    );
  });

  it("ignores a relative XDG_CACHE_HOME, as the spec requires", () => {
    expect(resolveCacheRoot("linux", { XDG_CACHE_HOME: "cache" }, "/home/a")).toBe(
      "/home/a/.cache/shashoku",
    );
  });

  it("uses the caches folder on macOS", () => {
    expect(resolveCacheRoot("darwin", {}, "/Users/a")).toBe(
      "/Users/a/Library/Caches/shashoku",
    );
  });

  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveCacheRoot("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a"),
    ).toBe("C:\\Users\\a\\AppData\\Local\\shashoku\\Cache");
  });

  it("falls back under the home folder when Windows does not say", () => {
    expect(resolveCacheRoot("win32", {}, "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\AppData\\Local\\shashoku\\Cache",
    );
  });
});
