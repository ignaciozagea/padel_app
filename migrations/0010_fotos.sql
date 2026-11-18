-- Migración 0010: fotos de las parejas (liga) y de los jugadores (liga individual).
-- El navegador las recorta en cuadrado y las reduce (256x256, JPEG) antes de subirlas,
-- así ocupan unos 20-40 KB y caben en la base de datos sin necesitar otro servicio.
-- Solo añade una tabla: compatible con el código anterior.

CREATE TABLE IF NOT EXISTS fotos (
    tipo           TEXT NOT NULL CHECK (tipo IN ('pareja', 'jugador')),
    ref_id         INTEGER NOT NULL,     -- liga_equipos.id o individual_jugadores.id
    imagen         TEXT NOT NULL,        -- JPEG en base64
    actualizado_en INTEGER NOT NULL,     -- ms desde epoch; sirve también como versión para la caché
    PRIMARY KEY (tipo, ref_id)
);
