// ==================== LIGA INDIVIDUAL ====================
// Cada jugador puntúa por su cuenta. En cada jornada se hacen grupos de 4 por orden (jornada 1: orden que
// fija el administrador; después: clasificación) y en cada grupo el 1º y el 3º juegan contra el 2º y el 4º.
    const API_URL = '/api/individual';

    let isAdmin = false;
    let estado = null;          // respuesta de getEstado
    const editando = new Set(); // ids de partidos con el formulario de resultado abierto
    const jornadasAbiertas = new Map();

    const url = action => `${API_URL}?action=${action}`;

    // ==================== INICIALIZACIÓN ====================
    function init() {
        isAdmin = esAdmin();
        document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
        document.getElementById('adminBadge').style.display = isAdmin ? 'flex' : 'none';

        document.getElementById('shareStandingsBtn').addEventListener('click', compartirClasificacion);
        if (isAdmin) {
            document.getElementById('addPlayerBtn').addEventListener('click', agregarJugador);
            document.getElementById('playerName').addEventListener('keypress', e => {
                if (e.key === 'Enter') agregarJugador();
            });
            document.getElementById('generateRoundBtn').addEventListener('click', generarJornada);
            document.getElementById('undoRoundBtn').addEventListener('click', deshacerJornada);
            document.getElementById('resetIndividualBtn').addEventListener('click', resetear);
            document.getElementById('superTiebreakIndividual').addEventListener('change', cambiarSuperTiebreak);
        }
        iniciarComentarios('individual', tituloPartido);
        cargar();
    }

    // Título de la ventana de comentarios de un partido
    function tituloPartido(id) {
        const p = estado?.partidos.find(x => x.id === id);
        return p ? `${p.local1}/${p.local2} vs ${p.visitante1}/${p.visitante2} · Jornada ${p.jornada}` : 'Comentarios';
    }

    async function cargar() {
        try {
            const data = await apiFetch(url('getEstado'));
            if (data.success) {
                estado = data.data;
                pintar();
            }
        } catch (error) {
            console.error('Error cargando la liga individual:', error);
            document.getElementById('standingsContainer').innerHTML =
                '<p class="info-text" style="color: #f87171;">Error de conexión con el servidor</p>';
        }
    }

    function pintar() {
        mostrarJugadores();
        mostrarPanelJornadas();
        mostrarClasificacion();
        mostrarJornadas();
    }

    // ==================== JUGADORES (administración) ====================
    function mostrarJugadores() {
        if (!isAdmin) return;
        const lista = document.getElementById('playersList');
        const info = document.getElementById('playersInfo');
        const jugadores = estado.jugadores;
        const bloqueado = estado.empezada;

        if (jugadores.length === 0) {
            lista.innerHTML = '';
            info.textContent = 'Añade a los jugadores y ordénalos: ese orden decide las parejas de la jornada 1.';
            return;
        }

        lista.innerHTML = jugadores.map((j, i) => `
            <li>
                <span class="num">${i + 1}º</span>
                <span class="nombre-jugador con-avatar">${avatarJugador(j.id, j.nombre, 'xs')}<span>${escapeHtml(j.nombre)}</span></span>
                ${bloqueado ? '' : `
                    <button class="btn-ico" title="Subir" aria-label="Subir a ${escapeHtml(j.nombre)}" ${i === 0 ? 'disabled' : ''}
                            onclick="moverJugador(${Number(j.id)}, -1)">${icono('subir')}</button>
                    <button class="btn-ico" title="Bajar" aria-label="Bajar a ${escapeHtml(j.nombre)}" ${i === jugadores.length - 1 ? 'disabled' : ''}
                            onclick="moverJugador(${Number(j.id)}, 1)">${icono('desplegar')}</button>`}
                <button class="btn-ico" title="Foto" aria-label="Foto de ${escapeHtml(j.nombre)}" onclick="fotoJugador(${Number(j.id)})">${icono('camara')}</button>
                <button class="btn-ico" title="Cambiar nombre" aria-label="Cambiar nombre" onclick="renombrarJugador(${Number(j.id)})">${icono('editar')}</button>
                ${bloqueado ? '' : `<button class="btn-ico peligro" title="Eliminar" aria-label="Eliminar a ${escapeHtml(j.nombre)}" onclick="eliminarJugador(${Number(j.id)})">${icono('papelera')}</button>`}
            </li>
        `).join('');

        const n = jugadores.length;
        if (bloqueado) {
            info.textContent = `${n} jugadores. La liga ya ha empezado: para cambiar jugadores u orden hay que resetearla.`;
        } else if (n >= 4 && n % 4 === 0) {
            info.textContent = `${n} jugadores: listo para empezar. El orden de la lista decide las parejas de la jornada 1.`;
        } else {
            const faltan = 4 - (n % 4);
            info.textContent = `${n} jugadores. Tienen que ser múltiplo de 4: faltan ${faltan} para llegar a ${n + faltan}.`;
        }
    }

    async function agregarJugador() {
        const input = document.getElementById('playerName');
        const nombre = input.value.trim();
        if (!nombre) {
            notificar('Escribe el nombre del jugador', 'error');
            return;
        }
        if (await enviarAccion(url('addJugador'), { nombre }, { ok: `"${nombre}" añadido`, error: 'Error al añadir' })) {
            input.value = '';
            input.focus();
            await cargar();
        }
    }

    async function moverJugador(id, delta) {
        const ids = estado.jugadores.map(j => j.id);
        const i = ids.indexOf(id);
        const destino = i + delta;
        if (i < 0 || destino < 0 || destino >= ids.length) return;
        [ids[i], ids[destino]] = [ids[destino], ids[i]];
        if (await enviarAccion(url('ordenarJugadores'), { ids }, { error: 'Error al ordenar' })) {
            await cargar();
        }
    }

    async function renombrarJugador(id) {
        const jugador = estado.jugadores.find(j => j.id === id);
        if (!jugador) return;
        const nombre = await pedirTexto('Nuevo nombre del jugador:', jugador.nombre, { titulo: 'Cambiar nombre' });
        if (!nombre || nombre === jugador.nombre) return;
        if (await enviarAccion(url('renameJugador'), { id, nombre }, { ok: `Ahora se llama "${nombre}"`, error: 'Error al renombrar' })) {
            await cargar();
        }
    }

    async function eliminarJugador(id) {
        const jugador = estado.jugadores.find(j => j.id === id);
        if (!await confirmar(`¿Eliminar a "${jugador?.nombre}" de la liga individual?`, {
            titulo: 'Eliminar jugador', textoAceptar: 'Eliminar', iconoAceptar: 'papelera', peligro: true
        })) return;
        if (await enviarAccion(url('deleteJugador'), { id }, { ok: 'Jugador eliminado', error: 'Error al eliminar' })) {
            await cargar();
        }
    }

    // ==================== JORNADAS (administración) ====================
    function mostrarPanelJornadas() {
        const progreso = estado.empezada ? `Jornada ${estado.jornadaActual} de ${estado.totalJornadas}` : 'Sin empezar';
        document.getElementById('progresoLiga').textContent = estado.terminada ? 'Liga terminada' : progreso;
        if (!isAdmin) return;

        const n = estado.jugadores.length;
        const siguiente = estado.jornadaActual + 1;
        const boton = document.getElementById('generateRoundBtn');
        boton.querySelector('span').textContent = estado.empezada ? `Generar jornada ${siguiente}` : 'Empezar liga (jornada 1)';
        boton.disabled = !estado.puedeGenerar;
        boton.style.display = estado.terminada ? 'none' : '';
        document.getElementById('undoRoundBtn').style.display = estado.empezada ? '' : 'none';
        document.getElementById('superTiebreakIndividual').checked = estado.superTiebreak;

        let titulo;
        let detalle = '';
        if (estado.terminada) {
            titulo = `Liga terminada (${estado.totalJornadas} jornadas)`;
            detalle = 'Para empezar otra con los mismos jugadores, resetéala.';
        } else if (!estado.empezada) {
            titulo = 'Sin empezar';
            detalle = `Liga de ${estado.totalJornadas} jornadas.`;
        } else {
            titulo = `Jornada ${estado.jornadaActual} de ${estado.totalJornadas}`;
        }
        document.getElementById('estadoLiga').innerHTML = `${escapeHtml(titulo)}${detalle ? `<small>${escapeHtml(detalle)}</small>` : ''}`;

        let pista = '';
        if (!estado.puedeGenerar && !estado.terminada) {
            if (!estado.empezada) {
                pista = n < 4 ? 'Hacen falta al menos 4 jugadores.' : `Hacen falta 4, 8, 12, 16… jugadores (ahora hay ${n}).`;
            } else {
                const pendientes = estado.partidos.filter(p => p.jornada === estado.jornadaActual && !p.completado).length;
                pista = pendientes === 1
                    ? `Para generar la jornada ${siguiente} falta 1 resultado de la jornada ${estado.jornadaActual}.`
                    : `Para generar la jornada ${siguiente} faltan ${pendientes} resultados de la jornada ${estado.jornadaActual}.`;
            }
        } else if (estado.puedeGenerar && estado.empezada) {
            pista = `La jornada ${siguiente} se formará con la clasificación actual.`;
        }
        document.getElementById('generateHint').textContent = pista;
    }

    async function generarJornada() {
        const siguiente = estado.jornadaActual + 1;
        const texto = estado.empezada
            ? `Se formarán las parejas de la jornada ${siguiente} con la clasificación actual. Después ya no se podrán corregir los resultados de la jornada ${estado.jornadaActual}.`
            : `Se formarán las parejas de la jornada 1 con el orden de la lista de jugadores. Después ya no se podrán añadir, quitar ni reordenar jugadores.`;
        if (!await confirmar(texto, { titulo: `Generar jornada ${siguiente}`, iconoTitulo: 'calendario', textoAceptar: 'Generar' })) return;

        const data = await enviarAccion(url('generarJornada'), {}, { ok: `Jornada ${siguiente} generada`, error: 'Error al generar la jornada' });
        if (data) {
            jornadasAbiertas.set(data.jornada, true);
            await cargar();
        }
    }

    async function deshacerJornada() {
        const j = estado.jornadaActual;
        if (!await confirmar(`¿Borrar la jornada ${j}? Solo se puede si todavía no tiene resultados.`, {
            titulo: 'Deshacer jornada', iconoTitulo: 'volver', textoAceptar: 'Borrar jornada', peligro: true
        })) return;
        if (await enviarAccion(url('deshacerJornada'), {}, { ok: `Jornada ${j} borrada`, error: 'No se ha podido deshacer' })) {
            await cargar();
        }
    }

    async function resetear() {
        if (!await confirmar('¿Resetear la liga individual?\nSe borrarán todas las jornadas y resultados. Los jugadores y su orden se conservan.', {
            titulo: 'Resetear liga individual', iconoTitulo: 'reiniciar', textoAceptar: 'Resetear', peligro: true
        })) return;
        if (await enviarAccion(url('resetIndividual'), {}, { ok: 'Liga individual reseteada', error: 'Error al resetear' })) {
            editando.clear();
            jornadasAbiertas.clear();
            await cargar();
        }
    }

    async function cambiarSuperTiebreak(e) {
        const activar = e.target.checked;
        const ok = await enviarAccion(url('configurar'), { super_tiebreak: activar }, {
            ok: activar ? 'El tercer set será un súper tie-break' : 'El tercer set vuelve a ser un set normal',
            error: 'Error al cambiar la opción'
        });
        if (!ok) {
            e.target.checked = !activar;
            return;
        }
        estado.superTiebreak = activar;
        mostrarJornadas();
    }

    // ==================== CLASIFICACIÓN ====================
    const conSigno = n => (n > 0 ? `+${n}` : `${n}`);
    const difSets = e => e.sets_favor - e.sets_contra;
    const difJuegos = e => e.juegos_favor - e.juegos_contra;

    function mostrarClasificacion() {
        const container = document.getElementById('standingsContainer');
        const tabla = estado.clasificacion;

        if (tabla.length === 0) {
            container.innerHTML = '<p class="info-text">Todavía no hay jugadores inscritos.</p>';
            return;
        }

        const signo = n => `<span class="${n > 0 ? 'positivo' : n < 0 ? 'negativo' : ''}">${conSigno(n)}</span>`;
        container.innerHTML = `
            <div class="standings-wrapper"><table class="standings-table">
                <thead><tr>
                    <th>#</th><th>Jugador</th><th title="Partidos jugados">PJ</th><th title="Partidos ganados">PG</th>
                    <th title="Perdidos 2-1">PP1</th><th title="Perdidos 2-0">PP0</th>
                    <th title="Diferencia de sets">DS</th><th title="Diferencia de juegos">DJ</th><th>Pts</th>
                </tr></thead>
                <tbody>
                    ${tabla.map((j, idx) => `
                        <tr>
                            <td><span class="pos ${idx < 3 && estado.empezada ? `pos-${idx + 1}` : ''}">${idx + 1}</span></td>
                            <td><span class="con-avatar">${avatarJugador(j.id, j.nombre, 'sm')}<button class="ui-enlace" title="Ver partidos" onclick="verJugador(${Number(j.id)})">${escapeHtml(j.nombre)}</button></span></td>
                            <td>${j.pj}</td>
                            <td>${j.pg}</td>
                            <td>${j.pp1}</td>
                            <td>${j.pp0}</td>
                            <td>${signo(difSets(j))}</td>
                            <td>${signo(difJuegos(j))}</td>
                            <td class="col-pts">${j.puntos}</td>
                        </tr>`).join('')}
                </tbody>
            </table></div>
            <p class="info-text" style="margin-top: 0.5rem; font-size: 0.75rem;">
                Cada jugador suma los puntos de su pareja en cada partido (3 por victoria, 1 por derrota 2-1).
                Desempates: diferencia de sets, diferencia de juegos y sets a favor. Pulsa en un jugador para ver sus partidos.
            </p>`;
    }

    // ==================== JORNADAS ====================
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

    function partidosPorJornada() {
        const jornadas = {};
        for (const p of estado.partidos) (jornadas[p.jornada] ??= []).push(p);
        return jornadas;
    }

    function mostrarJornadas() {
        const container = document.getElementById('matchesContainer');
        if (!estado.empezada) {
            container.innerHTML = `<p class="info-text">${isAdmin
                ? 'La liga todavía no ha empezado: añade a los jugadores (múltiplo de 4), ordénalos y pulsa «Empezar liga».'
                : 'La liga todavía no ha empezado.'}</p>`;
            return;
        }

        let html = estado.superTiebreak
            ? `<div class="aviso-liga">${icono('pelota')}<span>El tercer set se juega como <strong>súper tie-break</strong> (a 10 puntos, diferencia de 2).</span></div>`
            : '';

        const jornadas = partidosPorJornada();
        // La jornada en juego primero; las anteriores debajo
        for (const jornada of Object.keys(jornadas).map(Number).sort((a, b) => b - a)) {
            const partidos = jornadas[jornada];
            const jugados = partidos.filter(p => p.completado).length;
            const abierta = jornadasAbiertas.has(jornada)
                ? jornadasAbiertas.get(jornada)
                : jornada === estado.jornadaActual;
            html += `
                <div class="jornada ${abierta ? '' : 'collapsed'}" data-jornada="${jornada}">
                    <div class="jornada-header" onclick="toggleJornada(this)" role="button" tabindex="0" aria-expanded="${abierta}"
                         onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleJornada(this); }">
                        <span class="jornada-titulo">
                            ${icono('calendario')} Jornada ${jornada}
                            <span class="jornada-progreso">${jugados}/${partidos.length} jugados</span>
                        </span>
                        <span class="jornada-acciones">
                            <button class="btn-ico" title="Compartir jornada" aria-label="Compartir la jornada ${jornada}"
                                    onclick="event.stopPropagation(); compartirJornada(${jornada})">${icono('compartir')}</button>
                            <span class="desplegar">${icono('desplegar')}</span>
                        </span>
                    </div>
                    <div class="jornada-partidos">
                        ${partidos.map(p => mostrarPartido(p)).join('')}
                    </div>
                </div>`;
        }
        container.innerHTML = html;
        pintarZonasComentarios();
    }

    function nombrePareja(id1, nombre1, id2, nombre2) {
        return `<span class="con-avatar"><span class="avatares">${avatarJugador(id1, nombre1, 'xs')}${avatarJugador(id2, nombre2, 'xs')}</span><span class="pareja">`
            + `<button class="ui-enlace" onclick="verJugador(${Number(id1)})">${escapeHtml(nombre1)}</button>`
            + `<span class="separador">/</span>`
            + `<button class="ui-enlace" onclick="verJugador(${Number(id2)})">${escapeHtml(nombre2)}</button>`
            + `</span></span>`;
    }

    function filaMarcador(p, lado, sets) {
        const esLocal = lado === 'local';
        const otro = esLocal ? 'visitante' : 'local';
        const ganador = !!p.completado && (esLocal ? sets.local > sets.visitante : sets.visitante > sets.local);
        const pareja = esLocal
            ? nombrePareja(p.local1_id, p.local1, p.local2_id, p.local2)
            : nombrePareja(p.visitante1_id, p.visitante1, p.visitante2_id, p.visitante2);

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
                ${pareja}
                <span class="juegos">${juegos.join('')}</span>
                <span class="puntos">${puntos === null ? '' : `${puntos} pt${puntos === 1 ? '' : 's'}`}</span>
            </div>`;
    }

    function mostrarPartido(p) {
        const sets = setsGanados(p);
        const grupo = `<span class="grupo">Grupo ${p.orden * 4 + 1}º-${p.orden * 4 + 4}º</span>`;
        const marcador = `<div class="marcador">${filaMarcador(p, 'local', sets)}${filaMarcador(p, 'visitante', sets)}</div>`;
        const editable = isAdmin && p.jornada === estado.jornadaActual;

        if (editable && editando.has(p.id)) {
            return `<div class="partido en-edicion">${grupo}${marcador}${formularioResultado(p)}</div>`;
        }

        let pie = p.completado
            ? `<span class="estado">${icono('check-circulo')} Jugado</span>`
            : `<span class="estado">${icono('reloj')} Pendiente</span>`;
        if (editable) {
            pie += p.completado
                ? `<span class="acciones">
                       <button class="btn btn-secondary btn-sm" onclick="editarResultado(${Number(p.id)})">${icono('editar')}Corregir</button>
                       <button class="btn btn-danger btn-sm" onclick="anularResultado(${Number(p.id)})">${icono('papelera')}Anular</button>
                   </span>`
                : `<span class="acciones">
                       <button class="btn btn-primary btn-sm" onclick="editarResultado(${Number(p.id)})">${icono('mas')}Resultado</button>
                   </span>`;
        }

        return `
            <div class="partido ${p.completado ? 'jugado' : 'pendiente'}">
                ${grupo}
                ${marcador}
                <div class="partido-pie">${pie}</div>
                ${zonaComentarios(p.id)}
            </div>`;
    }

    function formularioResultado(p) {
        const valor = v => (p.completado && v !== null && v !== undefined) ? `value="${Number(v)}"` : '';
        const local = `${p.local1} / ${p.local2}`;
        const visitante = `${p.visitante1} / ${p.visitante2}`;
        const setInput = n => {
            const esStb = n === 3 && estado.superTiebreak;
            const etiqueta = esStb ? 'Súper tie-break (si 1-1)' : n === 3 ? 'Set 3 (si 1-1)' : `Set ${n}`;
            const max = esStb ? 30 : 7;
            const marca = n === 3 ? '' : '0';
            return `
            <div class="set-card">
                <label for="set${n}_local_${p.id}">${etiqueta}</label>
                <div class="set-inputs">
                    <input type="number" inputmode="numeric" id="set${n}_local_${p.id}" placeholder="${marca}" min="0" max="${max}" step="1"
                           aria-label="${etiqueta}: ${escapeHtml(local)}" ${valor(p[`set${n}_local`])}>
                    <span>-</span>
                    <input type="number" inputmode="numeric" id="set${n}_visit_${p.id}" placeholder="${marca}" min="0" max="${max}" step="1"
                           aria-label="${etiqueta}: ${escapeHtml(visitante)}" ${valor(p[`set${n}_visitante`])}>
                </div>
            </div>`;
        };
        return `
            <p class="info-text" style="margin: 0.25rem 0 0;">
                Juegos de <strong>${escapeHtml(local)}</strong> – <strong>${escapeHtml(visitante)}</strong>
            </p>
            <div class="sets-container">${setInput(1)}${setInput(2)}${setInput(3)}</div>
            <div class="action-buttons">
                <button class="btn btn-secondary btn-sm" onclick="cancelarEdicion(${Number(p.id)})">Cancelar</button>
                <button class="btn btn-success btn-sm" onclick="guardarResultado(${Number(p.id)})">
                    ${icono('check')}${p.completado ? 'Guardar corrección' : 'Guardar resultado'}
                </button>
            </div>`;
    }

    function editarResultado(id) {
        editando.add(id);
        mostrarJornadas();
        document.getElementById(`set1_local_${id}`)?.focus();
    }

    function cancelarEdicion(id) {
        editando.delete(id);
        mostrarJornadas();
    }

    async function guardarResultado(id) {
        const p = estado.partidos.find(x => x.id === id);
        if (!p) return;
        const sets = [1, 2, 3].map(n => [leerNumero(`set${n}_local_${id}`), leerNumero(`set${n}_visit_${id}`)]);
        const validacion = validarResultado(sets, { superTiebreak: estado.superTiebreak });
        if (validacion.error) {
            notificar(validacion.error, 'error');
            return;
        }
        const ok = await enviarAccion(url('guardarResultado'), {
            id,
            set1_local: sets[0][0], set1_visitante: sets[0][1],
            set2_local: sets[1][0], set2_visitante: sets[1][1],
            set3_local: sets[2][0], set3_visitante: sets[2][1]
        }, {
            ok: `${p.completado ? 'Resultado corregido' : 'Resultado guardado'}: ${p.local1}/${p.local2} ${validacion.setsLocal}-${validacion.setsVisitante} ${p.visitante1}/${p.visitante2}`,
            error: 'Error al guardar'
        });
        if (ok) {
            editando.delete(id);
            await cargar();
        }
    }

    async function anularResultado(id) {
        const p = estado.partidos.find(x => x.id === id);
        if (!p) return;
        if (!await confirmar(`¿Anular el resultado de ${p.local1}/${p.local2} contra ${p.visitante1}/${p.visitante2}?\nEl partido volverá a quedar pendiente.`, {
            titulo: 'Anular resultado', textoAceptar: 'Anular', iconoAceptar: 'papelera', peligro: true
        })) return;
        if (await enviarAccion(url('anularResultado'), { id }, { ok: 'Resultado anulado', error: 'Error al anular' })) {
            editando.delete(id);
            await cargar();
        }
    }

    // ==================== FOTOS ====================
    // Avatar de un jugador: su foto o sus iniciales de color
    function avatarJugador(id, nombre, tam) {
        const jugador = estado?.jugadores.find(j => j.id === id);
        return avatar(nombre, { tipo: 'jugador', id, fotoV: jugador?.foto_v, tam });
    }

    async function fotoJugador(id) {
        const jugador = estado.jugadores.find(j => j.id === id);
        if (!isAdmin || !jugador) return;
        if (await gestionarFoto({ tipo: 'jugador', id, nombre: jugador.nombre, fotoV: jugador.foto_v })) {
            await cargar();
        }
    }

    // ==================== FICHA DE JUGADOR ====================
    function partidosDeJugador(id) {
        return estado.partidos
            .filter(p => [p.local1_id, p.local2_id, p.visitante1_id, p.visitante2_id].includes(id))
            .map(p => {
                const esLocal = p.local1_id === id || p.local2_id === id;
                const companero = esLocal
                    ? (p.local1_id === id ? p.local2 : p.local1)
                    : (p.visitante1_id === id ? p.visitante2 : p.visitante1);
                const rivales = esLocal ? `${p.visitante1} / ${p.visitante2}` : `${p.local1} / ${p.local2}`;
                const sets = setsGanados(p);
                const puntos = esLocal ? p.puntos_local : p.puntos_visitante;
                return {
                    jornada: p.jornada,
                    companero,
                    rivales,
                    jugado: !!p.completado,
                    puntos,
                    marcador: esLocal ? `${sets.local}-${sets.visitante}` : `${sets.visitante}-${sets.local}`,
                    sets: textoSets(p, !esLocal),
                    icono: puntos === 3 ? '✅' : puntos === 1 ? '🟡' : '❌',
                    chip: puntos === 3
                        ? '<span class="racha racha-v" title="Victoria">V</span>'
                        : `<span class="racha ${puntos === 1 ? 'racha-d1' : 'racha-d0'}" title="Derrota ${puntos === 1 ? '2-1' : '2-0'}">D</span>`
                };
            })
            .sort((a, b) => a.jornada - b.jornada);
    }

    function verJugador(id) {
        const j = estado.clasificacion.find(c => c.id === id);
        if (!j) return;
        const partidos = partidosDeJugador(id);
        const jugados = partidos.filter(p => p.jugado);
        const pendientes = partidos.filter(p => !p.jugado);
        const racha = jugados.slice(-5);

        const stat = (valor, etiqueta) => `<div class="pareja-stat"><strong>${valor}</strong><span>${etiqueta}</span></div>`;
        const fila = (p, derecha) => `
            <div class="pareja-partido">
                <div>
                    <div>con <strong>${escapeHtml(p.companero)}</strong> contra ${escapeHtml(p.rivales)}</div>
                    <div class="detalle">Jornada ${Number(p.jornada)}</div>
                </div>
                <div style="text-align: right; white-space: nowrap;">${derecha}</div>
            </div>`;

        abrirVentana({
            titulo: 'Ficha del jugador',
            iconoTitulo: 'pareja',
            ancho: 580,
            html: `
                <div class="ficha-cabecera">
                    ${avatarJugador(j.id, j.nombre, 'lg')}
                    <div><strong>${escapeHtml(j.nombre)}</strong><span class="sub">${j.posicion}º · ${j.puntos} puntos</span></div>
                </div>
                <div class="pareja-stats">
                    ${stat(`${j.posicion}º`, 'Posición')}
                    ${stat(j.puntos, 'Puntos')}
                    ${stat(j.pj, 'Jugados')}
                    ${stat(j.pg, 'Ganados')}
                    ${stat(j.pp1, 'Perd. 2-1')}
                    ${stat(j.pp0, 'Perd. 2-0')}
                    ${stat(conSigno(difSets(j)), 'Dif. sets')}
                    ${stat(conSigno(difJuegos(j)), 'Dif. juegos')}
                </div>
                ${racha.length ? `
                    <div class="pareja-racha"><span style="color: #94a3b8;">Últimos partidos:</span>${racha.map(p => p.chip).join('')}</div>` : ''}
                <div class="pareja-seccion">Jugados (${jugados.length})</div>
                ${jugados.length
                    ? jugados.map(p => fila(p, `${p.chip} <strong>${p.marcador}</strong> <span class="detalle">(${escapeHtml(p.sets)})</span><div class="detalle">+${p.puntos} pts</div>`)).join('')
                    : '<p class="info-text">Todavía no ha jugado ningún partido</p>'}
                ${pendientes.length ? `
                    <div class="pareja-seccion">Pendiente</div>
                    ${pendientes.map(p => fila(p, `<span class="detalle" style="display: inline-flex; align-items: center; gap: 0.3rem;">${icono('reloj')} Pendiente</span>`)).join('')}` : ''}
            `,
            botones: [
                { texto: 'Compartir', icono: 'compartir', alPulsar: () => { compartirJugador(j, jugados, pendientes); } },
                { texto: 'Cerrar', clase: 'btn-primary', valor: null }
            ]
        });
    }

    // ==================== COMPARTIR (WhatsApp) ====================
    const enlace = () => `👉 ${location.origin}/individual`;

    function compartirClasificacion() {
        if (!estado || estado.clasificacion.length === 0) {
            notificar('Todavía no hay jugadores', 'info');
            return;
        }
        const medallas = ['🥇', '🥈', '🥉'];
        const lineas = [`🏆 *Liga individual · Clasificación*`];
        if (estado.empezada) {
            const enJuego = estado.partidos.some(p => p.jornada === estado.jornadaActual && !p.completado);
            lineas.push(`Jornada ${estado.jornadaActual} de ${estado.totalJornadas}${enJuego ? ' (en juego)' : ''}`);
        }
        lineas.push('');
        estado.clasificacion.forEach((j, i) => {
            lineas.push(`${(estado.empezada && medallas[i]) || `${i + 1}.`} ${j.nombre} — *${j.puntos} pts* (${j.pj} PJ, ${j.pg} G)`);
        });
        lineas.push('', enlace());
        compartirTexto('Compartir clasificación', lineas.join('\n'));
    }

    function compartirJornada(jornada) {
        const partidos = partidosPorJornada()[jornada] || [];
        const lineas = [`📅 *Liga individual · Jornada ${jornada}*`, ''];
        for (const p of partidos) {
            const local = `${p.local1} / ${p.local2}`;
            const visitante = `${p.visitante1} / ${p.visitante2}`;
            if (p.completado) {
                const s = setsGanados(p);
                lineas.push(`✅ ${s.local > s.visitante ? `*${local}*` : local} ${s.local}-${s.visitante} ${s.visitante > s.local ? `*${visitante}*` : visitante} (${textoSets(p)})`);
            } else {
                lineas.push(`⏳ ${local} vs ${visitante}`);
            }
        }
        lineas.push('', enlace());
        compartirTexto(`Compartir jornada ${jornada}`, lineas.join('\n'));
    }

    function compartirJugador(j, jugados, pendientes) {
        const lineas = [`🎾 *${j.nombre}* · Liga individual`, `${j.posicion}º con ${j.puntos} pts (${j.pj} PJ, ${j.pg} G)`, ''];
        for (const p of jugados) lineas.push(`${p.icono} J${p.jornada} con ${p.companero} vs ${p.rivales}: ${p.marcador} (${p.sets})`);
        for (const p of pendientes) lineas.push(`⏳ J${p.jornada} con ${p.companero} vs ${p.rivales}`);
        lineas.push('', enlace());
        compartirTexto(`Compartir ${j.nombre}`, lineas.join('\n'));
    }

    // ==================== UTILIDADES ====================
    window.toggleJornada = function(element) {
        const jornada = element.parentElement;
        const abierta = jornada.classList.toggle('collapsed') === false;
        element.setAttribute('aria-expanded', String(abierta));
        jornadasAbiertas.set(Number(jornada.dataset.jornada), abierta);
    };

    window.moverJugador = moverJugador;
    window.renombrarJugador = renombrarJugador;
    window.eliminarJugador = eliminarJugador;
    window.editarResultado = editarResultado;
    window.cancelarEdicion = cancelarEdicion;
    window.guardarResultado = guardarResultado;
    window.anularResultado = anularResultado;
    window.verJugador = verJugador;
    window.fotoJugador = fotoJugador;
    window.compartirJornada = compartirJornada;

    init();
