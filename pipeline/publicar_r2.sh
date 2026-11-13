#!/usr/bin/env bash
# Sobe o índice gerado por gerar_indice.py para um bucket do Cloudflare R2 com rclone.
#
# Uso:
#   ./publicar_r2.sh <pasta do índice> <remote rclone>:<bucket>/<prefixo>
#   ./publicar_r2.sh ../indice_distribuicao r2:candeia/cnefe2022/v1
#
# - Os arquivos sobem como estão (gzip), com Content-Type application/gzip e SEM Content-Encoding:
#   assim o loader recebe os bytes do arquivo e confere o sha256 do manifesto.
# - O prefixo é versionado (v1, v2...): nada é sobrescrito, então o cache pode ser "immutable".
#   Índice novo vai para um prefixo novo; o antigo continua servindo quem ainda aponta para ele.
# - O manifesto sobe por último: enquanto ele não existe, nenhum cliente usa a versão incompleta.
# - Só lê a pasta do índice. Não apaga nada no bucket (rclone copy, não sync).
set -euo pipefail

ORIGEM="${1:?informe a pasta do índice}"
DESTINO="${2:?informe o destino rclone, ex.: r2:candeia/cnefe2022/v1}"
[[ -f "$ORIGEM/manifesto.json" ]] || { echo "sem manifesto.json em $ORIGEM" >&2; exit 1; }
command -v rclone >/dev/null || { echo "rclone não encontrado (sudo apt install rclone)" >&2; exit 1; }

CACHE="Cache-Control: public, max-age=31536000, immutable"
COMUM=(--transfers 8 --checkers 16 --s3-no-check-bucket --progress --exclude "_manifesto/**" --exclude "_tmp*/**")

echo "== arquivos do índice ($(find "$ORIGEM" -name '*.json.gz' | wc -l) .json.gz)"
rclone copy "$ORIGEM" "$DESTINO" "${COMUM[@]}" --include "*.json.gz" \
  --header-upload "Content-Type: application/gzip" --header-upload "$CACHE"

echo "== manifesto (por último)"
rclone copyto "$ORIGEM/manifesto.json" "$DESTINO/manifesto.json" --s3-no-check-bucket \
  --header-upload "Content-Type: application/json" --header-upload "$CACHE"

echo "== conferência de tamanho (local x bucket)"
rclone check "$ORIGEM" "$DESTINO" --size-only --one-way --include "*.json.gz" --include "manifesto.json" \
  --exclude "_manifesto/**" --s3-no-check-bucket
echo "ok. Confira pela URL pública com: python verificar_publicacao.py <URL pública>/cnefe2022/v1/ --origem <site>"
