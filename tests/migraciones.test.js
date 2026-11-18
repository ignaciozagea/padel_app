import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRACIONES, nuevaBaseDeDatos, aplicarMigracion } from './helpers/d1.js';

test('las migraciones se aplican sobre una base de datos vacía', () => {
    const db = nuevaBaseDeDatos();
    for (const m of MIGRACIONES) aplicarMigracion(db, m);
    const tablas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all().map(t => t.name);
    assert.deepEqual(tablas, ['individual_config', 'individual_jugadores', 'individual_partidos', 'liga_calendario', 'liga_equipos', 'ligas', 'login_intentos', 'torneo', 'torneo_equipos', 'torneo_partidos']);
    const columnasTorneo = db.prepare('PRAGMA table_info(torneo)').all().map(c => c.name);
    assert.deepEqual(columnasTorneo, ['id', 'estado', 'nombre', 'creado_en', 'finalizado_en', 'super_tiebreak']);
});

test('0002 convierte los datos del esquema antiguo sin perderlos', () => {
    const db = nuevaBaseDeDatos();
    aplicarMigracion(db, '0001_esquema_inicial.sql');
    db.exec(`
        INSERT INTO liga_equipos (id, liga_nombre, nombre) VALUES
            (1, 'femenino', 'Ana/Bea'), (2, 'femenino', 'Cris/Dani'),
            (3, 'femenino', 'Ana/Bea'),               -- duplicado
            (4, 'masculino_avanzado', 'Ana/Bea');     -- mismo nombre en otra liga
        -- 'Eva/Fe' se borró con la versión antigua pero tiene partidos
        INSERT INTO liga_calendario (liga_nombre, jornada, local, visitante, completado,
            set1_local, set1_visitante, set2_local, set2_visitante, set3_local, set3_visitante,
            puntos_local, puntos_visitante) VALUES
            ('femenino', 1, 'Ana/Bea', 'Cris/Dani', 1, 6, 2, 3, 6, 6, 0, 3, 0),     -- el visitante debía tener 1
            ('femenino', 2, 'Cris/Dani', 'Eva/Fe', 1, 2, 6, 3, 6, NULL, NULL, 1, 3), -- el local debía tener 0
            ('femenino', 3, 'Eva/Fe', 'Ana/Bea', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
        INSERT INTO liga_clasificacion VALUES ('femenino', 'Ana/Bea', 1, 1, 0, 0, 3);
        INSERT INTO torneo (id, estado, ganador) VALUES (1, 'configuracion', NULL), (2, 'activo', 'X');
        INSERT INTO torneo_equipos (id, torneo_id, nombre, orden) VALUES
            (10, 2, 'X', 0), (11, 2, 'Y', 1), (12, 2, 'Z', 2), (13, 99, 'Huérfano', 0);
        INSERT INTO torneo_partidos (torneo_id, ronda, orden, equipo1, equipo2, ganador, completado,
            set1_local, set1_visitante, set2_local, set2_visitante) VALUES
            (2, 1, 0, 'X', NULL, 'X', 1, NULL, NULL, NULL, NULL),
            (2, 1, 1, 'Y', 'W', 'W', 1, 1, 6, 2, 6),   -- 'W' se borró
            (2, 2, 0, 'X', 'W', NULL, 0, NULL, NULL, NULL, NULL);
    `);
    for (const m of MIGRACIONES.slice(1)) aplicarMigracion(db, m);

    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const equipos = db.prepare("SELECT nombre FROM liga_equipos WHERE liga_nombre = 'femenino' ORDER BY nombre").all();
    assert.deepEqual(equipos.map(e => e.nombre), ['Ana/Bea', 'Cris/Dani', 'Eva/Fe']);

    const cal = db.prepare('SELECT * FROM liga_calendario ORDER BY jornada').all();
    assert.equal(cal.length, 3);
    assert.deepEqual([cal[0].puntos_local, cal[0].puntos_visitante], [3, 1], 'puntos recalculados');
    assert.deepEqual([cal[1].puntos_local, cal[1].puntos_visitante], [0, 3], 'puntos recalculados');
    assert.deepEqual([cal[2].completado, cal[2].puntos_local], [0, null]);

    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'liga_clasificacion'").get(), undefined);

    const partidos = db.prepare(`
        SELECT e1.nombre n1, e2.nombre n2, g.nombre ng FROM torneo_partidos p
        LEFT JOIN torneo_equipos e1 ON e1.id = p.equipo1_id
        LEFT JOIN torneo_equipos e2 ON e2.id = p.equipo2_id
        LEFT JOIN torneo_equipos g  ON g.id  = p.ganador_id
        ORDER BY p.ronda, p.orden`).all();
    assert.deepEqual(partidos.map(p => [p.n1, p.n2, p.ng]), [['X', null, 'X'], ['Y', 'W', 'W'], ['X', 'W', null]]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM torneo_equipos WHERE torneo_id = 99').get().n, 0);
});

test('0007 quita el emoji de las ligas por defecto pero respeta las renombradas', () => {
    const db = nuevaBaseDeDatos();
    for (const m of MIGRACIONES.filter(m => m < '0007')) aplicarMigracion(db, m);
    db.exec("UPDATE ligas SET nombre = '👨 Los del jueves' WHERE slug = 'masculino_intermedio'");
    aplicarMigracion(db, '0007_nombres_ligas_sin_emoji.sql');
    const nombres = db.prepare('SELECT nombre FROM ligas ORDER BY orden').all().map(l => l.nombre);
    assert.deepEqual(nombres, ['Masculino Avanzado', '👨 Los del jueves', 'Masculino Iniciación', 'Femenino']);
});
