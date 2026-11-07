// Vista pública: lista de espera, inscripción y canciones pedidas.

let state = null;
let clockOffset = 0; // diferencia entre el reloj del servidor y el del teléfono
let mine = store.get('karaoke.mine', []); // [{ id, token }]
let deviceId = store.get('karaoke.device', null);
if (!deviceId) {
  deviceId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  store.set('karaoke.device', deviceId);
}
let lastAlert = store.get('karaoke.alert', {}); // { [id]: 'next' | 'singing' }

const now = () => Date.now() + clockOffset;
const isMine = (id) => mine.some((m) => m.id === id);

// ---------- Cálculo de espera ----------

function remainingCurrent() {
  if (!state.nowSinging) return 0;
  const elapsed = (now() - state.nowSinging.startedAt) / 1000;
  // si la canción se alarga, asumimos que queda al menos ~30 s
  return Math.max(30, state.avgSongSeconds - elapsed);
}

// segundos estimados hasta que le toque a la persona en la posición `i` (0 = siguiente)
function waitFor(i) {
  return remainingCurrent() + i * state.avgSongSeconds;
}

// ---------- Render ----------

function renderNow() {
  const el = $('#now');
  const s = state.nowSinging;
  if (!s) {
    el.innerHTML = `
      <p class="eyebrow">Escenario</p>
      <p class="now-empty">${state.queue.length ? 'Preparando al siguiente…' : 'El micrófono está libre 🎤'}</p>
      ${state.queue.length ? '' : '<button class="btn primary small" data-go="join">Sé el primero</button>'}`;
    return;
  }
  const elapsed = (now() - s.startedAt) / 1000;
  const pct = Math.min(100, (elapsed / state.avgSongSeconds) * 100);
  el.innerHTML = `
    <p class="eyebrow"><span class="eq"><i></i><i></i><i></i></span> Cantando ahora</p>
    <p class="now-song">${esc(s.song)}</p>
    <p class="now-artist">${esc(s.artist || '')}</p>
    <p class="now-singer">${esc(s.name)}${s.table ? ` <span class="tag">Mesa ${esc(s.table)}</span>` : ''}${
      isMine(s.id) ? ' <span class="tag you">Tú</span>' : ''
    }</p>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <p class="muted small">${fmtElapsed(elapsed)} en el escenario</p>`;
}

