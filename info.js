// Información del local: carta en PDF y enlace para dejar reseñas en Google.
// Se edita desde el panel del KJ. Los datos se guardan en data/info.json y el
// PDF en data/carta.pdf.

const fs = require('fs');
const path = require('path');

const MAX_PDF_BYTES = 25 * 1024 * 1024;

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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
  constructor(dir) {
    this.file = path.join(dir, 'info.json');
    this.pdfFile = path.join(dir, 'carta.pdf');
    this.reviewUrl = '';
    this.menuPdf = null; // { size, updatedAt }
    this.version = 1;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.reviewUrl = sanitizeUrl(saved.reviewUrl) || '';
      this.menuPdf = saved.menuPdf || null;
      this.version = saved.version || 1;
    } catch {}
    if (this.menuPdf && !fs.existsSync(this.pdfFile)) this.menuPdf = null;
  }

  public() {
    return {
      version: this.version,
      reviewUrl: this.reviewUrl,
      // la versión en la URL evita que el teléfono muestre una carta vieja en caché
      menuPdf: this.menuPdf && { ...this.menuPdf, url: `/carta.pdf?v=${this.menuPdf.updatedAt}` },
    };
  }

  persist() {
    this.version += 1;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data = { version: this.version, reviewUrl: this.reviewUrl, menuPdf: this.menuPdf };
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  // Devuelve un mensaje de error o null si se guardó.
  setReviewUrl(value) {
    const url = sanitizeUrl(value);
    if (url === null) return 'El enlace de reseñas debe ser una URL que empiece con https://';
    this.reviewUrl = url;
    this.persist();
    return null;
  }

  setPdf(buffer) {
    if (!buffer || buffer.length < 5 || buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return 'El archivo no es un PDF.';
    }
    if (buffer.length > MAX_PDF_BYTES) return 'El PDF es demasiado grande (máx. 25 MB).';
    fs.mkdirSync(path.dirname(this.pdfFile), { recursive: true });
    fs.writeFileSync(this.pdfFile + '.tmp', buffer);
    fs.renameSync(this.pdfFile + '.tmp', this.pdfFile);
    this.menuPdf = { size: buffer.length, updatedAt: Date.now() };
    this.persist();
    return null;
  }

  removePdf() {
    try {
      fs.unlinkSync(this.pdfFile);
    } catch {}
    this.menuPdf = null;
    this.persist();
  }
}

module.exports = { Info, MAX_PDF_BYTES };
