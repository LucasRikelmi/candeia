// Portado do geo_core.js V2.2 do NEXO; mudanças do Candeia marcadas com "Candeia".
import { normalizeBase, normNum, ABREV, normalizarPrefixoRodovia, TIPOS_VIA, ehCodigoRodovia, RUIDO_COMPLEMENTO, RE_COMPL_GLUED, _RE_COM_CRUZAMENTO, extensoParaNumeral } from "./normalizar.js";

// ----------------------------------------------------------------------
// 2) EXTRAÇÃO DE ENTIDADES — LADO RUNTIME (endereço digitado, "sujo")
// ----------------------------------------------------------------------

// #14 — Regexes de quadra/lote: prefixo de 1 letra (q/l) exige \s+
// para evitar falso-positivo. Ex.: "nivel5" não é lote 5.
// Versões com grupo de captura (extração) e sem (limpeza).
export const _RE_QUADRA_EXT   = /\b(?:quadra\s*|qd\s*|q\s+)0*([0-9]+[a-z]?)\b/g;
export const _RE_LOTE_EXT     = /\b(?:lote\s*|lt\s*|l\s+)0*([0-9]+[a-z]?(?:-[0-9]+)?)\b/g;
export const _RE_QUADRA_CLEAN = /\b(?:quadra\s*|qd\s*|q\s+)0*[0-9]+[a-z]?\b/g;
export const _RE_LOTE_CLEAN   = /\b(?:lote\s*|lt\s*|l\s+)0*[0-9]+[a-z]?(?:-[0-9]+)?\b/g;
// Km também precisa sair do bloco antes da tokenização da via — sem isso,
// "GO-222 KM 5,5" (onde a vírgula DECIMAL confunde a detecção da 1ª vírgula
// do endereço, truncando a base ali) deixava "km 5" vazar para dentro do
// nome da via extraído (ex.: via="go 222 km 5" em vez de "go 222").
// Cobre "km 5", "km 5,5", o caso já truncado "km 5" (vírgula virou espaço)
// e "km-5"/"km -5" (hífen entre "km" e o número, ex.: "RODOVIA GO-040 KM-28").
export const _RE_KM_CLEAN = /\bkm\.?[\s-]*[0-9]+(?:[.,\s][0-9]+)?\b/gi;

// Helper interno: extrai via normalizada de um bloco de texto já normalizado.
export function _extrairViaDeBloco(bloco) {
  let b = bloco
    .replace(_RE_QUADRA_CLEAN, " ")
    .replace(_RE_LOTE_CLEAN, " ")
    .replace(_RE_KM_CLEAN, " ")
    .replace(/\bs\s*\/?\s*n\b/g, " ")
    .replace(/\bsem numero\b/g, " ");
  _RE_QUADRA_CLEAN.lastIndex = 0;
  _RE_LOTE_CLEAN.lastIndex  = 0;
  _RE_KM_CLEAN.lastIndex    = 0;
  let tokens = b.split(/\s+/).filter(Boolean);
  tokens = tokens.filter((tok, i) => tok !== tokens[i - 1]);
  let tipo = null;
  if (tokens.length && (TIPOS_VIA.has(tokens[0]) || ehCodigoRodovia(tokens, 0))) {
    tipo = tokens[0];
    tokens = tokens.slice(1);
  }
  return { tipo, tokens };
}

// #19 — O campo bairro às vezes vem preenchido com quadra/lote em vez de nome de
// bairro de verdade (ex.: "QD 10 LT 05 SALA 2"). Comparar isso com um bairro de verdade
// nunca vai bater — mas o valor não é lixo, é quadra/lote que foi digitado
// no campo errado. geocodificar() reaproveita como sinal de desempate
// quando o próprio endereço não trouxe essa informação (ver uso).
export function _extrairQLDeBairro(bairroNorm) {
  let quadra = null, lote = null;
  bairroNorm.replace(_RE_QUADRA_EXT, (_, n) => { if (quadra == null) quadra = normNum(n); });
  _RE_QUADRA_EXT.lastIndex = 0;
  bairroNorm.replace(_RE_LOTE_EXT, (_, n) => { if (lote == null) lote = normNum(n); });
  _RE_LOTE_EXT.lastIndex = 0;
  return { quadra, lote };
}

