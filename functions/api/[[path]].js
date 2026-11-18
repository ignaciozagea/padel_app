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
           'guardarResultado', 'anularResultado', 'resetLiga', 'configurarLiga'],
    torneo: ['addEquipo', 'renameEquipo', 'deleteEquipo', 'crearTorneo',
             'guardarPartido', 'anularPartido', 'resetTorneo', 'archivarTorneo', 'configurarTorneo'],
    individual: ['addJugador', 'renameJugador', 'deleteJugador', 'ordenarJugadores', 'generarJornada',
                 'deshacerJornada', 'guardarResultado', 'anularResultado', 'resetIndividual', 'configurar'],
    // "comentar" no está aquí: lo puede usar cualquiera con el código de jugadores
    comentarios: ['borrarComentario', 'configurarCodigo', 'getCodigo'],
    fotos: ['subir', 'borrar']
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
        if (!ACCIONES_ADMIN[recurso]) {
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
        if (recurso === 'individual') return await handleIndividual(request, env.DB, action);
        if (recurso === 'comentarios') return await handleComentarios(request, env, url, action);
        if (recurso === 'fotos') return await handleFotos(request, env.DB, url, action);
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

// ---------- Límite de intentos fallidos ----------
// Se usa para la contraseña de administrador (clave = IP) y para el código de los comentarios
// (clave = "comentarios:IP"): 5 fallos en 15 minutos bloquean esa clave durante 15 minutos.
async function comprobarBloqueo(db, clave) {
    const registro = await db.prepare('SELECT * FROM login_intentos WHERE ip = ?').bind(clave).first();
    const ahora = Date.now();
    if (registro && registro.bloqueado_hasta > ahora) {
        const espera = registro.bloqueado_hasta - ahora;
        throw new HttpError(429, `Demasiados intentos fallidos. Prueba de nuevo en ${minutos(espera)}.`,
            { 'Retry-After': String(Math.ceil(espera / 1000)) });
    }
    return registro;
}

// Cuenta un fallo. Si llega al máximo, lanza el error de bloqueo; si no, devuelve los intentos restantes.
async function registrarFallo(db, clave, registro) {
    const ahora = Date.now();
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
        `).bind(clave, fallos, ventanaInicio, bloqueadoHasta),
        // Limpieza de registros antiguos
        db.prepare('DELETE FROM login_intentos WHERE ventana_inicio < ? AND bloqueado_hasta < ?')
            .bind(ahora - 24 * 60 * 60 * 1000, ahora)
    ]);

    if (bloqueadoHasta) {
        throw new HttpError(429, `Demasiados intentos fallidos. Bloqueado durante ${minutos(LOGIN_BLOQUEO_MS)}.`,
            { 'Retry-After': String(LOGIN_BLOQUEO_MS / 1000) });
    }
    return LOGIN_MAX_FALLOS - fallos;
}

const textoRestantes = n => `${n} intento${n === 1 ? '' : 's'} restante${n === 1 ? '' : 's'}`;

async function handleLogin(request, env) {
    exigirPost(request);
    if (!env.ADMIN_PASSWORD) {
        throw new HttpError(500, 'El servidor no tiene configurada la contraseña de administrador');
    }

    const db = env.DB;
    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    const registro = await comprobarBloqueo(db, ip);

    const data = await leerJson(request);
    if (compararSeguro(String(data.password ?? ''), env.ADMIN_PASSWORD)) {
        if (registro) await db.prepare('DELETE FROM login_intentos WHERE ip = ?').bind(ip).run();
        const exp = String(Date.now() + TOKEN_TTL_MS);
        const token = `${exp}.${await hmacHex(env.ADMIN_PASSWORD, exp)}`;
        return json({ success: true, token });
    }

    const restantes = await registrarFallo(db, ip, registro);
    throw new HttpError(401, `Contraseña incorrecta (${textoRestantes(restantes)})`);
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

const MAX_PUNTOS_SUPER_TIEBREAK = 30;

function leerJuegos(valor, numSet, maximo = 7) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 0 || n > maximo) {
        throw new HttpError(400, `Valor no válido en el set ${numSet} (debe ser un número entre 0 y ${maximo})`);
    }
    return n;
}

// Un set de pádel termina 6-0..6-4, 7-5 o 7-6 (tie-break)
function setValido(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return (max === 6 && min <= 4) || (max === 7 && (min === 5 || min === 6));
}

// Súper tie-break: a 10 puntos con 2 de diferencia (10-0..10-8, 11-9, 12-10...)
function superTiebreakValido(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return (max === 10 && min <= 8) || (max > 10 && max - min === 2);
}

// Un tercer set guardado es un súper tie-break si alguien llegó a 10 o más
// (un set normal nunca pasa de 7), aunque la opción se haya cambiado después
function esSuperTiebreak(a, b) {
    return a !== null && a !== undefined && b !== null && b !== undefined && Math.max(a, b) >= 10;
}

// Valida un resultado al mejor de 3 sets y devuelve los sets normalizados.
// superTiebreak: el tercer set se juega como súper tie-break
function analizarSets(data, { superTiebreak = false } = {}) {
    const sets = [1, 2, 3].map(i => {
        const maximo = i === 3 && superTiebreak ? MAX_PUNTOS_SUPER_TIEBREAK : 7;
        return {
            local: leerJuegos(data[`set${i}_local`], i, maximo),
            visitante: leerJuegos(data[`set${i}_visitante`], i, maximo)
        };
    });

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
        if (i === 2 && superTiebreak) {
            if (!superTiebreakValido(s.local, s.visitante)) {
                throw new HttpError(400, `El súper tie-break (${s.local}-${s.visitante}) no es válido: se gana a 10 puntos con 2 de diferencia (10-8, 11-9, 12-10...)`);
            }
        } else if (!setValido(s.local, s.visitante)) {
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
// Sets y juegos ganados por cada lado de un partido jugado.
// El súper tie-break cuenta como un set y como un juego (1-0), no por sus puntos.
function contarSetsYJuegos(p) {
    let sl = 0, sv = 0, jl = 0, jv = 0;
    for (let n = 1; n <= 3; n++) {
        const a = p[`set${n}_local`];
        const b = p[`set${n}_visitante`];
        if (a === null || a === undefined || b === null || b === undefined) continue;
        if (n === 3 && esSuperTiebreak(a, b)) {
            if (a > b) jl++; else jv++;
        } else {
            jl += a; jv += b;
        }
        if (a > b) sl++; else sv++;
    }
    return { sl, sv, jl, jv };
}

// 3 puntos al ganador; el perdedor suma 1 si ganó un set (2-1) y 0 si perdió 2-0
function puntosPartido(setsLocal, setsVisitante) {
    const ganaLocal = setsLocal > setsVisitante;
    return {
        puntosLocal: ganaLocal ? 3 : (setsLocal > 0 ? 1 : 0),
        puntosVisitante: ganaLocal ? (setsVisitante > 0 ? 1 : 0) : 3
    };
}

function calcularClasificacion(equipos, partidos) {
    const stats = new Map(equipos.map(e => [e.id, {
        id: e.id, nombre: e.nombre, foto_v: e.foto_v ?? null,
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

        const { sl, sv, jl, jv } = contarSetsYJuegos(p);
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
                SELECT l.slug, l.nombre, l.orden, l.super_tiebreak,
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

        case 'configurarLiga': {
            // Opciones de la liga: por ahora, si el tercer set es un súper tie-break
            const data = await leerJson(request);
            const slug = await validarLiga(db, data.slug);
            if (typeof data.super_tiebreak !== 'boolean') throw new HttpError(400, 'Opción no válida');
            await db.prepare('UPDATE ligas SET super_tiebreak = ? WHERE slug = ?')
                .bind(data.super_tiebreak ? 1 : 0, slug).run();
            return json({ success: true });
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
                limpiarFotos(db, 'pareja'),
                db.prepare('DELETE FROM ligas WHERE slug = ?').bind(slug),
                limpiarComentarios(db, 'liga')
            ]);
            return json({ success: true });
        }

        // ---------- Equipos y partidos ----------
        case 'getEquipos': {
            // Devuelve los equipos ordenados por clasificación (calculada a partir de los partidos jugados)
            const liga = await validarLiga(db, url.searchParams.get('liga'));
            const [equipos, partidos] = await Promise.all([
                db.prepare(`
                    SELECT e.id, e.nombre, f.actualizado_en AS foto_v
                    FROM liga_equipos e
                    LEFT JOIN fotos f ON f.tipo = 'pareja' AND f.ref_id = e.id
                    WHERE e.liga_nombre = ?
                `).bind(liga).all(),
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

            await db.batch([
                db.prepare('DELETE FROM liga_equipos WHERE id = ?').bind(equipo.id),
                limpiarFotos(db, 'pareja')
            ]);
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

            batch.push(limpiarComentarios(db, 'liga'));   // los partidos del calendario anterior ya no existen
            await db.batch(batch);
            return json({ success: true });
        }

        case 'guardarResultado': {
            // Sirve tanto para registrar un resultado nuevo como para corregir uno existente
            const data = await leerJson(request);
            const liga = await validarLiga(db, data.liga);
            const { super_tiebreak } = await db.prepare('SELECT super_tiebreak FROM ligas WHERE slug = ?').bind(liga).first();
            const { sets, setsLocal, setsVisitante } = analizarSets(data, { superTiebreak: !!super_tiebreak });

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
            await db.batch([db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga), limpiarComentarios(db, 'liga')]);
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}

// =====================================================
// FOTOS DE PAREJAS Y JUGADORES
// =====================================================
// Las sube el administrador. El navegador las recorta y reduce (256x256 JPEG) antes de enviarlas;
// aquí solo se comprueba que son un JPEG de tamaño razonable y se guardan en base64.
const MAX_FOTO_BYTES = 150 * 1024;
const TABLA_FOTOS = { pareja: 'liga_equipos', jugador: 'individual_jugadores' };

function validarTipoFoto(tipo) {
    if (!Object.hasOwn(TABLA_FOTOS, tipo)) throw new HttpError(400, 'Tipo de foto no válido');
    return tipo;
}

// Borra las fotos de parejas o jugadores que ya no existen
function limpiarFotos(db, tipo) {
    return db.prepare(`DELETE FROM fotos WHERE tipo = ? AND ref_id NOT IN (SELECT id FROM ${TABLA_FOTOS[tipo]})`).bind(tipo);
}

// "data:image/jpeg;base64,...." -> base64 validado (JPEG y tamaño)
function validarImagen(valor) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(valor ?? ''));
    if (!m) throw new HttpError(400, 'La foto tiene que ser una imagen JPEG');
    let bytes;
    try {
        bytes = atob(m[1]);
    } catch {
        throw new HttpError(400, 'La foto no es válida');
    }
    if (bytes.length > MAX_FOTO_BYTES) throw new HttpError(413, 'La foto es demasiado grande');
    // Firma de un JPEG: FF D8 FF
    if (bytes.charCodeAt(0) !== 0xFF || bytes.charCodeAt(1) !== 0xD8 || bytes.charCodeAt(2) !== 0xFF) {
        throw new HttpError(400, 'La foto tiene que ser una imagen JPEG');
    }
    return m[1];
}

async function handleFotos(request, db, url, action) {
    switch (action) {
        case 'ver': {
            // Imagen JPEG. La URL lleva la versión (?v=...), así que el navegador la puede guardar mucho tiempo
            const tipo = validarTipoFoto(url.searchParams.get('tipo'));
            const id = Number(url.searchParams.get('id'));
            const foto = await db.prepare('SELECT imagen FROM fotos WHERE tipo = ? AND ref_id = ?').bind(tipo, id).first();
            if (!foto) throw new HttpError(404, 'Sin foto');
            const bytes = Uint8Array.from(atob(foto.imagen), c => c.charCodeAt(0));
            return new Response(bytes, {
                headers: {
                    'Content-Type': 'image/jpeg',
                    'Cache-Control': 'public, max-age=31536000, immutable',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        }

        case 'subir': {
            const data = await leerJson(request);
            const tipo = validarTipoFoto(data.tipo);
            const id = Number(data.id);
            const existe = await db.prepare(`SELECT 1 FROM ${TABLA_FOTOS[tipo]} WHERE id = ?`).bind(id).first();
            if (!existe) throw new HttpError(404, tipo === 'pareja' ? 'Pareja no encontrada' : 'Jugador no encontrado');
            const imagen = validarImagen(data.imagen);
            const version = Date.now();
            await db.prepare(`
                INSERT INTO fotos (tipo, ref_id, imagen, actualizado_en) VALUES (?, ?, ?, ?)
                ON CONFLICT(tipo, ref_id) DO UPDATE SET imagen = excluded.imagen, actualizado_en = excluded.actualizado_en
            `).bind(tipo, id, imagen, version).run();
            return json({ success: true, foto_v: version });
        }

        case 'borrar': {
            const data = await leerJson(request);
            const tipo = validarTipoFoto(data.tipo);
            await db.prepare('DELETE FROM fotos WHERE tipo = ? AND ref_id = ?').bind(tipo, Number(data.id)).run();
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}

// =====================================================
// COMENTARIOS EN LOS PARTIDOS
// =====================================================
// Cualquiera puede leerlos. Para escribir hace falta el código de jugadores (lo fija el administrador
// y se comparte en el grupo) o ser administrador. Solo el administrador puede borrarlos.
const MAX_AUTOR = 40;
const MAX_TEXTO = 500;
const MAX_COMENTARIOS_SEGUIDOS = 10;            // por persona…
const VENTANA_COMENTARIOS_MS = 10 * 60 * 1000;  // …cada 10 minutos
const TABLA_PARTIDOS = { liga: 'liga_calendario', individual: 'individual_partidos', torneo: 'torneo_partidos' };

function validarTipo(tipo) {
    if (!Object.hasOwn(TABLA_PARTIDOS, tipo)) throw new HttpError(400, 'Tipo de partido no válido');
    return tipo;
}

async function codigoComentarios(db) {
    const fila = await db.prepare("SELECT valor FROM ajustes WHERE clave = 'codigo_comentarios'").first();
    return fila?.valor || '';
}

// Borra los comentarios de partidos que ya no existen (tras regenerar el calendario, resetear...)
function limpiarComentarios(db, tipo) {
    return db.prepare(`DELETE FROM comentarios WHERE tipo = ? AND partido_id NOT IN (SELECT id FROM ${TABLA_PARTIDOS[tipo]})`)
        .bind(tipo);
}

function validarTexto(valor, campo, maximo) {
    const limpio = String(valor ?? '').trim().replace(/\n{3,}/g, '\n\n');
    if (!limpio) throw new HttpError(400, `${campo} no puede estar vacío`);
    if (limpio.length > maximo) throw new HttpError(400, `${campo} no puede superar ${maximo} caracteres`);
    return limpio;
}

async function handleComentarios(request, env, url, action) {
    const db = env.DB;
    switch (action) {
        case 'getConteo': {
            // Número de comentarios y el último de cada partido de un tipo (para mostrarlo en cada partido)
            const tipo = validarTipo(url.searchParams.get('tipo'));
            const [filas, codigo] = await Promise.all([
                db.prepare(`
                    SELECT c.partido_id, COUNT(*) AS total,
                           (SELECT u.autor FROM comentarios u WHERE u.tipo = c.tipo AND u.partido_id = c.partido_id ORDER BY u.id DESC LIMIT 1) AS ultimo_autor,
                           (SELECT u.texto FROM comentarios u WHERE u.tipo = c.tipo AND u.partido_id = c.partido_id ORDER BY u.id DESC LIMIT 1) AS ultimo_texto
                    FROM comentarios c
                    WHERE c.tipo = ?
                    GROUP BY c.partido_id
                `).bind(tipo).all(),
                codigoComentarios(db)
            ]);
            const partidos = {};
            for (const f of filas.results) {
                partidos[f.partido_id] = { total: f.total, ultimo_autor: f.ultimo_autor, ultimo_texto: f.ultimo_texto };
            }
            return json({ success: true, data: { activos: !!codigo, partidos } });
        }

        case 'getComentarios': {
            const tipo = validarTipo(url.searchParams.get('tipo'));
            const partido = Number(url.searchParams.get('partido'));
            const [lista, codigo] = await Promise.all([
                db.prepare('SELECT id, autor, texto, creado_en FROM comentarios WHERE tipo = ? AND partido_id = ? ORDER BY id')
                    .bind(tipo, partido).all(),
                codigoComentarios(db)
            ]);
            return json({ success: true, data: { activos: !!codigo, comentarios: lista.results } });
        }

        case 'comentar': {
            exigirPost(request);
            const data = await leerJson(request);
            const tipo = validarTipo(data.tipo);
            const partidoId = Number(data.partido_id);
            const existe = await db.prepare(`SELECT 1 FROM ${TABLA_PARTIDOS[tipo]} WHERE id = ?`).bind(partidoId).first();
            if (!existe) throw new HttpError(404, 'Partido no encontrado');
            const autor = validarTexto(data.autor, 'El nombre', MAX_AUTOR);
            const texto = validarTexto(data.texto, 'El comentario', MAX_TEXTO);

            const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
            const esAdminPeticion = await tokenValido(request, env.ADMIN_PASSWORD);
            // Huella anónima del remitente (no se guarda la IP) para limitar envíos seguidos
            const origen = (await hmacHex(env.ADMIN_PASSWORD || 'padel-go', `comentarios:${ip}`)).slice(0, 16);

            if (!esAdminPeticion) {
                const codigo = await codigoComentarios(db);
                if (!codigo) throw new HttpError(403, 'Los comentarios no están activados');

                const clave = `comentarios:${ip}`;
                const registro = await comprobarBloqueo(db, clave);
                const recibido = String(data.codigo ?? '').trim().toLowerCase();
                if (!compararSeguro(recibido, codigo.toLowerCase())) {
                    const restantes = await registrarFallo(db, clave, registro);
                    throw new HttpError(403, `Código de jugadores incorrecto (${textoRestantes(restantes)})`);
                }
                if (registro) await db.prepare('DELETE FROM login_intentos WHERE ip = ?').bind(clave).run();

                const recientes = await db.prepare('SELECT COUNT(*) AS n FROM comentarios WHERE origen = ? AND creado_en > ?')
                    .bind(origen, Date.now() - VENTANA_COMENTARIOS_MS).first();
                if (recientes.n >= MAX_COMENTARIOS_SEGUIDOS) {
                    throw new HttpError(429, 'Has enviado muchos comentarios seguidos. Espera unos minutos.');
                }
            }

            const creadoEn = Date.now();
            const nuevo = await db.prepare(`
                INSERT INTO comentarios (tipo, partido_id, autor, texto, origen, creado_en)
                VALUES (?, ?, ?, ?, ?, ?) RETURNING id
            `).bind(tipo, partidoId, autor, texto, origen, creadoEn).first();
            return json({ success: true, comentario: { id: nuevo.id, autor, texto, creado_en: creadoEn } });
        }

        case 'borrarComentario': {
            const data = await leerJson(request);
            const comentario = await db.prepare('SELECT id FROM comentarios WHERE id = ?').bind(data.id).first();
            if (!comentario) throw new HttpError(404, 'Comentario no encontrado');
            await db.prepare('DELETE FROM comentarios WHERE id = ?').bind(comentario.id).run();
            return json({ success: true });
        }

        case 'getCodigo': {
            // Solo el administrador puede ver el código (para compartirlo)
            return json({ success: true, codigo: await codigoComentarios(db) });
        }

        case 'configurarCodigo': {
            // Código vacío = comentarios desactivados
            const data = await leerJson(request);
            const codigo = String(data.codigo ?? '').trim();
            if (codigo && (codigo.length < 4 || codigo.length > 40)) {
                throw new HttpError(400, 'El código tiene que tener entre 4 y 40 caracteres');
            }
            if (codigo) {
                await db.prepare(`
                    INSERT INTO ajustes (clave, valor) VALUES ('codigo_comentarios', ?)
                    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
                `).bind(codigo).run();
            } else {
                await db.prepare("DELETE FROM ajustes WHERE clave = 'codigo_comentarios'").run();
            }
            return json({ success: true, activos: !!codigo });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}

// =====================================================
// LIGA INDIVIDUAL
// =====================================================
// Cada jugador puntúa por su cuenta. En cada jornada se ordena a los jugadores (jornada 1: orden que fija
// el administrador; después: clasificación) y se hacen grupos de 4: el 1º y el 3º juegan contra el 2º y el 4º.
const JORNADAS_INDIVIDUAL = 10;

async function estadoIndividual(db) {
    const [jugadores, partidos, config] = await Promise.all([
        db.prepare(`
            SELECT j.id, j.nombre, j.orden, f.actualizado_en AS foto_v
            FROM individual_jugadores j
            LEFT JOIN fotos f ON f.tipo = 'jugador' AND f.ref_id = j.id
            ORDER BY j.orden, j.id
        `).all(),
        db.prepare(`
            SELECT p.*,
                   l1.nombre AS local1, l2.nombre AS local2,
                   v1.nombre AS visitante1, v2.nombre AS visitante2
            FROM individual_partidos p
            JOIN individual_jugadores l1 ON l1.id = p.local1_id
            JOIN individual_jugadores l2 ON l2.id = p.local2_id
            JOIN individual_jugadores v1 ON v1.id = p.visitante1_id
            JOIN individual_jugadores v2 ON v2.id = p.visitante2_id
            ORDER BY p.jornada, p.orden
        `).all(),
        db.prepare('SELECT super_tiebreak FROM individual_config WHERE id = 1').first()
    ]);
    const lista = partidos.results;
    const jornadaActual = lista.reduce((max, p) => Math.max(max, p.jornada), 0);
    const delaActual = lista.filter(p => p.jornada === jornadaActual);
    return {
        jugadores: jugadores.results,
        partidos: lista,
        jornadaActual,
        actualCompleta: jornadaActual > 0 && delaActual.every(p => p.completado),
        superTiebreak: !!config?.super_tiebreak
    };
}

// Clasificación por jugador: cada uno suma los puntos, sets y juegos de su pareja en cada partido.
// Orden: puntos, diferencia de sets, diferencia de juegos, sets a favor y, por último, el orden inicial.
function clasificacionIndividual(jugadores, partidos) {
    const stats = new Map(jugadores.map(j => [j.id, {
        id: j.id, nombre: j.nombre, orden: j.orden, foto_v: j.foto_v ?? null,
        pj: 0, pg: 0, pp1: 0, pp0: 0, puntos: 0,
        sets_favor: 0, sets_contra: 0, juegos_favor: 0, juegos_contra: 0
    }]));

    const sumar = (id, pts, sf, sc, jf, jc) => {
        const s = stats.get(id);
        if (!s) return;
        s.pj++;
        s.puntos += pts;
        if (pts === 3) s.pg++; else if (pts === 1) s.pp1++; else s.pp0++;
        s.sets_favor += sf; s.sets_contra += sc;
        s.juegos_favor += jf; s.juegos_contra += jc;
    };

    for (const p of partidos) {
        if (!p.completado) continue;
        const { sl, sv, jl, jv } = contarSetsYJuegos(p);
        for (const id of [p.local1_id, p.local2_id]) sumar(id, p.puntos_local, sl, sv, jl, jv);
        for (const id of [p.visitante1_id, p.visitante2_id]) sumar(id, p.puntos_visitante, sv, sl, jv, jl);
    }

    return [...stats.values()]
        .sort((a, b) => (b.puntos - a.puntos)
            || ((b.sets_favor - b.sets_contra) - (a.sets_favor - a.sets_contra))
            || ((b.juegos_favor - b.juegos_contra) - (a.juegos_favor - a.juegos_contra))
            || (b.sets_favor - a.sets_favor)
            || (a.orden - b.orden)
            || a.nombre.localeCompare(b.nombre, 'es'))
        .map((s, i) => ({ ...s, posicion: i + 1 }));
}

async function obtenerJugador(db, id) {
    const jugador = await db.prepare('SELECT * FROM individual_jugadores WHERE id = ?').bind(id).first();
    if (!jugador) throw new HttpError(404, 'Jugador no encontrado');
    return jugador;
}

async function comprobarNombreLibreJugador(db, nombre, exceptoId = 0) {
    const existe = await db.prepare(
        'SELECT 1 FROM individual_jugadores WHERE LOWER(nombre) = LOWER(?) AND id <> ?'
    ).bind(nombre, exceptoId).first();
    if (existe) throw new HttpError(409, 'Ya hay un jugador con ese nombre');
}

function exigirNoEmpezada(estado) {
    if (estado.jornadaActual > 0) {
        throw new HttpError(409, 'La liga ya ha empezado: no se pueden cambiar los jugadores ni su orden. Resetéala para hacerlo.');
    }
}

// Partido de la última jornada (las anteriores ya no se pueden tocar: de ellas salen las parejas siguientes)
async function partidoEditable(db, id) {
    const estado = await estadoIndividual(db);
    const partido = estado.partidos.find(p => p.id === Number(id));
    if (!partido) throw new HttpError(404, 'Partido no encontrado');
    if (partido.jornada !== estado.jornadaActual) {
        throw new HttpError(409, 'Solo se pueden modificar los resultados de la última jornada (las parejas de las siguientes dependen de ellos)');
    }
    return { estado, partido };
}

async function handleIndividual(request, db, action) {
    switch (action) {
        case 'getEstado': {
            const estado = await estadoIndividual(db);
            const n = estado.jugadores.length;
            const puedeGenerar = estado.jornadaActual === 0
                ? n >= 4 && n % 4 === 0
                : estado.actualCompleta && estado.jornadaActual < JORNADAS_INDIVIDUAL;
            return json({
                success: true,
                data: {
                    jugadores: estado.jugadores,
                    clasificacion: clasificacionIndividual(estado.jugadores, estado.partidos),
                    partidos: estado.partidos,
                    jornadaActual: estado.jornadaActual,
                    totalJornadas: JORNADAS_INDIVIDUAL,
                    superTiebreak: estado.superTiebreak,
                    empezada: estado.jornadaActual > 0,
                    terminada: estado.jornadaActual === JORNADAS_INDIVIDUAL && estado.actualCompleta,
                    puedeGenerar
                }
            });
        }

        case 'addJugador': {
            const data = await leerJson(request);
            const nombre = validarNombre(data.nombre);
            exigirNoEmpezada(await estadoIndividual(db));
            await comprobarNombreLibreJugador(db, nombre);
            await db.prepare(`
                INSERT INTO individual_jugadores (nombre, orden)
                VALUES (?, (SELECT COALESCE(MAX(orden), -1) + 1 FROM individual_jugadores))
            `).bind(nombre).run();
            return json({ success: true });
        }

        case 'renameJugador': {
            const data = await leerJson(request);
            const jugador = await obtenerJugador(db, data.id);
            const nombre = validarNombre(data.nombre);
            await comprobarNombreLibreJugador(db, nombre, jugador.id);
            await db.prepare('UPDATE individual_jugadores SET nombre = ? WHERE id = ?').bind(nombre, jugador.id).run();
            return json({ success: true });
        }

        case 'deleteJugador': {
            const data = await leerJson(request);
            const jugador = await obtenerJugador(db, data.id);
            exigirNoEmpezada(await estadoIndividual(db));
            await db.batch([
                db.prepare('DELETE FROM individual_jugadores WHERE id = ?').bind(jugador.id),
                limpiarFotos(db, 'jugador')
            ]);
            return json({ success: true });
        }

        case 'ordenarJugadores': {
            // Orden inicial (el de la jornada 1): lista completa de ids en el orden deseado
            const data = await leerJson(request);
            const estado = await estadoIndividual(db);
            exigirNoEmpezada(estado);
            const ids = Array.isArray(data.ids) ? data.ids.map(Number) : [];
            const actuales = estado.jugadores.map(j => j.id);
            const mismos = ids.length === actuales.length && new Set(ids).size === ids.length
                && ids.every(id => actuales.includes(id));
            if (!mismos) throw new HttpError(400, 'La lista de jugadores no coincide con los inscritos');

            const actualizar = db.prepare('UPDATE individual_jugadores SET orden = ? WHERE id = ?');
            await db.batch(ids.map((id, i) => actualizar.bind(i, id)));
            return json({ success: true });
        }

        case 'generarJornada': {
            const estado = await estadoIndividual(db);
            const n = estado.jugadores.length;
            let ranking;

            if (estado.jornadaActual === 0) {
                if (n < 4 || n % 4 !== 0) {
                    throw new HttpError(409, `Para empezar hacen falta 4, 8, 12, 16… jugadores (múltiplo de 4). Ahora hay ${n}.`);
                }
                ranking = estado.jugadores;  // orden manual
            } else {
                if (estado.jornadaActual >= JORNADAS_INDIVIDUAL) {
                    throw new HttpError(409, `La liga ya ha jugado sus ${JORNADAS_INDIVIDUAL} jornadas`);
                }
                if (!estado.actualCompleta) {
                    throw new HttpError(409, `Faltan resultados de la jornada ${estado.jornadaActual}`);
                }
                ranking = clasificacionIndividual(estado.jugadores, estado.partidos);
            }

            // Grupos de 4 por orden: 1º y 3º contra 2º y 4º
            const jornada = estado.jornadaActual + 1;
            const insertar = db.prepare(`
                INSERT INTO individual_partidos (jornada, orden, local1_id, local2_id, visitante1_id, visitante2_id)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const batch = [];
            for (let g = 0; g < ranking.length / 4; g++) {
                const [primero, segundo, tercero, cuarto] = ranking.slice(g * 4, g * 4 + 4);
                batch.push(insertar.bind(jornada, g, primero.id, tercero.id, segundo.id, cuarto.id));
            }
            await db.batch(batch);
            return json({ success: true, jornada });
        }

        case 'deshacerJornada': {
            // Borra la última jornada si todavía no tiene resultados (p. ej. generada por error)
            const estado = await estadoIndividual(db);
            if (estado.jornadaActual === 0) throw new HttpError(409, 'No hay ninguna jornada que deshacer');
            const conResultado = estado.partidos.some(p => p.jornada === estado.jornadaActual && p.completado);
            if (conResultado) {
                throw new HttpError(409, `La jornada ${estado.jornadaActual} ya tiene resultados: anúlalos antes de deshacerla`);
            }
            await db.batch([
                db.prepare('DELETE FROM individual_partidos WHERE jornada = ?').bind(estado.jornadaActual),
                limpiarComentarios(db, 'individual')
            ]);
            return json({ success: true, jornada: estado.jornadaActual });
        }

        case 'guardarResultado': {
            // Registra un resultado nuevo o corrige uno de la última jornada
            const data = await leerJson(request);
            const { estado, partido } = await partidoEditable(db, data.id);
            const { sets, setsLocal, setsVisitante } = analizarSets(data, { superTiebreak: estado.superTiebreak });
            const { puntosLocal, puntosVisitante } = puntosPartido(setsLocal, setsVisitante);

            await db.prepare(`
                UPDATE individual_partidos
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
            return json({ success: true, setsLocal, setsVisitante });
        }

        case 'anularResultado': {
            const data = await leerJson(request);
            const { partido } = await partidoEditable(db, data.id);
            await db.prepare(`
                UPDATE individual_partidos
                SET completado = 0,
                    set1_local = NULL, set1_visitante = NULL,
                    set2_local = NULL, set2_visitante = NULL,
                    set3_local = NULL, set3_visitante = NULL,
                    puntos_local = NULL, puntos_visitante = NULL
                WHERE id = ?
            `).bind(partido.id).run();
            return json({ success: true });
        }

        case 'resetIndividual': {
            // Borra todas las jornadas; los jugadores y su orden se conservan
            await db.batch([db.prepare('DELETE FROM individual_partidos'), limpiarComentarios(db, 'individual')]);
            return json({ success: true });
        }

        case 'configurar': {
            const data = await leerJson(request);
            if (typeof data.super_tiebreak !== 'boolean') throw new HttpError(400, 'Opción no válida');
            await db.prepare('UPDATE individual_config SET super_tiebreak = ? WHERE id = 1')
                .bind(data.super_tiebreak ? 1 : 0).run();
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
        "SELECT id, super_tiebreak FROM torneo WHERE estado = 'activo' ORDER BY id DESC LIMIT 1"
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
    return { torneo, partido, siguiente, campoSiguiente };
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

        case 'configurarTorneo': {
            // Opciones del torneo actual (se crea en configuración si todavía no existe)
            const data = await leerJson(request);
            if (typeof data.super_tiebreak !== 'boolean') throw new HttpError(400, 'Opción no válida');
            let torneo = await obtenerTorneoActual(db);
            if (!torneo) {
                torneo = await db.prepare(
                    "INSERT INTO torneo (estado, super_tiebreak) VALUES ('configuracion', COALESCE((SELECT super_tiebreak FROM torneo ORDER BY id DESC LIMIT 1), 0)) RETURNING id"
                ).first();
            }
            await db.prepare('UPDATE torneo SET super_tiebreak = ? WHERE id = ?')
                .bind(data.super_tiebreak ? 1 : 0, torneo.id).run();
            return json({ success: true });
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
                    "INSERT INTO torneo (estado, super_tiebreak) VALUES ('configuracion', COALESCE((SELECT super_tiebreak FROM torneo ORDER BY id DESC LIMIT 1), 0)) RETURNING id"
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

            batch.push(limpiarComentarios(db, 'torneo'));   // los partidos del sorteo anterior ya no existen
            await db.batch(batch);
            return json({ success: true, torneoId: torneo.id });
        }

        case 'guardarPartido': {
            // Registra un resultado nuevo o corrige uno existente (si el ganador aún no ha jugado la ronda siguiente)
            const data = await leerJson(request);
            const { torneo, partido, siguiente, campoSiguiente } = await obtenerPartidoTorneo(db, data.id);
            const { sets, setsLocal, setsVisitante } = analizarSets(data, { superTiebreak: !!torneo.super_tiebreak });
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
            await limpiarComentarios(db, 'torneo').run();
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}
