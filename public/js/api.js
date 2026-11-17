// ==================== UTILIDADES COMPARTIDAS ====================
// Sesión de administrador, llamadas a la API y validación de resultados.

const AUTH_KEY = 'adminToken';

// Devuelve el token si existe y no ha caducado (formato "<expiración>.<firma>")
function getAdminToken() {
    const token = sessionStorage.getItem(AUTH_KEY);
    if (!token) return null;
    const exp = Number(token.split('.')[0]);
    if (!exp || exp < Date.now()) {
        sessionStorage.removeItem(AUTH_KEY);
        return null;
    }
    return token;
}

function esAdmin() {
    return getAdminToken() !== null;
}

function guardarSesion(token) {
    sessionStorage.setItem(AUTH_KEY, token);
}

function cerrarSesion() {
    sessionStorage.removeItem(AUTH_KEY);
    window.location.href = 'index.html';
}

let avisoSinConexionMostrado = false;

// fetch con JSON y token de administrador. Siempre devuelve un objeto { success, ... }
// autenticar: false -> no envía el token ni trata un 401 como sesión caducada (login)
async function apiFetch(url, { method = 'GET', body, autenticar = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = autenticar ? getAdminToken() : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Indicador de carga (js/ui.js); las peticiones que guardan cambios bloquean los botones.
    // La petición se da por terminada cuando ya se ha leído la respuesta (no solo al llegar).
    const conIndicador = typeof indicarCarga === 'function';
    const bloquear = method !== 'GET';
    if (conIndicador) indicarCarga(+1, bloquear);

    let response;
    let data;
    try {
        response = await fetch(url, {
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        try {
            data = await response.json();
        } catch {
            data = { success: false, error: `Respuesta no válida del servidor (${response.status})` };
        }
    } finally {
        if (conIndicador) indicarCarga(-1, bloquear);
    }

    // Sin conexión, el service worker devuelve la última copia guardada (ver /sw.js)
    if (response.headers.get('X-Sin-Conexion') && !avisoSinConexionMostrado && typeof notificar === 'function') {
        avisoSinConexionMostrado = true;
        notificar('📴 Sin conexión: se muestran los últimos datos guardados', 'info');
    }

    if (response.status === 401 && token) {
        sessionStorage.removeItem(AUTH_KEY);
        if (typeof notificar === 'function') notificar('⚠️ Tu sesión ha caducado. Vuelve a iniciar sesión.', 'error');
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);
        return { success: false, error: 'Tu sesión ha caducado', sesionCaducada: true };
    }
    return data;
}

// Envía una acción de administrador (POST) y avisa del resultado (js/ui.js).
// El aviso de éxito se muestra cuando terminan también las recargas que haga quien llama
// (p. ej. volver a pedir la lista), así coincide con lo que se ve en pantalla.
// Devuelve la respuesta si ha ido bien, o null si ha fallado.
async function enviarAccion(url, body, { ok, error = 'Error' } = {}) {
    try {
        const data = await apiFetch(url, { method: 'POST', body });
        if (data.success) {
            if (ok) {
                if (typeof cuandoTermineLaCarga === 'function') cuandoTermineLaCarga().then(() => notificar(ok));
                else notificar(ok);
            }
            return data;
        }
        if (!data.sesionCaducada) notificar(`❌ ${error}: ${data.error || 'Error desconocido'}`, 'error');
    } catch (e) {
        console.error('Error:', e);
        notificar('❌ Error de conexión con el servidor', 'error');
    }
    return null;
}

// Lee un input numérico: '' -> null
function leerNumero(id) {
    const valor = document.getElementById(id)?.value ?? '';
    return valor === '' ? null : parseInt(valor, 10);
}

// Un set de pádel termina 6-0..6-4, 7-5 o 7-6 (tie-break)
function setValido(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return (max === 6 && min <= 4) || (max === 7 && (min === 5 || min === 6));
}

// Súper tie-break: a 10 puntos con 2 de diferencia (10-0..10-8, 11-9, 12-10...)
function superTiebreakValido(a, b) {
    const max = Math.max(a, b);
    const min = Math.min(a, b);
    return (max === 10 && min <= 8) || (max > 10 && max - min === 2);
}

// Valida un resultado al mejor de 3 sets. sets = [[local, visitante], x3] (null si vacío)
// superTiebreak: el tercer set se juega como súper tie-break
// Devuelve { error } o { setsLocal, setsVisitante, haySet3 }
function validarResultado(sets, { superTiebreak = false } = {}) {
    for (let i = 0; i < 3; i++) {
        const maximo = i === 2 && superTiebreak ? 30 : 7;
        const fuera = v => v !== null && (!Number.isInteger(v) || v < 0 || v > maximo);
        if (fuera(sets[i][0]) || fuera(sets[i][1])) {
            return { error: `❌ Valor no válido en el set ${i + 1} (entre 0 y ${maximo})` };
        }
    }
    for (let i = 0; i < 2; i++) {
        if (sets[i][0] === null || sets[i][1] === null) return { error: `❌ Completa el set ${i + 1}` };
        if (sets[i][0] === sets[i][1]) return { error: `❌ El set ${i + 1} no puede quedar empatado` };
    }
    if ((sets[2][0] === null) !== (sets[2][1] === null)) {
        return { error: '❌ Completa los dos valores del set 3' };
    }
    const haySet3 = sets[2][0] !== null;
    for (let i = 0; i < (haySet3 ? 3 : 2); i++) {
        const [a, b] = sets[i];
        if (a === b) continue; // el empate se avisa más abajo
        if (i === 2 && superTiebreak) {
            if (!superTiebreakValido(a, b)) {
                return { error: `❌ El súper tie-break (${a}-${b}) no es válido: se gana a 10 puntos con 2 de diferencia (10-8, 11-9, 12-10...)` };
            }
        } else if (!setValido(a, b)) {
            return { error: `❌ El set ${i + 1} (${a}-${b}) no es válido: debe ser 6-0 a 6-4, 7-5 o 7-6` };
        }
    }

    let setsLocal = 0;
    let setsVisitante = 0;
    for (let i = 0; i < 2; i++) sets[i][0] > sets[i][1] ? setsLocal++ : setsVisitante++;

    if (setsLocal === 1) {
        if (!haySet3) return { error: '❌ Con 1-1 en sets hay que indicar el resultado del set 3' };
        if (sets[2][0] === sets[2][1]) return { error: '❌ El set 3 no puede quedar empatado' };
        sets[2][0] > sets[2][1] ? setsLocal++ : setsVisitante++;
    } else if (haySet3) {
        return { error: '❌ No se juega set 3 si un equipo ha ganado los dos primeros' };
    }
    return { setsLocal, setsVisitante, haySet3 };
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}
