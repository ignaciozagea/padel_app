-- Migración 0007: nombres de las ligas por defecto sin emoji.
-- La web usa ahora iconos propios en lugar de emojis (que se ven distintos en cada móvil).
-- Solo cambia las ligas cuyo nombre sigue siendo el original: si alguien las ha renombrado, se respeta.
-- Es compatible con el código anterior, así que puede aplicarse antes de desplegar.

UPDATE ligas SET nombre = 'Masculino Avanzado'   WHERE slug = 'masculino_avanzado'   AND nombre = '👨 Masculino Avanzado';
UPDATE ligas SET nombre = 'Masculino Intermedio' WHERE slug = 'masculino_intermedio' AND nombre = '👨 Masculino Intermedio';
UPDATE ligas SET nombre = 'Masculino Iniciación' WHERE slug = 'masculino_iniciacion' AND nombre = '👨 Masculino Iniciación';
UPDATE ligas SET nombre = 'Femenino'             WHERE slug = 'femenino'             AND nombre = '👩 Femenino';
