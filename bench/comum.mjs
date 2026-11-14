// Peças comuns aos benchmarks (bench/rodar.mjs e bench/ci.mjs).
import { createHash } from "node:crypto";

export const hash = (s) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16);

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

export function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const quantil = (xs, q) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

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

// ---------------------------------------------------------------- variantes de consulta
const ABREV_TIPO = { RUA: "R.", AVENIDA: "Av.", TRAVESSA: "Tv.", ALAMEDA: "Al.", PRACA: "Pça.",
  RODOVIA: "Rod.", ESTRADA: "Est.", QUADRA: "Qd." };
const ABREV_TITULO = { DOUTOR: "Dr.", DOUTORA: "Dra.", PROFESSOR: "Prof.", PROFESSORA: "Profa.",
  CORONEL: "Cel.", GOVERNADOR: "Gov.", PRESIDENTE: "Pres.", SENADOR: "Sen.", DEPUTADO: "Dep.",
  ENGENHEIRO: "Eng.", PADRE: "Pe.", MARECHAL: "Mal.", GENERAL: "Gal.", CAPITAO: "Cap." };

export const temNumero = (r) => r.num && r.num !== "0" && r.modificador !== "SN";

export function complemento(r) {
  if (temNumero(r)) return `, ${r.num}`;
  const ql = [r.quadra && `Qd ${r.quadra}`, r.lote && `Lt ${r.lote}`].filter(Boolean).join(" ");
  return ql ? `, ${ql}` : "";
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
