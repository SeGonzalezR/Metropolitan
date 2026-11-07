// Catálogo de canciones disponibles en el VirtualDJ del bar.
//
// Se importa desde:
//   - database.xml de VirtualDJ (Documentos/VirtualDJ/database.xml)
//   - listas M3U / M3U8 exportadas desde VirtualDJ
//   - texto plano o CSV: una canción por línea, "Artista - Título" (o "Artista;Título")
//
// La búsqueda ignora mayúsculas, tildes y signos de puntuación.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KARAOKE_RE = /karaoke|\.(cdg|kfn|kar)$/i;
const AUDIO_VIDEO_RE = /\.(mp3|mp4|m4a|aac|wav|flac|ogg|wma|cdg|zip|kfn|kar|avi|mkv|mov|mpg|mpeg|webm|vdjstems)$/i;

function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

function decodeXml(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    return String.fromCodePoint(parseInt(k.slice(1), 10));
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? decodeXml(m[1]).trim() : '';
}

// "SC8123-05 - Soda Stereo - Persiana Americana [Karaoke].mp3" → { artist, title }
function fromFilename(filePath) {
  let base = path.basename(String(filePath).replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  base = base
    .replace(/[\[(][^\])]*(karaoke|instrumental|version|vocal|kara)[^\])]*[\])]/gi, '')
    .replace(/_/g, ' ')
    .trim();
  let parts = base.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  // descarta códigos de disco tipo "SF001-01", "SC8123-05", "01"
  while (parts.length > 2 && /^[A-Z]{0,5}\d[\w-]*$/i.test(parts[0])) parts.shift();
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: base };
}

function cleanTitle(t) {
  return String(t ?? '')
    .replace(/[\[(][^\])]*(karaoke|instrumental|kara)[^\])]*[\])]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Parsers ----------

function parseVdjDatabase(xml) {
  const songs = [];
  const re = /<Song\b([^>]*)>([\s\S]*?)<\/Song>|<Song\b([^>]*)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const head = m[1] || m[3] || '';
    const inner = m[2] || '';
    const filePath = attr(head, 'FilePath');
    const tags = (inner.match(/<Tags\b[^>]*>/i) || [''])[0];
    const fromFile = fromFilename(filePath);
    songs.push({
      title: cleanTitle(attr(tags, 'Title')) || cleanTitle(fromFile.title),
      artist: attr(tags, 'Author') || fromFile.artist,
      genre: attr(tags, 'Genre'),
      path: filePath,
    });
  }
  return songs;
}

function parseM3u(text) {
  const songs = [];
  let pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const label = line.replace(/^#EXTINF:[^,]*,/, '');
      const [artist, ...rest] = label.split(' - ');
      pending = rest.length ? { artist: artist.trim(), title: rest.join(' - ').trim() } : { artist: '', title: label.trim() };
      continue;
    }
    if (line.startsWith('#')) continue;
    const info = pending && pending.title ? pending : fromFilename(line);
    songs.push({ title: cleanTitle(info.title), artist: info.artist, genre: '', path: line });
    pending = null;
  }
  return songs;
}

function parseText(text) {
  const songs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (AUDIO_VIDEO_RE.test(line)) {
      const info = fromFilename(line);
      songs.push({ title: cleanTitle(info.title), artist: info.artist, genre: '', path: line });
      continue;
    }
    const cols = line.split(/\s*[;\t]\s*/);
    if (cols.length >= 2) {
      songs.push({ artist: cols[0], title: cleanTitle(cols[1]), genre: cols[2] || '', path: '' });
    } else {
      const [artist, ...rest] = line.split(/\s+-\s+/);
      songs.push(
        rest.length
          ? { artist: artist.trim(), title: cleanTitle(rest.join(' - ')), genre: '', path: '' }
          : { artist: '', title: cleanTitle(line), genre: '', path: '' }
      );
    }
  }
  return songs;
}

