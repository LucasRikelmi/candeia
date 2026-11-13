#!/usr/bin/env python3
"""Gera o índice de distribuição por município a partir do Parquet do CNEFE.

Formato (decisão: arquivo por município, fatiado só nos grandes):
  <saida>/<UF>/<cod>.json.gz                município pequeno: dicionário {via: [entradas]}
  <saida>/<UF>/<cod>/index.json.gz          município grande: índice de vias
  <saida>/<UF>/<cod>/fNNN.json.gz           município grande: fatias, cada via inteira em UMA fatia
  <saida>/manifesto.json                    tipo, entradas, vias e (nome, bytes, sha256) de cada arquivo

As entradas usam as chaves do dicionário do NEXO (tp, n, q, l, b, c, la, lo, g, k) para o motor
consumir direto. As chaves de via vêm de normacao idêntica à do motor (ver normalizacao.py).

Índice de vias de um município fatiado:
  {"v":1, "cod", "entradas", "centroide":[lat,lon], "vias":{chave:[fatia, n_entradas]},
   "ceps":{cep:[bairro_majoritario, n_entradas, [fatias]]}}

Somente leitura sobre --parquet. Escreve só em --saida (que não pode ficar dentro de --parquet).
Retomável por UF (manifesto em _manifesto/<UF>.json).
"""
from __future__ import annotations

import argparse
import functools
import gzip
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
from normalizacao import chave_via, norm_num, normalize_base  # noqa: E402

VERSAO_FORMATO = 1
ENC = json.JSONEncoder(separators=(",", ":"), ensure_ascii=False).encode
ORDEM = "via, tp, n NULLS FIRST, q NULLS FIRST, l NULLS FIRST, b, c, la, lo, g NULLS FIRST"


def _registrar_udfs(con: duckdb.DuckDBPyConnection) -> None:
    V = duckdb.sqltypes.VARCHAR
    cache = functools.lru_cache(maxsize=None)
    con.create_function("py_norm_base", cache(lambda s: normalize_base(s)), [V], V)
    con.create_function("py_norm_num", cache(lambda s: norm_num(s) or ""), [V], V)
    con.create_function("py_chave_via", cache(lambda t, s: chave_via(t, s)), [V, V], V)


def _comp(nome: str) -> str:
    partes = [f"CASE WHEN upper(trim(coalesce(NOM_COMP_ELEM{i}, ''))) = '{nome}' THEN VAL_COMP_ELEM{i} END"
              for i in range(1, 6)]
    return "coalesce(" + ", ".join(partes) + ")"


