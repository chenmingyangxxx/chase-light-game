const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const APP_SCHEME = "chase-light";

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function rendererDirectory() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "renderer")
    : path.join(__dirname, "..", "desktop-dist");
}

function safeRendererPath(requestUrl) {
  const rendererRoot = path.resolve(rendererDirectory());
  const url = new URL(requestUrl);
  const requestedPath = decodeURIComponent(url.pathname || "/");
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const resolvedPath = path.resolve(rendererRoot, relativePath);

  if (resolvedPath !== rendererRoot && !resolvedPath.startsWith(`${rendererRoot}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
}

function createWindow() {
  const rendererRoot = rendererDirectory();
  const window = new BrowserWindow({
    title: "追.光",
    width: 1440,
    height: 900,
    minWidth: 480,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#071113",
    icon: path.join(rendererRoot, "assets", "ashes-to-aurora-emblem.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });

  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
  });

  void window.loadURL(`${APP_SCHEME}://app/index.html`);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  protocol.handle(APP_SCHEME, (request) => {
    const localPath = safeRendererPath(request.url);
    if (!localPath) return new Response("Invalid path", { status: 400 });
    return net.fetch(pathToFileURL(localPath).toString());
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
