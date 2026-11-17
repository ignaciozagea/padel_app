// =====================================================
// CLOUDFLARE PAGES FUNCTIONS - API PARA APP DE PÁDEL
// =====================================================
// Requiere:
//   - Binding D1 "DB" (ver wrangler.toml) con las migraciones de /migrations aplicadas
//   - Secreto ADMIN_PASSWORD (wrangler pages secret put ADMIN_PASSWORD)

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
};

const LIGAS_VALIDAS = ['masculino_avanzado', 'masculino_intermedio', 'masculino_iniciacion', 'femenino'];
const MAX_NOMBRE = 60;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

// Límite de intentos de login por IP
const LOGIN_MAX_FALLOS = 5;
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_BLOQUEO_MS = 15 * 60 * 1000;

// Acciones que modifican datos: requieren token de administrador
const ACCIONES_ADMIN = {
    liga: ['addEquipo', 'renameEquipo', 'deleteEquipo', 'generarCalendario',
           'guardarResultado', 'anularResultado', 'resetLiga'],
    torneo: ['addEquipo', 'renameEquipo', 'deleteEquipo', 'crearTorneo',
             'guardarPartido', 'anularPartido', 'resetTorneo']
};

class HttpError extends Error {
    constructor(status, message, headers = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
    }
}

function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, ...extraHeaders } });
}

async function leerJson(request) {
    try {
        return await request.json();
    } catch {
        throw new HttpError(400, 'Cuerpo de la petición no válido');
    }
}

function exigirPost(request) {
    if (request.method !== 'POST') throw new HttpError(405, 'Método no permitido');
}

// =====================================================
// PUNTO DE ENTRADA
// =====================================================
export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    try {
        if (path === 'login') {
            return await handleLogin(request, env);
        }

        const recurso = path.split('/')[0];
        if (recurso !== 'liga' && recurso !== 'torneo') {
            throw new HttpError(404, 'Ruta no encontrada');
        }

        const action = url.searchParams.get('action');
        if (ACCIONES_ADMIN[recurso].includes(action)) {
            exigirPost(request);
            if (!(await tokenValido(request, env.ADMIN_PASSWORD))) {
                throw new HttpError(401, 'No autorizado');
            }
        }

        if (recurso === 'liga') return await handleLiga(request, env.DB, url, action);
        return await handleTorneo(request, env.DB, action);
    } catch (error) {
        if (error instanceof HttpError) {
            return json({ success: false, error: error.message }, error.status, error.headers);
        }
        console.error('Error:', error);
        return json({ success: false, error: 'Error interno del servidor' }, 500);
    }
}

