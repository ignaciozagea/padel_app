import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const L = 'femenino';

async function ligaConPartido({ superTiebreak }) {
    const app = crearApp();
    await app.login();
    await app.post('liga?action=addEquipo', { liga: L, nombre: 'A' });
    await app.post('liga?action=addEquipo', { liga: L, nombre: 'B' });
    if (superTiebreak) {
        assert.equal((await app.post('liga?action=configurarLiga', { slug: L, super_tiebreak: true })).success, true);
    }
    const equipos = (await app.call(`liga?action=getEquipos&liga=${L}`)).data;
    const id = Object.fromEntries(equipos.map(e => [e.nombre, e.id]));
    const partido = Number(app.sqlite.prepare(
        'INSERT INTO liga_calendario (liga_nombre, jornada, local_id, visitante_id) VALUES (?, 1, ?, ?)'
    ).run(L, id.A, id.B).lastInsertRowid);
    const resultado = (s3l, s3v) => app.post('liga?action=guardarResultado', {
        liga: L, id: partido,
        set1_local: 6, set1_visitante: 4, set2_local: 3, set2_visitante: 6,
        set3_local: s3l, set3_visitante: s3v
    });
    return { app, resultado };
}

test('la opción es por liga y está desactivada por defecto', async () => {
    const app = crearApp();
    await app.login();
    const ligas = (await app.call('liga?action=getLigas')).data;
    assert.ok(ligas.every(l => l.super_tiebreak === 0));

    await app.post('liga?action=configurarLiga', { slug: L, super_tiebreak: true });
    const despues = (await app.call('liga?action=getLigas')).data;
    assert.equal(despues.find(l => l.slug === L).super_tiebreak, 1);
    assert.equal(despues.find(l => l.slug === 'masculino_avanzado').super_tiebreak, 0);

    assert.equal((await app.post('liga?action=configurarLiga', { slug: L, super_tiebreak: 'si' })).status, 400);
    app.setToken(null);
    assert.equal((await app.post('liga?action=configurarLiga', { slug: L, super_tiebreak: false })).status, 401);
});

test('sin la opción, un 10-8 en el tercer set se rechaza', async () => {
    const { resultado } = await ligaConPartido({ superTiebreak: false });
    assert.equal((await resultado(10, 8)).status, 400);
    assert.equal((await resultado(7, 5)).success, true);
});

test('con la opción, el tercer set se valida como súper tie-break', async () => {
    const { resultado } = await ligaConPartido({ superTiebreak: true });
    for (const [l, v] of [[10, 9], [9, 7], [13, 10], [11, 10], [7, 5], [6, 4], [31, 29]]) {
        assert.equal((await resultado(l, v)).status, 400, `${l}-${v} debería rechazarse`);
    }
    for (const [l, v] of [[10, 0], [10, 8], [8, 10], [11, 9], [14, 16]]) {
        assert.equal((await resultado(l, v)).success, true, `${l}-${v} debería aceptarse`);
    }
});

test('el súper tie-break cuenta como un set y como un juego (1-0) en la clasificación', async () => {
    const { app, resultado } = await ligaConPartido({ superTiebreak: true });
    await resultado(10, 7); // A gana 6-4, 3-6, 10-7
    const tabla = Object.fromEntries((await app.call(`liga?action=getEquipos&liga=${L}`)).data.map(e => [e.nombre, e]));
    assert.deepEqual([tabla.A.puntos, tabla.B.puntos], [3, 1]);
    assert.deepEqual([tabla.A.sets_favor, tabla.A.sets_contra], [2, 1]);
    // Juegos: A 6+3+1 = 10, B 4+6+0 = 10 (no 6+3+10 = 19 frente a 4+6+7 = 17)
    assert.deepEqual([tabla.A.juegos_favor, tabla.A.juegos_contra], [10, 10]);
});

test('torneo: la opción se guarda en el torneo y la heredan los siguientes', async () => {
    const app = crearApp();
    await app.login();
    // Se puede activar antes de inscribir a nadie
    assert.equal((await app.post('torneo?action=configurarTorneo', { super_tiebreak: true })).success, true);
    for (const n of ['A', 'B']) await app.post('torneo?action=addEquipo', { nombre: n });
    await app.post('torneo?action=crearTorneo');

    let d = (await app.call('torneo?action=getTorneo')).data;
    assert.equal(d.torneo.super_tiebreak, 1);
    const final = d.partidos[0];
    const jugar = (s3l, s3v) => app.post('torneo?action=guardarPartido', {
        id: final.id, set1_local: 6, set1_visitante: 4, set2_local: 4, set2_visitante: 6,
        set3_local: s3l, set3_visitante: s3v
    });
    assert.equal((await jugar(7, 5)).status, 400);
    const r = await jugar(9, 11);
    assert.deepEqual([r.success, r.ganador, r.setsLocal, r.setsVisitante], [true, final.equipo2, 1, 2]);

    // Al archivar y empezar otro torneo, se mantiene la opción
    await app.post('torneo?action=archivarTorneo', { nombre: 'Con STB' });
    await app.post('torneo?action=addEquipo', { nombre: 'C' });
    d = (await app.call('torneo?action=getTorneo')).data;
    assert.equal(d.torneo.super_tiebreak, 1);
});
