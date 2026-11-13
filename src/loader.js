// Candeia — carregamento do índice publicado (pipeline/gerar_indice.py) sob demanda.
//
//   const geo = criarGeocodificador({ base: "https://dados.exemplo.dev/cnefe2022/" });
//   const r = await geo.geocodificar("Rua 8, Qd 21 Lt 4", { municipio: "5208707", bairro, cep });
//
// Município pequeno: um arquivo com o dicionário inteiro. Município grande (fatiado): baixa o
// índice de vias (chaves + fatia de cada via), resolve a via com o mesmo algoritmo do motor e baixa
// só as fatias das vias candidatas (e do CEP informado, se couber). Funciona no navegador e no
// Node >= 22 (fetch, DecompressionStream e crypto.subtle globais).
import { geocodificar, _resolverVia } from "./geocodificar.js";
import { extrairEntidades } from "./extrair.js";
import { construirBlockingIndex, construirIndiceCep, construirIndiceCepBairro } from "./indices.js";
import { centroide } from "./posicionar.js";

// Valor das vias de fatia ainda não baixada: o motor só testa a existência da chave e itera as
// chaves; nunca lê as entradas de uma via que não escolheu.
const NAO_CARREGADA = Object.freeze([]);
// CEP cujos pontos estão espalhados em mais fatias que isto não é baixado (CEP genérico).
export const MAX_FATIAS_CEP = 3;

const UF_POR_PREFIXO = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE",
  24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP",
  41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
};

