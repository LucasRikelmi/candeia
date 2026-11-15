// Demo do Candeia: formulário, busca de cidade, resultado e mapa. Sem dependência além do Leaflet,
// que é opcional: se ele não carregar, a consulta continua funcionando sem o mapa.
import { criarGeocodificador } from "../src/index.js";

const STATUS = {
  verde: "Endereço encontrado",
  azul: "Encontrado com pequena incerteza",
  amarelo: "Aproximado",
  laranja: "Só a região provável",
  vermelho: "Não encontrado",
};
const METODO = {
  numero: "pelo número de porta", quadra_lote: "pela quadra e lote", lote: "pelo lote", quadra: "pela quadra",
  interpolacao: "por estimativa entre números vizinhos", eixo: "ao longo da rua, sem o número exato",
  cep: "pelo CEP", cruzamento: "pelo cruzamento de ruas",
};
const URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";
// Cidades que funcionam antes de a lista do IBGE chegar (ou se ela falhar): as dos exemplos e algumas capitais.
const CIDADES_FIXAS = [
  ["Goiânia", "GO", "5208707"], ["São Paulo", "SP", "3550308"], ["Brasília", "DF", "5300108"],
  ["Rio de Janeiro", "RJ", "3304557"], ["Belo Horizonte", "MG", "3106200"], ["Palmas", "TO", "1721000"],
];

const $ = (id) => document.getElementById(id);
const f = $("f"), res = $("res"), ir = $("ir"), campoCidade = $("cidade"), lista = $("cidades");
const nf = new Intl.NumberFormat("pt-BR");
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** Cria um elemento. Texto sempre entra como nó de texto: nada vindo do índice ou do usuário vira HTML. */
function h(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v === true ? "" : v);
  for (const c of filhos.flat()) if (c != null && c !== false) e.append(c);
  return e;
}
const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------- cidades

const cidade = (nome, uf, cod) => ({ nome, uf, cod, rotulo: `${nome} - ${uf}`, chave: norm(nome), chaveRotulo: norm(`${nome} ${uf}`) });
let cidades = CIDADES_FIXAS.map((c) => cidade(...c));
let listaCompleta = null; // Promise<boolean> depois do primeiro pedido

/** Baixa a lista de municípios na primeira vez que o campo é usado, não na abertura da página. */
function carregarCidades() {
  listaCompleta ??= (async () => {
    dica("cidade", "Carregando a lista de cidades…");
    try {
      const r = await fetch(URL_MUNICIPIOS);
      if (!r.ok) throw new Error(String(r.status));
      const dados = await r.json();
      const novas = dados.map((m) => cidade(m["municipio-nome"], m["UF-sigla"], String(m["municipio-id"])));
      if (novas.length < 5000 || !novas[0].nome || !/^\d{7}$/.test(novas[0].cod)) throw new Error("formato inesperado");
      cidades = novas;
      dica("cidade", "");
      if (document.activeElement === campoCidade) abrirLista();
      return true;
    } catch {
      dica("cidade", "Lista de cidades indisponível agora. Digite o código IBGE de 7 dígitos.");
      return false;
    }
  })();
  return listaCompleta;
}

function filtrar(texto) {
  const q = norm(texto);
  if (!q) return [];
  const achados = [];
  for (const c of cidades) {
    let nota;
    if (c.chave === q || c.chaveRotulo === q) nota = 0;
    else if (c.chaveRotulo.startsWith(q)) nota = 1;
    else if (c.chave.includes(" " + q)) nota = 2;
    else if (c.chave.includes(q)) nota = 3;
    else continue;
    achados.push([nota, c]);
  }
  achados.sort((a, b) => a[0] - b[0] || a[1].chave.length - b[1].chave.length || a[1].rotulo.localeCompare(b[1].rotulo, "pt-BR"));
  return achados.slice(0, 8).map((a) => a[1]);
}

/** Texto do campo → código IBGE. Aceita código, "Nome - UF" (com ou sem acento) ou nome que só exista uma vez. */
function resolverCidade(texto) {
  const t = texto.trim();
  if (/^\d{7}$/.test(t)) return { cod: t };
  const q = norm(t);
  if (!q) return { erro: "Informe a cidade." };
  const porRotulo = cidades.find((c) => c.chaveRotulo === q);
  if (porRotulo) return { cod: porRotulo.cod, rotulo: porRotulo.rotulo };
  const porNome = cidades.filter((c) => c.chave === q);
  if (porNome.length === 1) return { cod: porNome[0].cod, rotulo: porNome[0].rotulo };
  if (porNome.length > 1) return { erro: `Há ${porNome.length} cidades com esse nome. Escolha uma na lista.` };
  return { erro: "Cidade não reconhecida. Escolha uma na lista ou digite o código IBGE." };
}

