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
