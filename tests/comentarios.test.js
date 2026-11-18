import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp } from './helpers/d1.js';

const L = 'femenino';

// Liga con un partido y, opcionalmente, el código de jugadores configurado
async function preparar({ codigo = 'Padel2026' } = {}) {
    const app = crearApp();
    await app.login();
    await app.post('liga?action=addEquipo', { liga: L, nombre: 'A' });
    await app.post('liga?action=addEquipo', { liga: L, nombre: 'B' });
    await app.post('liga?action=generarCalendario', { liga: L });
    const partido = Object.values((await app.call(`liga?action=getCalendario&liga=${L}`)).data).flat()[0];
    if (codigo) await app.post('comentarios?action=configurarCodigo', { codigo });
    return { app, partido };
}

// Comentario de un jugador (sin token de administrador)
async function comentarComoJugador(app, datos, ip = '20.0.0.1') {
    const token = app.getToken();
    app.setToken(null);
    const r = await app.call('comentarios?action=comentar', { method: 'POST', body: datos, ip });
    app.setToken(token);
    return r;
}

const comentarios = async (app, tipo, id) =>
    (await app.call(`comentarios?action=getComentarios&tipo=${tipo}&partido=${id}`)).data;

test('sin código configurado los comentarios están desactivados', async () => {
    const { app, partido } = await preparar({ codigo: '' });
    const conteo = (await app.call('comentarios?action=getConteo&tipo=liga')).data;
    assert.equal(conteo.activos, false);
    const r = await comentarComoJugador(app, { tipo: 'liga', partido_id: partido.id, autor: 'Ana', texto: 'Hola', codigo: 'x' });
    assert.equal(r.status, 403);
    assert.match(r.error, /no están activados/);
});

test('un jugador con el código comenta; sin él, no', async () => {
    const { app, partido } = await preparar();
    const base = { tipo: 'liga', partido_id: partido.id, autor: '  Ana  ', texto: '¡Partidazo! <b>vamos</b>' };

    const malo = await comentarComoJugador(app, { ...base, codigo: 'otro' });
    assert.equal(malo.status, 403);
    assert.match(malo.error, /incorrecto \(4 intentos restantes\)/);

    // El código no distingue mayúsculas y se recortan los espacios
    const ok = await comentarComoJugador(app, { ...base, codigo: ' padel2026 ' });
    assert.equal(ok.success, true);
    assert.equal(ok.comentario.autor, 'Ana');

    const d = await comentarios(app, 'liga', partido.id);
    assert.equal(d.activos, true);
    assert.equal(d.comentarios.length, 1);
    // El texto se guarda tal cual: la web lo muestra escapado, nunca como HTML
    assert.equal(d.comentarios[0].texto, '¡Partidazo! <b>vamos</b>');
    assert.ok(d.comentarios[0].creado_en > 0);
    assert.equal(d.comentarios[0].origen, undefined, 'no se expone la huella del remitente');

    const conteo = (await app.call('comentarios?action=getConteo&tipo=liga')).data;
    assert.deepEqual(conteo.partidos[partido.id], { total: 1, ultimo_autor: 'Ana', ultimo_texto: '¡Partidazo! <b>vamos</b>' });
});

test('5 códigos erróneos bloquean 15 minutos (sin afectar al login del administrador)', async () => {
    const { app, partido } = await preparar();
    const datos = { tipo: 'liga', partido_id: partido.id, autor: 'X', texto: 'spam', codigo: 'mal' };
    for (let i = 0; i < 4; i++) assert.equal((await comentarComoJugador(app, datos, '30.0.0.1')).status, 403);
    assert.equal((await comentarComoJugador(app, datos, '30.0.0.1')).status, 429);
    // Bloqueado aunque ahora ponga el código bueno; otra IP sí puede
    assert.equal((await comentarComoJugador(app, { ...datos, codigo: 'Padel2026' }, '30.0.0.1')).status, 429);
    assert.equal((await comentarComoJugador(app, { ...datos, codigo: 'Padel2026' }, '30.0.0.2')).success, true);
    // El bloqueo de comentarios no bloquea el login desde esa IP
    const login = await app.call('login', { method: 'POST', body: { password: 'secreto-de-test' }, ip: '30.0.0.1' });
    assert.equal(login.success, true);
});

test('límite de comentarios seguidos por persona', async () => {
    const { app, partido } = await preparar();
    const datos = { tipo: 'liga', partido_id: partido.id, autor: 'Ana', codigo: 'Padel2026' };
    for (let i = 1; i <= 10; i++) {
        assert.equal((await comentarComoJugador(app, { ...datos, texto: `mensaje ${i}` }, '40.0.0.1')).success, true);
    }
    const r = await comentarComoJugador(app, { ...datos, texto: 'uno más' }, '40.0.0.1');
    assert.equal(r.status, 429);
    // Otra persona puede seguir comentando
    assert.equal((await comentarComoJugador(app, { ...datos, texto: 'hola' }, '40.0.0.2')).success, true);
});

