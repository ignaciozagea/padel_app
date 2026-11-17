-- Migración 0006: tercer set como súper tie-break (a 10 puntos, diferencia de 2).
-- Es una opción por liga y por torneo; desactivada por defecto (no cambia nada hasta activarla).
-- Solo añade columnas: es compatible con el código anterior, así que puede aplicarse antes de desplegar.

ALTER TABLE ligas ADD COLUMN super_tiebreak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE torneo ADD COLUMN super_tiebreak INTEGER NOT NULL DEFAULT 0;
