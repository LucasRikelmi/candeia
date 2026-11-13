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
  return (end, cep = "") => G.geocodificar({ codMunicipio: "9", enderecoCru: end, bairro: "", cepConsulta: cep }, idx, opts);
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

// Candeia (PR #3) — endereço sem número: raio de incerteza e filtro por CEP.
// 0,001 grau de latitude ~ 111 m.
const trecho = (n, passo, cep = "", lat0 = -16.7) =>
  Array.from({ length: n }, (_, i) => ({ ...ponto("rua", null, lat0 - i * passo, -49.3), c: cep }));

test("sem número em rua curta: amarelo com raio pequeno", () => {
  const r = cidade({ curta: trecho(10, 0.0002) })("Rua Curta");
  assert.equal(r.status, "amarelo", r.motivo);
  assert.ok(r.raio != null && r.raio < 200, `raio ${r.raio}`);
});

test("sem número em via extensa: laranja com o raio no motivo", () => {
  const r = cidade({ longa: trecho(30, 0.002) })("Rua Longa");
  assert.equal(r.status, "laranja", r.motivo);
  assert.ok(r.raio > G.RAIO_AMARELO_MAX, `raio ${r.raio}`);
  assert.match(r.motivo, /raio de incerteza/);
});

test("via com menos de 3 pontos não informa raio e não fica amarela", () => {
  const r = cidade({ rara: trecho(2, 0.01) })("Rua Rara");
  assert.equal(r.raio, null);
  assert.equal(r.status, "laranja", r.motivo);
  assert.equal(r.metodo, "eixo");
});

test("mesmo número em dois pontos a mais de 1 km: laranja, raio é a distância entre eles", () => {
  const g = cidade({ "8": [ponto("rua", "8", -16.70, -49.30), ponto("rua", "8", -16.71, -49.30)] });
  const r = g("Rua 8, 8");
  assert.equal(r.status, "laranja", r.motivo);
  assert.equal(r.metodo, "numero");
  assert.ok(r.raio > 1000 && r.raio < 1200, `raio ${r.raio}`);
});

test("número repetido a poucas centenas de metros: verde vira amarelo", () => {
  const g = cidade({ "8": [ponto("rua", "8", -16.700, -49.30), ponto("rua", "8", -16.703, -49.30)] });
  const r = g("Rua 8, 8");
  assert.equal(r.status, "amarelo", r.motivo);
  assert.equal(r.metodo, "numero");
});

test("resultado traz confianca da tabela de calibração", () => {
  const r = cidade({ "1": [ponto("rua", "10", -16.70, -49.30)] })("Rua 1, 10");
  assert.ok(r.confianca.ate100m > 0.9, JSON.stringify(r.confianca));
  assert.ok(r.confianca.acima1km < 0.05);
  assert.equal(G.confiancaDe("cor_inexistente", 0), null);
});

test("metodo do resultado: falha e cep", () => {
  const g = cidade({ curta: trecho(5, 0.0002, "74000001") });
  assert.equal(g("Rua Inexistente Total").metodo, "falha");
  assert.equal(g("Rua Inexistente Total", "74000001").metodo, "cep");
});

test("CEP informado restringe o eixo da rua ao trecho dele", () => {
  const g = cidade({ dupla: [...trecho(10, 0.0002, "74000001", -16.70), ...trecho(10, 0.0002, "74000002", -16.80)] });
  assert.ok(g("Rua Dupla", "74000002").coord.lat < -16.79);
  assert.ok(g("Rua Dupla", "74000001").coord.lat > -16.71);
});

test("verde devolve raio 0", () => {
  const r = cidade({ "1": [ponto("rua", "10", -16.70, -49.30)] })("Rua 1, 10");
  assert.equal(r.status, "verde");
  assert.equal(r.raio, 0);
});

// Candeia (PR #5) — DF: a quadra/conjunto/bloco está no nome do logradouro.
test("DF: conjunto abreviado + casa acha o lote como verde", () => {
  const g = cidade({
    "qnn 25 conjunto b": [ponto("edf", null, -15.8010, -48.12), ponto("edf", null, -15.8020, -48.12), ponto("edf", null, -15.8030, -48.12)]
      .map((p, i) => ({ ...p, l: String(45 + i) })),
    "qnn 25 conjunto a": [{ ...ponto("edf", null, -15.81, -48.13), l: "47" }],
  });
  const r = g("QNN 25 CJ B CASA 47");
  assert.equal(r.viaKey, "qnn 25 conjunto b");
  assert.equal(r.status, "verde", r.motivo);
  assert.equal(r.metodo, "lote");
  assert.equal(r.coord.lat, -15.8030);
});

test("DF: bloco da superquadra é preservado", () => {
  const g = cidade({
    "sqs 308": [ponto("edf", null, -15.82, -47.91)],
    "sqs 308 bloco c": [ponto("edf", null, -15.8205, -47.9105), ponto("edf", null, -15.8206, -47.9106), ponto("edf", null, -15.8207, -47.9107)],
  });
  assert.equal(g("SQS 308 BL C AP 101").viaKey, "sqs 308 bloco c");
});
