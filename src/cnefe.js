// Portado do geo_core.js V2.2 do NEXO, sem mudança de comportamento.
import { normalizeBase, normNum, extensoParaNumeral } from "./normalizar.js";

// ----------------------------------------------------------------------
// 3) EXTRAÇÃO DE ENTIDADES — LADO ETL (linha bruta do CNEFE)
//    Recebe um objeto com as colunas reais do CNEFE.
//
//    NV_GEO_COORD semântica oficial:
//      1 = coordenada original da base pública (porta exata)
//      2 = modificada (aptos empilhados no mesmo número)
//      3 = estimada (sem coord original ou coord inválida)
//      4 = face de quadra (~dezenas de metros)
//      5 = centróide de localidade   → NÃO indexar
//      6 = centróide de setor de coleta → NÃO indexar
// ----------------------------------------------------------------------

// #13 — Parser robusto para o bug de duplo ponto nas coordenadas do CNEFE.
// Exemplos: "-16.113.125" → -16.113125; "-47.948.869" → -47.948869.
// 4+ pontos = dado irreparável → NaN (será filtrado por isNaN).
export function parseCnefeLonLat(raw) {
  const s = String(raw || "").trim().replace(",", ".");
  const pts = s.split(".");
  if (pts.length === 1) return parseFloat(s);
  if (pts.length === 2) return parseFloat(s);
  if (pts.length === 3) return parseFloat(pts[0] + "." + pts[1] + pts[2]);
  return NaN; // 4+ pontos: dado inválido
}

// Extrai quadra e lote dos pares NOM_COMP_ELEMx / VAL_COMP_ELEMx (1–5).
// ATENÇÃO: NUM_QUADRA do CNEFE é a quadra do SETOR DE COLETA, não do endereço.
export function extrairCompCnefe(row) {
  let quadra = null, lote = null;
  for (let i = 1; i <= 5; i++) {
    const nome = String(row[`NOM_COMP_ELEM${i}`] || "").toUpperCase().trim();
    const val  = String(row[`VAL_COMP_ELEM${i}`] || "").trim();
    if (nome === "QUADRA" && quadra == null) quadra = normNum(val);
    if (nome === "LOTE"   && lote   == null) lote   = normNum(val);
  }
  return { quadra, lote };
}

// Constrói uma entrada de índice a partir de uma linha do CNEFE.
// Retorna null se a linha não deve ser indexada.
export function entradaDeLinhaCnefe(row) {
  const g = parseInt(row.NV_GEO_COORD, 10);

  // #3 — Descarta centróides de localidade (g=5) e setor de coleta (g=6).
  // Esses pontos ficam longe do endereço real e causam o sintoma "pino distante".
  // g=3 (estimada) e g=4 (face de quadra) são mantidos mas com clamp de cor em geocodificar.
  if (g >= 5) return null;

  const lat = parseCnefeLonLat(row.LATITUDE);
  const lon = parseCnefeLonLat(row.LONGITUDE);
  if (isNaN(lat) || isNaN(lon)) return null;

  // Nome da via: extenso → numeral + normalização
  const viaRaw = normalizeBase(
    [row.NOM_TITULO_SEGLOGR, row.NOM_SEGLOGR].filter(Boolean).join(" "),
  );
  const via = extensoParaNumeral(viaRaw).replace(/\s+/g, " ").trim();
  if (!via) return null;

  const tipo = normalizeBase(row.NOM_TIPO_SEGLOGR || "");

  const numBruto    = String(row.NUM_ENDERECO || "").trim();
  const modificador = String(row.DSC_MODIFICADOR || "").toUpperCase().trim();
  const numero =
    modificador === "SN" || numBruto === "0" || !numBruto ? null : normNum(numBruto);

  const { quadra, lote } = extrairCompCnefe(row);

  return {
    codMunicipio: String(row.COD_MUNICIPIO || "").trim(),
    via,
    entry: {
      tp: tipo,
      n:  numero,
      q:  quadra,
      l:  lote,
      b:  normalizeBase(row.DSC_LOCALIDADE || ""),
      c:  String(row.CEP || "").replace(/\D/g, ""),
      la: lat,
      lo: lon,
      g,  // NV_GEO_COORD 1–4 (5/6 descartados acima)
    },
  };
}

// Constrói o índice completo a partir de um array de linhas do CNEFE.
// Filtre COD_UF=52 e COD_MUNICIPIO (jurisdição) antes de chamar.
export function construirIndiceCnefe(linhasCnefe) {
  const idx = {};
  for (const row of linhasCnefe) {
    const r = entradaDeLinhaCnefe(row);
    if (!r || !r.via) continue;
    idx[r.codMunicipio] ??= {};
    (idx[r.codMunicipio][r.via] ??= []).push(r.entry);
  }
  return idx;
}
