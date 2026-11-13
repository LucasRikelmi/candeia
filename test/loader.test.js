// Loader do índice publicado: mesmo resultado do motor com o dicionário inteiro, baixando só o
// necessário. O "servidor" é um Map em memória no formato de pipeline/gerar_indice.py.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as G from "../src/index.js";
import * as T from "./fixtures/geo-town.js";
import { cidadeSintetica } from "./helpers.js";

const { idx, geo } = cidadeSintetica();
const DIC = idx[T.COD];
const COD_FATIADO = "5299999";

function montarServidor({ fatias = 3 } = {}) {
  const arquivos = new Map();
  const por = (caminho, obj) => {
    const b = gzipSync(Buffer.from(JSON.stringify(obj)));
    arquivos.set(caminho, b);
    return { nome: caminho.split("/").pop(), bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") };
  };
  const unico = por(`GO/${T.COD}.json.gz`, DIC);

  const chaves = Object.keys(DIC).sort();
  const porFatia = Math.ceil(chaves.length / fatias);
  const vias = {}, partes = [];
  chaves.forEach((k, i) => { const f = Math.floor(i / porFatia); vias[k] = [f, DIC[k].length]; (partes[f] ??= {})[k] = DIC[k]; });
  const cepBairro = G.construirIndiceCepBairro({ x: DIC }).x;
  const ceps = {};
  for (const k of chaves) for (const e of DIC[k]) if (e.c) {
    const c = (ceps[e.c] ??= [cepBairro[e.c] || "", 0, []]);
    c[1]++; if (!c[2].includes(vias[k][0])) c[2].push(vias[k][0]);
  }
  const cent = G.centroide(chaves.flatMap((k) => DIC[k]));
  const entradas = chaves.reduce((s, k) => s + DIC[k].length, 0);
  const arqF = [por(`GO/${COD_FATIADO}/index.json.gz`, { v: 1, cod: COD_FATIADO, entradas, fatias: partes.length,
    centroide: [cent.lat, cent.lon], vias, ceps })];
  partes.forEach((p, f) => arqF.push(por(`GO/${COD_FATIADO}/f${String(f).padStart(3, "0")}.json.gz`, p)));
  arquivos.set("manifesto.json", Buffer.from(JSON.stringify({ versao_formato: 1, municipios: {
    [T.COD]: { uf: "GO", tipo: "unico", entradas, arquivos: [unico] },
    [COD_FATIADO]: { uf: "GO", tipo: "fatiado", entradas, fatias: partes.length, arquivos: arqF },
  } })));
  const pedidos = [];
  const fetch = async (url) => {
    const caminho = url.replace("https://dados.teste/", "");
    pedidos.push(caminho);
    const b = arquivos.get(caminho);
    return b ? new Response(b) : new Response("nao achei", { status: 404 });
  };
  return { arquivos, pedidos, fetch };
}

const CONSULTAS = [
  ["Rua Oito, Qd. 21 Lt. 4", "Setor Central", ""], ["AV BRASIL, 340", "", ""], ["Rua Sessenta e Oito, 220", "", ""],
  ["QD 41 LT 3, RUA 12", "", ""], ["Rua 10 esq. com Av. Goiás", "", ""], ["Rod. GO-070 km 4", "", ""],
  ["Rua 80, 15", "Jardim Primavera", "74920123"], ["Rua das Flores, 120", "", ""], ["Rua Brasil, 330", "", ""],
  ["Avenida Brasil", "", ""], ["Rua Inexistente Total", "", ""], ["Av. Brazil 340", "", ""],
];

for (const cod of [T.COD, COD_FATIADO]) {
  test(`loader (${cod === T.COD ? "único" : "fatiado"}) dá o mesmo resultado do motor`, async () => {
    const { fetch } = montarServidor();
    const g = G.criarGeocodificador({ base: "https://dados.teste/", fetch });
    for (const [end, bairro, cep] of CONSULTAS) {
      const a = geo(end, bairro, cep);
      const b = await g.geocodificar(end, { municipio: cod, bairro, cep });
      assert.equal(b.status, a.status, end);
      assert.equal(b.viaKey, a.viaKey, end);
      assert.equal(b.metodo, a.metodo, end);
      assert.equal(b.raio, a.raio, end);
      assert.ok(Math.abs(b.coord.lat - a.coord.lat) < 1e-9 && Math.abs(b.coord.lon - a.coord.lon) < 1e-9, end);
    }
  });
}

test("fatiado baixa o índice e só a fatia da via pedida", async () => {
  const { fetch, pedidos } = montarServidor({ fatias: 4 });
  const g = G.criarGeocodificador({ base: "https://dados.teste/", fetch });
  await g.geocodificar("AV BRASIL, 340", { municipio: COD_FATIADO });
  const fatias = pedidos.filter((p) => /\/f\d{3}\.json\.gz$/.test(p));
  assert.deepEqual(pedidos.filter((p) => !fatias.includes(p)), ["manifesto.json", `GO/${COD_FATIADO}/index.json.gz`]);
  assert.equal(fatias.length, 1);
  const antes = pedidos.length;
  await g.geocodificar("AV BRASIL, 320", { municipio: COD_FATIADO });
  assert.equal(pedidos.length, antes, "segunda consulta na mesma via não baixa nada");
});

test("hash que não confere com o manifesto é erro", async () => {
  const s = montarServidor();
  const b = s.arquivos.get(`GO/${T.COD}.json.gz`);
  s.arquivos.set(`GO/${T.COD}.json.gz`, gzipSync(Buffer.from(JSON.stringify({ adulterado: [] }))));
  assert.notDeepEqual(s.arquivos.get(`GO/${T.COD}.json.gz`), b);
  const g = G.criarGeocodificador({ base: "https://dados.teste/", fetch: s.fetch });
  await assert.rejects(g.geocodificar("AV BRASIL, 340", { municipio: T.COD }), /hash/);
});

test("arquivo já descomprimido pelo servidor (Content-Encoding) também é lido", async () => {
  const s = montarServidor();
  s.arquivos.set(`GO/${T.COD}.json.gz`, Buffer.from(JSON.stringify(DIC)));
  const g = G.criarGeocodificador({ base: "https://dados.teste/", fetch: s.fetch });
  assert.equal((await g.geocodificar("AV BRASIL, 340", { municipio: T.COD })).status, "verde");
});

test("município fora do manifesto e sem município são erros claros", async () => {
  const g = G.criarGeocodificador({ base: "https://dados.teste/", fetch: montarServidor().fetch });
  await assert.rejects(g.geocodificar("Rua 1", { municipio: "1234567" }), /manifesto/);
  await assert.rejects(g.geocodificar("Rua 1", {}), /municipio/);
});
