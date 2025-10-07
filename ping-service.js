// scripts/check.js
const fs = require('fs').promises;
const path = require('path');

const SERVICES_FILE = path.join(__dirname, '..', 'services.json');
const STATUS_FILE = path.join(__dirname, '..', 'docs', 'statuses.json');
const MAX_HISTORY_DEFAULT = 100;

async function readJson(file, fallback) {
  try {
    const s = await fs.readFile(file, 'utf8');
    return JSON.parse(s);
  } catch (e) {
    return fallback;
  }
}

async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
}

function nowISO() { return new Date().toISOString(); }

(async () => {
  const services = await readJson(SERVICES_FILE, []);
  const statusData = await readJson(STATUS_FILE, { updatedAt: null, services: [] });
  const now = nowISO();

  const map = new Map(statusData.services.map(s => [s.url, s]));

  for (const svc of services) {
    const url = svc.url;
    const timeoutMs = svc.timeout ?? 10000;
    const keepHistory = svc.keepHistory ?? MAX_HISTORY_DEFAULT;
    const existing = map.get(url) || {
      name: svc.name,
      url,
      status: 'unknown',
      statusCode: null,
      responseTimeMs: null,
      lastChecked: null,
      history: []
    };

    let status = 'down';
    let statusCode = null;
    let responseTimeMs = null;

    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      const start = Date.now();
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      responseTimeMs = Date.now() - start;
      clearTimeout(id);
      statusCode = res.status;
      status = (statusCode >= 200 && statusCode < 400) ? 'up' : 'down';
    } catch (err) {
      status = 'down';
    }

    existing.history = existing.history || [];
    existing.history.unshift({
      ts: now,
      status,
      statusCode,
      responseTimeMs
    });
    existing.history = existing.history.slice(0, keepHistory);

    existing.status = status;
    existing.statusCode = statusCode;
    existing.responseTimeMs = responseTimeMs;
    existing.lastChecked = now;
    existing.name = svc.name || existing.name;

    const upCount = existing.history.reduce((a,h) => a + (h.status === 'up' ? 1 : 0), 0);
    existing.uptimePercent = Math.round((upCount / existing.history.length) * 100);

    map.set(url, existing);
  }

  const ordered = services.map(s => map.get(s.url));
  const out = {
    updatedAt: now,
    services: ordered
  };

  await writeJson(STATUS_FILE, out);
  console.log('Wrote statuses to', STATUS_FILE);
})();
