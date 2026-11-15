// A demo (exemplo/) reaproveita as fontes e o favicon de pipeline/pagina. Este teste quebra se
// alguém mover esses arquivos e deixar a demo apontando para o vazio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PASTA = resolve(dirname(fileURLToPath(import.meta.url)), "../exemplo");
const locais = (texto, padrao) => [...texto.matchAll(padrao)].map((m) => m[1]).filter((u) => !/^(https?:|#|data:|mailto:)/.test(u));

test("exemplo: todo arquivo local citado no HTML e no CSS existe", () => {
  const html = readFileSync(join(PASTA, "index.html"), "utf8");
  const css = readFileSync(join(PASTA, "demo.css"), "utf8");
  const js = readFileSync(join(PASTA, "demo.js"), "utf8");
  const refs = [
    ...locais(html, /(?:href|src)="([^"]+)"/g),
    ...locais(css, /url\("([^"]+)"\)/g),
    ...locais(js, /from "([^"]+)"/g),
  ];
  assert.ok(refs.length >= 8, `esperava achar as referências locais, achei ${refs.length}`);
  for (const r of refs) assert.ok(existsSync(join(PASTA, r)), `exemplo/ cita ${r}, que não existe`);
});

test("exemplo: scripts e estilos de terceiros têm integridade conferida", () => {
  const html = readFileSync(join(PASTA, "index.html"), "utf8");
  const externos = [...html.matchAll(/<(?:script|link rel="stylesheet")[^>]*(?:src|href)="https?:[^"]+"[^>]*>/g)].map((m) => m[0]);
  assert.ok(externos.length >= 2);
  for (const t of externos) assert.match(t, /integrity="sha384-[A-Za-z0-9+/=]+"\s+crossorigin="anonymous"/, t);
});
