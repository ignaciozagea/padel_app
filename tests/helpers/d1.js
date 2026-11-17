// Utilidades de test: base de datos SQLite en memoria que imita a Cloudflare D1
// y un cliente para llamar a la API (functions/api/[[path]].js) sin servidor.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { onRequest } from '../../functions/api/[[path]].js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

export const MIGRACIONES = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

export function leerMigracion(nombre) {
    return readFileSync(MIGRATIONS_DIR + nombre, 'utf8');
}

export function nuevaBaseDeDatos() {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON'); // D1 aplica las claves foráneas
    return db;
}

// Aplica una migración dentro de una transacción, como hace wrangler
export function aplicarMigracion(db, nombre) {
    db.exec('BEGIN');
    try {
        db.exec(leerMigracion(nombre));
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    }
}

// Mínimo de la API de D1 que usa la app: prepare/bind/all/first/run y batch (transaccional)
export function crearD1(sqlite) {
    class Stmt {
        constructor(sql, args = []) { this.sql = sql; this.args = args; }
        bind(...args) { return new Stmt(this.sql, args); }
        _p() { return sqlite.prepare(this.sql); }
        async all() { return { results: this._p().all(...this.args) }; }
        async first() { return this._p().get(...this.args) ?? null; }
        async run() { this._p().run(...this.args); return { success: true }; }
    }
    return {
        prepare: sql => new Stmt(sql),
        async batch(stmts) {
            sqlite.exec('BEGIN');
            try {
                for (const s of stmts) s._p().run(...s.args);
                sqlite.exec('COMMIT');
            } catch (e) {
                sqlite.exec('ROLLBACK');
                throw e;
            }
        }
    };
}

export const PASSWORD = 'secreto-de-test';

// Crea una app de prueba con todas las migraciones aplicadas
export function crearApp() {
    const sqlite = nuevaBaseDeDatos();
    for (const m of MIGRACIONES) aplicarMigracion(sqlite, m);
    const env = { DB: crearD1(sqlite), ADMIN_PASSWORD: PASSWORD };
    let token = null;

    async function call(path, { method = 'GET', body, auth = true, ip = '10.0.0.1' } = {}) {
        const headers = { 'CF-Connecting-IP': ip };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (auth && token) headers.Authorization = `Bearer ${token}`;
        const request = new Request(`http://test/api/${path}`, {
            method, headers, body: body !== undefined ? JSON.stringify(body) : undefined
        });
        const res = await onRequest({ request, env });
        return { status: res.status, retryAfter: res.headers.get('Retry-After'), ...(await res.json()) };
    }

    return {
        sqlite,
        call,
        post: (path, body = {}) => call(path, { method: 'POST', body }),
        async login() {
            const r = await call('login', { method: 'POST', body: { password: PASSWORD }, ip: '10.0.0.99' });
            token = r.token;
            return r;
        },
        setToken(t) { token = t; },
        getToken() { return token; }
    };
}
