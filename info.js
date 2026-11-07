// Información del local: carta y enlace para dejar reseñas en Google.
// Se edita desde el panel del KJ y se guarda en data/info.json.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Carta de ejemplo para que el portal no parta vacío. Se muestra marcada como
// "ejemplo" hasta que alguien la guarde desde el panel.
const EXAMPLE_MENU = {
  note: 'Precios en pesos chilenos, IVA incluido.',
  categories: [
    {
      name: 'Coctelería clásica',
      items: [
        { name: 'Pisco Sour', desc: 'Pisco, limón de pica, jarabe de goma y clara.', price: 5500 },
        { name: 'Mojito', desc: 'Ron blanco, menta, limón y soda.', price: 6000 },
        { name: 'Negroni', desc: 'Gin, Campari y vermut rosso.', price: 6500 },
        { name: 'Old Fashioned', desc: 'Bourbon, angostura y piel de naranja.', price: 7000 },
      ],
    },
    {
      name: 'Combinados',
      items: [
        { name: 'Piscola', desc: 'Pisco 35° con bebida a elección.', price: 5000 },
        { name: 'Ron Cola', desc: '', price: 5000 },
        { name: 'Gin Tonic', desc: 'Con pepino o frutos rojos.', price: 6000 },
      ],
    },
    {
      name: 'Cervezas',
      items: [
        { name: 'Schop 500 cc', desc: 'Lager o IPA, según disponibilidad.', price: 3500 },
        { name: 'Cerveza artesanal 330 cc', desc: '', price: 4000 },
      ],
    },
    {
      name: 'Para picar',
      items: [
        { name: 'Papas fritas', desc: 'Con salsas de la casa.', price: 4500 },
        { name: 'Tabla Metropolitan', desc: 'Quesos, embutidos, aceitunas y pan (para 2–3).', price: 12900 },
        { name: 'Empanaditas de queso (6)', desc: '', price: 5500 },
      ],
    },
    {
      name: 'Sin alcohol',
      items: [
        { name: 'Bebidas y jugos', desc: '', price: 2500 },
        { name: 'Limonada menta jengibre', desc: '', price: 3500 },
        { name: 'Mocktail del día', desc: 'Pregunta en la barra.', price: 4500 },
      ],
    },
  ],
};

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const newId = () => crypto.randomBytes(5).toString('hex');

function sanitizeMenu(menu) {
  const cats = Array.isArray(menu && menu.categories) ? menu.categories : [];
  return {
    note: clean(menu && menu.note, 200),
    categories: cats.slice(0, 30).map((c) => ({
      id: clean(c.id, 20) || newId(),
      name: clean(c.name, 50) || 'Sin nombre',
      items: (Array.isArray(c.items) ? c.items : [])
        .slice(0, 80)
        .map((it) => {
          const price = Math.round(Number(String(it.price ?? '').replace(/[^\d]/g, '')));
          return {
            id: clean(it.id, 20) || newId(),
            name: clean(it.name, 60),
            desc: clean(it.desc, 160),
            price: Number.isFinite(price) && price > 0 ? Math.min(price, 10_000_000) : null,
            available: it.available !== false,
          };
        })
        .filter((it) => it.name),
    })),
  };
}

// Solo enlaces https (p. ej. https://g.page/r/XXXX/review o
// https://search.google.com/local/writereview?placeid=XXXX).
function sanitizeUrl(v) {
  const s = clean(v, 500);
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

class Info {
  constructor(file) {
    this.file = file;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.menu = sanitizeMenu(saved.menu);
      this.reviewUrl = sanitizeUrl(saved.reviewUrl) || '';
      this.example = false;
      this.version = saved.version || 1;
    } catch {
      this.menu = sanitizeMenu(EXAMPLE_MENU);
      this.reviewUrl = '';
      this.example = true;
      this.version = 1;
    }
  }

  public() {
    return { menu: this.menu, reviewUrl: this.reviewUrl, example: this.example, version: this.version };
  }

  // Devuelve un mensaje de error o null si se guardó.
  update({ menu, reviewUrl }) {
    const url = sanitizeUrl(reviewUrl);
    if (url === null) return 'El enlace de reseñas debe ser una URL que empiece con https://';
    this.menu = sanitizeMenu(menu);
    this.reviewUrl = url;
    this.example = false;
    this.version += 1;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data = { version: this.version, reviewUrl: this.reviewUrl, menu: this.menu };
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
    return null;
  }
}

module.exports = { Info };
