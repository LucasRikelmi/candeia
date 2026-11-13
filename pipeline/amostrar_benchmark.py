"""Monta o recorte do benchmark: municípios por UF, endereços sorteados e os dicionários deles.

Por UF escolhe a capital, 2 municípios grandes (entradas >= p75 da UF) e 2 pequenos (<= mediana),
mais Aparecida de Goiânia (cidade grande fora das capitais, mantida para comparar rodadas). Em cada município sorteia endereços
com coordenada boa (NV_GEO_COORD 1 ou 2) e nome de via. O sorteio é determinístico (hash com semente).

Grava em --saida:
  amostra.csv                     gabarito (endereço do CNEFE + lat/lon)
  dicionarios/<cod>.json.gz       dicionário inteiro do município ({via: [entradas]}), copiado do
                                  índice de distribuição; municípios fatiados têm as fatias concatenadas
  municipios.json                 municípios escolhidos, porte e entradas

Só lê --parquet e --indice. Uso:
  python amostrar_benchmark.py --parquet ../parquet --indice ../indice_distribuicao --saida ../benchmark
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import shutil
import statistics
from pathlib import Path

import duckdb

from gerar_indice import _comp

CAPITAIS = {
    "RO": "1100205", "AC": "1200401", "AM": "1302603", "RR": "1400100", "PA": "1501402",
    "AP": "1600303", "TO": "1721000", "MA": "2111300", "PI": "2211001", "CE": "2304400",
    "RN": "2408102", "PB": "2507507", "PE": "2611606", "AL": "2704302", "SE": "2800308",
    "BA": "2927408", "MG": "3106200", "ES": "3205309", "RJ": "3304557", "SP": "3550308",
    "PR": "4106902", "SC": "4205407", "RS": "4314902", "MS": "5002704", "MT": "5103403",
    "GO": "5208707", "DF": "5300108",
}
EXTRAS = {"5201405": "GO"}  # Aparecida de Goiânia


def _ordem(semente: str, chave: str) -> str:
    return hashlib.sha256(f"{semente}|{chave}".encode()).hexdigest()


def escolher_municipios(manifesto: dict, semente: str, n_grandes: int, n_pequenos: int) -> dict[str, dict]:
    por_uf: dict[str, list[tuple[str, int]]] = {}
    for cod, m in manifesto["municipios"].items():
        if m["entradas"] > 0:
            por_uf.setdefault(m["uf"], []).append((cod, m["entradas"]))
    escolhidos: dict[str, dict] = {}
    for uf, lista in sorted(por_uf.items()):
        cap = CAPITAIS[uf]
        if cap not in dict(lista):
            raise SystemExit(f"capital {cap} de {uf} não está no manifesto")
        escolhidos[cap] = {"uf": uf, "porte": "capital"}
        resto = [(c, n) for c, n in lista if c != cap]
        if not resto:
            continue
        ns = sorted(n for _, n in resto)
        p75, med = ns[int(0.75 * (len(ns) - 1))], statistics.median(ns)
        grandes = sorted((c for c, n in resto if n >= p75), key=lambda c: _ordem(semente, c))[:n_grandes]
        pequenos = sorted((c for c, n in resto if n <= med and c not in grandes),
                          key=lambda c: _ordem(semente, c))[:n_pequenos]
        for c in grandes:
            escolhidos[c] = {"uf": uf, "porte": "grande"}
        for c in pequenos:
            escolhidos[c] = {"uf": uf, "porte": "pequeno"}
    for c, uf in EXTRAS.items():
        if c in manifesto["municipios"]:
            escolhidos.setdefault(c, {"uf": uf, "porte": "grande"})
    for c, m in escolhidos.items():
        m["entradas"] = manifesto["municipios"][c]["entradas"]
        m["tipo"] = manifesto["municipios"][c]["tipo"]
    return escolhidos


def copiar_dicionario(indice: Path, uf: str, cod: str, tipo: str, destino: Path) -> int:
    """Copia o dicionário do município; fatiado vira um único JSON concatenando as fatias (em texto)."""
    if tipo == "unico":
        shutil.copyfile(indice / uf / f"{cod}.json.gz", destino)
        return destino.stat().st_size
    fatias = sorted((indice / uf / cod).glob("f*.json.gz"))
    with gzip.open(destino, "wt", encoding="utf-8", compresslevel=6) as out:
        out.write("{")
        primeiro = True
        for f in fatias:
            with gzip.open(f, "rt", encoding="utf-8") as g:
                corpo = g.read().strip()
            assert corpo[0] == "{" and corpo[-1] == "}", f
            corpo = corpo[1:-1]
            if corpo:
                out.write(("" if primeiro else ",") + corpo)
                primeiro = False
        out.write("}")
    return destino.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", required=True, type=Path)
    ap.add_argument("--indice", required=True, type=Path)
    ap.add_argument("--saida", required=True, type=Path)
    ap.add_argument("--por-municipio", type=int, default=150)
    ap.add_argument("--grandes", type=int, default=2)
    ap.add_argument("--pequenos", type=int, default=2)
    ap.add_argument("--semente", default="candeia-2026-11-13")
    ap.add_argument("--memoria", default="1500MB")
    a = ap.parse_args()

    pq, idx, out = a.parquet.resolve(), a.indice.resolve(), a.saida.resolve()
    for origem in (pq, idx):
        if out == origem or origem in out.parents:
            raise SystemExit("--saida não pode ficar dentro de --parquet nem de --indice")
    (out / "dicionarios").mkdir(parents=True, exist_ok=True)

    manifesto = json.loads((idx / "manifesto.json").read_text(encoding="utf-8"))
    mun = escolher_municipios(manifesto, a.semente, a.grandes, a.pequenos)
    print(f"{len(mun)} municípios escolhidos", flush=True)

    con = duckdb.connect()
    con.execute(f"SET memory_limit='{a.memoria}'; SET threads=1;")
    partes = []
    for cod, m in sorted(mun.items()):
        glob = (pq / f"uf={m['uf']}" / f"COD_MUNICIPIO={cod}" / "*.parquet").as_posix()
        partes.append(f"""
          (SELECT '{m['uf']}' AS uf, '{cod}' AS cod, '{m['porte']}' AS porte,
                  COD_UNICO_ENDERECO AS id,
                  coalesce(NOM_TIPO_SEGLOGR, '') AS tipo, coalesce(NOM_TITULO_SEGLOGR, '') AS titulo,
                  coalesce(NOM_SEGLOGR, '') AS nome, trim(coalesce(NUM_ENDERECO, '')) AS num,
                  upper(trim(coalesce(DSC_MODIFICADOR, ''))) AS modificador,
                  coalesce({_comp('QUADRA')}, '') AS quadra, coalesce({_comp('LOTE')}, '') AS lote,
                  coalesce(DSC_LOCALIDADE, '') AS bairro, coalesce(CEP, '') AS cep,
                  TRY_CAST(NV_GEO_COORD AS INTEGER) AS nv, lat, lon
           FROM read_parquet('{glob}')
           WHERE lat IS NOT NULL AND lon IS NOT NULL AND TRY_CAST(NV_GEO_COORD AS INTEGER) IN (1, 2)
             AND trim(coalesce(NOM_SEGLOGR, '')) <> ''
           ORDER BY sha256('{a.semente}|' || COD_UNICO_ENDERECO)
           LIMIT {a.por_municipio})""")
    con.execute(f"COPY ({' UNION ALL '.join(partes)} ORDER BY uf, cod, id) TO "
                f"'{(out / 'amostra.csv').as_posix()}' (HEADER)")
    n = con.execute(f"SELECT count(*) FROM read_csv('{(out / 'amostra.csv').as_posix()}')").fetchone()[0]
    print(f"amostra: {n} endereços", flush=True)

    total = 0
    for cod, m in sorted(mun.items()):
        m["bytes_dicionario"] = copiar_dicionario(idx, m["uf"], cod, m["tipo"], out / "dicionarios" / f"{cod}.json.gz")
        total += m["bytes_dicionario"]
    (out / "municipios.json").write_text(json.dumps(mun, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"dicionários: {len(mun)} arquivos, {total / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
