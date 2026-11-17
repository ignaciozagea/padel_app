-- Migración 0003: registro de intentos fallidos de login por IP (límite de intentos).
CREATE TABLE IF NOT EXISTS login_intentos (
    ip              TEXT PRIMARY KEY,
    fallos          INTEGER NOT NULL DEFAULT 0,
    ventana_inicio  INTEGER NOT NULL,          -- ms desde epoch del primer fallo de la ventana
    bloqueado_hasta INTEGER NOT NULL DEFAULT 0 -- ms desde epoch; 0 = no bloqueado
);
