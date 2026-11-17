-- Migración 0005: ligas configurables.
-- Las ligas pasan de estar fijas en el código a una tabla. Se crean las 4 que ya existían
-- con el mismo identificador (slug), así que los equipos y partidos actuales no cambian.
-- Solo añade una tabla: es compatible con el código anterior, así que puede aplicarse antes de desplegar.

CREATE TABLE IF NOT EXISTS ligas (
    slug   TEXT PRIMARY KEY,           -- identificador usado en liga_equipos.liga_nombre y liga_calendario.liga_nombre
    nombre TEXT NOT NULL,              -- nombre visible (puede incluir emoji)
    orden  INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO ligas (slug, nombre, orden) VALUES
    ('masculino_avanzado',   '👨 Masculino Avanzado',   1),
    ('masculino_intermedio', '👨 Masculino Intermedio', 2),
    ('masculino_iniciacion', '👨 Masculino Iniciación', 3),
    ('femenino',             '👩 Femenino',             4);
