// =====================================================
// CLOUDFLARE PAGES FUNCTIONS - API PARA APP DE PÁDEL
// =====================================================
// Requiere:
//   - Binding D1 "DB" (ver wrangler.toml) con las migraciones de /migrations aplicadas
//   - Secreto ADMIN_PASSWORD (wrangler pages secret put ADMIN_PASSWORD)

// La web y la API se sirven desde el mismo dominio, así que no se envían cabeceras CORS:
// el navegador bloquea las llamadas a la API desde otras webs.
const API_HEADERS = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
};

const MAX_NOMBRE = 60;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

// Límite de intentos de login por IP
const LOGIN_MAX_FALLOS = 5;
const LOGIN_VENTANA_MS = 15 * 60 * 1000;
const LOGIN_BLOQUEO_MS = 15 * 60 * 1000;

// Acciones que modifican datos: requieren token de administrador
const ACCIONES_ADMIN = {
    liga: ['crearLiga', 'renombrarLiga', 'eliminarLiga',
           'addEquipo', 'renameEquipo', 'deleteEquipo', 'generarCalendario',
           'guardarResultado', 'anularResultado', 'resetLiga'],
    torneo: ['addEquipo', 'renameEquipo', 'deleteEquipo', 'crearTorneo',
             'guardarPartido', 'anularPartido', 'resetTorneo', 'archivarTorneo']
};

class HttpError extends Error {
    constructor(status, message, headers = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
    }
}

function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extraHeaders } });
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

    if (request.method !== 'GET' && request.method !== 'POST') {
        return json({ success: false, error: 'Método no permitido' }, 405, { Allow: 'GET, POST' });
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
        return await handleTorneo(request, env.DB, url, action);
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

// Comprueba que la liga existe en la tabla ligas y devuelve su slug
async function validarLiga(db, liga) {
    if (typeof liga !== 'string' || !liga) throw new HttpError(400, 'Falta la liga');
    const existe = await db.prepare('SELECT 1 FROM ligas WHERE slug = ?').bind(liga).first();
    if (!existe) throw new HttpError(404, 'Liga no encontrada');
    return liga;
}

// "👩 Femenino Avanzado" -> "femenino_avanzado"
function slugDe(nombre) {
    const base = nombre
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quitar tildes
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return base || 'liga';
}

function leerJuegos(valor, numSet) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > 7) {
        throw new HttpError(400, `Valor no válido en el set ${numSet} (debe ser un número entre 0 y 7)`);
    }
    return n;
}

