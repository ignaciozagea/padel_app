-- Esquema de la base de datos D1 (SQLite) de la app de pádel.
-- Aplicar con:
--   npx wrangler d1 execute padel-db --remote --file=./schema.sql
--   npx wrangler d1 execute padel-db --local  --file=./schema.sql   (desarrollo)

-- ===================== LIGA =====================
CREATE TABLE IF NOT EXISTS liga_equipos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    liga_nombre TEXT NOT NULL,
    nombre      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS liga_calendario (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    liga_nombre      TEXT NOT NULL,
    jornada          INTEGER NOT NULL,
    local            TEXT NOT NULL,
    visitante        TEXT NOT NULL,
    completado       INTEGER NOT NULL DEFAULT 0,
    set1_local       INTEGER, set1_visitante INTEGER,
    set2_local       INTEGER, set2_visitante INTEGER,
    set3_local       INTEGER, set3_visitante INTEGER,
    puntos_local     INTEGER,
    puntos_visitante INTEGER
);

CREATE TABLE IF NOT EXISTS liga_clasificacion (
    liga_nombre TEXT NOT NULL,
    equipo      TEXT NOT NULL,
    pj          INTEGER NOT NULL DEFAULT 0,
    pg          INTEGER NOT NULL DEFAULT 0,
    pp1         INTEGER NOT NULL DEFAULT 0,
    pp0         INTEGER NOT NULL DEFAULT 0,
    puntos      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (liga_nombre, equipo)
);

-- ===================== TORNEO =====================
CREATE TABLE IF NOT EXISTS torneo (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    estado  TEXT NOT NULL DEFAULT 'configuracion',  -- 'configuracion' | 'activo'
    ganador TEXT
);

CREATE TABLE IF NOT EXISTS torneo_equipos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id INTEGER NOT NULL,
    nombre    TEXT NOT NULL,
    orden     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS torneo_partidos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id  INTEGER NOT NULL,
    ronda      INTEGER NOT NULL,
    orden      INTEGER NOT NULL,
    equipo1    TEXT,
    equipo2    TEXT,
    ganador    TEXT,
    completado INTEGER NOT NULL DEFAULT 0,
    set1_local INTEGER, set1_visitante INTEGER,
    set2_local INTEGER, set2_visitante INTEGER,
    set3_local INTEGER, set3_visitante INTEGER
);
