// API pública do Candeia (fase 0: porte fiel do motor do NEXO).
export {
  normalizeBase, normNum, extensoParaNumeral, EXTENSO_PARA_NUM,
  TIPOS_VIA, TIPOS_RODOVIA, ABREV,
} from "./normalizar.js";
export { extrairEntidades } from "./extrair.js";
export {
  parseCnefeLonLat, extrairCompCnefe, entradaDeLinhaCnefe, construirIndiceCnefe,
} from "./cnefe.js";
export { jaroWinkler, jaccardTokens, viaSimilarity, bairroSimilarity } from "./similaridade.js";
export {
  construirBlockingIndex, construirIndiceCep, construirIndiceCepBairro, construirMapaMunicipio,
} from "./indices.js";
export { centroide, geomedoid, _haversine, OUTLIER_M, OUTLIER_M_RODOVIA } from "./posicionar.js";
export {
  geocodificar, GATE_EXATO, GATE_FORTE, GATE_FUZZY, LOTE_ADJ, G_COLOR_CAP,
} from "./geocodificar.js";
