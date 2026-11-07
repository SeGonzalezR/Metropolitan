// Metropolitan Karaoke — servidor mínimo sin dependencias.
// Sirve los archivos de /public, expone una API JSON y empuja cambios en
// tiempo real a todos los teléfonos conectados vía Server-Sent Events.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const DEFAULT_SONG_SECONDS = 240; // 4 min si aún no hay historial
const MAX_ACTIVE_PER_DEVICE = 2; // inscripciones pendientes por teléfono

// ---------- Persistencia ----------

function emptyDb() {
  return { entries: [], signupsOpen: true, seq: 0 };
}

function loadDb() {
  try {
    return { ...emptyDb(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return emptyDb();
  }
}

let db = loadDb();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DATA_FILE);
  }, 100);
}

// ---------- Lógica de la cola ----------

const byOrder = (a, b) => a.order - b.order;
const queued = () => db.entries.filter((e) => e.status === 'queued').sort(byOrder);
const singing = () => db.entries.find((e) => e.status === 'singing') || null;

function avgSongSeconds() {
  const recent = db.entries
    .filter((e) => e.status === 'done' && e.startedAt && e.finishedAt)
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 10)
    .map((e) => (e.finishedAt - e.startedAt) / 1000)
    .filter((s) => s >= 60 && s <= 600); // descarta clics accidentales
  if (!recent.length) return DEFAULT_SONG_SECONDS;
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

function publicEntry(e) {
  const { token, deviceId, ...rest } = e;
  return rest;
}

function publicState() {
  const history = db.entries
    .filter((e) => e.status === 'done')
    .sort((a, b) => b.finishedAt - a.finishedAt)
    .slice(0, 50);
  return {
    serverTime: Date.now(),
    signupsOpen: db.signupsOpen,
    avgSongSeconds: avgSongSeconds(),
    nowSinging: singing() && publicEntry(singing()),
    queue: queued().map(publicEntry),
    history: history.map(publicEntry),
    stats: {
      sungTonight: db.entries.filter((e) => e.status === 'done').length,
    },
  };
}

// ---------- Tiempo real (SSE) ----------

const clients = new Set();

function broadcast() {
  save();
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(payload);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25000);

// ---------- Utilidades HTTP ----------

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
  });
}

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('No encontrado');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function pinOk(req) {
  const given = Buffer.from(String(req.headers['x-admin-pin'] || ''));
  const real = Buffer.from(ADMIN_PIN);
  return given.length === real.length && crypto.timingSafeEqual(given, real);
}

// ---------- Acciones de administración ----------

function startNext() {
  const current = singing();
  if (current) {
    current.status = 'done';
    current.finishedAt = Date.now();
  }
  const next = queued()[0];
  if (next) {
    next.status = 'singing';
    next.startedAt = Date.now();
  }
}

function move(entry, dir) {
  const list = queued();
  const i = list.findIndex((e) => e.id === entry.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i].order, list[j].order] = [list[j].order, list[i].order];
}

const adminActions = {
  next: () => startNext(),
  toggle: () => {
    db.signupsOpen = !db.signupsOpen;
  },
  reset: () => {
    db = { ...emptyDb(), signupsOpen: db.signupsOpen };
  },
};

const entryActions = {
  sing: (e) => {
    const current = singing();
    if (current) {
      // el que estaba cantando vuelve al primer lugar de la cola
      current.status = 'queued';
      current.startedAt = null;
      current.order = Math.min(0, ...queued().map((q) => q.order)) - 1;
    }
    e.status = 'singing';
    e.startedAt = Date.now();
  },
  done: (e) => {
    e.status = 'done';
    e.finishedAt = Date.now();
  },
  skip: (e) => {
    e.status = 'skipped';
    e.finishedAt = Date.now();
  },
  requeue: (e) => {
    e.status = 'queued';
    e.startedAt = null;
    e.order = ++db.seq;
  },
  up: (e) => move(e, -1),
  down: (e) => move(e, 1),
  remove: (e) => {
    db.entries = db.entries.filter((x) => x.id !== e.id);
  },
};

