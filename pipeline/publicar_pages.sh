#!/usr/bin/env bash
# Publica o índice gerado por gerar_indice.py no Cloudflare Pages (arquivos estáticos).
#
# Uso:
#   ./publicar_pages.sh <pasta do índice> [versão] [projeto]
#   ./publicar_pages.sh ../indice_distribuicao v1 candeia-dados
#
# Por que Pages e não R2: no Pages, requisição a arquivo estático é grátis e ilimitada
# (https://developers.cloudflare.com/pages/functions/pricing/). Abuso da URL pública não vira conta.
# Limites do plano grátis: 20 mil arquivos por site, 25 MiB por arquivo. O índice v1 tem ~6,3 mil
# arquivos, o maior com ~1 MB.
#
# O que o script faz:
# - Node e wrangler ficam numa pasta própria (FERRAMENTAS, padrão ../ferramentas), com versões
#   fixas e sha256 do Node conferido. Nada é instalado no sistema e não pede sudo. Para remover:
#   apagar a pasta.
# - Monta a pasta de envio com hardlinks (não copia 1 GB, não altera o índice):
#     <envio>/cnefe2022/<versão>/...   e   <envio>/_headers (CORS e cache)
# - wrangler login abre o navegador para entrar na conta Cloudflare (sem token para copiar).
# - Cada deploy SUBSTITUI o site inteiro. Para publicar uma v2 sem derrubar a v1, a pasta de envio
#   precisa conter as duas: o script mantém as versões já montadas em <envio>/cnefe2022/.
set -euo pipefail

ORIGEM="$(realpath "${1:?informe a pasta do índice}")"
VERSAO="${2:-v1}"
PROJETO="${3:-candeia-dados}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
FERRAMENTAS="${FERRAMENTAS:-$(realpath -m "$AQUI/../ferramentas")}"
ENVIO="${ENVIO:-$(realpath -m "$AQUI/../publicacao_pages")}"

NODE_VER="v24.22.1"
NODE_SHA256="6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6"   # node-$NODE_VER-linux-x64.tar.xz
WRANGLER_VER="4.156.0"

[[ "$VERSAO" =~ ^v[0-9]+$ ]] || { echo "versão deve ser v1, v2..." >&2; exit 1; }

[[ -f "$ORIGEM/manifesto.json" ]] || { echo "sem manifesto.json em $ORIGEM" >&2; exit 1; }
[[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]] || { echo "script feito para Linux x86_64" >&2; exit 1; }

# --- Node portátil -------------------------------------------------------------------------------
NODE_DIR="$FERRAMENTAS/node-$NODE_VER-linux-x64"
if [[ ! -x "$NODE_DIR/bin/node" ]]; then
  mkdir -p "$FERRAMENTAS"
  TAR="$FERRAMENTAS/node-$NODE_VER-linux-x64.tar.xz"
  echo "== baixando Node $NODE_VER para $FERRAMENTAS"
  URL="https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
  if command -v curl >/dev/null; then curl -fL --retry 3 -o "$TAR" "$URL"; else wget -O "$TAR" "$URL"; fi
  echo "$NODE_SHA256  $TAR" | sha256sum -c - || { rm -f "$TAR"; echo "sha256 do Node não confere" >&2; exit 1; }
  tar -xJf "$TAR" -C "$FERRAMENTAS"
  rm -f "$TAR"
fi
export PATH="$NODE_DIR/bin:$PATH"

# --- wrangler (versão fixa, instalado só dentro de FERRAMENTAS) ----------------------------------
WR_DIR="$FERRAMENTAS/wrangler-$WRANGLER_VER"
if [[ ! -x "$WR_DIR/node_modules/.bin/wrangler" ]]; then
  echo "== instalando wrangler $WRANGLER_VER em $WR_DIR"
  mkdir -p "$WR_DIR"
  npm install --prefix "$WR_DIR" --no-fund --no-audit --save-exact "wrangler@$WRANGLER_VER"
fi
WRANGLER="$WR_DIR/node_modules/.bin/wrangler"
export WRANGLER_SEND_METRICS=false

# --- pasta de envio ------------------------------------------------------------------------------
DEST="$ENVIO/cnefe2022/$VERSAO"
if [[ -d "$DEST" ]]; then
  echo "== $DEST já existe; refazendo só esta versão"
  rm -rf "$DEST"
fi
mkdir -p "$DEST"
echo "== montando $DEST (hardlinks; cai para cópia se estiver em outro disco)"
# UFS="AC AL AM" publica só essas UFs e sem manifesto (deploy parcial, para envios que caem no meio:
# os arquivos de um deploy concluído não são reenviados no próximo). Sem UFS, publica tudo.
( cd "$ORIGEM" && find . -type f \( -name '*.json.gz' -o -name 'manifesto.json' \) \
    -not -path './_manifesto/*' -not -path './_tmp*' -print0 ) |
  while IFS= read -r -d '' f; do
    if [[ -n "${UFS:-}" ]]; then
      uf="${f#./}"; uf="${uf%%/*}"
      [[ " $UFS " == *" $uf "* ]] || continue
    fi
    mkdir -p "$DEST/$(dirname "$f")"
    ln "$ORIGEM/$f" "$DEST/$f" 2>/dev/null || cp -p "$ORIGEM/$f" "$DEST/$f"
  done

# Content-Encoding nunca é definido: o loader precisa dos bytes do .gz para conferir o sha256.
# Uma regra só, para não somar valores repetidos de Cache-Control (o Pages junta com vírgula).
cat > "$ENVIO/_headers" <<'EOF'
/cnefe2022/*
  Access-Control-Allow-Origin: *
  Cache-Control: public, max-age=31536000, immutable
EOF

N=$(find "$ENVIO" -type f | wc -l)
MAIOR=$(find "$ENVIO" -type f -printf '%s\n' | sort -n | tail -1)
echo "== envio: $N arquivos, maior com $MAIOR bytes (limites do plano grátis: 20000 arquivos, 25 MiB)"
(( N <= 20000 )) || { echo "passa de 20 mil arquivos" >&2; exit 1; }
(( MAIOR <= 26214400 )) || { echo "arquivo acima de 25 MiB" >&2; exit 1; }

# --- deploy --------------------------------------------------------------------------------------
"$WRANGLER" whoami >/dev/null 2>&1 || "$WRANGLER" login
"$WRANGLER" pages project list 2>/dev/null | grep -qw "$PROJETO" ||
  "$WRANGLER" pages project create "$PROJETO" --production-branch main
"$WRANGLER" pages deploy "$ENVIO" --project-name "$PROJETO" --branch main --commit-dirty=true

echo
echo "ok. Se ainda não fez: no painel, Workers & Pages → $PROJETO → Custom domains → dados.lucasrikelmi.dev"
echo "Depois confira: python verificar_publicacao.py https://dados.lucasrikelmi.dev/cnefe2022/$VERSAO/ --origem http://localhost:8080"
