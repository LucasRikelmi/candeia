// Lê linhas do CNEFE (JSON em stdin) e imprime o resultado do ETL do motor (src/cnefe.js):
// [via, tp, n, q, l, b, c] ou null. Usado por test_gerar_indice.py para provar que o
// pipeline em Python/SQL gera exatamente as mesmas entradas que o motor.
import { entradaDeLinhaCnefe } from "../src/index.js";

let s = "";
for await (const c of process.stdin) s += c;
const out = JSON.parse(s).map((r) => {
  const e = entradaDeLinhaCnefe(r);
  return e ? [e.via, e.entry.tp, e.entry.n, e.entry.q, e.entry.l, e.entry.b, e.entry.c] : null;
});
process.stdout.write(JSON.stringify(out));
