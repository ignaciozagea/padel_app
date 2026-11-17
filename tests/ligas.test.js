import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const getLigas = async app => (await app.call('liga?action=getLigas')).data;

test('la migración crea las 4 ligas originales en orden', async () => {
    const app = crearApp();
    const ligas = await getLigas(app);
    assert.deepEqual(ligas.map(l => l.slug),
        ['masculino_avanzado', 'masculino_intermedio', 'masculino_iniciacion', 'femenino']);
    assert.equal(ligas[3].nombre, 'Femenino'); // la 0007 quita el emoji de los nombres por defecto
});

test('crear, renombrar y eliminar ligas', async () => {
    const app = crearApp();
    await app.login();

    // Crear: el slug se genera a partir del nombre (sin emojis ni tildes) y es único
    const r1 = await app.post('liga?action=crearLiga', { nombre: '🧒 Iniciación Júnior' });
    assert.deepEqual([r1.success, r1.slug], [true, 'iniciacion_junior']);
    const r2 = await app.post('liga?action=crearLiga', { nombre: 'Iniciación Junior' });
    assert.equal(r2.slug, 'iniciacion_junior_2');
    assert.equal((await app.post('liga?action=crearLiga', { nombre: 'iniciación junior' })).status, 409);
    assert.equal((await app.post('liga?action=crearLiga', { nombre: '  ' })).status, 400);

    let ligas = await getLigas(app);
    assert.deepEqual(ligas.slice(-2).map(l => l.slug), ['iniciacion_junior', 'iniciacion_junior_2']);

    // Se puede usar como cualquier otra liga
    assert.equal((await app.post('liga?action=addEquipo', { liga: 'iniciacion_junior', nombre: 'A' })).success, true);
    assert.equal((await app.post('liga?action=addEquipo', { liga: 'iniciacion_junior', nombre: 'B' })).success, true);
    assert.equal((await app.post('liga?action=generarCalendario', { liga: 'iniciacion_junior' })).success, true);
    ligas = await getLigas(app);
    assert.equal(ligas.find(l => l.slug === 'iniciacion_junior').num_equipos, 2);

    // Renombrar cambia el nombre visible, no el slug
    assert.equal((await app.post('liga?action=renombrarLiga', { slug: 'iniciacion_junior', nombre: '🧒 Escuela' })).success, true);
    assert.equal((await app.post('liga?action=renombrarLiga', { slug: 'iniciacion_junior', nombre: 'femenino' })).status, 409);
    ligas = await getLigas(app);
    assert.equal(ligas.find(l => l.slug === 'iniciacion_junior').nombre, '🧒 Escuela');

    // Eliminar borra la liga con sus equipos y partidos
    assert.equal((await app.post('liga?action=eliminarLiga', { slug: 'iniciacion_junior' })).success, true);
    ligas = await getLigas(app);
    assert.ok(!ligas.some(l => l.slug === 'iniciacion_junior'));
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) n FROM liga_equipos WHERE liga_nombre = 'iniciacion_junior'").get().n, 0);
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) n FROM liga_calendario WHERE liga_nombre = 'iniciacion_junior'").get().n, 0);
    assert.equal((await app.call('liga?action=getEquipos&liga=iniciacion_junior')).status, 404);
    assert.equal((await app.post('liga?action=eliminarLiga', { slug: 'no_existe' })).status, 404);
});

test('gestionar ligas exige ser administrador', async () => {
    const app = crearApp();
    assert.equal((await app.post('liga?action=crearLiga', { nombre: 'Pirata' })).status, 401);
    assert.equal((await app.post('liga?action=eliminarLiga', { slug: 'femenino' })).status, 401);
    assert.equal((await app.post('liga?action=renombrarLiga', { slug: 'femenino', nombre: 'X' })).status, 401);
});