export function criarGeocodificador({ base, fetch: _fetch = globalThis.fetch, verificarHash = true,
  maxMunicipios = 20 } = {}) {
  if (!base) throw new Error("criarGeocodificador: informe `base` (URL da pasta do índice)");
  const raiz = base.endsWith("/") ? base : base + "/";
  const emVoo = new Map();      // url → Promise (deduplica downloads simultâneos)
  const municipios = new Map(); // cod → Promise<estado> (LRU simples pela ordem de inserção)
  let manifesto = null;

  async function baixarJson(caminho, sha256) {
    const url = raiz + caminho;
    if (!emVoo.has(url)) {
      emVoo.set(url, (async () => {
        const resp = await _fetch(url);
        if (!resp.ok) throw new Error(`Candeia: ${url} respondeu ${resp.status}`);
        return lerJson(new Uint8Array(await resp.arrayBuffer()), verificarHash ? sha256 : null, url);
      })().finally(() => emVoo.delete(url)));
    }
    return emVoo.get(url);
  }

  async function obterManifesto() {
    manifesto ??= baixarJson("manifesto.json", null).catch((e) => { manifesto = null; throw e; });
    return manifesto;
  }

  async function carregarMunicipio(codIn) {
    const cod = String(codIn).trim();
    if (municipios.has(cod)) {
      const p = municipios.get(cod);
      municipios.delete(cod); municipios.set(cod, p); // mais recente no fim
      return p;
    }
    const p = (async () => {
      const m = (await obterManifesto()).municipios?.[cod];
      if (!m) throw new Error(`Candeia: município ${cod} não está no manifesto`);
      if (m.tipo === "vazio") return { cod, vazio: true };
      const uf = m.uf || UF_POR_PREFIXO[cod.slice(0, 2)];
      const hash = Object.fromEntries((m.arquivos || []).map((a) => [a.nome, a.sha256]));
      if (m.tipo === "unico") {
        const dic = await baixarJson(`${uf}/${cod}.json.gz`, hash[`${cod}.json.gz`]);
        const idx = { [cod]: dic };
        const cepIndex = construirIndiceCep(idx);
        const chaves = Object.keys(dic);
        return {
          cod, unico: true, ruas: dic,
          opts: {
            blocking: construirBlockingIndex(idx), cepIndex,
            cepBairroIndex: construirIndiceCepBairro(idx, cepIndex), cache: new Map(),
            totalPontosPorMunicipio: { [cod]: chaves.reduce((s, k) => s + dic[k].length, 0) },
            centroideMunicipio: centroide(chaves.flatMap((k) => dic[k])),
          },
        };
      }
      const indice = await baixarJson(`${uf}/${cod}/index.json.gz`, hash["index.json.gz"]);
      const ruas = Object.create(null);
      const viasDaFatia = [];
      for (const k in indice.vias) { ruas[k] = NAO_CARREGADA; (viasDaFatia[indice.vias[k][0]] ??= []).push(k); }
      const cepBairro = {};
      for (const c in indice.ceps) if (indice.ceps[c][0]) cepBairro[c] = indice.ceps[c][0];
      return {
        cod, uf, indice, hash, ruas, viasDaFatia, fatiasCarregadas: new Set(),
        blocking: construirBlockingIndex({ [cod]: ruas })[cod],
        cepBairroIndex: { [cod]: cepBairro }, cache: new Map(),
      };
    })();
    municipios.set(cod, p);
    p.catch(() => municipios.delete(cod));
    while (municipios.size > maxMunicipios) municipios.delete(municipios.keys().next().value);
    return p;
  }

  async function carregarFatias(est, fatias) {
    const faltam = [...fatias].filter((f) => !est.fatiasCarregadas.has(f));
    await Promise.all(faltam.map(async (f) => {
      const nome = `f${String(f).padStart(3, "0")}.json.gz`;
      const parte = await baixarJson(`${est.uf}/${est.cod}/${nome}`, est.hash[nome]);
      for (const k in parte) est.ruas[k] = parte[k];
      est.fatiasCarregadas.add(f);
    }));
  }

  async function geocodificarEndereco(endereco, { municipio, bairro = "", cep = "" } = {}) {
    if (municipio == null) throw new Error("Candeia: informe { municipio } (código IBGE de 7 dígitos)");
    const est = await carregarMunicipio(municipio);
    const consulta = { codMunicipio: est.cod, enderecoCru: endereco, bairro, cepConsulta: cep };
    if (est.vazio) return geocodificar(consulta, {}, {});
    if (est.unico) return geocodificar(consulta, { [est.cod]: est.ruas }, est.opts);

    // Fatiado: as vias que o motor pode escolher são as resolvidas a partir das mesmas variantes
    // que ele tenta (via, via sem número, via estruturada, cruzamento), com o mesmo blocking.
    const q = extrairEntidades(endereco);
    const optsResolver = { blocking: { [est.cod]: est.blocking }, cache: est.cache };
    const fatias = new Set();
    for (const v of [q.via, q.viaSemNumero, q.viaEstruturada, q.viaCruzamento]) {
      if (!v) continue;
      const { viaKey } = est.ruas[v] ? { viaKey: v } : _resolverVia(v, est.ruas, est.cod, optsResolver);
      if (viaKey && est.indice.vias[viaKey]) fatias.add(est.indice.vias[viaKey][0]);
    }
    await carregarFatias(est, fatias);

    // O motor só usa pontos do CEP fora da via escolhida em dois casos: via não encontrada (#17) e
    // eixo da rua com bairro que não confere (#22). Primeiro roda sem eles; só nesses casos baixa as
    // fatias do CEP (se couberem) e roda de novo. Índice de CEP só com o CEP da consulta e só com
    // todas as fatias dele em memória: contagem parcial distorceria a regra de CEP genérico (#22).
    const cepNorm = String(cep || "").replace(/\D/g, "");
    const infoCep = cepNorm ? est.indice.ceps[cepNorm] : null;
    const cepCabe = !!infoCep && infoCep[2].length <= MAX_FATIAS_CEP;
    const rodar = () => {
      const cepIndex = { [est.cod]: {} };
      if (cepCabe && infoCep[2].every((f) => est.fatiasCarregadas.has(f))) {
        const pontos = [];
        for (const f of infoCep[2]) for (const k of est.viasDaFatia[f]) for (const e of est.ruas[k]) if (e.c === cepNorm) pontos.push(e);
        cepIndex[est.cod][cepNorm] = pontos;
      }
      return geocodificar(consulta, { [est.cod]: est.ruas }, {
        blocking: { [est.cod]: est.blocking }, cepIndex, cepBairroIndex: est.cepBairroIndex, cache: est.cache,
        totalPontosPorMunicipio: { [est.cod]: est.indice.entradas },
        centroideMunicipio: { lat: est.indice.centroide[0], lon: est.indice.centroide[1] },
      });
    };
    const r = rodar();
    const usariaCep = r.metodo === "falha" || (r.metodo === "eixo" && bairro && !r.bairroMatch);
    if (!cepCabe || !usariaCep || infoCep[2].every((f) => est.fatiasCarregadas.has(f))) return r;
    await carregarFatias(est, infoCep[2]);
    return rodar();
  }

  return {
    geocodificar: geocodificarEndereco,
    carregarMunicipio: (cod) => carregarMunicipio(cod).then(() => undefined),
    limparCache() { municipios.clear(); manifesto = null; },
  };
}

async function lerJson(bytes, sha256, url) {
  const gz = bytes[0] === 0x1f && bytes[1] === 0x8b;
  // Só dá para conferir o hash quando chegam os bytes do arquivo. Servidor que manda
  // Content-Encoding: gzip faz o fetch descomprimir antes; aí o hash não confere com o manifesto.
  if (sha256 && gz) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha256) throw new Error(`Candeia: hash de ${url} não confere com o manifesto`);
  }
  if (!gz) return JSON.parse(new TextDecoder().decode(bytes));
  const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(fluxo).text());
}
