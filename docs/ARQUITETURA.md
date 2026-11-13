# Arquitetura e plano

Documento vivo. Registra o estado do código, o diagnóstico que motivou cada decisão e o que ainda está em aberto.

## Estado atual (fase 0)

`src/` é um porte **fiel** do `geo_core.js` V2.2 do NEXO (demo pública em `lucasrikelmi.dev/demo/nexo`), dividido em módulos ESM sem mudar a lógica. Mudanças em relação ao original:

- "GeoBase" virou "CNEFE" nos nomes: `parseCnefeLonLat`, `extrairCompCnefe`, `entradaDeLinhaCnefe`, `construirIndiceCnefe`.
- Saíram o `adaptarParaKML`, o `SCORE_MAP` e o `QUAL_MAP`, que são acoplados à UI do NEXO. O `SCORE_MAP` atribuía uma "confiança" fixa por cor, e isso não deve sobreviver até existir calibração.

| Módulo | Conteúdo |
|---|---|
| `normalizar.js` | extenso→numeral, `normalizeBase`, tipos de via, abreviações, rodovias |
| `extrair.js` | parser do endereço digitado (via, número, quadra, lote, km, cruzamento) |
| `cnefe.js` | linha do CNEFE → entrada de índice (quadra/lote do complemento, NV_GEO_COORD) |
| `similaridade.js` | Jaro-Winkler, Jaccard, guarda de número terminal, similaridade de bairro |
| `indices.js` | blocking por token, CEP, CEP→bairro, nome→código de município |
| `posicionar.js` | haversine, centróide, geomedoid |
| `geocodificar.js` | resolução da via, desempate, cor/status, fallbacks |

Os testes em `test/` travam o comportamento atual: 31 casos, incluindo os exemplos do playground do site sobre a cidade sintética (`test/fixtures/geo-town.js`). As limitações conhecidas estão como testes `todo`: rodam, mas não quebram a suíte. Cada uma vira teste normal quando for corrigida.

## Diagnóstico do motor herdado

O que se mantém: quadra e lote lidos do complemento (`NUM_QUADRA` do CNEFE é censitária), descarte de NV_GEO_COORD 5/6 com teto de qualidade para 3/4, geomedoid, cruzamento, fallback por CEP com guarda de CEP genérico, núcleo do nome do bairro.

O que impede a generalização para o país:

1. **Número de porta frágil.** Só é lido logo após a primeira vírgula e se for só dígitos. "Rua X 125" e "Rua X, 125A" perdem o número; no primeiro caso o número vaza para o nome da via. (`todo` nos testes)
2. **Abreviações e títulos ajustados para GO.** Não há "Dr.", "Prof.", "Cel.", "Al.", "Est.". O ETL concatena `NOM_TITULO_SEGLOGR` ao nome, então "Av. Dr. X" nunca é exato. (`todo`) Rodovias já generalizadas para BR + 27 UFs.
3. **Número só casa exato.** Sem vizinho mais próximo nem interpolação, cai no eixo da rua. (`todo`)
4. **DF sem suporte.** SQS/QNM/conjunto/bloco não são reconhecidos.
5. **Confiança por tabela fixa**, não calibrada.
6. **Tudo em memória.** Índice do município inteiro como objeto JS; índices auxiliares montados no cliente varrendo tudo.
7. **Município por nome** só funciona porque o NEXO restringe à jurisdição. Nacionalmente, a UF ou o código IBGE precisa ser obrigatório.

## Dados: o que já se sabe

- 27 zips por UF, cerca de 3,6 GB compactados. A descompactação dá cerca de 9x (RR: 4,5 MB → 42 MB), o que estima uns 33 GB de CSV no país.
- CSV `;`, CRLF, sem acentos, 34 colunas.
- Amostra RR (260 mil linhas): 94% NV_GEO_COORD=1; 33% sem número; 32 mil das 121 mil chaves município+rua+número têm mais de uma coordenada.

## Medições do pipeline (2026-11-13, CNEFE 2022, 27 UFs)

Conversão sem perda (todas as colunas como texto + `lat`/`lon`), zstd, particionado por município, rodada num i3-6100U com HDD, DuckDB 2.0.0, 3 GB de memória, 2 threads:

- 111.102.875 linhas, 5.570 municípios. CSV 18,18 GB → Parquet 3,21 GB (5,7x). Todas as linhas com `lat`/`lon` numéricos (falta conferir sentinelas como 0).
- Tempo: 27 UFs em ~81 min somados; SP sozinha levou ~55 min (spill em disco com 645 partições abertas), as outras 26 juntas ~26 min.
- Maiores municípios em Parquet sem perda: São Paulo 193 MB, Rio de Janeiro 102 MB, Salvador 48 MB, Belo Horizonte 38 MB, Fortaleza 33 MB, Curitiba 28 MB, Brasília 25 MB, Goiânia 22 MB, Porto Alegre 21 MB, Recife 20 MB.
- DF: 236 MB de CSV → 25 MB de Parquet sem perda. O "3,5 MB" citado no README só é alcançável descartando colunas e/ou agregando pontos; o número do README precisa dizer o quê.
- Sem número de porta (`NUM_ENDERECO` 0/vazio ou modificador SN): 23,8% no país, 97% no DF, 65% em GO.

## Medições do índice enxuto (2026-11-13)

`pipeline/medir_indice_enxuto.py` reproduz o dicionário do motor (`{via: [entradas]}`, entradas deduplicadas por tp/n/q/l/b/c/la/lo/g com contagem k, sem NV_GEO_COORD ≥ 5) a partir do Parquet. Fase 1 mediu os 5.570 municípios por SQL; fase 2 gerou o JSON e o gzip reais para 25 municípios (os 11 maiores e 14 espalhados no ranking); o gzip dos demais é estimado com a razão mediana da amostra (0,0926; min 0,0787, max 0,1059; o estimador de JSON errou 0,4%).

- 111,1 M de linhas viram 91,2 M de entradas (−17,9%).
- Brasil inteiro: JSON ~10,9 GB, **gzip estimado ~1,01 GB** (faixa de incerteza da razão: ~0,86 a ~1,16 GB). Compressão medida só com gzip nível 6; outros compressores não foram testados.
- Por município (gzip estimado): mediana 68 KB, p90 327 KB, p99 1,9 MB. 334 municípios passam de 0,5 MB, 144 de 1 MB, 11 de 5 MB e 2 de 20 MB.
- Maiores (gzip, medido na amostra): São Paulo 39,8 MB (3,6 M entradas, 48 mil vias), Rio de Janeiro 20,4 MB, Salvador 10,4 MB, Brasília 9,0 MB, Fortaleza 9,8 MB, Belo Horizonte 8,4 MB, Manaus 7,8 MB, Goiânia 6,7 MB, Curitiba 6,4 MB, Recife 5,5 MB, Belém 5,4 MB.
- O índice enxuto em gzip é de ~1/5 a ~1/3 do Parquet sem perda nos grandes (SP 39,8 vs 192,8 MB; DF 9,0 vs 25,2 MB). Em Boa Vista a razão foi 0,43, então a razão varia com o município e não deve ser extrapolada de uma cidade pequena.
- O DF, mesmo enxuto e comprimido, tem 9,0 MB, não os 3,5 MB do README. Esse número só se obtém com mais agregação do que a feita aqui (por exemplo, colapsar pontos por face de quadra ou codificar coordenadas de forma compacta); isso ainda não foi medido.

Consequência para o desenho: um arquivo por município fica abaixo de 1 MB (gzip) em mais de 97% dos municípios, mas não nos 144 acima disso, que incluem as capitais e as maiores cidades. Para esses, o desenho precisa fatiar: um índice de vias leve (nomes, tokens, bairro, CEP, caixa envolvente) baixado primeiro, e fatias de pontos por via ou faixa de CEP baixadas sob demanda. O tamanho desse índice de vias ainda não foi medido; ele precisa ser baixado inteiro para a busca fuzzy, então é o novo teto de custo por município (SP tem 48 mil vias).

## Índice de distribuição gerado (2026-11-13)

`pipeline/gerar_indice.py` sobre o Parquet, 27 UFs, 5.570 municípios, 2.470 s no i3-6100U com HDD, sem erros. Formato versão 1, limiar 90.000 entradas por município, 50.000 entradas por fatia, gzip determinístico nível 6.