// =====================================================
// AUTENTICACIÓN (token firmado con HMAC + límite de intentos)
// =====================================================
async function hmacHex(secret, mensaje) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode('padel-admin:' + secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const firma = await crypto.subtle.sign('HMAC', key, enc.encode(mensaje));
    return [...new Uint8Array(firma)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function compararSeguro(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}

async function tokenValido(request, secret) {
    if (!secret) return false;
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer (\d+)\.([0-9a-f]{64})$/);
    if (!m) return false;
    if (Number(m[1]) < Date.now()) return false;
    return compararSeguro(m[2], await hmacHex(secret, m[1]));
}

function minutos(ms) {
    const n = Math.max(1, Math.ceil(ms / 60000));
    return `${n} minuto${n === 1 ? '' : 's'}`;
}

async function handleLogin(request, env) {
    exigirPost(request);
    if (!env.ADMIN_PASSWORD) {
        throw new HttpError(500, 'El servidor no tiene configurada la contraseña de administrador');
    }

    const db = env.DB;
    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    const ahora = Date.now();

    const registro = await db.prepare('SELECT * FROM login_intentos WHERE ip = ?').bind(ip).first();
    if (registro && registro.bloqueado_hasta > ahora) {
        const espera = registro.bloqueado_hasta - ahora;
        throw new HttpError(429, `Demasiados intentos fallidos. Prueba de nuevo en ${minutos(espera)}.`,
            { 'Retry-After': String(Math.ceil(espera / 1000)) });
    }

    const data = await leerJson(request);
    if (compararSeguro(String(data.password ?? ''), env.ADMIN_PASSWORD)) {
        if (registro) await db.prepare('DELETE FROM login_intentos WHERE ip = ?').bind(ip).run();
        const exp = String(ahora + TOKEN_TTL_MS);
        const token = `${exp}.${await hmacHex(env.ADMIN_PASSWORD, exp)}`;
        return json({ success: true, token });
    }

    // Contraseña incorrecta: contar el fallo dentro de la ventana de tiempo
    const nuevaVentana = !registro || ahora - registro.ventana_inicio > LOGIN_VENTANA_MS;
    const fallos = nuevaVentana ? 1 : registro.fallos + 1;
    const ventanaInicio = nuevaVentana ? ahora : registro.ventana_inicio;
    const bloqueadoHasta = fallos >= LOGIN_MAX_FALLOS ? ahora + LOGIN_BLOQUEO_MS : 0;

    await db.batch([
        db.prepare(`
            INSERT INTO login_intentos (ip, fallos, ventana_inicio, bloqueado_hasta) VALUES (?, ?, ?, ?)
            ON CONFLICT(ip) DO UPDATE SET
                fallos = excluded.fallos,
                ventana_inicio = excluded.ventana_inicio,
                bloqueado_hasta = excluded.bloqueado_hasta
        `).bind(ip, fallos, ventanaInicio, bloqueadoHasta),
        // Limpieza de registros antiguos
        db.prepare('DELETE FROM login_intentos WHERE ventana_inicio < ? AND bloqueado_hasta < ?')
            .bind(ahora - 24 * 60 * 60 * 1000, ahora)
    ]);

    if (bloqueadoHasta) {
        throw new HttpError(429, `Demasiados intentos fallidos. Acceso bloqueado durante ${minutos(LOGIN_BLOQUEO_MS)}.`,
            { 'Retry-After': String(LOGIN_BLOQUEO_MS / 1000) });
    }
    const restantes = LOGIN_MAX_FALLOS - fallos;
    throw new HttpError(401, `Contraseña incorrecta (${restantes} intento${restantes === 1 ? '' : 's'} restante${restantes === 1 ? '' : 's'})`);
}

// =====================================================
// VALIDACIONES COMUNES
// =====================================================
function validarNombre(nombre) {
    const limpio = String(nombre ?? '').trim();
    if (!limpio) throw new HttpError(400, 'El nombre no puede estar vacío');
    if (limpio.length > MAX_NOMBRE) throw new HttpError(400, `El nombre no puede superar ${MAX_NOMBRE} caracteres`);
    return limpio;
}

function validarLiga(liga) {
    if (!LIGAS_VALIDAS.includes(liga)) throw new HttpError(400, 'Liga no válida');
    return liga;
}

function leerJuegos(valor, numSet) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 7) {
        throw new HttpError(400, `Valor no válido en el set ${numSet} (debe ser un número entre 0 y 7)`);
    }
    return n;
}