function parseAny(text) {
  if (/<VirtualDJ_Database|<Song\b/i.test(text.slice(0, 5000))) return { format: 'VirtualDJ database.xml', songs: parseVdjDatabase(text) };
  if (/^﻿?#EXTM3U/.test(text)) return { format: 'M3U', songs: parseM3u(text) };
  return { format: 'texto', songs: parseText(text) };
}

// ---------- Catálogo ----------

class Catalog {
  constructor(file) {
    this.file = file;
    this.songs = [];
    this.updatedAt = null;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.songs = saved.songs || [];
      this.updatedAt = saved.updatedAt || null;
    } catch {}
    this.index();
  }

  index() {
    this.byId = new Map();
    this.byKey = new Map();
    for (const s of this.songs) {
      s._t = normalize(s.title);
      s._a = normalize(s.artist);
      s._all = `${s._t} ${s._a}`;
      this.byId.set(s.id, s);
      this.byKey.set(`${s._a}|${s._t}`, s);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const clean = this.songs.map(({ _t, _a, _all, ...s }) => s);
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ updatedAt: this.updatedAt, songs: clean }));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  // Importa texto (xml/m3u/txt). mode: 'replace' | 'merge'
  import(text, { mode = 'replace', karaokeOnly = false } = {}) {
    const { format, songs } = parseAny(text);
    let list = songs.filter((s) => s.title);
    if (karaokeOnly) list = list.filter((s) => KARAOKE_RE.test(s.path) || /karaoke/i.test(s.genre));
    const merged = new Map(mode === 'merge' ? this.songs.map((s) => [`${s._a}|${s._t}`, s]) : []);
    for (const s of list) {
      const key = `${normalize(s.artist)}|${normalize(s.title)}`;
      if (!key.replace('|', '') || merged.has(key)) continue;
      merged.set(key, {
        id: crypto.createHash('sha1').update(key).digest('hex').slice(0, 12),
        title: s.title.slice(0, 120),
        artist: (s.artist || '').slice(0, 80),
        path: s.path || '',
      });
    }
    this.songs = [...merged.values()].sort((a, b) => a.artist.localeCompare(b.artist, 'es') || a.title.localeCompare(b.title, 'es'));
    this.updatedAt = Date.now();
    this.index();
    this.save();
    return { format, read: songs.length, total: this.songs.length };
  }

  clear() {
    this.songs = [];
    this.updatedAt = Date.now();
    this.index();
    this.save();
  }

  get(id) {
    return this.byId.get(id) || null;
  }

  // Coincidencia exacta (ignorando tildes/mayúsculas) para pedidos escritos a mano.
  match(title, artist) {
    const t = normalize(title);
    const a = normalize(artist);
    if (!t) return null;
    if (a && this.byKey.has(`${a}|${t}`)) return this.byKey.get(`${a}|${t}`);
    if (!a) {
      const hits = this.songs.filter((s) => s._t === t);
      if (hits.length === 1) return hits[0];
    }
    return null;
  }

  search(q, limit = 8) {
    const words = normalize(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const results = [];
    for (const s of this.songs) {
      const hay = ` ${s._all}`;
      if (!words.every((w) => hay.includes(` ${w}`))) continue;
      // ranking: título empieza con la búsqueda > palabras al inicio del título > resto
      const qn = words.join(' ');
      let score = 0;
      if (s._t.startsWith(qn)) score += 100;
      else if (` ${s._t}`.includes(` ${qn}`)) score += 60;
      if (s._a.startsWith(qn)) score += 40;
      score += words.filter((w) => ` ${s._t}`.includes(` ${w}`)).length * 10;
      score -= s._t.length / 100;
      results.push([score, s]);
    }
    return results
      .sort((a, b) => b[0] - a[0])
      .slice(0, limit)
      .map(([, s]) => ({ id: s.id, title: s.title, artist: s.artist }));
  }

  get size() {
    return this.songs.length;
  }
}

module.exports = { Catalog, normalize, parseAny, fromFilename };
