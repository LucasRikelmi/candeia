// Benchmark do motor sobre o recorte gerado por pipeline/amostrar_benchmark.py.
//
// Uso:
//   node bench/rodar.mjs --dados <pasta com amostra.csv e dicionarios/> --saida <pasta> \
//        --motor candeia=src/index.js [--motor nexo=<outro src/index.js>] [--limite N]
//
// Para cada endereço sorteado do CNEFE monta consultas em variantes (limpa, sem vírgula,
// abreviada, com erro de digitação, sem bairro/CEP) e roda dois cenários:
//   A — o endereço está no índice (testa parser + casamento; é o caso comum, o CNEFE é um censo);
//   B — o ponto do endereço é retirado do índice (testa o fallback: vizinho, eixo da rua, CEP).
// Erro = distância haversine entre a coordenada devolvida e a do CNEFE. O gabarito vem da mesma
// base, então os números são otimistas por construção (ver README).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { hash, haversine, resumir, variantes, temNumero, complemento, lerCsv } from "./comum.mjs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- argumentos
const args = { motor: [] };
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, ""), v = process.argv[i + 1];
  if (k === "motor") args.motor.push(v); else args[k] = v;
}
if (!args.dados || !args.saida || !args.motor.length) {
  console.error("uso: node bench/rodar.mjs --dados D --saida S --motor nome=caminho/index.js [...]");
  process.exit(2);
}
const LIMITE = args.limite ? Number(args.limite) : Infinity;

function agrupar(res, chave) {
  const g = {};
  for (const x of res) (g[chave(x)] ??= []).push(x);
  return Object.fromEntries(Object.entries(g).sort().map(([k, v]) => [k, resumir(v)]));
}

// ---------------------------------------------------------------- execução
const motores = await Promise.all(args.motor.map(async (m) => {
  const [nome, caminho] = m.split("=");
  const mod = await import(pathToFileURL(resolve(caminho)).href);
  // Motor CommonJS (ex.: geo_core.js original do NEXO) chega como `default`.
  return { nome, G: mod.geocodificar ? mod : mod.default };
}));
const amostra = lerCsv(readFileSync(join(args.dados, "amostra.csv"), "utf8")).slice(0, LIMITE);
const porMun = {};
for (const r of amostra) (porMun[r.cod] ??= []).push(r);
const resultados = Object.fromEntries(motores.map((m) => [m.nome, []]));
const t0 = Date.now();

