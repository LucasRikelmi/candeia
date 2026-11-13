// Candeia — probabilidade de acerto por cor e faixa de raio, medida no benchmark
// (bench/calibrar.mjs gera calibracao_tabela.js). É a calibração do gabarito sintético: o CNEFE
// contra ele mesmo, com ruído de digitação simulado. Não substitui validação de campo.
import { CALIBRACAO } from "./calibracao_tabela.js";

export const FAIXAS_RAIO = [0, 50, 100, 250, 500, 1000];

export function faixaRaio(raio) {
  if (raio == null) return "?";
  for (const t of FAIXAS_RAIO) if (raio <= t) return `<=${t}`;
  return ">1000";
}

// { ate100m, acima1km, amostra } ou null quando a cor não tem célula medida.
export function confiancaDe(status, raio) {
  const c = CALIBRACAO[`${status}|${faixaRaio(raio)}`] || CALIBRACAO[status];
  return c ? { ate100m: c[0], acima1km: c[1], amostra: c[2] } : null;
}
