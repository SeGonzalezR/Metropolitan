// Vista pública: lista de espera, inscripción y canciones pedidas.

let state = null;
let clockOffset = 0; // diferencia entre el reloj del servidor y el del teléfono
let mine = store.get('karaoke.mine', []); // [{ id, token }]
let deviceId = store.get('karaoke.device', null);
if (!deviceId) {
  deviceId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
  store.set('karaoke.device', deviceId);
}
let lastAlert = store.get('karaoke.alert', {}); // { [id]: 'soon' | 'next' | 'singing' }

const now = () => Date.now() + clockOffset;
const isMine = (id) => mine.some((m) => m.id === id);

// ---------- Cálculo de espera ----------

// Cuántas personas antes que tú activan el aviso "prepárate".
const SOON_AHEAD = 2;

// Lo que falta para que termine el turno en curso (canción + cambio de pista).
function remainingCurrent() {
  const turn = state.turnSeconds;
  const extra = state.delay ? state.delay.extraSeconds : 0;
  if (!state.nowSinging) return state.queue.length ? 60 + extra : 0; // el DJ está preparando al siguiente
  const elapsed = (now() - state.nowSinging.startedAt) / 1000;
  // si el turno se alarga, asumimos que todavía queda al menos 1 minuto
  return Math.max(60, turn - elapsed) + extra;
}

// segundos estimados hasta que le toque a la persona en la posición `i` (0 = siguiente)
function waitFor(i) {
  return remainingCurrent() + i * state.turnSeconds;
}

const DELAY_NOTE = '⏳ El DJ está preparando la pista (buscando la versión o configurando). La lista puede atrasarse unos minutos.';

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
  const pct = Math.min(100, (elapsed / state.turnSeconds) * 100);
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
          <p class="turn-big">¡Te toca! 🎤</p>
          <p>El DJ te está llamando al escenario para cantar <strong>${esc(state.nowSinging.song)}</strong></p>
        </div>`);
      notify(m.id, 'singing', '¡Te toca! El DJ te está llamando 🎤');
      continue;
    }
    const i = state.queue.findIndex((q) => q.id === m.id);
    if (i === -1) continue;
    const e = state.queue[i];
    const wait = waitFor(i);
    const stage = i === 0 ? 'next' : i <= SOON_AHEAD ? 'soon' : 'wait';
    if (stage === 'next') notify(m.id, 'next', '¡Eres el siguiente! El DJ te llamará pronto');
    else if (stage === 'soon') notify(m.id, 'soon', 'Prepárate: ya casi es tu turno');

    const title = {
      next: '¡Eres el siguiente!',
      soon: 'Prepárate, ya casi',
      wait: `Vas en el puesto #${i + 1}`,
    }[stage];
    const eta = {
      next: 'El DJ te llamará en cualquier momento. <strong>Acércate al escenario</strong> y ten tu canción lista.',
      soon: `Te toca <strong>${fmtRange(wait)}</strong>, aprox. Quédate cerca del escenario: el DJ te llamará pronto.`,
      wait: `Te toca <strong>${fmtRange(wait)}</strong>, aprox.`,
    }[stage];
    cards.push(`
      <div class="turn ${stage}">
        <div class="turn-row">
          <div class="turn-pos">
            <span class="num">${i}</span>
            <span class="lbl">${i === 1 ? 'persona<br>antes' : 'personas<br>antes'}</span>
          </div>
          <div class="turn-info">
            <p class="turn-title">${title}</p>
            <p class="turn-song">${esc(e.song)}${e.artist ? ` · ${esc(e.artist)}` : ''}</p>
            ${e.needsDownload ? '<p class="turn-note">🔎 No estaba en el catálogo: el DJ la está consiguiendo</p>' : ''}
            <p class="turn-eta">${eta}</p>
          </div>
        </div>
        ${state.delay ? `<p class="turn-delay">${DELAY_NOTE}</p>` : ''}
        ${stage === 'wait' && !state.delay ? '<p class="turn-fine">El tiempo es aproximado: depende de cada canción y de lo que tarde el DJ en prepararla. Te avisaremos cuando falte poco.</p>' : ''}
        <button class="link" data-cancel="${esc(m.id)}">Cancelar</button>
      </div>`);
  }

  el.hidden = cards.length === 0;
  el.innerHTML = cards.join('');
}

