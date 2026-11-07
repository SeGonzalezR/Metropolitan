// Panel del KJ: avanzar la cola, reordenar, saltar y cerrar inscripciones.

let pin = store.get('karaoke.pin', '');
let state = null;
let live = null;

async function api(path, method = 'POST') {
  const r = await fetch(`/api/admin/${path}`, { method, headers: { 'X-Admin-Pin': pin } });
  const body = await r.json().catch(() => ({}));
  if (r.status === 401) {
    logout();
    throw new Error('PIN incorrecto');
  }
  if (!r.ok) throw new Error(body.error || 'Error');
  return body;
}

async function load() {
  state = await api('state', 'GET');
  render();
}

function entryRow(e, i, kind) {
  const meta = `${e.artist ? esc(e.artist) + ' · ' : ''}${esc(e.name)}${e.table ? ` · Mesa ${esc(e.table)}` : ''}`;
  const btn = (action, label, cls = '') => `<button class="${cls}" data-id="${esc(e.id)}" data-action="${action}" aria-label="${action}">${label}</button>`;
  const actions = {
    queued: [btn('sing', '🎤 Ahora'), btn('up', '▲'), btn('down', '▼'), btn('skip', 'Saltar'), btn('remove', '✕', 'danger')],
    skipped: [btn('requeue', 'Volver a la cola'), btn('remove', '✕', 'danger')],
    done: [btn('requeue', 'Otra vez')],
  }[kind];
  const status = e.needsDownload
    ? ' <span class="tag missing-tag">Por conseguir</span>'
    : '';
  return `
    <li class="row ${e.needsDownload && kind === 'queued' ? 'missing' : ''}">
      ${kind === 'queued' ? `<span class="pos">${i + 1}</span>` : ''}
      <div class="row-main">
        <p class="row-song strong">${esc(e.song)}${status}</p>
        <p class="muted">${meta}</p>
        ${e.path ? `<p class="path">${esc(e.path)}</p>` : ''}
      </div>
      <div class="actions">${actions.join('')}</div>
    </li>`;
}

function missingRow(e) {
  const pos = state.queue.findIndex((q) => q.id === e.id);
  const q = encodeURIComponent(`${e.artist} ${e.song} karaoke`.trim());
  return `
    <li class="row missing">
      <div class="row-main">
        <p class="row-song strong">${esc(e.song)}</p>
        <p class="muted">${e.artist ? esc(e.artist) + ' · ' : ''}${esc(e.name)} · ${pos >= 0 ? `puesto #${pos + 1}` : 'cantando'}</p>
      </div>
      <div class="actions">
        <a class="btn small" target="_blank" rel="noopener"
           href="https://www.youtube.com/results?search_query=${q}">Buscar</a>
        <button data-id="${esc(e.id)}" data-action="found">✓ Ya la tengo</button>
      </div>
    </li>`;
}

function render() {
  const s = state.nowSinging;
  $('#now').innerHTML = s
    ? `<p class="eyebrow"><span class="eq"><i></i><i></i><i></i></span> Cantando ahora</p>
       <p class="now-song">${esc(s.song)}</p>
       <p class="now-artist">${esc(s.artist || '')}</p>
       <p class="now-singer">${esc(s.name)}${s.table ? ` <span class="tag">Mesa ${esc(s.table)}</span>` : ''}</p>
       <p class="muted small" id="elapsed"></p>
       <div class="actions actions-gap">
         <button data-id="${esc(s.id)}" data-action="done">Terminó</button>
         <button data-id="${esc(s.id)}" data-action="requeue">Devolver a la cola</button>
       </div>`
    : `<p class="eyebrow">Escenario</p><p class="now-empty">Nadie cantando</p>`;

  const next = state.queue[0];
  $('#next').textContent = next ? `Siguiente: ${next.name} ▶` : s ? 'Terminar canción actual' : 'Cola vacía';
  $('#next').disabled = !next && !s;

  const missing = [state.nowSinging, ...state.queue].filter((e) => e && e.needsDownload);
  $('#missing-box').hidden = !missing.length;
  $('#missing-meta').textContent = `${missing.length} pendiente${missing.length === 1 ? '' : 's'}`;
  $('#missing').innerHTML = missing.map(missingRow).join('');
  $('#catalog-meta').textContent = state.catalog.size
    ? `${state.catalog.size.toLocaleString('es-CL')} canciones · ${new Date(state.catalog.updatedAt).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'vacío';

  $('#toggle').innerHTML = state.signupsOpen ? 'Cerrar inscripciones' : '<span class="pill-closed">● Cerradas</span> · Abrir';
  $('#queue-meta').textContent = `${state.queue.length} en espera`;
  $('#queue').innerHTML = state.queue.map((e, i) => entryRow(e, i, 'queued')).join('') || '<li class="empty">Sin pedidos.</li>';
  $('#skipped').innerHTML = state.skipped.map((e, i) => entryRow(e, i, 'skipped')).join('') || '<li class="empty">—</li>';
  $('#history').innerHTML = state.history.map((e, i) => entryRow(e, i, 'done')).join('') || '<li class="empty">—</li>';
  tick();
}

function tick() {
  const el = $('#elapsed');
  if (el && state.nowSinging) el.textContent = `${fmtElapsed((Date.now() - state.nowSinging.startedAt) / 1000)} en el escenario`;
}

async function run(fn) {
  try {
    await fn();
    await load();
  } catch (e) {
    toast(e.message);
  }
}

document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const { id, action } = b.dataset;
  if (action === 'remove' && !confirm('¿Eliminar este pedido?')) return;
  run(() => api(`entries/${encodeURIComponent(id)}/${action}`));
});
$('#next').addEventListener('click', () => run(() => api('next')));
$('#toggle').addEventListener('click', () => run(() => api('toggle')));
$('#reset').addEventListener('click', () => {
  if (confirm('Esto borra la cola y el historial de la noche. ¿Continuar?')) run(() => api('reset'));
});
$('#logout').addEventListener('click', logout);

