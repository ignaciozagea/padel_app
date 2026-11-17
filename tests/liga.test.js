import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const L = 'femenino';

async function nuevaLiga(nombres) {
    const app = crearApp();
    await app.login();
    for (const nombre of nombres) {
        assert.equal((await app.post('liga?action=addEquipo', { liga: L, nombre })).success, true);
    }
    const equipos = (await app.call(`liga?action=getEquipos&liga=${L}`)).data;
    const id = Object.fromEntries(equipos.map(e => [e.nombre, e.id]));
    return { app, id };
}

// Inserta un partido concreto en el calendario (el generador es aleatorio)
function crearPartido(app, jornada, localId, visitanteId) {
    return Number(app.sqlite.prepare(
        'INSERT INTO liga_calendario (liga_nombre, jornada, local_id, visitante_id) VALUES (?, ?, ?, ?)'
    ).run(L, jornada, localId, visitanteId).lastInsertRowid);
}

const resultado = (app, id, sets) => {
    const body = { liga: L, id };
    sets.forEach(([l, v], i) => { body[`set${i + 1}_local`] = l; body[`set${i + 1}_visitante`] = v; });
    return app.post('liga?action=guardarResultado', body);
};

const clasificacion = async app => (await app.call(`liga?action=getEquipos&liga=${L}`)).data;

test('alta de equipos: nombres vacíos, duplicados y ligas no válidas', async () => {
    const { app } = await nuevaLiga(['Ana/Bea']);
    assert.equal((await app.post('liga?action=addEquipo', { liga: L, nombre: ' ana/bea ' })).status, 409);
    assert.equal((await app.post('liga?action=addEquipo', { liga: L, nombre: '   ' })).status, 400);
    assert.equal((await app.post('liga?action=addEquipo', { liga: 'inventada', nombre: 'X' })).status, 400);
});

test('el calendario enfrenta a todos contra todos una sola vez', async () => {
    for (const n of [2, 3, 4, 5, 8]) {
        const { app } = await nuevaLiga(Array.from({ length: n }, (_, i) => `E${i}`));
        await app.post('liga?action=generarCalendario', { liga: L });
        const partidos = Object.values((await app.call(`liga?action=getCalendario&liga=${L}`)).data).flat();
        assert.equal(partidos.length, n * (n - 1) / 2);
        const parejas = new Set(partidos.map(p => [p.local_id, p.visitante_id].sort().join('-')));
        assert.equal(parejas.size, partidos.length);
    }
});

test('validación de resultados de pádel', async () => {
    const { app, id } = await nuevaLiga(['A', 'B']);
    const p = crearPartido(app, 1, id.A, id.B);
    const mal = async sets => assert.equal((await resultado(app, p, sets)).status, 400, JSON.stringify(sets));

    await mal([[6, 2], [3, 6]]);              // 1-1 sin tercer set
    await mal([[6, 2], [6, 3], [6, 1]]);      // tercer set sobrante
    await mal([[6, 6], [6, 3]]);              // empate
    await mal([[6, 5], [6, 3]]);              // 6-5 no es un final de set
    await mal([[7, 4], [6, 3]]);              // 7-4 no es un final de set
    await mal([[5, 3], [6, 3]]);              // set sin terminar
    await mal([[8, 6], [6, 3]]);              // fuera de rango
    assert.equal((await resultado(app, p, [[7, 5], [6, 7], [7, 6]])).success, true);
});

test('puntos 3/1/0, corrección y anulación de resultados', async () => {
    const { app, id } = await nuevaLiga(['A', 'B']);
    const p = crearPartido(app, 1, id.A, id.B);
    const fila = async n => (await clasificacion(app)).find(e => e.nombre === n);

    await resultado(app, p, [[6, 1], [6, 2]]);             // A gana 2-0
    assert.deepEqual([(await fila('A')).puntos, (await fila('B')).puntos], [3, 0]);

    await resultado(app, p, [[6, 1], [2, 6], [3, 6]]);     // corrección: B gana 2-1
    const a = await fila('A');
    const b = await fila('B');
    assert.deepEqual([a.puntos, a.pj, a.pp1, b.puntos, b.pj, b.pg], [1, 1, 1, 3, 1, 1]);
    assert.deepEqual([b.sets_favor, b.sets_contra, b.juegos_favor, b.juegos_contra], [2, 1, 13, 11]);

    await resultado(app, p, [[6, 2], [6, 0]]);             // un 0 se guarda como 0
    const cal = Object.values((await app.call(`liga?action=getCalendario&liga=${L}`)).data).flat();
    assert.equal(cal[0].set2_visitante, 0);

    assert.equal((await app.post('liga?action=anularResultado', { liga: L, id: p })).success, true);
    assert.ok((await clasificacion(app)).every(e => e.pj === 0 && e.puntos === 0));
});

test('desempate por enfrentamiento directo cuando empatan dos equipos', async () => {
    const { app, id } = await nuevaLiga(['A', 'B', 'C']);
    await resultado(app, crearPartido(app, 1, id.A, id.B), [[6, 4], [4, 6], [6, 4]]); // A 3 - B 1
    await resultado(app, crearPartido(app, 2, id.B, id.C), [[6, 0], [6, 0]]);         // B 3 - C 0
    await resultado(app, crearPartido(app, 3, id.A, id.C), [[4, 6], [6, 4], [4, 6]]); // A 1 - C 3
    // A y B empatan a 4 puntos; B tiene mejor diferencia de sets, pero A ganó el directo
    const tabla = await clasificacion(app);
    assert.deepEqual(tabla.map(e => [e.nombre, e.puntos]), [['A', 4], ['B', 4], ['C', 3]]);
    assert.deepEqual(tabla.map(e => e.posicion), [1, 2, 3]);
});

test('desempate por diferencia de juegos cuando empatan tres equipos', async () => {
    const { app, id } = await nuevaLiga(['A', 'B', 'C']);
    await resultado(app, crearPartido(app, 1, id.A, id.B), [[6, 0], [6, 0]]); // A +12
    await resultado(app, crearPartido(app, 2, id.B, id.C), [[6, 4], [6, 4]]); // B +4
    await resultado(app, crearPartido(app, 3, id.C, id.A), [[6, 4], [6, 4]]); // C +4
    // Todos con 3 puntos y diferencia de sets 0 -> diferencia de juegos: A +8, C 0, B -8
    const tabla = await clasificacion(app);
    assert.deepEqual(tabla.map(e => e.nombre), ['A', 'C', 'B']);
});

test('renombrar mantiene los resultados y borrar exige resetear antes', async () => {
    const { app, id } = await nuevaLiga(['A', 'B']);
    const p = crearPartido(app, 1, id.A, id.B);
    await resultado(app, p, [[6, 1], [6, 1]]);

    assert.equal((await app.post('liga?action=renameEquipo', { id: id.A, nombre: "D'Angelo" })).success, true);
    assert.equal((await app.post('liga?action=renameEquipo', { id: id.A, nombre: 'b' })).status, 409);
    const tabla = await clasificacion(app);
    assert.deepEqual([tabla[0].nombre, tabla[0].puntos], ["D'Angelo", 3]);

    assert.equal((await app.post('liga?action=deleteEquipo', { id: id.B })).status, 409);
    await app.post('liga?action=resetLiga', { liga: L });
    assert.equal((await app.post('liga?action=deleteEquipo', { id: id.B })).success, true);
});
