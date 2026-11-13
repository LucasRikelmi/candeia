"""Confere o índice publicado pela URL pública, do jeito que o loader (src/loader.js) vai ler.

Para cada arquivo amostrado: HTTP 200, bytes iguais ao manifesto (sha256), sem Content-Encoding
(senão o navegador descomprime e o hash não confere), e CORS liberado para a origem do site.

Uso:
  python verificar_publicacao.py https://dados.exemplo.dev/cnefe2022/v1/ --origem https://meusite.exemplo.dev
  python verificar_publicacao.py <URL> --origem <site> --todos      # todos os arquivos (~5,7 mil GETs)

Só usa a biblioteca padrão. Só faz GET; não grava nada.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.request

AMOSTRA = ["3550308", "5300108", "5208707", "1400100", "4314902"]  # SP, DF, Goiânia, Boa Vista, Porto Alegre


def baixar(url: str, origem: str | None) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"Origin": origem} if origem else {})
    req.add_header("Accept-Encoding", "identity")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, b""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("base")
    ap.add_argument("--origem", help="origem do site que vai consultar (testa CORS)")
    ap.add_argument("--todos", action="store_true", help="confere todos os arquivos, não só a amostra")
    a = ap.parse_args()
    base = a.base if a.base.endswith("/") else a.base + "/"
    erros: list[str] = []

    st, h, corpo = baixar(base + "manifesto.json", a.origem)
    if st != 200:
        print(f"manifesto.json: HTTP {st}")
        return 1
    if a.origem and h.get("access-control-allow-origin") not in ("*", a.origem):
        erros.append(f"manifesto.json: CORS não libera {a.origem} (veio {h.get('access-control-allow-origin')!r})")
    mun = json.loads(corpo)["municipios"]
    print(f"manifesto: {len(mun)} municípios")

    cods = sorted(mun) if a.todos else [c for c in AMOSTRA if c in mun]
    n = 0
    for cod in cods:
        m = mun[cod]
        for arq in m.get("arquivos", []):
            caminho = f"{m['uf']}/{cod}.json.gz" if m["tipo"] == "unico" else f"{m['uf']}/{cod}/{arq['nome']}"
            if not a.todos and m["tipo"] == "fatiado" and arq["nome"] not in ("index.json.gz", "f000.json.gz"):
                continue
            st, h, corpo = baixar(base + caminho, a.origem)
            n += 1
            if st != 200:
                erros.append(f"{caminho}: HTTP {st}")
                continue
            if h.get("content-encoding"):
                erros.append(f"{caminho}: Content-Encoding {h['content-encoding']!r} (o loader não confere o hash)")
            if hashlib.sha256(corpo).hexdigest() != arq["sha256"]:
                erros.append(f"{caminho}: sha256 diferente do manifesto")
            if a.origem and h.get("access-control-allow-origin") not in ("*", a.origem):
                erros.append(f"{caminho}: CORS não libera {a.origem}")
    print(f"{n} arquivos conferidos, {len(erros)} problema(s)")
    for e in erros[:50]:
        print("  -", e)
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
