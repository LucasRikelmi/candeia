// Portado do geo_core.js V2.2 do NEXO, sem mudança de comportamento.
// ----------------------------------------------------------------------
// 0) EXTENSO ↔ NUMERAL
//    CNEFE escreve nomes de via por extenso: "RUA OITO" = Rua 8.
//    Esta função converte extenso → numeral e deve ser aplicada no ETL
//    ao campo NOM_SEGLOGR ANTES de indexar.
// ----------------------------------------------------------------------

export const _UN  = ["", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"];
export const _DEZ = {
  10: "dez", 11: "onze", 12: "doze", 13: "treze", 14: "quatorze",
  15: "quinze", 16: "dezesseis", 17: "dezessete", 18: "dezoito", 19: "dezenove",
};
export const _TEN = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
export const _CEN = ["", "cem", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

// Mapa extenso→numeral (0–999). Populado uma vez abaixo.
export const EXTENSO_PARA_NUM = {};

(function _buildExtMap() {
  function _n(n) {
    if (n === 0) return "zero";
    let parts = [];
    const c = Math.floor(n / 100), r = n % 100;
    if (c > 0) parts.push(c === 1 && r > 0 ? "cento" : _CEN[c]);
    if (r > 0) {
      if (r < 10) parts.push(_UN[r]);
      else if (r < 20) parts.push(_DEZ[r]);
      else {
        const t = Math.floor(r / 10), u = r % 10;
        parts.push(_TEN[t]);
        if (u > 0) parts.push(_UN[u]);
      }
    }
    return parts.join(" e ");
  }
  for (let i = 1; i <= 999; i++) EXTENSO_PARA_NUM[_n(i)] = String(i);
})();

// Lista ordenada por comprimento (composto antes do simples) e guard de stem.
export const _EXTENSO_ORDENADO = Object.keys(EXTENSO_PARA_NUM).sort((a, b) => b.length - a.length);
export const _STEMS_NUM = new Set();
for (const k of Object.keys(EXTENSO_PARA_NUM))
  for (const tok of k.split(" ")) if (tok !== "e") _STEMS_NUM.add(tok);
export const _RE_STEM = new RegExp(
  "\\b(" + [..._STEMS_NUM].sort((a, b) => b.length - a.length).join("|") + ")\\b",
);

// #5 — Pre-computa regexes com \b para evitar colisões parciais:
//   "nove" não vira "9" dentro de "novembro"; "dez" não vira "10" em "dezembro".
//   Espaços do extenso tornam-se \s+ para tolerar normalização variável.
export const _EXTENSO_REGEXES = _EXTENSO_ORDENADO.map((ext) => [
  new RegExp("\\b" + ext.replace(/\s+/g, "\\s+") + "\\b", "g"),
  EXTENSO_PARA_NUM[ext],
]);

// Converte número por extenso em numeral dentro de uma string normalizada.
// Ex.: "sessenta e oito" → "68". GUARD: só roda se houver stem de número.
// Aplicada no ETL (NOM_SEGLOGR) E no runtime (via da consulta) — simetria.
export function extensoParaNumeral(texto) {
  if (!_RE_STEM.test(texto)) return texto; // caminho rápido (maioria das vias)
  let t = texto;
  for (const [re, num] of _EXTENSO_REGEXES) {
    t = t.replace(re, num);
  }
  return t.replace(/\s+/g, " ").trim();
}

// ----------------------------------------------------------------------
// 1) NORMALIZAÇÃO BASE
// ----------------------------------------------------------------------

export const TIPOS_VIA = new Set([
  "rua", "avenida", "alameda", "travessa", "praca", "rodovia", "via",
  "estrada", "area", "viela", "conjunto", "modulo", "setor",
  "primeira", "segunda", "terceira", "quarta", "quinta",
  // Prefixos de topônimo informal que antecedem o nome real da via
  "favela", "comunidade", "nucleo", "gleba", "loteamento", "residencial",
  "sitio", "chacara", "fazenda", "assentamento",
  // Candeia — tipos rurais e locais frequentes no CNEFE (erros do benchmark concentrados neles)
  "linha", "ramal", "vicinal", "beco", "acesso", "travessao", "ladeira", "largo", "caminho",
  // Candeia — demais tipos do CNEFE com ≥0,05% das entradas (medido no recorte do benchmark,
  // 2026-11-14). De fora por serem também começo de nome comum: vila, rio, alto, ilha, lago, bairro.
  "servidao", "povoado", "aldeia", "escadaria", "passagem", "passarela", "corrego", "igarape",
  "entrada", "condominio", "distrito", "corredor",
  // Candeia — "EDF" é o tipo dos logradouros do DF no CNEFE ("EDF QNN 25 CONJUNTO B")
  "edf",
]);

// Prefixos de rodovia (código da via, não nome) — "BR-153"/"GO-070" devem
// virar tipo="br"/"go" + via="153"/"070", do mesmo jeito que "rodovia"/
// "avenida" já viram `tipo` e saem do nome da via. Sem isso, "br-153"
// sobrevivia como um token único colado, que não batia com o jeito que o
// CNEFE tokeniza a mesma via (ex.: "br" + "153" separados), derrubando o
// blocking por token e forçando fallback de varredura completa em toda
// consulta de rodovia.
//
// Candeia: generalizado de br/go/mg para BR + as 27 siglas de UF. Medido no
// CNEFE 2022 (pipeline/medir_rodovias.py, 2026-11-13): BR aparece nas 27 UFs e
// cada UF usa a própria sigla (às vezes a de UF vizinha). Várias siglas colidem
// com palavras e abreviações ("al" = alameda, "es", "se", "to", "pa", "ma"),
// então uma sigla só conta como rodovia quando vem SEGUIDA DE NÚMERO de 2 a 3
// dígitos (ver ehCodigoRodovia). Prefixos estaduais próprios (RST, ERS, VRS,
// LMG, MGT, PRT, ICR...) ainda não estão cobertos.
export const SIGLAS_UF = [
  "ac", "al", "am", "ap", "ba", "ce", "df", "es", "go", "ma", "mg", "ms", "mt", "pa",
  "pb", "pe", "pi", "pr", "rj", "rn", "ro", "rr", "rs", "sc", "se", "sp", "to",
];
export const TIPOS_RODOVIA = new Set(["br", ...SIGLAS_UF]);

// true quando tokens[i] é sigla de rodovia e tokens[i+1] é o número da rodovia.
export function ehCodigoRodovia(tokens, i = 0) {
  return TIPOS_RODOVIA.has(tokens[i]) && /^\d{2,3}$/.test(tokens[i + 1] || "");
}

// Normaliza "br-153" / "br153" / "BR 153" → sempre "br 153" (espaço único),
// para que tokenização, blocking e comparação exata funcionem igual
// independente de como a consulta ou o CNEFE grafou o hífen. Roda depois de
// ABREV (que já expandiu "rod"→"rodovia") e antes de _extrairViaDeBloco.
export const RE_PREFIXO_RODOVIA = new RegExp(`\\b(${[...TIPOS_RODOVIA].join("|")})[\\s-]*(\\d{2,3})\\b`, "g");
export function normalizarPrefixoRodovia(texto) {
  return texto.replace(RE_PREFIXO_RODOVIA, "$1 $2");
}

export const RUIDO_COMPLEMENTO = new Set([
  "sl", "sala", "salas", "casa", "cs", "galpao", "gp", "mod", "modulo",
  "andar", "bloco", "bl", "ap", "apto", "apartamento", "esq", "esquina",
  "com", "ex", "primario", "fundos", "frente", "portao", "sobrado", "sobreloja",
]);

export const RE_COMPL_GLUED = /^(?:sl|cs|sala|casa|gp|galpao|mod|bl|ap|apto|loja|lj|suite)\d*$/;

export const ABREV = [
  [/\bav\b/g,  "avenida"],
  [/\brod\b/g, "rodovia"],
  [/\btv\b/g,  "travessa"],
  [/\bvl\b/g,  "vila"],
  [/\bjd\b/g,  "jardim"],
  [/\bpq\b/g,  "parque"],
  [/\bpca\b/g, "praca"],
  // Candeia — abreviações de tipo e de título medidas no benchmark (variante "abreviada").
  // "r" e "al" só no início: "Rua R 5" e "AL 101" (rodovia) não podem virar "rua"/"alameda".
  [/^r\b/g,   "rua"],
  [/^al\b(?![\s-]*\d)/g, "alameda"],
  [/^est\b/g, "estrada"],
  [/\bdr\b/g,  "doutor"],
  [/\bdra\b/g, "doutora"],
  [/\bprof\b/g, "professor"],
  [/\bprofa\b/g, "professora"],
  [/\bcel\b/g, "coronel"],
  [/\bgov\b/g, "governador"],
  [/\bpres\b/g, "presidente"],
  [/\bsen\b(?!\s+denominacao)/g, "senador"], // CNEFE grafa "SEN DENOMINACAO" (sem denominação)
  [/\bdep\b/g, "deputado"],
  [/\beng\b/g, "engenheiro"],
  [/\bmal\b/g, "marechal"],
  [/\bgal\b/g, "general"],
];

// "X COM Y" como marcador de cruzamento sem "esq"/"esquina"/"c/" — só conta
// quando a palavra logo depois de "com" também é um tipo de via reconhecido
// (ex.: "RUA DAS FLORES COM AVENIDA BRASIL"). Sem essa guarda, "com"
// é preposição comum demais (ex.: um complemento "sala com garagem") e
// geraria falso positivo de cruzamento.
export const _RE_COM_CRUZAMENTO = new RegExp(
  `^(.*?)\\s+com\\s+((?:${[...TIPOS_VIA].join("|")})\\b.*|(?:${[...TIPOS_RODOVIA].join("|")})[\\s-]*\\d{2,3}\\b.*)$`,
);

export function normalizeBase(texto) {
  if (!texto) return "";
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normaliza número de Q/L: "05"→"5", "510"→"510", "36a"→"36a".
export function normNum(raw) {
  if (raw == null) return null;
  const m = String(raw).toLowerCase().match(/^0*([0-9]+[a-z]?)/);
  return m ? m[1] : null;
}