// Un set de pádel termina 6-0..6-4, 7-5 o 7-6 (tie-break)
function setValido(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return (max === 6 && min <= 4) || (max === 7 && (min === 5 || min === 6));
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
        if (!setValido(s.local, s.visitante)) {
            throw new HttpError(400, `El set ${i + 1} (${s.local}-${s.visitante}) no es un resultado válido: debe ser 6-0 a 6-4, 7-5 o 7-6`);
        }
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

// Clasificación de la liga. Criterios, en orden:
//   1. Puntos
//   2. Enfrentamiento directo (solo si empatan exactamente dos equipos)
//   3. Diferencia de sets
//   4. Diferencia de juegos
//   5. Sets a favor
//   6. Nombre (orden alfabético)
function calcularClasificacion(equipos, partidos) {
    const stats = new Map(equipos.map(e => [e.id, {
        id: e.id, nombre: e.nombre,
        pj: 0, pg: 0, pp1: 0, pp0: 0, puntos: 0,
        sets_favor: 0, sets_contra: 0, juegos_favor: 0, juegos_contra: 0
    }]));
    const clave = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const ganadorDirecto = new Map();

    const sumar = (s, pts, sf, sc, jf, jc) => {
        s.pj++;
        s.puntos += pts;
        if (pts === 3) s.pg++; else if (pts === 1) s.pp1++; else s.pp0++;
        s.sets_favor += sf; s.sets_contra += sc;
        s.juegos_favor += jf; s.juegos_contra += jc;
    };

    for (const p of partidos) {
        const local = stats.get(p.local_id);
        const visitante = stats.get(p.visitante_id);
        if (!local || !visitante) continue;

        let sl = 0, sv = 0, jl = 0, jv = 0;
        for (let n = 1; n <= 3; n++) {
            const a = p[`set${n}_local`];
            const b = p[`set${n}_visitante`];
            if (a === null || a === undefined || b === null || b === undefined) continue;
            jl += a; jv += b;
            if (a > b) sl++; else sv++;
        }
        sumar(local, p.puntos_local, sl, sv, jl, jv);
        sumar(visitante, p.puntos_visitante, sv, sl, jv, jl);
        ganadorDirecto.set(clave(p.local_id, p.visitante_id), sl > sv ? p.local_id : p.visitante_id);
    }

    const lista = [...stats.values()];
    const empatadosPorPuntos = new Map();
    for (const s of lista) empatadosPorPuntos.set(s.puntos, (empatadosPorPuntos.get(s.puntos) || 0) + 1);

    lista.sort((a, b) => {
        if (a.puntos !== b.puntos) return b.puntos - a.puntos;
        if (empatadosPorPuntos.get(a.puntos) === 2) {
            const g = ganadorDirecto.get(clave(a.id, b.id));
            if (g === a.id) return -1;
            if (g === b.id) return 1;
        }
        return ((b.sets_favor - b.sets_contra) - (a.sets_favor - a.sets_contra))
            || ((b.juegos_favor - b.juegos_contra) - (a.juegos_favor - a.juegos_contra))
            || (b.sets_favor - a.sets_favor)
            || a.nombre.localeCompare(b.nombre, 'es');
    });

    return lista.map((s, i) => ({ ...s, posicion: i + 1 }));
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
        // ---------- Ligas ----------
        case 'getLigas': {
            const result = await db.prepare(`
                SELECT l.slug, l.nombre, l.orden,
                       (SELECT COUNT(*) FROM liga_equipos e WHERE e.liga_nombre = l.slug) AS num_equipos
                FROM ligas l
                ORDER BY l.orden, l.nombre
            `).all();
            return json({ success: true, data: result.results });
        }

        case 'crearLiga': {
            const data = await leerJson(request);
            const nombre = validarNombre(data.nombre);
            const repetida = await db.prepare('SELECT 1 FROM ligas WHERE LOWER(nombre) = LOWER(?)').bind(nombre).first();
            if (repetida) throw new HttpError(409, 'Ya existe una liga con ese nombre');

            // Slug único a partir del nombre (femenino, femenino_2, ...)
            const base = slugDe(nombre);
            let slug = base;
            for (let n = 2; await db.prepare('SELECT 1 FROM ligas WHERE slug = ?').bind(slug).first(); n++) {
                slug = `${base}_${n}`;
            }
            await db.prepare(`
                INSERT INTO ligas (slug, nombre, orden)
                VALUES (?, ?, (SELECT COALESCE(MAX(orden), 0) + 1 FROM ligas))
            `).bind(slug, nombre).run();
            return json({ success: true, slug, nombre });
        }

        case 'renombrarLiga': {
            const data = await leerJson(request);
            const slug = await validarLiga(db, data.slug);
            const nombre = validarNombre(data.nombre);
            const repetida = await db.prepare('SELECT 1 FROM ligas WHERE LOWER(nombre) = LOWER(?) AND slug <> ?')
                .bind(nombre, slug).first();
            if (repetida) throw new HttpError(409, 'Ya existe una liga con ese nombre');
            await db.prepare('UPDATE ligas SET nombre = ? WHERE slug = ?').bind(nombre, slug).run();
            return json({ success: true });
        }

        case 'eliminarLiga': {
            // Borra la liga con sus equipos y partidos
            const data = await leerJson(request);
            const slug = await validarLiga(db, data.slug);
            await db.batch([
                db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(slug),
                db.prepare('DELETE FROM liga_equipos WHERE liga_nombre = ?').bind(slug),
                db.prepare('DELETE FROM ligas WHERE slug = ?').bind(slug)
            ]);
            return json({ success: true });
        }

        // ---------- Equipos y partidos ----------
        case 'getEquipos': {
            // Devuelve los equipos ordenados por clasificación (calculada a partir de los partidos jugados)
            const liga = await validarLiga(db, url.searchParams.get('liga'));
            const [equipos, partidos] = await Promise.all([
                db.prepare('SELECT id, nombre FROM liga_equipos WHERE liga_nombre = ?').bind(liga).all(),
                db.prepare('SELECT * FROM liga_calendario WHERE liga_nombre = ? AND completado = 1').bind(liga).all()
            ]);
            return json({ success: true, data: calcularClasificacion(equipos.results, partidos.results) });
        }

        case 'addEquipo': {
            const data = await leerJson(request);
            const liga = await validarLiga(db, data.liga);
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
            const liga = await validarLiga(db, url.searchParams.get('liga'));
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
            const liga = await validarLiga(db, data.liga);

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
            const liga = await validarLiga(db, data.liga);
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
            const liga = await validarLiga(db, data.liga);
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
            const liga = await validarLiga(db, data.liga);
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
    const equipo = await db.prepare(`
        SELECT e.*, t.estado AS torneo_estado
        FROM torneo_equipos e JOIN torneo t ON t.id = e.torneo_id
        WHERE e.id = ?
    `).bind(id).first();
    if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
    if (equipo.torneo_estado === 'archivado') throw new HttpError(409, 'No se pueden modificar torneos archivados');
    return equipo;
}

// Partidos de un torneo con los nombres de los equipos
async function partidosTorneo(db, torneoId) {
    const r = await db.prepare(`
        SELECT p.*, e1.nombre AS equipo1, e2.nombre AS equipo2, g.nombre AS ganador
        FROM torneo_partidos p
        LEFT JOIN torneo_equipos e1 ON e1.id = p.equipo1_id
        LEFT JOIN torneo_equipos e2 ON e2.id = p.equipo2_id
        LEFT JOIN torneo_equipos g  ON g.id  = p.ganador_id
        WHERE p.torneo_id = ?
        ORDER BY p.ronda, p.orden
    `).bind(torneoId).all();
    return r.results;
}

// El campeón es el ganador de la final (último partido de la última ronda)
function campeonDe(partidos) {
    const final = partidos[partidos.length - 1];
    return final && final.completado ? final.ganador : null;
}

async function borrarTorneo(db, torneoId) {
    await db.batch([
        db.prepare('DELETE FROM torneo_partidos WHERE torneo_id = ?').bind(torneoId),
        db.prepare('DELETE FROM torneo_equipos WHERE torneo_id = ?').bind(torneoId),
        db.prepare('DELETE FROM torneo WHERE id = ?').bind(torneoId)
    ]);
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

async function handleTorneo(request, db, url, action) {
    switch (action) {
        case 'getTorneo': {
            // Sin id: el torneo actual. Con id: cualquier torneo (p. ej. uno archivado del historial)
            const id = url.searchParams.get('id');
            const torneo = id
                ? await db.prepare('SELECT * FROM torneo WHERE id = ?').bind(id).first()
                : await obtenerTorneoActual(db);
            if (!torneo) {
                if (id) throw new HttpError(404, 'Torneo no encontrado');
                return json({ success: true, data: null });
            }

            const [equipos, partidos] = await Promise.all([
                db.prepare('SELECT id, nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden, id')
                    .bind(torneo.id).all(),
                partidosTorneo(db, torneo.id)
            ]);

            return json({
                success: true,
                data: { torneo: { ...torneo, ganador: campeonDe(partidos) }, equipos: equipos.results, partidos }
            });
        }

        case 'getHistorial': {
            const result = await db.prepare(`
                SELECT t.id, t.nombre, t.creado_en, t.finalizado_en,
                       (SELECT COUNT(*) FROM torneo_equipos e WHERE e.torneo_id = t.id) AS num_equipos,
                       (SELECT g.nombre FROM torneo_partidos p JOIN torneo_equipos g ON g.id = p.ganador_id
                         WHERE p.torneo_id = t.id ORDER BY p.ronda DESC, p.orden DESC LIMIT 1) AS campeon,
                       (SELECT CASE WHEN p.ganador_id = p.equipo1_id THEN e2.nombre ELSE e1.nombre END
                          FROM torneo_partidos p
                          LEFT JOIN torneo_equipos e1 ON e1.id = p.equipo1_id
                          LEFT JOIN torneo_equipos e2 ON e2.id = p.equipo2_id
                         WHERE p.torneo_id = t.id ORDER BY p.ronda DESC, p.orden DESC LIMIT 1) AS subcampeon
                FROM torneo t
                WHERE t.estado = 'archivado'
                ORDER BY COALESCE(t.finalizado_en, 0) DESC, t.id DESC
            `).all();
            return json({ success: true, data: result.results });
        }

        case 'archivarTorneo': {
            // Guarda el torneo terminado en el historial; el siguiente equipo que se añada abre un torneo nuevo
            const data = await leerJson(request);
            const torneo = await obtenerTorneoActual(db);
            if (!torneo || torneo.estado !== 'activo') throw new HttpError(400, 'No hay ningún torneo en juego');
            if (!campeonDe(await partidosTorneo(db, torneo.id))) {
                throw new HttpError(409, 'Solo se puede archivar un torneo terminado (con la final jugada)');
            }
            const ahora = Date.now();
            const nombre = data.nombre === undefined || String(data.nombre).trim() === ''
                ? `Torneo ${new Date(ahora).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' })}`
                : validarNombre(data.nombre);

            await db.prepare("UPDATE torneo SET estado = 'archivado', nombre = ?, finalizado_en = ? WHERE id = ?")
                .bind(nombre, ahora, torneo.id).run();
            return json({ success: true, nombre });
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
                db.prepare("UPDATE torneo SET estado = 'activo', creado_en = ? WHERE id = ?").bind(Date.now(), torneo.id)
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
            // Borra solo el torneo actual; el historial (torneos archivados) se conserva
            const torneo = await obtenerTorneoActual(db);
            if (torneo) await borrarTorneo(db, torneo.id);
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}
