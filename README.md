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

- ✅ **4 ligas simultáneas**: Masculino Avanzado, Masculino Intermedio, Masculino Iniciación y Femenino
- ✅ **CRUD completo de equipos**: Añadir y eliminar parejas fácilmente
- ✅ **Calendario automático**: Sistema round-robin (todos contra todos)
- ✅ **Resultados al mejor de 3 sets**: Registro detallado por set, validado en cliente y servidor
- ✅ **Sistema de puntuación 3/1/0**: Victoria 3 pts, Derrota 2-1 → 1 pt, Derrota 2-0 → 0 pts
- ✅ **Clasificación automática**: Ordenada por puntos con estadísticas
- ✅ **Torneo eliminación directa**: Octavos → Cuartos → Semifinal → Final
- ✅ **Sorteo aleatorio con descansos**: Admite cualquier número de equipos; los descansos avanzan automáticamente
- ✅ **Árbol visual del torneo**: Muestra todas las rondas
- ✅ **Login seguro**: Contraseña verificada en el servidor y token firmado con caducidad
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
  
| Página Principal | Liga |
|:---:|:---:|
| ![Página Principal](./img/index.png) | ![Liga](./img/liga.png) |

| Torneo | Calendario |
|:---:|:---:|
| ![Torneo](./img/torneo.png) | ![Calendario](./img/calendario.png) |

| Gestión de Liga | Gestión de torneos |
|:---:|:---:|
| ![Gestión liga](./img/gestion_liga.png) | ![Gestión torneos](./img/gestion_torneo.png) |

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
├──📄 index.html              # Página principal (login + navegación)
├──📄 liga.html               # Gestión de ligas
├──📄 torneo.html             # Gestión de torneos
|
├──📁 js/
|   ├──📄 api.js              # Sesión, llamadas a la API y validación (compartido)
|   ├──📄 index.js
|   ├──📄 liga.js
|   └──📄 torneo.js
|
├──📁 css/
|   ├──📄 index.css
|   ├──📄 liga.css
|   └──📄 torneo.css
|
├──📁 functions/
|   └──📁 api/
|       └──📄 [[path]].js     # API: /api/login, /api/liga, /api/torneo
|
├──📁 img/                    # Capturas de pantalla
├──📄 schema.sql              # Esquema de la base de datos D1
├──📄 wrangler.toml           # Configuración de Cloudflare
└──📄 README.md               # Documentación
```
<br>

## 🗄️ Base de Datos

El esquema completo está en [`schema.sql`](schema.sql).

| Tabla | Descripción |
|-------|-------------|
| `liga_equipos` | Equipos participantes en cada liga |
| `liga_calendario` | Partidos y resultados de las ligas |
| `liga_clasificacion` | Estadísticas y puntos de cada equipo por liga |
| `torneo` | Cabecera del torneo actual |
| `torneo_equipos` | Equipos inscritos en el torneo |
| `torneo_partidos` | Partidos del torneo por rondas |
<br>

## 🔌 API

Todas las rutas devuelven JSON con la forma `{ success, data?, error? }`.

| Ruta | Acción | Método | Admin |
|------|--------|--------|:-----:|
| `/api/login` | — | POST | — |
| `/api/liga` | `getEquipos`, `getCalendario` | GET | ❌ |
| `/api/liga` | `addEquipo`, `deleteEquipo`, `generarCalendario`, `guardarResultado`, `resetLiga` | POST | ✅ |
| `/api/torneo` | `getTorneo` | GET | ❌ |
| `/api/torneo` | `addEquipo`, `deleteEquipo`, `crearTorneo`, `guardarPartido`, `resetTorneo` | POST | ✅ |

La acción se indica con `?action=...`. Las acciones de administrador requieren la cabecera `Authorization: Bearer <token>` obtenida en `/api/login`.
<br>

## 🛠️ Instalación y Configuración

### Requisitos Previos

- [Node.js](https://nodejs.org/) 18 o superior
- Una cuenta de [Cloudflare](https://dash.cloudflare.com/) (para desplegar)

### Desarrollo Local

```bash
# 1. Clonar el repositorio
git clone https://github.com/ignaciozagea/padel_app.git
cd padel_app

# 2. Crear las tablas en la base de datos local
npx wrangler d1 execute padel-db --local --file=./schema.sql

# 3. Definir la contraseña de administrador para desarrollo
echo "ADMIN_PASSWORD=tu_contraseña" > .dev.vars

# 4. Arrancar el servidor local (frontend + API + D1)
npx wrangler pages dev
# Abrir http://localhost:8788
```

> ⚠️ No subas `.dev.vars` al repositorio.

### Despliegue en Cloudflare

```bash
# 1. Crear la base de datos (solo la primera vez) y poner su id en wrangler.toml
npx wrangler d1 create padel-db

# 2. Crear las tablas en producción
npx wrangler d1 execute padel-db --remote --file=./schema.sql

# 3. Configurar la contraseña de administrador como secreto
npx wrangler pages secret put ADMIN_PASSWORD

# 4. Desplegar
npx wrangler pages deploy
```

También se puede desplegar conectando el repositorio de GitHub a Cloudflare Pages; en ese caso configura el binding D1 `DB` y la variable secreta `ADMIN_PASSWORD` desde el panel del proyecto.
<br>

### 🔐 Seguridad
- ✅ **Autenticación en el servidor**: la contraseña se guarda como secreto de Cloudflare (`ADMIN_PASSWORD`), nunca en el código
- ✅ **Token firmado (HMAC-SHA256)**: caduca a las 8 horas; se guarda en `sessionStorage`
- ✅ **Acciones protegidas**: toda modificación de datos exige token válido y método POST
- ✅ **Validación**: nombres, ligas y resultados se validan en el servidor
- ✅ **Prepared Statements**: protección contra SQL injection
- ✅ **Escapado de HTML**: protección frente a XSS en nombres de equipos
<br>

## 👤 Autor

**Ignacio Zamora Gea**

- GitHub: [@ignaciozagea](https://github.com/ignaciozagea)
- Demo: [https://padel-app-401.pages.dev](https://padel-app-401.pages.dev)
