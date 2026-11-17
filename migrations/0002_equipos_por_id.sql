-- Migración 0002: los partidos referencian a los equipos por id (no por nombre).
--
-- - liga_calendario: local/visitante (texto) -> local_id/visitante_id
-- - liga_clasificacion: se elimina; la clasificación se calcula a partir de los resultados
-- - torneo_partidos: equipo1/equipo2/ganador (texto) -> equipo1_id/equipo2_id/ganador_id
-- - torneo.ganador: se elimina; el campeón es el ganador de la final
--
-- Los datos existentes se conservan. Además:
-- - Los puntos de los partidos de liga ya jugados se recalculan a partir de los sets
--   (la versión anterior no daba el punto al visitante que perdía 2-1).
-- - Los equipos que aparecen en partidos pero ya no existían se vuelven a crear.
-- - Los equipos duplicados (mismo nombre) se fusionan en uno.

PRAGMA defer_foreign_keys = true;

-- ======================================================================
-- LIGA
-- ======================================================================
ALTER TABLE liga_equipos RENAME TO liga_equipos_old;
ALTER TABLE liga_calendario RENAME TO liga_calendario_old;

-- Equipos que aparecen en el calendario pero se borraron con la versión anterior
INSERT INTO liga_equipos_old (liga_nombre, nombre)
SELECT DISTINCT c.liga_nombre, c.nombre
FROM (
    SELECT liga_nombre, local AS nombre FROM liga_calendario_old
    UNION
    SELECT liga_nombre, visitante FROM liga_calendario_old
) c
WHERE NOT EXISTS (
    SELECT 1 FROM liga_equipos_old e WHERE e.liga_nombre = c.liga_nombre AND e.nombre = c.nombre
);

CREATE TABLE liga_equipos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    liga_nombre TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    UNIQUE (liga_nombre, nombre)
);

INSERT INTO liga_equipos (id, liga_nombre, nombre)
SELECT MIN(id), liga_nombre, nombre
FROM liga_equipos_old
GROUP BY liga_nombre, nombre;

CREATE TABLE liga_calendario (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    liga_nombre      TEXT NOT NULL,
    jornada          INTEGER NOT NULL,
    local_id         INTEGER NOT NULL REFERENCES liga_equipos(id),
    visitante_id     INTEGER NOT NULL REFERENCES liga_equipos(id),
    completado       INTEGER NOT NULL DEFAULT 0,
    set1_local       INTEGER, set1_visitante INTEGER,
    set2_local       INTEGER, set2_visitante INTEGER,
    set3_local       INTEGER, set3_visitante INTEGER,
    puntos_local     INTEGER,
    puntos_visitante INTEGER
);

CREATE INDEX idx_v2_liga_calendario_liga ON liga_calendario (liga_nombre, jornada);

INSERT INTO liga_calendario (
    id, liga_nombre, jornada, local_id, visitante_id, completado,
    set1_local, set1_visitante, set2_local, set2_visitante, set3_local, set3_visitante,
    puntos_local, puntos_visitante
)
WITH partidos AS (
    SELECT c.*,
        (SELECT MIN(id) FROM liga_equipos_old e WHERE e.liga_nombre = c.liga_nombre AND e.nombre = c.local) AS lid,
        (SELECT MIN(id) FROM liga_equipos_old e WHERE e.liga_nombre = c.liga_nombre AND e.nombre = c.visitante) AS vid,
        COALESCE(c.set1_local > c.set1_visitante, 0) + COALESCE(c.set2_local > c.set2_visitante, 0)
            + COALESCE(c.set3_local > c.set3_visitante, 0) AS sl,
        COALESCE(c.set1_visitante > c.set1_local, 0) + COALESCE(c.set2_visitante > c.set2_local, 0)
            + COALESCE(c.set3_visitante > c.set3_local, 0) AS sv
    FROM liga_calendario_old c
)
SELECT
    id, liga_nombre, jornada, lid, vid, COALESCE(completado, 0),
    set1_local, set1_visitante, set2_local, set2_visitante, set3_local, set3_visitante,
    CASE WHEN COALESCE(completado, 0) = 0 THEN NULL WHEN sl > sv THEN 3 WHEN sl > 0 THEN 1 ELSE 0 END,
    CASE WHEN COALESCE(completado, 0) = 0 THEN NULL WHEN sv > sl THEN 3 WHEN sv > 0 THEN 1 ELSE 0 END
