// Portado do geo_core.js V2.2 do NEXO; mudanças do Candeia marcadas com "Candeia".
import { normalizeBase, ABREV, TIPOS_VIA, TIPOS_RODOVIA, ehCodigoRodovia } from "./normalizar.js";
import { extrairEntidades, _RE_QUADRA_EXT, _RE_LOTE_EXT, _extrairQLDeBairro } from "./extrair.js";
import { viaSimilarity, bairroSimilarity } from "./similaridade.js";
import { geomedoidComRaio, raioIncerteza, interpolarNumero, _haversine } from "./posicionar.js";
import { confiancaDe } from "./calibracao.js";

export const GATE_EXATO = 0.92; // via = "a mesma rua"
export const GATE_FORTE = 0.85; // rua encontrada → amarelo
export const GATE_FUZZY = 0.7;  // suspeita fraca → laranja; abaixo → vermelho
export const LOTE_ADJ   = 2;    // |diff| de lote para "ao lado"
// Candeia — eixo de rua com raio de incerteza acima disto não é amarelo: no benchmark, raio > 500 m
// concentra quase todo erro > 1 km (50% deles contra 1% com raio <= 500 m, endereços sem número).
export const RAIO_AMARELO_MAX = 500;
// Candeia — via achada por semelhança usa o ponto do número de porta, se ele existir nela: com nota
// >= GATE_FORTE sempre; entre GATE_FUZZY e GATE_FORTE só se bairro ou CEP também conferem.
// Candeia — verde exige que o número (ou quadra+lote) não se repita longe na mesma via.
export const RAIO_VERDE_MAX = 100;
export const RAIO_VERDE_LARANJA = 1000;

// #3 — Teto de cor por NV_GEO_COORD:
//   g=3 (estimada)    → no máximo azul  (coordenada não é a porta real)
//   g=4 (face quadra) → no máximo amarelo (precisão ~dezenas de metros)
export const G_COLOR_CAP    = { 3: "azul", 4: "amarelo" };
export const _COLOR_ORDER   = ["verde", "azul", "amarelo", "laranja", "vermelho"];

// #16 — Resolução de via extraída de geocodificar() pra ser reutilizável:
// precisamos rodar o MESMO algoritmo (exato → blocking fuzzy → varredura
// completa, com cache) tanto pra via principal quanto, em caso de falha,
// pra via de cruzamento de um endereço de esquina (ver chamada em
// geocodificar). Comportamento idêntico ao bloco original, só parametrizado.
export function _resolverVia(viaAlvo, ruas, codMunicipio, opts) {
  if (!viaAlvo) return { viaKey: null, viaScore: 0 };
  if (ruas[viaAlvo]) return { viaKey: viaAlvo, viaScore: 1 };

  const cache = opts.cache || null;
  const ck    = String(codMunicipio) + "|" + viaAlvo;
  if (cache && cache.has(ck)) return cache.get(ck);

  let viaKey = null, viaScore = 0;
  // 1) Candidatas via blocking (vias que compartilham >=1 token não-tipo)
  let candidatas = null;
  const bl = opts.blocking ? opts.blocking[String(codMunicipio)] : null;
  if (bl) {
    const set = new Set();
    for (const tok of viaAlvo.split(" ")) {
      // #11 — Consulta usa mesma exclusão de TIPOS_VIA/TIPOS_RODOVIA do índice
      if (!TIPOS_VIA.has(tok) && !TIPOS_RODOVIA.has(tok)) {
        const lst = bl[tok];
        if (lst) for (const v of lst) set.add(v);
      }
    }
    if (set.size) candidatas = [...set];
  }
  // 2) Avalia candidatas do blocking
  if (candidatas) {
    for (const key of candidatas) {
      const s = viaSimilarity(viaAlvo, key);
      if (s > viaScore) { viaScore = s; viaKey = key; }
    }
  }
  // 3) Fallback de segurança: via de 1 token com typo sem token compartilhado
  if (viaScore < GATE_FORTE) {
    for (const key in ruas) {
      const s = viaSimilarity(viaAlvo, key);
      if (s > viaScore) { viaScore = s; viaKey = key; }
    }
  }
  const resultado = { viaKey, viaScore };
  if (cache) cache.set(ck, resultado);
  return resultado;
}