// Captura {tipo, via, quadra, lote, numero, km} de uma string de endereço livre.
export function extrairEntidades(enderecoCru) {
  const cru = String(enderecoCru || "");

  // 1) Número da porta — posição canônica: primeiro token após a 1ª vírgula
  let numero = null;
  const idxVirg = cru.indexOf(",");
  if (idxVirg >= 0) {
    const pos = cru.slice(idxVirg + 1).trim().split(/[\s,]+/)[0] || "";
    if (/^\d{1,5}$/.test(pos)) numero = pos.replace(/^0+/, "") || "0";
  }

  // 1b) Km — endereço rural sem numeração urbana (ex.: "BR 153, KM 540, s/n",
  // "RODOVIA GO-222 KM 5,5"). Extraído do texto CRU (antes de normalizeBase,
  // que substituiria a vírgula decimal de "5,5" por espaço e destruiria o
  // valor). Convenção observada no CNEFE para rodovias: o Km costuma ser
  // gravado no próprio campo de número de porta — por isso vira fallback de
  // `numero` logo abaixo, reaproveitando o desempate por número (peso 5 em
  // geocodificar()) sem precisar de um critério novo no motor de pontuação.
  let km = null;
  const mKm = cru.match(/\bkm\.?[\s-]*(\d+(?:[.,]\d+)?)/i);
  if (mKm) km = mKm[1].replace(",", ".");

  // 2) Base = parte pré-vírgula (ou string inteira se não houver vírgula)
  let base = normalizeBase(idxVirg >= 0 ? cru.slice(0, idxVirg) : cru);
  for (const [re, rep] of ABREV) base = base.replace(re, rep);
  base = normalizarPrefixoRodovia(base);
  // #16 — Guarda o bloco do cruzamento (ao invés de só descartar) para servir
  // de via alternativa em geocodificar() quando a via principal não bate em
  // nada no índice — ver extração de viaCruzamento mais abaixo. "c/" não
  // exige espaço depois (é comum "C/RUA X" colado, sem
  // espaço após a barra) — "esq"/"esquina" continuam exigindo os dois
  // lados por extenso, pra não colidir com outra palavra no meio do nome.
  let partesCruzamento = base.split(/\s+(?:c\/\s*|esq\s+|esquina\s+)/);
  // Candeia — "Estrada Esquina Borges" (RS): "esquina" logo depois do tipo é parte do nome
  // (localidade), não marcador de cruzamento. Sem via antes do marcador, não há cruzamento.
  const antes = partesCruzamento[0].trim().split(/\s+/).filter(Boolean);
  if (partesCruzamento.length > 1 && antes.length <= 1 && (!antes.length || TIPOS_VIA.has(antes[0]))) {
    partesCruzamento = [base];
  }
  base = partesCruzamento[0];
  let blocoCruzamento = partesCruzamento[1] || null;

  // "com" bruto, sem "esq"/"esquina"/"c/" — só entra se o lado direito
  // começar com um tipo de via reconhecido (ver _RE_COM_CRUZAMENTO acima).
  if (!blocoCruzamento) {
    const mCom = base.match(_RE_COM_CRUZAMENTO);
    if (mCom) {
      base = mCom[1];
      blocoCruzamento = mCom[2];
    }
  }

  if (blocoCruzamento) {
    // Sobra de "esquina COM rua X" / "esq C rua X" (duplo marcador) — sem
    // isso "com"/"c" ficava na frente do bloco e o tipo da via ("rua"/
    // "avenida"...) nunca era reconhecido por só olhar o 1º token, vazando
    // pro nome extraído (ex.: viaCruzamento="rua 07" em vez de "07", que
    // não bate com a chave limpa do CNEFE).
    const RUIDO_CRUZAMENTO = new Set(["com", "c/", "c", "esq", "esquina"]);
    let tokensCruz = blocoCruzamento.split(/\s+/).filter(Boolean);
    while (tokensCruz.length > 1 && RUIDO_CRUZAMENTO.has(tokensCruz[0])) {
      tokensCruz = tokensCruz.slice(1);
    }
    blocoCruzamento = tokensCruz.join(" ");
  }

  // 3) Quadra e lote — de qualquer ponto da string
  let full = normalizeBase(cru);
  for (const [re, rep] of ABREV) full = full.replace(re, rep);
  full = normalizarPrefixoRodovia(full);

  let quadra = null;
  full.replace(_RE_QUADRA_EXT, (_, n) => { if (quadra == null) quadra = normNum(n); });
  _RE_QUADRA_EXT.lastIndex = 0;
  let lote = null;
  full.replace(_RE_LOTE_EXT, (_, n) => { if (lote == null) lote = normNum(n); });
  _RE_LOTE_EXT.lastIndex = 0;

  // #8 — Fallback: "N°10", "N 10", "Nº 10" sem vírgula (forma explícita de número)
  if (numero == null) {
    const mN = full.match(/\bn[°o.]?\s*(\d{1,5})\b/);
    if (mN) numero = mN[1].replace(/^0+/, "") || "0";
  }

  // Km como fallback de número — só quando não havia número real, nunca
  // sobrescreve endereço urbano legítimo (ex.: "Rua X, 45" mantém 45).
  if (numero == null && km != null) {
    const kmInt = Math.round(parseFloat(km));
    if (!isNaN(kmInt)) numero = String(kmInt);
  }

  // 4) Extrai tokens da via a partir da base pré-vírgula
  let { tipo, tokens } = _extrairViaDeBloco(base);

  // #15 — Fallback: endereço com Q/L antes da vírgula ("QUADRA 5 LOTE 3, RUA 8").
  // Se a base ficou vazia após limpeza, tenta a parte pós-vírgula como via.
  if (!tokens.length && idxVirg >= 0) {
    let altBase = normalizeBase(cru.slice(idxVirg + 1));
    for (const [re, rep] of ABREV) altBase = altBase.replace(re, rep);
    altBase = normalizarPrefixoRodovia(altBase);
    const alt = _extrairViaDeBloco(altBase);
    if (alt.tokens.length) { tipo = alt.tipo; tokens = alt.tokens; }
  }

  // Candeia — "esquina" logo depois do tipo é localidade ("Estrada Esquina Borges"), não ruído.
  const nomeComEsquina = tipo != null && tokens[0] === "esquina";
  const via0 = tokens
    .filter((tok) => (nomeComEsquina && tok === "esquina") || (!RUIDO_COMPLEMENTO.has(tok) && !RE_COMPL_GLUED.test(tok)))
    .join(" ")
    .trim();
  const via = extensoParaNumeral(via0);

  // #16 — Via do cruzamento ("Rua X esq Rua Y" → viaCruzamento = "rua y"),
  // mesmo tratamento (tipo fora, ruído fora, extenso→numeral) da via
  // principal. null quando o endereço não menciona cruzamento.
  let viaCruzamento = null;
  if (blocoCruzamento) {
    const alt = _extrairViaDeBloco(blocoCruzamento);
    const viaCruzamento0 = alt.tokens
      .filter((tok) => !RUIDO_COMPLEMENTO.has(tok) && !RE_COMPL_GLUED.test(tok))
      .join(" ")
      .trim();
    if (viaCruzamento0) viaCruzamento = extensoParaNumeral(viaCruzamento0);
  }

  // Candeia — número de porta sem vírgula ("Rua Goias 125"). Ambíguo com via que termina em
  // número ("Avenida T 63", "Rua 15"), então aqui só se propõe a alternativa; geocodificar()
  // fica com ela apenas se a via sem o número casar melhor no índice.
  let viaSemNumero = null, numeroSemVirgula = null;
  if (numero == null && km == null) {
    const tv = via.split(" ");
    if (tv.length >= 2 && /^\d{1,5}[a-z]?$/.test(tv[tv.length - 1])) {
      viaSemNumero = tv.slice(0, -1).join(" ");
      numeroSemVirgula = normNum(tv[tv.length - 1]);
    }
  }

  // Candeia — via "estruturada" (DF, condomínios, conjuntos habitacionais): o CNEFE grava a
  // quadra/conjunto/bloco no próprio nome do logradouro ("QNN 25 CONJUNTO B", "SQS 308 BLOCO C",
  // "QUADRA 37"), que a extração acima desmonta (quadra vira campo, bloco vira ruído). Aqui se
  // propõe a via com essas peças preservadas; geocodificar() só a usa se ela casar exato.
  const { via: viaEstruturada, lote: loteCasa } = _viaEstruturada(base);
  if (lote == null && loteCasa != null) lote = loteCasa;

  return { tipo, via, viaCruzamento, quadra, lote, numero, km, viaSemNumero, numeroSemVirgula,
    viaEstruturada: viaEstruturada && viaEstruturada !== via ? viaEstruturada : null };
}

