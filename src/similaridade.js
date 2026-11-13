// Portado do geo_core.js V2.2 do NEXO, sem mudança de comportamento.
// ----------------------------------------------------------------------
// 4) SIMILARIDADE (aplicada SOMENTE ao nome da via)
// ----------------------------------------------------------------------

export function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  if (!l1 || !l2) return 0;
  const dist = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    for (let j = Math.max(0, i - dist); j < Math.min(i + dist + 1, l2); j++) {
      if (!m2[j] && s1[i] === s2[j]) {
        m1[i] = m2[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let k = 0, t = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3;
  let p = 0;
  for (let i = 0; i < Math.min(4, l1, l2); i++) {
    if (s1[i] === s2[i]) p++;
    else break;
  }
  return jaro + p * 0.1 * (1 - jaro);
}

export function jaccardTokens(a, b) {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// #4 — Extrai número terminal de um nome de via normalizado.
// Usado para penalizar hard vias numéricas distintas ("rua 8" ≠ "rua 80").
// Sem \b antes do dígito (não "rua 8" apenas) — código de rua colado tipo
// "r2"/"r20"/"r44" também conta: letra e número são o mesmo "caractere de
// palavra" pro regex, então uma fronteira \b nunca existe entre eles, e sem
// essa mudança a extração falhava nesses casos (retornava null dos dois
// lados), deixando a guarda abaixo nunca disparar — JaroWinkler então dava
// score alto entre ruas numeradas DIFERENTES só por compartilharem prefixo
// (ex.: "r2" × "r20", "r4" × "r44"). Zero à esquerda normalizado pra não
// quebrar o caso oposto ("j016" × "j 16" é a mesma rua).
export function _terminalNum(s) {
  const m = s && s.match(/(\d+)\s*$/);
  return m ? m[1].replace(/^0+/, "") || "0" : null;
}

export function viaSimilarity(a, b) {
  if (!a || !b) return 0;
  // #4 — Se ambas terminam em número e os números diferem → incompatível.
  // Evita JaroWinkler atribuir 0.95+ entre "rua 8" e "rua 80" (prefixo idêntico).
  const na = _terminalNum(a), nb = _terminalNum(b);
  if (na !== null && nb !== null && na !== nb) return 0;
  return Math.max(jaccardTokens(a, b), jaroWinkler(a, b));
}

// #18 — Classificadores genéricos de bairro/loteamento são a causa de falso
// positivo mais cara do filtro de bairro: "vila nova" batia com "vila rica"
// (score acima do gate de 0.85) só porque os dois começam com "vila" — o
// bônus de prefixo do JaroWinkler infla o score entre bairros totalmente
// diferentes que só compartilham o classificador. Mesmo padrão observado
// repetidas vezes com "jardim ", "setor ", "parque ".
// "zona": "zona rural" × "zona urbana" (opostos) batiam como se fossem o
// mesmo bairro só pelo prefixo compartilhado.
export const BAIRRO_PREFIXOS = new Set([
  "setor", "vila", "jardim", "parque", "residencial", "distrito",
  "condominio", "loteamento", "chacara", "sitio", "povoado", "nucleo",
  "conjunto", "fazenda", "recanto", "colonia", "granja", "bairro", "cidade",
  "zona",
]);

// Remove até 2 tokens iniciais que sejam classificador genérico, isolando o
// "núcleo" do nome (ex.: "jardim bela vista" → "bela vista"). Comparar os
// núcleos em vez do nome cru evita o falso positivo do #18 acima.
export function _nucleoBairro(s) {
  let tokens = s.split(" ").filter(Boolean);
  let removidos = 0;
  while (tokens.length > 1 && removidos < 2 && BAIRRO_PREFIXOS.has(tokens[0])) {
    tokens = tokens.slice(1);
    removidos++;
  }
  return tokens.join(" ");
}

// Numeral romano (até X) no FINAL do nome → arábico — "Jardim Primavera I" e
// "Setor Jardim Primavera 1" são o mesmo loteamento, só com convenção diferente
// de numerar etapas/seções.
export const _ROMANO_PARA_NUM = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5",
  vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
};
export function _normalizarNumeralFinalBairro(s) {
  const tokens = s.split(" ");
  const ultimo = tokens[tokens.length - 1];
  if (_ROMANO_PARA_NUM[ultimo]) tokens[tokens.length - 1] = _ROMANO_PARA_NUM[ultimo];
  return tokens.join(" ");
}

export function bairroSimilarity(a, b) {
  if (!a || !b) return 0;
  const an = _normalizarNumeralFinalBairro(a);
  const bn = _normalizarNumeralFinalBairro(b);
  if (an === bn) return 1;
  const nucA = _nucleoBairro(an), nucB = _nucleoBairro(bn);
  if (!nucA || !nucB) return jaroWinkler(an, bn);
  if (nucA === nucB) return 1;
  // #18 — Truncamento: bairro vindo de cadastro costuma ter tamanho máximo de
  // campo (por volta de 30 caracteres) e chega cortado quando o nome é longo,
  // em pontos diferentes do mesmo nome. Prefixo comum longo o bastante (>=6) é forte
  // indício de ser o mesmo nome cortado, não bairros diferentes por coincidência.
  const curto = nucA.length <= nucB.length ? nucA : nucB;
  const longo = nucA.length <= nucB.length ? nucB : nucA;
  if (curto.length >= 6 && longo.startsWith(curto)) return 0.9;
  return Math.max(jaroWinkler(nucA, nucB), jaccardTokens(nucA, nucB));
}
