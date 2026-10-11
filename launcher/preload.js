// The status window's only door to the launcher.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zeff", {
  state: () => ipcRenderer.invoke("state"),
  do: (action, name) => ipcRenderer.invoke("do", action, name),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
});
