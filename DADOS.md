# Licença e fonte dos dados

O código deste repositório está sob a licença MIT (ver `LICENSE`). Os dados não fazem parte do repositório e têm licença própria.

## Fonte

O índice publicado (`manifesto.json` e os arquivos `<UF>/<município>...json.gz`) é derivado do **Cadastro Nacional de Endereços para Fins Estatísticos (CNEFE), Censo Demográfico 2022, do Instituto Brasileiro de Geografia e Estatística (IBGE)**.

O índice é uma transformação do CNEFE feita por `pipeline/`: seleção de colunas, normalização do nome da via, descarte de coordenadas de centróide (NV_GEO_COORD 5 e 6), agrupamento por via e compressão. Nenhum dado de outra fonte é acrescentado. O IBGE não endossa este projeto nem os resultados do geocodificador.

## Licença do índice

O índice é distribuído sob a [Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.pt-br). Quem redistribuir o índice, ou uma derivação dele, deve citar as duas fontes:

> Dados: IBGE, Cadastro Nacional de Endereços para Fins Estatísticos (CNEFE), Censo Demográfico 2022. Índice: Candeia (https://github.com/LucasRikelmi/candeia), CC BY 4.0.

Usar o geocodificador para consultar endereços não exige atribuição. A atribuição vale para quem copia ou republica os arquivos do índice.

## Pendência conhecida

Os termos de uso do CNEFE não foram conferidos linha a linha por este projeto. Até onde se sabe, os dados do IBGE são públicos e de reuso livre com citação da fonte. Se o IBGE exigir outra forma de atribuição, ela prevalece sobre o texto acima.
