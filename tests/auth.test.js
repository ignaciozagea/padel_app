import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApp, PASSWORD } from './helpers/d1.js';

test('la API no permite llamadas desde otros dominios (sin CORS)', async () => {
    const app = crearApp();
    const r = await app.call('liga?action=getEquipos&liga=femenino');
    assert.equal(r.success, true);
    assert.equal(r.cabeceras['access-control-allow-origin'], undefined);
    assert.equal(r.cabeceras['cache-control'], 'no-store');
    const preflight = await app.call('liga?action=getEquipos&liga=femenino', { method: 'OPTIONS' });
    assert.equal(preflight.status, 405);
    assert.equal(preflight.cabeceras['access-control-allow-origin'], undefined);
});

test('las acciones de administrador exigen un token válido y POST', async () => {
    const app = crearApp();
    const reset = { method: 'POST', body: { liga: 'femenino' } };

    assert.equal((await app.call('liga?action=resetLiga', { ...reset, auth: false })).status, 401);
    assert.equal((await app.call('liga?action=resetLiga')).status, 405);

    const { token } = await app.login();
    assert.ok(token);
    assert.equal((await app.call('liga?action=resetLiga', reset)).success, true);

    // Firma manipulada
    app.setToken(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'));
    assert.equal((await app.call('liga?action=resetLiga', reset)).status, 401);
    // Token caducado (la firma no cubre la nueva fecha)
    app.setToken(String(Date.now() - 1000) + token.slice(token.indexOf('.')));
    assert.equal((await app.call('liga?action=resetLiga', reset)).status, 401);

    // Las lecturas son públicas
    app.setToken(null);
    assert.equal((await app.call('liga?action=getEquipos&liga=femenino')).success, true);
});

test('tras 5 fallos de login la IP queda bloqueada 15 minutos', async () => {
    const app = crearApp();
    const login = (password, ip = '6.6.6.6') => app.call('login', { method: 'POST', body: { password }, ip });

    for (let i = 1; i <= 4; i++) {
        const r = await login('mal');
        assert.equal(r.status, 401);
        assert.match(r.error, new RegExp(`${5 - i} intento`));
    }
    const bloqueo = await login('mal');
    assert.equal(bloqueo.status, 429);
    assert.equal(bloqueo.retryAfter, '900');

    // Bloqueada incluso con la contraseña correcta; otra IP no está afectada
    assert.equal((await login(PASSWORD)).status, 429);
    assert.equal((await login(PASSWORD, '7.7.7.7')).success, true);

    // Al expirar el bloqueo se puede entrar y el contador se borra
    app.sqlite.prepare("UPDATE login_intentos SET bloqueado_hasta = 1, ventana_inicio = 1 WHERE ip = '6.6.6.6'").run();
    assert.equal((await login(PASSWORD)).success, true);
    assert.equal(app.sqlite.prepare("SELECT COUNT(*) n FROM login_intentos WHERE ip = '6.6.6.6'").get().n, 0);
    assert.match((await login('mal')).error, /4 intentos/);
});
