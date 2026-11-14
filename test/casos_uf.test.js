// Casos de teste por UF: test/casos/<UF>.json. Formato e como contribuir em CONTRIBUTING.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extrairEntidades } from "../src/index.js";

const dir = new URL("./casos/", import.meta.url);
for (const arq of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  const { uf, casos } = JSON.parse(readFileSync(new URL(arq, dir), "utf8"));
  for (const c of casos) {
    test(`${uf}: ${c.entrada}`, { todo: c.todo }, () => {
      const r = extrairEntidades(c.entrada);
      // Só os campos listados em "esperado" são conferidos.
      const obtido = Object.fromEntries(Object.keys(c.esperado).map((k) => [k, r[k] ?? null]));
      assert.deepEqual(obtido, c.esperado);
    });
  }
}
