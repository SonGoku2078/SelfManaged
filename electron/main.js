"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const http = __importStar(require("http"));
const electron_updater_1 = require("electron-updater");
// Thin client (#55/#60/#62): the desktop app is a window onto a running
// SelfManaged server. Target resolution, first hit wins:
//   1. TM_DESKTOP_URL  — full URL override (tests/power users)
//   2. TM_DESKTOP_PORT — 127.0.0.1:<port> (E2E against the dev backend)
//   3. userData/config.json { "serverUrl": … } — set in-app (#62), persisted
//   4. default: prod server http://192.168.8.50:3001 (packaged) / vite :5173 (dev)
const DEFAULT_URL_PACKAGED = 'http://192.168.8.50:3001';
const DEFAULT_URL_DEV = 'http://127.0.0.1:5173';
const POLL_MS = 2000;
let mainWindow = null;
let pollTimer = null;
// Startup log under userData — "double-click does nothing" must stay diagnosable.
function logToFile(msg) {
    try {
        fs.appendFileSync(path.join(electron_1.app.getPath('userData'), 'startup.log'), `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch {
        /* logging must never crash the app */
    }
}
process.on('uncaughtException', (err) => {
    logToFile(`uncaughtException: ${err?.stack ?? String(err)}`);
    try {
        electron_1.dialog.showErrorBox('SelfManaged – Fehler', String(err));
    }
    catch {
        /* headless */
    }
    electron_1.app.exit(1);
});
// E2E isolation: private userData also scopes config + single-instance lock.
if (process.env.TM_USER_DATA_DIR)
    electron_1.app.setPath('userData', process.env.TM_USER_DATA_DIR);
// ── Persisted config (#62) ────────────────────────────────────────────────────
const configPath = () => path.join(electron_1.app.getPath('userData'), 'config.json');
function loadSavedServerUrl() {
    try {
        const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
        return typeof raw.serverUrl === 'string' && raw.serverUrl ? raw.serverUrl : null;
    }
    catch {
        return null; // missing/corrupt config → defaults
    }
}
function saveServerUrl(url) {
    fs.mkdirSync(electron_1.app.getPath('userData'), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ serverUrl: url }, null, 2));
}
// Accept http(s) origins only; strip trailing slashes. Returns null if invalid.
function normalizeServerUrl(input) {
    const v = (input ?? '').trim().replace(/\/+$/, '');
    const withScheme = /^https?:\/\//i.test(v) ? v : v ? `http://${v}` : '';
    try {
        const u = new URL(withScheme);
        if (u.protocol !== 'http:' && u.protocol !== 'https:')
            return null;
        return u.origin;
    }
    catch {
        return null;
    }
}
function resolveTarget() {
    if (process.env.TM_DESKTOP_URL) {
        return normalizeServerUrl(process.env.TM_DESKTOP_URL) ?? DEFAULT_URL_PACKAGED;
    }
    if (process.env.TM_DESKTOP_PORT)
        return `http://127.0.0.1:${Number(process.env.TM_DESKTOP_PORT)}`;
    const saved = loadSavedServerUrl();
    if (saved)
        return saved;
    return electron_1.app.isPackaged ? DEFAULT_URL_PACKAGED : DEFAULT_URL_DEV;
}
let currentTarget = ''; // set in main() — app.isPackaged needs the ready app
// ── Health check + fallback page + polling ──────────────────────────────────
function checkHealth(target) {
    return new Promise((resolve) => {
        const req = http.get(`${target}/health`, { timeout: 1500 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });
        req.on('error', () => resolve(false));
    });
}
// mode 'error': server unreachable — page shows spinner, main keeps polling.
// mode 'change': user picked "Server ändern…" — no polling, just the form.
function showFallback(win, mode) {
    void win.loadFile(path.join(__dirname, 'fallback.html'), {
        query: { target: currentTarget, mode },
    });
}
function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
function startPolling(win) {
    stopPolling();
    pollTimer = setInterval(() => {
        void (async () => {
            if (win.isDestroyed()) {
                stopPolling();
                return;
            }
            if (await checkHealth(currentTarget)) {
                stopPolling();
                if (!win.isDestroyed())
                    void win.loadURL(currentTarget);
            }
        })();
    }, POLL_MS);
}
async function connectAndLoad(win) {
    if (await checkHealth(currentTarget)) {
        void win.loadURL(currentTarget);
    }
    else {
        showFallback(win, 'error');
        startPolling(win);
    }
}
// ── IPC (#62): the fallback/change page sets a new server URL ────────────────
electron_1.ipcMain.handle('tm:get-target', () => currentTarget);
electron_1.ipcMain.handle('tm:get-app-version', () => electron_1.app.getVersion());
electron_1.ipcMain.handle('tm:set-server-url', async (_e, input) => {
    const url = normalizeServerUrl(String(input));
    if (!url)
        return { ok: false, error: 'Ungültige Adresse — erwartet z. B. http://192.168.8.50:3001' };
    currentTarget = url;
    try {
        saveServerUrl(url);
    }
    catch (err) {
        logToFile(`config save failed: ${String(err)}`);
    }
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
        stopPolling();
        if (await checkHealth(url)) {
            void win.loadURL(url);
        }
        else {
            showFallback(win, 'error');
            startPolling(win);
        }
    }
    return { ok: true };
});
// ── Auto-Update (#66) ────────────────────────────────────────────────────────
// Laedt ein neues Release im Hintergrund und installiert es beim Beenden.
// Der Feed sind die GitHub-Releases dieses (oeffentlichen) Repos, gefuellt vom
// desktop-exe-Workflow; ohne Netz/Release passiert schlicht nichts.
const UPDATE_CHECK_DELAY_MS = 8000;
let updateReady = null; // Version, sobald heruntergeladen
let manualCheck = false; // true = Nutzer hat "Nach Updates suchen" geklickt
function notify(title, body) {
    try {
        if (electron_1.Notification.isSupported())
            new electron_1.Notification({ title, body }).show();
    }
    catch {
        /* Benachrichtigungen sind Beiwerk, nie kritisch */
    }
}
function setupAutoUpdater() {
    electron_updater_1.autoUpdater.autoDownload = true;
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
    electron_updater_1.autoUpdater.logger = null;
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        logToFile(`update-available ${info.version}`);
        if (manualCheck)
            notify('Update wird geladen', `Version ${info.version} wird im Hintergrund geladen.`);
    });
    electron_updater_1.autoUpdater.on('update-not-available', () => {
        logToFile('update-not-available');
        if (manualCheck) {
            manualCheck = false;
            void electron_1.dialog.showMessageBox({
                type: 'info',
                title: 'Kein Update',
                message: `SelfManaged ${electron_1.app.getVersion()} ist bereits aktuell.`,
                buttons: ['OK'],
            });
        }
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        updateReady = info.version;
        logToFile(`update-downloaded ${info.version}`);
        buildMenu(); // Menue zeigt jetzt "Update installieren und neu starten"
        void electron_1.dialog
            .showMessageBox({
            type: 'info',
            title: 'Update bereit',
            message: `Version ${info.version} ist bereit.`,
            detail: 'Jetzt neu starten oder beim naechsten Beenden automatisch installieren.',
            buttons: ['Jetzt neu starten', 'Spaeter'],
            defaultId: 1,
            cancelId: 1,
        })
            .then((res) => {
            if (res.response === 0)
                electron_updater_1.autoUpdater.quitAndInstall();
        });
    });
    electron_updater_1.autoUpdater.on('error', (err) => {
        logToFile(`update-error ${String(err)}`);
        if (manualCheck) {
            manualCheck = false;
            void electron_1.dialog.showMessageBox({
                type: 'warning',
                title: 'Update-Pruefung fehlgeschlagen',
                message: 'Die Update-Pruefung hat nicht geklappt.',
                detail: String(err),
                buttons: ['OK'],
            });
        }
    });
    // Verzoegert pruefen, damit der Start nicht ausgebremst wird. Im Dev-Betrieb
    // (unpackaged) gibt es keine Update-Metadaten -> gar nicht erst versuchen.
    if (electron_1.app.isPackaged) {
        setTimeout(() => {
            void electron_updater_1.autoUpdater.checkForUpdates().catch((e) => logToFile(`update-check failed ${String(e)}`));
        }, UPDATE_CHECK_DELAY_MS);
    }
}
function checkForUpdatesManually() {
    if (updateReady) {
        electron_updater_1.autoUpdater.quitAndInstall();
        return;
    }
    if (!electron_1.app.isPackaged) {
        void electron_1.dialog.showMessageBox({
            type: 'info',
            title: 'Nach Updates suchen',
            message: 'Update-Pruefung gibt es nur in der installierten App.',
            buttons: ['OK'],
        });
        return;
    }
    manualCheck = true;
    void electron_updater_1.autoUpdater.checkForUpdates().catch((e) => logToFile(`manual update-check failed ${String(e)}`));
}
function buildMenu() {
    const template = [
        {
            label: 'Datei',
            submenu: [
                {
                    label: 'Server ändern…',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            stopPolling();
                            showFallback(mainWindow, 'change');
                        }
                    },
                },
                { type: 'separator' },
                {
                    label: updateReady
                        ? `Update ${updateReady} installieren und neu starten`
                        : 'Nach Updates suchen...',
                    click: checkForUpdatesManually,
                },
                { label: `Version ${electron_1.app.getVersion()}`, enabled: false },
                { type: 'separator' },
                { role: 'quit', label: 'Beenden' },
            ],
        },
        { label: 'Bearbeiten', role: 'editMenu' },
        { label: 'Ansicht', role: 'viewMenu' },
        { label: 'Fenster', role: 'windowMenu' },
    ];
    electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
}
function createWindow() {
    const win = new electron_1.BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 900,
        minHeight: 600,
        title: 'SelfManaged',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    mainWindow = win;
    // DevTools only for a plain dev run — E2E sets TM_USER_DATA_DIR (and usually
    // TM_DESKTOP_PORT/URL); an open DevTools window breaks Playwright's firstWindow().
    if (!electron_1.app.isPackaged &&
        !process.env.TM_DESKTOP_PORT &&
        !process.env.TM_DESKTOP_URL &&
        !process.env.TM_USER_DATA_DIR)
        win.webContents.openDevTools();
    // Open external links in the OS browser, not Electron.
    win.webContents.setWindowOpenHandler(({ url }) => {
        void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    // Server died between health check and load (or a mid-session reload failed):
    // back to the fallback page and keep polling instead of a white screen.
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
        if (!isMainFrame || code === -3 /* ERR_ABORTED: our own navigation */)
            return;
        if (!url.startsWith('http'))
            return; // ignore the file:// fallback itself
        logToFile(`did-fail-load ${code} ${desc} ${url}`);
        showFallback(win, 'error');
        startPolling(win);
    });
    win.on('closed', () => {
        stopPolling();
        if (mainWindow === win)
            mainWindow = null;
    });
    return win;
}
async function main() {
    currentTarget = resolveTarget();
    logToFile(`start pid=${process.pid} packaged=${electron_1.app.isPackaged} target=${currentTarget}`);
    buildMenu();
    setupAutoUpdater();
    const win = createWindow();
    await connectAndLoad(win);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            void connectAndLoad(createWindow());
    });
}
// Single instance: a second launch hands over to the running one and exits.
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
    void electron_1.app.whenReady().then(main);
}
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
