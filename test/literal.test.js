// Leitura literal do nome da via, número de porta com letra ou longo, e ponto do eixo por densidade.
// Índice montado à mão, com coordenadas fictícias.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/index.js";

const COD = "9999998";
const p = (tp, n, x, y = 0, extra = {}) => ({ tp, n, q: null, l: null, b: "centro", c: "70000000",
  la: -10 - y / 111320, lo: -50 + x / 109600, g: 1, k: 1, ...extra });
const linha = (tp, n0, x0, qtd = 4) => Array.from({ length: qtd }, (_, i) => p(tp, String(n0 + i * 10), x0 + i * 20));

const dic = {
  "l 08": linha("rua", 10, 0),                       // "RUA L 08": antes lido como lote 8
  "quadra 35": linha("rua", 10, 1000),               // "RUA QUADRA 35": antes lido como quadra 35
  "35": linha("quadra", 10, 2000),                   // tipo QUADRA, nome "35"
  "28 qd 36": linha("alameda", 10, 3000),
  "28": linha("alameda", 10, 9000),
  "km 44": linha("rodovia", 10, 4000),
  "br156": linha("rodovia", 10, 5000),
  "sitio pantano": linha("sitio", 10, 6000),
  "madeira": linha("rio", 10, 7000, 6),              // tipo RIO (fora de TIPOS_VIA), nome "madeira"
  "rio madeira": linha("rua", 500, 8000, 3),         // rua homônima, sem o número 20
  "antonio martins": [...linha("rua", 10, 10000), ...linha("1a travessa da rua", 10, 11000)],
  "cel lindolfo": linha("rua", 10, 12000),           // o CNEFE também grava o título abreviado
  "das acacias": linha("rua", 10, 13000),
};
const idx = { [COD]: dic };
const opts = { blocking: G.construirBlockingIndex(idx), cepIndex: G.construirIndiceCep(idx), cache: new Map() };
const geo = (enderecoCru, bairro = "", cepConsulta = "") =>
  G.geocodificar({ codMunicipio: COD, enderecoCru, bairro, cepConsulta }, idx, opts);

test("nome de via que parece lote, quadra, km, rodovia ou palavra repetida casa exato", () => {
  for (const [end, via] of [
    ["RUA L 08, 20", "l 08"], ["RUA QUADRA 35, 20", "quadra 35"], ["ALAMEDA 28 QD 36, 20", "28 qd 36"],
    ["RODOVIA KM 44, 20", "km 44"], ["RODOVIA BR156, 20", "br156"], ["SITIO SITIO PANTANO, 20", "sitio pantano"],
    ["RUA CEL LINDOLFO, 20", "cel lindolfo"],
  ]) {
    const r = geo(end);
    assert.equal(r.viaKey, via, end);
    assert.equal(r.status, "verde", `${end}: ${r.motivo}`);
    assert.equal(r.numero, "20", end);
    assert.equal(r.quadra, null, end);
    assert.equal(r.lote, null, end);
  }
});

test("sem número: 'RUA L 08' e 'RODOVIA KM 44' acham a via em vez de voltar vermelho", () => {
  assert.equal(geo("RUA L 08").viaKey, "l 08");
  const r = geo("RODOVIA KM 44");
  assert.equal(r.viaKey, "km 44");
  assert.equal(r.numero, null);
});

test("tipo fora da lista é separado do nome quando a via existe com esse tipo", () => {
  assert.equal(geo("QUADRA 35, 20").viaKey, "35");
  assert.equal(geo("1A TRAVESSA DA RUA ANTONIO MARTINS, 20").viaKey, "antonio martins");
  const r = geo("1A TRAVESSA DA RUA ANTONIO MARTINS, 20");
  assert.ok(Math.abs(r.coord.lon - dic["antonio martins"][5].lo) < 1e-9, "ponto da travessa, não da rua");
});

test("'RIO MADEIRA': o número de porta decide entre a via 'madeira' (tipo RIO) e a rua 'rio madeira'", () => {
  assert.equal(geo("RIO MADEIRA, 20").viaKey, "madeira");
  assert.equal(geo("RIO MADEIRA, 510").viaKey, "rio madeira");
  assert.equal(geo("RUA RIO MADEIRA, 510").viaKey, "rio madeira");
  // sem número, fica a que tem mais pontos
  assert.equal(geo("RIO MADEIRA").viaKey, "madeira");
});

test("quadra e lote depois da vírgula continuam valendo na leitura literal", () => {
  const r = geo("RUA L 08, Qd 3 Lt 5");
  assert.equal(r.viaKey, "l 08");
  assert.equal(r.quadra, "3");
  assert.equal(r.lote, "5");
});

test("endereço comum não muda: quadra e lote antes da vírgula", () => {
  const q = G.extrairEntidades("Rua das Acacias Qd 3 Lt 5");
  assert.equal(q.via, "das acacias");
  const r = geo("Rua das Acacias Qd 3 Lt 5");
  assert.equal(r.viaKey, "das acacias");
  assert.equal(r.quadra, "3");
});

test("número de porta com letra ou com mais de 5 dígitos", () => {
  assert.equal(G.extrairEntidades("Rua das Acacias, 125A").numero, "125");
  assert.equal(G.extrairEntidades("Rua das Acacias, 125-B").numero, "125");
  assert.equal(G.extrairEntidades("Rua das Acacias, 1355012").numero, "1355012");
  assert.equal(G.extrairEntidades("Rua das Acacias, casa 2").numero, null);
  assert.equal(geo("Rua das Acacias, 20A").status, "verde");
});

test("eixo da rua: ponto mais ocupado do miolo, não o centro geométrico", () => {
  // 21 pontos espalhados a cada 100 m e um grupo de 8 pontos juntos perto do centro.
  const pool = [
    ...Array.from({ length: 21 }, (_, i) => p("rua", null, i * 100)),
    ...Array.from({ length: 8 }, (_, i) => p("rua", null, 1150 + i * 5)),
  ];
  const { coord } = G.geomedoidComRaio(pool, "", null, false, null);
  const x = (coord.lon + 50) * 109600;
  assert.ok(x >= 1095 && x <= 1205, `x = ${x.toFixed(0)}`); // centro geométrico: x ≈ 1040
  // grupo denso numa ponta da via fica fora do miolo: o ponto continua perto do centro
  const ponta = [
    ...Array.from({ length: 21 }, (_, i) => p("rua", null, i * 100)),
    ...Array.from({ length: 8 }, (_, i) => p("rua", null, 3000 + i * 5)),
  ];
  const xp = (G.geomedoidComRaio(ponta, "", null, false, null).coord.lon + 50) * 109600;
  assert.ok(xp < 2000, `x = ${xp.toFixed(0)}`);
});
