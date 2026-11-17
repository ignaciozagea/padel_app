# 🏆 Liga de Pádel - Gestión de Torneos y Ligas

<div align="center">
  <img src="https://img.shields.io/badge/Cloudflare_Pages-F38020?style=for-the-badge&logo=cloudflare&logoColor=white"/>
  <img src="https://img.shields.io/badge/Cloudflare_D1-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white"/>
  <img src="https://img.shields.io/badge/JavaScript-ES6-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black"/>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white"/>
  <img src="https://img.shields.io/badge/Responsive-Yes-4ADE80?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/License-MIT-4ADE80?style=for-the-badge"/>
</div>

## 📋 Descripción

Aplicación web completa para la **gestión profesional de ligas y torneos de pádel**. Permite administrar múltiples ligas, generar calendarios automáticos (round-robin), registrar resultados con sistema de puntuación 3/1/0, y organizar torneos de eliminación directa con sorteo aleatorio.

El frontend es HTML/CSS/JavaScript estático y el backend es una API serverless en **Cloudflare Pages Functions** con base de datos **Cloudflare D1** (SQLite).
<br>

### 🎯 Características Principales

- ✅ **Ligas configurables**: Crea, renombra o elimina ligas desde la app (por defecto: Masculino Avanzado, Intermedio, Iniciación y Femenino). Cada liga tiene su enlace (`liga.html?liga=...`)
- ✅ **CRUD completo de equipos**: Añadir, renombrar y eliminar parejas fácilmente
- ✅ **Calendario automático**: Sistema round-robin (todos contra todos)
- ✅ **Resultados al mejor de 3 sets**: Registro detallado por set; solo se aceptan sets reales de pádel (6-0 a 6-4, 7-5 o 7-6)
- ✅ **Súper tie-break opcional**: Cada liga y cada torneo puede jugar el tercer set como súper tie-break (a 10 puntos, diferencia de 2). En la clasificación cuenta como un set y como un juego (1-0)
- ✅ **Corrección de resultados**: Los resultados se pueden corregir o anular (en el torneo, mientras el ganador no haya jugado la ronda siguiente)
- ✅ **Sistema de puntuación 3/1/0**: Victoria 3 pts, Derrota 2-1 → 1 pt, Derrota 2-0 → 0 pts
- ✅ **Clasificación automática con desempates**: Puntos → enfrentamiento directo (empate entre dos) → diferencia de sets → diferencia de juegos → sets a favor
- ✅ **Torneo eliminación directa**: Octavos → Cuartos → Semifinal → Final
- ✅ **Sorteo aleatorio con descansos**: Admite cualquier número de equipos; los descansos avanzan automáticamente
- ✅ **Árbol visual del torneo**: Muestra todas las rondas
- ✅ **Historial de torneos**: Los torneos terminados se archivan con su campeón y subcampeón y se puede consultar su cuadro
- ✅ **Ficha de cada pareja**: Estadísticas, últimos resultados, partidos jugados y pendientes
- ✅ **Compartir por WhatsApp**: Clasificación, jornadas, fichas de pareja y cuadro del torneo en texto listo para pegar (o copiar)
- ✅ **App instalable (PWA)**: Se puede añadir a la pantalla de inicio del móvil y abre sin conexión con los últimos datos guardados
- ✅ **Login seguro**: Contraseña verificada en el servidor, token firmado con caducidad y límite de intentos
- ✅ **Persistencia de datos**: Base de datos Cloudflare D1
- ✅ **Diseño responsive**: Adaptado a móviles, tablets y ordenadores
- ✅ **Glassmorphism moderno**: Efectos visuales atractivos
<br>

## 🚀 Demo

