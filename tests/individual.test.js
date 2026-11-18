import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const estado = async app => (await app.call('individual?action=getEstado')).data;

async function ligaCon(n) {
    const app = crearApp();
    await app.login();
    for (let i = 1; i <= n; i++) {
        assert.equal((await app.post('individual?action=addJugador', { nombre: `J${i}` })).success, true);
    }
    return app;
}

// Nombres de un partido: [[local1, local2], [visitante1, visitante2]]
const parejas = p => [[p.local1, p.local2], [p.visitante1, p.visitante2]];
const partidosDe = (e, jornada) => e.partidos.filter(p => p.jornada === jornada).sort((a, b) => a.orden - b.orden);

const GANA_LOCAL_2_0 = { set1_local: 6, set1_visitante: 2, set2_local: 6, set2_visitante: 3 };
const GANA_VISIT_2_1 = { set1_local: 6, set1_visitante: 4, set2_local: 3, set2_visitante: 6, set3_local: 4, set3_visitante: 6 };

test('jornada 1: grupos de 4 por el orden manual, el 1º y el 3º contra el 2º y el 4º', async () => {
    const app = await ligaCon(12);
    const e = await estado(app);
    assert.equal(e.puedeGenerar, true);
    assert.equal((await app.post('individual?action=generarJornada')).jornada, 1);

    const j1 = partidosDe(await estado(app), 1);
    assert.deepEqual(j1.map(parejas), [
        [['J1', 'J3'], ['J2', 'J4']],
        [['J5', 'J7'], ['J6', 'J8']],
        [['J9', 'J11'], ['J10', 'J12']]
    ]);
});

test('el administrador fija el orden inicial antes de empezar', async () => {
    const app = await ligaCon(4);
    const ids = Object.fromEntries((await estado(app)).jugadores.map(j => [j.nombre, j.id]));
    // Nuevo orden: J4, J3, J2, J1
    assert.equal((await app.post('individual?action=ordenarJugadores', { ids: [ids.J4, ids.J3, ids.J2, ids.J1] })).success, true);
    assert.deepEqual((await estado(app)).jugadores.map(j => j.nombre), ['J4', 'J3', 'J2', 'J1']);
    // Lista incompleta o repetida -> error
    assert.equal((await app.post('individual?action=ordenarJugadores', { ids: [ids.J1, ids.J2, ids.J3] })).status, 400);
    assert.equal((await app.post('individual?action=ordenarJugadores', { ids: [ids.J1, ids.J1, ids.J2, ids.J3] })).status, 400);

    await app.post('individual?action=generarJornada');
    assert.deepEqual(partidosDe(await estado(app), 1).map(parejas), [[['J4', 'J2'], ['J3', 'J1']]]);
});

test('solo se puede empezar con un múltiplo de 4 jugadores', async () => {
    for (const n of [0, 2, 3, 5, 6, 7, 10]) {
        const app = await ligaCon(n);
        assert.equal((await estado(app)).puedeGenerar, false, `n=${n}`);
        const r = await app.post('individual?action=generarJornada');
        assert.equal(r.status, 409, `n=${n}`);
        assert.match(r.error, /múltiplo de 4/);
    }
    for (const n of [4, 8, 16]) {
        const app = await ligaCon(n);
        assert.equal((await app.post('individual?action=generarJornada')).success, true, `n=${n}`);
    }
});

test('la puntuación es individual y la jornada 2 se forma con la clasificación', async () => {
    const app = await ligaCon(8);
    await app.post('individual?action=generarJornada');
    const [p1, p2] = partidosDe(await estado(app), 1);

    // Partido 1: J1+J3 ganan 2-0 a J2+J4. Partido 2: J6+J8 ganan 2-1 a J5+J7.
    await app.post('individual?action=guardarResultado', { id: p1.id, ...GANA_LOCAL_2_0 });
    // No se puede generar la jornada 2 con resultados pendientes
    assert.equal((await app.post('individual?action=generarJornada')).status, 409);
    await app.post('individual?action=guardarResultado', { id: p2.id, ...GANA_VISIT_2_1 });

    const e = await estado(app);
    const pts = Object.fromEntries(e.clasificacion.map(c => [c.nombre, c.puntos]));
    assert.deepEqual(pts, { J1: 3, J3: 3, J6: 3, J8: 3, J5: 1, J7: 1, J2: 0, J4: 0 });

    // Clasificación (puntos, dif. sets, dif. juegos, orden inicial):
    // J1, J3 (+2 sets, +7 juegos) > J6, J8 (+1 set, +1 juego) > J5, J7 (1 pt) > J2, J4 (0 pts)
    assert.deepEqual(e.clasificacion.map(c => c.nombre), ['J1', 'J3', 'J6', 'J8', 'J5', 'J7', 'J2', 'J4']);
    const j1 = e.clasificacion[0];
    assert.deepEqual([j1.pj, j1.pg, j1.sets_favor, j1.sets_contra, j1.juegos_favor, j1.juegos_contra], [1, 1, 2, 0, 12, 5]);

    // Jornada 2: 1º+3º contra 2º+4º en cada grupo de la clasificación
    assert.equal((await app.post('individual?action=generarJornada')).jornada, 2);
    assert.deepEqual(partidosDe(await estado(app), 2).map(parejas), [
        [['J1', 'J6'], ['J3', 'J8']],
        [['J5', 'J2'], ['J7', 'J4']]
    ]);
});

