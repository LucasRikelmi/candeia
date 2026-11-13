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
import { createHash } from "node:crypto";
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

// ---------------------------------------------------------------- CSV (RFC 4180)
export function lerCsv(texto) {
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === ",") { linha.push(campo); campo = ""; }
    else if (ch === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; }
    else if (ch !== "\r") campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...corpo] = linhas;
  return corpo.map((l) => Object.fromEntries(cab.map((c, i) => [c, l[i] ?? ""])));
}

// ---------------------------------------------------------------- variantes de consulta
const ABREV_TIPO = { RUA: "R.", AVENIDA: "Av.", TRAVESSA: "Tv.", ALAMEDA: "Al.", PRACA: "Pça.",
  RODOVIA: "Rod.", ESTRADA: "Est.", QUADRA: "Qd." };
const ABREV_TITULO = { DOUTOR: "Dr.", DOUTORA: "Dra.", PROFESSOR: "Prof.", PROFESSORA: "Profa.",
  CORONEL: "Cel.", GOVERNADOR: "Gov.", PRESIDENTE: "Pres.", SENADOR: "Sen.", DEPUTADO: "Dep.",
  ENGENHEIRO: "Eng.", PADRE: "Pe.", MARECHAL: "Mal.", GENERAL: "Gal.", CAPITAO: "Cap." };

const hash = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);
const temNumero = (r) => r.num && r.num !== "0" && r.modificador !== "SN";

function complemento(r) {
  if (temNumero(r)) return `, ${r.num}`;
  const ql = [r.quadra && `Qd ${r.quadra}`, r.lote && `Lt ${r.lote}`].filter(Boolean).join(" ");
  return ql ? `, ${ql}` : "";
}

// Erro de digitação determinístico: troca, apaga ou duplica uma letra da maior palavra do nome.
export function comErro(nome, semente) {
  const palavras = nome.split(" ");
  let iw = 0;
  palavras.forEach((p, i) => { if (/^[A-Z]{4,}$/.test(p) && p.length > palavras[iw].length) iw = i; });
  const p = palavras[iw];
  if (!/^[A-Z]{4,}$/.test(p)) return null;
  const h = hash(semente), pos = 1 + (h % (p.length - 2)), op = (h >>> 8) % 3;
  const letra = "AEIOURSTNL"[(h >>> 12) % 10];
  palavras[iw] = op === 0 ? p.slice(0, pos) + letra + p.slice(pos + 1)
    : op === 1 ? p.slice(0, pos) + p.slice(pos + 1)
    : p.slice(0, pos) + p[pos] + p.slice(pos);
  return palavras.join(" ");
}

export function variantes(r) {
  const via = [r.tipo, r.titulo, r.nome].filter(Boolean).join(" ");
  const out = { limpa: { end: via + complemento(r), bairro: r.bairro, cep: r.cep } };
  if (temNumero(r)) out.sem_virgula = { end: `${via} ${r.num}`, bairro: r.bairro, cep: r.cep };
  // Quem digita costuma omitir o número; no CNEFE "sem número" é quase sempre rural (SN), outra população.
  if (temNumero(r)) out.numero_omitido = { end: via, bairro: r.bairro, cep: r.cep };
  const ab = [ABREV_TIPO[r.tipo] || r.tipo, ABREV_TITULO[r.titulo] || r.titulo, r.nome].filter(Boolean).join(" ");
  if (ab !== via) out.abreviada = { end: ab + complemento(r), bairro: r.bairro, cep: r.cep };
  const err = comErro(r.nome, r.id);
  if (err) out.digitacao = { end: [r.tipo, r.titulo, err].filter(Boolean).join(" ") + complemento(r), bairro: r.bairro, cep: r.cep };
  out.sem_bairro_cep = { end: out.limpa.end, bairro: "", cep: "" };
  return out;
}

// ---------------------------------------------------------------- métricas
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const quantil = (xs, q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

export function resumir(res) {
  const n = res.length, d = res.filter((x) => x.dist != null).map((x) => x.dist).sort((a, b) => a - b);
  const pct = (f) => (n ? +(100 * res.filter(f).length / n).toFixed(1) : null);
  return {
    n,
    respondeu: pct((x) => x.dist != null && x.status !== "vermelho"),
    mediana_m: quantil(d, 0.5) && Math.round(quantil(d, 0.5)),
    p90_m: quantil(d, 0.9) && Math.round(quantil(d, 0.9)),
    ate_25m: pct((x) => x.dist != null && x.dist <= 25),
    ate_50m: pct((x) => x.dist != null && x.dist <= 50),
    ate_100m: pct((x) => x.dist != null && x.dist <= 100),
    ate_200m: pct((x) => x.dist != null && x.dist <= 200),
    acima_1km: pct((x) => x.dist == null || x.dist > 1000),
    // raio de incerteza devolvido pelo motor (quando devolve): % de erros dentro dele e raio mediano
    com_raio: pct((x) => x.raio != null),
    erro_dentro_do_raio: (() => { const r = res.filter((x) => x.raio != null && x.dist != null);
      return r.length ? +(100 * r.filter((x) => x.dist <= Math.max(x.raio, 25)).length / r.length).toFixed(1) : null; })(),
    raio_mediano_m: (() => { const r = res.filter((x) => x.raio != null).map((x) => x.raio).sort((a, b) => a - b);
      return r.length ? quantil(r, 0.5) : null; })(),
  };
}
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
            variante, consulta: q.end, status: out.status, raio: out.raio ?? null, dist: dist == null ? null : Math.round(dist * 10) / 10 });
        }
        restaurar?.();
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
    geral: agrupar(res, (x) => `${x.cenario} ${x.variante}`),
    por_cor_A: agrupar(A, (x) => x.status),
    por_cor_B: agrupar(res.filter((x) => x.cenario === "B"), (x) => x.status),
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
