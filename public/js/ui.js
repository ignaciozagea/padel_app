// ==================== COMPONENTES DE INTERFAZ COMPARTIDOS ====================
// Avisos, ventanas de confirmación/texto, indicador de carga y ventana de compartir.
// Requiere js/api.js (escapeHtml) cargado antes.

// ---------- Iconos (img/iconos.svg) ----------
// Devuelve el HTML de un icono del juego de iconos de la app, p. ej. icono('trofeo')
function icono(nombre, clase = '') {
    return `<svg class="ico ${clase}" aria-hidden="true"><use href="/img/iconos.svg#${nombre}"></use></svg>`;
}

// Quita un emoji (o símbolo) del principio de un texto: los avisos y títulos llevan su propio icono
function sinEmojiInicial(texto) {
    return String(texto).replace(/^(?:[\p{Extended_Pictographic}✀-➿←-⇿⬀-⯿]️?\s*)+/u, '');
}

// Botón con icono y texto para las ventanas: { icono: 'copiar', texto: 'Copiar' }
function contenidoBoton(b) {
    return (b.icono ? icono(b.icono) : '') + `<span>${escapeHtml(sinEmojiInicial(b.texto))}</span>`;
}

// ---------- Avisos (sustituyen a alert) ----------
function contenedorAvisos() {
    let c = document.getElementById('ui-avisos');
    if (!c) {
        c = document.createElement('div');
        c.id = 'ui-avisos';
        c.className = 'ui-avisos';
        c.setAttribute('aria-live', 'polite');
        document.body.appendChild(c);
    }
    return c;
}

// tipo: 'ok' | 'error' | 'info'
function notificar(mensaje, tipo = 'ok') {
    const aviso = document.createElement('div');
    aviso.className = `ui-aviso ui-aviso-${tipo}`;
    aviso.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    const iconoTipo = { ok: 'check-circulo', error: 'alerta', info: 'info' }[tipo] || 'info';
    aviso.innerHTML = `${icono(iconoTipo, 'ui-aviso-ico')}<span class="ui-aviso-texto"></span>`;
    aviso.querySelector('.ui-aviso-texto').textContent = sinEmojiInicial(mensaje);
    aviso.title = 'Cerrar';

    const quitar = () => {
        aviso.classList.add('ui-saliendo');
        setTimeout(() => aviso.remove(), 250);
    };
    aviso.addEventListener('click', quitar);
    const contenedor = contenedorAvisos();
    contenedor.appendChild(aviso);
    // Como mucho 3 avisos a la vez: si se encadenan acciones, los más antiguos se van
    const visibles = [...contenedor.querySelectorAll('.ui-aviso:not(.ui-saliendo)')];
    visibles.slice(0, Math.max(0, visibles.length - 3)).forEach(viejo => {
        viejo.classList.add('ui-saliendo');
        setTimeout(() => viejo.remove(), 250);
    });
    setTimeout(quitar, tipo === 'error' ? 7000 : 4500);
}

// ---------- Ventana modal genérica ----------
// botones: [{ texto, icono, clase, valor, alPulsar(ventana) }]; valor puede ser una función (ventana) => valor.
// iconoTitulo: icono junto al título. Si alPulsar devuelve false, la ventana no se cierra.
// Escape o clic fuera -> null.
function abrirVentana({ titulo, iconoTitulo, html = '', botones = [{ texto: 'Cerrar', valor: null }], ancho = 480, alAbrir } = {}) {
    return new Promise(resolve => {
        const fondo = document.createElement('div');
        fondo.className = 'ui-fondo';
        const ventana = document.createElement('div');
        ventana.className = 'ui-ventana';
        ventana.setAttribute('role', 'dialog');
        ventana.setAttribute('aria-modal', 'true');
        ventana.style.maxWidth = `${ancho}px`;
        ventana.innerHTML = `
            <div class="ui-ventana-cabecera">
                <h3 class="ui-titulo">${iconoTitulo ? icono(iconoTitulo) : ''}<span></span></h3>
                <button class="ui-cerrar" aria-label="Cerrar">${icono('cerrar')}</button>
            </div>
            <div class="ui-cuerpo">${html}</div>
            <div class="ui-botones"></div>
        `;
        ventana.querySelector('.ui-titulo span').textContent = sinEmojiInicial(titulo);
        fondo.appendChild(ventana);

        const focoAnterior = document.activeElement;
        const cerrar = valor => {
            document.removeEventListener('keydown', alPulsarTecla);
            fondo.remove();
            focoAnterior?.focus?.();
            resolve(valor);
        };
        const alPulsarTecla = e => { if (e.key === 'Escape') cerrar(null); };

        const botonera = ventana.querySelector('.ui-botones');
        for (const b of botones) {
            const btn = document.createElement('button');
            btn.className = `btn ${b.clase || 'btn-secondary'}`;
            btn.innerHTML = contenidoBoton(b);
            btn.addEventListener('click', async () => {
                if (b.alPulsar && (await b.alPulsar(ventana)) === false) return;
                cerrar(typeof b.valor === 'function' ? b.valor(ventana) : b.valor);
            });
            botonera.appendChild(btn);
        }
        ventana.querySelector('.ui-cerrar').addEventListener('click', () => cerrar(null));
        fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(null); });
        document.addEventListener('keydown', alPulsarTecla);

        document.body.appendChild(fondo);
        alAbrir?.(ventana);
        (ventana.querySelector('input') || botonera.lastElementChild || ventana).focus();
    });
}

