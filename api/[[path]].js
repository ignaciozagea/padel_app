// =====================================================
// CLOUDFLARE PAGES FUNCTIONS - API PARA APP DE PÁDEL
// =====================================================

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/', '');
    
    // HEADERS PARA CORS
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };
    
    // RESPUESTA PARA PREFLIGHT (OPTIONS)
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers });
    }
    
    try {
        // OBTENER LA BASE DE DATOS D1
        const db = env.DB;
        
        // ============================================
        // RUTAS DE LA LIGA
        // ============================================
        if (path === 'liga' || path.startsWith('liga/')) {
            return await handleLiga(request, db, url, headers);
        }
        
        // ============================================
        // RUTAS DEL TORNEO
        // ============================================
        if (path === 'torneo' || path.startsWith('torneo/')) {
            return await handleTorneo(request, db, url, headers);
        }
        
        // ============================================
        // LOGIN
        // ============================================
        if (path === 'login') {
            const data = await request.json();
            if (data.password === 'admin123') {
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            return new Response(JSON.stringify({ 
                success: false, 
                error: 'Contraseña incorrecta' 
            }), { 
                status: 401, 
                headers 
            });
        }
        
        // RUTA NO ENCONTRADA
        return new Response(JSON.stringify({ 
            error: 'Ruta no encontrada' 
        }), { 
            status: 404, 
            headers 
        });
        
    } catch (error) {
        console.error('Error:', error);
        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
        }), { 
            status: 500, 
            headers 
        });
    }
}

