// ==================== CONFIGURACIÓN ====================
    // IMPORTANTE: Cambia esta URL por la de tu hosting
    const API_URL = 'http://localhost/padel_app/api/api_liga.php';
    
    let isAdmin = false;
    let currentLiga = 'masculino_avanzado';
    let equipos = [];
    let calendario = [];
    let stats = {};

    // ==================== FUNCIÓN CERRAR SESIÓN ====================
    function cerrarSesion() {
        sessionStorage.removeItem('adminAuth');
        window.location.href = 'index.html';
    }

    // ==================== INICIALIZACIÓN ====================
    function init() {
        checkAdminAuth();
        configurarEventos();
        cargarEquipos();
        cargarCalendario();
    }

    function checkAdminAuth() {
        isAdmin = sessionStorage.getItem('adminAuth') === 'true';
        const adminPanel = document.getElementById('adminPanel');
        const adminBadge = document.getElementById('adminBadge');
        
        if (isAdmin) {
            adminPanel.style.display = 'block';
            adminBadge.style.display = 'flex';
        } else {
            adminPanel.style.display = 'none';
            adminBadge.style.display = 'none';
        }
    }

    function configurarEventos() {
        // Navegación de ligas
        document.querySelectorAll('.liga-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.liga-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentLiga = btn.dataset.liga;
                cargarEquipos();
                cargarCalendario();
            });
        });

        if (isAdmin) {
            const addBtn = document.getElementById('addTeamBtn');
            const generateBtn = document.getElementById('generateCalendarBtn');
            const resetBtn = document.getElementById('resetLigaBtn');
            const teamNameInput = document.getElementById('teamName');
            
            if (addBtn) addBtn.addEventListener('click', agregarEquipo);
            if (generateBtn) generateBtn.addEventListener('click', generarCalendario);
            if (resetBtn) resetBtn.addEventListener('click', resetearLiga);
            if (teamNameInput) {
                teamNameInput.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') agregarEquipo();
                });
            }
        }
    }

    // ==================== CARGAR EQUIPOS ====================
    async function cargarEquipos() {
        try {
            const response = await fetch(`${API_URL}?action=getEquipos&liga=${currentLiga}`);
            const data = await response.json();
            
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
            const teamsList = document.getElementById('teamsList');
            if (teamsList) {
                teamsList.innerHTML = '<p style="color: #ef4444;">❌ Error de conexión con el servidor</p>';
            }
        }
    }

    function mostrarEquipos() {
        const container = document.getElementById('teamsList');
        
        if (equipos.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8;">No hay equipos registrados</p>';
            return;
        }
        
        container.innerHTML = equipos.map(equipo => `
            <div class="team-tag">
                <span>🎾 ${escapeHtml(equipo.nombre)}</span>
                ${isAdmin ? `<button class="remove-team" onclick="eliminarEquipo(${equipo.id})">✕</button>` : ''}
            </div>
        `).join('');
    }

    async function agregarEquipo() {
        if (!isAdmin) return;
        
        const input = document.getElementById('teamName');
        const nombre = input.value.trim();
        
        if (!nombre) {
            alert('❌ Introduce el nombre de la pareja');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}?action=addEquipo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    liga: currentLiga,
                    nombre: nombre
                })
            });
            
            const data = await response.json();
            
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
            const response = await fetch(`${API_URL}?action=deleteEquipo&id=${id}&liga=${currentLiga}`);
            const data = await response.json();
            
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
        try {
            const response = await fetch(`${API_URL}?action=getCalendario&liga=${currentLiga}`);
            const data = await response.json();
            
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
        for (let jornada in calendario) {
            html += `
                <div class="jornada">
                    <div class="jornada-header" onclick="toggleJornada(this)">
                        <span>📅 Jornada ${jornada}</span>
                        <span>▼</span>
                    </div>
                    <div class="jornada-partidos">
                        ${calendario[jornada].map((partido, idx) => mostrarPartido(partido, jornada, idx)).join('')}
                    </div>
                </div>
            `;
        }
        
        container.innerHTML = html;
    }

    function mostrarPartido(partido, jornada, idx) {
        if (partido.completado) {
            let setsInfo = `${partido.set1_local}-${partido.set1_visitante}, ${partido.set2_local}-${partido.set2_visitante}`;
            if (partido.set3_local !== null && partido.set3_visitante !== null) {
                setsInfo += `, ${partido.set3_local}-${partido.set3_visitante}`;
            }
            
            return `
                <div class="partido">
                    <div class="partido-equipos">
                        <span class="equipo-nombre">${escapeHtml(partido.local)}</span>
                        <span class="vs">vs</span>
                        <span class="equipo-nombre">${escapeHtml(partido.visitante)}</span>
                    </div>
                    <div class="resultado-detalle">
                        <span>🎾 Resultado: ${setsInfo}</span>
                        <span class="resultado-badge">🏆 ${partido.puntos_local} - ${partido.puntos_visitante} pts</span>
                    </div>
                </div>
            `;
        }
        
        if (!isAdmin) {
            return `
                <div class="partido">
                    <div class="partido-equipos">
                        <span class="equipo-nombre">${escapeHtml(partido.local)}</span>
                        <span class="vs">vs</span>
                        <span class="equipo-nombre">${escapeHtml(partido.visitante)}</span>
                    </div>
                    <div class="info-text" style="text-align:center;">⏳ Partido pendiente</div>
                </div>
            `;
        }
        
        return `
            <div class="partido">
                <div class="partido-equipos">
                    <span class="equipo-nombre">${escapeHtml(partido.local)}</span>
                    <span class="vs">vs</span>
                    <span class="equipo-nombre">${escapeHtml(partido.visitante)}</span>
                </div>
                
                <div class="sets-container">
                    <div class="set-card">
                        <label>🎾 SET 1</label>
                        <div class="set-inputs">
                            <input type="number" id="set1_local_${jornada}_${idx}" placeholder="0" min="0" max="7" step="1" style="width:55px;">
                            <span>-</span>
                            <input type="number" id="set1_visit_${jornada}_${idx}" placeholder="0" min="0" max="7" step="1" style="width:55px;">
                        </div>
                    </div>
                    <div class="set-card">
                        <label>🎾 SET 2</label>
                        <div class="set-inputs">
                            <input type="number" id="set2_local_${jornada}_${idx}" placeholder="0" min="0" max="7" step="1" style="width:55px;">
                            <span>-</span>
                            <input type="number" id="set2_visit_${jornada}_${idx}" placeholder="0" min="0" max="7" step="1" style="width:55px;">
                        </div>
                    </div>
                    <div class="set-card">
                        <label>🎾 SET 3 (opcional)</label>
                        <div class="set-inputs">
                            <input type="number" id="set3_local_${jornada}_${idx}" placeholder="" min="0" max="7" step="1" style="width:55px;">
                            <span>-</span>
                            <input type="number" id="set3_visit_${jornada}_${idx}" placeholder="" min="0" max="7" step="1" style="width:55px;">
                        </div>
                    </div>
                </div>
                
                <div class="action-buttons">
                    <button class="btn btn-success btn-sm" onclick="guardarResultado(${jornada}, ${idx}, '${escapeHtml(partido.local)}', '${escapeHtml(partido.visitante)}')">
                        💾 Guardar Resultado
                    </button>
                </div>
            </div>
        `;
    }

    async function guardarResultado(jornada, idx, local, visitante) {
        const set1_local = parseInt(document.getElementById(`set1_local_${jornada}_${idx}`)?.value) || 0;
        const set1_visit = parseInt(document.getElementById(`set1_visit_${jornada}_${idx}`)?.value) || 0;
        const set2_local = parseInt(document.getElementById(`set2_local_${jornada}_${idx}`)?.value) || 0;
        const set2_visit = parseInt(document.getElementById(`set2_visit_${jornada}_${idx}`)?.value) || 0;
        const set3_local_raw = document.getElementById(`set3_local_${jornada}_${idx}`)?.value;
        const set3_visit_raw = document.getElementById(`set3_visit_${jornada}_${idx}`)?.value;
        
        const set3_local = set3_local_raw !== '' ? parseInt(set3_local_raw) : null;
        const set3_visit = set3_visit_raw !== '' ? parseInt(set3_visit_raw) : null;
        
        if (set1_local === set1_visit) {
            alert('❌ El set 1 no puede quedar empatado');
            return;
        }
        if (set2_local === set2_visit) {
            alert('❌ El set 2 no puede quedar empatado');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}?action=guardarResultado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    liga: currentLiga,
                    jornada: parseInt(jornada),
                    local: local,
                    visitante: visitante,
                    set1_local: set1_local,
                    set1_visitante: set1_visit,
                    set2_local: set2_local,
                    set2_visitante: set2_visit,
                    set3_local: set3_local,
                    set3_visitante: set3_visit
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                await cargarEquipos();
                await cargarCalendario();
                alert('✅ Resultado guardado correctamente');
            } else {
                alert('❌ Error al guardar: ' + (data.error || 'Error desconocido'));
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
        
        const n = equipos.length;
        const calendar = [];
        let teams = equipos.map(e => e.nombre);
        const isEven = n % 2 === 0;
        
        if (!isEven) teams.push(null);
        
        const totalTeams = teams.length;
        const totalJornadas = totalTeams - 1;
        const partidosPorJornada = totalTeams / 2;
        
        for (let jornada = 0; jornada < totalJornadas; jornada++) {
            const jornadaPartidos = [];
            
            for (let i = 0; i < partidosPorJornada; i++) {
                const local = teams[i];
                const visitante = teams[totalTeams - 1 - i];
                
                if (local && visitante && local !== visitante) {
                    jornadaPartidos.push({
                        local: local,
                        visitante: visitante
                    });
                }
            }
            
            calendar.push(jornadaPartidos);
            
            const last = teams.pop();
            teams.splice(1, 0, last);
        }
        
        try {
            const response = await fetch(`${API_URL}?action=generarCalendario`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    liga: currentLiga,
                    calendario: calendar
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                await cargarCalendario();
                const statusDiv = document.getElementById('calendarStatus');
                statusDiv.innerHTML = '✅ Calendario generado correctamente';
                setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
            } else {
                alert('❌ Error al generar el calendario');
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
        
        const ranking = [...equipos].sort((a, b) => b.puntos - a.puntos);
        
        let html = '<div class="standings-wrapper"><table class="standings-table">';
        html += '<thead><tr>';
        html += '<th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PP1</th><th>PP0</th><th>Pts</th>';
        html += '</tr></thead><tbody>';
        
        ranking.forEach((equipo, idx) => {
            html += `
                <tr>
                    <td>${idx + 1}${idx === 0 ? ' 🏆' : ''}${idx === 1 ? ' 🥈' : ''}${idx === 2 ? ' 🥉' : ''}</td>
                    <td><strong>${escapeHtml(equipo.nombre)}</strong></td>
                    <td>${equipo.pj || 0}</td>
                    <td>${equipo.pg || 0}</td>
                    <td>${equipo.pp1 || 0}</td>
                    <td>${equipo.pp0 || 0}</td>
                    <td><strong style="color: #38bdf8;">${equipo.puntos || 0}</strong></td>
                </tr>
            `;
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    async function resetearLiga() {
        if (!isAdmin) return;
        if (!confirm('⚠️ ¿Resetear toda la liga? Se perderán todos los datos.')) return;
        
        try {
            const response = await fetch(`${API_URL}?action=resetLiga&liga=${currentLiga}`);
            const data = await response.json();
            
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
    window.guardarResultado = guardarResultado;
    window.cerrarSesion = cerrarSesion;

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Iniciar
    init();