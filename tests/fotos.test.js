import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

// "JPEG" mínimo para las pruebas: la API solo comprueba la firma (FF D8 FF) y el tamaño
const jpeg = (relleno = 64) => 'data:image/jpeg;base64,'
    + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(relleno, 7), Buffer.from([0xFF, 0xD9])]).toString('base64');

async function ligaConPareja() {
    const app = crearApp();
    await app.login();
    await app.post('liga?action=addEquipo', { liga: 'femenino', nombre: 'Ana/Bea' });
    const equipo = (await app.call('liga?action=getEquipos&liga=femenino')).data[0];
    return { app, equipo };
}

const fotoDe = async (app, id) => (await app.call('liga?action=getEquipos&liga=femenino')).data.find(e => e.id === id).foto_v;

test('subir, ver, reemplazar y quitar la foto de una pareja', async () => {
    const { app, equipo } = await ligaConPareja();
    assert.equal(equipo.foto_v, null, 'sin foto al principio');

    const r = await app.post('fotos?action=subir', { tipo: 'pareja', id: equipo.id, imagen: jpeg() });
    assert.equal(r.success, true);
    assert.equal(await fotoDe(app, equipo.id), r.foto_v, 'la clasificación trae la versión de la foto');

    const img = await app.raw(`fotos?action=ver&tipo=pareja&id=${equipo.id}&v=${r.foto_v}`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.match(img.headers.get('cache-control'), /max-age=31536000/);
    const bytes = new Uint8Array(await img.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xFF, 0xD8, 0xFF]);

    // Reemplazar cambia la versión (y por tanto la URL: el navegador no usa la antigua)
    await new Promise(res => setTimeout(res, 5));
    const r2 = await app.post('fotos?action=subir', { tipo: 'pareja', id: equipo.id, imagen: jpeg(128) });
    assert.ok(r2.foto_v > r.foto_v);
    assert.equal(app.sqlite.prepare('SELECT COUNT(*) n FROM fotos').get().n, 1);

    assert.equal((await app.post('fotos?action=borrar', { tipo: 'pareja', id: equipo.id })).success, true);
    assert.equal(await fotoDe(app, equipo.id), null);
    assert.equal((await app.raw(`fotos?action=ver&tipo=pareja&id=${equipo.id}`)).status, 404);
});

test('foto de un jugador de la liga individual', async () => {
    const app = crearApp();
    await app.login();
    await app.post('individual?action=addJugador', { nombre: 'Ana' });
    const jugador = (await app.call('individual?action=getEstado')).data.jugadores[0];
    const r = await app.post('fotos?action=subir', { tipo: 'jugador', id: jugador.id, imagen: jpeg() });
    const estado = (await app.call('individual?action=getEstado')).data;
    assert.equal(estado.jugadores[0].foto_v, r.foto_v);
    assert.equal(estado.clasificacion[0].foto_v, r.foto_v);

    // Al borrar al jugador se borra su foto
    await app.post('individual?action=deleteJugador', { id: jugador.id });
    assert.equal(app.sqlite.prepare('SELECT COUNT(*) n FROM fotos').get().n, 0);
});

test('validaciones: formato, tamaño, destino y permisos', async () => {
    const { app, equipo } = await ligaConPareja();
    const subir = (datos) => app.post('fotos?action=subir', { tipo: 'pareja', id: equipo.id, ...datos });

    assert.equal((await subir({ imagen: 'data:image/png;base64,iVBORw0KGgo=' })).status, 400, 'PNG no');
    assert.equal((await subir({ imagen: 'data:image/jpeg;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') })).status, 400, 'no es JPEG aunque lo diga');
    assert.equal((await subir({ imagen: 'hola' })).status, 400);
    assert.equal((await subir({ imagen: jpeg(160 * 1024) })).status, 413, 'demasiado grande');
    assert.equal((await subir({ imagen: jpeg(), id: 9999 })).status, 404);
    assert.equal((await subir({ imagen: jpeg(), tipo: 'torneo' })).status, 400);
    assert.equal((await app.raw('fotos?action=ver&tipo=__proto__&id=1')).status, 400);

    const token = app.getToken();
    app.setToken(null);
    assert.equal((await subir({ imagen: jpeg() })).status, 401);
    assert.equal((await app.post('fotos?action=borrar', { tipo: 'pareja', id: equipo.id })).status, 401);
    app.setToken(token);
});

test('al borrar parejas o ligas se borran sus fotos', async () => {
    const { app, equipo } = await ligaConPareja();
    await app.post('fotos?action=subir', { tipo: 'pareja', id: equipo.id, imagen: jpeg() });
    await app.post('liga?action=deleteEquipo', { id: equipo.id });
    assert.equal(app.sqlite.prepare('SELECT COUNT(*) n FROM fotos').get().n, 0);

    await app.post('liga?action=crearLiga', { nombre: 'Temporal' });
    await app.post('liga?action=addEquipo', { liga: 'temporal', nombre: 'X/Y' });
    const otra = (await app.call('liga?action=getEquipos&liga=temporal')).data[0];
    await app.post('fotos?action=subir', { tipo: 'pareja', id: otra.id, imagen: jpeg() });
    await app.post('liga?action=eliminarLiga', { slug: 'temporal' });
    assert.equal(app.sqlite.prepare('SELECT COUNT(*) n FROM fotos').get().n, 0);
});
