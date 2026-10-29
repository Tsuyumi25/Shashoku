import { ipcMain } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import { appendActivity } from "../lib/activityLog";
import { readPreferencesRaw, writePreferencesRaw } from "../lib/preferences";

export function registerPreferencesHandlers(): void {
  ipcMain.handle(CHANNELS.readPreferences, () => readPreferencesRaw());
  ipcMain.handle(CHANNELS.writePreferences, (_e, raw: string) => writePreferencesRaw(raw));
  ipcMain.handle(CHANNELS.appendActivity, (_e, lines: string) => appendActivity(lines));
}
