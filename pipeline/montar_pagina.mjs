#!/usr/bin/env node
// Monta a página da raiz de dados.lucasrikelmi.dev dentro da pasta de envio do Cloudflare Pages.
//
//   node pipeline/montar_pagina.mjs <pasta de envio>
//
// Lê <envio>/cnefe2022/v*/manifesto.json e preenche pipeline/pagina/index.html com os números de
// cada versão (municípios, arquivos, bytes). Os números da página saem do manifesto publicado junto
// com ela, não de texto digitado. Copia também 404.html, pagina.css, favicon e fontes.
//
// O 404.html não é enfeite: sem um 404.html na raiz, o Pages trata o site como SPA e responde
// qualquer caminho inexistente com o index.html e status 200
// (https://developers.cloudflare.com/pages/configuration/serving-pages/). O loader receberia HTML
// no lugar de um arquivo que falta.
//
// Versão sem manifesto (deploy parcial com UFS=...) fica fora da tabela. Sem nenhuma versão com
// manifesto, o index.html não é escrito, para não publicar uma página que anuncia um índice vazio.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGEM = join(AQUI, "pagina");
const ESTATICOS = ["404.html", "pagina.css", "tema.js", "favicon.svg", "fontes"];

const milhar = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Bytes em unidade decimal (1 MB = 1.000.000 bytes), a mesma do restante da documentação.
export function tamanhoLegivel(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2).replace(".", ",")} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} bytes`;
}

export function resumirManifesto(manifesto) {
  const r = { municipios: 0, unicos: 0, fatiados: 0, vazios: 0, arquivos: 0, bytes: 0,
    versaoFormato: manifesto.versao_formato };
  for (const m of Object.values(manifesto.municipios ?? {})) {
    r.municipios++;
    if (m.tipo === "unico") r.unicos++;
    else if (m.tipo === "fatiado") r.fatiados++;
    else if (m.tipo === "vazio") r.vazios++;
    else throw new Error(`manifesto: tipo de município desconhecido (${m.tipo})`);
    for (const a of m.arquivos ?? []) {
      if (!Number.isSafeInteger(a.bytes) || a.bytes < 0) throw new Error(`manifesto: bytes inválido em ${a.nome}`);
      r.arquivos++;
      r.bytes += a.bytes;
    }
  }
  return r;
}

export function listarVersoes(envio) {
  const base = join(envio, "cnefe2022");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^v[0-9]+$/.test(d.name))
    .map((d) => ({ versao: d.name, manifesto: join(base, d.name, "manifesto.json") }))
    .filter((v) => existsSync(v.manifesto))
    .map((v) => ({ versao: v.versao, ...resumirManifesto(JSON.parse(readFileSync(v.manifesto, "utf8"))) }))
    .sort((a, b) => Number(b.versao.slice(1)) - Number(a.versao.slice(1))); // mais nova primeiro
}

function linhaVersao(v) {
  const caminho = `/cnefe2022/${v.versao}/`;
  const partes = [`${milhar(v.unicos)} em arquivo único`, `${milhar(v.fatiados)} fatiados`];
  if (v.vazios) partes.push(`${milhar(v.vazios)} sem entradas`);
  return `        <tr>
          <th scope="row"><code>${caminho}</code><small>formato ${v.versaoFormato}</small></th>
          <td class="num" data-rotulo="Municípios">${milhar(v.municipios)}<small>${partes.join(", ")}</small></td>
          <td class="num" data-rotulo="Arquivos">${milhar(v.arquivos)}</td>
          <td class="num" data-rotulo="Tamanho">${tamanhoLegivel(v.bytes)}<small>${milhar(v.bytes)} bytes</small></td>
          <td data-rotulo="Manifesto"><a href="${caminho}manifesto.json">manifesto.json</a></td>
        </tr>`;
}

export function renderizar(modelo, versoes, versaoPacote) {
  if (!versoes.length) throw new Error("nenhuma versão com manifesto");
  const html = modelo
    .replaceAll("{{VERSOES}}", versoes.map(linhaVersao).join("\n"))
    .replaceAll("{{VERSAO_ATUAL}}", versoes[0].versao)
    .replaceAll("{{VERSAO_PACOTE}}", versaoPacote);
  const sobra = html.match(/\{\{[A-Z_]+\}\}/);
  if (sobra) throw new Error(`marcador sem valor no modelo: ${sobra[0]}`);
  return html;
}

export function montar(envio) {
  mkdirSync(envio, { recursive: true });
  for (const nome of ESTATICOS) {
    rmSync(join(envio, nome), { recursive: true, force: true });
    cpSync(join(ORIGEM, nome), join(envio, nome), { recursive: true });
  }
  const versoes = listarVersoes(envio);
  const destino = join(envio, "index.html");
  if (!versoes.length) {
    rmSync(destino, { force: true });
    return { versoes, escreveuIndex: false };
  }
  const pacote = JSON.parse(readFileSync(join(AQUI, "..", "package.json"), "utf8"));
  writeFileSync(destino, renderizar(readFileSync(join(ORIGEM, "index.html"), "utf8"), versoes, pacote.version));
  return { versoes, escreveuIndex: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const envio = process.argv[2];
  if (!envio) { console.error("uso: node montar_pagina.mjs <pasta de envio>"); process.exit(1); }
  const { versoes, escreveuIndex } = montar(resolve(envio));
  if (!escreveuIndex) console.log("== página: nenhuma versão com manifesto; index.html não foi escrito (404.html foi)");
  for (const v of versoes) {
    console.log(`== página: ${v.versao} com ${v.municipios} municípios, ${v.arquivos} arquivos, ${v.bytes} bytes`);
  }
}
