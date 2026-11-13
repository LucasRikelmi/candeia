// Cidade sintética (portada do playground do NEXO em lucasrikelmi.dev).
// Gera um índice no mesmo formato do ETL: { codMunicipio: { via: [pontos] } }.
// Ruas, quadras, CEPs e coordenadas são fictícios.
export const COD = "9999999";
const LAT0 = -16.7, LON0 = -49.1; // âncora arbitrária
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const toLL = (x, y) => ({ la: +(LAT0 - y / M_LAT).toFixed(7), lo: +(LON0 + x / M_LON).toFixed(7) });

// Ruas horizontais (y em metros) e verticais (x em metros)
const H = [
  { key: "3", name: "Rua 3", y: 0 },
  { key: "5", name: "Rua 5", y: 160 },
  { key: "8", name: "Rua 8", y: 320 },
  { key: "10", name: "Rua 10", y: 480 },
  { key: "12", name: "Rua 12", y: 640 },
  { key: "15", name: "Rua 15", y: 800 },
];
const V = [
  { key: "brasil", name: "Av. Brasil", x: 0, tp: "avenida" },
  { key: "das flores", name: "Rua das Flores", x: 220, tp: "rua", g: 4 },
  { key: "goias", name: "Av. Goiás", x: 440, tp: "avenida" },
  { key: "68", name: "Rua 68", x: 660, tp: "rua" },
  { key: "tocantins", name: "Rua Tocantins", x: 880, tp: "rua" },
];
const ROD = { key: "go 070", name: "Rod. GO-070", from: [880, 0], dir: [0.7071, -0.7071] };
const bairroOf = (y) => (y < 400 ? "setor central" : "jardim primavera");
const cepOf = (y, x) => "749" + (y < 400 ? "10" : "20") + String(100 + Math.floor(x / 220) * 10 + Math.floor(y / 160)).padStart(3, "0");

export function build() {
  const idx = { [COD]: {} };
  const add = (via, e) => (idx[COD][via] ??= []).push(e);
  const quadras = [];
  // quadras: blocos entre ruas consecutivas
  for (let r = 0; r < H.length - 1; r++) {
    for (let c = 0; c < V.length - 1; c++) {
      quadras.push({ q: String(r * 10 + c + 1), x0: V[c].x, x1: V[c + 1].x, y0: H[r].y, y1: H[r + 1].y });
    }
  }
  // Ruas horizontais: lotes da quadra ao sul (ou ao norte, na última rua)
  H.forEach((h, r) => {
    const qr = r < H.length - 1 ? r : r - 1;
    for (let c = 0; c < V.length - 1; c++) {
      const q = String(qr * 10 + c + 1);
      for (let j = 1; j <= 6; j++) {
        const x = V[c].x + (j * (V[c + 1].x - V[c].x)) / 7;
        add(h.key, {
          tp: "rua", n: String(c * 100 + j * 14 + (j % 2 ? 0 : 1)), q, l: String(j),
          b: bairroOf(h.y), c: cepOf(h.y, x), ...toLL(x, h.y), g: 1, k: 1,
        });
      }
    }
  });
  // Ruas verticais: numeração de porta crescente para o sul
  V.forEach((v) => {
    for (let r = 0; r < H.length - 1; r++) {
      for (let j = 1; j <= 4; j++) {
        const y = H[r].y + (j * (H[r + 1].y - H[r].y)) / 5;
        add(v.key, {
          tp: v.tp, n: String(r * 100 + j * 20), q: null, l: null,
          b: bairroOf(y), c: cepOf(y, v.x), ...toLL(v.x, y), g: v.g || 1, k: 1,
        });
      }
    }
  });
  // Rodovia: um ponto por km (porta = km, convenção da base pública)
  for (let km = 1; km <= 6; km++) {
    const d = km * 90;
    const x = ROD.from[0] + ROD.dir[0] * d, y = ROD.from[1] + ROD.dir[1] * d;
    add(ROD.key, { tp: "rodovia", n: String(km), q: null, l: null, b: "zona rural", c: "74900000", ...toLL(x, y), g: 3, k: 1 });
  }
  return { idx, quadras };
}


export { H, V, ROD, toLL, LAT0, LON0, M_LAT, M_LON };