// Valida un resultado al mejor de 3 sets y devuelve los sets normalizados
function analizarSets(data) {
    const sets = [1, 2, 3].map(i => ({
        local: leerJuegos(data[`set${i}_local`], i),
        visitante: leerJuegos(data[`set${i}_visitante`], i)
    }));

    for (let i = 0; i < 2; i++) {
        if (sets[i].local === null || sets[i].visitante === null) {
            throw new HttpError(400, `El set ${i + 1} es obligatorio`);
        }
    }
    const set3Parcial = (sets[2].local === null) !== (sets[2].visitante === null);
    if (set3Parcial) throw new HttpError(400, 'Completa los dos valores del set 3');
    const haySet3 = sets[2].local !== null;

    let setsLocal = 0;
    let setsVisitante = 0;
    const jugados = haySet3 ? sets : sets.slice(0, 2);
    jugados.forEach((s, i) => {
        if (s.local === s.visitante) throw new HttpError(400, `El set ${i + 1} no puede quedar empatado`);
        if (i < 2) s.local > s.visitante ? setsLocal++ : setsVisitante++;
    });

    if (setsLocal === 1 && setsVisitante === 1) {
        if (!haySet3) throw new HttpError(400, 'Con 1-1 en sets hay que indicar el resultado del set 3');
        sets[2].local > sets[2].visitante ? setsLocal++ : setsVisitante++;
    } else if (haySet3) {
        throw new HttpError(400, 'No se juega set 3 si un equipo ha ganado los dos primeros');
    }

    return { sets, setsLocal, setsVisitante };
}

