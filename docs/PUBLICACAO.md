# Publicar o índice

Destino escolhido: **Cloudflare Pages** (arquivos estáticos), com o subdomínio `dados.lucasrikelmi.dev`. URL final do índice: `https://dados.lucasrikelmi.dev/cnefe2022/v1/`.

## Por que Pages e não R2

No R2, cada leitura que escapa do cache é cobrada acima da cota grátis (10 milhões/mês), e não há teto de gasto que eu conheça. Uma URL pública pode ser abusada, por exemplo com `?x=<aleatório>` no fim de cada pedido para furar o cache. No Pages, "requests to static assets are free and unlimited" nos planos grátis e pago ([preços](https://developers.cloudflare.com/pages/functions/pricing/)). O abuso não vira conta.

Limites do plano grátis ([limites](https://developers.cloudflare.com/pages/platform/limits/)), conferidos em 2026-11-13:

| Limite | Pages grátis | Índice v1 |
|---|---|---|
| Arquivos por site | 20.000 | 6.328 |
| Tamanho por arquivo | 25 MiB | maior: 961 KB |
| Envio pelo painel (arrastar pasta) | 1.000 arquivos | não serve |
| Envio pelo `wrangler pages deploy` | 20.000 arquivos | é o caminho usado |

Consequências:
- Cada deploy **substitui o site inteiro**. Uma `v2` precisa ir junto com a `v1`, senão a v1 some. O script mantém as versões já montadas na pasta de envio. Com 20 mil arquivos, cabem umas 3 versões ao mesmo tempo.
- O `wrangler` precisa de Node. O script baixa um Node portátil (versão fixa, sha256 conferido) para uma pasta própria, sem instalar nada no sistema.

## 1. Publicar (máquina que tem o índice)

```bash
cd <pasta do pipeline>
./publicar_pages.sh ../indice_distribuicao v1 candeia-dados
```

O script:
1. baixa o Node v24.22.1 e o wrangler 4.156.0 para `../ferramentas` (uma vez só; para remover, apague a pasta);
2. monta `../publicacao_pages/cnefe2022/v1/` com hardlinks do índice (não copia 1 GB e não altera o índice) e o arquivo `_headers` (CORS `*` e cache de 1 ano);
3. abre o navegador para você entrar na Cloudflare (`wrangler login`), sem token para copiar;
4. monta a página da raiz (ver [Página da raiz](#página-da-raiz));
5. cria o projeto `candeia-dados` se não existir e faz o deploy.

São ~1 GB. Em conexão doméstica, conte com dezenas de minutos. Se cair, rode de novo: o wrangler só envia o que ainda não está lá.

## 2. Ligar o subdomínio (painel, uma vez)

Workers & Pages → `candeia-dados` → Custom domains → Set up a custom domain → `dados.lucasrikelmi.dev`. A Cloudflare cria o registro DNS. O endereço `candeia-dados.pages.dev` também funciona.

## 3. Conferir pela URL pública

```bash
python verificar_publicacao.py https://dados.lucasrikelmi.dev/cnefe2022/v1/ --origem http://localhost:8080
```

Confere HTTP 200, sha256 contra o manifesto, ausência de `Content-Encoding` (pedindo com o `Accept-Encoding` de um navegador) e CORS numa amostra (SP, DF, Goiânia, Boa Vista, Porto Alegre). `--todos` confere todos os arquivos.

O ponto que só o verificador confirma: o loader precisa receber os bytes do `.gz` sem `Content-Encoding`, senão o navegador descomprime antes e o hash não é conferido. Se aparecer `Content-Encoding`, não use o índice e me avise.

## Página da raiz

`https://dados.lucasrikelmi.dev/` mostra uma página estática com o que é o índice, a fonte, a licença, o formato e as versões publicadas. O modelo fica em `pipeline/pagina/`, e `pipeline/montar_pagina.mjs` o preenche na pasta de envio a cada publicação:

- Municípios, arquivos e bytes de cada versão são somados do `manifesto.json` que está sendo publicado. A versão do pacote vem do `package.json`. Nenhum número é digitado no HTML.
- Versão sem manifesto (deploy parcial com `UFS=...`) fica fora da tabela. Se nenhuma versão tiver manifesto, o `index.html` não é escrito.
- A página não tem JavaScript nem recurso externo. As fontes (OFL) são as mesmas de lucasrikelmi.dev, copiadas para `pipeline/pagina/fontes/`.
- O `404.html` é obrigatório a partir do momento em que existe `index.html`. Sem ele, o Pages trata o site como SPA e responde caminho inexistente com o `index.html` e status 200 ([documentação](https://developers.cloudflare.com/pages/configuration/serving-pages/)): um arquivo de município que falta viraria HTML com 200 para o loader, em vez de 404.

Para republicar só a página (texto ou estilo mudou, índice igual), rode o mesmo comando do passo 1. O deploy substitui o site inteiro, mas o wrangler não reenvia os arquivos do índice que já estão lá.

Depois do deploy, confira:

```bash
curl -sI https://dados.lucasrikelmi.dev/ | head -1                         # 200
curl -sI https://dados.lucasrikelmi.dev/cnefe2022/v1/nao-existe | head -1  # 404, não 200
```

## CORS

`Access-Control-Allow-Origin: *`. O índice é público, só aceita leitura e não usa login nem cookie, então liberar para qualquer origem não expõe nada.

## Alternativa: R2

`pipeline/publicar_r2.sh` continua no repositório para quem preferir o R2 (bucket + rclone). Nesse caso, configure no domínio uma Cache Rule para o subdomínio (cache sempre, TTL longo, **query string ignorada** na chave de cache), ligue o Tiered Cache e uma regra de rate limiting. Sem a regra de cache, o custo de um abuso não tem limite.

## Clientes fora do navegador

A Cloudflare barra o User-Agent padrão do Python (`Python-urllib`) com 403 / `error code: 1010` (assinatura de navegador banida). Navegadores e `curl` passam. Qualquer script ou servidor que leia o índice deve mandar um User-Agent próprio, como faz o `verificar_publicacao.py`.

## Envio que cai no meio

O wrangler só registra os arquivos de um deploy concluído. Se o envio cair no meio, a próxima tentativa recomeça do zero. Se cair repetidamente, publique em etapas: `UFS="AC AL AM ..." ./publicar_pages.sh ...` faz um deploy parcial (sem manifesto), e o deploy completo seguinte pula o que já subiu.