// ============================================================
// MANEJADOR DE LIGA
// ============================================================
async function handleLiga(request, db, url, headers) {
    const action = url.searchParams.get('action');
    const liga = url.searchParams.get('liga') || 'masculino_avanzado';
    
    try {
        switch(action) {
            // ---------- OBTENER EQUIPOS ----------
            case 'getEquipos': {
                const result = await db.prepare(
                    'SELECT * FROM liga_equipos WHERE liga_nombre = ? ORDER BY nombre'
                ).bind(liga).all();
                return new Response(JSON.stringify({ 
                    success: true, 
                    data: result.results 
                }), { headers });
            }
            
            // ---------- AGREGAR EQUIPO ----------
            case 'addEquipo': {
                const data = await request.json();
                await db.prepare(
                    'INSERT INTO liga_equipos (liga_nombre, nombre) VALUES (?, ?)'
                ).bind(data.liga, data.nombre).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- ELIMINAR EQUIPO ----------
            case 'deleteEquipo': {
                const id = url.searchParams.get('id');
                await db.prepare('DELETE FROM liga_equipos WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- OBTENER CALENDARIO ----------
            case 'getCalendario': {
                const result = await db.prepare(
                    'SELECT * FROM liga_calendario WHERE liga_nombre = ? ORDER BY jornada, id'
                ).bind(liga).all();
                
                // Agrupar por jornada
                const calendario = {};
                result.results.forEach(partido => {
                    if (!calendario[partido.jornada]) {
                        calendario[partido.jornada] = [];
                    }
                    calendario[partido.jornada].push(partido);
                });
                
                return new Response(JSON.stringify({ 
                    success: true, 
                    data: calendario 
                }), { headers });
            }
            
            // ---------- GENERAR CALENDARIO ----------
            case 'generarCalendario': {
                const data = await request.json();
                
                // Limpiar calendario anterior
                await db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(data.liga).run();
                
                // Insertar nuevo calendario
                const insert = db.prepare(
                    'INSERT INTO liga_calendario (liga_nombre, jornada, local, visitante) VALUES (?, ?, ?, ?)'
                );
                
                const batch = [];
                data.calendario.forEach((jornada, idx) => {
                    const jornadaNum = idx + 1;
                    jornada.forEach(partido => {
                        batch.push(insert.bind(data.liga, jornadaNum, partido.local, partido.visitante));
                    });
                });
                
                await db.batch(batch);
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- GUARDAR RESULTADO ----------
            case 'guardarResultado': {
                const data = await request.json();
                
                // Calcular puntos según las reglas
                const setsLocal = [
                    data.set1_local > data.set1_visitante, 
                    data.set2_local > data.set2_visitante, 
                    data.set3_local !== null && data.set3_local > data.set3_visitante
                ].filter(Boolean).length;
                
                const setsVisitante = [
                    data.set1_visitante > data.set1_local, 
                    data.set2_visitante > data.set2_local, 
                    data.set3_visitante !== null && data.set3_visitante > data.set3_local
                ].filter(Boolean).length;
                
                let puntosLocal, puntosVisitante;
                if (setsLocal > setsVisitante) {
                    puntosLocal = 3;
                    puntosVisitante = 0;
                } else {
                    puntosLocal = setsLocal > 0 ? 1 : 0;
                    puntosVisitante = 3;
                }
                
                // Actualizar partido
                await db.prepare(`
                    UPDATE liga_calendario 
                    SET completado = 1,
                        set1_local = ?, set1_visitante = ?,
                        set2_local = ?, set2_visitante = ?,
                        set3_local = ?, set3_visitante = ?,
                        puntos_local = ?, puntos_visitante = ?
                    WHERE liga_nombre = ? AND jornada = ? AND local = ? AND visitante = ?
                `).bind(
                    data.set1_local, data.set1_visitante,
                    data.set2_local, data.set2_visitante,
                    data.set3_local || null, data.set3_visitante || null,
                    puntosLocal, puntosVisitante,
                    data.liga, data.jornada, data.local, data.visitante
                ).run();
                
                // Actualizar clasificación
                await actualizarClasificacion(db, data.liga, data.local, data.visitante, puntosLocal, puntosVisitante);
                
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- RESETEAR LIGA ----------
            case 'resetLiga': {
                await db.prepare('DELETE FROM liga_calendario WHERE liga_nombre = ?').bind(liga).run();
                await db.prepare('DELETE FROM liga_clasificacion WHERE liga_nombre = ?').bind(liga).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            default:
                return new Response(JSON.stringify({ 
                    error: 'Acción no válida: ' + action 
                }), { 
                    status: 400, 
                    headers 
                });
        }
    } catch (error) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
        }), { 
            status: 500, 
            headers 
        });
    }
}

// ============================================================
// MANEJADOR DE TORNEO
// ============================================================
async function handleTorneo(request, db, url, headers) {
    const action = url.searchParams.get('action');
    
    try {
        switch(action) {
            // ---------- OBTENER TORNEO ----------
            case 'getTorneo': {
                const torneoResult = await db.prepare(
                    'SELECT * FROM torneo WHERE estado IN ("activo", "configuracion") ORDER BY id DESC LIMIT 1'
                ).all();
                
                if (torneoResult.results.length === 0) {
                    return new Response(JSON.stringify({ 
                        success: true, 
                        data: null 
                    }), { headers });
                }
                
                const torneo = torneoResult.results[0];
                
                const equiposResult = await db.prepare(
                    'SELECT nombre FROM torneo_equipos WHERE torneo_id = ? ORDER BY orden'
                ).bind(torneo.id).all();
                
                const partidosResult = await db.prepare(
                    'SELECT * FROM torneo_partidos WHERE torneo_id = ? ORDER BY ronda, orden'
                ).bind(torneo.id).all();
                
                return new Response(JSON.stringify({
                    success: true,
                    data: {
                        torneo: torneo,
                        equipos: equiposResult.results.map(e => e.nombre),
                        partidos: partidosResult.results
                    }
                }), { headers });
            }
            
            // ---------- AGREGAR EQUIPO ----------
            case 'addEquipo': {
                const data = await request.json();
                
                // Obtener torneo activo
                let torneoResult = await db.prepare(
                    'SELECT id FROM torneo WHERE estado IN ("configuracion", "activo") ORDER BY id DESC LIMIT 1'
                ).all();
                
                let torneoId;
                if (torneoResult.results.length === 0) {
                    const result = await db.prepare(
                        'INSERT INTO torneo (estado) VALUES ("configuracion") RETURNING id'
                    ).all();
                    torneoId = result.results[0].id;
                } else {
                    torneoId = torneoResult.results[0].id;
                }
                
                // Verificar si el equipo ya existe
                const existResult = await db.prepare(
                    'SELECT COUNT(*) as count FROM torneo_equipos WHERE torneo_id = ? AND nombre = ?'
                ).bind(torneoId, data.nombre).all();
                
                if (existResult.results[0].count > 0) {
                    return new Response(JSON.stringify({ 
                        success: false, 
                        error: 'El equipo ya existe' 
                    }), { 
                        status: 400, 
                        headers 
                    });
                }
                
                // Obtener último orden
                const orderResult = await db.prepare(
                    'SELECT COALESCE(MAX(orden), -1) + 1 as nuevo_orden FROM torneo_equipos WHERE torneo_id = ?'
                ).bind(torneoId).all();
                
                await db.prepare(
                    'INSERT INTO torneo_equipos (torneo_id, nombre, orden) VALUES (?, ?, ?)'
                ).bind(torneoId, data.nombre, orderResult.results[0].nuevo_orden).run();
                
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- ELIMINAR EQUIPO ----------
            case 'deleteEquipo': {
                const id = url.searchParams.get('id');
                await db.prepare('DELETE FROM torneo_equipos WHERE id = ?').bind(id).run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- CREAR TORNEO ----------
            case 'crearTorneo': {
                const data = await request.json();
                const equipos = data.equipos;
                
                // Limpiar torneo anterior
                await db.prepare('DELETE FROM torneo_partidos').run();
                await db.prepare('DELETE FROM torneo_equipos').run();
                await db.prepare('UPDATE torneo SET estado = "configuracion", ganador = NULL').run();
                
                // Crear nuevo torneo
                const result = await db.prepare(
                    'INSERT INTO torneo (estado) VALUES ("activo") RETURNING id'
                ).all();
                const torneoId = result.results[0].id;
                
                // Insertar equipos
                const insertEquipo = db.prepare(
                    'INSERT INTO torneo_equipos (torneo_id, nombre, orden) VALUES (?, ?, ?)'
                );
                
                const batchEquipos = equipos.map((equipo, idx) => 
                    insertEquipo.bind(torneoId, equipo, idx)
                );
                await db.batch(batchEquipos);
                
                // Generar partidos (eliminación directa)
                const numEquipos = equipos.length;
                const numRondas = Math.ceil(Math.log2(numEquipos));
                const totalSlots = Math.pow(2, numRondas);
                
                // Añadir byes (descansos)
                const participantes = [...equipos];
                while (participantes.length < totalSlots) {
                    participantes.push(null);
                }
                
                // Mezclar aleatoriamente
                for (let i = participantes.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [participantes[i], participantes[j]] = [participantes[j], participantes[i]];
                }
                
                const insertPartido = db.prepare(
                    'INSERT INTO torneo_partidos (torneo_id, ronda, orden, equipo1, equipo2, ganador, completado) VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                
                const batchPartidos = [];
                let partidoOrden = 0;
                
                // Primera ronda
                for (let i = 0; i < participantes.length; i += 2) {
                    const eq1 = participantes[i];
                    const eq2 = participantes[i + 1];
                    
                    let ganador = null;
                    let completado = 0;
                    
                    if (eq1 === null && eq2 !== null) {
                        ganador = eq2;
                        completado = 1;
                    } else if (eq2 === null && eq1 !== null) {
                        ganador = eq1;
                        completado = 1;
                    }
                    
                    batchPartidos.push(
                        insertPartido.bind(torneoId, 1, partidoOrden, eq1, eq2, ganador, completado)
                    );
                    partidoOrden++;
                }
                
                // Rondas siguientes
                let rondaActual = 1;
                let partidosRonda = batchPartidos.length;
                
                while (partidosRonda > 1) {
                    const siguienteRonda = Math.ceil(partidosRonda / 2);
                    for (let i = 0; i < siguienteRonda; i++) {
                        batchPartidos.push(
                            insertPartido.bind(torneoId, rondaActual + 1, i, null, null, null, 0)
                        );
                    }
                    partidosRonda = siguienteRonda;
                    rondaActual++;
                }
                
                await db.batch(batchPartidos);
                
                return new Response(JSON.stringify({ 
                    success: true, 
                    torneoId 
                }), { headers });
            }
            
            // ---------- GUARDAR RESULTADO ----------
            case 'guardarPartido': {
                const data = await request.json();
                const parts = data.partidoId.split('_');
                const ronda = parseInt(parts[0]) + 1;
                const orden = parseInt(parts[1]);
                
                const torneoResult = await db.prepare(
                    'SELECT id FROM torneo WHERE estado = "activo" ORDER BY id DESC LIMIT 1'
                ).all();
                
                if (torneoResult.results.length === 0) {
                    return new Response(JSON.stringify({ 
                        success: false, 
                        error: 'No hay torneo activo' 
                    }), { 
                        status: 400, 
                        headers 
                    });
                }
                
                const torneoId = torneoResult.results[0].id;
                
                // Actualizar partido
                await db.prepare(`
                    UPDATE torneo_partidos 
                    SET ganador = ?,
                        completado = 1,
                        set1_local = ?, set1_visitante = ?,
                        set2_local = ?, set2_visitante = ?,
                        set3_local = ?, set3_visitante = ?
                    WHERE torneo_id = ? AND ronda = ? AND orden = ?
                `).bind(
                    data.ganador,
                    data.set1_local, data.set1_visitante,
                    data.set2_local, data.set2_visitante,
                    data.set3_local, data.set3_visitante,
                    torneoId, ronda, orden
                ).run();
                
                // Actualizar siguiente ronda
                const siguienteOrden = Math.floor(orden / 2);
                const esLocal = orden % 2 === 0;
                
                const siguienteResult = await db.prepare(
                    'SELECT id FROM torneo_partidos WHERE torneo_id = ? AND ronda = ? AND orden = ?'
                ).bind(torneoId, ronda + 1, siguienteOrden).all();
                
                if (siguienteResult.results.length > 0) {
                    const siguienteId = siguienteResult.results[0].id;
                    const campo = esLocal ? 'equipo1' : 'equipo2';
                    await db.prepare(
                        `UPDATE torneo_partidos SET ${campo} = ? WHERE id = ?`
                    ).bind(data.ganador, siguienteId).run();
                }
                
                // Verificar si es la final
                const maxRondaResult = await db.prepare(
                    'SELECT MAX(ronda) as max_ronda FROM torneo_partidos WHERE torneo_id = ?'
                ).bind(torneoId).all();
                
                if (ronda === maxRondaResult.results[0].max_ronda) {
                    await db.prepare(
                        'UPDATE torneo SET ganador = ? WHERE id = ?'
                    ).bind(data.ganador, torneoId).run();
                }
                
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            // ---------- RESETEAR TORNEO ----------
            case 'resetTorneo': {
                await db.prepare('DELETE FROM torneo_partidos').run();
                await db.prepare('DELETE FROM torneo_equipos').run();
                await db.prepare('UPDATE torneo SET estado = "configuracion", ganador = NULL').run();
                return new Response(JSON.stringify({ success: true }), { headers });
            }
            
            default:
                return new Response(JSON.stringify({ 
                    error: 'Acción no válida: ' + action 
                }), { 
                    status: 400, 
                    headers 
                });
        }
    } catch (error) {
        return new Response(JSON.stringify({ 
            success: false, 
            error: error.message 
        }), { 
            status: 500, 
            headers 
        });
    }
}

// ============================================================
// FUNCIÓN AUXILIAR: ACTUALIZAR CLASIFICACIÓN
// ============================================================
async function actualizarClasificacion(db, ligaNombre, local, visitante, puntosLocal, puntosVisitante) {
    // Actualizar equipo local
    await db.prepare(`
        INSERT INTO liga_clasificacion (liga_nombre, equipo, pj, pg, pp1, pp0, puntos)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(liga_nombre, equipo) DO UPDATE SET
            pj = pj + 1,
            pg = pg + ?,
            pp1 = pp1 + ?,
            pp0 = pp0 + ?,
            puntos = puntos + ?
    `).bind(
        ligaNombre, local,
        puntosLocal === 3 ? 1 : 0,
        puntosLocal === 1 ? 1 : 0,
        puntosLocal === 0 ? 1 : 0,
        puntosLocal,
        puntosLocal === 3 ? 1 : 0,
        puntosLocal === 1 ? 1 : 0,
        puntosLocal === 0 ? 1 : 0,
        puntosLocal
    ).run();
    
    // Actualizar equipo visitante
    await db.prepare(`
        INSERT INTO liga_clasificacion (liga_nombre, equipo, pj, pg, pp1, pp0, puntos)
        VALUES (?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(liga_nombre, equipo) DO UPDATE SET
            pj = pj + 1,
            pg = pg + ?,
            pp1 = pp1 + ?,
            pp0 = pp0 + ?,
            puntos = puntos + ?
    `).bind(
        ligaNombre, visitante,
        puntosVisitante === 3 ? 1 : 0,
        puntosVisitante === 1 ? 1 : 0,
        puntosVisitante === 0 ? 1 : 0,
        puntosVisitante,
        puntosVisitante === 3 ? 1 : 0,
        puntosVisitante === 1 ? 1 : 0,
        puntosVisitante === 0 ? 1 : 0,
        puntosVisitante
    ).run();
}