for (const [cod, linhas] of Object.entries(porMun)) {
  const dic = JSON.parse(gunzipSync(readFileSync(join(args.dados, "dicionarios", `${cod}.json.gz`))).toString("utf8"));
  for (const { nome, G } of motores) {
    const idx = { [cod]: dic };
    const keys = Object.keys(dic);
    const opts = {
      blocking: G.construirBlockingIndex(idx),
      // Motores mais antigos não têm índice de CEP: geocodificar cai na varredura própria.
      cepIndex: G.construirIndiceCep ? G.construirIndiceCep(idx) : undefined,
      cache: new Map(),
      totalPontosPorMunicipio: { [cod]: keys.reduce((s, k) => s + dic[k].length, 0) },
      centroideMunicipio: G.centroide(keys.flatMap((k) => dic[k])),
    };
    if (G.construirIndiceCepBairro) opts.cepBairroIndex = G.construirIndiceCepBairro(idx, opts.cepIndex);

    for (const r of linhas) {
      const lat = Number(r.lat), lon = Number(r.lon);
      const chave = G.entradaDeLinhaCnefe({ NOM_TITULO_SEGLOGR: r.titulo, NOM_SEGLOGR: r.nome, LATITUDE: r.lat,
        LONGITUDE: r.lon, NV_GEO_COORD: r.nv, COD_MUNICIPIO: cod })?.via;
      for (const cenario of ["A", "B"]) {
        // B: retira do índice (e do índice de CEP) os pontos com a coordenada do gabarito
        let restaurar = null;
        if (cenario === "B") {
          const lista = chave && dic[chave];
          const fora = lista ? lista.filter((e) => Math.abs(e.la - lat) < 1e-7 && Math.abs(e.lo - lon) < 1e-7) : [];
          if (!fora.length) continue; // ponto não está no índice com essa chave: não dá para fazer leave-one-out
          const sai = new Set(fora);
          const antes = { lista, cep: {}, bloco: {} };
          const resto = lista.filter((e) => !sai.has(e));
          if (resto.length) dic[chave] = resto;
          else {
            // via com um ponto só: some do índice (e do blocking), como se não existisse no CNEFE
            delete dic[chave];
            const bl = opts.blocking[cod];
            for (const tok of chave.split(" ")) {
              if (bl[tok] && !(tok in antes.bloco)) { antes.bloco[tok] = bl[tok]; bl[tok] = bl[tok].filter((v) => v !== chave); }
            }
          }
          for (const e of fora) {
            const arr = opts.cepIndex?.[cod]?.[e.c];
            if (arr && !(e.c in antes.cep)) { antes.cep[e.c] = arr; opts.cepIndex[cod][e.c] = arr.filter((x) => !sai.has(x)); }
          }
          opts.cache = new Map();
          restaurar = () => {
            dic[chave] = antes.lista;
            for (const t in antes.bloco) opts.blocking[cod][t] = antes.bloco[t];
            for (const c in antes.cep) opts.cepIndex[cod][c] = antes.cep[c];
            opts.cache = new Map();
          };
        }
        const vs = variantes(r);
        for (const [variante, q] of Object.entries(vs)) {
          if (cenario === "B" && variante !== "limpa") continue;
          let out;
          try {
            out = G.geocodificar({ codMunicipio: cod, enderecoCru: q.end, bairro: q.bairro, cepConsulta: q.cep }, idx, opts);
          } catch (e) {
            out = { status: "erro", coord: null, motivo: String(e) };
          }
          const c = out.coord;
          const dist = c && Number.isFinite(c.lat) ? haversine(lat, lon, c.lat, c.lon) : null;
          resultados[nome].push({ id: r.id, uf: r.uf, cod, porte: r.porte, com_numero: temNumero(r), cenario,
            variante, consulta: q.end, status: out.status, metodo: out.metodo ?? null, raio: out.raio ?? null, viaScore: out.viaScore ?? null, dist: dist == null ? null : Math.round(dist * 10) / 10 });
        }
        restaurar?.();
      }
      // N — rua que não existe no município: nome de via sorteado de outro município da amostra, com o
      // complemento deste endereço. O certo é vermelho (ou CEP). Mede o falso positivo do casamento fuzzy.
      const doador = amostra[hash(r.id + "|N") % amostra.length];
      const chaveDoador = doador.cod === cod ? null : G.entradaDeLinhaCnefe({ NOM_TITULO_SEGLOGR: doador.titulo,
        NOM_SEGLOGR: doador.nome, LATITUDE: doador.lat, LONGITUDE: doador.lon, NV_GEO_COORD: doador.nv, COD_MUNICIPIO: cod })?.via;
      if (chaveDoador && !dic[chaveDoador]) {
        const end = [doador.tipo, doador.titulo, doador.nome].filter(Boolean).join(" ") + complemento(r);
        let out;
        try { out = G.geocodificar({ codMunicipio: cod, enderecoCru: end, bairro: "", cepConsulta: "" }, idx, opts); }
        catch (e) { out = { status: "erro", coord: null }; }
        resultados[nome].push({ id: r.id, uf: r.uf, cod, porte: r.porte, com_numero: temNumero(r), cenario: "N",
          variante: "inexistente", consulta: end, status: out.status, metodo: out.metodo ?? null, raio: out.raio ?? null,
          viaScore: out.viaScore ?? null, viaKey: out.viaKey ?? null, dist: null });
      }
    }
  }
  process.stdout.write(`${cod} `);
}
console.log(`\n${amostra.length} endereços, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

// ---------------------------------------------------------------- relatórios
mkdirSync(args.saida, { recursive: true });
const relatorio = {};
for (const { nome } of motores) {
  const res = resultados[nome];
  const A = res.filter((x) => x.cenario === "A");
  relatorio[nome] = {
    geral: agrupar(res.filter((x) => x.cenario !== "N"), (x) => `${x.cenario} ${x.variante}`),
    por_cor_A: agrupar(A, (x) => x.status),
    por_cor_B: agrupar(res.filter((x) => x.cenario === "B"), (x) => x.status),
    por_cor_N: Object.fromEntries(Object.entries(Object.groupBy(res.filter((x) => x.cenario === "N"), (x) => x.status)).map(([k, v]) => [k, v.length])),
    por_uf_A_limpa: agrupar(A.filter((x) => x.variante === "limpa"), (x) => x.uf),
    por_porte_A_limpa: agrupar(A.filter((x) => x.variante === "limpa"), (x) => x.porte),
    por_numero_A_limpa: agrupar(A.filter((x) => x.variante === "limpa"), (x) => (x.com_numero ? "com número" : "sem número")),
    por_cor_sem_numero: agrupar(A.filter((x) => (x.variante === "limpa" && !x.com_numero) || x.variante === "numero_omitido"),
      (x) => `${x.variante === "limpa" ? "SN" : "omitido"} ${x.status}`),
  };
  writeFileSync(join(args.saida, `resultados_${nome}.json`), JSON.stringify(res));
}
if (motores.length === 2) {
  const [a, b] = motores.map((m) => m.nome);
  const chaveR = (x) => `${x.id}|${x.cenario}|${x.variante}`;
  const mb = new Map(resultados[b].map((x) => [chaveR(x), x]));
  const ok = (x) => x && x.dist != null && x.dist <= 100;
  const par = { ambos: 0, [`so_${a}`]: 0, [`so_${b}`]: 0, nenhum: 0 };
  for (const x of resultados[a]) {
    const y = mb.get(chaveR(x));
    par[ok(x) && ok(y) ? "ambos" : ok(x) ? `so_${a}` : ok(y) ? `so_${b}` : "nenhum"]++;
  }
  relatorio.pareado_ate_100m = par;
}
writeFileSync(join(args.saida, "relatorio.json"), JSON.stringify(relatorio, null, 1));
console.log(JSON.stringify(Object.fromEntries(motores.map((m) => [m.nome, relatorio[m.nome].geral])), null, 1));
if (relatorio.pareado_ate_100m) console.log("pareado (≤100 m):", relatorio.pareado_ate_100m);
