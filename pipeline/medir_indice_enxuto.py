#!/usr/bin/env python3
"""Mede o tamanho do índice "enxuto" por município, a partir do Parquet sem perda.

O índice enxuto reproduz o dicionário do motor do NEXO ({via: [entradas]}), isto é,
só o que o motor usa, deduplicado por (via, tp, n, q, l, b, c, la, lo, g) com contagem k,
descartando NV_GEO_COORD >= 5. Este script NÃO é o formato final de distribuição: serve
para dimensionar o problema (quantas entradas e quantos bytes por município).

Somente leitura sobre --parquet. Escreve apenas em --saida (outra pasta).

Fases:
  1  métricas por município via SQL: entradas, vias, bytes de JSON estimados (retomável)
  2  amostra: gera o JSON de verdade para os maiores municípios e alguns de tamanho
     médio e mede o gzip real; calibra a razão gzip/JSON
  3  resumo: estima o gzip de todos os municípios com a razão medida (summary.json)

Uso:
  python medir_indice_enxuto.py --parquet DIR_PARQUET --saida DIR_SAIDA [--fase todas]
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import statistics
import sys
import time
from pathlib import Path

import duckdb

CAMPOS = ["tp", "n", "q", "l", "b", "c", "la", "lo", "g", "k"]


def _norm_num(expr: str) -> str:
    # normNum do geo_core: minúsculas, zeros à esquerda fora, número com 1 letra opcional
    return f"nullif(regexp_extract(lower(trim({expr})), '^0*([0-9]+[a-z]?)', 1), '')"


def _comp(nome: str) -> str:
    partes = [
        f"CASE WHEN upper(trim(NOM_COMP_ELEM{i})) = '{nome}' THEN VAL_COMP_ELEM{i} END"
        for i in range(1, 6)
    ]
    return "coalesce(" + ", ".join(partes) + ")"


def sql_entradas(glob: str) -> str:
    """Entradas deduplicadas (equivalente a entradaDeLinhaCnefe + dedup por k)."""
    return f"""
    WITH b AS (
      SELECT
        lower(trim(concat_ws(' ', nullif(NOM_TITULO_SEGLOGR, ''), nullif(NOM_SEGLOGR, '')))) AS via,
        lower(trim(coalesce(NOM_TIPO_SEGLOGR, '')))                                         AS tp,
        CASE WHEN coalesce(DSC_MODIFICADOR, '') = 'SN' OR coalesce(NUM_ENDERECO, '') IN ('', '0')
             THEN NULL ELSE {_norm_num('NUM_ENDERECO')} END                                  AS n,
        {_norm_num(_comp('QUADRA'))}                                                         AS q,
        {_norm_num(_comp('LOTE'))}                                                           AS l,
        lower(trim(coalesce(DSC_LOCALIDADE, '')))                                            AS b,
        regexp_replace(coalesce(CEP, ''), '[^0-9]', '', 'g')                                 AS c,
        lat AS la, lon AS lo,
        TRY_CAST(NV_GEO_COORD AS INTEGER)                                                    AS g
      FROM read_parquet('{glob}')
    ), f AS (
      SELECT * FROM b
      WHERE via <> '' AND la IS NOT NULL AND lo IS NOT NULL AND coalesce(g, 1) < 5
    )
    SELECT via, tp, n, q, l, b, c, la, lo, g, count(*)::INTEGER AS k
    FROM f GROUP BY ALL
    """


def listar_municipios(parquet: Path, ufs: set[str] | None) -> list[tuple[str, str, Path]]:
    out = []
    for duf in sorted(parquet.glob("uf=*")):
        uf = duf.name.split("=", 1)[1]
        if ufs and uf not in ufs:
            continue
        for dm in sorted(duf.glob("COD_MUNICIPIO=*")):
            out.append((uf, dm.name.split("=", 1)[1], dm))
    return out


def conectar(saida: Path, memoria: str, threads: int) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute(f"SET memory_limit='{memoria}'")
    con.execute(f"SET threads={int(threads)}")
    tmp = saida / "_tmp_duckdb"
    tmp.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET temp_directory='{tmp.as_posix()}'")
    con.execute("SET preserve_insertion_order=false")
    return con


def fase1(parquet: Path, saida: Path, memoria: str, threads: int, ufs: set[str] | None) -> Path:
    destino = saida / "metricas_municipio.csv"
    cab = ["uf", "cod_municipio", "linhas_cnefe", "entradas", "vias", "json_bytes_estimado", "segundos"]
    feitos: set[str] = set()
    if destino.exists():
        with open(destino, newline="", encoding="utf-8") as f:
            feitos = {r["cod_municipio"] for r in csv.DictReader(f)}
    novo = not destino.exists()
    con = conectar(saida, memoria, threads)
    munis = listar_municipios(parquet, ufs)
    print(f"[fase1] {len(munis)} municípios, {len(feitos)} já medidos", flush=True)
    t_ini = time.monotonic()
    uf_atual = None
    with open(destino, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if novo:
            w.writerow(cab)
        for i, (uf, cod, pasta) in enumerate(munis, 1):
            if cod in feitos:
                continue
            if uf != uf_atual:
                uf_atual = uf
                print(f"[fase1] {uf} ({i}/{len(munis)}, {time.monotonic() - t_ini:.0f}s)", flush=True)
            t0 = time.monotonic()
            glob = (pasta / "*.parquet").as_posix()
            linhas = con.execute(f"SELECT count(*) FROM read_parquet('{glob}')").fetchone()[0]
            ent, vias, jb = con.execute(f"""
              WITH e AS ({sql_entradas(glob)})
              SELECT count(*),
                     count(DISTINCT via),
                     coalesce(sum(length(to_json(struct_pack(
                       tp := tp, n := n, q := q, l := l, b := b, c := c,
                       la := la, lo := lo, g := g, k := k))) + 1), 0)
              FROM e
            """).fetchone()
            w.writerow([uf, cod, linhas, ent, vias, int(jb), round(time.monotonic() - t0, 2)])
            f.flush()
    con.close()
    print(f"[fase1] ok em {time.monotonic() - t_ini:.0f}s", flush=True)
    return destino


def ler_metricas(saida: Path) -> list[dict]:
    with open(saida / "metricas_municipio.csv", newline="", encoding="utf-8") as f:
        linhas = list(csv.DictReader(f))
    for r in linhas:
        for k in ("linhas_cnefe", "entradas", "vias", "json_bytes_estimado"):
            r[k] = int(r[k])
    return linhas


def gerar_dicionario_gz(con, pasta: Path, destino: Path) -> tuple[int, int, int]:
    """Escreve {via:[{...}]} compacto em gzip (nível 6). Retorna (json_bytes, gz_bytes, entradas)."""
    glob = (pasta / "*.parquet").as_posix()
    cur = con.execute(f"SELECT * FROM ({sql_entradas(glob)}) ORDER BY via")
    bruto = 0
    entradas = 0
    with gzip.open(destino, "wb", compresslevel=6) as gz:
        def escrever(b: bytes) -> None:
            nonlocal bruto
            bruto += len(b)
            gz.write(b)

        escrever(b"{")
        via_atual = None
        primeira_via = True
        buf: list[str] = []
        while True:
            lote = cur.fetchmany(100_000)
            if not lote:
                break
            for via, tp, n, q, l, b, c, la, lo, g, k in lote:
                if via != via_atual:
                    if via_atual is not None:
                        escrever(("".join(buf) + "]").encode("utf-8"))
                        buf = []
                    sep = "" if primeira_via else ","
                    primeira_via = False
                    buf.append(sep + json.dumps(via, ensure_ascii=False) + ":[")
                    via_atual = via
                    primeira_entrada = True
                else:
                    primeira_entrada = False
                obj = json.dumps(
                    {"tp": tp, "n": n, "q": q, "l": l, "b": b, "c": c, "la": la, "lo": lo, "g": g, "k": k},
                    separators=(",", ":"), ensure_ascii=False,
                )
                buf.append(obj if primeira_entrada else "," + obj)
                entradas += 1
            if len(buf) > 50_000:
                escrever("".join(buf).encode("utf-8"))
                buf = []
        if via_atual is not None:
            escrever(("".join(buf) + "]").encode("utf-8"))
        escrever(b"}")
    return bruto, destino.stat().st_size, entradas


def tamanho_pasta(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*.parquet"))


def fase2(parquet: Path, saida: Path, memoria: str, threads: int, n_top: int, n_extra: int) -> Path:
    met = sorted(ler_metricas(saida), key=lambda r: r["json_bytes_estimado"], reverse=True)
    met = [r for r in met if r["entradas"] > 0]
    escolhidos = met[:n_top]
    resto = met[n_top:]
    if resto and n_extra > 0:
        passo = max(1, len(resto) // n_extra)
        escolhidos += resto[::passo][:n_extra]
    destino = saida / "amostra_gzip.csv"
    cab = ["uf", "cod_municipio", "entradas", "json_bytes_estimado", "json_bytes_real",
           "gzip_bytes", "razao_gzip_json", "parquet_sem_perda_bytes", "segundos"]
    con = conectar(saida, memoria, threads)
    tmp_gz = saida / "_amostra.json.gz"
    with open(destino, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cab)
        for r in escolhidos:
            pasta = parquet / f"uf={r['uf']}" / f"COD_MUNICIPIO={r['cod_municipio']}"
            t0 = time.monotonic()
            bruto, gz, ent = gerar_dicionario_gz(con, pasta, tmp_gz)
            w.writerow([r["uf"], r["cod_municipio"], ent, r["json_bytes_estimado"], bruto, gz,
                        round(gz / bruto, 4), tamanho_pasta(pasta), round(time.monotonic() - t0, 1)])
            f.flush()
            print(f"[fase2] {r['uf']} {r['cod_municipio']}: {ent:,} entradas, "
                  f"JSON {bruto/1e6:.1f} MB -> gzip {gz/1e6:.1f} MB", flush=True)
    tmp_gz.unlink(missing_ok=True)
    con.close()
    return destino


def pct(vals: list[float], p: float) -> float:
    s = sorted(vals)
    return s[min(len(s) - 1, int(p * len(s)))] if s else 0.0


def fase3(saida: Path) -> Path:
    met = ler_metricas(saida)
    with open(saida / "amostra_gzip.csv", newline="", encoding="utf-8") as f:
        am = list(csv.DictReader(f))
    razoes = [float(r["razao_gzip_json"]) for r in am]
    erro_est = [int(r["json_bytes_real"]) / int(r["json_bytes_estimado"]) for r in am if int(r["json_bytes_estimado"])]
    r_med = statistics.median(razoes)
    r_min, r_max = min(razoes), max(razoes)
    # JSON real = estimado * fator (o estimado ignora chaves de via e pontuação entre entradas de via)
    fator = statistics.median(erro_est) if erro_est else 1.0

    for r in met:
        r["json_real_est"] = int(r["json_bytes_estimado"] * fator)
        r["gz_est"] = int(r["json_real_est"] * r_med)
    gz = [r["gz_est"] for r in met if r["entradas"] > 0]

    por_uf: dict[str, dict] = {}
    for r in met:
        u = por_uf.setdefault(r["uf"], {"municipios": 0, "linhas_cnefe": 0, "entradas": 0, "gzip_estimado_bytes": 0})
        u["municipios"] += 1
        u["linhas_cnefe"] += r["linhas_cnefe"]
        u["entradas"] += r["entradas"]
        u["gzip_estimado_bytes"] += r["gz_est"]

    limiares = {"acima_de_0_5_MB": 5e5, "acima_de_1_MB": 1e6, "acima_de_5_MB": 5e6, "acima_de_20_MB": 2e7}
    top = sorted(met, key=lambda r: r["gz_est"], reverse=True)[:15]
    linhas_total = sum(r["linhas_cnefe"] for r in met)
    ent_total = sum(r["entradas"] for r in met)
    resumo = {
        "municipios": len(met),
        "linhas_cnefe": linhas_total,
        "entradas_apos_dedup_e_filtro": ent_total,
        "reducao_de_linhas": round(1 - ent_total / linhas_total, 4) if linhas_total else None,
        "calibracao": {
            "municipios_amostrados": len(am),
            "razao_gzip_sobre_json": {"mediana": round(r_med, 4), "min": round(r_min, 4), "max": round(r_max, 4)},
            "fator_json_real_sobre_estimado": round(fator, 4),
            "aviso": "gzip dos demais municípios é ESTIMADO com a razão mediana da amostra; "
                     "o intervalo [min,max] da razão dá a incerteza.",
        },
        "gzip_estimado_total_bytes": sum(gz),
        "gzip_estimado_por_municipio_bytes": {
            "p50": int(pct(gz, 0.5)), "p90": int(pct(gz, 0.9)), "p99": int(pct(gz, 0.99)), "max": max(gz) if gz else 0},
        "municipios_por_faixa": {k: sum(1 for v in gz if v > lim) for k, lim in limiares.items()},
        "maiores_municipios": [
            {"uf": r["uf"], "cod_municipio": r["cod_municipio"], "entradas": r["entradas"],
             "vias": r["vias"], "gzip_estimado_bytes": r["gz_est"]} for r in top],
        "por_uf": por_uf,
    }
    destino = saida / "summary.json"
    destino.write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in resumo.items() if k not in ("por_uf",)}, ensure_ascii=False, indent=2))
    return destino


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", required=True, type=Path)
    ap.add_argument("--saida", required=True, type=Path)
    ap.add_argument("--fase", default="todas", choices=["1", "2", "3", "todas"])
    ap.add_argument("--ufs", default="", help="só fase 1: lista separada por vírgula")
    ap.add_argument("--memoria", default="3GB")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--amostra-top", type=int, default=10, help="maiores municípios medidos com gzip real")
    ap.add_argument("--amostra-extra", type=int, default=15, help="municípios espalhados pelo ranking")
    a = ap.parse_args()

    if a.saida.resolve() == a.parquet.resolve() or a.parquet.resolve() in a.saida.resolve().parents:
        print("--saida não pode ficar dentro de --parquet", file=sys.stderr)
        return 1
    a.saida.mkdir(parents=True, exist_ok=True)
    ufs = {u.strip().upper() for u in a.ufs.split(",") if u.strip()} or None
    if a.fase in ("1", "todas"):
        fase1(a.parquet, a.saida, a.memoria, a.threads, ufs)
    if a.fase in ("2", "todas"):
        fase2(a.parquet, a.saida, a.memoria, a.threads, a.amostra_top, a.amostra_extra)
    if a.fase in ("3", "todas"):
        fase3(a.saida)
    return 0


if __name__ == "__main__":
    sys.exit(main())
