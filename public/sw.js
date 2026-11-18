// =====================================================
// SERVICE WORKER - Pádel GO
// =====================================================
// Estrategia "primero la red": siempre se usa la versión más reciente de la web y de los datos;
// la copia guardada solo se usa sin conexión. Así nunca se mezcla HTML nuevo con JS antiguo
// tras un despliegue. Las peticiones POST (guardar cambios) no pasan por la caché.

const VERSION = 'padel-go-v3';

// Lo mínimo para que la app abra sin conexión
const PRECARGA = [
    '/',
    '/liga',
    '/torneo',
    '/individual',
    '/css/base.css',
    '/css/index.css',
    '/css/liga.css',
    '/css/torneo.css',
    '/css/comun.css',
    '/js/api.js',
    '/js/ui.js',
    '/js/index.js',
    '/js/liga.js',
    '/js/torneo.js',
    '/js/individual.js',
    '/css/individual.css',
    '/manifest.webmanifest',
    '/img/iconos.svg',
    '/img/icons/icon-192.png',
    '/img/icons/favicon-32.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(VERSION)
            .then(cache => cache.addAll(PRECARGA))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(claves => Promise.all(claves.filter(c => c !== VERSION).map(c => caches.delete(c))))
            .then(() => self.clients.claim())
    );
});

// Se puede guardar: respuesta correcta, del mismo origen y sin redirección
function cacheable(respuesta) {
    return respuesta && respuesta.ok && respuesta.type === 'basic' && !respuesta.redirected;
}

// Busca una copia guardada. Para páginas, prueba también sin ".html" (Pages sirve /liga.html como /liga)
async function buscarEnCache(request) {
    const exacta = await caches.match(request);
    if (exacta) return exacta;
    if (request.mode === 'navigate') {
        const url = new URL(request.url);
        const sinHtml = url.pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
        return (await caches.match(sinHtml)) || caches.match('/');
    }
    return undefined;
}

// Marca las respuestas de la API servidas sin conexión para que la web lo indique
async function marcarSinConexion(respuesta) {
    const cabeceras = new Headers(respuesta.headers);
    cabeceras.set('X-Sin-Conexion', '1');
    return new Response(await respuesta.blob(), { status: respuesta.status, headers: cabeceras });
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;                     // POST: directo a la red
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;          // fuentes de Google, WhatsApp...

    event.respondWith((async () => {
        try {
            const respuesta = await fetch(request);
            if (cacheable(respuesta)) {
                const copia = respuesta.clone();
                event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copia)));
            }
            return respuesta;
        } catch (error) {
            const guardada = await buscarEnCache(request);
            if (!guardada) throw error;
            return url.pathname.startsWith('/api/') ? marcarSinConexion(guardada) : guardada;
        }
    })());
});
