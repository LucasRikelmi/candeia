"""Testes do gerador de índice. Rodar: python -m unittest discover -s pipeline -p 'test_*.py'

Variável opcional CANDEIA_PARQUET_UF: pasta uf=XX de um Parquet real; se definida, a paridade com o
JS também é checada sobre as combinações distintas de nome/tipo/localidade/número/complemento reais.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
import gerar_indice as gi  # noqa: E402

COLS = ["NOM_TITULO_SEGLOGR", "NOM_SEGLOGR", "NOM_TIPO_SEGLOGR", "DSC_LOCALIDADE", "CEP", "NUM_ENDERECO",
        "DSC_MODIFICADOR"] + [f"{k}_COMP_ELEM{i}" for i in range(1, 6) for k in ("NOM", "VAL")] + ["NV_GEO_COORD"]
NODE = shutil.which("node")


def linha(**kw) -> dict:
    r = {c: None for c in COLS}
    r.update(NOM_TIPO_SEGLOGR="RUA", DSC_LOCALIDADE="CENTRO", CEP="74000-000", NV_GEO_COORD="1")
    r.update(kw)
    return r


CASOS = [
    linha(NOM_SEGLOGR="OITO", NUM_ENDERECO="120"),
    linha(NOM_SEGLOGR="SESSENTA E OITO", NUM_ENDERECO="0220"),
    linha(NOM_SEGLOGR="NOVEMBRO", NUM_ENDERECO="5"),
    linha(NOM_SEGLOGR="DEZEMBRO", NUM_ENDERECO="12A"),
    linha(NOM_TIPO_SEGLOGR="AVENIDA", NOM_TITULO_SEGLOGR="DOUTOR", NOM_SEGLOGR="JOSE DA SILVA", NUM_ENDERECO="7"),
    linha(NOM_TIPO_SEGLOGR="RODOVIA", NOM_SEGLOGR="BR-153", NUM_ENDERECO="540"),
    linha(NOM_SEGLOGR="SAO JOAO D'OESTE", DSC_LOCALIDADE="JARDIM D'AJUDA (NOVO)", NUM_ENDERECO="SN"),
    linha(NOM_SEGLOGR="SAO JOAO", NUM_ENDERECO="0", DSC_MODIFICADOR="SN"),
    linha(NOM_SEGLOGR="DAS FLORES", NUM_ENDERECO="", NOM_COMP_ELEM1="QUADRA", VAL_COMP_ELEM1="022",
          NOM_COMP_ELEM2="LOTE", VAL_COMP_ELEM2="07"),
    linha(NOM_SEGLOGR="DAS FLORES", NUM_ENDERECO="33", NOM_COMP_ELEM1="CASA", VAL_COMP_ELEM1="2",
          NOM_COMP_ELEM3="quadra", VAL_COMP_ELEM3="5B", NOM_COMP_ELEM4="LOTE", VAL_COMP_ELEM4="0036A"),
    linha(NOM_SEGLOGR="CENTO E UM", NUM_ENDERECO="1"),
    linha(NOM_SEGLOGR="VINTE E CINCO DE MARCO", NUM_ENDERECO="25"),
    linha(NOM_SEGLOGR="ÇÃO ÉÀ", DSC_LOCALIDADE="SÃO JOSÉ", NUM_ENDERECO="1"),
    linha(NOM_SEGLOGR="XV DE NOVEMBRO", NUM_ENDERECO="  15  "),
    linha(NOM_SEGLOGR="  ", NUM_ENDERECO="1"),                       # via vazia → descartada
    linha(NOM_SEGLOGR="CINCO", NUM_ENDERECO="1", NV_GEO_COORD="5"),   # centróide → descartada
    linha(NOM_SEGLOGR="CINCO", NUM_ENDERECO="2", NV_GEO_COORD="4"),
    linha(NOM_SEGLOGR="TRES", NUM_ENDERECO="9", CEP=None, DSC_LOCALIDADE=None),
    linha(NOM_TIPO_SEGLOGR=None, NOM_SEGLOGR="SEM TIPO", NUM_ENDERECO="10"),
]


def parquet_de(linhas: list[dict], destino: Path) -> None:
    con = duckdb.connect()
    cols = COLS + ["lat", "lon"]
    con.execute("CREATE TABLE t(" + ", ".join(f"{c} VARCHAR" if c not in ("lat", "lon") else f"{c} DOUBLE" for c in cols) + ")")
    for i, r in enumerate(linhas):
        con.execute(f"INSERT INTO t VALUES ({', '.join('?' for _ in cols)})",
                    [r.get(c) for c in COLS] + [10 + i / 1e6, -10.0])
    destino.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY t TO '{destino.as_posix()}' (FORMAT parquet)")
    con.close()


def entradas_python(linhas: list[dict], tmp: Path) -> list:
    """Roda a etapa SQL do pipeline e devolve, na ordem das linhas de entrada, [via,tp,n,q,l,b,c] ou None."""
    pq = tmp / "paridade.parquet"
    parquet_de(linhas, pq)
    con = duckdb.connect()
    gi._registrar_udfs(con)
    gi.criar_tabela_entradas(con, pq.as_posix())
    achados = {round((la - 10) * 1e6): (via, tp, n, q, l, b, c)
               for via, tp, n, q, l, b, c, la in con.execute("SELECT via,tp,n,q,l,b,c,la FROM e").fetchall()}
    con.close()
    return [list(achados[i]) if i in achados else None for i in range(len(linhas))]


def entradas_js(linhas: list[dict]) -> list:
    rows = []
    for i, r in enumerate(linhas):
        d = {k: ("" if v is None else v) for k, v in r.items()}
        d.update(COD_MUNICIPIO="1", LATITUDE=f"{10 + i / 1e6:.6f}", LONGITUDE="-10.000000")
        rows.append(d)
    out = subprocess.run(["node", str(AQUI / "paridade.mjs")], input=json.dumps(rows), text=True,
                         capture_output=True, check=True).stdout
    return json.loads(out)


@unittest.skipUnless(NODE, "node não encontrado")
class ParidadeComMotor(unittest.TestCase):
    def comparar(self, linhas):
        with tempfile.TemporaryDirectory() as d:
            py = entradas_python(linhas, Path(d))
        js = entradas_js(linhas)
        difs = [(i, linhas[i], py[i], js[i]) for i in range(len(linhas)) if py[i] != js[i]]
        self.assertEqual(difs[:5], [], f"{len(difs)} divergências entre pipeline e motor")

    def test_casos_dirigidos(self):
        self.comparar(CASOS)

    @unittest.skipUnless(os.environ.get("CANDEIA_PARQUET_UF"), "sem Parquet real")
    def test_combinacoes_reais(self):
        con = duckdb.connect()
        g = (Path(os.environ["CANDEIA_PARQUET_UF"]) / "**" / "*.parquet").as_posix()
        cols = ", ".join(COLS)
        rows = con.execute(f"SELECT DISTINCT {cols} FROM read_parquet('{g}')").fetchall()
        linhas = [dict(zip(COLS, r)) for r in rows]
        self.comparar(linhas)


class Fatiamento(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        linhas = []
        for v in range(60):                       # 60 vias, 5 a 40 pontos cada
            for p in range(5 + (v * 7) % 36):
                linhas.append(linha(NOM_SEGLOGR=f"VIA {v:02d}", NUM_ENDERECO=str(p + 1),
                                    CEP=f"7400{v % 7}-000", DSC_LOCALIDADE=f"BAIRRO {v % 4}"))
        # coordenadas distintas para não deduplicar
        pq = cls.tmp / "pq" / "uf=XX" / "COD_MUNICIPIO=9999999" / "a.parquet"
        parquet_de(linhas, pq)
        for nome, limiar in (("unico", 10**9), ("fatiado", 100)):
            r = subprocess.run([sys.executable, str(AQUI / "gerar_indice.py"), "--parquet", str(cls.tmp / "pq"),
                                "--saida", str(cls.tmp / nome), "--limiar-entradas", str(limiar),
                                "--entradas-por-fatia", "120", "--memoria", "1GB"],
                               capture_output=True, text=True)
            assert r.returncode == 0, r.stderr
        cls.mu = json.loads((cls.tmp / "unico" / "manifesto.json").read_text())["municipios"]["9999999"]
        cls.mf = json.loads((cls.tmp / "fatiado" / "manifesto.json").read_text())["municipios"]["9999999"]

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @staticmethod
    def ler(p):
        return json.loads(gzip.open(p).read())

    def test_tipos(self):
        self.assertEqual(self.mu["tipo"], "unico")
        self.assertEqual(self.mf["tipo"], "fatiado")
        self.assertGreater(self.mf["fatias"], 3)

    def test_fatias_reconstituem_o_municipio(self):
        inteiro = self.ler(self.tmp / "unico" / "XX" / "9999999.json.gz")
        fundido: dict = {}
        for a in self.mf["arquivos"][1:]:
            d = self.ler(self.tmp / "fatiado" / "XX" / "9999999" / a["nome"])
            self.assertFalse(set(d) & set(fundido), "via dividida entre fatias")
            fundido.update(d)
        self.assertEqual(fundido, inteiro)

    def test_indice_aponta_a_fatia_certa(self):
        idx = self.ler(self.tmp / "fatiado" / "XX" / "9999999" / "index.json.gz")
        self.assertEqual(idx["entradas"], self.mf["entradas"])
        for via, (fatia, n) in idx["vias"].items():
            d = self.ler(self.tmp / "fatiado" / "XX" / "9999999" / f"f{fatia:03d}.json.gz")
            self.assertEqual(len(d[via]), n)

    def test_indice_de_cep(self):
        idx = self.ler(self.tmp / "fatiado" / "XX" / "9999999" / "index.json.gz")
        total = sum(n for _, n, _ in idx["ceps"].values())
        self.assertEqual(total, idx["entradas"])
        for cep, (bairro, n, fatias) in idx["ceps"].items():
            self.assertTrue(bairro.startswith("bairro"))
            self.assertEqual(fatias, sorted(set(fatias)))

    def test_manifesto_confere_hash_e_tamanho(self):
        for a in self.mf["arquivos"]:
            p = self.tmp / "fatiado" / "XX" / "9999999" / a["nome"]
            self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), a["sha256"])
            self.assertEqual(p.stat().st_size, a["bytes"])

    def test_saida_nao_pode_ficar_dentro_do_parquet(self):
        r = subprocess.run([sys.executable, str(AQUI / "gerar_indice.py"), "--parquet", str(self.tmp / "pq"),
                            "--saida", str(self.tmp / "pq" / "dentro")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