function renderMine() {
  const el = $('#mine');
  const cards = [];

  for (const m of mine) {
    if (state.nowSinging && state.nowSinging.id === m.id) {
      cards.push(`
        <div class="turn singing">
          <p class="turn-big">¡Es tu turno! 🎤</p>
          <p>Sube al escenario: <strong>${esc(state.nowSinging.song)}</strong></p>
        </div>`);
      notify(m.id, 'singing', '¡Es tu turno! Sube al escenario 🎤');
      continue;
    }
    const i = state.queue.findIndex((q) => q.id === m.id);
    if (i === -1) continue;
    const e = state.queue[i];
    const wait = waitFor(i);
    const next = i === 0;
    if (next) notify(m.id, 'next', '¡Eres el siguiente! Acércate al escenario');
    cards.push(`
      <div class="turn ${next ? 'next' : ''}">
        <div class="turn-row">
          <div class="turn-pos">
            <span class="num">${i}</span>
            <span class="lbl">${i === 1 ? 'persona<br>antes' : 'personas<br>antes'}</span>
          </div>
          <div class="turn-info">
            <p class="turn-title">${next ? '¡Eres el siguiente!' : `Vas en el puesto #${i + 1}`}</p>
            <p class="turn-song">${esc(e.song)}${e.artist ? ` · ${esc(e.artist)}` : ''}</p>
            ${e.needsDownload ? '<p class="turn-note">🔎 No estaba en el catálogo: el DJ la está consiguiendo</p>' : ''}
            <p class="turn-eta">${next ? 'Acércate al escenario' : `Te toca en <strong>${fmtWait(wait)}</strong> · aprox. ${fmtClock(now() + wait * 1000)}`}</p>
          </div>
        </div>
        <button class="link" data-cancel="${esc(m.id)}">Cancelar</button>
      </div>`);
  }

  el.hidden = cards.length === 0;
  el.innerHTML = cards.join('');
}

function renderQueue() {
  const q = state.queue;
  $('#queue-meta').textContent = q.length
    ? `${q.length} en espera · ~${Math.round(state.avgSongSeconds / 60)} min por canción`
    : '';
  $('#queue').innerHTML = q.length
    ? q
        .map(
          (e, i) => `
      <li class="row ${isMine(e.id) ? 'me' : ''} ${i === 0 ? 'first' : ''}">
        <span class="pos">${i + 1}</span>
        <div class="row-main">
          <p class="row-name">${esc(e.name)}${isMine(e.id) ? ' <span class="tag you">Tú</span>' : ''}</p>
          <p class="row-song">${esc(e.song)}${e.artist ? ` <span class="muted">· ${esc(e.artist)}</span>` : ''}</p>
        </div>
        <span class="eta">${i === 0 ? 'Sigue' : fmtWait(waitFor(i))}</span>
      </li>`
        )
        .join('')
    : `<li class="empty">Nadie en la lista todavía.<br><button class="btn primary small" data-go="join">¡Anótate!</button></li>`;
}

function renderJoinHint() {
  const n = state.queue.length;
  const el = $('#join-hint');
  const form = $('#join');
  if (!state.signupsOpen) {
    el.innerHTML = '<p><strong>Inscripciones cerradas</strong> por el momento. ¡Vuelve a intentar en un rato!</p>';
    form.hidden = true;
    return;
  }
  form.hidden = false;
  const wait = n === 0 && !state.nowSinging ? 0 : waitFor(n);
  el.innerHTML = `
    <div class="hint-row">
      <div><span class="num">${n}</span><span class="lbl">${n === 1 ? 'persona' : 'personas'} antes</span></div>
      <div><span class="num">${wait ? fmtWait(wait).replace('~', '') : 'Ya'}</span><span class="lbl">espera estimada</span></div>
    </div>
    ${state.catalog.size ? `<p class="hint-cat">🎵 Busca entre <strong>${state.catalog.size.toLocaleString('es-CL')}</strong> canciones disponibles en el bar</p>` : ''}`;
}

function renderSongs() {
  const term = $('#song-search').value.trim().toLowerCase();
  const all = [
    ...(state.nowSinging ? [{ ...state.nowSinging, _st: 'now' }] : []),
    ...state.queue.map((e, i) => ({ ...e, _st: 'queued', _pos: i + 1 })),
    ...state.history.map((e) => ({ ...e, _st: 'done' })),
  ];
  $('#songs-meta').textContent = `${state.stats.sungTonight} cantadas · ${state.queue.length} por venir`;
  const list = term
    ? all.filter((e) => `${e.song} ${e.artist} ${e.name}`.toLowerCase().includes(term))
    : all;
  const badge = (e) =>
    e._st === 'now'
      ? '<span class="badge live">Sonando</span>'
      : e._st === 'queued'
        ? `<span class="badge">#${e._pos}</span>`
        : `<span class="badge done">${fmtClock(e.finishedAt)}</span>`;
  $('#songs').innerHTML = list.length
    ? list
        .map(
          (e) => `
      <li class="row ${e._st === 'done' ? 'past' : ''}">
        <div class="row-main">
          <p class="row-song strong">${esc(e.song)}</p>
          <p class="muted">${e.artist ? `${esc(e.artist)} · ` : ''}${esc(e.name)}</p>
        </div>
        ${badge(e)}
      </li>`
        )
        .join('')
    : `<li class="empty">${term ? 'Sin resultados.' : 'Aún no se ha pedido ninguna canción.'}</li>`;
}

function render() {
  if (!state) return;
  // limpia inscripciones propias que ya terminaron
  const active = new Set([state.nowSinging && state.nowSinging.id, ...state.queue.map((e) => e.id)]);
  const before = mine.length;
  mine = mine.filter((m) => active.has(m.id));
  if (mine.length !== before) store.set('karaoke.mine', mine);

  renderMine();
  renderNow();
  renderQueue();
  renderJoinHint();
  renderSongs();
  document.title = state.nowSinging ? `🎤 ${state.nowSinging.song} · Metropolitan` : 'Metropolitan Karaoke';
}

// Aviso con vibración la primera vez que cambia tu estado (siguiente / tu turno).
function notify(id, kind, msg) {
  if (lastAlert[id] === kind) return;
  lastAlert[id] = kind;
  store.set('karaoke.alert', lastAlert);
  toast(msg);
  try {
    navigator.vibrate && navigator.vibrate([200, 100, 200]);
  } catch {}
}

// ---------- Navegación ----------

function go(view) {
  for (const v of ['queue', 'join', 'songs']) $(`#view-${v}`).hidden = v !== view;
  document.body.dataset.view = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('[data-view]');
  if (tab) return go(tab.dataset.view);
  const goBtn = ev.target.closest('[data-go]');
  if (goBtn) return go(goBtn.dataset.go);

  const cancel = ev.target.closest('[data-cancel]');
  if (cancel) {
    const m = mine.find((x) => x.id === cancel.dataset.cancel);
    if (!m || !confirm('¿Seguro que quieres salir de la lista?')) return;
    const r = await fetch(`/api/entries/${encodeURIComponent(m.id)}`, {
      method: 'DELETE',
      headers: { 'X-Entry-Token': m.token },
    });
    if (r.ok) {
      mine = mine.filter((x) => x.id !== m.id);
      store.set('karaoke.mine', mine);
      toast('Saliste de la lista');
      render();
    } else {
      toast((await r.json()).error || 'No se pudo cancelar');
    }
  }
});

$('#song-search').addEventListener('input', () => {
  renderSongs();
  browseCatalog();
});

// ---------- Inscripción ----------

const form = $('#join');
form.name.value = store.get('karaoke.name', '');
form.table.value = store.get('karaoke.table', '');

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = form.querySelector('button');
  const err = $('#join-error');
  err.textContent = '';
  btn.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    const r = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, deviceId }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'No se pudo inscribir');
    mine.push({ id: body.entry.id, token: body.token });
    const missing = body.entry.needsDownload && state && state.catalog.size > 0;
    store.set('karaoke.mine', mine);
    store.set('karaoke.name', data.name);
    store.set('karaoke.table', data.table);
    form.song.value = '';
    form.artist.value = '';
    setPicked(null);
    toast(missing ? '¡Anotado! El DJ va a buscar tu canción 🔎' : '¡Listo! Ya estás en la lista 🎶');
    go('queue');
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- Arranque ----------

