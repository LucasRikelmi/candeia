// Grafia canônica de letra+número no nome da via ("C2" = "C 2" = "C-2") e "S/N" escrito na consulta.
// Índice montado à mão, com coordenadas fictícias.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/index.js";
import { _canonVia } from "../src/geocodificar.js";

const COD = "9999997";
const p = (tp, n, x, extra = {}) => ({ tp, n, q: null, l: null, b: "centro", c: "70000000",
  la: -10, lo: -50 + x / 109600, g: 1, k: 1, ...extra });
const linha = (tp, n0, x0, qtd = 4) => Array.from({ length: qtd }, (_, i) => p(tp, String(n0 + i * 10), x0 + i * 20));

const dic = {
  "c 2": linha("rua", 10, 0),
  "t28": linha("rua", 10, 3000),
  "9": linha("rua", 10, 6000),
  "24 a qd 103": linha("rua", 10, 9000),
  "do 12": linha("ramal", 10, 12000),
  "central ii": linha("rua", 10, 15000),
  "joao 23": linha("rua", 10, 18000),
  // via com numerados num trecho e S/N em outro
  "projetada": [...linha("rua", 10, 20000, 8), ...Array.from({ length: 3 }, (_, i) => p("rua", null, 24000 + i * 20))],
};
const idx = { [COD]: dic };
const opts = { blocking: G.construirBlockingIndex(idx), cepIndex: G.construirIndiceCep(idx), cache: new Map() };
const geo = (enderecoCru) => G.geocodificar({ codMunicipio: COD, enderecoCru, bairro: "", cepConsulta: "" }, idx, opts);

test("_canonVia junta letra e número e tira zero à esquerda, sem juntar palavras", () => {
  assert.equal(_canonVia("c 2"), "c2");
  assert.equal(_canonVia("c-2"), "c2");
  assert.equal(_canonVia("24 a qd 103"), "24a qd103");
  assert.equal(_canonVia("09 de julho"), "9 de julho");
  assert.equal(_canonVia("do 12"), "do12"); // 2 letras juntam; a chave exata continua tendo prioridade
  assert.equal(_canonVia("antonio martins"), "antonio martins");
});

test("C2, C 2 e C-2 casam a mesma via", () => {
  for (const [end, via] of [
    ["RUA C2, 20", "c 2"], ["RUA C-2, 20", "c 2"], ["RUA C 2, 20", "c 2"],
    ["RUA T 28, 20", "t28"], ["RUA T-28, 20", "t28"], ["RUA 09, 20", "9"],
    ["RUA 24A QD103, 20", "24 a qd 103"], ["RAMAL DO 12, 20", "do 12"],
  ]) {
    const r = geo(end);
    assert.equal(r.viaKey, via, end);
    assert.equal(r.status, "verde", `${end}: ${r.motivo}`);
  }
});

test("S/N escrito leva o ponto para os endereços sem número; sem ele, nada muda", () => {
  const semNada = geo("RUA PROJETADA");
  for (const end of ["RUA PROJETADA, S/N", "RUA PROJETADA, SN", "RUA PROJETADA S/Nº", "RUA PROJETADA, sem número"]) {
    const r = geo(end);
    assert.ok(r.coord.lon > -50 + 23900 / 109600, `${end}: ${r.coord.lon}`);
  }
  assert.ok(semNada.coord.lon < -50 + 23900 / 109600, `sem S/N: ${semNada.coord.lon}`);
});

test("romano no fim do nome escrito em algarismo e vice-versa", () => {
  for (const [end, via] of [["RUA CENTRAL 2, 20", "central ii"], ["RUA JOAO XXIII, 20", "joao 23"]]) {
    const r = geo(end);
    assert.equal(r.viaKey, via, end);
  }
});
