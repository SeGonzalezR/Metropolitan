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
  return `
    <li class="row">
      ${kind === 'queued' ? `<span class="pos">${i + 1}</span>` : ''}
      <div class="row-main">
        <p class="row-song strong">${esc(e.song)}</p>
        <p class="muted">${meta}</p>
      </div>
      <div class="actions">${actions.join('')}</div>
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
       <div class="actions" style="margin-top:10px">
         <button data-id="${esc(s.id)}" data-action="done">Terminó</button>
         <button data-id="${esc(s.id)}" data-action="requeue">Devolver a la cola</button>
       </div>`
    : `<p class="eyebrow">Escenario</p><p class="now-empty">Nadie cantando</p>`;

  const next = state.queue[0];
  $('#next').textContent = next ? `Siguiente: ${next.name} ▶` : s ? 'Terminar canción actual' : 'Cola vacía';
  $('#next').disabled = !next && !s;

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

if (pin) start().catch(() => logout());
setInterval(tick, 1000);