connectLive((s) => {
  state = s;
  clockOffset = s.serverTime - Date.now();
  render();
});

// Re-render cada segundo para que el tiempo y las barras avancen solos.
setInterval(() => {
  if (!state || document.hidden) return;
  renderNow();
  renderMine();
}, 1000);
setInterval(() => !document.hidden && render(), 15000);

// ---------- Catálogo: sugerencias al inscribirse ----------

const songInput = form.song;
const suggestEl = $('#suggest');
const noteEl = $('#song-note');
let suggestions = [];
let activeIdx = -1;
let searchSeq = 0;
let searchTimer;

async function searchCatalog(q, limit) {
  const r = await fetch(`/api/catalog?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
  const body = await r.json();
  return (body.results || []).slice(0, limit);
}

function setPicked(song) {
  form.catalogId.value = song ? song.id : '';
  noteEl.className = 'field-note' + (song ? ' ok' : '');
  noteEl.textContent = song ? '✓ Disponible en el bar' : '';
}

function closeSuggest() {
  suggestEl.hidden = true;
  songInput.setAttribute('aria-expanded', 'false');
  activeIdx = -1;
}

function renderSuggest() {
  if (!suggestions.length) return closeSuggest();
  suggestEl.innerHTML = suggestions
    .map(
      (s, i) => `
    <li role="option" data-i="${i}" class="${i === activeIdx ? 'active' : ''}" aria-selected="${i === activeIdx}">
      <span class="sg-title">${esc(s.title)}</span>
      <span class="sg-artist">${esc(s.artist || 'Artista desconocido')}</span>
    </li>`
    )
    .join('');
  suggestEl.hidden = false;
  songInput.setAttribute('aria-expanded', 'true');
}

function pick(song) {
  songInput.value = song.title;
  form.artist.value = song.artist || '';
  setPicked(song);
  suggestions = [];
  closeSuggest();
}

songInput.addEventListener('input', () => {
  setPicked(null);
  const q = songInput.value.trim();
  clearTimeout(searchTimer);
  if (!state || !state.catalog.size || q.length < 2) {
    suggestions = [];
    return closeSuggest();
  }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const results = await searchCatalog(q, 8);
      if (seq !== searchSeq) return; // llegó una respuesta vieja
      suggestions = results;
      activeIdx = -1;
      renderSuggest();
      if (!results.length && q.length >= 3) {
        noteEl.className = 'field-note warn';
        noteEl.textContent = 'No está en el catálogo del bar. Puedes pedirla igual: el DJ intentará conseguirla.';
      }
    } catch {}
  }, 150);
});

songInput.addEventListener('keydown', (ev) => {
  if (suggestEl.hidden) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const n = suggestions.length;
    activeIdx = (activeIdx + (ev.key === 'ArrowDown' ? 1 : -1) + n) % n;
    renderSuggest();
  } else if (ev.key === 'Enter' && activeIdx >= 0) {
    ev.preventDefault();
    pick(suggestions[activeIdx]);
  } else if (ev.key === 'Escape') {
    closeSuggest();
  }
});

// pointerdown + preventDefault: el input no pierde el foco antes de elegir
suggestEl.addEventListener('pointerdown', (ev) => {
  const li = ev.target.closest('li[data-i]');
  if (!li) return;
  ev.preventDefault();
  pick(suggestions[Number(li.dataset.i)]);
});
songInput.addEventListener('blur', () => setTimeout(closeSuggest, 100));

// En el teléfono el teclado tapa media pantalla: subimos el buscador para que
// las sugerencias queden a la vista.
songInput.addEventListener('focus', () => {
  setTimeout(() => {
    const top = songInput.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, 250);
});

// ---------- Catálogo: explorar desde "Canciones" ----------

let browseTimer;
let browseSeq = 0;
let browseResults = [];

function browseCatalog() {
  const q = $('#song-search').value.trim();
  const box = $('#catalog-results');
  clearTimeout(browseTimer);
  if (!state || !state.catalog.size || q.length < 2) {
    box.hidden = true;
    return;
  }
  browseTimer = setTimeout(async () => {
    const seq = ++browseSeq;
    try {
      browseResults = await searchCatalog(q, 8);
    } catch {
      return;
    }
    if (seq !== browseSeq) return;
    box.hidden = false;
    $('#catalog-meta').textContent = `${state.catalog.size.toLocaleString('es-CL')} canciones`;
    $('#catalog-list').innerHTML = browseResults.length
      ? browseResults
          .map(
            (s, i) => `
        <li class="row">
          <div class="row-main">
            <p class="row-song strong">${esc(s.title)}</p>
            <p class="muted">${esc(s.artist || '')}</p>
          </div>
          <button class="btn small primary" data-request="${i}">Pedir</button>
        </li>`
          )
          .join('')
      : '<li class="empty">No está en el catálogo, pero puedes pedirla igual desde «Inscribirme».</li>';
  }, 150);
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-request]');
  if (!b) return;
  pick(browseResults[Number(b.dataset.request)]);
  go('join');
  if (!form.name.value) form.name.focus();
});
