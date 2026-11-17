// ==================== CONFIGURACIÓN ====================
    const API_URL = '/api/liga';

    let isAdmin = false;
    let currentLiga = 'masculino_avanzado';
    let equipos = [];
    let calendario = {};
    const editando = new Set(); // ids de partidos jugados cuyo resultado se está corrigiendo

    // ==================== INICIALIZACIÓN ====================
    function init() {
        checkAdminAuth();
        configurarEventos();
        cargarEquipos();
        cargarCalendario();
    }

    function checkAdminAuth() {
        isAdmin = esAdmin();
        document.getElementById('adminPanel').style.display = isAdmin ? 'block' : 'none';
        document.getElementById('adminBadge').style.display = isAdmin ? 'flex' : 'none';
    }

    function configurarEventos() {
        // Navegación de ligas
        document.querySelectorAll('.liga-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.liga-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentLiga = btn.dataset.liga;
                editando.clear();
                cargarEquipos();
                cargarCalendario();
            });
        });

        if (isAdmin) {
            document.getElementById('addTeamBtn')?.addEventListener('click', agregarEquipo);
            document.getElementById('generateCalendarBtn')?.addEventListener('click', generarCalendario);
            document.getElementById('resetLigaBtn')?.addEventListener('click', resetearLiga);
            document.getElementById('teamName')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') agregarEquipo();
            });
        }
    }

    // ==================== CARGAR EQUIPOS ====================
    async function cargarEquipos() {
        const liga = currentLiga;
        try {
            const data = await apiFetch(`${API_URL}?action=getEquipos&liga=${encodeURIComponent(liga)}`);
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

        const entrada = prompt('Nuevo nombre de la pareja:', equipo.nombre);
        if (entrada === null) return;
        const nombre = entrada.trim();
        if (!nombre || nombre === equipo.nombre) return;

        try {
            const data = await apiFetch(`${API_URL}?action=renameEquipo`, {
                method: 'POST',
                body: { id, nombre }
            });
            if (data.success) {
                await cargarEquipos();
                await cargarCalendario();
            } else {
                alert('❌ Error al renombrar: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    async function agregarEquipo() {
        if (!isAdmin) return;

        const input = document.getElementById('teamName');
        const nombre = input.value.trim();

        if (!nombre) {
            alert('❌ Introduce el nombre de la pareja');
            return;
        }
        if (equipos.some(e => e.nombre.toLowerCase() === nombre.toLowerCase())) {
            alert('⚠️ Esta pareja ya está inscrita en esta liga');
            return;
        }

        try {
            const data = await apiFetch(`${API_URL}?action=addEquipo`, {
                method: 'POST',
                body: { liga: currentLiga, nombre }
            });

            if (data.success) {
                input.value = '';
                await cargarEquipos();
                alert(`✅ Equipo "${nombre}" añadido correctamente`);
            } else {
                alert('❌ Error al añadir: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión al servidor');
        }
    }

    async function eliminarEquipo(id) {
        if (!isAdmin) return;
        if (!confirm('¿Eliminar este equipo?')) return;

        try {
            const data = await apiFetch(`${API_URL}?action=deleteEquipo`, {
                method: 'POST',
                body: { id }
            });

            if (data.success) {
                await cargarEquipos();
                await cargarCalendario();
                alert('✅ Equipo eliminado');
            } else {
                alert('❌ Error al eliminar: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    // ==================== CALENDARIO ====================
    async function cargarCalendario() {
        const liga = currentLiga;
        try {
            const data = await apiFetch(`${API_URL}?action=getCalendario&liga=${encodeURIComponent(liga)}`);
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
            html += `
                <div class="jornada">
                    <div class="jornada-header" onclick="toggleJornada(this)">
                        <span>📅 Jornada ${Number(jornada)}</span>
                        <span>▼</span>
                    </div>
                    <div class="jornada-partidos">
                        ${calendario[jornada].map((partido, idx) => mostrarPartido(partido, Number(jornada), idx)).join('')}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    }

    function cabeceraPartido(partido) {
        return `
            <div class="partido-equipos">
                <span class="equipo-nombre">${escapeHtml(partido.local)}</span>
                <span class="vs">vs</span>
                <span class="equipo-nombre">${escapeHtml(partido.visitante)}</span>
            </div>
        `;
    }

    function mostrarPartido(partido, jornada, idx) {
        const enEdicion = editando.has(partido.id);

        if (partido.completado && !enEdicion) {
            let setsInfo = `${partido.set1_local}-${partido.set1_visitante}, ${partido.set2_local}-${partido.set2_visitante}`;
            if (partido.set3_local !== null && partido.set3_visitante !== null) {
                setsInfo += `, ${partido.set3_local}-${partido.set3_visitante}`;
            }

            return `
                <div class="partido">
                    ${cabeceraPartido(partido)}
                    <div class="resultado-detalle">
                        <span>🎾 Resultado: ${setsInfo}</span>
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
            alert(validacion.error);
            return;
        }

        try {
            const data = await apiFetch(`${API_URL}?action=guardarResultado`, {
                method: 'POST',
                body: {
                    liga: currentLiga,
                    id: partido.id,
                    set1_local: sets[0][0], set1_visitante: sets[0][1],
                    set2_local: sets[1][0], set2_visitante: sets[1][1],
                    set3_local: sets[2][0], set3_visitante: sets[2][1]
                }
            });

            if (data.success) {
                const eraCorreccion = editando.delete(partido.id);
                await cargarEquipos();
                await cargarCalendario();
                alert(eraCorreccion ? '✅ Resultado corregido' : '✅ Resultado guardado correctamente');
            } else {
                alert('❌ Error al guardar: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
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
        if (!confirm(`¿Anular el resultado de ${partido.local} vs ${partido.visitante}? El partido volverá a quedar pendiente.`)) return;

        try {
            const data = await apiFetch(`${API_URL}?action=anularResultado`, {
                method: 'POST',
                body: { liga: currentLiga, id: partido.id }
            });
            if (data.success) {
                editando.delete(partido.id);
                await cargarEquipos();
                await cargarCalendario();
                alert('✅ Resultado anulado');
            } else {
                alert('❌ Error al anular: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    async function generarCalendario() {
        if (!isAdmin) return;

        if (equipos.length < 2) {
            alert(`⚠️ Necesitas al menos 2 equipos. Actualmente hay ${equipos.length}.`);
            return;
        }
        if (Object.keys(calendario).length > 0 &&
            !confirm('⚠️ Ya hay un calendario. Si lo regeneras se borrarán todos los resultados y la clasificación. ¿Continuar?')) {
            return;
        }

        try {
            // El calendario (todos contra todos) se genera en el servidor
            const data = await apiFetch(`${API_URL}?action=generarCalendario`, {
                method: 'POST',
                body: { liga: currentLiga }
            });

            if (data.success) {
                editando.clear();
                await cargarEquipos();
                await cargarCalendario();
                const statusDiv = document.getElementById('calendarStatus');
                statusDiv.innerHTML = '✅ Calendario generado correctamente';
                setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
            } else {
                alert('❌ Error al generar el calendario: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    // ==================== CLASIFICACIÓN RESPONSIVE ====================
    function mostrarClasificacion() {
        const container = document.getElementById('standingsContainer');

        if (equipos.length === 0) {
            container.innerHTML = '<p class="info-text">No hay equipos registrados</p>';
            return;
        }

        // El orden (con desempates) lo calcula el servidor
        const medallas = ['🏆', '🥈', '🥉'];
        const conSigno = n => (n > 0 ? `+${n}` : `${n}`);

        let html = '<div class="standings-wrapper"><table class="standings-table">';
        html += '<thead><tr>';
        html += '<th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PP1</th><th>PP0</th>';
        html += '<th title="Diferencia de sets">DS</th><th title="Diferencia de juegos">DJ</th><th>Pts</th>';
        html += '</tr></thead><tbody>';

        equipos.forEach((equipo, idx) => {
            const ds = (equipo.sets_favor || 0) - (equipo.sets_contra || 0);
            const dj = (equipo.juegos_favor || 0) - (equipo.juegos_contra || 0);
            html += `
                <tr>
                    <td>${idx + 1}${medallas[idx] ? ' ' + medallas[idx] : ''}</td>
                    <td><strong>${escapeHtml(equipo.nombre)}</strong></td>
                    <td>${equipo.pj || 0}</td>
                    <td>${equipo.pg || 0}</td>
                    <td>${equipo.pp1 || 0}</td>
                    <td>${equipo.pp0 || 0}</td>
                    <td>${conSigno(ds)}</td>
                    <td>${conSigno(dj)}</td>
                    <td><strong style="color: #38bdf8;">${equipo.puntos || 0}</strong></td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';
        html += `<p class="info-text" style="margin-top: 0.5rem; font-size: 0.75rem;">
            Desempates: enfrentamiento directo (si empatan dos equipos), diferencia de sets, diferencia de juegos y sets a favor.
        </p>`;
        container.innerHTML = html;
    }

    async function resetearLiga() {
        if (!isAdmin) return;
        if (!confirm('⚠️ ¿Resetear el calendario y la clasificación de esta liga? Se perderán todos los resultados.')) return;

        try {
            const data = await apiFetch(`${API_URL}?action=resetLiga`, {
                method: 'POST',
                body: { liga: currentLiga }
            });

            if (data.success) {
                await cargarEquipos();
                await cargarCalendario();
                alert('✅ Liga reseteada correctamente');
            } else {
                alert('❌ Error al resetear: ' + (data.error || 'Error desconocido'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
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

    // Iniciar
    init();