- **Total:** 996.728.982 bytes (~997 MB) em 6.327 arquivos. Bate com a estimativa da medição (~1,01 GB).
- **Únicos:** 5.425 municípios, 630,7 MB; maior arquivo 960.819 bytes (abaixo de 1 MB).
- **Fatiados:** 145 municípios, 757 fatias; maior fatia do país 614.872 bytes (SP capital), menor 1.219.
- **Custo por consulta nos grandes** (índice + 1 fatia): SP capital 717 KB + ≤615 KB ≈ 1,3 MB, em vez de 40 MB. RJ 303 KB + ≤520 KB. DF 301 KB + ≤483 KB.
- **Palmas e Brasília** têm muitas vias para poucas entradas (quadras numeradas): índice relativamente grande (Palmas 72 KB, DF 301 KB).
- A decisão de fatiar por via (e não por distrito) se mantém: só SP capital tem divisão útil em distritos.

Pendente: medir latência real (HTTP/2, cache) e conferir limites da hospedagem. O índice de vias é o custo fixo por consulta nos grandes e precisa ser baixado inteiro.

## Rodovias no CNEFE (2026-11-13)

`pipeline/medir_rodovias.py`, 148 s, pico de 722 MB.

- 1,79 M linhas do tipo RODOVIA: 30% sem código, BR em 24% (nas 27 UFs), o resto com a sigla da própria UF ou de vizinha. Siglas estaduais próprias (RST, ERS, VRS no RS; LMG, MGT em MG; PRT no PR; ICR em SC) são minoria e ainda não são reconhecidas.
- 8,4 M linhas do tipo ESTRADA, várias com código de rodovia ("RS 647", "BR 364"). Por isso a classe "rodovia" (raio de outlier de 50 km) passou a ser decidida pelo código no nome, não só pelo tipo.
- Nomes "<2-3 letras> <número>" que não são rodovia: quase todos do DF (QR, SQN, QNM, CLN...) e códigos locais (WE em Belém; JC, VC, VF, RC em GO). Nenhum é sigla de UF, exceto DF 205, que é rodovia. O motor reconhece BR + 27 siglas e exige número de 2 a 3 dígitos logo depois, para não confundir "Al. Santos" com rodovia.
- Km: 41% das linhas de rodovia têm número; 8% marcam o número como km no modificador (DSC_MODIFICADOR) e 1,6% têm o km no nome; nenhum no complemento. Nos outros 33% com número não dá para saber se é km ou número de porta.

## Benchmark Candeia × NEXO (2026-11-13, recorte sintético)

`pipeline/amostrar_benchmark.py` + `bench/rodar.mjs`. 132 municípios (capital, 2 grandes e 2 pequenos por UF, mais Aparecida de Goiânia), 19.800 endereços com NV_GEO_COORD 1-2, ~106 mil consultas por motor, 6 min. "NEXO" é o `geo_core.js` V2.2 de que o Candeia foi portado, sem índice de CEP; "Candeia" é `src/`. O gabarito é o próprio CNEFE: os números são otimistas.

Acerto até 100 m (cenário A = endereço no índice; B = ponto retirado):

| Variante | Candeia | NEXO | >1 km Candeia | >1 km NEXO |
|---|---|---|---|---|
| A limpa | 70,5% | 69,5% | 13,6% | 15,0% |
| A abreviada | 53,9% | 51,5% | 10,4% | 15,2% |
| A digitação | 68,7% | 66,8% | 13,2% | 16,1% |
| A sem vírgula | 44,8% | 42,7% | 10,6% | 15,9% |
| A sem bairro/CEP | 65,3% | 65,3% | 19,9% | 20,0% |
| B limpa | 46,9% | 45,8% | 17,7% | 19,2% |

