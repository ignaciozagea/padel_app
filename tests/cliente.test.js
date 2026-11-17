// La validación del navegador (js/api.js) debe coincidir con la del servidor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const codigo = readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');
const ctx = vm.createContext({ sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
vm.runInContext(codigo, ctx);
const validar = sets => ctx.validarResultado(sets.concat([[null, null], [null, null]]).slice(0, 3));

test('acepta resultados válidos de pádel', () => {
    assert.deepEqual(
        { ...validar([[6, 0], [6, 4]]) },
        { setsLocal: 2, setsVisitante: 0, haySet3: false }
    );
    assert.deepEqual(
        { ...validar([[7, 6], [5, 7], [6, 7]]) },
        { setsLocal: 1, setsVisitante: 2, haySet3: true }
    );
});

test('rechaza resultados no válidos', () => {
    const casos = [
        [[6, 2], [3, 6]],             // 1-1 sin tercer set
        [[6, 2], [6, 3], [6, 1]],     // tercer set sobrante
        [[6, 6], [6, 3]],             // empate
        [[6, 5], [6, 3]],             // 6-5
        [[7, 4], [6, 3]],             // 7-4
        [[5, 3], [6, 3]],             // set sin terminar
        [[8, 6], [6, 3]],             // fuera de rango
        [[null, 6], [6, 3]],          // set incompleto
        [[6, 2], [3, 6], [6, null]]   // set 3 incompleto
    ];
    for (const sets of casos) {
        assert.ok(validar(sets).error, `debería rechazar ${JSON.stringify(sets)}`);
    }
});