let opcoes = [], ativa = -1;
function abrirLista() {
  opcoes = filtrar(campoCidade.value);
  // Um único resultado idêntico ao que está digitado não precisa de lista.
  if (!opcoes.length || (opcoes.length === 1 && opcoes[0].rotulo === campoCidade.value)) return fecharLista();
  ativa = -1;
  lista.replaceChildren(...opcoes.map((c, i) =>
    h("li", { role: "option", id: `cid-${i}`, "aria-selected": "false", "data-i": i }, h("span", null, c.nome), h("small", null, c.uf))));
  lista.hidden = false;
  campoCidade.setAttribute("aria-expanded", "true");
}
function fecharLista() {
  lista.hidden = true; ativa = -1;
  campoCidade.setAttribute("aria-expanded", "false");
  campoCidade.removeAttribute("aria-activedescendant");
}
function marcar(i) {
  ativa = (i + opcoes.length) % opcoes.length;
  [...lista.children].forEach((li, k) => li.setAttribute("aria-selected", String(k === ativa)));
  campoCidade.setAttribute("aria-activedescendant", `cid-${ativa}`);
  lista.children[ativa].scrollIntoView({ block: "nearest" });
}
function escolher(i) {
  campoCidade.value = opcoes[i].rotulo;
  dica("cidade", "");
  fecharLista();
}

campoCidade.addEventListener("focus", () => { carregarCidades(); campoCidade.select(); });
campoCidade.addEventListener("input", () => { carregarCidades(); dica("cidade", ""); abrirLista(); });
campoCidade.addEventListener("blur", fecharLista);
campoCidade.addEventListener("keydown", (ev) => {
  const aberta = !lista.hidden;
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    if (!aberta) { abrirLista(); if (lista.hidden) return; }
    marcar(ativa + (ev.key === "ArrowDown" ? 1 : ativa < 0 ? 0 : -1));
  } else if (ev.key === "Enter" && aberta && ativa >= 0) {
    ev.preventDefault(); escolher(ativa);
  } else if (ev.key === "Escape" && aberta) {
    ev.preventDefault(); fecharLista();
  }
});
// pointerdown com preventDefault mantém o foco no campo; o clique escolhe.
lista.addEventListener("pointerdown", (ev) => ev.preventDefault());
lista.addEventListener("click", (ev) => {
  const li = ev.target.closest("li");
  if (li) { escolher(Number(li.dataset.i)); campoCidade.focus(); }
});

function dica(campo, texto, erro = false) {
  const p = $(`${campo}-msg`);
  p.textContent = texto;
  p.classList.toggle("erro", erro);
  if (erro) $(campo).setAttribute("aria-invalid", "true"); else $(campo).removeAttribute("aria-invalid");
}

$("endereco").addEventListener("input", () => dica("endereco", ""));
$("cep").addEventListener("input", (ev) => {
  const d = ev.target.value.replace(/\D/g, "").slice(0, 8);
  ev.target.value = d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
});

// ---------------------------------------------------------------- mapa

const temLeaflet = typeof L !== "undefined";
let mapa = null, camada = null;
if (temLeaflet) {
  mapa = L.map("mapa", { scrollWheelZoom: false }).setView([-14.5, -52], 4);
  // Roda do mouse só dá zoom depois de um clique no mapa: rolar a página não prende o cursor nele.
  mapa.on("focus", () => mapa.scrollWheelZoom.enable());
  mapa.on("blur", () => mapa.scrollWheelZoom.disable());
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);
  camada = L.layerGroup().addTo(mapa);
} else {
  const m = $("mapa");
  m.classList.add("mapa-fora");
  m.append(h("p", null, "O mapa não carregou. A consulta funciona mesmo assim: o resultado traz a coordenada e um link para abrir em outro mapa."));
}

const corDe = (status) => getComputedStyle(document.documentElement).getPropertyValue(`--st-${status}`).trim() || "#888";

function desenhar(r) {
  if (!mapa) return;
  camada.clearLayers();
  if (!r.coord) return;
  const p = [r.coord.lat, r.coord.lon], cor = corDe(r.status);
  const fundo = getComputedStyle(document.documentElement).getPropertyValue("--card").trim() || "#fff";
  // Círculo só quando existe margem medida: desenhar um raio mínimo sugeriria uma incerteza que o motor não informou.
  if (r.raio >= 5) L.circle(p, { radius: r.raio, color: cor, weight: 1.5, fillOpacity: 0.12, interactive: false }).addTo(camada);
  L.circleMarker(p, { radius: 8, color: fundo, weight: 2.5, fillColor: cor, fillOpacity: 1, interactive: false }).addTo(camada);
  mapa.invalidateSize();
  if (r.status === "vermelho" || r.raio == null) mapa.setView(p, r.status === "vermelho" ? 12 : 16);
  else mapa.fitBounds(L.latLng(p).toBounds(Math.max(2.4 * r.raio, 220)), { maxZoom: 18, padding: [24, 24] });
}

