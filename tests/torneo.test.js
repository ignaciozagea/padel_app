import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const GANA_1 = { set1_local: 6, set1_visitante: 0, set2_local: 6, set2_visitante: 0 };
const GANA_2 = { set1_local: 0, set1_visitante: 6, set2_local: 0, set2_visitante: 6 };

async function nuevoTorneo(app, n, prefijo = 'E') {
    for (let i = 0; i < n; i++) await app.post('torneo?action=addEquipo', { nombre: `${prefijo}${i}` });
    assert.equal((await app.post('torneo?action=crearTorneo')).success, true);
}

const getTorneo = async (app, id) =>
    (await app.call(`torneo?action=getTorneo${id ? `&id=${id}` : ''}`)).data;

async function jugarHastaElFinal(app) {
    for (let i = 0; i < 40; i++) {
        const d = await getTorneo(app);
        if (d.torneo.ganador) return d;
        assert.ok(!d.partidos.some(p => p.ronda === 1 && !p.equipo1_id && !p.equipo2_id), 'descanso contra descanso');
        const jugable = d.partidos.find(p => p.equipo1_id && p.equipo2_id && !p.completado);
        assert.ok(jugable, 'el torneo se ha atascado');
        const r = await app.post('torneo?action=guardarPartido', {
            id: jugable.id, set1_local: 4, set1_visitante: 6, set2_local: 6, set2_visitante: 4, set3_local: 7, set3_visitante: 5
        });
        assert.equal(r.ganador, jugable.equipo1);
    }
    throw new Error('demasiadas rondas');
}

test('cuadros de 2 a 16 equipos se juegan hasta tener campeón', async () => {
    const app = crearApp();
    await app.login();
    for (let n = 2; n <= 16; n++) {
        for (let rep = 0; rep < 5; rep++) {
            await app.post('torneo?action=resetTorneo');
            await nuevoTorneo(app, n);
            const d = await jugarHastaElFinal(app);
            assert.equal(d.equipos.length, n);
            assert.equal(d.partidos.filter(p => p.set1_local !== null).length, n - 1, `n=${n}`);
        }
    }
});

test('corregir y anular resultados actualiza la ronda siguiente', async () => {
    const app = crearApp();
    await app.login();
    await nuevoTorneo(app, 8);
    let d = await getTorneo(app);
    const cuartos = d.partidos.find(p => p.ronda === 1 && p.orden === 0);
    const semi = () => d.partidos.find(p => p.ronda === 2 && p.orden === 0);

    await app.post('torneo?action=guardarPartido', { id: cuartos.id, ...GANA_1 });
    d = await getTorneo(app);
    assert.equal(semi().equipo1_id, cuartos.equipo1_id);

    await app.post('torneo?action=guardarPartido', { id: cuartos.id, ...GANA_2 });
    d = await getTorneo(app);
    assert.equal(semi().equipo1_id, cuartos.equipo2_id);

    assert.equal((await app.post('torneo?action=anularPartido', { id: cuartos.id })).success, true);
    d = await getTorneo(app);
    assert.equal(semi().equipo1_id, null);

    // Si el ganador ya jugó la ronda siguiente, no se puede tocar
    await app.post('torneo?action=guardarPartido', { id: cuartos.id, ...GANA_1 });
    const otro = d.partidos.find(p => p.ronda === 1 && p.orden === 1);
    await app.post('torneo?action=guardarPartido', { id: otro.id, ...GANA_1 });
    await app.post('torneo?action=guardarPartido', { id: semi().id, ...GANA_1 });
    assert.equal((await app.post('torneo?action=guardarPartido', { id: cuartos.id, ...GANA_2 })).status, 409);
    assert.equal((await app.post('torneo?action=anularPartido', { id: cuartos.id })).status, 409);

    // Renombrar con el torneo en marcha
    await app.post('torneo?action=renameEquipo', { id: cuartos.equipo1_id, nombre: 'Renombrado' });
    d = await getTorneo(app);
    assert.equal(semi().ganador, 'Renombrado');

    // Con el cuadro generado no se inscriben ni se borran equipos
    assert.equal((await app.post('torneo?action=addEquipo', { nombre: 'Tarde' })).status, 409);
    assert.equal((await app.post('torneo?action=deleteEquipo', { id: cuartos.equipo2_id })).status, 409);

    // Corregir la final cambia el campeón
    d = await jugarHastaElFinal(app);
    const final = d.partidos[d.partidos.length - 1];
    await app.post('torneo?action=guardarPartido', { id: final.id, ...GANA_2 });
    assert.equal((await getTorneo(app)).torneo.ganador, final.equipo2);
});

test('los partidos con descanso no admiten resultado', async () => {
    const app = crearApp();
    await app.login();
    await nuevoTorneo(app, 3);
    const d = await getTorneo(app);
    const descanso = d.partidos.find(p => p.ronda === 1 && !p.equipo2_id);
    assert.equal((await app.post('torneo?action=guardarPartido', { id: descanso.id, ...GANA_1 })).status, 400);
});

test('historial: archivar un torneo terminado y empezar otro', async () => {
    const app = crearApp();
    await app.login();
    await nuevoTorneo(app, 4, 'Primavera');

    // No se puede archivar sin final
    assert.equal((await app.post('torneo?action=archivarTorneo', { nombre: 'Open' })).status, 409);

    const terminado = await jugarHastaElFinal(app);
    const final = terminado.partidos[terminado.partidos.length - 1];
    const r = await app.post('torneo?action=archivarTorneo', { nombre: 'Open de Primavera' });
    assert.deepEqual([r.success, r.nombre], [true, 'Open de Primavera']);

    // Ya no hay torneo actual: se puede empezar otro
    assert.equal(await getTorneo(app), null);
    await nuevoTorneo(app, 2, 'Otoño');

    // El historial conserva el archivado con campeón y subcampeón
    const historial = (await app.call('torneo?action=getHistorial')).data;
    assert.equal(historial.length, 1);
    const h = historial[0];
    assert.deepEqual([h.nombre, h.num_equipos, h.campeon], ['Open de Primavera', 4, terminado.torneo.ganador]);
    assert.equal(h.subcampeon, final.ganador === final.equipo1 ? final.equipo2 : final.equipo1);
    assert.ok(h.finalizado_en > 0);

    // Se puede consultar su cuadro, pero no modificarlo
    const archivado = await getTorneo(app, h.id);
    assert.equal(archivado.torneo.estado, 'archivado');
    assert.equal(archivado.torneo.ganador, terminado.torneo.ganador);
    assert.equal((await app.post('torneo?action=guardarPartido', { id: final.id, ...GANA_2 })).status, 404);
    assert.equal((await app.post('torneo?action=renameEquipo', { id: archivado.equipos[0].id, nombre: 'X' })).status, 409);

    // Resetear el torneo actual no borra el historial
    await app.post('torneo?action=resetTorneo');
    assert.equal((await app.call('torneo?action=getHistorial')).data.length, 1);
    assert.equal((await getTorneo(app, h.id)).partidos.length, 3);
    assert.equal((await app.call('torneo?action=getTorneo&id=999')).status, 404);
});

test('archivar sin nombre usa uno por defecto con la fecha', async () => {
    const app = crearApp();
    await app.login();
    await nuevoTorneo(app, 2);
    await jugarHastaElFinal(app);
    const r = await app.post('torneo?action=archivarTorneo', {});
    assert.match(r.nombre, /^Torneo \d{1,2}\/\d{1,2}\/\d{4}$/);
});
