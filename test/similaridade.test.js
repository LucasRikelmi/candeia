import { test } from "node:test";
import assert from "node:assert/strict";
import { viaSimilarity, bairroSimilarity, jaroWinkler } from "../src/index.js";

test("guarda de número terminal (#4)", () => {
  assert.equal(viaSimilarity("8", "80"), 0);
  assert.equal(viaSimilarity("r2", "r20"), 0);
  assert.equal(viaSimilarity("j016", "j 16") > 0, true);
});

test("jaroWinkler idêntico = 1", () => {
  assert.equal(jaroWinkler("goias", "goias"), 1);
});

test("bairro: classificador genérico não infla o score (#18)", () => {
  assert.ok(bairroSimilarity("vila nova", "vila rica") < 0.85);
  assert.ok(bairroSimilarity("zona rural", "zona urbana") < 0.85);
  assert.equal(bairroSimilarity("jardim bela vista", "setor bela vista"), 1);
});

test("bairro: numeral romano final (#18)", () => {
  assert.equal(bairroSimilarity("jardim primavera i", "setor jardim primavera 1"), 1);
});

test("bairro: nome truncado (#18)", () => {
  assert.equal(bairroSimilarity("parque ind vice presidente jose", "parque ind vice pres"), 0.9);
});