// ---------------------------------------------------------------- consulta

let geo = null, baseAtual = null, rede = { arquivos: 0, bytes: 0 }, rodada = 0, ultimo = null;
const hist = [];

/** fetch que conta arquivos e bytes baixados, para mostrar o custo de rede de cada consulta. */
async function fetchContado(url) {
  const resp = await fetch(url);
  if (!resp.ok) return resp;
  const corpo = await resp.arrayBuffer();
  rede.arquivos++; rede.bytes += corpo.byteLength;
  return new Response(corpo, { status: resp.status, headers: resp.headers });
}

const tamanho = (b) => (b >= 1e6 ? `${nf1.format(b / 1e6)} MB` : `${nf.format(Math.max(1, Math.round(b / 1e3)))} kB`);
const margem = (raio) => (raio == null ? "não estimada"
  : raio < 1 ? "0 m, sem dispersão no cadastro"
  : raio < 1000 ? `${nf.format(Math.round(raio))} m` : `${nf1.format(raio / 1000)} km`);
const pct = (x) => (x == null ? "—" : `${Math.round(100 * x)}%`);

function ocupado(sim, texto) {
  ir.setAttribute("aria-busy", String(sim));
  ir.firstChild.textContent = (sim ? texto : "Localizar") + " ";
}

f.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (ir.getAttribute("aria-busy") === "true") return;
  fecharLista();
  const d = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));
  const base = $("base").value.trim();

  if (!d.endereco) { dica("endereco", "Informe o endereço.", true); $("endereco").focus(); return; }
  let cid = resolverCidade(d.cidade);
  if (cid.erro && d.cidade) {
    // O nome pode simplesmente ainda não ter chegado: espera a lista completa antes de recusar.
    ocupado(true, "Carregando cidades…");
    await carregarCidades();
    cid = resolverCidade(d.cidade);
    ocupado(false);
  }
  if (cid.erro) { dica("cidade", cid.erro, true); campoCidade.focus(); return; }
  dica("cidade", "");
  if (cid.rotulo) { campoCidade.value = cid.rotulo; d.cidade = cid.rotulo; }

  if (base !== baseAtual) {
    try { geo = criarGeocodificador({ base, fetch: fetchContado }); baseAtual = base; }
    catch { return mostrarErro("Índice não informado", "Preencha a URL do índice em Avançado."); }
  }
  const esta = ++rodada;
  rede = { arquivos: 0, bytes: 0 };
  ocupado(true, "Procurando…");
  const t0 = performance.now();
  try {
    const r = await geo.geocodificar(d.endereco, { municipio: cid.cod, bairro: d.bairro, cep: d.cep });
    if (esta !== rodada) return;
    ultimo = { r, d, ms: Math.round(performance.now() - t0), rede: { ...rede } };
    mostrar(ultimo);
    desenhar(r);
    lembrar(d, r.status);
  } catch (e) {
    if (esta !== rodada) return;
    const msg = String(e?.message || e);
    if (/não está no manifesto/.test(msg)) mostrarErro("Cidade fora do índice", `O município ${cid.cod} não existe nesta versão do índice.`);
    else if (e instanceof TypeError) mostrarErro("Sem acesso ao índice", "Não foi possível baixar o arquivo da cidade. Verifique a conexão e tente de novo.");
    else mostrarErro("A consulta falhou", msg);
  } finally {
    ocupado(false);
    aoResultado();
  }
});

/** Traz a resposta para a tela quando ela caiu abaixo da dobra: no celular rola até o mapa (o
 *  resultado vem logo abaixo); em tela larga alinha o palco ao topo, com o mapa fixo ao lado. */
function aoResultado() {
  const estreita = matchMedia("(max-width: 56em)").matches;
  const alvo = document.querySelector(estreita ? ".mapa-caixa" : ".palco");
  const topoRes = res.getBoundingClientRect().top;
  if (!estreita && topoRes < innerHeight * 0.6) return;
  const suave = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  alvo.scrollIntoView({ behavior: suave ? "smooth" : "auto", block: "start" });
}

function mostrarErro(titulo, detalhe) {
  ultimo = null;
  camada?.clearLayers();
  res.replaceChildren(h("div", { class: "alerta" }, h("b", null, titulo), h("span", null, detalhe)));
}

