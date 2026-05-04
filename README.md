# 🏆 Liga de Pádel - Gestión de Torneos y Ligas

<div align="center">
  <img src="https://img.shields.io/badge/PHP-7.4%2B-777BB4?style=for-the-badge&logo=php&logoColor=white"/>
  <img src="https://img.shields.io/badge/MySQL-8.0-4479A1?style=for-the-badge&logo=mysql&logoColor=white"/>
  <img src="https://img.shields.io/badge/JavaScript-ES6-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black"/>
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white"/>
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white"/>
  <img src="https://img.shields.io/badge/Responsive-Yes-4ADE80?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/License-MIT-4ADE80?style=for-the-badge"/>
</div>

## 📋 Descripción

Aplicación web completa para la **gestión profesional de ligas y torneos de pádel**. Permite administrar múltiples ligas, generar calendarios automáticos (round-robin), registrar resultados con sistema de puntuación 3/1/0, y organizar torneos de eliminación directa con sorteo aleatorio.

### 🎯 Características Principales

- ✅ **4 ligas simultáneas**: Masculino Avanzado, Masculino Intermedio, Masculino Iniciación y Femenino
- ✅ **CRUD completo de equipos**: Añadir y eliminar parejas fácilmente
- ✅ **Calendario automático**: Sistema round-robin (todos contra todos)
- ✅ **Resultados al mejor de 3 sets**: Registro detallado por set
- ✅ **Sistema de puntuación 3/1/0**: Victoria 3 pts, Derrota 2-1 → 1 pt, Derrota 2-0 → 0 pts
- ✅ **Clasificación automática**: Ordenada por puntos con estadísticas
- ✅ **Torneo eliminación directa**: Octavos → Cuartos → Semifinal → Final
- ✅ **Sorteo aleatorio**: Emparejamientos generados al azar
- ✅ **Árbol visual del torneo**: Muestra todas las rondas
- ✅ **Login seguro**: Acceso administrador con contraseña
- ✅ **Persistencia de datos**: Base de datos MySQL
- ✅ **Diseño responsive**: Adaptado a móviles, tablets y ordenadores
- ✅ **Glassmorphism moderno**: Efectos visuales atractivos

## 🚀 Demo

> **URL de producción:** [https://padelgo.ct.ws](https://padelgo.ct.ws)

| Rol | Usuario | Contraseña |
|-----|---------|------------|
| Administrador | - | `*****` |
| Público | - | Sin autenticación |

## 📸 Capturas de Pantalla

### Página Principal
<img width="1121" height="860" alt="pantalla_principal" src="https://github.com/user-attachments/assets/e4ae6b2b-020c-40aa-8a07-3d13ab683c2b" />

### Gestión de Ligas
<img width="1762" height="733" alt="calendario_liga" src="https://github.com/user-attachments/assets/fb12aa7f-7ef9-409c-9cb3-5f846cbff53a" />

### Clasificación
<img width="1822" height="767" alt="clasificacion_liga" src="https://github.com/user-attachments/assets/413dcfde-2664-4d86-8c1c-c8a40f892a8b" />


### Torneo
<img width="1605" height="890" alt="cruces_torneo" src="https://github.com/user-attachments/assets/708c0056-5d16-420d-8653-2f8313105aa9" />


## 🛠️ Tecnologías Utilizadas

| Tecnología | Versión | Uso |
|------------|---------|-----|
| HTML5 | - | Estructura de la aplicación |
| CSS3 | - | Diseño, animaciones, responsive |
| JavaScript | ES6 | Lógica frontend, peticiones AJAX |
| PHP | 7.4+ | API RESTful backend |
| MySQL | 8.0+ | Base de datos relacional |
| Git | - | Control de versiones |

## 📁 Estructura del Proyecto

```text
liga-padel/
|
├── index.html              # Página principal (login + navegación)
├── liga.html               # Gestión de ligas
├── torneo.html             # Gestión de torneos
|
├── JS/
|   ├── index.js
|   ├── liga.js
|   └── torneo.js
|
├── CSS/
|   ├── index.css
|   ├── liga.css
|   └── torneo.css
|
├── API/
|   ├── config.php          # Configuración de base de datos
|   ├── api_liga.php        # API para gestión de ligas
|   ├── api_torneo.php      # API para gestión de torneos
|   ├── api_login.php       # API para verificar login
|   ├── test_db.php         # Diagnóstico de base de datos
|   └── test_api.html       # Prueba de conexión API
|
└── README.md               # Documentación
```

## 🛠️ Instalación y Configuración

### Requisitos Previos

- Servidor web (Apache/Nginx)
- PHP 7.4 o superior
- MySQL 5.7 o superior
- XAMPP / WAMP / MAMP (para desarrollo local)

### Instalación Local

```bash
# 1. Clonar el repositorio
git clone https://github.com/ignaciozagea/padel_app.git
cd padel_app

# 2. Copiar a la carpeta del servidor web
# Windows: C:\xampp\htdocs\padel_app\
# Mac: /Applications/XAMPP/htdocs/padel_app/
# Linux: /var/www/html/padel_app/

# 3. Configurar la base de datos
# - Abrir phpMyAdmin
# - Crear base de datos 'liga_padel_db'
# - Ejecutar el script SQL

# 4. Configurar conexión
# Editar config.php con tus datos

# 5. Configurar URL de la API
# Editar liga.html y torneo.html:

const API_URL = 'http://localhost/padel_app/api_liga.php';

# 6. Iniciar el servidor
# - Iniciar Apache y MySQL en XAMPP
# - Abrir http://localhost/padel_app/index.html
```

### 🔐 Seguridad
- ✅ **Autenticación**: SessionStorage para administradores
- ✅ **Contraseña**: Almacenada localmente (admin123)
- ✅ **CORS**: Configurado para permitir peticiones
- ✅ **Validación**: Sanitización de datos en PHP
- ✅ **Prepared Statements**: Protección contra SQL injection



