// Benchmark de regressão para o CI, sobre o índice publicado.
//
//   node bench/ci.mjs                                  # baixa de dados.lucasrikelmi.dev e compara
//   node bench/ci.mjs --atualizar                      # grava a referência nova (mudança intencional)
//   node bench/ci.mjs --local <pasta do benchmark>     # sem rede: dicionarios/ + municipios.json
//
// Amostra fixa e determinística: 120 endereços de cada um de 11 municípios de arquivo único
// (regiões e portes variados), sorteados por hash. As consultas são montadas a partir do próprio
// índice (tipo + via + número ou quadra/lote, bairro, CEP) em variantes, nos cenários A (ponto no
// índice) e B (ponto retirado: testa vizinho, interpolação, eixo). O gabarito é a coordenada do
// próprio ponto. Os números são otimistas por construção; servem para pegar regressão, não para
// anunciar precisão (para isso, bench/rodar.mjs sobre o recorte do CNEFE).
//
// Além disso, nos municípios fatiados (Boa Vista, DF) confere a paridade do loader (só baixa o
// necessário) com o motor rodando sobre o dicionário inteiro.
//
// Falha se, em qualquer grupo (cenário × variante), ate_100m cair ou acima_1km subir mais que a
// TOLERANCIA em pontos percentuais em relação a bench/ci_referencia.json, ou se a paridade quebrar.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as G from "../src/index.js";
import { hash, comErro, haversine, resumir } from "./comum.mjs";

const UNICOS = ["1507300", "2601201", "2802106", "3143104", "3527108", "4212502", "5005707", "5210000",
  "2915007", "3135456", "4323754"];
const FATIADOS = ["1400100", "5300108"];
const POR_MUNICIPIO = 120;
const PARIDADE_POR_MUNICIPIO = 40;
const TOLERANCIA = 1.0; // pontos percentuais
const BASE_PADRAO = "https://dados.lucasrikelmi.dev/cnefe2022/v1/";
const REFERENCIA = fileURLToPath(new URL("./ci_referencia.json", import.meta.url));
const UA = "candeia-bench-ci/1.0 (+https://github.com/LucasRikelmi/candeia)";

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const ATUALIZAR = argv.includes("--atualizar");
const LOCAL = opt("--local");
const BASE = (opt("--base") || BASE_PADRAO).replace(/\/?$/, "/");

// ---------------------------------------------------------------- fonte dos arquivos
// fetch com User-Agent próprio: a Cloudflare barra assinaturas genéricas de cliente (erro 1010).
let buscar = async (url) => {
  for (let t = 1; ; t++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (r.ok || r.status === 404 || t >= 3) return r;
    } catch (e) { if (t >= 3) throw e; }
    await new Promise((ok) => setTimeout(ok, 1000 * t));
  }
};
if (LOCAL) buscar = servidorLocal(LOCAL);

async function json(caminho) {
  const r = await buscar(BASE + caminho);
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  return JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b).toString("utf8"));
}

// Modo --local: monta manifesto e fatias em memória a partir do recorte do benchmark, no formato
// de pipeline/gerar_indice.py (50 mil entradas por fatia). Serve só para desenvolver sem rede.
function servidorLocal(pasta) {
  const info = JSON.parse(readFileSync(`${pasta}/municipios.json`, "utf8"));
  const arq = new Map(), municipios = {};
  const por = (p, o) => {
    const b = gzipSync(Buffer.from(JSON.stringify(o)));
    arq.set(p, b);
    return { nome: p.split("/").pop(), sha256: createHash("sha256").update(b).digest("hex") };
  };
  for (const cod of [...UNICOS, ...FATIADOS]) {
    const { uf } = info[cod];
    const dic = JSON.parse(gunzipSync(readFileSync(`${pasta}/dicionarios/${cod}.json.gz`)));
    if (UNICOS.includes(cod)) { municipios[cod] = { uf, tipo: "unico", arquivos: [por(`${uf}/${cod}.json.gz`, dic)] }; continue; }
    const vias = {}, partes = []; let f = 0, ac = 0;
    for (const k of Object.keys(dic)) {
      const n = dic[k].length;
      if (ac && ac + n > 50000) { f++; ac = 0; }
      vias[k] = [f, n]; (partes[f] ??= {})[k] = dic[k]; ac += n;
    }
    const cb = G.construirIndiceCepBairro({ x: dic }).x, ceps = {};
    for (const k in dic) for (const e of dic[k]) if (e.c) {
      const c = (ceps[e.c] ??= [cb[e.c] || "", 0, []]); c[1]++; if (!c[2].includes(vias[k][0])) c[2].push(vias[k][0]);
    }
    const todos = Object.values(dic).flat(), cent = G.centroide(todos);
    const arquivos = [por(`${uf}/${cod}/index.json.gz`, { v: 1, cod, entradas: todos.length, fatias: partes.length,
      centroide: [cent.lat, cent.lon], vias, ceps })];
    partes.forEach((p, i) => arquivos.push(por(`${uf}/${cod}/f${String(i).padStart(3, "0")}.json.gz`, p)));
    municipios[cod] = { uf, tipo: "fatiado", arquivos };
  }
  arq.set("manifesto.json", Buffer.from(JSON.stringify({ municipios })));
  return async (url) => {
    const b = arq.get(url.slice(BASE.length));
    return b ? new Response(b) : new Response("", { status: 404 });
  };
}

