import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairEntidades, extensoParaNumeral, normalizeBase } from "../src/index.js";

test("normalizeBase remove acento, caixa e pontuação", () => {
  assert.equal(normalizeBase("Av. Goiás, Nº 10"), "av goias n 10");
});

test("extenso → numeral com fronteira de palavra (#5)", () => {
  assert.equal(extensoParaNumeral("rua sessenta e oito"), "rua 68");
  assert.equal(extensoParaNumeral("rua novembro"), "rua novembro");
  assert.equal(extensoParaNumeral("rua dezembro"), "rua dezembro");
});

test("número após a vírgula", () => {
  const e = extrairEntidades("Rua 8, 120");
  assert.equal(e.via, "8");
  assert.equal(e.tipo, "rua");
  assert.equal(e.numero, "120");
});

test("quadra e lote em várias grafias", () => {
  for (const s of ["Rua 8, Qd. 12 Lt. 5", "Rua 8 Quadra 12 Lote 5", "RUA 8 QD12 LT05", "Rua 8 Q 12 L 5"]) {
    const e = extrairEntidades(s);
    assert.equal(e.quadra, "12", s);
    assert.equal(e.lote, "5", s);
    assert.equal(e.via, "8", s);
  }
});

test("prefixo de 1 letra exige espaço (#14)", () => {
  const e = extrairEntidades("Rua Nivel5, 10");
  assert.equal(e.lote, null);
});

test("N° sem vírgula (#8)", () => {
  assert.equal(extrairEntidades("Rua 8 Nº 45").numero, "45");
});

test("Q/L antes da vírgula usa a parte seguinte como via (#15)", () => {
  const e = extrairEntidades("QUADRA 5 LOTE 3, RUA 8");
  assert.equal(e.via, "8");
  assert.equal(e.quadra, "5");
});

test("cruzamento com esq/c/ (#16)", () => {
  assert.equal(extrairEntidades("Rua 10 esq. com Av. Goiás").viaCruzamento, "goias");
  assert.equal(extrairEntidades("Rua 10 C/Rua 12").viaCruzamento, "12");
});

test("rodovia normalizada e km extraído", () => {
  const e = extrairEntidades("RODOVIA GO-040 KM-28");
  assert.equal(e.via, "go 040");
  assert.equal(e.km, "28");
  assert.equal(e.numero, "28");
});

test("km decimal não vaza para o nome da via", () => {
  const e = extrairEntidades("GO-222 KM 5,5");
  assert.equal(e.via, "222");
  assert.equal(e.tipo, "go");
  assert.equal(e.km, "5.5");
});