function mezclar(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// =====================================================
// LIGA
// =====================================================
async function obtenerEquipoLiga(db, id) {
    const equipo = await db.prepare('SELECT * FROM liga_equipos WHERE id = ?').bind(id).first();
    if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
    return equipo;
}

async function comprobarNombreLibreLiga(db, liga, nombre, exceptoId = 0) {
    const existe = await db.prepare(
        'SELECT 1 FROM liga_equipos WHERE liga_nombre = ? AND LOWER(nombre) = LOWER(?) AND id <> ?'
    ).bind(liga, nombre, exceptoId).first();
    if (existe) throw new HttpError(409, 'Ya existe un equipo con ese nombre en esta liga');
}

// Calendario todos contra todos (método del círculo). Devuelve [[ [localId, visitanteId], ... ], ...]
function roundRobin(ids) {
    const t = mezclar(ids);
    if (t.length % 2 !== 0) t.push(null); // null = descansa
    const n = t.length;
    const jornadas = [];
    for (let j = 0; j < n - 1; j++) {
        const partidos = [];
        for (let i = 0; i < n / 2; i++) {
            const a = t[i];
            const b = t[n - 1 - i];
            // Alternar local/visitante entre jornadas
            if (a !== null && b !== null) partidos.push(j % 2 === 0 ? [a, b] : [b, a]);
        }
        jornadas.push(partidos);
        t.splice(1, 0, t.pop());
    }
    return jornadas;
}

async function handleLiga(request, db, url, action) {
    switch (action) {
        case 'getEquipos': {
            // La clasificación se calcula a partir de los partidos jugados
            const liga = validarLiga(url.searchParams.get('liga') || 'masculino_avanzado');
            const result = await db.prepare(`
                WITH resultados AS (
                    SELECT local_id AS equipo_id, puntos_local AS pts
                    FROM liga_calendario WHERE liga_nombre = ?1 AND completado = 1
                    UNION ALL
                    SELECT visitante_id, puntos_visitante
                    FROM liga_calendario WHERE liga_nombre = ?1 AND completado = 1
                )
                SELECT e.id, e.nombre,
                       COUNT(r.equipo_id)          AS pj,
                       COALESCE(SUM(r.pts = 3), 0) AS pg,
                       COALESCE(SUM(r.pts = 1), 0) AS pp1,
                       COALESCE(SUM(r.pts = 0), 0) AS pp0,
                       COALESCE(SUM(r.pts), 0)     AS puntos
                FROM liga_equipos e
                LEFT JOIN resultados r ON r.equipo_id = e.id
                WHERE e.liga_nombre = ?1
                GROUP BY e.id, e.nombre
                ORDER BY e.nombre
            `).bind(liga).all();
            return json({ success: true, data: result.results });
        }

        case 'addEquipo': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            const nombre = validarNombre(data.nombre);
            await comprobarNombreLibreLiga(db, liga, nombre);

            await db.prepare('INSERT INTO liga_equipos (liga_nombre, nombre) VALUES (?, ?)')
                .bind(liga, nombre).run();
            return json({ success: true });
        }

        case 'renameEquipo': {
            const data = await leerJson(request);
            const equipo = await obtenerEquipoLiga(db, data.id);
            const nombre = validarNombre(data.nombre);
            await comprobarNombreLibreLiga(db, equipo.liga_nombre, nombre, equipo.id);

            await db.prepare('UPDATE liga_equipos SET nombre = ? WHERE id = ?').bind(nombre, equipo.id).run();
            return json({ success: true });
        }

        case 'deleteEquipo': {
            const data = await leerJson(request);
            const equipo = await obtenerEquipoLiga(db, data.id);

            const tienePartidos = await db.prepare(
                'SELECT 1 FROM liga_calendario WHERE local_id = ?1 OR visitante_id = ?1 LIMIT 1'
            ).bind(equipo.id).first();
            if (tienePartidos) {
                throw new HttpError(409, 'No se puede eliminar un equipo con partidos en el calendario. Resetea la liga primero.');
            }

            await db.prepare('DELETE FROM liga_equipos WHERE id = ?').bind(equipo.id).run();
            return json({ success: true });
        }

        case 'getCalendario': {
            const liga = validarLiga(url.searchParams.get('liga') || 'masculino_avanzado');
            const result = await db.prepare(`
                SELECT c.*, l.nombre AS local, v.nombre AS visitante
                FROM liga_calendario c
                JOIN liga_equipos l ON l.id = c.local_id
                JOIN liga_equipos v ON v.id = c.visitante_id
                WHERE c.liga_nombre = ?
                ORDER BY c.jornada, c.id
            `).bind(liga).all();

            const calendario = {};
            for (const partido of result.results) {
                (calendario[partido.jornada] ??= []).push(partido);
            }
            return json({ success: true, data: calendario });
        }

        case 'generarCalendario': {
            // El calendario se genera en el servidor con los equipos inscritos
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);

            const equiposRes = await db.prepare('SELECT id FROM liga_equipos WHERE liga_nombre = ?')
                .bind(liga).all();
            const ids = equiposRes.results.map(e => e.id);
            if (ids.length < 2) throw new HttpError(400, 'Se necesitan al menos 2 equipos');

            const insert = db.prepare(
                'INSERT INTO liga_calendario (liga_nombre, jornada, local_id, visitante_id) VALUES (?, ?, ?, ?)'
            );
            // Al regenerar el calendario se borran los resultados anteriores
            const batch = [db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga)];
            roundRobin(ids).forEach((jornada, idx) => {
                jornada.forEach(([local, visitante]) => batch.push(insert.bind(liga, idx + 1, local, visitante)));
            });

            await db.batch(batch);
            return json({ success: true });
        }

        case 'guardarResultado': {
            // Sirve tanto para registrar un resultado nuevo como para corregir uno existente
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            const { sets, setsLocal, setsVisitante } = analizarSets(data);

            const partido = await db.prepare(
                'SELECT id FROM liga_calendario WHERE id = ? AND liga_nombre = ?'
            ).bind(data.id, liga).first();
            if (!partido) throw new HttpError(404, 'Partido no encontrado');

            // 3 puntos al ganador; el perdedor suma 1 si ganó un set (2-1) y 0 si perdió 2-0
            const ganaLocal = setsLocal > setsVisitante;
            const puntosLocal = ganaLocal ? 3 : (setsLocal > 0 ? 1 : 0);
            const puntosVisitante = ganaLocal ? (setsVisitante > 0 ? 1 : 0) : 3;

            await db.prepare(`
                UPDATE liga_calendario
                SET completado = 1,
                    set1_local = ?, set1_visitante = ?,
                    set2_local = ?, set2_visitante = ?,
                    set3_local = ?, set3_visitante = ?,
                    puntos_local = ?, puntos_visitante = ?
                WHERE id = ?
            `).bind(
                sets[0].local, sets[0].visitante,
                sets[1].local, sets[1].visitante,
                sets[2].local, sets[2].visitante,
                puntosLocal, puntosVisitante,
                partido.id
            ).run();

            return json({ success: true });
        }

        case 'anularResultado': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            const partido = await db.prepare(
                'SELECT id FROM liga_calendario WHERE id = ? AND liga_nombre = ?'
            ).bind(data.id, liga).first();
            if (!partido) throw new HttpError(404, 'Partido no encontrado');

            await db.prepare(`
                UPDATE liga_calendario
                SET completado = 0,
                    set1_local = NULL, set1_visitante = NULL,
                    set2_local = NULL, set2_visitante = NULL,
                    set3_local = NULL, set3_visitante = NULL,
                    puntos_local = NULL, puntos_visitante = NULL
                WHERE id = ?
            `).bind(partido.id).run();
            return json({ success: true });
        }

        case 'resetLiga': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            await db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga).run();
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}

