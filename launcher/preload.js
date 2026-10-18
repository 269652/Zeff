// The status window's only door to the launcher.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zeff", {
  state: () => ipcRenderer.invoke("state"),
  do: (action, name) => ipcRenderer.invoke("do", action, name),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
  // Where each part runs (host / Docker), saved with a restart of the launcher; the containers Docker has.
  modes: () => ipcRenderer.invoke("modes"),
  setModes: (m) => ipcRenderer.invoke("setModes", m),
  docker: () => ipcRenderer.invoke("docker"),
});