function renderQueue() {
  const q = state.queue;
  $('#queue-meta').textContent = q.length
    ? `${q.length} en espera · ≈ ${Math.round(state.turnSeconds / 60)} min por turno`
    : '';
  const delayEl = $('#queue-delay');
  delayEl.hidden = !state.delay || !q.length;
  delayEl.textContent = DELAY_NOTE;
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
        <span class="eta">${i === 0 ? 'Sigue' : fmtApprox(waitFor(i))}</span>
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
  const approx = !wait ? 'Ya' : fmtApprox(wait) === 'pronto' ? 'Pronto' : fmtApprox(wait).replace('≈ ', '≈');
  el.innerHTML = `
    <div class="hint-row">
      <div><span class="num">${n}</span><span class="lbl">${n === 1 ? 'persona' : 'personas'} antes</span></div>
      <div><span class="num">${approx}</span><span class="lbl">espera aproximada</span></div>
    </div>
    <p class="hint-fine">Es una estimación: puede variar según cada canción y la preparación del DJ.</p>
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
    : `<li class="empty">${term ? 'Nadie la ha pedido esta noche.' : 'Aún no se ha pedido ninguna canción.'}</li>`;
}

function render() {
  if (!state) return;
  // limpia inscripciones propias que ya terminaron
  const active = new Set([state.nowSinging && state.nowSinging.id, ...state.queue.map((e) => e.id)]);
  for (const m of mine) {
    const sungEntry = state.history.find((e) => e.id === m.id);
    if (sungEntry) justSang(sungEntry);
  }
  const before = mine.length;
  mine = mine.filter((m) => active.has(m.id));
  if (mine.length !== before) store.set('karaoke.mine', mine);

  renderMine();
  renderNow();
  renderQueue();
  renderJoinHint();
  renderSongs();
  renderReview();
  if (info.version !== state.infoVersion) loadInfo();
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
  for (const v of ['queue', 'join', 'songs', 'menu']) $(`#view-${v}`).hidden = v !== view;
  document.body.dataset.page = view;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', async (ev) => {
  const tab = ev.target.closest('.tabs [data-view]');
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


// ---------- Carta (PDF) ----------

let info = { version: null, reviewUrl: '', menuPdf: null };
let infoLoading = false;

async function loadInfo() {
  if (infoLoading) return;
  infoLoading = true;
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    info = await r.json();
    renderMenu();
    renderReview();
  } catch {
  } finally {
    infoLoading = false;
  }
}

function renderMenu() {
  const pdf = info.menuPdf;
  $('#menu').innerHTML = pdf
    ? `
      <svg class="menu-ico" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 6h18l8 8v28H12z"/><path d="M30 6v8h8M18 22h12M18 28h12M18 34h8"/></svg>
      <p class="menu-title">Nuestra carta</p>
      <p class="muted">Cócteles, cervezas y algo para picar mientras esperas tu turno.</p>
      <a class="btn primary" href="${esc(pdf.url)}" target="_blank" rel="noopener">Ver la carta</a>
      <p class="muted small">PDF · ${fmtSize(pdf.size)} · actualizada el ${new Date(pdf.updatedAt).toLocaleDateString('es-CL')}</p>`
    : `<p class="menu-title">La carta estará disponible pronto</p><p class="muted">Mientras tanto, pregunta en la barra 🍸</p>`;
}

// ---------- Reseñas en Google ----------
// Se invita a todos por igual: Google no permite elegir a quién pedirle reseña
// según si quedó contento o no.

const REVIEW_SNOOZE_MS = 12 * 60 * 60 * 1000; // "Ahora no": no volver a preguntar esta noche
const REVIEW_DONE_MS = 60 * 24 * 60 * 60 * 1000; // ya fue a dejarla: no insistir en 60 días
let sang = store.get('karaoke.sang', null); // { id, name, song, at }
let reviewState = store.get('karaoke.review', {}); // { snoozedAt, clickedAt }

function justSang(entry) {
  if (sang && sang.id === entry.id) return;
  sang = { id: entry.id, name: entry.name, song: entry.song, at: Date.now() };
  store.set('karaoke.sang', sang);
}

const GOOGLE_G =
  '<svg viewBox="0 0 24 24" class="g" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z" fill="#4285F4"/><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z" fill="#34A853"/><path d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z" fill="#FBBC05"/><path d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z" fill="#EA4335"/></svg>';

function reviewCard(title, text, where) {
  return `
    <div class="stars" aria-hidden="true">★★★★★</div>
    <p class="review-title">${title}</p>
    <p class="muted">${text}</p>
    <div class="review-actions">
      <a class="btn primary" href="${esc(info.reviewUrl)}" target="_blank" rel="noopener" data-review-go>
        <span class="g-wrap">${GOOGLE_G}</span> Dejar reseña en Google
      </a>
      ${where === 'prompt' ? '<button class="btn" data-review-later>Ahora no</button>' : ''}
    </div>`;
}

function renderReview() {
  const hasUrl = !!info.reviewUrl;
  const now = Date.now();
  const clickedRecently = reviewState.clickedAt && now - reviewState.clickedAt < REVIEW_DONE_MS;
  const snoozed = reviewState.snoozedAt && now - reviewState.snoozedAt < REVIEW_SNOOZE_MS;
  const recentSong = sang && now - sang.at < 4 * 60 * 60 * 1000;

  const prompt = $('#review-prompt');
  const showPrompt = !!(hasUrl && recentSong && !clickedRecently && !snoozed);
  prompt.hidden = !showPrompt;
  if (showPrompt)
    prompt.innerHTML = reviewCard(
      `¡Bien cantado, ${esc(sang.name)}! 👏`,
      '¿Cómo lo estás pasando en Metropolitan? Tu opinión en Google nos ayuda muchísimo a que más gente nos conozca.',
      'prompt'
    );

  const stat = $('#review-static');
  stat.hidden = !hasUrl;
  if (hasUrl)
    stat.innerHTML = reviewCard(
      clickedRecently ? '¡Gracias por tu reseña!' : '¿Te gustó la noche?',
      clickedRecently
        ? 'Si quieres actualizarla o agregar fotos, puedes volver cuando quieras.'
        : 'Déjanos tu opinión en Google: toma menos de un minuto.',
      'menu'
    );
}

document.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-review-go]')) {
    reviewState.clickedAt = Date.now();
    store.set('karaoke.review', reviewState);
    setTimeout(renderReview, 500);
  } else if (ev.target.closest('[data-review-later]')) {
    reviewState.snoozedAt = Date.now();
    store.set('karaoke.review', reviewState);
    renderReview();
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