function mostrar({ r, ms, rede: custo }) {
  const falhou = r.metodo === "falha" || !METODO[r.metodo];
  const sub = falhou
    ? h("p", { class: "res-sub" }, r.status === "vermelho" ? "A rua não foi encontrada na base. O ponto no mapa é o centro da cidade." : `Método: ${r.metodo || "não informado"}.`)
    : h("p", { class: "res-sub" }, "Localizado ", h("b", null, METODO[r.metodo]), ".");

  const fato = (rotulo, valor, classe) => h("div", { class: classe?.includes("largo") ? "largo" : null },
    h("dt", null, rotulo), h("dd", { class: classe?.includes("cod") ? "cod" : null }, valor));
  const semelhanca = r.viaScore != null && r.viaScore < 1 ? ` (semelhança ${Math.round(100 * r.viaScore)}%)` : "";
  const coord = r.coord ? `${r.coord.lat.toFixed(6)}, ${r.coord.lon.toFixed(6)}` : null;
  const fatos = h("dl", { class: "fatos" },
    fato("Margem", margem(r.raio)),
    fato("Tempo", `${nf.format(ms)} ms`),
    fato("Rua reconhecida", r.viaKey ? `${r.viaKey}${semelhanca}` : "nenhuma", "cod"),
    fato("Coordenada", coord ?? "sem coordenada", "cod"),
    fato("Baixado nesta consulta", custo.arquivos
      ? `${custo.arquivos} ${custo.arquivos === 1 ? "arquivo" : "arquivos"}, ${tamanho(custo.bytes)}`
      : "nada: os arquivos já estavam na memória", "largo"),
    r.motivo ? fato("Como o motor decidiu", r.motivo, "largo") : null);

  const confia = r.confianca && h("p", { class: "confia" }, "Em testes com respostas iguais a esta, ",
    h("b", null, pct(r.confianca.ate100m)), " ficaram a até 100 m do ponto certo e ",
    h("b", null, pct(r.confianca.acima1km)), " a mais de 1 km.");

  let acoes = null;
  if (coord) {
    const copiar = h("button", { class: "btn pequeno", type: "button" }, "Copiar coordenada");
    copiar.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(coord); copiar.textContent = "Copiada"; }
      catch { copiar.textContent = "Não foi possível copiar"; }
      setTimeout(() => { copiar.textContent = "Copiar coordenada"; }, 1800);
    });
    const ll = `${r.coord.lat},${r.coord.lon}`;
    acoes = h("div", { class: "acoes" }, copiar,
      h("a", { class: "btn pequeno", target: "_blank", rel: "noopener", href: `https://www.google.com/maps?q=${ll}` }, "Google Maps"),
      h("a", { class: "btn pequeno", target: "_blank", rel: "noopener",
        href: `https://www.openstreetmap.org/?mlat=${r.coord.lat}&mlon=${r.coord.lon}#map=18/${r.coord.lat}/${r.coord.lon}` }, "OpenStreetMap"));
  }

  res.replaceChildren(h("div", { "data-status": r.status },
    h("div", { class: "res-topo" }, h("span", { class: "bola", "aria-hidden": "true" }),
      h("div", null, h("p", { class: "res-titulo" }, STATUS[r.status] || r.status), sub)),
    fatos, confia, acoes));
}

function lembrar(d, status) {
  const igual = (a) => ["cidade", "endereco", "bairro", "cep"].every((k) => (a.d[k] || "") === (d[k] || ""));
  const i = hist.findIndex(igual);
  if (i >= 0) hist.splice(i, 1);
  hist.unshift({ d, status });
  hist.length = Math.min(hist.length, 12);
  $("hist-bloco").hidden = hist.length < 2;
  $("hist").replaceChildren(...hist.map((x, k) => h("li", null,
    h("button", { type: "button", "data-i": k, "data-status": x.status, title: STATUS[x.status] || x.status },
      h("span", { class: "bola", "aria-hidden": "true" }),
      h("span", { class: "txt" }, x.d.endereco, " ", h("small", null, `· ${x.d.cidade}`))))));
}

function preencher(d) {
  for (const k of ["cidade", "endereco", "bairro", "cep"]) $(k).value = d[k] || "";
  dica("cidade", ""); dica("endereco", "");
  f.requestSubmit();
}
$("hist").addEventListener("click", (ev) => {
  const b = ev.target.closest("button");
  if (b) preencher(hist[Number(b.dataset.i)].d);
});
document.querySelector(".chips").addEventListener("click", (ev) => {
  const b = ev.target.closest(".chip");
  if (b) preencher(b.dataset);
});

// Troca de tema do sistema com um resultado na tela: redesenha o ponto com as cores do tema novo.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (ultimo) desenhar(ultimo.r); });