// Candeia — `confianca`: P(erro <= 100 m) e P(erro > 1 km) da cor + faixa de raio deste
// resultado, medidas no benchmark (ver src/calibracao.js).
export function geocodificar(consulta, indiceMunicipios, opts = {}) {
  const r = _geocodificar(consulta, indiceMunicipios, opts);
  r.confianca = confiancaDe(r.status, r.raio);
  return r;
}

function _geocodificar(consulta, indiceMunicipios, opts) {
  const { codMunicipio, enderecoCru, bairro, cepConsulta } = consulta;
  const centMun = opts.centroideMunicipio || null;

  const falha = (status, motivo) => ({
    status, viaScore: 0, via: null, viaKey: null,
    quadra: null, lote: null, numero: null, km: null, ehRodovia: false,
    coord: centMun, raio: null, metodo: "falha", motivo, bairroMatch: false, cepMatch: false,
    candidatosNaRua: 0, _q: null,
  });

  const ruas = codMunicipio ? indiceMunicipios[String(codMunicipio)] : null;
  if (!ruas) return falha("vermelho", "Município não indexado");

  const q = extrairEntidades(enderecoCru);
  if (!q.via) return falha("vermelho", "Via não extraída da consulta");

  // Opção B: raio de outlier maior pra rodovia. `tipo` cobre "BR 153"/
  // "GO-070" (tipo="br"/"go") direto; primeiro token de `via` cobre
  // "Rodovia GO-070" (tipo="rodovia", mas o "go" sobra dentro do nome da via).
  // Candeia: o código no nome também marca rodovia quando o tipo é outro
  // ("Estrada RS 647", "Estrada BR 364": 8,4 M linhas do tipo ESTRADA no CNEFE),
  // e sigla só conta seguida de número ("Al. Santos" não é rodovia).
  const tokensVia = q.via ? q.via.split(" ") : [];
  const ehRodovia =
    TIPOS_RODOVIA.has(q.tipo) || q.tipo === "rodovia" || ehCodigoRodovia(tokensVia, 0);

  // #20 — Mesmo ABREV já usado pra via (jd→jardim, vl→vila, pq→parque...)
  // aplicado ao bairro: bairro informado abreviado ("JD BELA VISTA") nunca batia
  // bem com o nome por extenso do CNEFE ("jardim bela vista") porque o
  // classificador nem virava a mesma palavra — bairroSimilarity só tira o
  // classificador do núcleo quando os dois lados usam a MESMA grafia.
  let bairroNorm = normalizeBase(bairro || "");
  for (const [re, rep] of ABREV) bairroNorm = bairroNorm.replace(re, rep);
  const cepNorm  = String(cepConsulta || "").replace(/\D/g, "");

  // #19 — Ver _extrairQLDeBairro: campo Bairro preenchido com quadra/lote em
  // vez de nome de bairro. Reaproveita como quadra/lote (só quando o próprio
  // endereço não trouxe esse dado — nunca sobrescreve um valor real) e some
  // como bairro, já que não é um — comparar contra DSC_LOCALIDADE do CNEFE
  // só geraria "sem bom match" por um motivo sem sentido.
  let bairroReaproveitadoQL = false;
  if (bairroNorm) {
    _RE_QUADRA_EXT.lastIndex = 0;
    _RE_LOTE_EXT.lastIndex = 0;
    const pareceQL = _RE_QUADRA_EXT.test(bairroNorm) || _RE_LOTE_EXT.test(bairroNorm);
    _RE_QUADRA_EXT.lastIndex = 0;
    _RE_LOTE_EXT.lastIndex = 0;
    if (pareceQL) {
      const ql = _extrairQLDeBairro(bairroNorm);
      if (q.quadra == null && ql.quadra != null) { q.quadra = ql.quadra; bairroReaproveitadoQL = true; }
      if (q.lote == null && ql.lote != null) { q.lote = ql.lote; bairroReaproveitadoQL = true; }
      bairroNorm = "";
    }
  }

  // --- Resolução da via: O(1) exato → fuzzy com blocking + cache ---
  let { viaKey, viaScore } = _resolverVia(q.via, ruas, codMunicipio, opts);
  let cruzamentoUsado = false;

  // Candeia — número sem vírgula: fica com "via sem o último número + número de porta"
  // só quando isso casa melhor que a via inteira ("Rua Goias 125" → "goias", 125;
  // "Avenida T 63" continua "t 63" porque essa via existe).
  if (q.viaSemNumero && viaScore < 1) {
    const alt = _resolverVia(q.viaSemNumero, ruas, codMunicipio, opts);
    if (alt.viaKey && alt.viaScore >= GATE_EXATO && alt.viaScore > viaScore) {
      viaKey = alt.viaKey;
      viaScore = alt.viaScore;
      q.via = q.viaSemNumero;
      q.numero = q.numeroSemVirgula;
    }
  }

  // Candeia — via estruturada (DF, conjuntos): "QNN 25 CJ B CASA 47" → "qnn 25 conjunto b",
  // "SQS 308 BL C" → "sqs 308 bloco c", "QUADRA 37" → "quadra 37". Só quando a via extraída não
  // é uma chave do índice e a estruturada é (o fuzzy acha "sqs 308" para "sqs 308 c 101").
  if (q.viaEstruturada && viaScore < 1 && ruas[q.viaEstruturada]) {
    viaKey = q.viaEstruturada;
    viaScore = 1;
    q.via = q.viaEstruturada;
  }

  // #16 — Endereço de esquina ("Rua X esq. Rua Y" / "Rua X c/ Rua Y"): a via
  // do cruzamento vem à parte em q.viaCruzamento (extrairEntidades corta
  // antes do "esq"/"c/" pro bloco principal, mas guarda o que vem depois).
  // Se a via PRINCIPAL não bate em nada no índice, tenta o cruzamento antes
  // de desistir — um prédio de esquina geralmente tem coordenada indexada
  // por UMA das duas vias que o tocam, e usar a outra como proxy já é bem
  // melhor que cair direto no centróide do município inteiro.
  if ((!viaKey || viaScore < GATE_FUZZY) && q.viaCruzamento) {
    const alt = _resolverVia(q.viaCruzamento, ruas, codMunicipio, opts);
    if (alt.viaKey && alt.viaScore >= GATE_FUZZY) {
      viaKey = alt.viaKey;
      viaScore = alt.viaScore;
      cruzamentoUsado = true;
    }
  }

  // #17 — Nem a via principal nem o cruzamento bateram: antes de desistir
  // pro centróide do município (pino "perdido" a até dezenas de km do
  // endereço real), tenta qualquer ponto do MESMO CEP em QUALQUER via do
  // município. CEP no Brasil costuma ser granular por quadra/logradouro —
  // compartilhar CEP com uma rua vizinha sem nenhuma relação textual com o
  // nome informado (o caso que a similaridade de via não cobre) ainda é um
  // indício real de proximidade geográfica.
  if (!viaKey || viaScore < GATE_FUZZY) {
    if (cepNorm) {
      const porCep = [];
      const idxCep = opts.cepIndex ? opts.cepIndex[String(codMunicipio)] : null;
      if (idxCep && idxCep[cepNorm]) {
        porCep.push(...idxCep[cepNorm]);
      } else if (!opts.cepIndex) {
        // Sem índice pré-construído (uso avulso/testes): varredura completa.
        for (const via in ruas) {
          for (const c of ruas[via]) if (c.c === cepNorm) porCep.push(c);
        }
      }
      if (porCep.length) {
        const { coord: coordCep, raio: raioCep } = geomedoidComRaio(porCep, bairroNorm, q.quadra, false, null);
        if (coordCep) {
          return {
            status: "laranja",
            motivo: `Via não encontrada; ${porCep.length} ponto(s) do mesmo CEP (${cepNorm}) usado(s) como proxy`,
            viaScore: 0, viaKey: null,
            via: q.via, quadra: q.quadra, lote: q.lote, numero: q.numero, km: q.km,
            ehRodovia: false,
            coord: coordCep, raio: raioCep, metodo: "cep", bairroMatch: false, cepMatch: true,
            bairroIndexado: "", candidatosNaRua: porCep.length, _q: q,
          };
        }
      }
    }
    return falha("vermelho", `Via sem correspondência (max=${viaScore.toFixed(2)})`);
  }

  // Candeia — a chave de via não inclui o tipo: "Rua 1", "Avenida 1" e "Travessa 1" dividem a
  // mesma lista (16% a 26% dos pontos nas capitais medidas). Quando a consulta traz o tipo e ele
  // existe entre os candidatos, restringe a eles.
  let candidatos = ruas[viaKey];
  if (q.tipo && !TIPOS_RODOVIA.has(q.tipo)) {
    const mesmoTipo = candidatos.filter((c) => c.tp === q.tipo);
    if (mesmoTipo.length && mesmoTipo.length < candidatos.length) candidatos = mesmoTipo;
  }

  // --- Pré-filtro por bairro no desempate ---
  // Quando a consulta não tem nenhum sinal numérico (quadra/lote/número)
  // batendo com algum candidato, o nome da via sozinho pode corresponder a
  // trechos em bairros diferentes do mesmo município (rodovias, ruas
  // numeradas repetidas em loteamentos distintos, avenidas que cruzam
  // vários bairros...). Sem este filtro, o desempate abaixo decidia só por
  // densidade de pontos (bônus `k`, até 0.9) + precisão da coordenada
  // (`gBonus`, até 0.2) — juntos (até 1.1) superavam o bônus de bairro (1
  // ponto) e um trecho no bairro ERRADO vencia só por ter mais pontos
  // indexados. Essa é a causa raiz do sintoma "rua bate certo, bairro sai
  // errado". Aceita bairro por similaridade (não só igualdade exata) para
  // tolerar pequenas diferenças de grafia entre o bairro informado e
  // DSC_LOCALIDADE (CNEFE) — ex. abreviações, acentuação residual, etc.
  // #18 — bairroSimilarity em vez de jaroWinkler cru: ver nota na definição
  // da função — jaroWinkler sozinho deixava bairros diferentes com o mesmo
  // classificador genérico ("vila X" / "vila Y") passarem como se fossem o
  // mesmo, pelo bônus de prefixo comum.
  let poolDesempate = candidatos;
  let bairroInferidoPorCep = null;
  if (bairroNorm) {
    const temSinalNumerico = candidatos.some(
      (c) =>
        (q.quadra != null && c.q != null && q.quadra === c.q) ||
        (q.lote != null && c.l != null && q.lote === c.l) ||
        (q.numero != null && c.n != null && q.numero === c.n),
    );
    if (!temSinalNumerico) {
      const porBairro = candidatos.filter(
        (c) => c.b && bairroSimilarity(c.b, bairroNorm) >= 0.85,
      );
      if (porBairro.length) {
        poolDesempate = porBairro;
      } else if (cepNorm && opts.cepBairroIndex) {
        // #21 — Bairro declarado não bateu por texto em nada; antes de
        // abandonar o filtro, testa o bairro majoritário do CEP informado
        // (ver construirIndiceCepBairro) — só usa se esse bairro de fato
        // existir entre os candidatos desta via.
        const idxCB = opts.cepBairroIndex[String(codMunicipio)];
        const inferido = idxCB ? idxCB[cepNorm] : null;
        if (inferido) {
          const porCep = candidatos.filter((c) => c.b === inferido);
          if (porCep.length) { poolDesempate = porCep; bairroInferidoPorCep = inferido; }
        }
      }
    }
  }

  // --- Desempate dentro da rua ---
  let melhor = null, melhorPeso = -1;
  for (const c of poolDesempate) {
    const qMatch = q.quadra != null && c.q != null && q.quadra === c.q;
    const lMatch = q.lote   != null && c.l != null && q.lote   === c.l;
    const nMatch = q.numero != null && c.n != null && q.numero === c.n;
    const bMatch = !!(bairroNorm && c.b && bairroSimilarity(c.b, bairroNorm) >= 0.85);
    const cMatch = !!(cepNorm    && c.c && cepNorm    === c.c);
    let lAdj = false;
    if (!lMatch && q.lote != null && c.l != null) {
      const a = parseInt(q.lote, 10), b = parseInt(c.l, 10);
      if (!isNaN(a) && !isNaN(b)) lAdj = Math.abs(a - b) <= LOTE_ADJ;
    }
    // #3 — Menor g = mais preciso → bônus de desempate antes da densidade
    const gBonus = c.g ? Math.max(0, (5 - c.g) * 0.05) : 0;
    const peso =
      (qMatch ? 4 : 0) + (lMatch ? 4 : 0) + (nMatch ? 5 : 0) +
      (lAdj   ? 2 : 0) + (bMatch ? 1 : 0) + (cMatch ? 1 : 0) +
      gBonus +
      Math.min((c.k || 1) * 0.01, 0.9);
    if (peso > melhorPeso) {
      melhorPeso = peso;
      melhor = { c, qMatch, lMatch, nMatch, bMatch, cMatch, lAdj };
    }
  }

  // --- Decisão de cor ---
  // VERDE : via exata + (Q+L) ou número de porta
  // AZUL  : via exata + quadra confirmada
  // AMARELO: via forte, sem Q
  // LARANJA: via fuzzy >= GATE_FUZZY
  const exata = viaScore >= GATE_EXATO;
  const forte = viaScore >= GATE_FORTE;
  const m = melhor;
  let status, motivo;

  // Candeia — lote sem quadra identifica o imóvel quando a quadra está no próprio nome da via
  // (DF: "QNN 25 CONJUNTO B", lote 47) ou a via não tem quadras. Se o mesmo lote se repete longe na
  // via, o raio do verde (abaixo) rebaixa a cor.
  const loteSoQuadraNaVia = !m.nMatch && m.lMatch && q.quadra == null && m.c.q == null;
  if (exata && ((m.qMatch && m.lMatch) || m.nMatch || loteSoQuadraNaVia)) {
    status = "verde";
    motivo = m.nMatch ? "Via + número exato" : m.qMatch ? "Via + quadra + lote" : "Via + lote";
  } else if (exata && m.qMatch) {
    status = "azul";
    motivo = m.lMatch  ? "Via + quadra + lote parcial"
           : m.lAdj   ? "Via + quadra; lote adjacente"
           : m.cMatch ? "Via + quadra + CEP confirmado"
           :             "Via + quadra";
  } else if (forte) {
    status = "amarelo";
    motivo = "Via confirmada; sem quadra — eixo da rua";
  } else {
    status = "laranja";
    motivo = `Via similar (${viaScore.toFixed(2)}); confiança baixa`;
  }

  // #3 — Clamp de cor por NV_GEO_COORD do melhor candidato.
  // Evita ponto estimado/face de quadra aparecer como 🟢 "porta exata".
  const gBest = m.c.g || 1;
  const gCap  = G_COLOR_CAP[gBest];
  if (gCap) {
    const capIdx = _COLOR_ORDER.indexOf(gCap);
    const curIdx = _COLOR_ORDER.indexOf(status);
    if (curIdx < capIdx) {
      status = gCap;
      motivo += ` [coord ${gBest === 3 ? "estimada" : "face de quadra"}: teto ${gCap}]`;
    }
  }

  // #16 — Teto "laranja" quando a via usada foi o CRUZAMENTO, não a via
  // declarada no endereço: número/quadra/lote batendo contra os pontos da
  // via vizinha é coincidência, não confirmação real — nunca deixa passar
  // como verde/azul/amarelo só por isso.
  if (cruzamentoUsado) {
    const capIdx = _COLOR_ORDER.indexOf("laranja");
    if (_COLOR_ORDER.indexOf(status) < capIdx) status = "laranja";
    motivo = `Via "${q.via}" não encontrada; usando o cruzamento "${q.viaCruzamento}" como proxy — ${motivo}`;
  }

  // #19 — Transparência: quadra/lote confirmados vieram do campo Bairro
  // (que não era um bairro de verdade), não do endereço em si. O match em
  // si é legítimo (mesmo peso que quadra/lote vindos do endereço) — só
  // registra a origem incomum para quem lê o resultado entender a qualidade.
  if (bairroReaproveitadoQL) {
    motivo += " [quadra/lote reaproveitados do campo Bairro]";
  }
  if (bairroInferidoPorCep) {
    motivo += ` [bairro declarado não bateu; "${bairroInferidoPorCep}" inferido pelo CEP ${cepNorm}]`;
  }

  // --- Coordenada ---
  // Candeia — metodo diz de onde veio a coordenada (estável para quem consome; o motivo é texto livre).
  let coord, raio, metodo;
  if (status === "verde" || status === "azul") {
    // Coordenada direta do melhor candidato
    coord = { lat: m.c.la ?? m.c.lat, lon: m.c.lo ?? m.c.lon };
    if (status === "verde") {
      // Candeia — o mesmo número (ou quadra+lote) pode estar gravado em pontos distantes da mesma
      // chave de via (vias homônimas em localidades diferentes, ruído do CNEFE). O raio do verde é
      // a maior distância entre o ponto escolhido e os outros pontos com a mesma identificação.
      metodo = m.nMatch ? "numero" : m.qMatch ? "quadra_lote" : "lote";
      const iguais = poolDesempate.filter((c) => (m.nMatch
        ? c.n != null && c.n === q.numero
        : m.qMatch ? c.q != null && c.l != null && c.q === q.quadra && c.l === q.lote
        : c.l != null && c.l === q.lote));
      raio = 0;
      for (const c of iguais) raio = Math.max(raio, _haversine(coord.lat, coord.lon, c.la ?? c.lat, c.lo ?? c.lon));
      raio = Math.round(raio);
      // Medido no benchmark: verde com raio 0 erra > 1 km em 0,6%; com raio entre 100 m e 1 km
      // só 38% a 62% ficam a <= 100 m; acima de 1 km, 25% erram > 1 km (pior que o amarelo).
      if (raio > RAIO_VERDE_LARANJA) {
        status = "laranja";
        motivo += ` [mesma identificação em pontos a até ${raio} m: via homônima ou ruído do CNEFE]`;
      } else if (raio > RAIO_VERDE_MAX) {
        status = "amarelo";
        motivo += ` [mesma identificação em pontos a até ${raio} m]`;
      }
    } else {
      // azul também sai de verde rebaixado pelo teto de NV_GEO_COORD 3 (coordenada estimada)
      metodo = m.nMatch ? "numero" : m.qMatch && m.lMatch ? "quadra_lote" : "quadra";
      raio = raioIncerteza(coord, candidatos.filter((c) => c.q === q.quadra));
    }
  } else {
    metodo = "eixo";
    // #7 amarelo e #9 laranja: geomedoid para garantir ponto on-street.
    // Candeia — restringe ao CEP informado quando a via tem pontos nele (rua longa costuma
    // trocar de CEP por trecho): +0,7 a +1,9 ponto em <=100 m no benchmark.
    let pool = candidatos;
    if (cepNorm) {
      const mesmoCep = candidatos.filter((c) => c.c === cepNorm);
      if (mesmoCep.length) pool = mesmoCep;
    }
    // Candeia — a via casou só por semelhança (digitação: "Avenida Tpi" → "tupi"), mas o número de
    // porta (ou quadra e lote) existe nela: usa o ponto do número em vez do eixo. A cor continua a
    // da via (amarelo/laranja), porque o número pode coincidir numa rua errada.
    // Medido (rodada 9): digitação 71,4 → 73,7% até 100 m; sem exigir bairro/CEP abaixo de
    // GATE_FORTE, o cenário B piorava 0,1 ponto acima de 1 km.
    let porNumero = false;
    if (!exata && !cruzamentoUsado && (m.nMatch || (m.qMatch && m.lMatch)) &&
        (forte || m.bMatch || m.cMatch)) {
      coord = { lat: m.c.la ?? m.c.lat, lon: m.c.lo ?? m.c.lon };
      const iguais = poolDesempate.filter((c) => (m.nMatch ? c.n != null && c.n === q.numero
        : c.q != null && c.l != null && c.q === q.quadra && c.l === q.lote));
      raio = 0;
      for (const c of iguais) raio = Math.max(raio, _haversine(coord.lat, coord.lon, c.la ?? c.lat, c.lo ?? c.lon));
      raio = Math.round(raio);
      metodo = m.nMatch ? "numero" : "quadra_lote";
      motivo += " [número confere numa via achada por semelhança]";
      porNumero = true;
    }
    // Candeia — número que não está no índice: interpola entre os vizinhos do mesmo lado.
    let interp = null;
    // Só com a via casada exata: em via achada por semelhança (digitação, nome parecido) a
    // interpolação dava um ponto preciso na rua errada (71% acima de 1 km no benchmark).
    if (q.numero != null && !ehRodovia && !m.nMatch && exata && !cruzamentoUsado) {
      let poolInterp = pool;
      if (bairroNorm) {
        const fb = pool.filter((c) => c.b && bairroSimilarity(c.b, bairroNorm) >= 0.85);
        if (fb.length) poolInterp = fb;
      }
      interp = interpolarNumero(poolInterp, q.numero);
    }
    if (porNumero) {
      // coordenada já definida pelo ponto do número
    } else if (interp) {
      ({ coord, raio } = interp);
      metodo = "interpolacao";
      motivo = `Número interpolado entre ${interp.vizinhos[0]} e ${interp.vizinhos[1]}`;
    } else {
      ({ coord, raio } = geomedoidComRaio(pool, bairroNorm, q.quadra, ehRodovia, q.numero));
    }
    if (!coord) { coord = { lat: m.c.la ?? m.c.lat, lon: m.c.lo ?? m.c.lon }; raio = null; }
    if (status === "amarelo" && raio != null && raio > RAIO_AMARELO_MAX) {
      status = "laranja";
      motivo += ` [trecho extenso: raio de incerteza ~${raio} m]`;
    } else if (status === "amarelo" && raio == null) {
      // Candeia — menos de 3 pontos no trecho: a extensão da via é desconhecida (30% acima de 1 km
      // no benchmark, contra 2% a 4% do amarelo com raio conhecido).
      status = "laranja";
      motivo += " [poucos pontos indexados na via: extensão desconhecida]";
    }
  }

  // #22 — Via "passou" no score (amarelo/laranja) mas o bairro não bateu em
  // nada — nem por texto, nem pelo CEP restrito aos candidatos DESTA via
  // (#21 acima só ajuda quando a via certa tem pontos no bairro certo; se a
  // via em si está errada — ex.: uma rua não indexada que caiu em outra
  // só por prefixo comum — não tem ponto nenhum dela no bairro
  // declarado). Antes de aceitar, testa se o CEP informado tem alternativa
  // indexada em QUALQUER via cujo bairro majoritário bate com o declarado.
  // Município pequeno de interior costuma ter 1-2 CEPs cobrindo a cidade
  // inteira — aí "alternativa por CEP" só cairia perto do centro, pior que
  // a rua errada; por isso só usa quando o CEP for uma fração pequena do
  // total de pontos indexados do município (em cidade grande um CEP cobre
  // perto de 1% dos pontos; em cidade pequena de CEP único, quase 100%).
  const LIMIAR_CEP_GENERICO = 0.1;
  let bairroMatchFinal = m.bMatch;
  let bairroIndexadoFinal = m.c?.b || "";
  let candidatosNaRuaFinal = candidatos.length;
  // Candeia: só no eixo da rua; verde rebaixado por número repetido mantém o ponto do número.
  if ((status === "amarelo" || status === "laranja") && metodo === "eixo" && !m.bMatch &&
      cepNorm && bairroNorm && opts.cepIndex && opts.cepBairroIndex && opts.totalPontosPorMunicipio) {
    const pontosCep = ((opts.cepIndex[String(codMunicipio)] || {})[cepNorm]) || [];
    const totalMun  = opts.totalPontosPorMunicipio[String(codMunicipio)] || 0;
    const fracaoCep = totalMun ? pontosCep.length / totalMun : 1;
    if (pontosCep.length && fracaoCep <= LIMIAR_CEP_GENERICO) {
      const bairroGeralPorCep = ((opts.cepBairroIndex[String(codMunicipio)] || {})[cepNorm]) || null;
      if (bairroGeralPorCep && bairroSimilarity(bairroGeralPorCep, bairroNorm) >= GATE_FORTE) {
        const { coord: coordCep, raio: raioCep } = geomedoidComRaio(pontosCep, bairroNorm, q.quadra, false, null);
        if (coordCep) {
          coord = coordCep;
          raio = raioCep;
          metodo = "cep";
          status = "laranja";
          bairroMatchFinal = true;
          bairroIndexadoFinal = bairroGeralPorCep;
          candidatosNaRuaFinal = pontosCep.length;
          motivo = `Via "${viaKey}" aceita por score mas bairro não confere; ${pontosCep.length} ponto(s) do CEP ${cepNorm} (bairro "${bairroGeralPorCep}") usado(s) como proxy — ${motivo}`;
        }
      }
    }
  }

  return {
    status, motivo, viaScore, viaKey,
    via: q.via, quadra: q.quadra, lote: q.lote, numero: q.numero, km: q.km,
    ehRodovia,
    coord, raio, metodo: cruzamentoUsado ? "cruzamento" : metodo, bairroMatch: bairroMatchFinal, cepMatch: m.cMatch,
    bairroIndexado: bairroIndexadoFinal,
    candidatosNaRua: candidatosNaRuaFinal, _q: q,
  };
}
