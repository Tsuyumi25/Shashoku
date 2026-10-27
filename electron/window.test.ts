import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

class FakeWebContents extends EventEmitter {
  opened = false;
  openDevTools = vi.fn(() => {
    this.opened = true;
  });
  closeDevTools = vi.fn(() => {
    this.opened = false;
    this.emit("devtools-closed");
  });
  isDevToolsOpened = vi.fn(() => this.opened);
  setDevToolsWebContents = vi.fn();
  send = vi.fn();
}

const windows: FakeBrowserWindow[] = [];

class FakeBrowserWindow extends EventEmitter {
  webContents = new FakeWebContents();
  loadURL = vi.fn();
  loadFile = vi.fn();
  maximize = vi.fn();
  show = vi.fn();
  close = vi.fn();
  destroyed = false;
  destroy = vi.fn(() => {
    this.destroyed = true;
  });
  isDestroyed = vi.fn(() => this.destroyed);
  constructor() {
    super();
    windows.push(this);
  }
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
  it("opens devtools in a window of its own on F12 keydown", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    const before = windows.length;
    const event = fireF12(win.webContents);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(windows.length).toBe(before + 1);
    const host = windows.at(-1)!;
    expect(win.webContents.setDevToolsWebContents).toHaveBeenCalledWith(host.webContents);
    expect(win.webContents.openDevTools).toHaveBeenCalledWith({ mode: "detach" });
  });

  it("closes them on a second F12 press, window and all", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    fireF12(win.webContents);
    const host = windows.at(-1)!;
    fireF12(win.webContents);

    expect(win.webContents.closeDevTools).toHaveBeenCalledOnce();
    expect(host.destroyed).toBe(true);
  });

  it("ignores key repeat from a held F12 so it does not rapid-fire", () => {
    const win = createWindow() as unknown as FakeBrowserWindow;
    fireF12(win.webContents, { isAutoRepeat: true });

    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
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

    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
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

    expect(win.webContents.openDevTools).not.toHaveBeenCalled();
  });
});