// =====================================================
// TORNEO
// =====================================================
async function obtenerTorneoActual(db) {
    return await db.prepare(
        "SELECT * FROM torneo WHERE estado IN ('activo', 'configuracion') ORDER BY id DESC LIMIT 1"
    ).first();
}

async function torneoTienePartidos(db, torneoId) {
    const r = await db.prepare('SELECT 1 FROM torneo_partidos WHERE torneo_id = ? LIMIT 1')
        .bind(torneoId).first();
    return !!r;
}

async function obtenerEquipoTorneo(db, id) {
    const equipo = await db.prepare('SELECT * FROM torneo_equipos WHERE id = ?').bind(id).first();
    if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
    return equipo;
}

async function comprobarNombreLibreTorneo(db, torneoId, nombre, exceptoId = 0) {
    const existe = await db.prepare(
        'SELECT 1 FROM torneo_equipos WHERE torneo_id = ? AND LOWER(nombre) = LOWER(?) AND id <> ?'
    ).bind(torneoId, nombre, exceptoId).first();
    if (existe) throw new HttpError(409, 'El equipo ya existe');
}

// Partido del torneo activo + el partido de la ronda siguiente al que llega su ganador
async function obtenerPartidoTorneo(db, id) {
    const torneo = await db.prepare(
        "SELECT id FROM torneo WHERE estado = 'activo' ORDER BY id DESC LIMIT 1"
    ).first();
    if (!torneo) throw new HttpError(400, 'No hay torneo activo');

    const partido = await db.prepare(
        'SELECT * FROM torneo_partidos WHERE id = ? AND torneo_id = ?'
    ).bind(id, torneo.id).first();
    if (!partido) throw new HttpError(404, 'Partido no encontrado');
    if (!partido.equipo1_id || !partido.equipo2_id) throw new HttpError(400, 'Faltan rivales en este partido');

    const siguiente = await db.prepare(
        'SELECT * FROM torneo_partidos WHERE torneo_id = ? AND ronda = ? AND orden = ?'
    ).bind(torneo.id, partido.ronda + 1, Math.floor(partido.orden / 2)).first();

    if (partido.completado && siguiente?.completado) {
        throw new HttpError(409, 'No se puede modificar: el ganador ya ha jugado el partido de la ronda siguiente');
    }
    const campoSiguiente = partido.orden % 2 === 0 ? 'equipo1_id' : 'equipo2_id';
    return { partido, siguiente, campoSiguiente };
}