def criar_tabela_entradas(con: duckdb.DuckDBPyConnection, glob: str) -> None:
    """Tabela temporária `e`: entradas deduplicadas (equivale a entradaDeLinhaCnefe + dedup por k).

    As funções py_* rodam sobre valores DISTINTOS (tabelas de mapa), não sobre cada linha.
    """
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE raw AS
      SELECT coalesce(NOM_TITULO_SEGLOGR, '') AS t, coalesce(NOM_SEGLOGR, '') AS s,
             coalesce(NOM_TIPO_SEGLOGR, '')    AS tp0, coalesce(DSC_LOCALIDADE, '') AS b0,
             coalesce(CEP, '')                 AS cep0,
             trim(coalesce(NUM_ENDERECO, ''))  AS num0, upper(trim(coalesce(DSC_MODIFICADOR, ''))) AS mod0,
             coalesce({_comp('QUADRA')}, '')   AS q0, coalesce({_comp('LOTE')}, '') AS l0,
             lat, lon, TRY_CAST(NV_GEO_COORD AS INTEGER) AS g
      FROM read_parquet('{glob}')
      WHERE lat IS NOT NULL AND lon IS NOT NULL AND coalesce(TRY_CAST(NV_GEO_COORD AS INTEGER), 1) < 5
    """)
    con.execute("CREATE OR REPLACE TEMP TABLE m_via AS SELECT t, s, py_chave_via(t, s) AS via FROM (SELECT DISTINCT t, s FROM raw)")
    con.execute("CREATE OR REPLACE TEMP TABLE m_tp  AS SELECT tp0, py_norm_base(tp0) AS tp FROM (SELECT DISTINCT tp0 FROM raw)")
    con.execute("CREATE OR REPLACE TEMP TABLE m_b   AS SELECT b0, py_norm_base(b0) AS b FROM (SELECT DISTINCT b0 FROM raw)")
    con.execute("CREATE OR REPLACE TEMP TABLE m_n   AS SELECT num0, py_norm_num(num0) AS n FROM (SELECT DISTINCT num0 FROM raw)")
    con.execute("CREATE OR REPLACE TEMP TABLE m_q   AS SELECT q0, py_norm_num(q0) AS q FROM (SELECT DISTINCT q0 FROM raw)")
    con.execute("CREATE OR REPLACE TEMP TABLE m_l   AS SELECT l0, py_norm_num(l0) AS l FROM (SELECT DISTINCT l0 FROM raw)")
    con.execute(f"""
      CREATE OR REPLACE TEMP TABLE e AS
      SELECT mv.via, mt.tp,
             CASE WHEN r.mod0 = 'SN' OR r.num0 IN ('', '0') THEN NULL ELSE nullif(mn.n, '') END AS n,
             nullif(mq.q, '') AS q, nullif(ml.l, '') AS l, mb.b,
             regexp_replace(r.cep0, '[^0-9]', '', 'g') AS c,
             r.lat AS la, r.lon AS lo, r.g, count(*)::INTEGER AS k
      FROM raw r
      JOIN m_via mv ON mv.t = r.t AND mv.s = r.s
      JOIN m_tp  mt ON mt.tp0 = r.tp0
      JOIN m_b   mb ON mb.b0 = r.b0
      JOIN m_n   mn ON mn.num0 = r.num0
      JOIN m_q   mq ON mq.q0 = r.q0
      JOIN m_l   ml ON ml.l0 = r.l0
      WHERE mv.via <> ''
      GROUP BY ALL
    """)


class GzDet:
    """gzip determinístico (mtime=0, sem nome) que conta bytes brutos e calcula o sha256 do arquivo."""

    def __init__(self, caminho: Path):
        caminho.parent.mkdir(parents=True, exist_ok=True)
        self.caminho = caminho
        self._f = open(caminho, "wb")
        self._gz = gzip.GzipFile(filename="", mode="wb", fileobj=self._f, compresslevel=6, mtime=0)
        self.bruto = 0

    def escrever(self, s: str) -> None:
        b = s.encode("utf-8")
        self.bruto += len(b)
        self._gz.write(b)

    def fechar(self) -> dict:
        self._gz.close()
        self._f.close()
        h = hashlib.sha256()
        with open(self.caminho, "rb") as f:
            for bloco in iter(lambda: f.read(1 << 20), b""):
                h.update(bloco)
        return {"bytes": self.caminho.stat().st_size, "bytes_json": self.bruto, "sha256": h.hexdigest()}


def escrever_dicionario(gz: GzDet, linhas) -> tuple[int, int]:
    """Escreve {via:[entradas]} a partir de linhas ordenadas por via. Retorna (vias, entradas)."""
    gz.escrever("{")
    via_atual = None
    vias = entradas = 0
    buf: list[str] = []
    for via, tp, n, q, l, b, c, la, lo, g, k in linhas:
        if via != via_atual:
            if via_atual is not None:
                buf.append("],")
            buf.append(ENC(via) + ":[")
            via_atual = via
            vias += 1
            primeira = True
        else:
            primeira = False
        obj = ENC({"tp": tp, "n": n, "q": q, "l": l, "b": b, "c": c, "la": la, "lo": lo, "g": g, "k": k})
        buf.append(obj if primeira else "," + obj)
        entradas += 1
        if len(buf) >= 20_000:
            gz.escrever("".join(buf))
            buf = []
    if via_atual is not None:
        buf.append("]")
    buf.append("}")
    gz.escrever("".join(buf))
    return vias, entradas


def agrupar_por_via(cur):
    """Itera `cur` (linhas com `fatia` na posição 0) agrupando por fatia."""
    atual = None
    lote: list = []
    for row in cur:
        if row[0] != atual and lote:
            yield atual, lote
            lote = []
        atual = row[0]
        lote.append(row[1:])
    if lote:
        yield atual, lote


def processar_municipio(con, uf: str, cod: str, pasta_pq: Path, saida: Path,
                        limiar: int, por_fatia: int) -> dict:
    glob = (pasta_pq / "*.parquet").as_posix()
    criar_tabela_entradas(con, glob)
    total, n_vias = con.execute("SELECT count(*), count(DISTINCT via) FROM e").fetchone()
    base = saida / uf
    if total == 0:
        return {"uf": uf, "tipo": "vazio", "entradas": 0, "vias": 0, "arquivos": []}

    if total <= limiar:
        gz = GzDet(base / f"{cod}.json.gz")
        cur = con.execute(f"SELECT * FROM e ORDER BY {ORDEM}")
        def linhas():
            while True:
                lote = cur.fetchmany(50_000)
                if not lote:
                    return
                yield from lote
        escrever_dicionario(gz, linhas())
        info = gz.fechar()
        return {"uf": uf, "tipo": "unico", "entradas": total, "vias": n_vias,
                "arquivos": [{"nome": f"{cod}.json.gz", **info}]}

    # --- fatiado: cada via inteira em uma fatia; fatias consecutivas por chave de via ordenada ---
    con.execute("CREATE OR REPLACE TEMP TABLE vc AS SELECT via, count(*)::INTEGER AS n FROM e GROUP BY via")
    fatia = 0
    acumulado = 0
    mapa: list[tuple[str, int]] = []
    for via, n in con.execute("SELECT via, n FROM vc ORDER BY via").fetchall():
        if acumulado and acumulado + n > por_fatia:
            fatia += 1
            acumulado = 0
        mapa.append((via, fatia))
        acumulado += n
    con.execute("CREATE OR REPLACE TEMP TABLE vf(via VARCHAR, fatia INTEGER)")
    con.executemany("INSERT INTO vf VALUES (?, ?)", mapa)
    n_fatias = fatia + 1

    pasta = base / cod
    arquivos = []
    cur = con.execute(f"SELECT vf.fatia, e.* FROM e JOIN vf USING (via) ORDER BY vf.fatia, {ORDEM.replace('via,', 'e.via,', 1)}")
    def stream():
        while True:
            lote = cur.fetchmany(50_000)
            if not lote:
                return
            yield from lote
    for f_id, linhas in agrupar_por_via(stream()):
        nome = f"f{f_id:03d}.json.gz"
        gz = GzDet(pasta / nome)
        escrever_dicionario(gz, iter(linhas))
        arquivos.append({"nome": nome, **gz.fechar()})

    vias_idx = {v: [f, n] for (v, f), (_, n) in zip(mapa, con.execute("SELECT via, n FROM vc ORDER BY via").fetchall())}
    ceps = {}
    for c, bairro, n, fatias in con.execute("""
        WITH cb AS (SELECT c, b, count(*) AS nb FROM e WHERE c <> '' AND b <> '' GROUP BY c, b),
             maj AS (SELECT c, b FROM cb QUALIFY row_number() OVER (PARTITION BY c ORDER BY nb DESC, b) = 1),
             tot AS (SELECT e.c, count(*) AS n, list(DISTINCT vf.fatia ORDER BY vf.fatia) AS fatias
                     FROM e JOIN vf USING (via) WHERE e.c <> '' GROUP BY e.c)
        SELECT tot.c, coalesce(maj.b, ''), tot.n, tot.fatias FROM tot LEFT JOIN maj USING (c) ORDER BY tot.c
    """).fetchall():
        ceps[c] = [bairro, n, fatias]
    la, lo = con.execute("SELECT sum(la * k) / sum(k), sum(lo * k) / sum(k) FROM e").fetchone()
    indice = {"v": VERSAO_FORMATO, "cod": cod, "entradas": total, "fatias": n_fatias,
              "centroide": [round(la, 6), round(lo, 6)], "vias": vias_idx, "ceps": ceps}
    gz = GzDet(pasta / "index.json.gz")
    gz.escrever(ENC(indice))
    info_idx = gz.fechar()
    arquivos.insert(0, {"nome": "index.json.gz", **info_idx})
    return {"uf": uf, "tipo": "fatiado", "entradas": total, "vias": n_vias, "fatias": n_fatias,
            "arquivos": arquivos}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--parquet", required=True, type=Path)
    ap.add_argument("--saida", required=True, type=Path)
    ap.add_argument("--ufs", default="")
    ap.add_argument("--municipios", default="", help="códigos IBGE separados por vírgula (teste)")
    ap.add_argument("--limiar-entradas", type=int, default=90_000,
                    help="acima disso o município é fatiado (~1 MB de gzip)")
    ap.add_argument("--entradas-por-fatia", type=int, default=50_000)
    ap.add_argument("--memoria", default="3GB")
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--refazer", action="store_true")
    a = ap.parse_args()

    pq, out = a.parquet.resolve(), a.saida.resolve()
    if out == pq or pq in out.parents:
        print("--saida não pode ficar dentro de --parquet", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "_manifesto").mkdir(exist_ok=True)
    ufs = {u.strip().upper() for u in a.ufs.split(",") if u.strip()}
    cods = {c.strip() for c in a.municipios.split(",") if c.strip()}

    con = duckdb.connect()
    con.execute(f"SET memory_limit='{a.memoria}'")
    con.execute(f"SET threads={int(a.threads)}")
    tmp = out / "_tmp_duckdb"
    tmp.mkdir(exist_ok=True)
    con.execute(f"SET temp_directory='{tmp.as_posix()}'")
    _registrar_udfs(con)

    t_ini = time.monotonic()
    for duf in sorted(pq.glob("uf=*")):
        uf = duf.name.split("=", 1)[1]
        if ufs and uf not in ufs:
            continue
        mf = out / "_manifesto" / f"{uf}.json"
        if mf.exists() and not a.refazer:
            print(f"[{uf}] já gerada, pulando", flush=True)
            continue
        if (out / uf).exists():
            shutil.rmtree(out / uf)
        t0 = time.monotonic()
        res: dict[str, dict] = {}
        for dm in sorted(duf.glob("COD_MUNICIPIO=*")):
            cod = dm.name.split("=", 1)[1]
            if cods and cod not in cods:
                continue
            r = processar_municipio(con, uf, cod, dm, out, a.limiar_entradas, a.entradas_por_fatia)
            res[cod] = r
            if r["tipo"] == "fatiado":
                idx = r["arquivos"][0]
                maior = max(x["bytes"] for x in r["arquivos"][1:])
                print(f"[{uf}] {cod} fatiado: {r['entradas']:,} entradas, {r['vias']:,} vias, {r['fatias']} fatias; "
                      f"índice {idx['bytes']/1e3:.0f} KB, maior fatia {maior/1e3:.0f} KB", flush=True)
        tmp_mf = mf.with_suffix(".json.tmp")
        tmp_mf.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
        tmp_mf.replace(mf)
        tot = sum(sum(x["bytes"] for x in r["arquivos"]) for r in res.values())
        print(f"[{uf}] ok: {len(res)} municípios, {tot/1e6:.1f} MB gzip, {time.monotonic()-t0:.0f}s", flush=True)

    todos = {}
    for mf in sorted((out / "_manifesto").glob("*.json")):
        todos.update(json.loads(mf.read_text(encoding="utf-8")))
    (out / "manifesto.json").write_text(
        json.dumps({"versao_formato": VERSAO_FORMATO, "limiar_entradas": a.limiar_entradas,
                    "entradas_por_fatia": a.entradas_por_fatia, "municipios": todos},
                   ensure_ascii=False), encoding="utf-8")
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[fim] {len(todos)} municípios no manifesto, {time.monotonic()-t_ini:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
