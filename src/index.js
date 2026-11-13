// API pública do Candeia (fase 0: porte fiel do motor do NEXO).
export {
  normalizeBase, normNum, extensoParaNumeral, EXTENSO_PARA_NUM,
  TIPOS_VIA, TIPOS_RODOVIA, SIGLAS_UF, ehCodigoRodovia, ABREV,
} from "./normalizar.js";
export { extrairEntidades } from "./extrair.js";
export {
  parseCnefeLonLat, extrairCompCnefe, entradaDeLinhaCnefe, construirIndiceCnefe,
} from "./cnefe.js";
export { jaroWinkler, jaccardTokens, viaSimilarity, bairroSimilarity } from "./similaridade.js";
export {
  construirBlockingIndex, construirIndiceCep, construirIndiceCepBairro, construirMapaMunicipio,
} from "./indices.js";
export {
  centroide, geomedoid, geomedoidComRaio, raioIncerteza, _haversine, OUTLIER_M, OUTLIER_M_RODOVIA,
  RAIO_QUANTIL, RAIO_MIN_PONTOS,
} from "./posicionar.js";
export {
  geocodificar, GATE_EXATO, GATE_FORTE, GATE_FUZZY, LOTE_ADJ, G_COLOR_CAP, RAIO_AMARELO_MAX, RAIO_VERDE_MAX, RAIO_VERDE_LARANJA,
} from "./geocodificar.js";
export { confiancaDe, faixaRaio, FAIXAS_RAIO } from "./calibracao.js";
export { CALIBRACAO, CALIBRACAO_VALIDACAO } from "./calibracao_tabela.js";
