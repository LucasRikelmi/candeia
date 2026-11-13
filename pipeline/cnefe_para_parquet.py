#!/usr/bin/env python3
"""CNEFE 2022 (zip por UF) -> Parquet particionado por município.

Saída (sem perda: todas as colunas originais como texto + lat/lon numéricos):
  <saida>/uf=<UF>/COD_MUNICIPIO=<cod>/*.parquet
  <saida>/_manifesto/<UF>.json      hash do zip, contagens, tamanhos por município

Desenhado para máquina modesta (HDD, ~5 GB de RAM livre):
  - uma UF por vez, da menor para a maior;
  - DuckDB com teto de memória e spill para disco;
  - retomável: UF com manifesto já gravado é pulada (use --refazer para forçar);
  - o CSV descompactado é temporário e apagado ao fim de cada UF.

Uso:
  python cnefe_para_parquet.py --zips DIR_DOS_ZIPS --saida DIR_SAIDA [--ufs RR,AP] [--memoria 3GB] [--threads 2]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import time
import zipfile
from pathlib import Path

import duckdb

RE_ZIP = re.compile(r"^(\d{2})_([A-Z]{2})\.zip$")
COLUNAS_ESPERADAS = {
    "COD_UNICO_ENDERECO", "COD_UF", "COD_MUNICIPIO", "NOM_SEGLOGR", "NUM_ENDERECO",
    "LATITUDE", "LONGITUDE", "NV_GEO_COORD", "CEP",
}


def sha256(caminho: Path, bloco: int = 8 << 20) -> str:
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        while chunk := f.read(bloco):
            h.update(chunk)
    return h.hexdigest()


def listar_zips(pasta: Path, ufs: set[str] | None) -> list[tuple[str, str, Path]]:
    out = []
    for p in pasta.iterdir():
        m = RE_ZIP.match(p.name)
        if m and (not ufs or m.group(2) in ufs):
            out.append((m.group(1), m.group(2), p))
    return sorted(out, key=lambda t: t[2].stat().st_size)  # menor primeiro


def extrair_csv(zip_path: Path, destino: Path) -> Path:
    with zipfile.ZipFile(zip_path) as z:
        csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
        if len(csvs) != 1:
            raise RuntimeError(f"{zip_path.name}: esperado 1 CSV, achei {csvs}")
        alvo = destino / Path(csvs[0]).name
        with z.open(csvs[0]) as src, open(alvo, "wb") as dst:
            shutil.copyfileobj(src, dst, 8 << 20)
    return alvo


def tamanho_por_municipio(pasta_uf: Path) -> dict[str, int]:
    tam: dict[str, int] = {}
    for d in pasta_uf.iterdir():
        if d.is_dir() and d.name.startswith("COD_MUNICIPIO="):
            cod = d.name.split("=", 1)[1]
            tam[cod] = sum(f.stat().st_size for f in d.rglob("*.parquet"))
    return dict(sorted(tam.items()))


def processar_uf(cod_uf: str, uf: str, zip_path: Path, saida: Path, tmp: Path,
                 memoria: str, threads: int) -> dict:
    t0 = time.monotonic()
    pasta_uf = saida / f"uf={uf}"
    if pasta_uf.exists():
        shutil.rmtree(pasta_uf)  # resto de execução interrompida

    print(f"[{uf}] hash do zip...", flush=True)
    hash_zip = sha256(zip_path)

    print(f"[{uf}] extraindo CSV...", flush=True)
    t_ext = time.monotonic()
    csv = extrair_csv(zip_path, tmp)
    seg_extracao = time.monotonic() - t_ext

    con = duckdb.connect()
    try:
        con.execute(f"SET memory_limit='{memoria}'")
        con.execute(f"SET threads={int(threads)}")
        con.execute(f"SET temp_directory='{(tmp / 'duckdb').as_posix()}'")
        con.execute("SET preserve_insertion_order=false")

        fonte = (
            f"read_csv('{csv.as_posix()}', delim=';', header=true, all_varchar=true, "
            f"encoding='latin-1', quote='', escape='')"
        )
        colunas = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {fonte}").fetchall()]
        faltando = COLUNAS_ESPERADAS - set(colunas)
        if faltando:
            raise RuntimeError(f"{uf}: colunas ausentes no CSV: {sorted(faltando)}")

        # Texto original preservado; lat/lon numéricos ao lado. TRY_CAST: valor
        # inválido vira NULL e é contado no manifesto (não some silenciosamente).
        print(f"[{uf}] gravando Parquet...", flush=True)
        t_cp = time.monotonic()
        con.execute(f"""
            COPY (
              SELECT *,
                     TRY_CAST(LATITUDE AS DOUBLE)  AS lat,
                     TRY_CAST(LONGITUDE AS DOUBLE) AS lon
              FROM {fonte}
            ) TO '{pasta_uf.as_posix()}'
            (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (COD_MUNICIPIO))
        """)
        seg_copy = time.monotonic() - t_cp

        glob = (pasta_uf / "**" / "*.parquet").as_posix()
        stats = con.execute(f"""
            SELECT count(*)                                        AS linhas,
                   count(DISTINCT COD_MUNICIPIO)                   AS municipios,
                   count(*) FILTER (WHERE lat IS NULL OR lon IS NULL) AS coord_invalida,
                   count(*) FILTER (WHERE NUM_ENDERECO IN ('0','') OR DSC_MODIFICADOR = 'SN') AS sem_numero
            FROM read_parquet('{glob}', hive_partitioning=true)
        """).fetchone()
        nv = dict(con.execute(f"""
            SELECT coalesce(NV_GEO_COORD, '?'), count(*)
            FROM read_parquet('{glob}', hive_partitioning=true) GROUP BY 1 ORDER BY 1
        """).fetchall())
        linhas_csv = con.execute(f"SELECT count(*) FROM {fonte}").fetchone()[0]
    finally:
        con.close()
        csv.unlink(missing_ok=True)
        shutil.rmtree(tmp / "duckdb", ignore_errors=True)

    if linhas_csv != stats[0]:
        raise RuntimeError(f"{uf}: CSV tem {linhas_csv} linhas, Parquet tem {stats[0]}")

    tam_mun = tamanho_por_municipio(pasta_uf)
    return {
        "uf": uf, "cod_uf": cod_uf,
        "zip": {"arquivo": zip_path.name, "bytes": zip_path.stat().st_size, "sha256": hash_zip},
        "csv_bytes": None,  # preenchido pelo chamador
        "linhas": stats[0], "municipios": stats[1],
        "coord_invalida": stats[2], "sem_numero": stats[3],
        "nv_geo_coord": nv,
        "parquet_bytes_total": sum(tam_mun.values()),
        "parquet_bytes_por_municipio": tam_mun,
        "segundos": {"extracao": round(seg_extracao, 1), "parquet": round(seg_copy, 1),
                     "total": round(time.monotonic() - t0, 1)},
        "duckdb": duckdb.__version__,
        "gerado_em": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zips", required=True, type=Path)
    ap.add_argument("--saida", required=True, type=Path)
    ap.add_argument("--ufs", default="", help="lista separada por vírgula (padrão: todas)")
    ap.add_argument("--memoria", default="3GB")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--refazer", action="store_true")
    a = ap.parse_args()

    ufs = {u.strip().upper() for u in a.ufs.split(",") if u.strip()} or None
    zips = listar_zips(a.zips, ufs)
    if not zips:
        print("nenhum zip encontrado", file=sys.stderr)
        return 1

    manif_dir = a.saida / "_manifesto"
    manif_dir.mkdir(parents=True, exist_ok=True)
    tmp = a.saida / "_tmp"
    tmp.mkdir(exist_ok=True)

    for cod_uf, uf, zp in zips:
        manif = manif_dir / f"{uf}.json"
        if manif.exists() and not a.refazer:
            print(f"[{uf}] já processada, pulando", flush=True)
            continue
        with zipfile.ZipFile(zp) as z:
            csv_bytes = sum(i.file_size for i in z.infolist() if i.filename.lower().endswith(".csv"))
        livre = shutil.disk_usage(a.saida).free
        if livre < csv_bytes * 1.6:
            print(f"[{uf}] espaço insuficiente: livre {livre>>30} GiB, precisa ~{(csv_bytes*1.6)//(1<<30)} GiB", file=sys.stderr)
            return 2
        try:
            r = processar_uf(cod_uf, uf, zp, a.saida, tmp, a.memoria, a.threads)
        except Exception as e:  # noqa: BLE001 — registra e para; UFs anteriores ficam
            print(f"[{uf}] FALHOU: {e}", file=sys.stderr)
            return 3
        r["csv_bytes"] = csv_bytes
        tmp_manif = manif.with_suffix(".json.tmp")
        tmp_manif.write_text(json.dumps(r, ensure_ascii=False, indent=2))
        os.replace(tmp_manif, manif)  # manifesto só existe se a UF terminou
        print(f"[{uf}] ok: {r['linhas']:,} linhas, {r['municipios']} municípios, "
              f"CSV {csv_bytes/1e6:.0f} MB -> Parquet {r['parquet_bytes_total']/1e6:.1f} MB, "
              f"{r['segundos']['total']}s", flush=True)

    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
