# RS Weekly Report

Aplicación web en Next.js para visualizar historial de vehículos usando archivos JSON locales (`drives/`), con:

- Selección de vehículo por dropdown.
- Filtros por tipo de evento y rango de fecha/hora.
- Lista scrolleable de eventos `Conducir` / `Detener`.
- Mapa Google Maps en la misma página.
- Trazado vial usando **Routes API (new)** mediante endpoint server-side.

## Requisitos

- Node.js 20+ (recomendado 22)
- pnpm 10+
- API key de Google con acceso a:
- `Maps JavaScript API`
- `Routes API`

## Instalación

```bash
pnpm install
```

## Variables de entorno

Crear archivo `.env` en la raíz:

```env
GOOGLE_API_KEY=tu_api_key
```

Notas:

- La key se usa en servidor (`app/api/routes/route.ts`) para llamar Routes API.
- También se pasa al cliente para cargar Google Maps JS.
- Si restringes la key por API, debes permitir al menos `Maps JavaScript API` y `Routes API`.

## Ejecutar en desarrollo

```bash
pnpm dev
```

App disponible en `http://localhost:3000`.

## Scripts

- `pnpm dev`: servidor de desarrollo.
- `pnpm build`: build de producción.
- `pnpm start`: iniciar build de producción.
- `pnpm lint`: validación ESLint.

## Estructura principal

- `app/page.tsx`: carga y normaliza los JSON desde `drives/`.
- `app/_components/history-dashboard.tsx`: UI, filtros, lista de eventos y mapa.
- `app/api/routes/route.ts`: proxy server para `routes.googleapis.com/directions/v2:computeRoutes`.
- `app/globals.css`: estilos globales y layout.
- `drives/*.json`: fuente de datos por vehículo.

## Formato de datos esperado

Cada archivo JSON en `drives/` representa un vehículo y contiene filas de eventos en:

- `items[0].table.rows`

Campos usados por la app:

- `group_key` (`drive` | `stop`)
- `status`
- `start_at`, `end_at`
- `duration`, `distance`
- `speed_max`, `speed_avg`
- `location` (URL con coordenadas `q=lat,lng`)

Si un JSON no tiene eventos o viene con error, la UI lo maneja mostrando estado sin romper la página.

## Cómo funciona el trazado vial

1. Se generan puntos de ruta desde eventos filtrados.
2. El cliente envía tramos a `POST /api/routes`.
3. El backend llama **Routes API (new)** con `computeRoutes`.
4. Se devuelve `encodedPolyline` y el cliente la decodifica/dibuja.

## Troubleshooting

### Error en consola `POST /api/routes 502`

Suele ocurrir cuando Google rechaza la request. Revisa:

- `GOOGLE_API_KEY` correcta.
- `Routes API` habilitada en Google Cloud.
- Billing activo.
- Restricciones de API key (servicios permitidos, referrers/IPs).

### Error `API_KEY_SERVICE_BLOCKED` / `PERMISSION_DENIED`

La key no tiene permitido `routes.googleapis.com`. Habilita `Routes API` y ajusta restricciones de la key.

### El build falla por fuentes de Google

Si no hay salida a internet, `next/font/google` puede fallar al descargar fuentes (por ejemplo Geist).

## Validación local recomendada

```bash
pnpm lint
pnpm build
```