// Sustituye a confirm(): devuelve true/false
async function confirmar(mensaje, { titulo = 'Confirmar', iconoTitulo, textoAceptar = 'Aceptar', iconoAceptar, peligro = false } = {}) {
    const r = await abrirVentana({
        titulo,
        iconoTitulo: iconoTitulo || (peligro ? 'alerta' : 'info'),
        html: `<p class="ui-mensaje">${escapeHtml(mensaje)}</p>`,
        botones: [
            { texto: 'Cancelar', valor: false },
            { texto: textoAceptar, icono: iconoAceptar, clase: peligro ? 'btn-danger' : 'btn-primary', valor: true }
        ]
    });
    return r === true;
}

// Sustituye a prompt(): devuelve el texto (sin espacios sobrantes) o null si se cancela
async function pedirTexto(mensaje, valorInicial = '', { titulo = 'Introduce un valor', iconoTitulo = 'editar', textoAceptar = 'Guardar' } = {}) {
    const r = await abrirVentana({
        titulo,
        iconoTitulo,
        html: `
            <label class="ui-mensaje" for="ui-campo-texto">${escapeHtml(mensaje)}</label>
            <input id="ui-campo-texto" class="ui-input" type="text" maxlength="60" autocomplete="off">
        `,
        botones: [
            { texto: 'Cancelar', valor: null },
            { texto: textoAceptar, clase: 'btn-primary', valor: v => v.querySelector('input').value.trim() }
        ],
        alAbrir: v => {
            const input = v.querySelector('input');
            input.value = valorInicial;
            input.select();
            input.addEventListener('keydown', e => {
                if (e.key !== 'Enter') return;
                // Sin preventDefault, el mismo Enter "pulsaría" el botón que recupera el foco al cerrar
                // (p. ej. ✎) y volvería a abrir la ventana
                e.preventDefault();
                v.querySelector('.ui-botones .btn-primary').click();
            });
        }
    });
    return r === null ? null : r;
}

// ---------- Indicador de carga ----------
// Barra fina arriba mientras hay peticiones en curso. Al guardar cambios (bloquear = true) los botones
// quedan desactivados hasta que terminan también las recargas que provoca el guardado, para que no se
// pueda pulsar nada con la pantalla aún sin actualizar (ni enviar dos veces).
let peticionesEnCurso = 0;
let peticionesBloqueantes = 0;
let bloqueoHastaInactividad = false;
let esperandoInactividad = [];

function pintarCarga() {
    let barra = document.getElementById('ui-barra-carga');
    if (!barra) {
        barra = document.createElement('div');
        barra.id = 'ui-barra-carga';
        barra.className = 'ui-barra-carga';
        document.body.appendChild(barra);
    }
    barra.classList.toggle('activa', peticionesEnCurso > 0);
    document.body.classList.toggle('ui-ocupado', peticionesBloqueantes > 0 || bloqueoHastaInactividad);
    document.body.setAttribute('aria-busy', peticionesEnCurso > 0 ? 'true' : 'false');
}

function indicarCarga(delta, bloquear = false) {
    peticionesEnCurso = Math.max(0, peticionesEnCurso + delta);
    if (bloquear) {
        peticionesBloqueantes = Math.max(0, peticionesBloqueantes + delta);
        if (delta < 0 && peticionesBloqueantes === 0) bloqueoHastaInactividad = true;
    }
    pintarCarga();
    if (peticionesEnCurso === 0) setTimeout(comprobarInactividad, 0);
}

// Se ejecuta en una tarea posterior: si el código que esperaba la respuesta ha lanzado otra
// petición (p. ej. recargar la lista), todavía no se considera terminado
function comprobarInactividad() {
    if (peticionesEnCurso > 0) return;
    bloqueoHastaInactividad = false;
    pintarCarga();
    const pendientes = esperandoInactividad;
    esperandoInactividad = [];
    pendientes.forEach(resolver => resolver());
}

// Promesa que se cumple cuando no queda ninguna petición en curso (incluidas las recargas)
function cuandoTermineLaCarga() {
    return new Promise(resolver => {
        esperandoInactividad.push(resolver);
        if (peticionesEnCurso === 0) setTimeout(comprobarInactividad, 0);
    });
}

// ---------- Compartir (WhatsApp, copiar, menú del sistema) ----------
async function copiarAlPortapapeles(texto) {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    } catch {
        // Navegadores sin API de portapapeles o sin permiso
        const area = document.createElement('textarea');
        area.value = texto;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
    }
}

function compartirTexto(titulo, texto) {
    const botones = [
        {
            texto: 'Copiar', icono: 'copiar',
            alPulsar: async () => {
                if (await copiarAlPortapapeles(texto)) notificar('Copiado al portapapeles');
                else notificar('No se ha podido copiar el texto', 'error');
            }
        },
        {
            texto: 'WhatsApp', icono: 'mensaje',
            clase: 'btn-success',
            alPulsar: () => { window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener'); }
        }
    ];
    if (navigator.share) {
        botones.push({
            texto: 'Más opciones', icono: 'mas-opciones',
            clase: 'btn-primary',
            alPulsar: async () => {
                try { await navigator.share({ title: titulo, text: texto }); } catch { return false; }
            }
        });
    }
    return abrirVentana({
        titulo,
        iconoTitulo: 'compartir',
        html: `<pre class="ui-texto-compartir">${escapeHtml(texto)}</pre>`,
        botones,
        ancho: 520
    });
}

// ---------- App instalable (PWA) ----------
// El service worker permite instalar la web en el móvil y abrirla sin conexión (ver /sw.js)
if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker no registrado:', e));
    });
}
