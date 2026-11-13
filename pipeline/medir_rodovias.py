"""Mede no Parquet do CNEFE como as rodovias aparecem, para generalizar o tratamento de rodovia do motor.

Perguntas:
  1. Quais prefixos de código de rodovia (BR, GO, SP, PR...) aparecem em NOM_SEGLOGR, por UF?
  2. Onde o km é gravado: NUM_ENDERECO, DSC_MODIFICADOR, NOM_COMP_ELEMn ou no próprio nome?
  3. Falsos positivos: vias que NÃO são rodovia mas cujo nome começa com "<2-3 letras> <número>".

Só lê o Parquet (somente as colunas necessárias). Grava CSVs em --saida e imprime um resumo.

Uso:
  python medir_rodovias.py --parquet ../parquet --saida ../medicoes/rodovias
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import duckdb

RE_PREFIXO = r"^([A-Z]{2,3})[ -]*([0-9]{2,3})([^0-9]|$)"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--parquet", required=True, type=Path)
    ap.add_argument("--saida", required=True, type=Path)
    ap.add_argument("--memoria", default="1500MB")
    ap.add_argument("--threads", type=int, default=1)
    a = ap.parse_args()

    pq, out = a.parquet.resolve(), a.saida.resolve()
    if out == pq or pq in out.parents:
        raise SystemExit("--saida não pode ficar dentro de --parquet")
    out.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute(f"SET memory_limit='{a.memoria}'; SET threads={a.threads}; SET preserve_insertion_order=false;")
    tmp = out / "_tmp_duckdb"
    con.execute(f"SET temp_directory='{tmp.as_posix()}'")

    glob = (pq / "uf=*" / "COD_MUNICIPIO=*" / "*.parquet").as_posix()
    comp_km = " OR ".join(f"upper(trim(coalesce(NOM_COMP_ELEM{i}, ''))) LIKE 'KM%'" for i in range(1, 6))
    t0 = time.time()
    con.execute(f"""
      CREATE TEMP TABLE r AS
      SELECT uf,
             upper(trim(coalesce(NOM_TIPO_SEGLOGR, ''))) AS tipo,
             upper(trim(coalesce(NOM_SEGLOGR, '')))      AS nome,
             trim(coalesce(NUM_ENDERECO, ''))            AS num,
             upper(trim(coalesce(DSC_MODIFICADOR, ''))) AS modif,
             ({comp_km})                                 AS km_comp,
             regexp_extract(upper(trim(coalesce(NOM_SEGLOGR, ''))), '{RE_PREFIXO}', 1) AS prefixo
      FROM read_parquet('{glob}', hive_partitioning = true)
      -- Só materializa o que interessa (rodovias e nomes com cara de código): a tabela inteira
      -- (111 M linhas com texto) estoura a memória de um notebook de 11 GB.
      WHERE upper(coalesce(NOM_TIPO_SEGLOGR, '')) LIKE '%ROD%'
         OR upper(coalesce(NOM_TIPO_SEGLOGR, '')) LIKE 'ESTRADA%'
         OR regexp_matches(upper(trim(coalesce(NOM_SEGLOGR, ''))), '{RE_PREFIXO}')
    """)
    print(f"leitura: {time.time() - t0:.0f}s", flush=True)

    # 1) prefixos em vias do tipo RODOVIA, por UF
    con.execute("""
      COPY (
        SELECT uf, CASE WHEN prefixo = '' THEN '(sem prefixo)' ELSE prefixo END AS prefixo, count(*) AS linhas,
               count(DISTINCT nome) AS vias
        FROM r WHERE tipo LIKE 'RODOVIA%'
        GROUP BY ALL ORDER BY uf, linhas DESC
      ) TO '""" + (out / "prefixos_rodovia.csv").as_posix() + "' (HEADER)")

    # 2) onde o km está gravado (só tipo RODOVIA)
    con.execute("""
      COPY (
        SELECT uf, count(*) AS linhas,
          count(*) FILTER (WHERE num NOT IN ('', '0'))                AS com_numero,
          count(*) FILTER (WHERE modif LIKE '%KM%')                   AS km_no_modificador,
          count(*) FILTER (WHERE km_comp)                             AS km_no_complemento,
          count(*) FILTER (WHERE regexp_matches(nome, '\\bKM\\b'))    AS km_no_nome,
          count(*) FILTER (WHERE num NOT IN ('', '0') AND NOT km_comp AND modif NOT LIKE '%KM%') AS numero_sem_km_explicito
        FROM r WHERE tipo LIKE 'RODOVIA%'
        GROUP BY uf ORDER BY uf
      ) TO '""" + (out / "km_rodovia.csv").as_posix() + "' (HEADER)")

    con.execute("""
      COPY (
        SELECT uf, modif, count(*) AS linhas FROM r
        WHERE tipo LIKE 'RODOVIA%' AND modif <> ''
        GROUP BY uf, modif QUALIFY row_number() OVER (PARTITION BY uf ORDER BY count(*) DESC) <= 10
        ORDER BY uf, linhas DESC
      ) TO '""" + (out / "modificadores_rodovia.csv").as_posix() + "' (HEADER)")

    # 3) falsos positivos: nome com cara de código de rodovia em via que não é rodovia
    con.execute("""
      COPY (
        SELECT uf, tipo, prefixo, count(*) AS linhas, count(DISTINCT nome) AS vias,
               list(DISTINCT nome)[1:5] AS exemplos
        FROM r WHERE prefixo <> '' AND tipo NOT LIKE 'RODOVIA%'
        GROUP BY ALL ORDER BY linhas DESC
      ) TO '""" + (out / "falsos_positivos.csv").as_posix() + "' (HEADER)")

    resumo = {
        "tempo_s": round(time.time() - t0),
        "linhas_materializadas": con.execute("SELECT count(*) FROM r").fetchone()[0],
        "linhas_rodovia": con.execute("SELECT count(*) FROM r WHERE tipo LIKE 'RODOVIA%'").fetchone()[0],
        "tipos_com_rod": con.execute(
            "SELECT tipo, count(*) FROM r WHERE tipo LIKE '%ROD%' OR tipo LIKE 'ESTRADA%' GROUP BY 1 ORDER BY 2 DESC LIMIT 10"
        ).fetchall(),
        "prefixos_rodovia_pais": con.execute(
            "SELECT prefixo, count(*) AS n, count(DISTINCT uf) AS ufs FROM r WHERE tipo LIKE 'RODOVIA%' "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 40"
        ).fetchall(),
        "km_pais": con.execute("""
            SELECT count(*), count(*) FILTER (WHERE num NOT IN ('', '0')),
                   count(*) FILTER (WHERE modif LIKE '%KM%'), count(*) FILTER (WHERE km_comp),
                   count(*) FILTER (WHERE regexp_matches(nome, '\\bKM\\b'))
            FROM r WHERE tipo LIKE 'RODOVIA%'""").fetchone(),
        "falsos_positivos_top": con.execute(
            "SELECT tipo, prefixo, count(*) AS n, count(DISTINCT nome) AS vias, list(DISTINCT nome)[1:3] "
            "FROM r WHERE prefixo <> '' AND tipo NOT LIKE 'RODOVIA%' GROUP BY ALL ORDER BY n DESC LIMIT 25"
        ).fetchall(),
    }
    (out / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=1, default=str))
    print(json.dumps(resumo, ensure_ascii=False, indent=1, default=str))
    con.close()
    for f in tmp.glob("*"):
        f.unlink()
    if tmp.exists():
        tmp.rmdir()


if __name__ == "__main__":
    main()
