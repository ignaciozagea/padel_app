 // ==================== CONFIGURACIÓN ====================
    // IMPORTANTE: Cambia 'padel_app' por el nombre de tu carpeta
    const API_URL = 'http://localhost/padel_app/api/api_torneo.php';
    
    let isAdmin = false;
    let equiposTorneo = [];
    let torneoId = null;
    let torneo = null;
    let ganador = null;
    let matchActual = null;

    // ==================== FUNCIÓN CERRAR SESIÓN ====================
    function cerrarSesion() {
        sessionStorage.removeItem('adminAuth');
        window.location.href = 'index.html';
    }

    // ==================== INICIALIZACIÓN ====================
    function init() {
        checkAdminAuth();
        configurarEventos();
        cargarTorneo();
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
        if (isAdmin) {
            document.getElementById('addTeamBtn').addEventListener('click', agregarEquipo);
            document.getElementById('generateTournamentBtn').addEventListener('click', generarTorneo);
            document.getElementById('resetTournamentBtn').addEventListener('click', resetearTorneo);
            document.getElementById('teamName').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') agregarEquipo();
            });
            document.getElementById('confirmResultBtn').addEventListener('click', confirmarResultado);
        }
    }

    // ==================== CARGAR TORNEO DESDE BD ====================
    async function cargarTorneo() {
        try {
            const response = await fetch(`${API_URL}?action=getTorneo`);
            const data = await response.json();
            
            if (data.success && data.data) {
                equiposTorneo = data.data.equipos || [];
                torneo = data.data.partidos ? reconstruirTorneo(data.data.partidos) : null;
                ganador = data.data.torneo?.ganador || null;
                torneoId = data.data.torneo?.id || null;
                actualizarUI();
            } else {
                equiposTorneo = [];
                torneo = null;
                actualizarUI();
            }
        } catch (error) {
            console.error('Error cargando torneo:', error);
            equiposTorneo = [];
            actualizarUI();
        }
    }

    function reconstruirTorneo(partidos) {
        if (!partidos || partidos.length === 0) return null;
        
        const rounds = [];
        let currentRound = [];
        let currentRonda = 0;
        
        partidos.sort((a, b) => a.ronda - b.ronda || a.orden - b.orden);
        
        for (let p of partidos) {
            if (p.ronda !== currentRonda) {
                if (currentRound.length > 0) rounds.push(currentRound);
                currentRonda = p.ronda;
                currentRound = [];
            }
            
            currentRound.push({
                id: `r${p.ronda}_m${p.orden}`,
                team1: p.equipo1,
                team2: p.equipo2,
                winner: p.ganador,
                played: p.completado,
                resultado: p.completado ? {
                    set1: { local: p.set1_local, visitante: p.set1_visitante },
                    set2: { local: p.set2_local, visitante: p.set2_visitante },
                    set3: p.set3_local !== null ? { local: p.set3_local, visitante: p.set3_visitante } : null,
                    setsGanadosLocal: (p.set1_local > p.set1_visitante ? 1 : 0) + (p.set2_local > p.set2_visitante ? 1 : 0) + (p.set3_local && p.set3_local > p.set3_visitante ? 1 : 0),
                    setsGanadosVisitante: (p.set1_visitante > p.set1_local ? 1 : 0) + (p.set2_visitante > p.set2_local ? 1 : 0) + (p.set3_visitante && p.set3_visitante > p.set3_local ? 1 : 0)
                } : null
            });
        }
        
        if (currentRound.length > 0) rounds.push(currentRound);
        return { rounds, numRondas: rounds.length };
    }

    function actualizarUI() {
        mostrarEquipos();
        if (torneo && torneo.rounds && torneo.rounds.length > 0) {
            document.getElementById('bracketCard').style.display = 'block';
            mostrarBracket();
            if (ganador) mostrarGanador();
        } else {
            document.getElementById('bracketCard').style.display = 'none';
        }
        document.getElementById('teamCount').textContent = equiposTorneo.length;
    }

    // ==================== GESTIÓN DE EQUIPOS ====================
    async function agregarEquipo() {
        if (!isAdmin) return;
        
        const input = document.getElementById('teamName');
        const nombre = input.value.trim();
        
        if (!nombre) {
            alert('❌ Introduce el nombre de la pareja');
            return;
        }
        
        if (equiposTorneo.includes(nombre)) {
            alert('⚠️ Esta pareja ya está inscrita');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}?action=addEquipo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nombre: nombre })
            });
            
            const data = await response.json();
            
            if (data.success) {
                input.value = '';
                await cargarTorneo();
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
            const response = await fetch(`${API_URL}?action=deleteEquipo&id=${id}`);
            const data = await response.json();
            
            if (data.success) {
                await cargarTorneo();
                alert('✅ Equipo eliminado');
            } else {
                alert('❌ Error al eliminar');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    function mostrarEquipos() {
        const container = document.getElementById('teamsList');
        
        if (equiposTorneo.length === 0) {
            container.innerHTML = '<p style="color: #94a3b8;">No hay equipos inscritos</p>';
            return;
        }
        
        container.innerHTML = equiposTorneo.map((equipo, idx) => `
            <div class="team-tag">
                <span>🎾 ${escapeHtml(equipo)}</span>
                ${isAdmin ? `<button class="remove-team" onclick="eliminarEquipo(${idx})">✕</button>` : ''}
            </div>
        `).join('');
    }

    // ==================== GENERAR TORNEO ====================
    function shuffleArray(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    async function generarTorneo() {
        if (!isAdmin) return;
        if (equiposTorneo.length < 2) {
            alert('⚠️ Necesitas al menos 2 equipos');
            return;
        }
        
        const equiposMezclados = shuffleArray(equiposTorneo);
        
        try {
            const response = await fetch(`${API_URL}?action=crearTorneo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ equipos: equiposMezclados })
            });
            
            const data = await response.json();
            
            if (data.success) {
                await cargarTorneo();
                alert(`✅ Torneo generado correctamente`);
            } else {
                alert('❌ Error al generar el torneo');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    // ==================== MOSTRAR BRACKET ====================
    function mostrarBracket() {
        const container = document.getElementById('bracketContainer');
        if (!torneo || !torneo.rounds) return;
        
        let html = '';
        for (let r = 0; r < torneo.rounds.length; r++) {
            const round = torneo.rounds[r];
            const titulo = obtenerTituloRonda(r, torneo.rounds.length, round.length);
            html += `<div class="round"><div class="round-title">${titulo}</div>`;
            
            for (let m = 0; m < round.length; m++) {
                html += generarMatchHTML(r, m, round[m]);
            }
            html += `</div>`;
        }
        container.innerHTML = html;
    }

    function obtenerTituloRonda(ronda, total, numPartidos) {
        if (ronda === total - 1) return '🏆 FINAL';
        if (ronda === total - 2) return '🥉 SEMIFINAL';
        if (ronda === total - 3) return '🎯 CUARTOS DE FINAL';
        if (ronda === total - 4) return '📊 OCTAVOS DE FINAL';
        return `RONDA ${ronda + 1} (${numPartidos} partidos)`;
    }

    function generarMatchHTML(ronda, indice, match) {
        let team1Display = match.team1 || '?';
        let team2Display = match.team2 || '?';
        let resultadoDisplay = match.resultado || null;
        
        const esBye1 = team1Display === null;
        const esBye2 = team2Display === null;
        
        if (esBye1) team1Display = '🔵 DESCANSO';
        if (esBye2) team2Display = '🔵 DESCANSO';
        
        const tieneGanador = match.winner !== null && match.winner !== undefined;
        const ambosPresentes = !esBye1 && !esBye2 && team1Display !== '?' && team2Display !== '?';
        const puedeJugar = ambosPresentes && !tieneGanador && isAdmin;
        
        let html = `<div class="match">
            <div class="match-teams">
                <div class="team-slot ${match.winner === match.team1 ? 'winner' : ''}">
                    <span class="team-name">${escapeHtml(team1Display)}</span>
                    ${resultadoDisplay ? `<span class="team-score">${resultadoDisplay.setsGanadosLocal || 0} sets</span>` : ''}
                </div>
                <div class="team-slot ${match.winner === match.team2 ? 'winner' : ''}">
                    <span class="team-name">${escapeHtml(team2Display)}</span>
                    ${resultadoDisplay ? `<span class="team-score">${resultadoDisplay.setsGanadosVisitante || 0} sets</span>` : ''}
                </div>
            </div>`;
        
        if (tieneGanador && resultadoDisplay) {
            let resultadoStr = '';
            if (resultadoDisplay.set3 && resultadoDisplay.set3.local !== null) {
                resultadoStr = `${resultadoDisplay.set1.local}-${resultadoDisplay.set1.visitante}, ${resultadoDisplay.set2.local}-${resultadoDisplay.set2.visitante}, ${resultadoDisplay.set3.local}-${resultadoDisplay.set3.visitante}`;
            } else {
                resultadoStr = `${resultadoDisplay.set1.local}-${resultadoDisplay.set1.visitante}, ${resultadoDisplay.set2.local}-${resultadoDisplay.set2.visitante}`;
            }
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#10b981;">✅ ${resultadoStr}</div>`;
            html += `<div style="text-align:center; font-size:0.7rem;">🏆 Avanza: ${escapeHtml(match.winner)}</div>`;
        } else if (tieneGanador) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem;">🏆 Avanza: ${escapeHtml(match.winner)}</div>`;
        } else if (puedeJugar) {
            html += `<button class="btn-play" onclick="abrirModalResultado(${ronda}, ${indice}, '${escapeHtml(match.team1)}', '${escapeHtml(match.team2)}')">🎾 Registrar Resultado (3 sets)</button>`;
        } else if (esBye1 || esBye2) {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#f59e0b;">🔄 Avanza automáticamente por descanso</div>`;
        } else {
            html += `<div style="text-align:center; margin-top:0.5rem; font-size:0.7rem; color:#94a3b8;">⏳ Esperando rivales...</div>`;
        }
        
        html += `</div>`;
        return html;
    }

    // ==================== MODAL DE RESULTADOS ====================
    function abrirModalResultado(ronda, indice, equipo1, equipo2) {
        matchActual = { ronda, indice, equipo1, equipo2 };
        
        document.getElementById('modalTeams').innerHTML = `
            <strong>${escapeHtml(equipo1)}</strong> vs <strong>${escapeHtml(equipo2)}</strong>
        `;
        
        document.getElementById('modal_set1_local').value = 0;
        document.getElementById('modal_set1_visit').value = 0;
        document.getElementById('modal_set2_local').value = 0;
        document.getElementById('modal_set2_visit').value = 0;
        document.getElementById('modal_set3_local').value = '';
        document.getElementById('modal_set3_visit').value = '';
        
        document.getElementById('resultModal').classList.add('active');
    }

    function cerrarModal() {
        document.getElementById('resultModal').classList.remove('active');
        matchActual = null;
    }

  async function confirmarResultado() {
    if (!matchActual) return;
    
    // Obtener los valores de los sets
    const set1_local = parseInt(document.getElementById('modal_set1_local').value) || 0;
    const set1_visit = parseInt(document.getElementById('modal_set1_visit').value) || 0;
    const set2_local = parseInt(document.getElementById('modal_set2_local').value) || 0;
    const set2_visit = parseInt(document.getElementById('modal_set2_visit').value) || 0;
    const set3_local_raw = document.getElementById('modal_set3_local').value;
    const set3_visit_raw = document.getElementById('modal_set3_visit').value;
    
    let set3_local = (set3_local_raw !== '') ? parseInt(set3_local_raw) : null;
    let set3_visit = (set3_visit_raw !== '') ? parseInt(set3_visit_raw) : null;
    
    // Validaciones
    if (set1_local === set1_visit) {
        alert('❌ El set 1 no puede quedar empatado');
        return;
    }
    if (set2_local === set2_visit) {
        alert('❌ El set 2 no puede quedar empatado');
        return;
    }
    
    // Calcular sets ganados
    let setsGanadosLocal = 0;
    let setsGanadosVisitante = 0;
    
    if (set1_local > set1_visit) setsGanadosLocal++;
    else setsGanadosVisitante++;
    
    if (set2_local > set2_visit) setsGanadosLocal++;
    else setsGanadosVisitante++;
    
    let haySet3 = (set3_local !== null && set3_visit !== null && 
                   set3_local_raw !== '' && set3_visit_raw !== '');
    
    if (haySet3) {
        if (set3_local === set3_visit) {
            alert('❌ El set 3 no puede quedar empatado');
            return;
        }
        if (set3_local > set3_visit) setsGanadosLocal++;
        else setsGanadosVisitante++;
    }
    
    // Determinar ganador
    let ganadorNombre = '';
    if (setsGanadosLocal > setsGanadosVisitante) {
        ganadorNombre = matchActual.equipo1;
    } else {
        ganadorNombre = matchActual.equipo2;
    }
    
    try {
        const response = await fetch(`${API_URL}?action=guardarPartido`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                partidoId: `${matchActual.ronda}_${matchActual.indice}`,
                ganador: ganadorNombre,
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
            await cargarTorneo();
            cerrarModal();
            
            let resumen = `✅ Partido registrado correctamente!\n\n`;
            resumen += `${matchActual.equipo1} ${setsGanadosLocal} - ${setsGanadosVisitante} ${matchActual.equipo2}\n`;
            resumen += `📊 ${set1_local}-${set1_visit}, ${set2_local}-${set2_visit}`;
            if (haySet3) resumen += `, ${set3_local}-${set3_visit}`;
            resumen += `\n\n🏆 AVANZA A SIGUIENTE RONDA: ${ganadorNombre}`;
            alert(resumen);
        } else {
            alert('❌ Error al guardar: ' + (data.error || 'Error desconocido'));
        }
        } catch (error) {
        console.error('Error:', error);
        alert('❌ Error de conexión al servidor');
        }
    }

    function mostrarGanador() {
        const container = document.getElementById('winnerAnnouncement');
        if (ganador) {
            container.style.display = 'block';
            container.innerHTML = `
                <h2>🏆 CAMPEÓN DEL TORNEO 🏆</h2>
                <h1 style="font-size: 2rem; margin-top: 0.5rem;">🎉 ${escapeHtml(ganador)} 🎉</h1>
                <p style="margin-top: 0.5rem;">¡Felicidades a los campeones!</p>
            `;
        }
    }

    async function resetearTorneo() {
        if (!isAdmin) return;
        if (!confirm('⚠️ ¿Resetear todo el torneo? Se perderán todos los datos.')) return;
        
        try {
            const response = await fetch(`${API_URL}?action=resetTorneo`);
            const data = await response.json();
            
            if (data.success) {
                await cargarTorneo();
                alert('✅ Torneo reseteado correctamente');
            } else {
                alert('❌ Error al resetear');
            }
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error de conexión');
        }
    }

    // ==================== UTILIDADES ====================
    window.eliminarEquipo = eliminarEquipo;
    window.abrirModalResultado = abrirModalResultado;
    window.cerrarModal = cerrarModal;
    window.cerrarSesion = cerrarSesion;

    function escapeHtml(text) {
        if (!text) return '';
        if (typeof text !== 'string') return text;
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Iniciar
    init();