// ---------- Carga del catálogo ----------

async function uploadCatalog(file) {
  if (!file) return;
  const out = $('#catalog-result');
  out.textContent = `Subiendo ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)…`;
  const params = new URLSearchParams({
    mode: $('#merge').checked ? 'merge' : 'replace',
    karaokeOnly: $('#karaoke-only').checked ? '1' : '0',
  });
  try {
    const r = await fetch(`/api/admin/catalog?${params}`, {
      method: 'POST',
      headers: { 'X-Admin-Pin': pin, 'Content-Type': 'text/plain' },
      body: file,
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'Error al importar');
    out.textContent =
      `✓ ${body.format}: ${body.read.toLocaleString('es-CL')} archivos leídos → ${body.total.toLocaleString('es-CL')} canciones en el catálogo.` +
      (body.resolved ? ` ${body.resolved} pedido(s) por conseguir ahora están disponibles.` : '') +
      (body.total === 0 && $('#karaoke-only').checked ? ' Prueba desmarcando «Solo pistas de karaoke».' : '');
    await load();
  } catch (e) {
    out.textContent = e.message;
  }
}

$('#catalog-file').addEventListener('change', (ev) => uploadCatalog(ev.target.files[0]));
const drop = $('#drop');
drop.addEventListener('dragover', (ev) => {
  ev.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  drop.classList.remove('over');
  uploadCatalog(ev.dataTransfer.files[0]);
});

function logout() {
  pin = '';
  store.set('karaoke.pin', '');
  live && live.close();
  live = null;
  $('#panel').hidden = true;
  $('#login').hidden = false;
}

async function start() {
  await load();
  loadInfoEditor().catch(() => {});
  $('#login').hidden = true;
  $('#panel').hidden = false;
  // cualquier cambio (p. ej. una inscripción nueva) recarga la vista completa del KJ
  live = connectLive(() => load().catch(() => {}));
}

$('#login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  pin = ev.target.pin.value;
  $('#login-error').textContent = '';
  try {
    await start();
    store.set('karaoke.pin', pin);
  } catch (e) {
    $('#login-error').textContent = e.message;
  }
});


// ---------- Carta y reseñas ----------

let draft = null; // copia editable { reviewUrl, menu: { note, categories } }
let dirty = false;
let savedExample = false;

const uid = () => Math.random().toString(36).slice(2, 10);

async function loadInfoEditor(force = false) {
  if (dirty && !force) return; // no pisar cambios sin guardar
  const r = await fetch('/api/info', { cache: 'no-store' });
  const data = await r.json();
  savedExample = data.example;
  draft = { reviewUrl: data.reviewUrl, menu: JSON.parse(JSON.stringify(data.menu)) };
  setDirty(false);
  renderEditor();
}

function setDirty(v) {
  dirty = v;
  $('#dirty').textContent = v ? 'Cambios sin guardar' : '';
  $('#info-status').textContent = savedExample
    ? '⚠ carta de ejemplo: edítala'
    : `${draft.menu.categories.reduce((n, c) => n + c.items.length, 0)} productos${draft.reviewUrl ? ' · reseñas ✓' : ''}`;
}

