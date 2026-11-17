// ==================== CONFIGURACIÓN ====================
    const API_URL = '/api/liga';

    let isAdmin = false;
    let ligas = [];          // [{ slug, nombre, num_equipos }]
    let currentLiga = null;  // slug de la liga seleccionada
    let equipos = [];        // ordenados por clasificación (lo calcula la API)
    let calendario = {};     // { jornada: [partido] }
    const editando = new Set(); // ids de partidos jugados cuyo resultado se está corrigiendo

    const url = action => `${API_URL}?action=${action}`;

    // ==================== INICIALIZACIÓN ====================
    async function init() {
        checkAdminAuth();
        configurarEventos();
        await cargarLigas();
        // La liga se puede indicar en la URL (?liga=femenino), p. ej. desde un enlace compartido
        const pedida = new URLSearchParams(location.search).get('liga');
        seleccionarLiga(ligas.some(l => l.slug === pedida) ? pedida : ligas[0]?.slug);
    }

    function checkAdminAuth() {
        isAdmin = esAdmin();
        document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
        document.getElementById('adminBadge').style.display = isAdmin ? 'flex' : 'none';
    }

    function configurarEventos() {
        // Navegación de ligas (los botones se crean en mostrarLigas)
        document.getElementById('ligaNav').addEventListener('click', e => {
            const btn = e.target.closest('.liga-btn');
            if (btn) seleccionarLiga(btn.dataset.liga);
        });

        document.getElementById('shareStandingsBtn').addEventListener('click', compartirClasificacion);

        if (isAdmin) {
            document.getElementById('addTeamBtn')?.addEventListener('click', agregarEquipo);
            document.getElementById('generateCalendarBtn')?.addEventListener('click', generarCalendario);
            document.getElementById('resetLigaBtn')?.addEventListener('click', resetearLiga);
            document.getElementById('teamName')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') agregarEquipo();
            });
            document.getElementById('addLeagueBtn')?.addEventListener('click', crearLiga);
            document.getElementById('leagueName')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') crearLiga();
            });
        }
    }

    function nombreLiga(slug = currentLiga) {
        return ligas.find(l => l.slug === slug)?.nombre || '';
    }

    async function recargar() {
        if (!currentLiga) return;
        await Promise.all([cargarEquipos(), cargarCalendario()]);
    }

    // ==================== LIGAS ====================
    async function cargarLigas() {
        try {
            const data = await apiFetch(url('getLigas'));
            ligas = data.success ? data.data : [];
        } catch (error) {
            console.error('Error cargando ligas:', error);
            ligas = [];
        }
        mostrarLigas();
    }

    function mostrarLigas() {
        const nav = document.getElementById('ligaNav');
        nav.innerHTML = ligas.length
            ? ligas.map(l => `
                <button class="liga-btn ${l.slug === currentLiga ? 'active' : ''}" data-liga="${escapeHtml(l.slug)}">
                    ${escapeHtml(l.nombre)}
                </button>`).join('')
            : `<span class="info-text" style="padding: 0.5rem 1rem;">No hay ligas${isAdmin ? ': crea una en el panel de administración' : ''}</span>`;

        const lista = document.getElementById('leaguesList');
        if (!lista) return;
        lista.innerHTML = ligas.map(l => `
            <div class="team-tag">
                <span>${escapeHtml(l.nombre)} <small style="color: #94a3b8;">(${Number(l.num_equipos)})</small></span>
                <button class="edit-team" title="Cambiar nombre" onclick="renombrarLiga('${escapeHtml(l.slug)}')">✎</button>
                <button class="remove-team" title="Eliminar" onclick="eliminarLiga('${escapeHtml(l.slug)}')">✕</button>
            </div>
        `).join('');
    }

    function seleccionarLiga(slug) {
        currentLiga = slug || null;
        editando.clear();
        document.querySelectorAll('.liga-btn').forEach(b => b.classList.toggle('active', b.dataset.liga === currentLiga));

        // Mantener la liga en la URL para poder compartir el enlace
        const direccion = new URL(location.href);
        if (currentLiga) direccion.searchParams.set('liga', currentLiga);
        else direccion.searchParams.delete('liga');
        history.replaceState(null, '', direccion);

        if (!currentLiga) {
            equipos = [];
            calendario = {};
            mostrarEquipos();
            mostrarClasificacion();
            mostrarCalendario();
            return;
        }
        recargar();
    }

    async function crearLiga() {
        if (!isAdmin) return;
        const input = document.getElementById('leagueName');
        const nombre = input.value.trim();
        if (!nombre) {
            notificar('❌ Escribe el nombre de la liga', 'error');
            return;
        }
        const data = await enviarAccion(url('crearLiga'), { nombre }, { ok: `✅ Liga "${nombre}" creada`, error: 'Error al crear la liga' });
        if (data) {
            input.value = '';
            await cargarLigas();
            seleccionarLiga(data.slug);
        }
    }

    async function renombrarLiga(slug) {
        if (!isAdmin) return;
        const actual = nombreLiga(slug);
        const nombre = await pedirTexto('Nuevo nombre de la liga (puede incluir un emoji):', actual, { titulo: '✎ Cambiar nombre de la liga' });
        if (!nombre || nombre === actual) return;
        if (await enviarAccion(url('renombrarLiga'), { slug, nombre }, { ok: '✅ Liga renombrada', error: 'Error al renombrar' })) {
            await cargarLigas();
        }
    }

    async function eliminarLiga(slug) {
        if (!isAdmin) return;
        const liga = ligas.find(l => l.slug === slug);
        if (!liga) return;
        const aviso = liga.num_equipos > 0
            ? `\nSe borrarán también sus ${liga.num_equipos} parejas, el calendario y todos los resultados. No se puede deshacer.`
            : '';
        const seguro = await confirmar(`¿Eliminar la liga "${liga.nombre}"?${aviso}`, {
            titulo: '🗑️ Eliminar liga', textoAceptar: 'Eliminar liga', peligro: true
        });
        if (!seguro) return;

        if (await enviarAccion(url('eliminarLiga'), { slug }, { ok: `✅ Liga "${liga.nombre}" eliminada`, error: 'Error al eliminar' })) {
            await cargarLigas();
            if (currentLiga === slug) seleccionarLiga(ligas[0]?.slug);
        }
    }

    // ==================== EQUIPOS ====================
    async function cargarEquipos() {
        const liga = currentLiga;
        try {
            const data = await apiFetch(`${url('getEquipos')}&liga=${encodeURIComponent(liga)}`);
            if (liga !== currentLiga) return; // el usuario cambió de liga mientras cargaba

            if (data.success) {
                equipos = data.data;
                mostrarEquipos();
                mostrarClasificacion();
                document.getElementById('teamCount').textContent = equipos.length;
            } else {
                console.error('Error cargando equipos:', data.error);
            }
        } catch (error) {
            console.error('Error de conexión:', error);
            document.getElementById('teamsList').innerHTML =
                '<p style="color: #ef4444;">❌ Error de conexión con el servidor</p>';
        }
    }

    function mostrarEquipos() {
        const container = document.getElementById('teamsList');

        if (equipos.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8;">No hay equipos registrados</p>';
            return;
        }

        // La API devuelve los equipos ordenados por clasificación; aquí se listan alfabéticamente
        const porNombre = [...equipos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        container.innerHTML = porNombre.map(equipo => `
            <div class="team-tag">
                <span>🎾 ${escapeHtml(equipo.nombre)}</span>
                ${isAdmin ? `
                    <button class="edit-team" title="Cambiar nombre" onclick="renombrarEquipo(${Number(equipo.id)})">✎</button>
                    <button class="remove-team" title="Eliminar" onclick="eliminarEquipo(${Number(equipo.id)})">✕</button>
                ` : ''}
            </div>
        `).join('');
    }

    async function renombrarEquipo(id) {
        if (!isAdmin) return;
        const equipo = equipos.find(e => e.id === id);
        if (!equipo) return;

        const nombre = await pedirTexto('Nuevo nombre de la pareja:', equipo.nombre, { titulo: '✎ Cambiar nombre' });
        if (!nombre || nombre === equipo.nombre) return;

        if (await enviarAccion(url('renameEquipo'), { id, nombre }, { ok: `✅ Ahora se llama "${nombre}"`, error: 'Error al renombrar' })) {
            await recargar();
        }
    }

    async function agregarEquipo() {
        if (!isAdmin) return;

        const input = document.getElementById('teamName');
        const nombre = input.value.trim();

        if (!nombre) {
            notificar('❌ Introduce el nombre de la pareja', 'error');
            return;
        }
        if (equipos.some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) {
            notificar('⚠️ Esta pareja ya está inscrita en esta liga', 'error');
            return;
        }

        if (await enviarAccion(url('addEquipo'), { liga: currentLiga, nombre }, { ok: `✅ "${nombre}" añadida`, error: 'Error al añadir' })) {
            input.value = '';
            input.focus();
            await Promise.all([cargarEquipos(), cargarLigas()]);
        }
    }

    async function eliminarEquipo(id) {
        if (!isAdmin) return;
        const equipo = equipos.find(e => e.id === id);
        if (!await confirmar(`¿Eliminar a "${equipo?.nombre}" de la liga?`, { titulo: 'Eliminar pareja', textoAceptar: 'Eliminar', peligro: true })) return;

        if (await enviarAccion(url('deleteEquipo'), { id }, { ok: '✅ Pareja eliminada', error: 'Error al eliminar' })) {
            await Promise.all([recargar(), cargarLigas()]);
        }
    }

    // ==================== CALENDARIO ====================
    async function cargarCalendario() {
        const liga = currentLiga;
        try {
            const data = await apiFetch(`${url('getCalendario')}&liga=${encodeURIComponent(liga)}`);
            if (liga !== currentLiga) return;

            if (data.success) {
                calendario = data.data;
                mostrarCalendario();
            }
        } catch (error) {
            console.error('Error cargando calendario:', error);
        }
    }

    function mostrarCalendario() {
        const container = document.getElementById('matchesContainer');

        if (!calendario || Object.keys(calendario).length === 0) {
            container.innerHTML = '<p class="info-text">📅 Genera el calendario para ver los partidos</p>';
            return;
        }

        let html = '';
        for (const jornada in calendario) {
            const j = Number(jornada);
            html += `
                <div class="jornada">
                    <div class="jornada-header" onclick="toggleJornada(this)">
                        <span>📅 Jornada ${j}</span>
                        <span style="display: flex; align-items: center; gap: 0.75rem;">
                            <button class="btn-icono" title="Compartir jornada" onclick="event.stopPropagation(); compartirJornada(${j})">📤</button>
                            <span>▼</span>
                        </span>
                    </div>
                    <div class="jornada-partidos">
                        ${calendario[jornada].map((partido, idx) => mostrarPartido(partido, j, idx)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    function cabeceraPartido(partido) {
        return `
            <div class="partido-equipos">
                <button class="ui-enlace equipo-nombre" onclick="verPareja(${Number(partido.local_id)})">${escapeHtml(partido.local)}</button>
                <span class="vs">vs</span>
                <button class="ui-enlace equipo-nombre" onclick="verPareja(${Number(partido.visitante_id)})">${escapeHtml(partido.visitante)}</button>
            </div>
        `;
    }

    // "6-2, 3-6, 7-5" (desde el punto de vista del local, o del equipo indicado)
    function textoSets(p, desdeVisitante = false) {
        const partes = [];
        for (let n = 1; n <= 3; n++) {
            const l = p[`set${n}_local`];
            const v = p[`set${n}_visitante`];
            if (l === null || l === undefined || v === null || v === undefined) continue;
            partes.push(desdeVisitante ? `${v}-${l}` : `${l}-${v}`);
        }
        return partes.join(', ');
    }

    function setsGanados(p) {
        let local = 0;
        let visitante = 0;
        for (let n = 1; n <= 3; n++) {
            const l = p[`set${n}_local`];
            const v = p[`set${n}_visitante`];
            if (l === null || l === undefined || v === null || v === undefined) continue;
            if (l > v) local++; else visitante++;
        }
        return { local, visitante };
    }

    function mostrarPartido(partido, jornada, idx) {
        const enEdicion = editando.has(partido.id);

        if (partido.completado && !enEdicion) {
            return `
                <div class="partido">
                    ${cabeceraPartido(partido)}
                    <div class="resultado-detalle">
                        <span>🎾 Resultado: ${textoSets(partido)}</span>
                        <span class="resultado-badge">🏆 ${partido.puntos_local} - ${partido.puntos_visitante} pts</span>
                    </div>
                    ${isAdmin ? `
                        <div class="action-buttons">
                            <button class="btn btn-secondary btn-sm" onclick="editarResultado(${jornada}, ${idx})">✏️ Corregir</button>
                            <button class="btn btn-danger btn-sm" onclick="anularResultado(${jornada}, ${idx})">🗑️ Anular</button>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        if (!isAdmin) {
            return `
                <div class="partido">
                    ${cabeceraPartido(partido)}
                    <div class="info-text" style="text-align:center;">⏳ Partido pendiente</div>
                </div>
            `;
        }

        // Al corregir, el formulario se rellena con el resultado guardado
        const valor = v => (enEdicion && v !== null && v !== undefined) ? `value="${Number(v)}"` : '';
        const setInput = (n, opcional) => `
            <div class="set-card">
                <label>🎾 SET ${n}${opcional ? ' (opcional)' : ''}</label>
                <div class="set-inputs">
                    <input type="number" id="set${n}_local_${jornada}_${idx}" placeholder="${opcional ? '' : '0'}" min="0" max="7" step="1" style="width:55px;" ${valor(partido[`set${n}_local`])}>
                    <span>-</span>
                    <input type="number" id="set${n}_visit_${jornada}_${idx}" placeholder="${opcional ? '' : '0'}" min="0" max="7" step="1" style="width:55px;" ${valor(partido[`set${n}_visitante`])}>
                </div>
            </div>
        `;

        return `
            <div class="partido">
                ${cabeceraPartido(partido)}
                <div class="sets-container">
                    ${setInput(1, false)}
                    ${setInput(2, false)}
                    ${setInput(3, true)}
                </div>
                <div class="action-buttons">
                    <button class="btn btn-success btn-sm" onclick="guardarResultado(${jornada}, ${idx})">
                        💾 ${enEdicion ? 'Guardar Corrección' : 'Guardar Resultado'}
                    </button>
                    ${enEdicion ? `<button class="btn btn-secondary btn-sm" onclick="cancelarEdicion(${jornada}, ${idx})">Cancelar</button>` : ''}
                </div>
            </div>
        `;
    }

    async function guardarResultado(jornada, idx) {
        if (!isAdmin) return;
        const partido = calendario[jornada]?.[idx];
        if (!partido) return;

        const sets = [1, 2, 3].map(n => [
            leerNumero(`set${n}_local_${jornada}_${idx}`),
            leerNumero(`set${n}_visit_${jornada}_${idx}`)
        ]);
        const validacion = validarResultado(sets);
        if (validacion.error) {
            notificar(validacion.error, 'error');
            return;
        }

        const eraCorreccion = editando.has(partido.id);
        const ok = await enviarAccion(url('guardarResultado'), {
            liga: currentLiga,
            id: partido.id,
            set1_local: sets[0][0], set1_visitante: sets[0][1],
            set2_local: sets[1][0], set2_visitante: sets[1][1],
            set3_local: sets[2][0], set3_visitante: sets[2][1]
        }, {
            ok: `✅ ${eraCorreccion ? 'Resultado corregido' : 'Resultado guardado'}: ${partido.local} ${validacion.setsLocal}-${validacion.setsVisitante} ${partido.visitante}`,
            error: 'Error al guardar'
        });

        if (ok) {
            editando.delete(partido.id);
            await recargar();
        }
    }

    function editarResultado(jornada, idx) {
        const partido = calendario[jornada]?.[idx];
        if (!isAdmin || !partido) return;
        editando.add(partido.id);
        mostrarCalendario();
    }

    function cancelarEdicion(jornada, idx) {
        const partido = calendario[jornada]?.[idx];
        if (!partido) return;
        editando.delete(partido.id);
        mostrarCalendario();
    }

    async function anularResultado(jornada, idx) {
        const partido = calendario[jornada]?.[idx];
        if (!isAdmin || !partido) return;
        const seguro = await confirmar(
            `¿Anular el resultado de ${partido.local} vs ${partido.visitante}?\nEl partido volverá a quedar pendiente.`,
            { titulo: 'Anular resultado', textoAceptar: 'Anular', peligro: true }
        );
        if (!seguro) return;

        if (await enviarAccion(url('anularResultado'), { liga: currentLiga, id: partido.id }, { ok: '✅ Resultado anulado', error: 'Error al anular' })) {
            editando.delete(partido.id);
            await recargar();
        }
    }

    async function generarCalendario() {
        if (!isAdmin) return;

        if (equipos.length < 2) {
            notificar(`⚠️ Necesitas al menos 2 equipos. Actualmente hay ${equipos.length}.`, 'error');
            return;
        }
        if (Object.keys(calendario).length > 0) {
            const seguro = await confirmar(
                'Ya hay un calendario. Si lo regeneras se borrarán todos los resultados y la clasificación.',
                { titulo: '🎲 Regenerar calendario', textoAceptar: 'Regenerar', peligro: true }
            );
            if (!seguro) return;
        }

        // El calendario (todos contra todos) se genera en el servidor
        if (await enviarAccion(url('generarCalendario'), { liga: currentLiga }, { ok: '✅ Calendario generado', error: 'Error al generar el calendario' })) {
            editando.clear();
            await recargar();
        }
    }

    async function resetearLiga() {
        if (!isAdmin) return;
        const seguro = await confirmar(
            `¿Resetear el calendario y la clasificación de ${nombreLiga()}?\nSe perderán todos los resultados (las parejas se mantienen).`,
            { titulo: '🔄 Resetear liga', textoAceptar: 'Resetear', peligro: true }
        );
        if (!seguro) return;

        if (await enviarAccion(url('resetLiga'), { liga: currentLiga }, { ok: '✅ Liga reseteada', error: 'Error al resetear' })) {
            editando.clear();
            await recargar();
        }
    }

    // ==================== CLASIFICACIÓN ====================
    const conSigno = n => (n > 0 ? `+${n}` : `${n}`);
    const difSets = e => (e.sets_favor || 0) - (e.sets_contra || 0);
    const difJuegos = e => (e.juegos_favor || 0) - (e.juegos_contra || 0);

    function mostrarClasificacion() {
        const container = document.getElementById('standingsContainer');

        if (equipos.length === 0) {
            container.innerHTML = '<p class="info-text">No hay equipos registrados</p>';
            return;
        }

        // El orden (con desempates) lo calcula el servidor
        const medallas = ['🏆', '🥈', '🥉'];

        let html = '<div class="standings-wrapper"><table class="standings-table">';
        html += '<thead><tr>';
        html += '<th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PP1</th><th>PP0</th>';
        html += '<th title="Diferencia de sets">DS</th><th title="Diferencia de juegos">DJ</th><th>Pts</th>';
        html += '</tr></thead><tbody>';

        equipos.forEach((equipo, idx) => {
            html += `
                <tr>
                    <td>${idx + 1}${medallas[idx] ? ' ' + medallas[idx] : ''}</td>
                    <td><button class="ui-enlace" title="Ver partidos" onclick="verPareja(${Number(equipo.id)})">${escapeHtml(equipo.nombre)}</button></td>
                    <td>${equipo.pj || 0}</td>
                    <td>${equipo.pg || 0}</td>
                    <td>${equipo.pp1 || 0}</td>
                    <td>${equipo.pp0 || 0}</td>
                    <td>${conSigno(difSets(equipo))}</td>
                    <td>${conSigno(difJuegos(equipo))}</td>
                    <td><strong style="color: #38bdf8;">${equipo.puntos || 0}</strong></td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        html += `<p class="info-text" style="margin-top: 0.5rem; font-size: 0.75rem;">
            Pulsa en una pareja para ver sus partidos. Desempates: enfrentamiento directo (si empatan dos equipos),
            diferencia de sets, diferencia de juegos y sets a favor.
        </p>`;
        container.innerHTML = html;
    }

    // ==================== FICHA DE PAREJA ====================
    // Partidos de una pareja vistos desde su lado
    function partidosDe(id) {
        return Object.values(calendario).flat()
            .filter(p => p.local_id === id || p.visitante_id === id)
            .sort((a, b) => a.jornada - b.jornada || a.id - b.id)
            .map(p => {
                const esLocal = p.local_id === id;
                const sets = setsGanados(p);
                const puntos = esLocal ? p.puntos_local : p.puntos_visitante;
                return {
                    jornada: p.jornada,
                    rival: esLocal ? p.visitante : p.local,
                    rivalId: esLocal ? p.visitante_id : p.local_id,
                    jugado: !!p.completado,
                    puntos,
                    marcador: esLocal ? `${sets.local}-${sets.visitante}` : `${sets.visitante}-${sets.local}`,
                    sets: textoSets(p, !esLocal),
                    // ✅ victoria, 🟡 derrota 2-1 (1 punto), ❌ derrota 2-0
                    icono: puntos === 3 ? '✅' : puntos === 1 ? '🟡' : '❌'
                };
            });
    }

    function verPareja(id) {
        const equipo = equipos.find(e => e.id === id);
        if (!equipo) return;
        const posicion = equipos.indexOf(equipo) + 1;
        const partidos = partidosDe(id);
        const jugados = partidos.filter(p => p.jugado);
        const pendientes = partidos.filter(p => !p.jugado);
        const racha = jugados.slice(-5);

        const stat = (valor, etiqueta) => `<div class="pareja-stat"><strong>${valor}</strong><span>${etiqueta}</span></div>`;
        const fila = (p, derecha) => `
            <div class="pareja-partido">
                <div>
                    <div>vs <strong>${escapeHtml(p.rival)}</strong></div>
                    <div class="detalle">Jornada ${Number(p.jornada)}</div>
                </div>
                <div style="text-align: right;">${derecha}</div>
            </div>`;

        const html = `
            <div class="pareja-stats">
                ${stat(`${posicion}º`, 'Posición')}
                ${stat(equipo.puntos, 'Puntos')}
                ${stat(equipo.pj, 'Jugados')}
                ${stat(equipo.pg, 'Ganados')}
                ${stat(equipo.pp1, 'Perd. 2-1')}
                ${stat(equipo.pp0, 'Perd. 2-0')}
                ${stat(conSigno(difSets(equipo)), 'Dif. sets')}
                ${stat(conSigno(difJuegos(equipo)), 'Dif. juegos')}
            </div>
            ${racha.length ? `
                <div class="pareja-racha">
                    <span style="color: #94a3b8;">Últimos partidos:</span>
                    ${racha.map(p => `<span title="vs ${escapeHtml(p.rival)}: ${escapeHtml(p.sets)}">${p.icono}</span>`).join('')}
                </div>` : ''}
            <div class="pareja-seccion">Jugados (${jugados.length})</div>
            ${jugados.length
                ? jugados.map(p => fila(p, `${p.icono} <strong>${p.marcador}</strong> <span class="detalle">(${escapeHtml(p.sets)})</span><div class="detalle">+${p.puntos} pts</div>`)).join('')
                : '<p class="info-text">Todavía no ha jugado ningún partido</p>'}
            <div class="pareja-seccion">Pendientes (${pendientes.length})</div>
            ${pendientes.length
                ? pendientes.map(p => fila(p, '⏳ Pendiente')).join('')
                : '<p class="info-text">No tiene partidos pendientes</p>'}
        `;

        abrirVentana({
            titulo: `🎾 ${equipo.nombre}`,
            html,
            ancho: 560,
            botones: [
                { texto: '📤 Compartir', alPulsar: () => { compartirPareja(equipo, posicion, jugados, pendientes); } },
                { texto: 'Cerrar', clase: 'btn-primary', valor: null }
            ]
        });
    }

    // ==================== COMPARTIR ====================
    const enlaceLiga = () => `👉 ${location.origin}/liga.html?liga=${encodeURIComponent(currentLiga)}`;

    function compartirClasificacion() {
        if (equipos.length === 0) {
            notificar('No hay equipos en esta liga', 'info');
            return;
        }
        const medallas = ['🥇', '🥈', '🥉'];
        const lineas = [`🏆 *Clasificación · ${nombreLiga()}*`, ''];
        equipos.forEach((e, i) => {
            lineas.push(`${medallas[i] || `${i + 1}.`} ${e.nombre} — *${e.puntos} pts* (${e.pj} PJ, ${e.pg} G, DS ${conSigno(difSets(e))})`);
        });
        lineas.push('', enlaceLiga());
        compartirTexto('Compartir clasificación', lineas.join('\n'));
    }

    function compartirJornada(jornada) {
        const partidos = calendario[jornada] || [];
        const lineas = [`📅 *Jornada ${jornada} · ${nombreLiga()}*`, ''];
        for (const p of partidos) {
            if (p.completado) {
                const s = setsGanados(p);
                const local = s.local > s.visitante ? `*${p.local}*` : p.local;
                const visitante = s.visitante > s.local ? `*${p.visitante}*` : p.visitante;
                lineas.push(`✅ ${local} ${s.local}-${s.visitante} ${visitante} (${textoSets(p)})`);
            } else {
                lineas.push(`⏳ ${p.local} vs ${p.visitante}`);
            }
        }
        lineas.push('', enlaceLiga());
        compartirTexto(`Compartir jornada ${jornada}`, lineas.join('\n'));
    }

    function compartirPareja(equipo, posicion, jugados, pendientes) {
        const lineas = [
            `🎾 *${equipo.nombre}* · ${nombreLiga()}`,
            `${posicion}º con ${equipo.puntos} pts (${equipo.pj} PJ, ${equipo.pg} G)`,
            ''
        ];
        for (const p of jugados) lineas.push(`${p.icono} J${p.jornada} vs ${p.rival}: ${p.marcador} (${p.sets})`);
        for (const p of pendientes) lineas.push(`⏳ J${p.jornada} vs ${p.rival}`);
        lineas.push('', enlaceLiga());
        compartirTexto(`Compartir ${equipo.nombre}`, lineas.join('\n'));
    }

    // ==================== UTILIDADES ====================
    window.toggleJornada = function(element) {
        element.parentElement.classList.toggle('collapsed');
    };

    window.eliminarEquipo = eliminarEquipo;
    window.renombrarEquipo = renombrarEquipo;
    window.guardarResultado = guardarResultado;
    window.editarResultado = editarResultado;
    window.cancelarEdicion = cancelarEdicion;
    window.anularResultado = anularResultado;
    window.verPareja = verPareja;
    window.compartirJornada = compartirJornada;
    window.renombrarLiga = renombrarLiga;
    window.eliminarLiga = eliminarLiga;

    // Iniciar
    init();
