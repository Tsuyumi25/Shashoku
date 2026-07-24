import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("shashoku", {
  version: "0.0.0",
});