// ---------------------------------------------------------------- amostra e consultas
const sel = (dic, cod, n) => {
  const todos = [];
  for (const k in dic) dic[k].forEach((e, i) => todos.push({ k, e, h: hash(`${cod}|${k}|${i}`) }));
  return todos.sort((a, b) => a.h - b.h || (a.k < b.k ? -1 : 1)).slice(0, n);
};
const temNumero = (e) => e.n && e.n !== "0";
function complemento(e) {
  if (temNumero(e)) return `, ${e.n}`;
  const ql = [e.q && `Qd ${e.q}`, e.l && `Lt ${e.l}`].filter(Boolean).join(" ");
  return ql ? `, ${ql}` : "";
}
function variantes({ k, e }, semente) {
  const via = [e.tp, k].filter(Boolean).join(" ");
  const out = { limpa: { end: via + complemento(e), bairro: e.b || "", cep: e.c || "" } };
  if (temNumero(e)) {
    out.sem_virgula = { ...out.limpa, end: `${via} ${e.n}` };
    out.numero_omitido = { ...out.limpa, end: via };
  }
  const err = comErro(k.toUpperCase(), semente);
  if (err) out.digitacao = { ...out.limpa, end: [e.tp, err].filter(Boolean).join(" ") + complemento(e) };
  out.sem_bairro_cep = { end: out.limpa.end, bairro: "", cep: "" };
  return out;
}

function prepararOpts(cod, dic) {
  const idx = { [cod]: dic }, chaves = Object.keys(dic);
  const cepIndex = G.construirIndiceCep(idx);
  return {
    idx,
    opts: {
      blocking: G.construirBlockingIndex(idx), cepIndex, cepBairroIndex: G.construirIndiceCepBairro(idx, cepIndex),
      cache: new Map(), totalPontosPorMunicipio: { [cod]: chaves.reduce((s, c) => s + dic[c].length, 0) },
      centroideMunicipio: G.centroide(chaves.flatMap((c) => dic[c])),
    },
  };
}

// ---------------------------------------------------------------- execução
const t0 = Date.now();
const manifesto = await json("manifesto.json");
const resultados = [];

for (const cod of UNICOS) {
  const m = manifesto.municipios[cod];
  if (m?.tipo !== "unico") throw new Error(`${cod}: esperado arquivo único no manifesto, veio ${m?.tipo}`);
  const dic = await json(`${m.uf}/${cod}.json.gz`);
  const base = prepararOpts(cod, dic);
  for (const s of sel(dic, cod, POR_MUNICIPIO)) {
    const semente = `${cod}|${s.k}|${s.h}`;
    const vs = variantes(s, semente);
    const medir = (cenario, variante, q, idx, opts) => {
      const out = G.geocodificar({ codMunicipio: cod, enderecoCru: q.end, bairro: q.bairro, cepConsulta: q.cep }, idx, opts);
      const c = out.coord;
      const dist = c && Number.isFinite(c.lat) ? haversine(s.e.la, s.e.lo, c.lat, c.lon) : null;
      resultados.push({ cod, cenario, variante, status: out.status, raio: out.raio ?? null, dist });
    };
    for (const [variante, q] of Object.entries(vs)) medir("A", variante, q, base.idx, base.opts);
    // B: retira da via os pontos na coordenada do gabarito e reconstrói os índices.
    const resto = dic[s.k].filter((e) => !(Math.abs(e.la - s.e.la) < 1e-7 && Math.abs(e.lo - s.e.lo) < 1e-7));
    const dicB = { ...dic };
    if (resto.length) dicB[s.k] = resto; else delete dicB[s.k];
    const b = prepararOpts(cod, dicB);
    medir("B", "limpa", vs.limpa, b.idx, b.opts);
  }
  process.stdout.write(`${cod} `);
}

