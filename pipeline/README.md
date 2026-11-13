# Pipeline CNEFE → Parquet

Converte os zips do CNEFE 2022 (um por UF, ex.: `14_RR.zip`) em Parquet particionado por município, sem perda: todas as colunas originais como texto, mais `lat`/`lon` numéricos.

```sh
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/cnefe_para_parquet.py --zips DIR_ZIPS --saida DIR_SAIDA --memoria 3GB --threads 2
```

- Processa da menor UF para a maior; UF com manifesto em `_manifesto/<UF>.json` é pulada (retomável). `--refazer` força.
- O manifesto guarda o sha256 do zip, as contagens (linhas, municípios, coordenadas inválidas, sem número, NV_GEO_COORD), o tamanho por município e os tempos.
- Confere se o número de linhas do Parquet bate com o do CSV; se não bater, para com erro.
- Ao ler, a partição `COD_MUNICIPIO` é inferida como inteiro pelo DuckDB; use `hive_types={'COD_MUNICIPIO': VARCHAR}` se precisar do texto.
- Os dados gerados nunca entram no repositório (`.gitignore`).

## Medição do índice enxuto

`medir_indice_enxuto.py` dimensiona o índice que o motor realmente usa (dicionário `{via: [entradas]}` deduplicado, sem NV_GEO_COORD ≥ 5) a partir do Parquet sem perda. Somente leitura sobre `--parquet`; escreve em `--saida` (outra pasta).

```sh
.venv/bin/python pipeline/medir_indice_enxuto.py --parquet DIR_PARQUET --saida DIR_SAIDA
```

Fase 1: métricas por município (SQL, retomável). Fase 2: gera o JSON de verdade para os maiores municípios e alguns de tamanho médio e mede o gzip real. Fase 3: estima o gzip de todos com a razão medida e grava `summary.json`. O gzip dos municípios fora da amostra é estimativa, com o intervalo da razão registrado.

## Geração do índice de distribuição

`gerar_indice.py` produz o que o cliente baixa: um `.json.gz` por município (dicionário `{via: [entradas]}` com as chaves do NEXO) e, nos municípios acima de `--limiar-entradas` (90 mil), um `index.json.gz` de vias mais fatias `fNNN.json.gz`, com cada via inteira em uma só fatia. `manifesto.json` lista tipo, contagens e (nome, bytes, sha256) de cada arquivo. A saída é determinística.

```sh
.venv/bin/python pipeline/gerar_indice.py --parquet DIR_PARQUET --saida DIR_SAIDA
```

As chaves de via, tipo, bairro, número, quadra e lote são geradas por `normalizacao.py`, um port de `src/normalizar.js`. `test_gerar_indice.py` prova a paridade com o motor rodando o ETL JS (`paridade.mjs`) sobre os mesmos dados; com `CANDEIA_PARQUET_UF=<pasta uf=XX>` ele confere todas as combinações reais de uma UF.

```sh
python -m unittest discover -s pipeline -p 'test_*.py'   # precisa de duckdb e de node
```
