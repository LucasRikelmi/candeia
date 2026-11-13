import { test } from "node:test";
import assert from "node:assert/strict";
import { entradaDeLinhaCnefe, parseCnefeLonLat, construirIndiceCnefe } from "../src/index.js";

// Linha no layout do CNEFE 2022 (valores fictícios).
const base = {
  COD_MUNICIPIO: "1400100", NUM_QUADRA: "55",
  NOM_TIPO_SEGLOGR: "RUA", NOM_TITULO_SEGLOGR: "", NOM_SEGLOGR: "OITO",
  NUM_ENDERECO: "120", DSC_MODIFICADOR: "", DSC_LOCALIDADE: "CENTRO", CEP: "69300000",
  NOM_COMP_ELEM1: "QUADRA", VAL_COMP_ELEM1: "022", NOM_COMP_ELEM2: "LOTE", VAL_COMP_ELEM2: "07",
  LATITUDE: "2.825457", LONGITUDE: "-60.781688", NV_GEO_COORD: "1",
};

test("quadra/lote vêm do complemento, não de NUM_QUADRA (censitária)", () => {
  const r = entradaDeLinhaCnefe(base);
  assert.equal(r.entry.q, "22");
  assert.equal(r.entry.l, "7");
  assert.equal(r.via, "8");
  assert.equal(r.entry.n, "120");
});

test("NV_GEO_COORD 5 e 6 são descartados (#3)", () => {
  assert.equal(entradaDeLinhaCnefe({ ...base, NV_GEO_COORD: "5" }), null);
  assert.equal(entradaDeLinhaCnefe({ ...base, NV_GEO_COORD: "6" }), null);
  assert.ok(entradaDeLinhaCnefe({ ...base, NV_GEO_COORD: "4" }));
});

test("SN e número 0 viram null", () => {
  assert.equal(entradaDeLinhaCnefe({ ...base, DSC_MODIFICADOR: "SN" }).entry.n, null);
  assert.equal(entradaDeLinhaCnefe({ ...base, NUM_ENDERECO: "0" }).entry.n, null);
});

test("coordenada com ponto duplicado (#13)", () => {
  assert.equal(parseCnefeLonLat("-16.113.125"), -16.113125);
  assert.ok(Number.isNaN(parseCnefeLonLat("-1.6.1.1")));
});

test("índice agrupa por município e via", () => {
  const idx = construirIndiceCnefe([base, { ...base, NUM_ENDERECO: "130" }]);
  assert.equal(idx["1400100"]["8"].length, 2);
});
