import * as G from "../src/index.js";
import * as T from "./fixtures/geo-town.js";

// Monta índice + opções exatamente como o playground do NEXO.
export function cidadeSintetica() {
  const { idx } = T.build();
  const keys = Object.keys(idx[T.COD]);
  const opts = {
    blocking: G.construirBlockingIndex(idx),
    cepIndex: G.construirIndiceCep(idx),
    cache: new Map(),
    totalPontosPorMunicipio: { [T.COD]: keys.reduce((s, k) => s + idx[T.COD][k].length, 0) },
    centroideMunicipio: G.centroide(keys.flatMap((k) => idx[T.COD][k])),
  };
  opts.cepBairroIndex = G.construirIndiceCepBairro(idx, opts.cepIndex);
  const geo = (enderecoCru, bairro = "", cepConsulta = "") =>
    G.geocodificar({ codMunicipio: T.COD, enderecoCru, bairro, cepConsulta }, idx, opts);
  return { idx, opts, geo };
}
