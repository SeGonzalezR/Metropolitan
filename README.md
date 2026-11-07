# 🎤 Metropolitan Karaoke

Mini portal mobile para el karaoke del bar. Los clientes escanean un QR y desde el teléfono pueden:

- **Ver quién está cantando ahora** (canción, artista, mesa y cuánto lleva en el escenario).
- **Inscribirse** con su nombre, canción, artista y mesa (antes de enviar ven cuántas personas hay antes y la espera estimada).
- **Ver la lista de espera**: posición, nombre, canción y en cuánto tiempo le toca a cada uno.
- **Seguir su propio turno**: una tarjeta fija arriba muestra cuántas personas tienen antes, la espera estimada y la hora aproximada. Cuando son los siguientes o les toca, el teléfono vibra y aparece un aviso.
- **Ver todas las canciones de la noche** (sonando, por venir y ya cantadas) con buscador.
- **Cancelar** su inscripción si se tienen que ir.
- **Ver la carta** del local (PDF) desde la pestaña *Carta*.
- **Dejar una reseña en Google** con un botón que abre directo la página de reseñas del local. Justo después de cantar se le invita una vez («¡Bien cantado!»); si toca «Ahora no» no se le vuelve a preguntar esa noche, y si ya fue a dejarla no se insiste por 60 días. La invitación es igual para todos: Google no permite pedir reseñas solo a quienes quedaron contentos.
- **Buscar en el catálogo del bar** mientras escriben la canción (sugerencias al instante, sin importar tildes) o explorarlo desde la pestaña *Canciones* con un botón «Pedir». Si la canción no está, igual pueden pedirla: queda marcada para que el DJ la consiga y el cliente ve el aviso «el DJ la está consiguiendo».

Todo se actualiza en tiempo real (Server-Sent Events), sin recargar la página.

La espera se calcula con la duración promedio real de las últimas canciones de la noche (4 min por defecto hasta que haya historial).

## Panel del KJ

En `/admin` (protegido con PIN) quien maneja el karaoke puede:

- Pasar al **siguiente cantante** con un botón grande.
- Subir/bajar pedidos, poner a alguien **ahora**, **saltar** (y devolver a la cola) o eliminar.
- **Abrir/cerrar inscripciones**.
- Ver la sección **🔎 Por conseguir** con los pedidos que no están en el catálogo (botón para buscarlos en YouTube y «✓ Ya la tengo»).
- Ver la **ruta del archivo** en el PC de cada pedido que sí está en el catálogo, para encontrarlo rápido en VirtualDJ.
- **Cargar el catálogo** subiendo el archivo de VirtualDJ.
- Subir o cambiar la **carta en PDF** y guardar el **enlace de reseñas de Google** (sección *Carta y reseñas*). Los cambios aparecen al instante en los teléfonos.
- Reiniciar la noche.

## Catálogo de VirtualDJ

VirtualDJ guarda toda su biblioteca en `database.xml`:

- Windows: `Documentos\VirtualDJ\database.xml`
- macOS: `~/Library/Application Support/VirtualDJ/database.xml` (o `~/Documents/VirtualDJ`)

Hay dos formas de cargarlo:

1. **A mano:** en `/admin` › *Catálogo*, sube el archivo (también acepta listas `.m3u` exportadas desde VirtualDJ o un `.txt` con una línea `Artista - Título` por canción).
2. **Automático (recomendado):** en el PC del bar, deja corriendo

   ```bash
   node scripts/sync-catalog.js --url https://tu-portal.com --pin 4821 --watch
   ```

   Sube el catálogo y lo vuelve a subir cada vez que VirtualDJ actualiza su base de datos (por ejemplo, cuando el DJ agrega una canción descargada). Los pedidos «por conseguir» que aparezcan en el catálogo nuevo se marcan como disponibles solos.

Por defecto solo se importan **pistas de karaoke** (ruta o género que contenga «karaoke», o archivos `.cdg`/`.kfn`), para no sugerir canciones de la biblioteca de música normal. Se puede desactivar con la casilla del panel o con `--all` en el script.

Si un archivo no tiene tags, el título y artista se sacan del nombre (`SC8123-05 - Maná - Corazón Espinado.cdg` → *Maná – Corazón Espinado*).

## Carta y reseñas

- **Carta:** en `/admin` › *Carta y reseñas* › **Subir PDF** (máx. 25 MB). Se guarda en `data/carta.pdf` y se sirve en `/carta.pdf`; al cambiarla, los teléfonos ven la nueva al instante. Mientras no haya PDF, la pestaña dice «disponible pronto».
- **Reseñas:** en el Perfil de Empresa de Google del local entra a *Pedir reseñas* y copia el enlace (del tipo `https://g.page/r/…/review`). También sirve `https://search.google.com/local/writereview?placeid=TU_PLACE_ID`. Si el campo queda vacío, el botón de reseñas no se muestra.

## Diseño y colores

Estilo clásico de bar: tipografía serif (Playfair Display) para títulos, acento bronce y burdeo. **Modo oscuro por defecto**, con un botón ☾/☀ en el encabezado para cambiar a modo claro; la elección queda guardada en cada teléfono.

Para usar los colores del bar, edita las variables al inicio de `public/styles.css`:

- `--accent`: color principal (botones, números destacados) y `--accent-ink` para el texto encima.
- `--accent-2`: color secundario (tu turno, etiqueta «Tú») y `--accent-2-ink`.
- El bloque `:root` es el modo oscuro y `[data-theme='light']` el modo claro.

El logo está en `public/icon.svg` (se puede reemplazar por el del bar).

## Cómo correrlo

Requiere Node.js 18+ y no tiene dependencias.

```bash
ADMIN_PIN=4821 npm start
# http://localhost:3000        → sitio público
# http://localhost:3000/admin  → panel KJ
```

Variables de entorno:

| Variable    | Por defecto     | Descripción                          |
|-------------|-----------------|--------------------------------------|
| `PORT`      | `3000`          | Puerto HTTP                          |
| `ADMIN_PIN` | `1234`          | PIN del panel KJ (**cámbialo**)      |
| `DATA_FILE` | `data/db.json`  | Archivo donde se guarda la cola      |
| `CATALOG_FILE` | `data/catalog.json` | Archivo donde se guarda el catálogo |

Los datos se guardan en un archivo JSON, así que la cola sobrevive a reinicios del servidor. Sirve en cualquier hosting con Node (Railway, Render, Fly.io, un VPS o un PC del bar en la red local). Para el uso en el local, imprime un QR que apunte a la URL pública.

## Límites anti-abuso

- Máximo 2 canciones pendientes por teléfono.
- Nombre ≤ 30 caracteres, canción ≤ 80, artista ≤ 60.