function renderEditor() {
  $('#review-url').value = draft.reviewUrl || '';
  $('#menu-note').value = draft.menu.note || '';
  $('#menu-editor').innerHTML = draft.menu.categories
    .map(
      (c, ci) => `
    <fieldset class="ed-cat">
      <div class="ed-cat-head">
        <input class="ed-cat-name" data-ci="${ci}" data-f="name" value="${esc(c.name)}" aria-label="Nombre de la categoría" />
        <div class="actions">
          <button type="button" data-ed="cat-up" data-ci="${ci}" aria-label="Subir categoría">▲</button>
          <button type="button" data-ed="cat-down" data-ci="${ci}" aria-label="Bajar categoría">▼</button>
          <button type="button" class="danger" data-ed="cat-del" data-ci="${ci}" aria-label="Eliminar categoría">✕</button>
        </div>
      </div>
      ${c.items
        .map(
          (it, ii) => `
        <div class="ed-item ${it.available ? '' : 'off'}">
          <div class="ed-row">
            <input data-ci="${ci}" data-ii="${ii}" data-f="name" value="${esc(it.name)}" placeholder="Producto" aria-label="Producto" />
            <input class="ed-price" data-ci="${ci}" data-ii="${ii}" data-f="price" value="${it.price ?? ''}" inputmode="numeric" placeholder="$" aria-label="Precio" />
          </div>
          <input data-ci="${ci}" data-ii="${ii}" data-f="desc" value="${esc(it.desc)}" placeholder="Descripción (opcional)" aria-label="Descripción" />
          <div class="actions">
            <button type="button" data-ed="toggle" data-ci="${ci}" data-ii="${ii}">${it.available ? 'Marcar agotado' : '✓ Hay de nuevo'}</button>
            <button type="button" data-ed="item-up" data-ci="${ci}" data-ii="${ii}" aria-label="Subir">▲</button>
            <button type="button" data-ed="item-down" data-ci="${ci}" data-ii="${ii}" aria-label="Bajar">▼</button>
            <button type="button" class="danger" data-ed="item-del" data-ci="${ci}" data-ii="${ii}" aria-label="Eliminar producto">✕</button>
          </div>
        </div>`
        )
        .join('')}
      <button type="button" class="btn small" data-ed="item-add" data-ci="${ci}">＋ Producto</button>
    </fieldset>`
    )
    .join('');
}

const swap = (arr, i, j) => {
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
};

$('#info-editor').addEventListener('input', (ev) => {
  const t = ev.target;
  if (!draft) return;
  if (t.id === 'review-url') draft.reviewUrl = t.value;
  else if (t.id === 'menu-note') draft.menu.note = t.value;
  else if (t.dataset.f) {
    const cat = draft.menu.categories[Number(t.dataset.ci)];
    if (t.dataset.ii === undefined) cat[t.dataset.f] = t.value;
    else cat.items[Number(t.dataset.ii)][t.dataset.f] = t.value;
  } else return;
  setDirty(true);
});

$('#info-editor').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-ed]');
  if (!b) return;
  const cats = draft.menu.categories;
  const ci = Number(b.dataset.ci);
  const ii = Number(b.dataset.ii);
  const items = cats[ci] && cats[ci].items;
  switch (b.dataset.ed) {
    case 'cat-up': swap(cats, ci, ci - 1); break;
    case 'cat-down': swap(cats, ci, ci + 1); break;
    case 'cat-del':
      if (!confirm(`¿Eliminar la categoría «${cats[ci].name}» y sus productos?`)) return;
      cats.splice(ci, 1);
      break;
    case 'item-add': items.push({ id: uid(), name: '', desc: '', price: null, available: true }); break;
    case 'item-up': swap(items, ii, ii - 1); break;
    case 'item-down': swap(items, ii, ii + 1); break;
    case 'item-del': items.splice(ii, 1); break;
    case 'toggle': items[ii].available = !items[ii].available; break;
  }
  setDirty(true);
  renderEditor();
  if (b.dataset.ed === 'item-add') {
    const inputs = document.querySelectorAll(`[data-ci="${ci}"][data-f="name"][data-ii]`);
    inputs[inputs.length - 1].focus();
  }
});

$('#add-cat').addEventListener('click', () => {
  draft.menu.categories.push({ id: uid(), name: 'Nueva categoría', items: [] });
  setDirty(true);
  renderEditor();
  const names = document.querySelectorAll('.ed-cat-name');
  names[names.length - 1].select();
});

$('#save-info').addEventListener('click', async () => {
  const btn = $('#save-info');
  btn.disabled = true;
  try {
    const r = await fetch('/api/admin/info', {
      method: 'PUT',
      headers: { 'X-Admin-Pin': pin, 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || 'No se pudo guardar');
    savedExample = false;
    draft = { reviewUrl: body.reviewUrl, menu: body.menu };
    setDirty(false);
    renderEditor();
    toast('Carta guardada ✓ (ya se ve en los teléfonos)');
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});

window.addEventListener('beforeunload', (ev) => {
  if (dirty) ev.preventDefault();
});

if (pin) start().catch(() => logout());
setInterval(tick, 1000);
