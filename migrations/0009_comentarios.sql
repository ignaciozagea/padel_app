-- Migración 0009: comentarios en los partidos (liga por parejas, liga individual y torneo).
-- Para comentar hace falta el "código de jugadores" que fija el administrador y se comparte en el grupo.
-- Solo añade tablas: compatible con el código anterior.

CREATE TABLE IF NOT EXISTS comentarios (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo       TEXT NOT NULL CHECK (tipo IN ('liga', 'individual', 'torneo')),
    partido_id INTEGER NOT NULL,           -- id en liga_calendario, individual_partidos o torneo_partidos
    autor      TEXT NOT NULL,
    texto      TEXT NOT NULL,
    origen     TEXT,                       -- huella anónima del remitente (no la IP) para limitar envíos
    creado_en  INTEGER NOT NULL            -- ms desde epoch
);

CREATE INDEX IF NOT EXISTS idx_comentarios_partido ON comentarios (tipo, partido_id, id);
CREATE INDEX IF NOT EXISTS idx_comentarios_origen ON comentarios (origen, creado_en);

-- Ajustes generales (clave/valor). De momento: codigo_comentarios
CREATE TABLE IF NOT EXISTS ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
);
