// Compara Candeia e geocodebr nas mesmas consultas (cenário A do benchmark).
//
// Uso: node bench/geocodebr/comparar.mjs --dados <pasta com amostra.csv> \
//        --geocodebr saida_geocodebr.csv --candeia <resultados_candeia.json de bench/rodar.mjs>
//
// Os dois usam o CNEFE 2022 e o gabarito também vem dele: os dois números são otimistas, e a
// comparação mede o que cada motor faz com a mesma entrada, não a acurácia no mundo real.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lerCsv, haversine, resumir, temNumero } from "../comum.mjs";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
if (!args.dados || !args.geocodebr || !args.candeia) {
  console.error("uso: node bench/geocodebr/comparar.mjs --dados D --geocodebr G.csv --candeia R.json"); process.exit(2);
}
const gab = new Map(lerCsv(readFileSync(join(args.dados, "amostra.csv"), "utf8")).map((r) => [r.id, r]));
const perfil = (r) => (temNumero(r) ? "com número" : r.quadra || r.lote ? "quadra/lote" : "sem número");

const G = lerCsv(readFileSync(args.geocodebr, "utf8"));
const col = (nomes) => Object.keys(G[0] || {}).find((k) => nomes.includes(k.toLowerCase()));
const cLat = col(["lat", "latitude"]), cLon = col(["lon", "long", "longitude"]), cPrec = col(["precisao"]);
if (!cLat || !cLon) { console.error("saída do geocodebr sem lat/lon; colunas:", Object.keys(G[0] || {})); process.exit(1); }

const geo = new Map();
for (const x of G) {
  const r = gab.get(x.id); if (!r) continue;
  const la = Number(x[cLat]), lo = Number(x[cLon]);
  const ok = x[cLat] !== "" && Number.isFinite(la) && Number.isFinite(lo);
  geo.set(`${x.id}|${x.variante}`, { id: x.id, variante: x.variante, perfil: perfil(r), precisao: cPrec ? x[cPrec] : "",
    dist: ok ? haversine(Number(r.lat), Number(r.lon), la, lo) : null });
}
const can = new Map();
for (const x of JSON.parse(readFileSync(args.candeia, "utf8"))) {
  if (x.cenario !== "A") continue;
  const k = `${x.id}|${x.variante}`;
  if (geo.has(k)) can.set(k, { ...x, perfil: perfil(gab.get(x.id)) });
}
const chaves = [...can.keys()];
console.log(`${chaves.length} consultas pareadas (geocodebr: ${geo.size} linhas lidas)\n`);

const linha = (rot, ks) => {
  const a = resumir(ks.map((k) => can.get(k))), b = resumir(ks.map((k) => geo.get(k)));
  console.log(`| ${rot} | ${ks.length} | ${a.ate_100m}% | ${b.ate_100m}% | ${a.acima_1km}% | ${b.acima_1km}% | ${a.mediana_m} | ${b.mediana_m} |`);
};
console.log("| grupo | n | ≤100 m Candeia | ≤100 m geocodebr | >1 km Candeia | >1 km geocodebr | mediana Candeia (m) | mediana geocodebr (m) |");
console.log("|---|---|---|---|---|---|---|---|");
const por = (f) => Object.entries(Object.groupBy(chaves, f)).sort();
for (const [v, ks] of por((k) => can.get(k).variante)) linha(v, ks);
for (const [p, ks] of por((k) => (can.get(k).variante === "limpa" ? `limpa, ${can.get(k).perfil}` : "_"))) if (p !== "_") linha(p, ks);

const ok = (x) => x.dist != null && x.dist <= 100;
const so = { candeia: 0, geocodebr: 0 };
for (const k of chaves) { const a = ok(can.get(k)), b = ok(geo.get(k)); if (a && !b) so.candeia++; if (b && !a) so.geocodebr++; }
console.log(`\nPareado (≤100 m em um e não no outro): só Candeia ${so.candeia}, só geocodebr ${so.geocodebr}`);
if (cPrec) {
  console.log("\ngeocodebr por precisão (variante limpa):");
  for (const [p, ks] of por((k) => (can.get(k).variante === "limpa" ? geo.get(k).precisao || "(vazio)" : "_"))) {
    if (p === "_") continue; const b = resumir(ks.map((k) => geo.get(k)));
    console.log(`  ${p}: n ${ks.length}, ≤100 m ${b.ate_100m}%, >1 km ${b.acima_1km}%`);
  }
}
