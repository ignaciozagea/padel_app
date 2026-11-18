// ==================== COMENTARIOS EN LOS PARTIDOS ====================
// Lo usan liga.js, individual.js y torneo.js. Requiere api.js y ui.js.
//
//   iniciarComentarios('liga', id => 'Título del partido')   // una vez, al cargar la página
//   zonaComentarios(id)               // hueco dentro de cada partido (con el último comentario)
//   zonaComentarios(id, { compacta })  // solo un botón con el número (cuadro del torneo)
//   pintarZonasComentarios()          // después de pintar los partidos

const CLAVE_COMENTARISTA = 'padelgo.comentarista';   // nombre y código guardados en este dispositivo
const comentariosEstado = { tipo: null, activos: false, partidos: {}, tituloDe: null };

async function iniciarComentarios(tipo, tituloDe) {
    comentariosEstado.tipo = tipo;
    comentariosEstado.tituloDe = tituloDe;
    await cargarConteoComentarios();
}

async function cargarConteoComentarios() {
    try {
        const data = await apiFetch(`/api/comentarios?action=getConteo&tipo=${comentariosEstado.tipo}`);
        if (data.success) {
            comentariosEstado.activos = data.data.activos;
            comentariosEstado.partidos = data.data.partidos;
        }
    } catch (error) {
        console.error('Error cargando comentarios:', error);
    }
    pintarZonasComentarios();
}

// Hueco que se rellena con pintarZonasComentarios()
function zonaComentarios(partidoId, { compacta = false } = {}) {
    return `<div class="zona-comentarios ${compacta ? 'compacta' : ''}" data-partido="${Number(partidoId)}"></div>`;
}

function pintarZonasComentarios() {
    document.querySelectorAll('.zona-comentarios[data-partido]').forEach(zona => {
        const id = Number(zona.dataset.partido);
        const info = comentariosEstado.partidos[id];
        const total = info?.total || 0;

        // Desactivados y sin comentarios: no se muestra nada (salvo al administrador, que puede escribir)
        if (!comentariosEstado.activos && !total && !esAdmin()) {
            zona.innerHTML = '';
            return;
        }

        const etiqueta = `${total} comentario${total === 1 ? '' : 's'}`;
        if (zona.classList.contains('compacta')) {
            zona.innerHTML = `
                <button class="btn-comentarios" onclick="abrirComentarios(${id})" title="${etiqueta}" aria-label="${etiqueta}">
                    ${icono('mensaje')}${total ? `<span>${total}</span>` : ''}
                </button>`;
            return;
        }

        const ultimo = info
            ? `<span class="ultimo"><strong>${escapeHtml(info.ultimo_autor)}:</strong> ${escapeHtml(info.ultimo_texto)}</span>`
            : `<span class="ultimo vacio">Comentar el partido</span>`;
        zona.innerHTML = `
            <button class="btn-zona-comentarios" onclick="abrirComentarios(${id})" aria-label="${etiqueta}. Ver y escribir comentarios">
                ${icono('mensaje')}${total ? `<span class="total">${total}</span>` : ''}${ultimo}
            </button>`;
    });
}