async function handleTorneo(request, db, action) {
    switch (action) {
        case 'getTorneo': {
            const torneo = await obtenerTorneoActual(db);
            if (!torneo) return json({ success: true, data: null });

            const [equipos, partidos] = await Promise.all([
                db.prepare('SELECT id, nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden, id')
                    .bind(torneo.id).all(),
                db.prepare(`
                    SELECT p.*, e1.nombre AS equipo1, e2.nombre AS equipo2, g.nombre AS ganador
                    FROM torneo_partidos p
                    LEFT JOIN torneo_equipos e1 ON e1.id = p.equipo1_id
                    LEFT JOIN torneo_equipos e2 ON e2.id = p.equipo2_id
                    LEFT JOIN torneo_equipos g  ON g.id  = p.ganador_id
                    WHERE p.torneo_id = ?
                    ORDER BY p.ronda, p.orden
                `).bind(torneo.id).all()
            ]);

            // El campeón es el ganador de la final (la última ronda)
            const final = partidos.results[partidos.results.length - 1];
            const ganador = final && final.completado ? final.ganador : null;

            return json({
                success: true,
                data: { torneo: { ...torneo, ganador }, equipos: equipos.results, partidos: partidos.results }
            });
        }

        case 'addEquipo': {
            const data = await leerJson(request);
            const nombre = validarNombre(data.nombre);

            let torneo = await obtenerTorneoActual(db);
            if (!torneo) {
                torneo = await db.prepare(
                    "INSERT INTO torneo (estado) VALUES ('configuracion') RETURNING id"
                ).first();
            } else if (await torneoTienePartidos(db, torneo.id)) {
                throw new HttpError(409, 'El torneo ya está generado. Resetéalo para cambiar los equipos.');
            }
            await comprobarNombreLibreTorneo(db, torneo.id, nombre);

            await db.prepare(`
                INSERT INTO torneo_equipos (torneo_id, nombre, orden)
                VALUES (?1, ?2, (SELECT COALESCE(MAX(orden), -1) + 1 FROM torneo_equipos WHERE torneo_id = ?1))
            `).bind(torneo.id, nombre).run();

            return json({ success: true });
        }

        case 'renameEquipo': {
            const data = await leerJson(request);
            const equipo = await obtenerEquipoTorneo(db, data.id);
            const nombre = validarNombre(data.nombre);
            await comprobarNombreLibreTorneo(db, equipo.torneo_id, nombre, equipo.id);

            await db.prepare('UPDATE torneo_equipos SET nombre = ? WHERE id = ?').bind(nombre, equipo.id).run();
            return json({ success: true });
        }

        case 'deleteEquipo': {
            const data = await leerJson(request);
            const equipo = await obtenerEquipoTorneo(db, data.id);
            if (await torneoTienePartidos(db, equipo.torneo_id)) {
                throw new HttpError(409, 'El torneo ya está generado. Resetéalo para cambiar los equipos.');
            }
            await db.prepare('DELETE FROM torneo_equipos WHERE id = ?').bind(equipo.id).run();
            return json({ success: true });
        }

        case 'crearTorneo': {
            // Sorteo con los equipos inscritos en la base de datos
            const torneo = await obtenerTorneoActual(db);
            const equiposRes = torneo
                ? await db.prepare('SELECT id FROM torneo_equipos WHERE torneo_id = ?').bind(torneo.id).all()
                : { results: [] };
            const ids = equiposRes.results.map(e => e.id);
            if (ids.length < 2) throw new HttpError(400, 'Se necesitan al menos 2 equipos');

            const insertPartido = db.prepare(
                'INSERT INTO torneo_partidos (torneo_id, ronda, orden, equipo1_id, equipo2_id, ganador_id, completado) VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            const batch = [
                db.prepare('DELETE FROM torneo_partidos WHERE torneo_id = ?').bind(torneo.id),
                db.prepare("UPDATE torneo SET estado = 'activo' WHERE id = ?").bind(torneo.id)
            ];

            // Cuadro de eliminación directa
            const numRondas = Math.ceil(Math.log2(ids.length));
            const partidosR1 = Math.pow(2, numRondas) / 2;
            const numDescansos = partidosR1 * 2 - ids.length;
            const sorteo = mezclar(ids);

            // Primera ronda: los descansos van siempre contra un equipo (nunca dos descansos juntos)
            const ronda1 = [];
            for (let i = 0; i < partidosR1; i++) {
                ronda1.push(i < numDescansos
                    ? { e1: sorteo.shift(), e2: null }
                    : { e1: sorteo.shift(), e2: sorteo.shift() });
            }
            // Repartir los descansos por el cuadro
            const ronda1Mezclada = mezclar(ronda1);
            ronda1Mezclada.forEach((p, i) => {
                const esDescanso = p.e2 === null;
                batch.push(insertPartido.bind(
                    torneo.id, 1, i, p.e1, p.e2,
                    esDescanso ? p.e1 : null, esDescanso ? 1 : 0
                ));
            });

            // Rondas siguientes; en la ronda 2 ya se colocan los que pasan por descanso
            for (let ronda = 2, n = partidosR1 / 2; ronda <= numRondas; ronda++, n /= 2) {
                for (let i = 0; i < n; i++) {
                    let e1 = null;
                    let e2 = null;
                    if (ronda === 2) {
                        const a = ronda1Mezclada[2 * i];
                        const b = ronda1Mezclada[2 * i + 1];
                        if (a.e2 === null) e1 = a.e1;
                        if (b.e2 === null) e2 = b.e1;
                    }
                    batch.push(insertPartido.bind(torneo.id, ronda, i, e1, e2, null, 0));
                }
            }

            await db.batch(batch);
            return json({ success: true, torneoId: torneo.id });
        }

        case 'guardarPartido': {
            // Registra un resultado nuevo o corrige uno existente (si el ganador aún no ha jugado la ronda siguiente)
            const data = await leerJson(request);
            const { partido, siguiente, campoSiguiente } = await obtenerPartidoTorneo(db, data.id);
            const { sets, setsLocal, setsVisitante } = analizarSets(data);
            const ganadorId = setsLocal > setsVisitante ? partido.equipo1_id : partido.equipo2_id;

            const batch = [
                db.prepare(`
                    UPDATE torneo_partidos
                    SET ganador_id = ?, completado = 1,
                        set1_local = ?, set1_visitante = ?,
                        set2_local = ?, set2_visitante = ?,
                        set3_local = ?, set3_visitante = ?
                    WHERE id = ?
                `).bind(
                    ganadorId,
                    sets[0].local, sets[0].visitante,
                    sets[1].local, sets[1].visitante,
                    sets[2].local, sets[2].visitante,
                    partido.id
                )
            ];
            if (siguiente) {
                batch.push(db.prepare(`UPDATE torneo_partidos SET ${campoSiguiente} = ? WHERE id = ?`)
                    .bind(ganadorId, siguiente.id));
            }
            await db.batch(batch);

            const ganador = await db.prepare('SELECT nombre FROM torneo_equipos WHERE id = ?').bind(ganadorId).first();
            return json({ success: true, ganador: ganador.nombre, setsLocal, setsVisitante });
        }

        case 'anularPartido': {
            const data = await leerJson(request);
            const { partido, siguiente, campoSiguiente } = await obtenerPartidoTorneo(db, data.id);
            if (!partido.completado) throw new HttpError(400, 'Este partido no tiene resultado');

            const batch = [
                db.prepare(`
                    UPDATE torneo_partidos
                    SET ganador_id = NULL, completado = 0,
                        set1_local = NULL, set1_visitante = NULL,
                        set2_local = NULL, set2_visitante = NULL,
                        set3_local = NULL, set3_visitante = NULL
                    WHERE id = ?
                `).bind(partido.id)
            ];
            if (siguiente) {
                batch.push(db.prepare(`UPDATE torneo_partidos SET ${campoSiguiente} = NULL WHERE id = ?`)
                    .bind(siguiente.id));
            }
            await db.batch(batch);
            return json({ success: true });
        }

        case 'resetTorneo': {
            await db.batch([
                db.prepare('DELETE FROM torneo_partidos'),
                db.prepare('DELETE FROM torneo_equipos'),
                db.prepare('DELETE FROM torneo')
            ]);
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}
