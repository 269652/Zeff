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
  // The phone companion: its state, a new pairing ({ url, svg }: the QR code), unpairing; its changes (a phone connects).
  companion: () => ipcRenderer.invoke("companion"),
  companionPair: (name) => ipcRenderer.invoke("companionPair", name),
  companionUnpair: (id) => ipcRenderer.invoke("companionUnpair", id),
  companionOpen: (url) => ipcRenderer.invoke("companionOpen", url),
  companionFirewall: () => ipcRenderer.invoke("companionFirewall"),
  companionPrivate: (index) => ipcRenderer.invoke("companionPrivate", index),
  onCompanion: (cb) => ipcRenderer.on("companion", (_e, s) => cb(s)),
  // The tray asks for a tab ({ tab, pair }) while the window is open.
  onOpen: (cb) => ipcRenderer.on("open", (_e, o) => cb(o)),
});
