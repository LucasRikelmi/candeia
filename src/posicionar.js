// Portado do geo_core.js V2.2 do NEXO. Candeia: geomedoidComRaio/raioIncerteza (raio de incerteza).
import { bairroSimilarity } from "./similaridade.js";

// Centroide ponderado (mantido para uso legado/externo).
export function centroide(lista) {
  let la = 0, lo = 0, w = 0;
  for (const e of lista) {
    const peso = e.k || 1;
    const a = e.la ?? e.lat, b = e.lo ?? e.lon;
    if (typeof a === "number" && typeof b === "number") {
      la += a * peso; lo += b * peso; w += peso;
    }
  }
  return w ? { lat: la / w, lon: lo / w } : null;
}

// #7 — Distância Haversine em metros.
export function _haversine(la1, lo1, la2, lo2) {
  const R  = 6371000;
  const φ1 = (la1 * Math.PI) / 180, φ2 = (la2 * Math.PI) / 180;
  const Δφ = ((la2 - la1) * Math.PI) / 180;
  const Δλ = ((lo2 - lo1) * Math.PI) / 180;
  const a  =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// #7 — Outlier: pontos a mais de OUTLIER_M da mediana são descartados.
// Ruas de cidades de GO raramente têm >1,5km de extensão contínua — mas essa
// premissa é falsa para rodovias, que se estendem por dezenas/centenas de
// km: um ponto correto em outro trecho da mesma BR/GO era descartado como
// outlier, jogando o pino num trecho errado. outlierParaVia() escolhe o
// raio certo por classe de via (Opção B do desenho de geolocalização).
export const OUTLIER_M = 1500;
export const OUTLIER_M_RODOVIA = 50000;
export function outlierParaVia(ehRodovia) {
  return ehRodovia ? OUTLIER_M_RODOVIA : OUTLIER_M;
}

// #7 — Geomedoid: ponto REAL do cluster mais próximo do centróide ponderado.
// Substitui a média ponderada pura, que pode cair fora da via em ruas
// longas, sinuosas ou com múltiplos clusters (ex.: ruas em "L").
//
// Fluxo: filtrar(bairro → km da rodovia → quadra) → remover outliers →
// centróide → medoid. ehRodovia (Opção B): usa OUTLIER_M_RODOVIA em vez do
// raio urbano — ver outlierParaVia(). numeroAlvo: número/km da consulta,
// usado só quando ehRodovia para aproximar o pool do trecho certo da via.
export function geomedoid(candidatos, bairroNorm, quadra, ehRodovia, numeroAlvo) {
  return _medoidDoPool(_poolGeomedoid(candidatos, bairroNorm, quadra, ehRodovia, numeroAlvo), ehRodovia);
}

// Candeia — mesma escolha de ponto do geomedoid, devolvendo também o raio de incerteza: o
// quantil 80% da distância entre o ponto escolhido e os pontos do pool (já filtrado por
// bairro/km/quadra). Endereço sem número cai no "eixo da rua", e o erro real é limitado pela
// extensão do trecho, não pelo motor. Medido no benchmark (docs/ARQUITETURA.md, PR #3): o erro
// fica abaixo do raio em ~80% dos casos e raio > 500 m concentra quase todo erro > 1 km.
// Pool com menos de RAIO_MIN_PONTOS pontos não diz a extensão da via: raio = null.
export const RAIO_QUANTIL = 0.8;
export const RAIO_MIN_PONTOS = 3;
export function geomedoidComRaio(candidatos, bairroNorm, quadra, ehRodovia, numeroAlvo) {
  const pool = _poolGeomedoid(candidatos, bairroNorm, quadra, ehRodovia, numeroAlvo);
  const coord = _medoidDoPool(pool, ehRodovia);
  return { coord, raio: coord ? raioIncerteza(coord, pool) : null, pontos: pool.length };
}

export function raioIncerteza(coord, pool) {
  if (!coord || pool.length < RAIO_MIN_PONTOS) return null;
  const ds = pool.map((c) => _haversine(coord.lat, coord.lon, c.la ?? c.lat, c.lo ?? c.lon)).sort((a, b) => a - b);
  return Math.round(ds[Math.floor(RAIO_QUANTIL * (ds.length - 1))]);
}

function _poolGeomedoid(candidatos, bairroNorm, quadra, ehRodovia, numeroAlvo) {
  // 1) Pool inicial: apenas candidatos com coordenadas válidas
  let pool = candidatos.filter((c) => {
    const la = c.la ?? c.lat, lo = c.lo ?? c.lon;
    return typeof la === "number" && typeof lo === "number";
  });
  // 2) Restringe por bairro (se disponível). Basta 1 candidato no bairro
  // informado para preferir esse subconjunto — exigir 2+ (como antes) fazia
  // bairros pequenos/novos com só 1 ponto indexado perderem o filtro e cair
  // de volta no pool inteiro da via, que pode atravessar vários bairros.
  // #18 — bairroSimilarity (não jaroWinkler/igualdade crua) pra não deixar
  // um classificador comum ("vila"/"jardim"/"setor"...) prender o pool a um
  // bairro errado só porque os nomes compartilham o prefixo.
  if (bairroNorm) {
    const fb = pool.filter((c) => c.b && bairroSimilarity(c.b, bairroNorm) >= 0.85);
    if (fb.length >= 1) pool = fb;
  }
  // 2b) Rodovia + km informado: restringe aos pontos indexados mais perto
  // do km da consulta ANTES do centróide/medoid. Sem isso, o centróide era
  // calculado sobre todo o pool filtrado por outlier (até 50km de via —
  // ver OUTLIER_M_RODOVIA), fazendo o pino pousar na média da rodovia
  // inteira no município em vez de perto do km pedido.
  if (ehRodovia && numeroAlvo != null) {
    const alvoNum = parseInt(numeroAlvo, 10);
    if (!isNaN(alvoNum)) {
      const comN = pool
        .map((c) => ({ c, n: parseInt(c.n, 10) }))
        .filter((x) => !isNaN(x.n));
      if (comN.length) {
        comN.sort((a, b) => Math.abs(a.n - alvoNum) - Math.abs(b.n - alvoNum));
        const menorDist = Math.abs(comN[0].n - alvoNum);
        const tolerancia = Math.max(menorDist * 1.5, 5);
        const perto = comN.filter((x) => Math.abs(x.n - alvoNum) <= tolerancia);
        pool = (perto.length ? perto : comN).map((x) => x.c);
      }
    }
  }
  // 3) Restringe por quadra (se disponível)
  if (quadra != null) {
    const fq = pool.filter((c) => c.q === quadra);
    if (fq.length >= 1) pool = fq;
  }
  return pool;
}

function _medoidDoPool(pool, ehRodovia) {
  if (!pool.length) return null;
  if (pool.length === 1)
    return { lat: pool[0].la ?? pool[0].lat, lon: pool[0].lo ?? pool[0].lon };

  // 4) Descarta outliers: pontos a > OUTLIER_M metros da mediana lat/lon
  const sortLat = pool.map((c) => c.la ?? c.lat).slice().sort((a, b) => a - b);
  const sortLon = pool.map((c) => c.lo ?? c.lon).slice().sort((a, b) => a - b);
  const medLat  = sortLat[Math.floor(sortLat.length / 2)];
  const medLon  = sortLon[Math.floor(sortLon.length / 2)];
  const raioOutlier = outlierParaVia(ehRodovia);
  const semOut  = pool.filter(
    (c) => _haversine(c.la ?? c.lat, c.lo ?? c.lon, medLat, medLon) <= raioOutlier,
  );
  const cluster = semOut.length >= 2 ? semOut : pool;

  // 5) Centróide ponderado do cluster filtrado
  let la = 0, lo = 0, w = 0;
  for (const c of cluster) {
    const peso = c.k || 1;
    la += (c.la ?? c.lat) * peso;
    lo += (c.lo ?? c.lon) * peso;
    w += peso;
  }
  const cLat = la / w, cLon = lo / w;

  // 6) Medoid = candidato real mais próximo do centróide (sempre on-street)
  let best = null, bestDist = Infinity;
  for (const c of cluster) {
    const d = _haversine(c.la ?? c.lat, c.lo ?? c.lon, cLat, cLon);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best ? { lat: best.la ?? best.lat, lon: best.lo ?? best.lon } : null;
}
