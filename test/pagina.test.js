import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listarVersoes, montar, resumirManifesto, tamanhoLegivel } from "../pipeline/montar_pagina.mjs";

const MANIFESTO = {
  versao_formato: 1,
  municipios: {
    "1400100": { uf: "RR", tipo: "unico", entradas: 10, vias: 2, arquivos: [{ nome: "1400100.json.gz", bytes: 1500, sha256: "a" }] },
    "3550308": { uf: "SP", tipo: "fatiado", entradas: 99, vias: 9, fatias: 2, arquivos: [
      { nome: "3550308/index.json.gz", bytes: 700000, sha256: "b" },
      { nome: "3550308/f000.json.gz", bytes: 600000, sha256: "c" },
      { nome: "3550308/f001.json.gz", bytes: 500000, sha256: "d" }] },
    "9999999": { uf: "XX", tipo: "vazio", entradas: 0, vias: 0, arquivos: [] },
  },
};

function pastaDeEnvio(versoes) {
  const envio = mkdtempSync(join(tmpdir(), "candeia-pagina-"));
  for (const [versao, manifesto] of Object.entries(versoes)) {
    mkdirSync(join(envio, "cnefe2022", versao), { recursive: true });
    if (manifesto) writeFileSync(join(envio, "cnefe2022", versao, "manifesto.json"), JSON.stringify(manifesto));
  }
  return envio;
}

test("resumirManifesto soma arquivos e bytes e separa os tipos", () => {
  assert.deepEqual(resumirManifesto(MANIFESTO), {
    municipios: 3, unicos: 1, fatiados: 1, vazios: 1, arquivos: 4, bytes: 1801500, versaoFormato: 1,
  });
});

test("resumirManifesto recusa tipo desconhecido e bytes inválido", () => {
  assert.throws(() => resumirManifesto({ municipios: { a: { tipo: "outro", arquivos: [] } } }), /tipo/);
  assert.throws(() => resumirManifesto({ municipios: { a: { tipo: "unico", arquivos: [{ nome: "x", bytes: "1" }] } } }), /bytes/);
});

test("tamanhoLegivel usa unidade decimal e vírgula", () => {
  assert.equal(tamanhoLegivel(996728982), "997 MB");
  assert.equal(tamanhoLegivel(1234567890), "1,23 GB");
  assert.equal(tamanhoLegivel(614872), "615 KB");
  assert.equal(tamanhoLegivel(900), "900 bytes");
});

test("montar escreve a página com os números do manifesto e sem marcador sobrando", () => {
  const envio = pastaDeEnvio({ v1: MANIFESTO, v2: MANIFESTO, v10: MANIFESTO, v3: null });
  try {
    assert.deepEqual(listarVersoes(envio).map((v) => v.versao), ["v10", "v2", "v1"]); // v3 não tem manifesto
    assert.equal(montar(envio).escreveuIndex, true);
    const html = readFileSync(join(envio, "index.html"), "utf8");
    assert.doesNotMatch(html, /\{\{/);
    assert.match(html, /1\.801\.500 bytes/);
    assert.match(html, /href="\/cnefe2022\/v1\/manifesto\.json"/);
    assert.match(html, /cnefe2022\/v10\/"<\/span>/); // o exemplo de código aponta para a versão mais nova
    assert.doesNotMatch(html, /cnefe2022\/v3\//);
    const pacote = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.ok(html.includes(`versão ${pacote.version} `));
    for (const f of ["404.html", "pagina.css", "tema.js", "favicon.svg", "fontes/bricolage-grotesque-normal-latin.woff2"]) {
      assert.ok(existsSync(join(envio, f)), f);
    }
  } finally { rmSync(envio, { recursive: true, force: true }); }
});

test("sem manifesto, montar não publica index.html mas mantém o 404.html", () => {
  const envio = pastaDeEnvio({ v1: null });
  try {
    writeFileSync(join(envio, "index.html"), "antigo");
    assert.equal(montar(envio).escreveuIndex, false);
    assert.equal(existsSync(join(envio, "index.html")), false);
    assert.ok(existsSync(join(envio, "404.html")));
  } finally { rmSync(envio, { recursive: true, force: true }); }
});

test("a página não carrega nada de fora e só tem script do próprio site", () => {
  for (const nome of ["index.html", "404.html"]) {
    const html = readFileSync(new URL(`../pipeline/pagina/${nome}`, import.meta.url), "utf8");
    // a CSP da raiz só aceita script do próprio site: nada inline, só /tema.js
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.deepEqual(scripts.map((m) => [m[1].trim(), m[2].trim()]), [['src="/tema.js"', ""]], nome);
    assert.doesNotMatch(html, /style=/i, nome); // a CSP da raiz não permite estilo inline
    const externos = [...html.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)].map((m) => m[1])
      .filter((u) => u !== "https://dados.lucasrikelmi.dev/");
    assert.deepEqual(externos, [], nome);
  }
  const css = readFileSync(new URL("../pipeline/pagina/pagina.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /url\(\s*["']?(https?:|\/\/)/);
});
