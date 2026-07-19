const { contextBridge, ipcRenderer } = require("electron");

const vscodeApi = {
  postMessage(message) {
    ipcRenderer.send("ddd-host", message);
  },
  getState() {
    return {};
  },
  setState(_state) {
    // no-op
  },
};

const initialDiagram = ipcRenderer.sendSync("ddd-get-diagram-sync");

contextBridge.exposeInMainWorld("acquireVsCodeApi", () => vscodeApi);
contextBridge.exposeInMainWorld("__DDD_APPLET__", true);
contextBridge.exposeInMainWorld("__DDD_INITIAL_DIAGRAM__", initialDiagram);

ipcRenderer.on("ddd-host-push", (_event, message) => {
  window.dispatchEvent(new MessageEvent("message", { data: message }));
});
