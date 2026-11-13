// Regressão do comportamento herdado do NEXO (V2.2) sobre a cidade sintética
// do playground. Estes testes travam o comportamento ATUAL: se um deles
// quebrar numa melhoria, a mudança tem que ser intencional e justificada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cidadeSintetica } from "./helpers.js";
import * as G from "../src/index.js";

const { geo } = cidadeSintetica();

const CASOS = [
  // [endereço, bairro, cep, status, viaKey]
  ["Rua Oito, Qd. 21 Lt. 4", "Setor Central", "", "verde", "8"],          // extenso → numeral + Q/L
  ["AV BRASIL, 340", "", "", "verde", "brasil"],                          // número exato
  ["Rua Sessenta e Oito, 220", "", "", "verde", "68"],                    // extenso composto
  ["QD 41 LT 3, RUA 12", "", "", "verde", "12"],                          // #15 Q/L antes da via
  ["Rua 10 esq. com Av. Goiás", "", "", "amarelo", "10"],                 // #16 cruzamento
  ["Rod. GO-070 km 4", "", "", "azul", "go 070"],                         // km como número + teto g=3
  ["Rua 80, 15", "Jardim Primavera", "74920123", "laranja", null],        // #4 guarda numérica + #17 CEP
  ["Rua das Flores, 120", "", "", "amarelo", "das flores"],               // teto g=4
];

for (const [end, bairro, cep, status, viaKey] of CASOS) {
  test(`playground: ${end}`, () => {
    const r = geo(end, bairro, cep);
    assert.equal(r.status, status, r.motivo);
    assert.equal(r.viaKey, viaKey);
    assert.ok(r.coord && Number.isFinite(r.coord.lat) && Number.isFinite(r.coord.lon));
  });
}

test("rua 80 não casa com rua 8 (#4)", () => {
  const r = geo("Rua 80, 15");
  assert.notEqual(r.viaKey, "8");
});

test("km da rodovia vira número de porta", () => {
  const r = geo("Rod. GO-070 km 4");
  assert.equal(r.numero, "4");
  assert.equal(r.km, "4");
});

test("município não indexado → vermelho", () => {
  const { idx, opts } = cidadeSintetica();
  return import("../src/index.js").then(({ geocodificar }) => {
    const r = geocodificar({ codMunicipio: "0000000", enderecoCru: "Rua 8, 10" }, idx, opts);
    assert.equal(r.status, "vermelho");
  });
});

// ---------------------------------------------------------------------------
// Limitações conhecidas (backlog). Marcadas como `todo`: rodam, mas não falham
// a suíte. Cada uma vira teste normal quando for corrigida.
// ---------------------------------------------------------------------------

test("número sem vírgula: 'Av. Brazil 340' acha o 340", () => {
  const r = geo("Av. Brazil 340");
  assert.equal(r.numero, "340");
});

test("número sem vírgula: 'Rua Goias 125' não vaza '125' no nome da via", () => {
  const r = geo("Rua Goias 125");
  assert.equal(r.via, "goias");
});

test("número inexistente deveria usar vizinhos (330 entre 320 e 340), não o eixo da rua", { todo: true }, () => {
  const r = geo("Rua Brasil, 330");
  assert.notEqual(r.status, "amarelo");
});

test("título abreviado: 'Av. Dr. Goias, 120' deveria casar exato", { todo: true }, () => {
  const r = geo("Av. Dr. Goias, 120");
  assert.equal(r.status, "verde");
});

// Candeia — melhorias medidas no benchmark ------------------------------------
const ponto = (tp, n, la, lo, b = "centro") => ({ tp, n, q: null, l: null, b, c: "", la, lo, g: 1 });
function cidade(dic) {
  const idx = { "9": dic };
  const opts = { blocking: G.construirBlockingIndex(idx), cepIndex: G.construirIndiceCep(idx), cache: new Map() };
  return (end) => G.geocodificar({ codMunicipio: "9", enderecoCru: end, bairro: "", cepConsulta: "" }, idx, opts);
}

test("via que termina em número continua inteira quando existe ('Avenida T 63')", () => {
  const g = cidade({ "t 63": [ponto("avenida", "100", -16.7, -49.3)], "t": [ponto("rua", "63", -16.6, -49.2)] });
  const r = g("Avenida T 63");
  assert.equal(r.viaKey, "t 63");
});

test("tipo da consulta separa 'Rua 1' de 'Avenida 1' na mesma chave", () => {
  const g = cidade({ "1": [ponto("rua", "10", -16.70, -49.30), ponto("avenida", "10", -16.80, -49.40)] });
  assert.equal(g("Avenida 1, 10").coord.lat, -16.80);
  assert.equal(g("Rua 1, 10").coord.lat, -16.70);
});
