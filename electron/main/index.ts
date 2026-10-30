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

import { app, BrowserWindow, shell, Menu, protocol, net } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { registerIpcHandlers } from "./ipc";

export const isPackaged = app.isPackaged;
const debugEnabled = process.argv.includes("--vocalizer-debug");

/** Opt-in diagnostics without weakening the secure renderer configuration. */
function debugLog(message: string): void {
  if (!debugEnabled) return;
  try {
    const logs = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.appendFileSync(path.join(logs, "debug.log"), `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch (error) {
    console.error("Cannot write debug log:", error);
  }
}


// Register the privileged `las://` scheme BEFORE app.ready so it supports
// fetch, streaming, and secure context (needed to serve the bundled renderer
// and its /_next/ assets without a dev server).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "las",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

let mainWindow: BrowserWindow | null = null;

/** Directory containing the bundled Next.js static export (the renderer). */
function rendererDir(): string {
  // In a packaged build, `out/` is at the asar root (electron-builder `files`).
  // In dev, it would be the project root `out/` (only present after a static export).
  return path.join(app.getAppPath(), "out");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0b",
    title: "Vocalizer",
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
    // Never forward file:, javascript:, custom-protocol, or malformed URLs
    // to the operating system. Only user-clicked web links may leave the app.
    try {
      const target = new URL(url);
      if (target.protocol === "https:" || target.protocol === "http:") {
        void shell.openExternal(target.href);
      }
    } catch {
      // Invalid URLs are denied.
    }
    return { action: "deny" };
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    debugLog("Main window ready-to-show");
    if (debugEnabled) mainWindow?.webContents.openDevTools({ mode: "detach" });
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    debugLog(`Renderer load failure: code=${code} url=${url} detail=${description}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    debugLog(`Renderer process gone: reason=${details.reason} exit=${details.exitCode}`);
  });

  if (isPackaged) {
    // Load the renderer through the privileged `las://` protocol so Next.js's
    // absolute /_next/... asset URLs resolve to bundled files (file:// would break).
    void mainWindow.loadURL("las://renderer/index.html").catch((error) => debugLog(`UI load rejected: ${String(error)}`));
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
    debugLog(`Starting Vocalizer (packaged=${app.isPackaged}, resources=${process.resourcesPath})`);
    // Privileged custom protocol: serves bundled static assets under las://renderer/.
    // Next.js static export uses absolute /_next/... URLs; under file:// these
    // resolve to the filesystem root and 404. The las:// scheme maps every
    // request to a real file in the renderer directory, with traversal rejected.
    protocol.handle("las", (request) => {
      let relativePath: string;
      try {
        const url = new URL(request.url);
        if (url.hostname !== "renderer" || url.username || url.password || url.port) {
          return new Response("Forbidden", { status: 403 });
        }
        relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      } catch {
        return new Response("Bad request", { status: 400 });
      }
      // Check path components rather than a raw startsWith(base) prefix:
      // C:\\app\\out-evil is NOT inside C:\\app\\out.
      const segments = relativePath.split("/");
      if (!relativePath || relativePath.includes("\\") || relativePath.includes("\0") ||
          segments.some((part) => part === "." || part === "..")) {
        return new Response("Forbidden", { status: 403 });
      }
      const base = path.resolve(rendererDir());
      const resolved = path.resolve(base, relativePath);
      const rel = path.relative(base, resolved);
      if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(pathToFileURL(resolved).href);
    });

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
          submenu: isPackaged ? [{ role: "reload" }] : [{ role: "reload" }, { role: "toggleDevTools" }],
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
  // Shut the inference worker down before quitting (no zombie processes).
  import("./services/inference-worker").then(({ shutdownWorker }) => shutdownWorker());
  if (process.platform !== "darwin") app.quit();
});

// Harden navigation: only allow loads to the app's own origin (las://) or localhost dev.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    let allowed = false;
    try {
      const target = new URL(url);
      allowed = isPackaged
        ? target.protocol === "las:" && target.hostname === "renderer"
        : target.origin === "http://localhost:3000";
    } catch {
      // A malformed navigation destination is never allowed.
    }
    if (!allowed) event.preventDefault();
  });
});