// ---------- Ventana con la conversación de un partido ----------
function haceCuanto(ms) {
    const segundos = Math.round((Date.now() - ms) / 1000);
    if (segundos < 60) return 'ahora';
    const min = Math.round(segundos / 60);
    if (min < 60) return `hace ${min} min`;
    const horas = Math.round(min / 60);
    if (horas < 24) return `hace ${horas} h`;
    return new Date(ms).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function leerComentarista() {
    try {
        return JSON.parse(localStorage.getItem(CLAVE_COMENTARISTA)) || {};
    } catch {
        return {};
    }
}

function guardarComentarista(datos) {
    localStorage.setItem(CLAVE_COMENTARISTA, JSON.stringify({ ...leerComentarista(), ...datos }));
}

async function abrirComentarios(partidoId) {
    const titulo = comentariosEstado.tituloDe?.(partidoId) || 'Comentarios';
    await abrirVentana({
        titulo,
        iconoTitulo: 'mensaje',
        ancho: 560,
        html: `
            <div class="comentarios-lista" aria-live="polite"><p class="info-text">Cargando…</p></div>
            <div class="comentarios-formulario"></div>`,
        botones: [{ texto: 'Cerrar', valor: null }],
        alAbrir: ventana => {
            pintarFormularioComentario(ventana, partidoId);
            cargarHilo(ventana, partidoId);
        }
    });
    // Al cerrar, actualizar el número y el último comentario de los partidos
    cargarConteoComentarios();
}

async function cargarHilo(ventana, partidoId) {
    const lista = ventana.querySelector('.comentarios-lista');
    try {
        const data = await apiFetch(`/api/comentarios?action=getComentarios&tipo=${comentariosEstado.tipo}&partido=${Number(partidoId)}`);
        if (!data.success) throw new Error(data.error);
        const anterior = comentariosEstado.activos;
        comentariosEstado.activos = data.data.activos;
        if (anterior !== comentariosEstado.activos) pintarFormularioComentario(ventana, partidoId);

        const comentarios = data.data.comentarios;
        lista.innerHTML = comentarios.length
            ? comentarios.map(c => `
                <div class="comentario">
                    <div class="comentario-cabecera">
                        <strong>${escapeHtml(c.autor)}</strong>
                        <span class="fecha" title="${new Date(c.creado_en).toLocaleString('es-ES')}">${haceCuanto(c.creado_en)}</span>
                        ${esAdmin() ? `<button class="btn-ico peligro" title="Borrar comentario" aria-label="Borrar comentario"
                                               data-borrar="${Number(c.id)}">${icono('papelera')}</button>` : ''}
                    </div>
                    <p class="comentario-texto"></p>
                </div>`).join('')
            : '<p class="info-text" style="margin: 0;">Todavía no hay comentarios.</p>';

        // El texto se pone como texto (no HTML): así nunca se interpreta lo que escriba nadie
        lista.querySelectorAll('.comentario-texto').forEach((p, i) => { p.textContent = comentarios[i].texto; });
        lista.querySelectorAll('[data-borrar]').forEach(boton => {
            boton.addEventListener('click', () => borrarComentario(ventana, partidoId, Number(boton.dataset.borrar)));
        });
        lista.scrollTop = lista.scrollHeight;
    } catch (error) {
        console.error('Error cargando comentarios:', error);
        lista.innerHTML = '<p class="info-text" style="color: #f87171; margin: 0;">No se han podido cargar los comentarios.</p>';
    }
}

function pintarFormularioComentario(ventana, partidoId) {
    const zona = ventana.querySelector('.comentarios-formulario');
    const admin = esAdmin();
    if (!comentariosEstado.activos && !admin) {
        zona.innerHTML = '<p class="info-text" style="margin-bottom: 0;">Los comentarios están desactivados.</p>';
        return;
    }

    const guardado = leerComentarista();
    zona.innerHTML = `
        <form class="form-comentario" novalidate>
            <div class="form-comentario-fila">
                <input class="ui-input" name="autor" placeholder="Tu nombre" maxlength="40" autocomplete="nickname" aria-label="Tu nombre">
                ${admin ? '' : `<input class="ui-input" name="codigo" type="password" placeholder="Código de jugadores" maxlength="40"
                                       autocomplete="off" aria-label="Código de jugadores">`}
            </div>
            <textarea class="ui-input" name="texto" rows="3" maxlength="500" placeholder="Escribe un comentario…" aria-label="Comentario"></textarea>
            <div class="form-comentario-pie">
                <span class="contador">0/500</span>
                <button type="submit" class="btn btn-primary btn-sm">${icono('mensaje')}Publicar</button>
            </div>
            ${admin ? '<p class="info-text" style="margin: 0;">Como administrador puedes comentar sin código.</p>' : ''}
        </form>`;

    const form = zona.querySelector('form');
    form.autor.value = guardado.autor || '';
    if (form.codigo) form.codigo.value = guardado.codigo || '';
    const contador = form.querySelector('.contador');
    form.texto.addEventListener('input', () => { contador.textContent = `${form.texto.value.length}/500`; });
    // Ctrl/Cmd + Enter publica
    form.texto.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            form.requestSubmit();
        }
    });
    form.addEventListener('submit', e => {
        e.preventDefault();
        publicarComentario(ventana, partidoId, form);
    });
    // Si ya conocemos el nombre (y el código), el cursor va directo al comentario
    if (form.autor.value && (!form.codigo || form.codigo.value)) setTimeout(() => form.texto.focus(), 0);
}

async function publicarComentario(ventana, partidoId, form) {
    const autor = form.autor.value.trim();
    const texto = form.texto.value.trim();
    const codigo = form.codigo ? form.codigo.value.trim() : undefined;
    if (!autor) { notificar('Escribe tu nombre', 'error'); form.autor.focus(); return; }
    if (form.codigo && !codigo) { notificar('Escribe el código de jugadores (está en el grupo)', 'error'); form.codigo.focus(); return; }
    if (!texto) { notificar('Escribe el comentario', 'error'); form.texto.focus(); return; }

    const boton = form.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
        const data = await apiFetch('/api/comentarios?action=comentar', {
            method: 'POST',
            body: { tipo: comentariosEstado.tipo, partido_id: partidoId, autor, texto, codigo }
        });
        if (data.success) {
            guardarComentarista(codigo === undefined ? { autor } : { autor, codigo });
            form.texto.value = '';
            form.querySelector('.contador').textContent = '0/500';
            notificar('Comentario publicado');
            await cargarHilo(ventana, partidoId);
        } else {
            if (/código/i.test(data.error || '') && form.codigo) {
                guardarComentarista({ codigo: '' });
                form.codigo.value = '';
                form.codigo.focus();
            }
            notificar(data.error || 'No se ha podido publicar', 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        notificar('Error de conexión con el servidor', 'error');
    } finally {
        boton.disabled = false;
    }
}

async function borrarComentario(ventana, partidoId, id) {
    if (!await confirmar('¿Borrar este comentario?', { titulo: 'Borrar comentario', textoAceptar: 'Borrar', iconoAceptar: 'papelera', peligro: true })) return;
    if (await enviarAccion('/api/comentarios?action=borrarComentario', { id }, { ok: 'Comentario borrado', error: 'No se ha podido borrar' })) {
        await cargarHilo(ventana, partidoId);
    }
}

window.abrirComentarios = abrirComentarios;
