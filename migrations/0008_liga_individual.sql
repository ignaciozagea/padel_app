-- Migración 0008: liga individual.
-- Los jugadores se inscriben por separado y las parejas cambian cada jornada según la clasificación:
-- en cada grupo de 4 (1º-4º, 5º-8º...) juegan el 1º y el 3º contra el 2º y el 4º.
-- La clasificación es por jugador. Solo añade tablas: compatible con el código anterior.

CREATE TABLE IF NOT EXISTS individual_jugadores (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL UNIQUE,
    orden  INTEGER NOT NULL DEFAULT 0   -- orden inicial que fija el administrador (jornada 1 y último desempate)
);

CREATE TABLE IF NOT EXISTS individual_partidos (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    jornada          INTEGER NOT NULL,
    orden            INTEGER NOT NULL,                                      -- nº de partido dentro de la jornada
    local1_id        INTEGER NOT NULL REFERENCES individual_jugadores(id),  -- 1º del grupo
    local2_id        INTEGER NOT NULL REFERENCES individual_jugadores(id),  -- 3º del grupo
    visitante1_id    INTEGER NOT NULL REFERENCES individual_jugadores(id),  -- 2º del grupo
    visitante2_id    INTEGER NOT NULL REFERENCES individual_jugadores(id),  -- 4º del grupo
    completado       INTEGER NOT NULL DEFAULT 0,
    set1_local       INTEGER, set1_visitante INTEGER,
    set2_local       INTEGER, set2_visitante INTEGER,
    set3_local       INTEGER, set3_visitante INTEGER,
    puntos_local     INTEGER,
    puntos_visitante INTEGER,
    UNIQUE (jornada, orden)
);

-- Opciones de la liga individual (una sola fila)
CREATE TABLE IF NOT EXISTS individual_config (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    super_tiebreak INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO individual_config (id, super_tiebreak) VALUES (1, 0);
