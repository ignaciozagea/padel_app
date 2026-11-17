-- Migración 0004: historial de torneos.
-- Un torneo terminado se archiva (estado = 'archivado') en lugar de borrarse.
-- Solo añade columnas: es compatible con el código anterior, así que puede aplicarse antes de desplegar.

ALTER TABLE torneo ADD COLUMN nombre TEXT;
ALTER TABLE torneo ADD COLUMN creado_en INTEGER;      -- ms desde epoch
ALTER TABLE torneo ADD COLUMN finalizado_en INTEGER;  -- ms desde epoch (al archivar)

CREATE INDEX IF NOT EXISTS idx_torneo_estado ON torneo (estado, id);
