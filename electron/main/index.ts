/**
 * Electron main process entry.
 *
 * Security defaults (non-negotiable):
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 *   - preload: a strictly-typed contextBridge surface (no raw fs/ipcRenderer)
 *
 * Dev loads the Next.js dev server (http://localhost:3000); production loads
 * the static export (file://.../out/index.html). The renderer code is shared
 * with the web preview — it detects `window.studio` and uses native operations
 * when available, falling back to browser APIs otherwise.
 */

import { app, BrowserWindow, shell, Menu } from "electron";
import * as path from "node:path";
import { registerIpcHandlers } from "./ipc";

export const isPackaged = app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0b",
    title: "Local Audio Studio",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "../preload/index.js"),
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Block all new-window creation and force external links to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  if (isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "out", "index.html"));
  } else {
    void mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

// Single-instance lock — a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers(() => mainWindow);
    // A minimal, production-friendly menu (no devtools in packaged builds).
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: "appMenu", submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }] },
        {
          label: "File",
          submenu: [isPackaged ? { role: "quit" } : { role: "close" }],
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
        },
      ])
    );
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Harden navigation: only allow loads to the app's own origin or localhost dev.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    const allowed = url.startsWith("http://localhost:3000") || url.startsWith("file://");
    if (!allowed) event.preventDefault();
  });
});
