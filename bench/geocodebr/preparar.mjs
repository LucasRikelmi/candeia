// Monta a entrada do geocodebr a partir do recorte do benchmark, com as mesmas variantes do
// bench/rodar.mjs (cenário A), em campos separados, que é como o geocodebr recebe endereço.
//
// Uso: node bench/geocodebr/preparar.mjs --dados <pasta com amostra.csv> --saida entrada_geocodebr.csv
//
// Quadra e lote não têm campo no geocodebr: nesses endereços vai só o logradouro (é a diferença
// que o Candeia quer cobrir, e o resultado mostra quanto ela pesa).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lerCsv, variantes, temNumero, comErro } from "../comum.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.dados || !args.saida) { console.error("uso: node bench/geocodebr/preparar.mjs --dados D --saida S"); process.exit(2); }

const amostra = lerCsv(readFileSync(join(args.dados, "amostra.csv"), "utf8"));
const csv = (v) => (v == null || v === "" ? "" : /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const linhas = ["id,variante,cod,uf,logradouro,numero,cep,localidade"];
for (const r of amostra) {
  const vs = variantes(r); // só para saber quais variantes existem para este endereço
  const via = [r.tipo, r.titulo, r.nome].filter(Boolean).join(" ");
  const num = temNumero(r) ? r.num : "";
  const campos = {
    limpa: [via, num, r.cep, r.bairro],
    sem_bairro_cep: [via, num, "", ""],
    ...(vs.numero_omitido && { numero_omitido: [via, "", r.cep, r.bairro] }),
    ...(vs.digitacao && { digitacao: [[r.tipo, r.titulo, comErro(r.nome, r.id)].filter(Boolean).join(" "), num, r.cep, r.bairro] }),
  };
  for (const [variante, [lg, n, cep, loc]] of Object.entries(campos)) {
    linhas.push([r.id, variante, r.cod, r.uf, lg, n, cep, loc].map(csv).join(","));
  }
}
writeFileSync(args.saida, linhas.join("\n") + "\n");
console.log(`${linhas.length - 1} consultas em ${args.saida}`);
