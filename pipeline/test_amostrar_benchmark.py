"""Testes do amostrar_benchmark.py: sorteio determinístico e dicionário fatiado reconstituído."""
from __future__ import annotations

import csv
import gzip
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb

from test_gerar_indice import COLS, linha

AQUI = Path(__file__).resolve().parent
COD = "5300108"  # DF: uma UF com um município só (a capital)


def parquet_com_id(linhas: list[dict], destino: Path) -> None:
    con = duckdb.connect()
    cols = ["COD_UNICO_ENDERECO"] + COLS
    con.execute("CREATE TABLE t(" + ", ".join(f"{c} VARCHAR" for c in cols) + ", lat DOUBLE, lon DOUBLE)")
    for i, r in enumerate(linhas):
        con.execute(f"INSERT INTO t VALUES ({', '.join('?' for _ in cols)}, ?, ?)",
                    [f"ID{i:05d}"] + [r.get(c) for c in COLS] + [-15 + i / 1e5, -47.0])
    destino.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY t TO '{destino.as_posix()}' (FORMAT parquet)")
    con.close()


def rodar(script: str, *args: str) -> None:
    r = subprocess.run([sys.executable, str(AQUI / script), *args], capture_output=True, text=True, cwd=AQUI)
    assert r.returncode == 0, r.stderr


class Amostra(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        linhas = []
        for v in range(40):
            for p in range(5 + (v * 7) % 20):
                linhas.append(linha(NOM_SEGLOGR=f"VIA {v:02d}", NUM_ENDERECO=str(p + 1),
                                    NV_GEO_COORD="1" if p % 5 else "3"))
        parquet_com_id(linhas, cls.tmp / "pq" / "uf=DF" / f"COD_MUNICIPIO={COD}" / "a.parquet")
        for nome, limiar in (("unico", 10**9), ("fatiado", 100)):
            rodar("gerar_indice.py", "--parquet", str(cls.tmp / "pq"), "--saida", str(cls.tmp / f"idx_{nome}"),
                  "--limiar-entradas", str(limiar), "--entradas-por-fatia", "80", "--memoria", "1GB")
            rodar("amostrar_benchmark.py", "--parquet", str(cls.tmp / "pq"), "--indice", str(cls.tmp / f"idx_{nome}"),
                  "--saida", str(cls.tmp / f"bench_{nome}"), "--por-municipio", "30")
        cls.n_elegiveis = sum(1 for r in linhas if r["NV_GEO_COORD"] in ("1", "2"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def amostra(self, nome):
        with open(self.tmp / f"bench_{nome}" / "amostra.csv", newline="") as f:
            return list(csv.DictReader(f))

    def test_amostra_so_tem_coordenada_boa_e_tamanho_certo(self):
        a = self.amostra("unico")
        self.assertEqual(len(a), min(30, self.n_elegiveis))
        self.assertTrue(all(r["nv"] in ("1", "2") for r in a))
        self.assertTrue(all(r["porte"] == "capital" and r["cod"] == COD for r in a))

    def test_sorteio_deterministico(self):
        self.assertEqual([r["id"] for r in self.amostra("unico")], [r["id"] for r in self.amostra("fatiado")])

    def test_dicionario_fatiado_igual_ao_unico(self):
        ler = lambda n: json.loads(gzip.open(self.tmp / f"bench_{n}" / "dicionarios" / f"{COD}.json.gz").read())
        self.assertEqual(ler("fatiado"), ler("unico"))
        mun = json.loads((self.tmp / "bench_fatiado" / "municipios.json").read_text())
        self.assertEqual(mun[COD]["tipo"], "fatiado")


if __name__ == "__main__":
    unittest.main()