test('la liga dura 10 jornadas', async () => {
    const app = await ligaCon(4);
    for (let j = 1; j <= 10; j++) {
        assert.equal((await app.post('individual?action=generarJornada')).jornada, j);
        const [p] = partidosDe(await estado(app), j);
        await app.post('individual?action=guardarResultado', { id: p.id, ...GANA_LOCAL_2_0 });
    }
    const e = await estado(app);
    assert.deepEqual([e.jornadaActual, e.terminada, e.puedeGenerar], [10, true, false]);
    assert.equal((await app.post('individual?action=generarJornada')).status, 409);
    // Cada jugador ha jugado 10 partidos
    assert.ok(e.clasificacion.every(c => c.pj === 10));
});

test('solo se pueden tocar los resultados de la última jornada', async () => {
    const app = await ligaCon(4);
    await app.post('individual?action=generarJornada');
    const [p1] = partidosDe(await estado(app), 1);
    await app.post('individual?action=guardarResultado', { id: p1.id, ...GANA_LOCAL_2_0 });

    // Corregir la última jornada sí
    assert.equal((await app.post('individual?action=guardarResultado', { id: p1.id, ...GANA_VISIT_2_1 })).success, true);
    assert.equal((await estado(app)).clasificacion.find(c => c.nombre === 'J2').puntos, 3);

    await app.post('individual?action=generarJornada');
    // La jornada 1 ya no se puede corregir ni anular
    assert.equal((await app.post('individual?action=guardarResultado', { id: p1.id, ...GANA_LOCAL_2_0 })).status, 409);
    assert.equal((await app.post('individual?action=anularResultado', { id: p1.id })).status, 409);

    // Anular en la última jornada
    const [p2] = partidosDe(await estado(app), 2);
    await app.post('individual?action=guardarResultado', { id: p2.id, ...GANA_LOCAL_2_0 });
    assert.equal((await app.post('individual?action=anularResultado', { id: p2.id })).success, true);
    assert.equal(partidosDe(await estado(app), 2)[0].completado, 0);
});

test('deshacer la última jornada (solo sin resultados) y resetear', async () => {
    const app = await ligaCon(4);
    await app.post('individual?action=generarJornada');
    const [p1] = partidosDe(await estado(app), 1);
    await app.post('individual?action=guardarResultado', { id: p1.id, ...GANA_LOCAL_2_0 });
    await app.post('individual?action=generarJornada');

    assert.equal((await app.post('individual?action=deshacerJornada')).jornada, 2);
    assert.equal((await estado(app)).jornadaActual, 1);
    // La jornada 1 tiene resultados: no se deshace
    assert.equal((await app.post('individual?action=deshacerJornada')).status, 409);

    // Con la liga empezada no se cambian jugadores ni su orden
    assert.equal((await app.post('individual?action=addJugador', { nombre: 'Tarde' })).status, 409);
    const ids = (await estado(app)).jugadores.map(j => j.id);
    assert.equal((await app.post('individual?action=deleteJugador', { id: ids[0] })).status, 409);
    assert.equal((await app.post('individual?action=ordenarJugadores', { ids: [...ids].reverse() })).status, 409);
    // Renombrar sí
    assert.equal((await app.post('individual?action=renameJugador', { id: ids[0], nombre: 'Renombrado' })).success, true);
    assert.equal((await estado(app)).clasificacion[0].nombre, 'Renombrado');

    // Resetear borra las jornadas pero conserva a los jugadores
    await app.post('individual?action=resetIndividual');
    const e = await estado(app);
    assert.deepEqual([e.jornadaActual, e.partidos.length, e.jugadores.length, e.empezada], [0, 0, 4, false]);
    assert.ok(e.clasificacion.every(c => c.puntos === 0));
    assert.equal((await app.post('individual?action=addJugador', { nombre: 'Tarde' })).success, true);
});

test('nombres duplicados, súper tie-break y permisos', async () => {
    const app = await ligaCon(4);
    assert.equal((await app.post('individual?action=addJugador', { nombre: 'j1' })).status, 409);
    assert.equal((await app.post('individual?action=addJugador', { nombre: ' ' })).status, 400);

    await app.post('individual?action=configurar', { super_tiebreak: true });
    assert.equal((await estado(app)).superTiebreak, true);
    await app.post('individual?action=generarJornada');
    const [p] = partidosDe(await estado(app), 1);
    const r = await app.post('individual?action=guardarResultado', {
        id: p.id, set1_local: 6, set1_visitante: 4, set2_local: 3, set2_visitante: 6, set3_local: 10, set3_visitante: 8
    });
    assert.deepEqual([r.success, r.setsLocal, r.setsVisitante], [true, 2, 1]);
    // El súper tie-break cuenta 1-0 en juegos: J1 6+3+1 = 10, contra 4+6+0 = 10
    const j1 = (await estado(app)).clasificacion.find(c => c.nombre === 'J1');
    assert.deepEqual([j1.puntos, j1.juegos_favor, j1.juegos_contra], [3, 10, 10]);

    app.setToken(null);
    assert.equal((await app.post('individual?action=generarJornada')).status, 401);
    assert.equal((await app.post('individual?action=addJugador', { nombre: 'X' })).status, 401);
    assert.equal((await app.call('individual?action=getEstado')).success, true, 'la consulta es pública');
});