const _ABREV_ESTRUTURA = [
  [/\b(?:conj|cj)\b/g, "conjunto"],
  [/\b(?:bl|blc)\b/g, "bloco"],
  [/\b(?:qd|qda)\b/g, "quadra"],
  [/\b(?:chac|ch)\b/g, "chacara"],
  [/\bae\b/g, "area especial"],
  [/\bcond\b/g, "condominio"],
];
// Complementos que não fazem parte do logradouro: unidade dentro do lote ou do prédio.
const _RE_UNIDADE = /\b(?:ap|apto|apartamento|sala|sl|loja|lj|andar|cobertura|kitnet|box)\s*[0-9]+[a-z]?\b/g;
// Tipos que fazem parte da chave estruturada ("quadra 37", "conjunto 5"); os outros saem do início.
const _TIPO_ESTRUTURA = new Set(["conjunto", "quadra", "chacara", "setor", "area", "modulo"]);
// Só propõe a via estruturada quando ela tem peça de estrutura seguida de identificador.
const _RE_ESTRUTURA = /\b(?:quadra|conjunto|bloco|chacara|area especial|q[a-z]{1,3})\s+[0-9a-z]+\b/;

export function _viaEstruturada(base) {
  let b = base;
  for (const [re, rep] of _ABREV_ESTRUTURA) b = b.replace(re, rep);
  // "casa N" no DF e em conjuntos é o lote; só vira lote quando o endereço não trouxe um.
  let lote = null;
  const mCasa = b.match(/\b(?:casa|cs)\s*0*([0-9]+[a-z]?)\b/);
  if (mCasa) lote = normNum(mCasa[1]);
  b = b
    .replace(/\b(?:casa|cs)\s*[0-9]+[a-z]?\b/g, " ")
    .replace(_RE_UNIDADE, " ")
    .replace(_RE_LOTE_CLEAN, " ")
    .replace(_RE_KM_CLEAN, " ")
    .replace(/\bs\s*\/?\s*n\b/g, " ")
    .replace(/\bsem numero\b/g, " ");
  _RE_LOTE_CLEAN.lastIndex = 0;
  _RE_KM_CLEAN.lastIndex = 0;
  let tokens = b.split(/\s+/).filter(Boolean);
  // "EDF" (tipo dos logradouros do DF no CNEFE) e tipos genéricos no início não entram na chave.
  while (tokens.length > 1 && (tokens[0] === "edf" || (TIPOS_VIA.has(tokens[0]) && !_TIPO_ESTRUTURA.has(tokens[0])))) {
    tokens = tokens.slice(1);
  }
  const v = extensoParaNumeral(tokens.join(" ").trim());
  return { via: _RE_ESTRUTURA.test(v) ? v : null, lote };
}