- Pareado (≤100 m, todas as consultas): ambos 61.261; só Candeia 1.935; só NEXO 488; nenhum 43.089.
- Com número de porta (A limpa): verde acerta 95% até 100 m nos dois. Capitais 93,2% (Candeia) e 90,6% (NEXO).
- Sem número de porta (34% da amostra): só 34% até 100 m e 30% acima de 1 km. É o maior buraco, concentrado em vias rurais (LINHA, ESTRADA, RAMAL, VICINAL) e municípios pequenos.
- Cor como confiança: verde é confiável (1,7% acima de 1 km). Amarelo e laranja não separam bem acerto de erro (17% e 38% acima de 1 km no Candeia); o NEXO manda mais casos para vermelho (1.673 contra 356), o que é honesto, mas responde menos.
- Achado: a chave de via não inclui o tipo. "Rua 1", "Avenida 1" e "Travessa 1" caem na mesma chave, e o motor não usa o tipo para filtrar candidatos. Isso afeta 5% a 10% das chaves e 16% a 26% dos pontos (São Paulo, Goiânia, Aparecida, Porto Velho).
- A variante "sem vírgula" confirma o `todo` do número sem vírgula: mediana de 120 m.

### Rodada 2 (mesmo recorte, depois das correções)

Correções: número sem vírgula (só aceita "via sem o último número" se ela casar exato e melhor que a via inteira), abreviações de tipo e título (R., Al., Est., Dr., Prof., Cel., Gov., Pres., Sen., Dep., Eng., Mal., Gal.; "r" e "al" só no início), filtro de candidatos pelo tipo de via, e tipos rurais (linha, ramal, vicinal, beco, acesso, travessão...).

| Variante | Candeia antes | Candeia agora | NEXO | >1 km agora |
|---|---|---|---|---|
| A limpa | 70,5% | 72,3% | 69,5% | 11,2% |
| A abreviada | 53,9% | 78,8% | 51,5% | 6,2% |
| A digitação | 68,7% | 70,0% | 66,8% | 11,6% |
| A sem vírgula | 44,8% | 90,8% | 42,7% | 3,6% |
| A sem bairro/CEP | 65,3% | 67,6% | 65,3% | 17,0% |
| B limpa | 46,9% | 47,8% | 45,8% | 15,8% |

- Pareado ≤100 m: só Candeia 13.355; só NEXO 620; ambos 61.129; nenhum 31.669.
- Com número de porta (A limpa): 91,1% até 100 m. Sem número: 35,5% (continua o maior buraco).
- Regressões conferidas: a maioria é endereço com o mesmo número gravado em pontos diferentes da mesma via (ruído do CNEFE), onde a escolha entre eles é arbitrária.

## Riscos de arquitetura em aberto

1. **Capitais grandes.** "Um arquivo por município" provavelmente não cabe no navegador para São Paulo e outras capitais (não medido). Desenho candidato: índice leve de logradouros por município, mais shards de pontos por logradouro ou faixa de CEP, baixados sob demanda.
2. **Formato do cliente.** Parquet como artefato canônico do pipeline é bom (auditável, colunar). Para o cliente, ler Parquet exige uma biblioteca e não traz índice de busca. Candidato: formato próprio já indexado, gerado do Parquet, com fatias para os municípios grandes. Falta medir o índice de vias e prototipar.
3. **Redução 236 MB → 3,5 MB no DF.** Medido: sem perda 25 MB, enxuto e comprimido 9,0 MB. O número do README só vale se o método de agregação for descrito.
4. **Benchmark.** O sintético mede robustez a ruído, não calibra confiança. Gabarito real depende de pontos conferidos em campo, que ainda não existem.
5. **Hospedagem.** Limites de tamanho de npm, jsDelivr e GitHub Pages precisam ser conferidos antes de escolher a distribuição.
6. **CI.** O benchmark do CI roda sobre um recorte fixo e versionado, nunca sobre o CNEFE inteiro.

## Ordem de execução

1. ~~Esqueleto do repositório e porte com testes de regressão~~
2. ~~Pipeline CNEFE → Parquet por UF, com manifesto e hash~~ (feito)
3. Análise exploratória por UF
4. ~~Medir tamanho por município~~, ~~medir o índice de vias e decidir o formato~~ (feito; índice gerado para os 5.570 municípios)
5. Generalização do motor: número sem vírgula, abreviações e títulos, vizinho mais próximo, parser do DF
6. Benchmark e calibração por UF (benchmark sintético feito; calibração pendente)
