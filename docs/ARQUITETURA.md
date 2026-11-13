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
2. **Abreviações e títulos ajustados para GO.** Não há "Dr.", "Prof.", "Cel.", "Al.", "Est.". O ETL concatena `NOM_TITULO_SEGLOGR` ao nome, então "Av. Dr. X" nunca é exato. `TIPOS_RODOVIA` = br/go/mg. (`todo`)
3. **Número só casa exato.** Sem vizinho mais próximo nem interpolação, cai no eixo da rua. (`todo`)
4. **DF sem suporte.** SQS/QNM/conjunto/bloco não são reconhecidos.
5. **Confiança por tabela fixa**, não calibrada.
6. **Tudo em memória.** Índice do município inteiro como objeto JS; índices auxiliares montados no cliente varrendo tudo.
7. **Município por nome** só funciona porque o NEXO restringe à jurisdição. Nacionalmente, a UF ou o código IBGE precisa ser obrigatório.

## Dados: o que já se sabe

- 27 zips por UF, cerca de 3,6 GB compactados. A descompactação dá cerca de 9x (RR: 4,5 MB → 42 MB), o que estima uns 33 GB de CSV no país.
- CSV `;`, CRLF, sem acentos, 34 colunas.
- Amostra RR (260 mil linhas): 94% NV_GEO_COORD=1; 33% sem número; 32 mil das 121 mil chaves município+rua+número têm mais de uma coordenada.

## Riscos de arquitetura em aberto

1. **Capitais grandes.** "Um arquivo por município" provavelmente não cabe no navegador para São Paulo e outras capitais (não medido). Desenho candidato: índice leve de logradouros por município, mais shards de pontos por logradouro ou faixa de CEP, baixados sob demanda.
2. **Formato do cliente.** Parquet como artefato canônico do pipeline é bom (auditável, colunar). Para o cliente, ler Parquet exige uma biblioteca e não traz índice de busca. Candidato: formato próprio já indexado, gerado do Parquet. Decidir só depois de medir.
3. **Redução 236 MB → 3,5 MB no DF.** Precisa de explicação do que foi descartado ou agregado antes de ir para o README como número.
4. **Benchmark.** O sintético mede robustez a ruído, não calibra confiança. Gabarito real depende de pontos conferidos em campo, que ainda não existem.
5. **Hospedagem.** Limites de tamanho de npm, jsDelivr e GitHub Pages precisam ser conferidos antes de escolher a distribuição.
6. **CI.** O benchmark do CI roda sobre um recorte fixo e versionado, nunca sobre o CNEFE inteiro.

## Ordem de execução

1. ~~Esqueleto do repositório e porte com testes de regressão~~
2. Pipeline CNEFE → Parquet por UF, em streaming (a máquina de desenvolvimento não comporta SP em memória), com manifesto e hash
3. Análise exploratória por UF
4. Medir tamanho por município e decidir o formato de distribuição
5. Generalização do motor: número sem vírgula, abreviações e títulos, vizinho mais próximo, parser do DF
6. Benchmark e calibração por UF