> **URL de producción:** [https://padel-app-401.pages.dev](https://padel-app-401.pages.dev)

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| Administrador | - | `*****` |
| Público | - | Sin autenticación |
<br>

## 📸 Capturas de Pantalla

<div align="center">
  
| Página principal | Clasificación con desempates |
|:---:|:---:|
| ![Página principal](./docs/capturas/index.png) | ![Clasificación](./docs/capturas/liga.png) |

| Calendario | Ficha de pareja |
|:---:|:---:|
| ![Calendario](./docs/capturas/calendario.png) | ![Ficha de pareja](./docs/capturas/ficha_pareja.png) |

| Compartir por WhatsApp | Cuadro del torneo |
|:---:|:---:|
| ![Compartir](./docs/capturas/compartir.png) | ![Torneo](./docs/capturas/torneo.png) |

| Historial de torneos | Gestión de la liga (admin) |
|:---:|:---:|
| ![Historial](./docs/capturas/historial.png) | ![Gestión de la liga](./docs/capturas/gestion_liga.png) |

| Gestión del torneo (admin) | Móvil |
|:---:|:---:|
| ![Gestión del torneo](./docs/capturas/gestion_torneo.png) | <img src="./docs/capturas/movil.png" alt="Móvil" width="260"> |

</div>
<br>

## 🛠️ Tecnologías Utilizadas

| Tecnología | Uso |
|------------|-----|
| HTML5 | Estructura de la aplicación |
| CSS3 | Diseño, animaciones, responsive |
| JavaScript (ES6) | Lógica frontend, peticiones a la API |
| Cloudflare Pages | Hosting del frontend |
| Cloudflare Pages Functions | API serverless (`/api/*`) |
| Cloudflare D1 | Base de datos SQLite |
| Wrangler | CLI de despliegue y desarrollo local |
| Git | Control de versiones |

## 📁 Estructura del Proyecto

```text
padel_app/
|
├──📁 public/                 # Lo único que se publica como web estática
|   ├──📄 index.html          # Página principal (login + navegación)
|   ├──📄 liga.html           # Gestión de ligas
|   ├──📄 torneo.html         # Gestión de torneos
|   ├──📁 js/
|   |   ├──📄 api.js          # Sesión, llamadas a la API y validación (compartido)
|   |   ├──📄 ui.js           # Avisos, ventanas, carga y compartir (compartido)
|   |   ├──📄 index.js
|   |   ├──📄 liga.js
|   |   └──📄 torneo.js
|   ├──📁 css/
|   |   ├──📄 comun.css       # Estilos de los componentes compartidos
|   |   ├──📄 index.css
|   |   ├──📄 liga.css
|   |   └──📄 torneo.css
|   ├──📁 img/icons/          # Iconos de la app (PWA)
|   ├──📄 manifest.webmanifest # Datos para instalar la web como app
|   └──📄 sw.js               # Service worker: funcionamiento sin conexión
|
├──📁 functions/
|   └──📁 api/
|       └──📄 [[path]].js     # API: /api/login, /api/liga, /api/torneo
|
├──📁 migrations/             # Migraciones de la base de datos D1 (se aplican en orden)
|   ├──📄 0001_esquema_inicial.sql
|   ├──📄 0002_equipos_por_id.sql
|   ├──📄 0003_login_intentos.sql
|   ├──📄 0004_historial_torneos.sql
|   ├──📄 0005_ligas.sql
|   └──📄 0006_super_tiebreak.sql
|
├──📁 docs/capturas/          # Capturas de pantalla del README (no se publican)
├──📁 tests/                  # Tests automáticos (node:test + SQLite en memoria)
├──📁 .github/workflows/      # GitHub Actions: ejecuta los tests en cada push y PR
├──📄 package.json            # Script `npm test`
├──📄 wrangler.toml           # Configuración de Cloudflare (producción y previews)
└──📄 README.md               # Documentación
```
<br>

## 🗄️ Base de Datos

El esquema se gestiona con las migraciones de la carpeta [`migrations/`](migrations/). Los partidos referencian a los equipos por **id**, así que una pareja se puede renombrar sin perder sus resultados.

| Tabla | Descripción |
|-------|-------------|
| `ligas` | Ligas disponibles (`slug`, nombre visible, orden y si el tercer set es súper tie-break) |
| `liga_equipos` | Equipos participantes en cada liga |
| `liga_calendario` | Partidos y resultados de las ligas (`local_id`, `visitante_id`) |
| `torneo` | Torneos: el actual (`configuracion` / `activo`) y los archivados en el historial |
| `torneo_equipos` | Equipos inscritos en el torneo |
| `torneo_partidos` | Partidos del torneo por rondas (`equipo1_id`, `equipo2_id`, `ganador_id`) |
| `login_intentos` | Intentos fallidos de login por IP |

La clasificación de la liga y el campeón del torneo no se guardan: se calculan a partir de los resultados, por lo que siempre son coherentes al corregir o anular un partido.
<br>

## 🔌 API

Todas las rutas devuelven JSON con la forma `{ success, data?, error? }`.

| Ruta | Acción | Método | Admin |
|------|--------|--------|:-----:|
| `/api/login` | — | POST | — |
| `/api/liga` | `getLigas`, `getEquipos`, `getCalendario` | GET | ❌ |
| `/api/liga` | `crearLiga`, `renombrarLiga`, `eliminarLiga`, `configurarLiga`, `addEquipo`, `renameEquipo`, `deleteEquipo`, `generarCalendario`, `guardarResultado`, `anularResultado`, `resetLiga` | POST | ✅ |
| `/api/torneo` | `getTorneo` (con `&id=` para un torneo del historial), `getHistorial` | GET | ❌ |
| `/api/torneo` | `addEquipo`, `renameEquipo`, `deleteEquipo`, `crearTorneo`, `guardarPartido`, `anularPartido`, `archivarTorneo`, `configurarTorneo`, `resetTorneo` | POST | ✅ |

La acción se indica con `?action=...`. Las acciones de administrador requieren la cabecera `Authorization: Bearer <token>` obtenida en `/api/login`. `guardarResultado` y `guardarPartido` sirven tanto para registrar un resultado como para corregirlo. `getEquipos` devuelve los equipos ya ordenados por clasificación. `resetTorneo` borra solo el torneo actual; el historial se conserva.

Tras **5 intentos fallidos** de login en 15 minutos, la IP queda bloqueada 15 minutos (respuesta `429` con cabecera `Retry-After`).
<br>

## 🛠️ Instalación y Configuración

### Requisitos Previos

- [Node.js](https://nodejs.org/) 22.13 o superior
- Una cuenta de [Cloudflare](https://dash.cloudflare.com/) (para desplegar)

### Desarrollo Local

```bash
# 1. Clonar el repositorio
git clone https://github.com/ignaciozagea/padel_app.git
cd padel_app

# 2. Crear las tablas en la base de datos local
npx wrangler d1 migrations apply padel-db --local

# 3. Definir la contraseña de administrador para desarrollo
echo "ADMIN_PASSWORD=tu_contraseña" > .dev.vars

# 4. Arrancar el servidor local (frontend + API + D1)
npx wrangler pages dev
# Abrir http://localhost:8788
```

> ⚠️ No subas `.dev.vars` al repositorio.

### Tests

```bash
npm test
```

Prueban la API completa (login y límite de intentos, liga, desempates, torneo, historial), las migraciones (incluida la conversión de datos antiguos) y la validación de resultados del navegador. Usan SQLite en memoria, así que no necesitan Cloudflare ni instalar dependencias. GitHub Actions los ejecuta en cada push a `main` y en cada pull request.

### Despliegue en Cloudflare

```bash
# 1. Crear la base de datos (solo la primera vez) y poner su id en wrangler.toml
npx wrangler d1 create padel-db

# 2. Hacer una copia de seguridad y aplicar las migraciones pendientes
npx wrangler d1 export padel-db --remote --output=backup.sql
npx wrangler d1 migrations apply padel-db --remote

# 3. Configurar la contraseña de administrador como secreto
npx wrangler pages secret put ADMIN_PASSWORD

# 4. Desplegar
npx wrangler pages deploy
```

> ℹ️ La migración `0002` convierte los datos existentes (nombres → ids) sin perderlos. De paso recalcula los puntos de los partidos de liga ya jugados a partir de sus sets, fusiona equipos duplicados y vuelve a crear los equipos que se borraron teniendo partidos.

### Despliegue automático desde GitHub (configuración actual)

El proyecto de Cloudflare Pages está conectado a este repositorio:

| Rama | Despliegue | Base de datos D1 |
|------|------------|------------------|
| `main` | Producción | `padel-db` |
| Cualquier otra | Vista previa (`<rama>.padel-app-401.pages.dev`) | `padel-db-preview` |

Así, probar una rama nunca toca los datos reales. El secreto `ADMIN_PASSWORD` hay que configurarlo en los dos entornos (Production y Preview).

**Cloudflare no aplica las migraciones automáticamente.** Cuando una rama añade una migración:

```bash
# Antes de probar la rama en su vista previa
npx wrangler d1 migrations apply padel-db-preview --remote --env preview

# Al fusionar en main (con copia de seguridad antes)
npx wrangler d1 export padel-db --remote --output=backup.sql
npx wrangler d1 migrations apply padel-db --remote
```
<br>

### 🔐 Seguridad
- ✅ **Autenticación en el servidor**: la contraseña se guarda como secreto de Cloudflare (`ADMIN_PASSWORD`), nunca en el código
- ✅ **Token firmado (HMAC-SHA256)**: caduca a las 8 horas; se guarda en `sessionStorage`
- ✅ **Límite de intentos**: 5 fallos de login en 15 minutos bloquean la IP durante 15 minutos
- ✅ **Acciones protegidas**: toda modificación de datos exige token válido y método POST
- ✅ **Validación**: nombres, ligas y resultados se validan en el servidor
- ✅ **Prepared Statements**: protección contra SQL injection
- ✅ **Escapado de HTML**: protección frente a XSS en nombres de equipos
- ✅ **Sin CORS**: la API solo acepta llamadas desde la propia web
- ✅ **Solo se publica `public/`**: el código de la API, las migraciones y los tests no son descargables
<br>

## 👤 Autor

**Ignacio Zamora Gea**

- GitHub: [@ignaciozagea](https://github.com/ignaciozagea)
- Demo: [https://padel-app-401.pages.dev](https://padel-app-401.pages.dev)