FROM partidos;

DROP TABLE liga_calendario_old;
DROP TABLE liga_equipos_old;
DROP TABLE IF EXISTS liga_clasificacion;

-- ======================================================================
-- TORNEO
-- ======================================================================
ALTER TABLE torneo_partidos RENAME TO torneo_partidos_old;
ALTER TABLE torneo_equipos RENAME TO torneo_equipos_old;
ALTER TABLE torneo RENAME TO torneo_old;

-- Equipos que aparecen en partidos pero se borraron con la versión anterior
INSERT INTO torneo_equipos_old (torneo_id, nombre, orden)
SELECT DISTINCT p.torneo_id, p.nombre, 999
FROM (
    SELECT torneo_id, equipo1 AS nombre FROM torneo_partidos_old WHERE equipo1 IS NOT NULL
    UNION
    SELECT torneo_id, equipo2 FROM torneo_partidos_old WHERE equipo2 IS NOT NULL
) p
WHERE NOT EXISTS (
    SELECT 1 FROM torneo_equipos_old e WHERE e.torneo_id = p.torneo_id AND e.nombre = p.nombre
);

CREATE TABLE torneo (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    estado TEXT NOT NULL DEFAULT 'configuracion'  -- 'configuracion' | 'activo'
);

INSERT INTO torneo (id, estado)
SELECT id, COALESCE(estado, 'configuracion') FROM torneo_old;

CREATE TABLE torneo_equipos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id INTEGER NOT NULL REFERENCES torneo(id) ON DELETE CASCADE,
    nombre    TEXT NOT NULL,
    orden     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (torneo_id, nombre)
);

INSERT INTO torneo_equipos (id, torneo_id, nombre, orden)
SELECT MIN(id), torneo_id, nombre, MIN(COALESCE(orden, 0))
FROM torneo_equipos_old
WHERE torneo_id IN (SELECT id FROM torneo)
GROUP BY torneo_id, nombre;

CREATE TABLE torneo_partidos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    torneo_id  INTEGER NOT NULL REFERENCES torneo(id) ON DELETE CASCADE,
    ronda      INTEGER NOT NULL,
    orden      INTEGER NOT NULL,
    equipo1_id INTEGER REFERENCES torneo_equipos(id),
    equipo2_id INTEGER REFERENCES torneo_equipos(id),
    ganador_id INTEGER REFERENCES torneo_equipos(id),
    completado INTEGER NOT NULL DEFAULT 0,
    set1_local INTEGER, set1_visitante INTEGER,
    set2_local INTEGER, set2_visitante INTEGER,
    set3_local INTEGER, set3_visitante INTEGER,
    UNIQUE (torneo_id, ronda, orden)
);

INSERT INTO torneo_partidos (
    id, torneo_id, ronda, orden, equipo1_id, equipo2_id, ganador_id, completado,
    set1_local, set1_visitante, set2_local, set2_visitante, set3_local, set3_visitante
)
SELECT
    p.id, p.torneo_id, p.ronda, p.orden,
    (SELECT MIN(id) FROM torneo_equipos_old e WHERE e.torneo_id = p.torneo_id AND e.nombre = p.equipo1),
    (SELECT MIN(id) FROM torneo_equipos_old e WHERE e.torneo_id = p.torneo_id AND e.nombre = p.equipo2),
    (SELECT MIN(id) FROM torneo_equipos_old e WHERE e.torneo_id = p.torneo_id AND e.nombre = p.ganador),
    COALESCE(p.completado, 0),
    p.set1_local, p.set1_visitante, p.set2_local, p.set2_visitante, p.set3_local, p.set3_visitante
FROM torneo_partidos_old p
WHERE p.torneo_id IN (SELECT id FROM torneo)
  AND p.id = (SELECT MIN(id) FROM torneo_partidos_old x
              WHERE x.torneo_id = p.torneo_id AND x.ronda = p.ronda AND x.orden = p.orden);

DROP TABLE torneo_partidos_old;
DROP TABLE torneo_equipos_old;
DROP TABLE torneo_old;
