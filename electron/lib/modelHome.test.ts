import { describe, expect, it } from "vitest";
import { resolveModelHome } from "./modelHome";

describe("resolveModelHome", () => {
  it("uses LOCALAPPDATA on Windows", () => {
    expect(
      resolveModelHome("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a"),
    ).toBe("C:\\Users\\a\\AppData\\Local\\Shashoku\\models");
  });

  it("falls back under the home folder when Windows does not say", () => {
    expect(resolveModelHome("win32", {}, "C:\\Users\\a")).toBe(
      "C:\\Users\\a\\AppData\\Local\\Shashoku\\models",
    );
  });

  it("uses Application Support on macOS", () => {
    expect(resolveModelHome("darwin", {}, "/Users/a")).toBe(
      "/Users/a/Library/Application Support/Shashoku/models",
    );
  });

  it("follows XDG_DATA_HOME on Linux", () => {
    expect(
      resolveModelHome("linux", { XDG_DATA_HOME: "/run/user/1000/data" }, "/home/a"),
    ).toBe("/run/user/1000/data/shashoku/models");
  });

  it("falls back to ~/.local/share when the variable is unset", () => {
    expect(resolveModelHome("linux", {}, "/home/a")).toBe(
      "/home/a/.local/share/shashoku/models",
    );
  });

  it("ignores a relative XDG_DATA_HOME, as the spec requires", () => {
    expect(resolveModelHome("linux", { XDG_DATA_HOME: "data" }, "/home/a")).toBe(
      "/home/a/.local/share/shashoku/models",
    );
  });
});
