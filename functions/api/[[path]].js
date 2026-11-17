// =====================================================
// CLOUDFLARE PAGES FUNCTIONS - API PARA APP DE PÁDEL
// =====================================================
// Requiere:
//   - Binding D1 "DB" (ver wrangler.toml)
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

// Acciones que modifican datos: requieren token de administrador
const ACCIONES_ADMIN = {
    liga: ['addEquipo', 'deleteEquipo', 'generarCalendario', 'guardarResultado', 'resetLiga'],
    torneo: ['addEquipo', 'deleteEquipo', 'crearTorneo', 'guardarPartido', 'resetTorneo']
};

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
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
            return json({ success: false, error: error.message }, error.status);
        }
        console.error('Error:', error);
        return json({ success: false, error: 'Error interno del servidor' }, 500);
    }
}

// =====================================================
// AUTENTICACIÓN (token firmado con HMAC)
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

async function handleLogin(request, env) {
    exigirPost(request);
    if (!env.ADMIN_PASSWORD) {
        throw new HttpError(500, 'El servidor no tiene configurada la contraseña de administrador');
    }
    const data = await leerJson(request);
    if (!compararSeguro(String(data.password ?? ''), env.ADMIN_PASSWORD)) {
        throw new HttpError(401, 'Contraseña incorrecta');
    }
    const exp = String(Date.now() + TOKEN_TTL_MS);
    const token = `${exp}.${await hmacHex(env.ADMIN_PASSWORD, exp)}`;
    return json({ success: true, token });
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

// =====================================================
// LIGA
// =====================================================
async function handleLiga(request, db, url, action) {
    switch (action) {
        case 'getEquipos': {
            const liga = validarLiga(url.searchParams.get('liga') || 'masculino_avanzado');
            const result = await db.prepare(`
                SELECT e.id, e.nombre, e.liga_nombre,
                       COALESCE(c.pj, 0) AS pj, COALESCE(c.pg, 0) AS pg,
                       COALESCE(c.pp1, 0) AS pp1, COALESCE(c.pp0, 0) AS pp0,
                       COALESCE(c.puntos, 0) AS puntos
                FROM liga_equipos e
                LEFT JOIN liga_clasificacion c
                       ON c.liga_nombre = e.liga_nombre AND c.equipo = e.nombre
                WHERE e.liga_nombre = ?
                ORDER BY e.nombre
            `).bind(liga).all();
            return json({ success: true, data: result.results });
        }

        case 'addEquipo': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            const nombre = validarNombre(data.nombre);

            const existe = await db.prepare(
                'SELECT 1 FROM liga_equipos WHERE liga_nombre = ? AND LOWER(nombre) = LOWER(?)'
            ).bind(liga, nombre).first();
            if (existe) throw new HttpError(409, 'Ya existe un equipo con ese nombre en esta liga');

            await db.prepare('INSERT INTO liga_equipos (liga_nombre, nombre) VALUES (?, ?)')
                .bind(liga, nombre).run();
            return json({ success: true });
        }

        case 'deleteEquipo': {
            const data = await leerJson(request);
            const equipo = await db.prepare('SELECT * FROM liga_equipos WHERE id = ?')
                .bind(data.id).first();
            if (!equipo) throw new HttpError(404, 'Equipo no encontrado');

            const tienePartidos = await db.prepare(
                'SELECT 1 FROM liga_calendario WHERE liga_nombre = ? AND (local = ? OR visitante = ?) LIMIT 1'
            ).bind(equipo.liga_nombre, equipo.nombre, equipo.nombre).first();
            if (tienePartidos) {
                throw new HttpError(409, 'No se puede eliminar un equipo con partidos en el calendario. Resetea la liga primero.');
            }

            await db.batch([
                db.prepare('DELETE FROM liga_equipos WHERE id = ?').bind(equipo.id),
                db.prepare('DELETE FROM liga_clasificacion WHERE liga_nombre = ? AND equipo = ?')
                    .bind(equipo.liga_nombre, equipo.nombre)
            ]);
            return json({ success: true });
        }

        case 'getCalendario': {
            const liga = validarLiga(url.searchParams.get('liga') || 'masculino_avanzado');
            const result = await db.prepare(
                'SELECT * FROM liga_calendario WHERE liga_nombre = ? ORDER BY jornada, id'
            ).bind(liga).all();

            const calendario = {};
            for (const partido of result.results) {
                (calendario[partido.jornada] ??= []).push(partido);
            }
            return json({ success: true, data: calendario });
        }

        case 'generarCalendario': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            if (!Array.isArray(data.calendario) || data.calendario.length === 0) {
                throw new HttpError(400, 'Calendario no válido');
            }

            const equiposRes = await db.prepare('SELECT nombre FROM liga_equipos WHERE liga_nombre = ?')
                .bind(liga).all();
            const nombres = new Set(equiposRes.results.map(e => e.nombre));

            const insert = db.prepare(
                'INSERT INTO liga_calendario (liga_nombre, jornada, local, visitante) VALUES (?, ?, ?, ?)'
            );
            // Al regenerar el calendario se borran resultados y clasificación anteriores
            const batch = [
                db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga),
                db.prepare('DELETE FROM liga_clasificacion WHERE liga_nombre = ?').bind(liga)
            ];
            data.calendario.forEach((jornada, idx) => {
                if (!Array.isArray(jornada)) throw new HttpError(400, 'Calendario no válido');
                jornada.forEach(p => {
                    if (!nombres.has(p.local) || !nombres.has(p.visitante) || p.local === p.visitante) {
                        throw new HttpError(400, 'El calendario contiene equipos no válidos');
                    }
                    batch.push(insert.bind(liga, idx + 1, p.local, p.visitante));
                });
            });

            await db.batch(batch);
            return json({ success: true });
        }

        case 'guardarResultado': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            const { sets, setsLocal, setsVisitante } = analizarSets(data);

            const partido = await db.prepare(
                'SELECT * FROM liga_calendario WHERE id = ? AND liga_nombre = ?'
            ).bind(data.id, liga).first();
            if (!partido) throw new HttpError(404, 'Partido no encontrado');
            if (partido.completado) throw new HttpError(409, 'Este partido ya tiene un resultado registrado');

            // 3 puntos al ganador; el perdedor suma 1 si ganó un set (2-1) y 0 si perdió 2-0
            const ganaLocal = setsLocal > setsVisitante;
            const puntosLocal = ganaLocal ? 3 : (setsLocal > 0 ? 1 : 0);
            const puntosVisitante = ganaLocal ? (setsVisitante > 0 ? 1 : 0) : 3;

            await db.batch([
                db.prepare(`
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
                ),
                sumarClasificacion(db, liga, partido.local, puntosLocal),
                sumarClasificacion(db, liga, partido.visitante, puntosVisitante)
            ]);

            return json({ success: true });
        }

        case 'resetLiga': {
            const data = await leerJson(request);
            const liga = validarLiga(data.liga);
            await db.batch([
                db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga),
                db.prepare('DELETE FROM liga_clasificacion WHERE liga_nombre = ?').bind(liga)
            ]);
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}

function sumarClasificacion(db, liga, equipo, puntos) {
    const pg = puntos === 3 ? 1 : 0;
    const pp1 = puntos === 1 ? 1 : 0;
    const pp0 = puntos === 0 ? 1 : 0;
    return db.prepare(`
        INSERT INTO liga_clasificacion (liga_nombre, equipo, pj, pg, pp1, pp0, puntos)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(liga_nombre, equipo) DO UPDATE SET
            pj = pj + 1,
            pg = pg + excluded.pg,
            pp1 = pp1 + excluded.pp1,
            pp0 = pp0 + excluded.pp0,
            puntos = puntos + excluded.puntos
    `).bind(liga, equipo, pg, pp1, pp0, puntos);
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

function borrarTodoTorneo(db) {
    return [
        db.prepare('DELETE FROM torneo_partidos'),
        db.prepare('DELETE FROM torneo_equipos'),
        db.prepare('DELETE FROM torneo')
    ];
}

function mezclar(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function handleTorneo(request, db, action) {
    switch (action) {
        case 'getTorneo': {
            const torneo = await obtenerTorneoActual(db);
            if (!torneo) return json({ success: true, data: null });

            const [equipos, partidos] = await Promise.all([
                db.prepare('SELECT id, nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden')
                    .bind(torneo.id).all(),
                db.prepare('SELECT * FROM torneo_partidos WHERE torneo_id = ? ORDER BY ronda, orden')
                    .bind(torneo.id).all()
            ]);

            return json({
                success: true,
                data: { torneo, equipos: equipos.results, partidos: partidos.results }
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

            const existe = await db.prepare(
                'SELECT 1 FROM torneo_equipos WHERE torneo_id = ? AND LOWER(nombre) = LOWER(?)'
            ).bind(torneo.id, nombre).first();
            if (existe) throw new HttpError(409, 'El equipo ya existe');

            await db.prepare(`
                INSERT INTO torneo_equipos (torneo_id, nombre, orden)
                VALUES (?, ?, (SELECT COALESCE(MAX(orden), -1) + 1 FROM torneo_equipos WHERE torneo_id = ?))
            `).bind(torneo.id, nombre, torneo.id).run();

            return json({ success: true });
        }

        case 'deleteEquipo': {
            const data = await leerJson(request);
            const equipo = await db.prepare('SELECT * FROM torneo_equipos WHERE id = ?')
                .bind(data.id).first();
            if (!equipo) throw new HttpError(404, 'Equipo no encontrado');
            if (await torneoTienePartidos(db, equipo.torneo_id)) {
                throw new HttpError(409, 'El torneo ya está generado. Resetéalo para cambiar los equipos.');
            }
            await db.prepare('DELETE FROM torneo_equipos WHERE id = ?').bind(equipo.id).run();
            return json({ success: true });
        }

        case 'crearTorneo': {
            // Se usan los equipos inscritos en la base de datos, no los que envíe el cliente
            const actual = await obtenerTorneoActual(db);
            const equiposRes = actual
                ? await db.prepare('SELECT nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden')
                    .bind(actual.id).all()
                : { results: [] };
            const equipos = equiposRes.results.map(e => e.nombre);
            if (equipos.length < 2) throw new HttpError(400, 'Se necesitan al menos 2 equipos');

            await db.batch(borrarTodoTorneo(db));
            const { id: torneoId } = await db.prepare(
                "INSERT INTO torneo (estado) VALUES ('activo') RETURNING id"
            ).first();

            const insertEquipo = db.prepare(
                'INSERT INTO torneo_equipos (torneo_id, nombre, orden) VALUES (?, ?, ?)'
            );
            const insertPartido = db.prepare(
                'INSERT INTO torneo_partidos (torneo_id, ronda, orden, equipo1, equipo2, ganador, completado) VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            const batch = equipos.map((e, idx) => insertEquipo.bind(torneoId, e, idx));

            // Cuadro de eliminación directa
            const numRondas = Math.ceil(Math.log2(equipos.length));
            const partidosR1 = Math.pow(2, numRondas) / 2;
            const numDescansos = partidosR1 * 2 - equipos.length;
            const sorteo = mezclar(equipos);

            // Primera ronda: los descansos van siempre contra un equipo (nunca dos descansos juntos)
            const ronda1 = [];
            for (let i = 0; i < partidosR1; i++) {
                if (i < numDescansos) {
                    ronda1.push({ e1: sorteo.shift(), e2: null });
                } else {
                    ronda1.push({ e1: sorteo.shift(), e2: sorteo.shift() });
                }
            }
            // Repartir los descansos por el cuadro
            const ronda1Mezclada = mezclar(ronda1);
            ronda1Mezclada.forEach((p, i) => {
                const esDescanso = p.e2 === null;
                batch.push(insertPartido.bind(
                    torneoId, 1, i, p.e1, p.e2,
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
                    batch.push(insertPartido.bind(torneoId, ronda, i, e1, e2, null, 0));
                }
            }

            await db.batch(batch);
            return json({ success: true, torneoId });
        }

        case 'guardarPartido': {
            const data = await leerJson(request);
            const torneo = await db.prepare(
                "SELECT id FROM torneo WHERE estado = 'activo' ORDER BY id DESC LIMIT 1"
            ).first();
            if (!torneo) throw new HttpError(400, 'No hay torneo activo');

            const partido = await db.prepare(
                'SELECT * FROM torneo_partidos WHERE id = ? AND torneo_id = ?'
            ).bind(data.id, torneo.id).first();
            if (!partido) throw new HttpError(404, 'Partido no encontrado');
            if (partido.completado) throw new HttpError(409, 'Este partido ya tiene un resultado registrado');
            if (!partido.equipo1 || !partido.equipo2) throw new HttpError(400, 'Faltan rivales en este partido');

            const { sets, setsLocal, setsVisitante } = analizarSets(data);
            const ganador = setsLocal > setsVisitante ? partido.equipo1 : partido.equipo2;

            const batch = [
                db.prepare(`
                    UPDATE torneo_partidos
                    SET ganador = ?, completado = 1,
                        set1_local = ?, set1_visitante = ?,
                        set2_local = ?, set2_visitante = ?,
                        set3_local = ?, set3_visitante = ?
                    WHERE id = ?
                `).bind(
                    ganador,
                    sets[0].local, sets[0].visitante,
                    sets[1].local, sets[1].visitante,
                    sets[2].local, sets[2].visitante,
                    partido.id
                )
            ];

            const siguiente = await db.prepare(
                'SELECT id FROM torneo_partidos WHERE torneo_id = ? AND ronda = ? AND orden = ?'
            ).bind(torneo.id, partido.ronda + 1, Math.floor(partido.orden / 2)).first();

            if (siguiente) {
                const campo = partido.orden % 2 === 0 ? 'equipo1' : 'equipo2';
                batch.push(db.prepare(`UPDATE torneo_partidos SET ${campo} = ? WHERE id = ?`)
                    .bind(ganador, siguiente.id));
            } else {
                // No hay siguiente ronda: era la final
                batch.push(db.prepare('UPDATE torneo SET ganador = ? WHERE id = ?').bind(ganador, torneo.id));
            }

            await db.batch(batch);
            return json({ success: true, ganador, setsLocal, setsVisitante });
        }

        case 'resetTorneo': {
            await db.batch(borrarTodoTorneo(db));
            return json({ success: true });
        }

        default:
            throw new HttpError(400, 'Acción no válida');
    }
}
