import { test } from "node:test";
import assert from "node:assert/strict";
import { extrairEntidades, extensoParaNumeral, normalizeBase, ehCodigoRodovia } from "../src/index.js";

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

// Candeia — rodovias das 27 UFs (medido no CNEFE: pipeline/medir_rodovias.py)
test("sigla de qualquer UF seguida de número vira rodovia", () => {
  const e = extrairEntidades("SP-330 KM 100");
  assert.equal(e.tipo, "sp");
  assert.equal(e.via, "330");
  assert.equal(e.numero, "100");
  assert.equal(extrairEntidades("Rod. PR 281").via, "pr 281");
  assert.equal(extrairEntidades("Estrada RS 647").via, "rs 647");
});

test("sigla de UF sem número não é rodovia (falsos positivos)", () => {
  const al = extrairEntidades("Al. Santos, 100");
  assert.notEqual(al.tipo, "al");
  assert.equal(al.numero, "100");
  assert.equal(extrairEntidades("Rua Se Nova, 10").tipo, "rua");
});

test("códigos locais que não são sigla de UF não viram rodovia", () => {
  assert.equal(extrairEntidades("QR 427 Conjunto 10").tipo, null);
  assert.equal(extrairEntidades("WE 25, 100").tipo, null);
  assert.equal(extrairEntidades("JC 58, 12").tipo, null);
});

test("ehCodigoRodovia exige número de 2 a 3 dígitos após a sigla", () => {
  assert.equal(ehCodigoRodovia(["rs", "647"]), true);
  assert.equal(ehCodigoRodovia(["br", "153"]), true);
  assert.equal(ehCodigoRodovia(["al", "santos"]), false);
  assert.equal(ehCodigoRodovia(["qr", "427"]), false);
  assert.equal(ehCodigoRodovia(["sp", "1"]), false);
});

test("abreviações de tipo e título no início do endereço", () => {
  assert.equal(extrairEntidades("R. das Flores, 10").tipo, "rua");
  assert.equal(extrairEntidades("Al. Santos, 100").tipo, "alameda");
  assert.equal(extrairEntidades("Av. Dr. Jose Silva, 7").via, "doutor jose silva");
  assert.equal(extrairEntidades("Rua R 5, 10").via, "r 5");      // "R" no meio não vira "rua"
  assert.equal(extrairEntidades("AL 101, km 5").tipo, "al");      // rodovia AL-101 não vira alameda
});

// Candeia (PR #5) — via estruturada (DF, conjuntos)
test("via estruturada: DF com conjunto, bloco e casa", () => {
  const casos = [
    ["QNN 25 CJ B CASA 47", "qnn 25 conjunto b", "47"],
    ["SQS 308 BL C AP 101", "sqs 308 bloco c", null],
    ["EDF QUADRA 37, Lt 03", "quadra 37", "3"],
    ["SHIS QI 15 CONJ 2 CS 10", "shis qi 15 conjunto 2", "10"],
  ];
  for (const [end, via, lote] of casos) {
    const e = extrairEntidades(end);
    assert.equal(e.viaEstruturada, via, end);
    assert.equal(e.lote, lote, end);
  }
});

test("via estruturada não aparece em endereço comum", () => {
  for (const end of ["Rua das Flores, 120", "Av. Brasil 340", "Rodovia BR-153 km 5", "Rua X, 10, casa 2"]) {
    assert.equal(extrairEntidades(end).viaEstruturada, null, end);
  }
});
