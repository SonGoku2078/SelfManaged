import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { db } from './db';
import { PORT, lanIPv4, publicAddress, isLoopback } from './lan';
import tasksRouter from './routes/tasks';
import calendarRouter from './routes/calendar';
import projectsRouter from './routes/projects';
import categoriesRouter from './routes/categories';
import membersRouter from './routes/members';
import sectionsRouter from './routes/sections';
import blockersRouter from './routes/blockers';
import savedViewsRouter from './routes/savedViews';
import activityLogRouter from './routes/activityLog';
import settingsRouter from './routes/settings';
import adminRouter from './routes/admin';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
// Method-override tunnel: the Android widget's HttpURLConnection can't send
// PATCH, so it POSTs with this header instead (#30).
app.use((req, _res, next) => {
  const override = req.header('x-http-method-override');
  if (override && req.method === 'POST') req.method = override.toUpperCase();
  next();
});

// API routes
app.get('/health', (_req, res) => res.json({ ok: true }));
// Erreichbare Adresse(n) fuer die Handy-Einrichtung. `host`/`baseUrl` kommen
// aus der Anfrage und stimmen deshalb auch im Container (#79); `ips` bleibt als
// Zusatz erhalten (im Docker-Betrieb sind das Bridge-Adressen, ausserhalb die
// echten LAN-IPs).
app.get('/api/lan', (req, res) => {
  const addr = publicAddress(req);
  // Interface-Adressen nur, wenn die Anfrage ueber localhost kam — sonst sind
  // es im Container Bridge-IPs (172.x), die kein Handy erreicht.
  const ips = isLoopback(addr.hostname) ? lanIPv4() : [];
  res.json({
    port: PORT,
    host: addr.hostname,
    baseUrl: addr.baseUrl,
    ips,
    urls: [addr.baseUrl],
  });
});
app.use('/api/tasks',        tasksRouter);
app.use('/api/projects',     projectsRouter);
app.use('/api/categories',   categoriesRouter);
app.use('/api/members',      membersRouter);
app.use('/api/sections',     sectionsRouter);
app.use('/api/blockers',     blockersRouter);
app.use('/api/saved-views',  savedViewsRouter);
app.use('/api/activity-log', activityLogRouter);
app.use('/api/settings',     settingsRouter);
// DEV-only admin actions (PROD→DEV data import, #29).
app.use('/api/admin',        adminRouter);
// ICS feed + feed-info (registers /calendar/:token.ics and /api/calendar-feed;
// must come before the SPA fallback below, or .ics requests get index.html).
app.use(calendarRouter);

// Test-case database for the 🧪 Testreport view (pre-deploy approval page).
// Lives in docs/testcases.json at the repo root, updated by test runs.
app.get('/api/testreport', async (_req, res) => {
  try {
    const { readFile } = await import('node:fs/promises');
    const file = path.join(__dirname, '..', '..', 'docs', 'testcases.json');
    res.type('application/json').send(await readFile(file, 'utf8'));
  } catch {
    res.status(404).json({ error: 'docs/testcases.json nicht gefunden' });
  }
});

// One-time localStorage → SQLite migration.
app.post('/api/migrate', async (req, res) => {
  try {
    const already = (db.prepare("SELECT value FROM settings WHERE key='migrated'").get() as { value: string } | undefined)?.value;
    if (already === '1') return res.status(409).json({ error: 'Already migrated. Delete ~/.task-manager/data.db to re-run.' });
    const { runMigration } = await import('./migrate');
    const count = runMigration(db, req.body);
    return res.json({ ok: true, tasks: count });
  } catch (e) {
    console.error('Migration error:', e);
    return res.status(500).json({ error: String(e) });
  }
});

// Serve compiled frontend in production (vite build --outDir ../public).
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  const index = path.join(publicDir, 'index.html');
  res.sendFile(index, (err) => {
    if (err) res.status(404).send('Frontend not built yet. Run: npm run build in the root.');
  });
});

const server = app.listen(PORT, () => {
  console.log(`SelfManaged server running at http://localhost:${PORT}`);
  for (const ip of lanIPv4()) console.log(`  LAN (mobile): http://${ip}:${PORT}`);
});

// A busy port must end in a clear message, not an uncaught-exception crash
// (#55 — the old in-process Electron server died silently on exactly this).
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`FEHLER: Port ${PORT} ist bereits belegt – läuft der Server schon? Beende.`);
  } else {
    console.error('FEHLER beim Serverstart:', err);
  }
  process.exit(1);
});
