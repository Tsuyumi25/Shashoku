import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

class FakeWebContents extends EventEmitter {
  toggleDevTools = vi.fn();
  openDevTools = vi.fn();
  send = vi.fn();
}

class FakeBrowserWindow extends EventEmitter {
  webContents = new FakeWebContents();
  loadURL = vi.fn();
  loadFile = vi.fn();
  maximize = vi.fn();
  show = vi.fn();
  close = vi.fn();
  isDestroyed = vi.fn(() => false);
}

// No Menu export at all: the fake stands in for the whole `electron` module,
// so a test that passes here proves the F12 handler works without any app
// menu in the picture — not just without one that happens to be null.
vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { once: vi.fn(), on: vi.fn() },
}));

const { createWindow } = await import("./window");

function fireF12(wc: FakeWebContents, overrides: Partial<{ isAutoRepeat: boolean }> = {}) {
  const event = { preventDefault: vi.fn() };
  wc.emit("before-input-event", event, {
    type: "keyDown",
    key: "F12",
    isAutoRepeat: false,
    ...overrides,
  });
  return event;
}

describe("createWindow F12 devtools", () => {
  it("toggles devtools on F12 keydown", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    const event = fireF12(win.webContents);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(win.webContents.toggleDevTools).toHaveBeenCalledOnce();
  });

  it("toggles again on a second F12 press, closing what the first opened", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    fireF12(win.webContents);
    fireF12(win.webContents);

    expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(2);
  });

  it("ignores key repeat from a held F12 so it does not rapid-fire", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    fireF12(win.webContents, { isAutoRepeat: true });

    expect(win.webContents.toggleDevTools).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+Shift+I alone, since this app binds it to inverting the selection", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    const event = { preventDefault: vi.fn() };
    win.webContents.emit("before-input-event", event, {
      type: "keyDown",
      key: "I",
      shift: true,
      control: true,
      isAutoRepeat: false,
    });

    expect(win.webContents.toggleDevTools).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores keyUp so devtools only toggle once per press", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    const event = { preventDefault: vi.fn() };
    win.webContents.emit("before-input-event", event, {
      type: "keyUp",
      key: "F12",
      isAutoRepeat: false,
    });

    expect(win.webContents.toggleDevTools).not.toHaveBeenCalled();
  });
});
