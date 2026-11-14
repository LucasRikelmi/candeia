// Gera src/calibracao_tabela.js a partir de um resultados_<motor>.json do bench/rodar.mjs.
//
// Uso: node bench/calibrar.mjs --resultados <resultados_candeia.json> [--saida src/calibracao_tabela.js]
//
// Para cada célula (cor × faixa de raio) mede a fração de respostas com erro <= 100 m e > 1 km.
// Todas as variantes e os dois cenários entram com o mesmo peso: a mistura real de entradas é
// desconhecida (ver docs/ARQUITETURA.md). Célula com menos de MIN_N linhas herda a da cor.
// Antes de gravar, valida fora da amostra: ajusta em metade dos municípios e mede na outra.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { faixaRaio } from "../src/calibracao.js";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.resultados) { console.error("uso: node bench/calibrar.mjs --resultados R [--saida S]"); process.exit(2); }
const SAIDA = args.saida || new URL("../src/calibracao_tabela.js", import.meta.url).pathname;
const MIN_N = 200;

// N (rua inexistente) não tem gabarito: fica fora da calibração.
const res = JSON.parse(readFileSync(args.resultados, "utf8")).filter((x) => x.cenario !== "N");
const ok = (x) => x.dist != null && x.dist <= 100;
const ruim = (x) => x.dist == null || x.dist > 1000;

function ajustar(linhas) {
  const cel = {}, cor = {};
  for (const x of linhas) {
    for (const [g, k] of [[cel, `${x.status}|${faixaRaio(x.raio)}`], [cor, x.status]]) {
      const c = (g[k] ??= [0, 0, 0]);
      c[0] += ok(x); c[1] += ruim(x); c[2]++;
    }
  }
  const p = ([a, b, n]) => [+(a / n).toFixed(3), +(b / n).toFixed(3), n];
  const tabela = {};
  for (const [k, c] of Object.entries(cor)) tabela[k] = p(c);
  for (const [k, c] of Object.entries(cel)) if (c[2] >= MIN_N) tabela[k] = p(c);
  return tabela;
}
const prever = (t, x) => t[`${x.status}|${faixaRaio(x.raio)}`] || t[x.status] || [0, 1, 0];

// Erro de calibração: média, ponderada por n, de |previsto − observado| por célula; e Brier.
function avaliar(t, linhas, soCor) {
  const g = {};
  let brier100 = 0, brier1k = 0;
  for (const x of linhas) {
    const [p100, p1k] = soCor ? (t[x.status] || [0, 1]) : prever(t, x);
    brier100 += (p100 - ok(x)) ** 2; brier1k += (p1k - ruim(x)) ** 2;
    const k = soCor ? x.status : `${x.status}|${faixaRaio(x.raio)}`;
    const c = (g[k] ??= { p100, p1k, o100: 0, o1k: 0, n: 0 });
    c.o100 += ok(x); c.o1k += ruim(x); c.n++;
  }
  let e100 = 0, e1k = 0;
  for (const c of Object.values(g)) { e100 += Math.abs(c.p100 - c.o100 / c.n) * c.n; e1k += Math.abs(c.p1k - c.o1k / c.n) * c.n; }
  const n = linhas.length;
  return { erro_calib_100m: +(100 * e100 / n).toFixed(2), erro_calib_1km: +(100 * e1k / n).toFixed(2),
    brier_100m: +(brier100 / n).toFixed(4), brier_1km: +(brier1k / n).toFixed(4) };
}

const metade = (cod) => parseInt(createHash("sha256").update(`calib|${cod}`).digest("hex").slice(0, 8), 16) % 2;
const validacao = {};
for (const f of [0, 1]) {
  const treino = res.filter((x) => metade(x.cod) === f), teste = res.filter((x) => metade(x.cod) !== f);
  const t = ajustar(treino);
  validacao[`dobra_${f}`] = { cor_e_raio: avaliar(t, teste, false), so_cor: avaliar(t, teste, true) };
}
console.log(JSON.stringify(validacao, null, 1));

const tabela = ajustar(res);
const municipios = new Set(res.map((x) => x.cod)).size;
const ordenada = Object.fromEntries(Object.entries(tabela).sort());
writeFileSync(SAIDA, `// GERADO por bench/calibrar.mjs — não editar à mão.
// Fonte: benchmark sintético (${res.length} respostas, ${municipios} municípios, gabarito = CNEFE 2022).
// chave "cor|faixa de raio" (ou só "cor") → [P(erro <= 100 m), P(erro > 1 km), n]
export const CALIBRACAO = ${JSON.stringify(ordenada, null, 1).replace(/\n\s*/g, " ")};
export const CALIBRACAO_VALIDACAO = ${JSON.stringify(validacao)};
`);
console.log(`gravado ${SAIDA}: ${Object.keys(tabela).length} células`);
