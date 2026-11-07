# 🎤 Metropolitan Karaoke

Mini portal mobile para el karaoke del bar. Los clientes escanean un QR y desde el teléfono pueden:

- **Ver quién está cantando ahora** (canción, artista, mesa y cuánto lleva en el escenario).
- **Inscribirse** con su nombre, canción, artista y mesa (antes de enviar ven cuántas personas hay antes y la espera estimada).
- **Ver la lista de espera**: posición, nombre, canción y en cuánto tiempo le toca a cada uno.
- **Seguir su propio turno**: una tarjeta fija arriba muestra cuántas personas tienen antes, la espera estimada y la hora aproximada. Cuando son los siguientes o les toca, el teléfono vibra y aparece un aviso.
- **Ver todas las canciones de la noche** (sonando, por venir y ya cantadas) con buscador.
- **Cancelar** su inscripción si se tienen que ir.

Todo se actualiza en tiempo real (Server-Sent Events), sin recargar la página.

La espera se calcula con la duración promedio real de las últimas canciones de la noche (4 min por defecto hasta que haya historial).

## Panel del KJ

En `/admin` (protegido con PIN) quien maneja el karaoke puede:

- Pasar al **siguiente cantante** con un botón grande.
- Subir/bajar pedidos, poner a alguien **ahora**, **saltar** (y devolver a la cola) o eliminar.
- **Abrir/cerrar inscripciones**.
- Reiniciar la noche.

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

Los datos se guardan en un archivo JSON, así que la cola sobrevive a reinicios del servidor. Sirve en cualquier hosting con Node (Railway, Render, Fly.io, un VPS o un PC del bar en la red local). Para el uso en el local, imprime un QR que apunte a la URL pública.

## Límites anti-abuso

- Máximo 2 canciones pendientes por teléfono.
- Nombre ≤ 30 caracteres, canción ≤ 80, artista ≤ 60.