// Paridade do loader nos fatiados: mesma resposta que o motor com o dicionário inteiro.
const geo = G.criarGeocodificador({ base: BASE, fetch: (u) => buscar(u) });
let consultasParidade = 0;
const diferencas = [];
for (const cod of FATIADOS) {
  const m = manifesto.municipios[cod];
  if (m?.tipo !== "fatiado") throw new Error(`${cod}: esperado fatiado no manifesto, veio ${m?.tipo}`);
  const dic = {};
  for (const a of m.arquivos) if (a.nome !== "index.json.gz") Object.assign(dic, await json(`${m.uf}/${cod}/${a.nome}`));
  const { idx, opts } = prepararOpts(cod, dic);
  // O loader usa o centroide gravado no index.json (calculado pelo pipeline), que difere em casas
  // decimais do centroide() do JS. Só aparece na resposta vermelha (centro do município); a paridade
  // testa o carregamento por fatias, então o motor recebe o mesmo centroide.
  const [la, lo] = (await json(`${m.uf}/${cod}/index.json.gz`)).centroide;
  opts.centroideMunicipio = { lat: la, lon: lo };
  for (const s of sel(dic, cod, PARIDADE_POR_MUNICIPIO)) {
    const v = variantes(s, `${cod}|${s.k}|${s.h}`);
    for (const q of [v.limpa, v.sem_bairro_cep, v.numero_omitido].filter(Boolean)) {
      const a = G.geocodificar({ codMunicipio: cod, enderecoCru: q.end, bairro: q.bairro, cepConsulta: q.cep }, idx, opts);
      const z = await geo.geocodificar(q.end, { municipio: cod, bairro: q.bairro, cep: q.cep });
      consultasParidade++;
      const igual = a.status === z.status && a.viaKey === z.viaKey &&
        (a.coord == null ? z.coord == null : z.coord != null && Math.abs(a.coord.lat - z.coord.lat) < 1e-9 && Math.abs(a.coord.lon - z.coord.lon) < 1e-9);
      if (!igual) diferencas.push(`${cod} "${q.end}" [${q.bairro}|${q.cep}]: motor ${a.status}/${a.viaKey} × loader ${z.status}/${z.viaKey}`);
    }
  }
  process.stdout.write(`${cod} `);
}
console.log(`\n${resultados.length} consultas de benchmark, ${consultasParidade} de paridade, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ---------------------------------------------------------------- comparação
const grupos = {};
for (const x of resultados) (grupos[`${x.cenario} ${x.variante}`] ??= []).push(x);
const atual = Object.fromEntries(Object.keys(grupos).sort().map((g) => {
  const r = resumir(grupos[g]);
  return [g, { n: r.n, ate_100m: r.ate_100m, acima_1km: r.acima_1km, mediana_m: r.mediana_m, erro_dentro_do_raio: r.erro_dentro_do_raio }];
}));

const linhas = ["| grupo | n | ≤100 m | >1 km | mediana (m) | Δ ≤100 m | Δ >1 km |", "|---|---|---|---|---|---|---|"];
const falhas = [];
const ref = existsSync(REFERENCIA) ? JSON.parse(readFileSync(REFERENCIA, "utf8")).grupos : null;
for (const [g, r] of Object.entries(atual)) {
  const b = ref?.[g];
  const d100 = b ? +(r.ate_100m - b.ate_100m).toFixed(1) : null, d1k = b ? +(r.acima_1km - b.acima_1km).toFixed(1) : null;
  if (b && d100 < -TOLERANCIA) falhas.push(`${g}: ≤100 m caiu ${-d100} pts (${b.ate_100m} → ${r.ate_100m})`);
  if (b && d1k > TOLERANCIA) falhas.push(`${g}: >1 km subiu ${d1k} pts (${b.acima_1km} → ${r.acima_1km})`);
  if (ref && !b) falhas.push(`${g}: grupo novo, sem referência (rode com --atualizar se for intencional)`);
  if (b && b.n !== r.n) falhas.push(`${g}: amostra mudou de ${b.n} para ${r.n} consultas (rode com --atualizar se for intencional)`);
  linhas.push(`| ${g} | ${r.n} | ${r.ate_100m}% | ${r.acima_1km}% | ${r.mediana_m ?? "—"} | ${d100 ?? "—"} | ${d1k ?? "—"} |`);
}
for (const d of diferencas.slice(0, 20)) falhas.push(`paridade: ${d}`);
if (diferencas.length > 20) falhas.push(`paridade: mais ${diferencas.length - 20} diferença(s)`);

const relatorio = [`### Benchmark de regressão (índice ${LOCAL ? "local" : BASE})`, "", ...linhas, "",
  `Paridade do loader: ${consultasParidade - diferencas.length}/${consultasParidade} iguais.`, "",
  falhas.length ? `**${falhas.length} problema(s):**\n${falhas.map((f) => `- ${f}`).join("\n")}` : "Sem regressão."].join("\n");
console.log(relatorio);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, relatorio + "\n");

// Linha única com a referência calculada nesta rodada: dá para copiar do log do CI.
console.log("REFERENCIA_ATUAL " + JSON.stringify({ indice: "cnefe2022/v1", grupos: atual }));

if (ATUALIZAR) {
  if (diferencas.length) { console.error("paridade quebrada: referência não gravada"); process.exit(1); }
  writeFileSync(REFERENCIA, JSON.stringify({ indice: "cnefe2022/v1", grupos: atual }, null, 1) + "\n");
  console.log(`referência gravada em ${REFERENCIA}`);
  process.exit(0);
}
if (!ref) { console.error("sem bench/ci_referencia.json: rode com --atualizar"); process.exit(1); }
process.exit(falhas.length ? 1 : 0);
