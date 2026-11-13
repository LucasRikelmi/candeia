"""Port em Python de normalizeBase, normNum e extensoParaNumeral do motor (src/normalizar.js).

Existe porque o pipeline precisa gerar as MESMAS chaves de via que o motor gera em tempo de
consulta. A paridade com o JS é verificada em pipeline/test_paridade_normalizacao.py.
"""
from __future__ import annotations

import re
import unicodedata

_UN = ["", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove"]
_DEZ = {10: "dez", 11: "onze", 12: "doze", 13: "treze", 14: "quatorze", 15: "quinze",
        16: "dezesseis", 17: "dezessete", 18: "dezoito", 19: "dezenove"}
_TEN = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
_CEN = ["", "cem", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos",
        "setecentos", "oitocentos", "novecentos"]


def _extenso(n: int) -> str:
    if n == 0:
        return "zero"
    partes: list[str] = []
    c, r = divmod(n, 100)
    if c > 0:
        partes.append("cento" if c == 1 and r > 0 else _CEN[c])
    if r > 0:
        if r < 10:
            partes.append(_UN[r])
        elif r < 20:
            partes.append(_DEZ[r])
        else:
            t, u = divmod(r, 10)
            partes.append(_TEN[t])
            if u > 0:
                partes.append(_UN[u])
    return " e ".join(partes)


EXTENSO_PARA_NUM = {_extenso(i): str(i) for i in range(1, 1000)}
# mesma ordem do JS: mais longo primeiro (Array.sort estável por comprimento decrescente)
_ORDENADO = sorted(EXTENSO_PARA_NUM.keys(), key=lambda k: -len(k))
_STEMS = {tok for k in EXTENSO_PARA_NUM for tok in k.split(" ") if tok != "e"}
_RE_STEM = re.compile(r"\b(" + "|".join(sorted(_STEMS, key=lambda s: -len(s))) + r")\b")
_REGEXES = [(re.compile(r"\b" + re.sub(r"\s+", r"\\s+", ext) + r"\b"), EXTENSO_PARA_NUM[ext])
            for ext in _ORDENADO]

_RE_COMBINING = re.compile("[̀-ͯ]")
_RE_NAO_PERMITIDO = re.compile(r"[^a-z0-9\s/-]")
_RE_ESPACOS = re.compile(r"\s+")
_RE_NORMNUM = re.compile(r"^0*([0-9]+[a-z]?)")


def normalize_base(texto) -> str:
    if not texto:
        return ""
    s = unicodedata.normalize("NFD", str(texto).lower())
    s = _RE_COMBINING.sub("", s)
    s = _RE_NAO_PERMITIDO.sub(" ", s)
    return _RE_ESPACOS.sub(" ", s).strip()


def norm_num(raw):
    if raw is None:
        return None
    m = _RE_NORMNUM.match(str(raw).lower())
    return m.group(1) if m else None


def extenso_para_numeral(texto: str) -> str:
    if not _RE_STEM.search(texto):
        return texto
    t = texto
    for rx, num in _REGEXES:
        t = rx.sub(num, t)
    return _RE_ESPACOS.sub(" ", t).strip()


def chave_via(titulo, nome) -> str:
    """Chave de via do ETL: normalizeBase([titulo, nome].filter(Boolean).join(' ')) → extenso→numeral."""
    bruto = normalize_base(" ".join(x for x in (titulo, nome) if x))
    return _RE_ESPACOS.sub(" ", extenso_para_numeral(bruto)).strip()
