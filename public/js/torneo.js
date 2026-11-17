// ==================== CONFIGURACIÓN ====================
    const API_URL = '/api/torneo';

    let isAdmin = false;
    let equiposTorneo = [];   // [{ id, nombre }]
    let torneo = null;        // { rounds: [[match]] }
    let ganador = null;
    let torneoInfo = null;    // fila de la tabla torneo (estado, nombre...)
    let cuadroActualGenerado = false; // el torneo actual (no el del historial) ya tiene cuadro
    let archivo = null;       // { id, nombre } si se está viendo un torneo del historial
    let historial = [];       // torneos archivados
    let superTiebreak = false; // el torneo actual juega el tercer set como súper tie-break
    let matchActual = null;

    const url = action => `${API_URL}?action=${action}`;

    // Se puede editar el cuadro que se está viendo (no los torneos archivados)
    function puedeEditarCuadro() {
        return isAdmin && !archivo;
    }

    // ==================== INICIALIZACIÓN ====================
    function init() {
        checkAdminAuth();
        configurarEventos();
        cargarTorneo();
    }

    function checkAdminAuth() {
        isAdmin = esAdmin();
        document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
        document.getElementById('adminBadge').style.display = isAdmin ? 'flex' : 'none';
    }

    function configurarEventos() {
        document.getElementById('shareBracketBtn').addEventListener('click', compartirCuadro);

        if (isAdmin) {
            document.getElementById('addTeamBtn').addEventListener('click', agregarEquipo);
            document.getElementById('generateTournamentBtn').addEventListener('click', generarTorneo);
            document.getElementById('resetTournamentBtn').addEventListener('click', resetearTorneo);
            document.getElementById('teamName').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') agregarEquipo();
            });
            document.getElementById('confirmResultBtn').addEventListener('click', confirmarResultado);
            document.getElementById('annulResultBtn').addEventListener('click', anularResultado);
            document.getElementById('superTiebreakTorneo').addEventListener('change', cambiarSuperTiebreak);
        }
    }

    // ==================== CARGAR TORNEO DESDE BD ====================
    async function cargarTorneo() {
        const direccion = archivo
            ? `${url('getTorneo')}&id=${encodeURIComponent(archivo.id)}`
            : url('getTorneo');
        try {
            const data = await apiFetch(direccion);

            if (data.success && data.data) {
                torneo = reconstruirTorneo(data.data.partidos);
                ganador = data.data.torneo?.ganador || null;
                torneoInfo = data.data.torneo || null;
                if (!archivo) {
                    equiposTorneo = data.data.equipos || [];
                    cuadroActualGenerado = !!torneo;
                    superTiebreak = !!data.data.torneo?.super_tiebreak;
                }
            } else {
                torneo = null;
                ganador = null;
                torneoInfo = null;
                if (!archivo) {
                    equiposTorneo = [];
                    cuadroActualGenerado = false;
                    superTiebreak = false;
                }
            }
        } catch (error) {
            console.error('Error cargando torneo:', error);
            torneo = null;
            ganador = null;
            torneoInfo = null;
        }
        actualizarUI();
        cargarHistorial();
    }

    // ==================== HISTORIAL ====================
    async function cargarHistorial() {
        const card = document.getElementById('historyCard');
        const lista = document.getElementById('historyList');
        try {
            const data = await apiFetch(url('getHistorial'));
            const torneos = data.success ? data.data : [];
            if (torneos.length === 0) {
                card.style.display = 'none';
                return;
            }
            card.style.display = 'block';
            lista.innerHTML = torneos.map(t => {
                const fecha = t.finalizado_en ? new Date(t.finalizado_en).toLocaleDateString('es-ES') : '';
                return `
                    <div class="history-item">
                        <div>
                            <div class="history-name">${escapeHtml(t.nombre || 'Torneo')}</div>
                            <div class="history-meta">${escapeHtml(fecha)} · ${Number(t.num_equipos)} equipos</div>
                            <div class="history-meta">🏆 ${escapeHtml(t.campeon || '-')} · 🥈 ${escapeHtml(t.subcampeon || '-')}</div>
                        </div>
                        <button class="btn btn-secondary btn-sm" onclick="verTorneoArchivado(${Number(t.id)})">👁️ Ver cuadro</button>
                    </div>
                `;
            }).join('');
            historial = torneos;
        } catch (error) {
            console.error('Error cargando historial:', error);
            card.style.display = 'none';
        }
    }

    async function verTorneoArchivado(id) {
        const t = historial.find(x => x.id === id);
        archivo = { id, nombre: t?.nombre || 'Torneo' };
        await cargarTorneo();
        document.getElementById('bracketCard').scrollIntoView({ behavior: 'smooth' });
    }

    async function volverAlActual() {
        archivo = null;
        await cargarTorneo();
    }

    async function archivarTorneo() {
        if (!puedeEditarCuadro()) return;
        const porDefecto = `Torneo ${new Date().toLocaleDateString('es-ES')}`;
        const nombre = await pedirTexto('Nombre con el que se guardará en el historial:', porDefecto, {
            titulo: '📦 Guardar en el historial',
            textoAceptar: 'Guardar'
        });
        if (nombre === null) return;

        const data = await enviarAccion(url('archivarTorneo'), { nombre: nombre || porDefecto }, { error: 'Error al archivar' });
        if (data) {
            notificar(`✅ "${data.nombre}" guardado en el historial.\nYa puedes inscribir parejas para un torneo nuevo.`);
            await cargarTorneo();
        }
    }

    function contarSets(p, lado) {
        const otro = lado === 'local' ? 'visitante' : 'local';
        let ganados = 0;
        for (let n = 1; n <= 3; n++) {
            const a = p[`set${n}_${lado}`];
            const b = p[`set${n}_${otro}`];
            if (a !== null && b !== null && a > b) ganados++;
        }
        return ganados;
    }

    function reconstruirTorneo(partidos) {
        if (!partidos || partidos.length === 0) return null;

        const porRonda = new Map();
        [...partidos]
            .sort((a, b) => a.ronda - b.ronda || a.orden - b.orden)
            .forEach(p => {
                if (!porRonda.has(p.ronda)) porRonda.set(p.ronda, []);
                porRonda.get(p.ronda).push({
                    dbId: p.id,
                    team1Id: p.equipo1_id,
                    team2Id: p.equipo2_id,
                    winnerId: p.ganador_id,
                    team1: p.equipo1,
                    team2: p.equipo2,
                    winner: p.ganador,
                    played: !!p.completado,
                    resultado: (p.completado && p.set1_local !== null) ? {
                        set1: { local: p.set1_local, visitante: p.set1_visitante },
                        set2: { local: p.set2_local, visitante: p.set2_visitante },
                        set3: p.set3_local !== null ? { local: p.set3_local, visitante: p.set3_visitante } : null,
                        setsGanadosLocal: contarSets(p, 'local'),
                        setsGanadosVisitante: contarSets(p, 'visitante')
                    } : null
                });
            });

        return { rounds: [...porRonda.values()] };
    }

    function actualizarUI() {
        mostrarEquipos();
        if (torneo && torneo.rounds.length > 0) {
            document.getElementById('bracketCard').style.display = 'block';
            mostrarBracket();
        } else {
            document.getElementById('bracketCard').style.display = 'none';
        }

        const banner = document.getElementById('archiveBanner');
        if (archivo) {
            banner.style.display = 'flex';
            banner.innerHTML = `
                <span>📚 Viendo el historial: <strong>${escapeHtml(archivo.nombre)}</strong></span>
                <button class="btn btn-secondary btn-sm" onclick="volverAlActual()">↩️ Volver al torneo actual</button>
            `;
        } else {
            banner.style.display = 'none';
            banner.innerHTML = '';
        }

        mostrarGanador();
        mostrarOpcionesTorneo();
        document.getElementById('teamCount').textContent = equiposTorneo.length;
    }

    // ==================== OPCIONES DEL TORNEO ====================
    function mostrarOpcionesTorneo() {
        const casilla = document.getElementById('superTiebreakTorneo');
        if (!casilla) return;
        casilla.checked = superTiebreak;
    }

    async function cambiarSuperTiebreak(e) {
        const activar = e.target.checked;
        const ok = await enviarAccion(url('configurarTorneo'), { super_tiebreak: activar }, {
            ok: activar
                ? '✅ En este torneo el tercer set será un súper tie-break'
                : '✅ En este torneo el tercer set vuelve a ser un set normal',
            error: 'Error al cambiar la opción'
        });
        if (!ok) {
            e.target.checked = !activar;  // deshacer el cambio visual
            return;
        }
        superTiebreak = activar;
    }

    // ==================== GESTIÓN DE EQUIPOS ====================
    async function agregarEquipo() {
        if (!isAdmin) return;

        const input = document.getElementById('teamName');
        const nombre = input.value.trim();

        if (!nombre) {
            notificar('❌ Introduce el nombre de la pareja', 'error');
            return;
        }
        if (cuadroActualGenerado) {
            notificar('⚠️ El torneo ya está generado. Guárdalo en el historial (si ha terminado) o resetéalo para inscribir parejas nuevas.', 'error');
            return;
        }
        if (equiposTorneo.some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) {
            notificar('⚠️ Esta pareja ya está inscrita', 'error');
            return;
        }

        if (await enviarAccion(url('addEquipo'), { nombre }, { ok: `✅ "${nombre}" inscrita`, error: 'Error al añadir' })) {
            input.value = '';
            input.focus();
            await cargarTorneo();
        }
    }

    async function eliminarEquipo(id) {
        if (!isAdmin) return;
        const equipo = equiposTorneo.find(e => e.id === id);
        if (!await confirmar(`¿Quitar a "${equipo?.nombre}" del torneo?`, { titulo: 'Quitar pareja', textoAceptar: 'Quitar', peligro: true })) return;

        if (await enviarAccion(url('deleteEquipo'), { id }, { ok: '✅ Pareja eliminada', error: 'Error al eliminar' })) {
            await cargarTorneo();
        }
    }

    function mostrarEquipos() {
        const container = document.getElementById('teamsList');

        if (equiposTorneo.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8;">No hay equipos inscritos</p>';
            return;
        }

        // Una vez generado el cuadro no se pueden quitar equipos (sí cambiarles el nombre)
        const puedeEliminar = isAdmin && !cuadroActualGenerado;
        container.innerHTML = equiposTorneo.map(equipo => `
            <div class="team-tag">
                <span>🎾 ${escapeHtml(equipo.nombre)}</span>
                ${isAdmin ? `<button class="edit-team" title="Cambiar nombre" onclick="renombrarEquipo(${Number(equipo.id)})">✎</button>` : ''}
                ${puedeEliminar ? `<button class="remove-team" title="Eliminar" onclick="eliminarEquipo(${Number(equipo.id)})">✕</button>` : ''}
            </div>
        `).join('');
    }

    async function renombrarEquipo(id) {
        if (!isAdmin) return;
        const equipo = equiposTorneo.find(e => e.id === id);
        if (!equipo) return;

        const nombre = await pedirTexto('Nuevo nombre de la pareja:', equipo.nombre, { titulo: '✎ Cambiar nombre' });
        if (!nombre || nombre === equipo.nombre) return;

        if (await enviarAccion(url('renameEquipo'), { id, nombre }, { ok: `✅ Ahora se llama "${nombre}"`, error: 'Error al renombrar' })) {
            await cargarTorneo();
        }
    }

    // ==================== GENERAR TORNEO ====================
    async function generarTorneo() {
        if (!isAdmin) return;
        if (equiposTorneo.length < 2) {
            notificar('⚠️ Necesitas al menos 2 parejas', 'error');
            return;
        }
        if (cuadroActualGenerado) {
            const seguro = await confirmar(
                'Ya hay un cuadro generado. Si haces un nuevo sorteo se perderán sus resultados.',
                { titulo: '🎲 Nuevo sorteo', textoAceptar: 'Sortear de nuevo', peligro: true }
            );
            if (!seguro) return;
        }

        // El sorteo se hace en el servidor con los equipos inscritos
        if (await enviarAccion(url('crearTorneo'), {}, { ok: '✅ Cuadro generado', error: 'Error al generar el torneo' })) {
            archivo = null;
            await cargarTorneo();
        }
    }

    // ==================== MOSTRAR BRACKET ====================
    function mostrarBracket() {
        const container = document.getElementById('bracketContainer');
        if (!torneo) return;

        let html = '';
        torneo.rounds.forEach((round, r) => {
            const titulo = obtenerTituloRonda(r, torneo.rounds.length, round.length);
            html += `<div class="round"><div class="round-title">${titulo}</div>`;
            round.forEach((match, m) => { html += generarMatchHTML(r, m, match); });
            html += `</div>`;
        });
        container.innerHTML = html;
    }

    function obtenerTituloRonda(ronda, total, numPartidos) {
        if (ronda === total - 1) return '🏆 FINAL';
        if (ronda === total - 2) return '🥉 SEMIFINAL';
        if (ronda === total - 3) return '🎯 CUARTOS DE FINAL';
        if (ronda === total - 4) return '📊 OCTAVOS DE FINAL';
        return `RONDA ${ronda + 1} (${numPartidos} partidos)`;
    }

    function textoResultado(resultado) {
        let s = `${resultado.set1.local}-${resultado.set1.visitante}, ${resultado.set2.local}-${resultado.set2.visitante}`;
        if (resultado.set3) s += `, ${resultado.set3.local}-${resultado.set3.visitante}`;
        return s;
    }

    function generarMatchHTML(ronda, indice, match) {
        // En la primera ronda un hueco vacío es un descanso; en las demás, un rival por decidir
        const esBye1 = ronda === 0 && !match.team1;
        const esBye2 = ronda === 0 && !match.team2;
        const team1Display = match.team1 || (esBye1 ? '🔵 DESCANSO' : '?');
        const team2Display = match.team2 || (esBye2 ? '🔵 DESCANSO' : '?');
        const resultado = match.resultado;

        const tieneGanador = !!match.winnerId;
        const ambosPresentes = !!match.team1Id && !!match.team2Id;
        const puedeJugar = ambosPresentes && !tieneGanador && puedeEditarCuadro();
        // Un resultado se puede corregir mientras el ganador no haya jugado la ronda siguiente
        const siguiente = torneo.rounds[ronda + 1]?.[Math.floor(indice / 2)];
        const puedeCorregir = puedeEditarCuadro() && tieneGanador && !!resultado && !siguiente?.played;

        const slot = (nombre, esGanador, sets) => `
            <div class="team-slot ${esGanador ? 'winner' : ''}">
                <span class="team-name">${escapeHtml(nombre)}</span>
                ${resultado ? `<span class="team-score">${sets} sets</span>` : ''}
            </div>`;

        let html = `<div class="match">
            <div class="match-teams">
                ${slot(team1Display, tieneGanador && match.winnerId === match.team1Id, resultado?.setsGanadosLocal ?? 0)}
                ${slot(team2Display, tieneGanador && match.winnerId === match.team2Id, resultado?.setsGanadosVisitante ?? 0)}
            </div>`;

        if (tieneGanador && resultado) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#10b981;">✅ ${textoResultado(resultado)}</div>`;
            html += `<div style="text-align:center; font-size:0.7rem;">🏆 Avanza: ${escapeHtml(match.winner)}</div>`;
            if (puedeCorregir) {
                html += `<button class="btn-edit-match" onclick="abrirModalResultado(${ronda}, ${indice})">✏️ Corregir resultado</button>`;
            }
        } else if (tieneGanador && (esBye1 || esBye2)) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#f59e0b;">🔄 ${escapeHtml(match.winner)} avanza automáticamente por descanso</div>`;
        } else if (tieneGanador) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem;">🏆 Avanza: ${escapeHtml(match.winner)}</div>`;
        } else if (puedeJugar) {
            html += `<button class="btn-play" onclick="abrirModalResultado(${ronda}, ${indice})">🎾 Registrar Resultado (3 sets)</button>`;
        } else if (ambosPresentes) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#94a3b8;">⏳ Partido pendiente</div>`;
        } else {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#94a3b8;">⏳ Esperando rivales...</div>`;
        }

        html += `</div>`;
        return html;
    }

    // ==================== MODAL DE RESULTADOS ====================
    function abrirModalResultado(ronda, indice) {
        const match = torneo?.rounds[ronda]?.[indice];
        if (!match || !match.team1Id || !match.team2Id) return;

        const r = match.resultado; // si existe, se está corrigiendo
        matchActual = { id: match.dbId, equipo1: match.team1, equipo2: match.team2, correccion: !!r };

        document.getElementById('modalTitle').textContent =
            r ? '✏️ Corregir Resultado del Partido' : '🎾 Registrar Resultado del Partido';
        document.getElementById('modalTeams').innerHTML = `
            <strong>${escapeHtml(match.team1)}</strong> vs <strong>${escapeHtml(match.team2)}</strong>
        `;

        document.getElementById('modal_set1_local').value = r ? r.set1.local : 0;
        document.getElementById('modal_set1_visit').value = r ? r.set1.visitante : 0;
        document.getElementById('modal_set2_local').value = r ? r.set2.local : 0;
        document.getElementById('modal_set2_visit').value = r ? r.set2.visitante : 0;
        document.getElementById('modal_set3_local').value = r?.set3 ? r.set3.local : '';
        document.getElementById('modal_set3_visit').value = r?.set3 ? r.set3.visitante : '';
        document.getElementById('annulResultBtn').style.display = r ? '' : 'none';

        // Tercer set: normal o súper tie-break según la opción del torneo
        const stb = superTiebreak;
        document.getElementById('modalSet3Label').textContent = stb ? '🎾 SÚPER TIE-BREAK (si 1-1, a 10)' : '🎾 SET 3 (opcional)';
        for (const id of ['modal_set3_local', 'modal_set3_visit']) document.getElementById(id).max = stb ? 30 : 7;

        document.getElementById('resultModal').classList.add('active');
    }

    async function anularResultado() {
        if (!matchActual) return;
        const partido = matchActual;
        const seguro = await confirmar(
            `¿Anular el resultado de ${partido.equipo1} vs ${partido.equipo2}?\nEl partido volverá a quedar pendiente.`,
            { titulo: 'Anular resultado', textoAceptar: 'Anular', peligro: true }
        );
        if (!seguro) return;

        if (await enviarAccion(url('anularPartido'), { id: partido.id }, { ok: '✅ Resultado anulado', error: 'Error al anular' })) {
            cerrarModal();
            await cargarTorneo();
        }
    }

    function cerrarModal() {
        document.getElementById('resultModal').classList.remove('active');
        matchActual = null;
    }

    async function confirmarResultado() {
        if (!matchActual) return;
        const partido = matchActual; // copia: cerrarModal() pone matchActual a null

        const sets = [1, 2, 3].map(n => [
            leerNumero(`modal_set${n}_local`),
            leerNumero(`modal_set${n}_visit`)
        ]);
        const validacion = validarResultado(sets, { superTiebreak });
        if (validacion.error) {
            notificar(validacion.error, 'error');
            return;
        }

        const data = await enviarAccion(url('guardarPartido'), {
            id: partido.id,
            set1_local: sets[0][0], set1_visitante: sets[0][1],
            set2_local: sets[1][0], set2_visitante: sets[1][1],
            set3_local: sets[2][0], set3_visitante: sets[2][1]
        }, { error: 'Error al guardar' });

        if (data) {
            cerrarModal();
            let detalle = `${sets[0][0]}-${sets[0][1]}, ${sets[1][0]}-${sets[1][1]}`;
            if (validacion.haySet3) detalle += `, ${sets[2][0]}-${sets[2][1]}`;
            notificar(
                `✅ ${partido.correccion ? 'Resultado corregido' : 'Partido registrado'}\n` +
                `${partido.equipo1} ${data.setsLocal}-${data.setsVisitante} ${partido.equipo2} (${detalle})\n` +
                `🏆 Avanza: ${data.ganador}`
            );
            await cargarTorneo();
        }
    }

    function mostrarGanador() {
        const container = document.getElementById('winnerAnnouncement');
        if (!ganador) {
            container.style.display = 'none';
            container.innerHTML = '';
            return;
        }
        container.style.display = 'block';
        container.innerHTML = `
            <h2>🏆 CAMPEÓN DEL TORNEO 🏆</h2>
            <h1 style="font-size: 2rem; margin-top: 0.5rem;">🎉 ${escapeHtml(ganador)} 🎉</h1>
            <p style="margin-top: 0.5rem;">¡Felicidades a los campeones!</p>
            ${puedeEditarCuadro() && torneoInfo?.estado === 'activo' ? `
                <button class="btn btn-primary" style="margin-top: 1rem;" onclick="archivarTorneo()">
                    📦 Guardar en el historial y empezar un torneo nuevo
                </button>
            ` : ''}
        `;
    }

    async function resetearTorneo() {
        if (!isAdmin) return;
        const seguro = await confirmar(
            '¿Resetear el torneo actual?\nSe perderán sus parejas y resultados. El historial se conserva.',
            { titulo: '🔄 Resetear torneo', textoAceptar: 'Resetear', peligro: true }
        );
        if (!seguro) return;

        if (await enviarAccion(url('resetTorneo'), {}, { ok: '✅ Torneo reseteado', error: 'Error al resetear' })) {
            archivo = null;
            await cargarTorneo();
        }
    }

    // ==================== COMPARTIR ====================
    function compartirCuadro() {
        if (!torneo) return;
        const nombre = archivo?.nombre || torneoInfo?.nombre || 'Torneo de pádel';
        const lineas = [`🏆 *${nombre}*`];

        torneo.rounds.forEach((round, r) => {
            const titulo = obtenerTituloRonda(r, torneo.rounds.length, round.length).replace(/^\S+\s/, '');
            lineas.push('', `*${titulo}*`);
            for (const m of round) {
                if (m.resultado) {
                    const gana1 = m.winnerId === m.team1Id;
                    const e1 = gana1 ? `*${m.team1}*` : m.team1;
                    const e2 = gana1 ? m.team2 : `*${m.team2}*`;
                    lineas.push(`✅ ${e1} ${m.resultado.setsGanadosLocal}-${m.resultado.setsGanadosVisitante} ${e2} (${textoResultado(m.resultado)})`);
                } else if (m.winnerId) {
                    lineas.push(`🔄 ${m.winner} pasa por descanso`);
                } else if (m.team1Id || m.team2Id) {
                    lineas.push(`⏳ ${m.team1 || '?'} vs ${m.team2 || '?'}`);
                }
            }
        });

        if (ganador) lineas.push('', `🥇 *Campeones: ${ganador}*`);
        lineas.push('', `👉 ${location.origin}/torneo.html`);
        compartirTexto('Compartir cuadro', lineas.join('\n'));
    }

    // ==================== UTILIDADES ====================
    window.eliminarEquipo = eliminarEquipo;
    window.renombrarEquipo = renombrarEquipo;
    window.abrirModalResultado = abrirModalResultado;
    window.cerrarModal = cerrarModal;
    window.verTorneoArchivado = verTorneoArchivado;
    window.volverAlActual = volverAlActual;
    window.archivarTorneo = archivarTorneo;

    // Iniciar
    init();