// ---------- Router ----------

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // GET /api/state
  if (req.method === 'GET' && parts[1] === 'state') return send(res, 200, publicState());

  // GET /api/events  (SSE)
  if (req.method === 'GET' && parts[1] === 'events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n');
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // POST /api/signup
  if (req.method === 'POST' && parts[1] === 'signup') {
    if (!db.signupsOpen) return send(res, 409, { error: 'Las inscripciones están cerradas por ahora.' });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return send(res, 400, { error: 'Solicitud inválida.' });
    }
    const name = clean(body.name, 30);
    const song = clean(body.song, 80);
    const artist = clean(body.artist, 60);
    const table = clean(body.table, 10);
    const deviceId = clean(body.deviceId, 64);
    if (!name || !song) return send(res, 400, { error: 'Necesitamos tu nombre y la canción.' });

    const pending = db.entries.filter(
      (e) => deviceId && e.deviceId === deviceId && (e.status === 'queued' || e.status === 'singing')
    );
    if (pending.length >= MAX_ACTIVE_PER_DEVICE) {
      return send(res, 429, {
        error: `Ya tienes ${MAX_ACTIVE_PER_DEVICE} canciones en la lista. Espera a cantar una para pedir otra.`,
      });
    }

    const entry = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(16).toString('hex'),
      deviceId,
      name,
      song,
      artist,
      table,
      status: 'queued',
      order: ++db.seq,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
    };
    db.entries.push(entry);
    broadcast();
    return send(res, 201, { entry: publicEntry(entry), token: entry.token });
  }

  // DELETE /api/entries/:id  (el propio usuario cancela con su token)
  if (req.method === 'DELETE' && parts[1] === 'entries' && parts[2]) {
    const entry = db.entries.find((e) => e.id === parts[2]);
    if (!entry) return send(res, 404, { error: 'No encontrada.' });
    if (entry.token !== req.headers['x-entry-token']) return send(res, 403, { error: 'No autorizado.' });
    if (entry.status !== 'queued') return send(res, 409, { error: 'Ya no se puede cancelar.' });
    entry.status = 'cancelled';
    entry.finishedAt = Date.now();
    broadcast();
    return send(res, 200, { ok: true });
  }

  // /api/admin/...
  if (parts[1] === 'admin') {
    if (!pinOk(req)) return send(res, 401, { error: 'PIN incorrecto.' });
    if (req.method === 'GET' && parts[2] === 'state') {
      const all = db.entries.slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
      return send(res, 200, {
        ...publicState(),
        skipped: all.filter((e) => e.status === 'skipped').map(publicEntry),
      });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido.' });

    // POST /api/admin/:action
    if (parts.length === 3 && adminActions[parts[2]]) {
      adminActions[parts[2]]();
      broadcast();
      return send(res, 200, { ok: true });
    }
    // POST /api/admin/entries/:id/:action
    if (parts[2] === 'entries' && parts[3] && entryActions[parts[4]]) {
      const entry = db.entries.find((e) => e.id === parts[3]);
      if (!entry) return send(res, 404, { error: 'No encontrada.' });
      entryActions[parts[4]](entry);
      broadcast();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'No encontrado.' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((err) => {
      console.error(err);
      send(res, 500, { error: 'Error interno.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método no permitido.' });
  serveStatic(req, res, decodeURIComponent(url.pathname));
});

server.listen(PORT, () => {
  console.log(`🎤 Metropolitan Karaoke en http://localhost:${PORT}`);
  console.log(`   Panel KJ: http://localhost:${PORT}/admin  (PIN: ${ADMIN_PIN === '1234' ? '1234 — ¡cámbialo con ADMIN_PIN!' : 'configurado'})`);
});
