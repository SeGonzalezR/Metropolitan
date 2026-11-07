// Utilidades compartidas entre la vista pública y el panel del KJ.

const $ = (sel, root = document) => root.querySelector(sel);

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

// Los tiempos del karaoke nunca son exactos: el DJ puede demorarse buscando la
// versión correcta o configurando la pista. Por eso mostramos rangos redondeados
// a 5 minutos y no horas exactas.
const round5 = (min, fn) => Math.max(5, fn(min / 5) * 5);

// "entre 15 y 25 min", "en unos minutos", "más de 1 hora"
function fmtRange(seconds) {
  const m = seconds / 60;
  if (m < 6) return 'en unos minutos';
  const low = round5(m * 0.8, Math.floor);
  const high = Math.max(low + 5, round5(m * 1.2, Math.ceil));
  if (low >= 60) return 'en más de 1 hora';
  return `entre ${low} y ${high} min`;
}

// Versión corta para listas: "≈ 20 min", "pronto"
function fmtApprox(seconds) {
  const m = seconds / 60;
  if (m < 6) return 'pronto';
  if (m >= 60) return '+1 h';
  return `≈ ${round5(m, Math.round)} min`;
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function fmtSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Conexión en tiempo real con reconexión automática y respaldo por sondeo.
function connectLive(onState) {
  const live = $('#live');
  let es;
  let pollTimer;
  const setLive = (ok) => live && live.classList.toggle('off', !ok);

  const poll = async () => {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      onState(await r.json());
      setLive(true);
    } catch {
      setLive(false);
    }
  };

  if ('EventSource' in window) {
    es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      setLive(true);
      onState(JSON.parse(ev.data));
    };
    es.onerror = () => setLive(false);
  } else {
    poll();
    pollTimer = setInterval(poll, 5000);
  }

  // Al volver a la pestaña (el teléfono estuvo bloqueado) refrescamos de inmediato.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') poll();
  });
  return { refresh: poll, close: () => (es && es.close(), clearInterval(pollTimer)) };
}

// ---------- Tema claro / oscuro ----------
(function initTheme() {
  const btn = document.getElementById('theme-toggle');
  const meta = document.querySelector('meta[name="theme-color"]');
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    if (meta) meta.content = t === 'light' ? '#f5f0e6' : '#131010';
    if (btn) btn.setAttribute('aria-label', t === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  };
  apply(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  if (btn)
    btn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      apply(next);
      try {
        localStorage.setItem('karaoke.theme', next); // texto plano: lo lee el script del <head>
      } catch {}
    });
})();
