#!/usr/bin/env node
// Sube el catálogo de VirtualDJ al portal. Pensado para correr en el PC del bar.
//
//   node scripts/sync-catalog.js --url https://mi-portal.com --pin 4821
//   node scripts/sync-catalog.js --file "D:\Karaoke\lista.m3u" --all --watch
//
// Opciones:
//   --url      URL del portal (por defecto http://localhost:3000)
//   --pin      PIN del KJ (o variable ADMIN_PIN)
//   --file     Archivo a subir (por defecto Documentos/VirtualDJ/database.xml)
//   --all      Incluir todas las canciones, no solo las pistas de karaoke
//   --merge    Agregar al catálogo actual en vez de reemplazarlo
//   --watch    Quedarse vigilando el archivo y volver a subirlo cuando cambie

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

function defaultDatabase() {
  const candidates = [
    path.join(os.homedir(), 'Documents', 'VirtualDJ', 'database.xml'),
    path.join(os.homedir(), 'Documentos', 'VirtualDJ', 'database.xml'),
    path.join(os.homedir(), 'Library', 'Application Support', 'VirtualDJ', 'database.xml'),
  ];
  return candidates.find((f) => fs.existsSync(f)) || candidates[0];
}

const url = opt('url', 'http://localhost:3000').replace(/\/$/, '');
const pin = opt('pin', process.env.ADMIN_PIN || '');
const file = opt('file', defaultDatabase());

if (!pin) {
  console.error('Falta el PIN: usa --pin 1234 o la variable ADMIN_PIN');
  process.exit(1);
}

async function upload() {
  if (!fs.existsSync(file)) {
    console.error(`No encontré ${file}. Indícalo con --file "ruta"`);
    return false;
  }
  const params = new URLSearchParams({ mode: flag('merge') ? 'merge' : 'replace', karaokeOnly: flag('all') ? '0' : '1' });
  const started = Date.now();
  try {
    const r = await fetch(`${url}/api/admin/catalog?${params}`, {
      method: 'POST',
      headers: { 'X-Admin-Pin': pin, 'Content-Type': 'text/plain' },
      body: fs.readFileSync(file),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    console.log(
      `[${new Date().toLocaleTimeString('es-CL')}] ✓ ${body.total} canciones en el catálogo (${body.read} leídas, ${body.format}, ${Date.now() - started} ms)` +
        (body.resolved ? ` · ${body.resolved} pedido(s) ahora disponibles` : '')
    );
    return true;
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString('es-CL')}] ✗ No se pudo subir: ${e.message}`);
    return false;
  }
}

(async () => {
  console.log(`Catálogo: ${file}\nPortal:   ${url}`);
  const ok = await upload();
  if (!flag('watch')) process.exit(ok ? 0 : 1);
  console.log('Vigilando cambios (Ctrl+C para salir)…');
  let timer;
  fs.watchFile(file, { interval: 15000 }, () => {
    clearTimeout(timer);
    timer = setTimeout(upload, 5000); // VirtualDJ escribe el archivo en varias pasadas
  });
})();
