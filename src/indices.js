// Portado do geo_core.js V2.2 do NEXO, sem mudança de comportamento.
import { normalizeBase, TIPOS_VIA, TIPOS_RODOVIA } from "./normalizar.js";

// ----------------------------------------------------------------------
// 5) MOTOR DE BUSCA + PONTUAÇÃO + COR
// ----------------------------------------------------------------------

// Índice de blocking por token: {cod: {token: [viaKeys]}}.
// Construa UMA vez após carregar o dicionário; passe em opts.blocking.
// #11 — Exclui tokens de TIPOS_VIA: "rua"/"avenida" aparecem em quase toda via
// e tornariam o set de candidatas ≈ município inteiro, anulando o ganho O(t·p).
// Também exclui TIPOS_RODOVIA ("br"/"go"/"mg") pelo mesmo motivo: são
// prefixo de código de rodovia, não parte do nome que identifica a via.
export function construirBlockingIndex(indiceMunicipios) {
  const bl = {};
  for (const cod in indiceMunicipios) {
    const m = {};
    for (const via in indiceMunicipios[cod]) {
      for (const tok of via.split(" ")) {
        if (tok && !TIPOS_VIA.has(tok) && !TIPOS_RODOVIA.has(tok)) (m[tok] ??= []).push(via);
      }
    }
    bl[cod] = m;
  }
  return bl;
}

// #17 — Índice cep→pontos por município: {cod: {cep: [entries]}}. Usado como
// fallback em geocodificar() quando NEM a via principal NEM o cruzamento
// (#16) batem em nada no CNEFE — compartilhar CEP com qualquer rua do
// município é melhor pista de proximidade do que o centróide inteiro.
// Construa UMA vez após carregar o dicionário (igual construirBlockingIndex)
// e passe em opts.cepIndex; sem ele, geocodificar cai numa varredura
// completa só na hora da falha (mais lento, mas ainda funciona).
export function construirIndiceCep(indiceMunicipios) {
  const idx = {};
  for (const cod in indiceMunicipios) {
    const porCep = {};
    for (const via in indiceMunicipios[cod]) {
      for (const entry of indiceMunicipios[cod][via]) {
        if (entry.c) (porCep[entry.c] ??= []).push(entry);
      }
    }
    idx[cod] = porCep;
  }
  return idx;
}

// #21 — Índice cep→bairro majoritário por município: {cod: {cep: bairro}}.
// Camada de validação/segurança: quando a via bate mas o bairro declarado
// não bate em nada por texto (nem direto nem por bairroSimilarity), em vez
// de simplesmente abandonar o filtro de bairro, testa se o CEP informado
// aponta — por maioria dos pontos indexados com aquele CEP — pra um bairro
// que de fato existe entre os candidatos da via. Não substitui a
// comparação textual; só entra quando ela falhou e ainda temos CEP.
export function construirIndiceCepBairro(indiceMunicipios, cepIndexPronto) {
  const cepIdx = cepIndexPronto || construirIndiceCep(indiceMunicipios);
  const idx = {};
  for (const cod in cepIdx) {
    const porCep = {};
    for (const cep in cepIdx[cod]) {
      const contagem = {};
      for (const entry of cepIdx[cod][cep]) {
        if (entry.b) contagem[entry.b] = (contagem[entry.b] || 0) + 1;
      }
      let melhor = null, melhorN = 0;
      for (const b in contagem) {
        if (contagem[b] > melhorN) { melhor = b; melhorN = contagem[b]; }
      }
      if (melhor) porCep[cep] = melhor;
    }
    idx[cod] = porCep;
  }
  return idx;
}

export function construirMapaMunicipio(pares) {
  const m = {};
  for (const [nome, cod] of pares) m[normalizeBase(nome)] = String(cod).trim();
  return m;
}