test('validaciones: nombre, texto, partido y tipo', async () => {
    const { app, partido } = await preparar();
    const ok = { tipo: 'liga', partido_id: partido.id, autor: 'Ana', texto: 'Hola', codigo: 'Padel2026' };
    assert.equal((await comentarComoJugador(app, { ...ok, autor: '   ' })).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, texto: '' })).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, texto: 'x'.repeat(501) })).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, autor: 'x'.repeat(41) })).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, partido_id: 9999 })).status, 404);
    assert.equal((await comentarComoJugador(app, { ...ok, tipo: 'otro' })).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, tipo: 'torneo' })).status, 404, 'el id es de la liga, no del torneo');
    assert.equal((await app.call('comentarios?action=getConteo&tipo=__proto__')).status, 400);
    assert.equal((await comentarComoJugador(app, { ...ok, texto: 'a\n\n\n\n\nb' })).comentario.texto, 'a\n\nb');
});

test('administración: código, borrar y comentar sin código', async () => {
    const { app, partido } = await preparar({ codigo: '' });
    // Solo el administrador ve y cambia el código
    assert.equal((await app.post('comentarios?action=configurarCodigo', { codigo: 'abc' })).status, 400, 'mínimo 4 caracteres');
    assert.equal((await app.post('comentarios?action=configurarCodigo', { codigo: 'Grupo-Jueves' })).activos, true);
    assert.equal((await app.post('comentarios?action=getCodigo')).codigo, 'Grupo-Jueves');

    // El administrador comenta sin código
    const r = await app.post('comentarios?action=comentar', { tipo: 'liga', partido_id: partido.id, autor: 'Organización', texto: 'Se juega a las 19:00' });
    assert.equal(r.success, true);
    assert.equal((await app.post('comentarios?action=borrarComentario', { id: r.comentario.id })).success, true);
    assert.equal((await comentarios(app, 'liga', partido.id)).comentarios.length, 0);
    assert.equal((await app.post('comentarios?action=borrarComentario', { id: r.comentario.id })).status, 404);

    // Código vacío = desactivar
    assert.equal((await app.post('comentarios?action=configurarCodigo', { codigo: '' })).activos, false);

    app.setToken(null);
    assert.equal((await app.post('comentarios?action=getCodigo')).status, 401);
    assert.equal((await app.post('comentarios?action=configurarCodigo', { codigo: 'hackeo' })).status, 401);
    assert.equal((await app.post('comentarios?action=borrarComentario', { id: 1 })).status, 401);
});

test('al desaparecer los partidos se borran sus comentarios', async () => {
    const { app, partido } = await preparar();
    const comentar = (tipo, id) => comentarComoJugador(app, { tipo, partido_id: id, autor: 'Ana', texto: 'hola', codigo: 'Padel2026' });
    const total = () => app.sqlite.prepare('SELECT tipo, COUNT(*) n FROM comentarios GROUP BY tipo').all()
        .reduce((o, f) => ({ ...o, [f.tipo]: f.n }), {});

    // Liga: regenerar el calendario borra los comentarios de los partidos antiguos
    await comentar('liga', partido.id);
    await app.post('liga?action=generarCalendario', { liga: L });
    assert.equal(total().liga, undefined);

    // Individual: deshacer la jornada
    for (const n of ['J1', 'J2', 'J3', 'J4']) await app.post('individual?action=addJugador', { nombre: n });
    await app.post('individual?action=generarJornada');
    const pInd = (await app.call('individual?action=getEstado')).data.partidos[0];
    assert.equal((await comentar('individual', pInd.id)).success, true);
    await app.post('individual?action=deshacerJornada');
    assert.equal(total().individual, undefined);

    // Torneo: los comentarios se mantienen al jugar y desaparecen al resetear
    for (const n of ['T1', 'T2']) await app.post('torneo?action=addEquipo', { nombre: n });
    await app.post('torneo?action=crearTorneo');
    const pTor = (await app.call('torneo?action=getTorneo')).data.partidos[0];
    assert.equal((await comentar('torneo', pTor.id)).success, true);
    await app.post('torneo?action=guardarPartido', { id: pTor.id, set1_local: 6, set1_visitante: 1, set2_local: 6, set2_visitante: 1 });
    assert.equal(total().torneo, 1);
    await app.post('torneo?action=resetTorneo');
    assert.equal(total().torneo, undefined);
});
