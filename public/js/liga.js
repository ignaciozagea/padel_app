// ==================== CONFIGURACIÓN ====================
    const API_URL = '/api/liga';

    let isAdmin = false;
    let ligas = [];          // [{ slug, nombre, num_equipos }]
    let currentLiga = null;  // slug de la liga seleccionada
    let equipos = [];        // ordenados por clasificación (lo calcula la API)
    let calendario = {};     // { jornada: [partido] }
    const editando = new Set(); // ids de partidos con el formulario de resultado abierto (registrar o corregir)
    const jornadasAbiertas = new Map(); // jornada -> abierta (true/false) si el usuario la ha plegado/desplegado

    const url = action => `${API_URL}?action=${action}`;

    // ==================== INICIALIZACIÓN ====================
    async function init() {
        checkAdminAuth();
        configurarEventos();
        iniciarComentarios('liga', tituloPartido);
        await cargarLigas();
        // La liga se puede indicar en la URL (?liga=femenino), p. ej. desde un enlace compartido
        const pedida = new URLSearchParams(location.search).get('liga');
        seleccionarLiga(ligas.some(l => l.slug === pedida) ? pedida : ligas[0]?.slug);
    }

    // Título de la ventana de comentarios de un partido
    function tituloPartido(id) {
        const p = Object.values(calendario).flat().find(x => x.id === id);
        return p ? `${p.local} vs ${p.visitante} · Jornada ${p.jornada}` : 'Comentarios';
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
            document.getElementById('superTiebreakLiga')?.addEventListener('change', cambiarSuperTiebreak);
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
                <button class="liga-btn ${l.slug === currentLiga ? 'active' : ''}" role="tab"
                        aria-selected="${l.slug === currentLiga}" data-liga="${escapeHtml(l.slug)}">${escapeHtml(l.nombre)}</button>`).join('')
            : `<span class="info-text" style="padding: 0.5rem 1rem; margin: 0;">No hay ligas${isAdmin ? ': crea una en el panel de administración' : ''}</span>`;

        const lista = document.getElementById('leaguesList');
        if (!lista) return;
        lista.innerHTML = ligas.map(l => `
            <div class="team-tag">
                <span>${escapeHtml(l.nombre)} <small>(${Number(l.num_equipos)}${l.super_tiebreak ? ' · STB' : ''})</small></span>
                <button class="btn-ico" title="Cambiar nombre" aria-label="Cambiar nombre de la liga" onclick="renombrarLiga('${escapeHtml(l.slug)}')">${icono('editar')}</button>
                <button class="btn-ico peligro" title="Eliminar" aria-label="Eliminar la liga" onclick="eliminarLiga('${escapeHtml(l.slug)}')">${icono('papelera')}</button>
            </div>
        `).join('');
        mostrarOpcionesLiga();
    }

    // En el móvil las pestañas se deslizan: que la liga elegida quede a la vista
    function mostrarPestanaActiva() {
        const activa = document.querySelector('.liga-btn.active');
        activa?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // ¿La liga seleccionada juega el tercer set como súper tie-break?
    function usaSuperTiebreak() {
        return !!ligas.find(l => l.slug === currentLiga)?.super_tiebreak;
    }

    function mostrarOpcionesLiga() {
        const casilla = document.getElementById('superTiebreakLiga');
        if (!casilla) return;
        casilla.checked = usaSuperTiebreak();
        casilla.disabled = !currentLiga;
    }

    async function cambiarSuperTiebreak(e) {
        const activar = e.target.checked;
        const ok = await enviarAccion(url('configurarLiga'), { slug: currentLiga, super_tiebreak: activar }, {
            ok: activar
                ? `✅ En ${nombreLiga()} el tercer set será un súper tie-break`
                : `✅ En ${nombreLiga()} el tercer set vuelve a ser un set normal`,
            error: 'Error al cambiar la opción'
        });
        if (!ok) {
            e.target.checked = !activar;  // deshacer el cambio visual
            return;
        }
        const liga = ligas.find(l => l.slug === currentLiga);
        if (liga) liga.super_tiebreak = activar ? 1 : 0;
        mostrarLigas();
        mostrarCalendario();
    }

    function seleccionarLiga(slug) {
        currentLiga = slug || null;
        editando.clear();
        document.querySelectorAll('.liga-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.liga === currentLiga);
            b.setAttribute('aria-selected', String(b.dataset.liga === currentLiga));
        });
        jornadasAbiertas.clear();
        mostrarOpcionesLiga();
        mostrarPestanaActiva();

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
        const nombre = await pedirTexto('Nuevo nombre de la liga:', actual, { titulo: 'Cambiar nombre de la liga' });
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
            titulo: 'Eliminar liga', textoAceptar: 'Eliminar liga', iconoAceptar: 'papelera', peligro: true
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
                '<p class="info-text" style="color: #f87171;">Error de conexión con el servidor</p>';
        }
    }

    function mostrarEquipos() {
        const container = document.getElementById('teamsList');

        if (equipos.length === 0) {
            container.innerHTML = '<p class="info-text" style="margin: 0;">Todavía no hay parejas en esta liga</p>';
            return;
        }

        // La API devuelve los equipos ordenados por clasificación; aquí se listan alfabéticamente
        const porNombre = [...equipos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
        container.innerHTML = porNombre.map(equipo => `
            <div class="team-tag">
                <span class="con-avatar">${avatar(equipo.nombre, { tipo: 'pareja', id: equipo.id, fotoV: equipo.foto_v, tam: 'xs' })}<span>${escapeHtml(equipo.nombre)}</span></span>
                ${isAdmin ? `
                    <button class="btn-ico" title="Foto" aria-label="Foto de la pareja" onclick="fotoPareja(${Number(equipo.id)})">${icono('camara')}</button>
                    <button class="btn-ico" title="Cambiar nombre" aria-label="Cambiar nombre de la pareja" onclick="renombrarEquipo(${Number(equipo.id)})">${icono('editar')}</button>
                    <button class="btn-ico peligro" title="Eliminar" aria-label="Eliminar la pareja" onclick="eliminarEquipo(${Number(equipo.id)})">${icono('papelera')}</button>
                ` : ''}
            </div>
        `).join('');
    }

    async function renombrarEquipo(id) {
        if (!isAdmin) return;
        const equipo = equipos.find(e => e.id === id);
        if (!equipo) return;

        const nombre = await pedirTexto('Nuevo nombre de la pareja:', equipo.nombre, { titulo: 'Cambiar nombre' });
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
            container.innerHTML = `<p class="info-text">${isAdmin
                ? 'Todavía no hay calendario: añade las parejas y pulsa «Generar calendario».'
                : 'Todavía no hay calendario para esta liga.'}</p>`;
            return;
        }

        // Aviso para todos (no solo admin) de cómo se juega el tercer set en esta liga
        let html = usaSuperTiebreak()
            ? `<div class="aviso-liga">${icono('pelota')}<span>En esta liga el tercer set se juega como <strong>súper tie-break</strong> (a 10 puntos, diferencia de 2).</span></div>`
            : '';
        for (const jornada in calendario) {
            const j = Number(jornada);
            const partidos = calendario[jornada];
            const jugados = partidos.filter(p => p.completado).length;
            // Las jornadas ya jugadas empiezan plegadas (salvo que el usuario las haya abierto)
            const abierta = jornadasAbiertas.has(j)
                ? jornadasAbiertas.get(j)
                : jugados < partidos.length || partidos.some(p => editando.has(p.id));
            html += `
                <div class="jornada ${abierta ? '' : 'collapsed'}" data-jornada="${j}">
                    <div class="jornada-header" onclick="toggleJornada(this)" role="button" tabindex="0"
                         aria-expanded="${abierta}" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleJornada(this); }">
                        <span class="jornada-titulo">
                            ${icono('calendario')} Jornada ${j}
                            <span class="jornada-progreso">${jugados}/${partidos.length} jugados</span>
                        </span>
                        <span class="jornada-acciones">
                            <button class="btn-ico" title="Compartir jornada" aria-label="Compartir la jornada ${j}"
                                    onclick="event.stopPropagation(); compartirJornada(${j})">${icono('compartir')}</button>
                            <span class="desplegar">${icono('desplegar')}</span>
                        </span>
                    </div>
                    <div class="jornada-partidos">
                        ${partidos.map((partido, idx) => mostrarPartido(partido, j, idx)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
        pintarZonasComentarios();
    }

    // Una fila del marcador: nombre de la pareja, juegos de cada set y puntos obtenidos
    function filaMarcador(p, lado, sets) {
        const esLocal = lado === 'local';
        const otro = esLocal ? 'visitante' : 'local';
        const nombre = esLocal ? p.local : p.visitante;
        const id = esLocal ? p.local_id : p.visitante_id;
        const ganador = !!p.completado && (esLocal ? sets.local > sets.visitante : sets.visitante > sets.local);

        const juegos = [];
        if (p.completado) {
            for (let n = 1; n <= 3; n++) {
                const a = p[`set${n}_${lado}`];
                const b = p[`set${n}_${otro}`];
                if (a === null || a === undefined || b === null || b === undefined) continue;
                juegos.push(`<span class="juego ${a > b ? 'gana' : ''}">${Number(a)}</span>`);
            }
        }
        const puntos = p.completado ? Number(esLocal ? p.puntos_local : p.puntos_visitante) : null;

        return `
            <div class="marcador-fila ${ganador ? 'ganador' : ''}">
                <span class="con-avatar nombre">${avatarPareja(id, nombre, 'xs')}<button class="ui-enlace" onclick="verPareja(${Number(id)})">${escapeHtml(nombre)}</button></span>
                <span class="juegos">${juegos.join('')}</span>
                <span class="puntos">${puntos === null ? '' : `${puntos} pt${puntos === 1 ? '' : 's'}`}</span>
            </div>`;
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

    // Cada partido es un marcador de dos filas (una por pareja), como en las retransmisiones.
    // El administrador abre el formulario con "Resultado" (pendiente) o "Corregir" (jugado).
    function mostrarPartido(partido, jornada, idx) {
        const sets = setsGanados(partido);
        const marcador = `
            <div class="marcador">
                ${filaMarcador(partido, 'local', sets)}
                ${filaMarcador(partido, 'visitante', sets)}
            </div>`;

        if (isAdmin && editando.has(partido.id)) {
            return `<div class="partido en-edicion">${marcador}${formularioResultado(partido, jornada, idx)}</div>`;
        }

        let pie;
        if (partido.completado) {
            pie = `<span class="estado">${icono('check-circulo')} Jugado</span>`;
            if (isAdmin) {
                pie += `
                    <span class="acciones">
                        <button class="btn btn-secondary btn-sm" onclick="editarResultado(${jornada}, ${idx})">${icono('editar')}Corregir</button>
                        <button class="btn btn-danger btn-sm" onclick="anularResultado(${jornada}, ${idx})">${icono('papelera')}Anular</button>
                    </span>`;
            }
        } else {
            pie = `<span class="estado">${icono('reloj')} Pendiente</span>`;
            if (isAdmin) {
                pie += `
                    <span class="acciones">
                        <button class="btn btn-primary btn-sm" onclick="editarResultado(${jornada}, ${idx})">${icono('mas')}Resultado</button>
                    </span>`;
            }
        }

        return `
            <div class="partido ${partido.completado ? 'jugado' : 'pendiente'}">
                ${marcador}
                <div class="partido-pie">${pie}</div>
                ${zonaComentarios(partido.id)}
            </div>`;
    }

    // Formulario para registrar o corregir el resultado (al corregir, viene relleno)
    function formularioResultado(partido, jornada, idx) {
        const valor = v => (partido.completado && v !== null && v !== undefined) ? `value="${Number(v)}"` : '';
        const stb = usaSuperTiebreak();
        const setInput = n => {
            const esStb = n === 3 && stb;
            const etiqueta = esStb ? 'Súper tie-break (si 1-1)' : n === 3 ? 'Set 3 (si 1-1)' : `Set ${n}`;
            const max = esStb ? 30 : 7;
            const marcador = n === 3 ? '' : '0';
            return `
            <div class="set-card">
                <label for="set${n}_local_${jornada}_${idx}">${etiqueta}</label>
                <div class="set-inputs">
                    <input type="number" inputmode="numeric" id="set${n}_local_${jornada}_${idx}" placeholder="${marcador}" min="0" max="${max}" step="1"
                           aria-label="${etiqueta}: ${escapeHtml(partido.local)}" ${valor(partido[`set${n}_local`])}>
                    <span>-</span>
                    <input type="number" inputmode="numeric" id="set${n}_visit_${jornada}_${idx}" placeholder="${marcador}" min="0" max="${max}" step="1"
                           aria-label="${etiqueta}: ${escapeHtml(partido.visitante)}" ${valor(partido[`set${n}_visitante`])}>
                </div>
            </div>`;
        };

        return `
            <p class="info-text" style="margin: 0.25rem 0 0;">
                Juegos de <strong>${escapeHtml(partido.local)}</strong> – <strong>${escapeHtml(partido.visitante)}</strong>
            </p>
            <div class="sets-container">${setInput(1)}${setInput(2)}${setInput(3)}</div>
            <div class="action-buttons">
                <button class="btn btn-secondary btn-sm" onclick="cancelarEdicion(${jornada}, ${idx})">Cancelar</button>
                <button class="btn btn-success btn-sm" onclick="guardarResultado(${jornada}, ${idx})">
                    ${icono('check')}${partido.completado ? 'Guardar corrección' : 'Guardar resultado'}
                </button>
            </div>`;
    }

    async function guardarResultado(jornada, idx) {
        if (!isAdmin) return;
        const partido = calendario[jornada]?.[idx];
        if (!partido) return;

        const sets = [1, 2, 3].map(n => [
            leerNumero(`set${n}_local_${jornada}_${idx}`),
            leerNumero(`set${n}_visit_${jornada}_${idx}`)
        ]);
        const validacion = validarResultado(sets, { superTiebreak: usaSuperTiebreak() });
        if (validacion.error) {
            notificar(validacion.error, 'error');
            return;
        }

        const eraCorreccion = !!partido.completado;
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
        jornadasAbiertas.set(jornada, true);
        mostrarCalendario();
        document.getElementById(`set1_local_${jornada}_${idx}`)?.focus();
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
                { titulo: 'Regenerar calendario', iconoTitulo: 'calendario', textoAceptar: 'Regenerar', peligro: true }
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
            { titulo: 'Resetear liga', iconoTitulo: 'reiniciar', textoAceptar: 'Resetear', peligro: true }
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
            container.innerHTML = '<p class="info-text">Todavía no hay parejas en esta liga</p>';
            return;
        }

        // El orden (con desempates) lo calcula el servidor. Los tres primeros llevan medalla de color.
        const signo = n => `<span class="${n > 0 ? 'positivo' : n < 0 ? 'negativo' : ''}">${conSigno(n)}</span>`;

        let html = '<div class="standings-wrapper"><table class="standings-table">';
        html += '<thead><tr>';
        html += '<th>#</th><th>Pareja</th><th title="Partidos jugados">PJ</th><th title="Partidos ganados">PG</th>';
        html += '<th title="Perdidos 2-1">PP1</th><th title="Perdidos 2-0">PP0</th>';
        html += '<th title="Diferencia de sets">DS</th><th title="Diferencia de juegos">DJ</th><th>Pts</th>';
        html += '</tr></thead><tbody>';

        equipos.forEach((equipo, idx) => {
            html += `
                <tr>
                    <td><span class="pos ${idx < 3 ? `pos-${idx + 1}` : ''}">${idx + 1}</span></td>
                    <td><span class="con-avatar">${avatarPareja(equipo.id, equipo.nombre, 'sm')}<button class="ui-enlace" title="Ver partidos" onclick="verPareja(${Number(equipo.id)})">${escapeHtml(equipo.nombre)}</button></span></td>
                    <td>${equipo.pj || 0}</td>
                    <td>${equipo.pg || 0}</td>
                    <td>${equipo.pp1 || 0}</td>
                    <td>${equipo.pp0 || 0}</td>
                    <td>${signo(difSets(equipo))}</td>
                    <td>${signo(difJuegos(equipo))}</td>
                    <td class="col-pts">${equipo.puntos || 0}</td>
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

    // ==================== FOTOS ====================
    // Avatar de una pareja: su foto o sus iniciales de color
    function avatarPareja(id, nombre, tam) {
        const equipo = equipos.find(e => e.id === id);
        return avatar(nombre, { tipo: 'pareja', id, fotoV: equipo?.foto_v, tam });
    }

    async function fotoPareja(id) {
        const equipo = equipos.find(e => e.id === id);
        if (!isAdmin || !equipo) return;
        if (await gestionarFoto({ tipo: 'pareja', id, nombre: equipo.nombre, fotoV: equipo.foto_v })) {
            await recargar();
        }
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
                    // Para WhatsApp: ✅ victoria, 🟡 derrota 2-1 (1 punto), ❌ derrota 2-0
                    icono: puntos === 3 ? '✅' : puntos === 1 ? '🟡' : '❌',
                    // Para la web: V (victoria), D (derrota 2-1, ámbar) o D (derrota 2-0, rojo)
                    chip: puntos === 3
                        ? '<span class="racha racha-v" title="Victoria">V</span>'
                        : `<span class="racha ${puntos === 1 ? 'racha-d1' : 'racha-d0'}" title="Derrota ${puntos === 1 ? '2-1' : '2-0'}">D</span>`
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
            <div class="ficha-cabecera">
                ${avatarPareja(equipo.id, equipo.nombre, 'lg')}
                <div><strong>${escapeHtml(equipo.nombre)}</strong><span class="sub">${posicion}º · ${equipo.puntos} puntos</span></div>
            </div>
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
                    ${racha.map(p => p.chip).join('')}
                </div>` : ''}
            <div class="pareja-seccion">Jugados (${jugados.length})</div>
            ${jugados.length
                ? jugados.map(p => fila(p, `${p.chip} <strong>${p.marcador}</strong> <span class="detalle">(${escapeHtml(p.sets)})</span><div class="detalle">+${p.puntos} pts</div>`)).join('')
                : '<p class="info-text">Todavía no ha jugado ningún partido</p>'}
            <div class="pareja-seccion">Pendientes (${pendientes.length})</div>
            ${pendientes.length
                ? pendientes.map(p => fila(p, `<span class="detalle" style="display: inline-flex; align-items: center; gap: 0.3rem;">${icono('reloj')} Pendiente</span>`)).join('')
                : '<p class="info-text">No tiene partidos pendientes</p>'}
        `;

        abrirVentana({
            titulo: 'Ficha de la pareja',
            iconoTitulo: 'pareja',
            html,
            ancho: 560,
            botones: [
                { texto: 'Compartir', icono: 'compartir', alPulsar: () => { compartirPareja(equipo, posicion, jugados, pendientes); } },
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
    // Plegar/desplegar una jornada y recordarlo mientras no se cambie de liga
    window.toggleJornada = function(element) {
        const jornada = element.parentElement;
        const abierta = jornada.classList.toggle('collapsed') === false;
        element.setAttribute('aria-expanded', String(abierta));
        jornadasAbiertas.set(Number(jornada.dataset.jornada), abierta);
    };

    window.eliminarEquipo = eliminarEquipo;
    window.renombrarEquipo = renombrarEquipo;
    window.guardarResultado = guardarResultado;
    window.editarResultado = editarResultado;
    window.cancelarEdicion = cancelarEdicion;
    window.anularResultado = anularResultado;
    window.verPareja = verPareja;
    window.fotoPareja = fotoPareja;
    window.compartirJornada = compartirJornada;
    window.renombrarLiga = renombrarLiga;
    window.eliminarLiga = eliminarLiga;

    // Iniciar
    init();
