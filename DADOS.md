# Licença e fonte dos dados

O código deste repositório está sob a licença MIT (ver `LICENSE`). Os dados não fazem parte do repositório e têm licença própria.

## Fonte

O índice publicado (`manifesto.json` e os arquivos `<UF>/<município>...json.gz`) é derivado do **Cadastro Nacional de Endereços para Fins Estatísticos (CNEFE), Censo Demográfico 2022, do Instituto Brasileiro de Geografia e Estatística (IBGE)**.

O índice é uma transformação do CNEFE feita por `pipeline/`: seleção de colunas, normalização do nome da via, descarte de coordenadas de centróide (NV_GEO_COORD 5 e 6), agrupamento por via e compressão. Nenhum dado de outra fonte é acrescentado. O IBGE não endossa este projeto nem os resultados do geocodificador.

## Licença do índice

O índice é distribuído sob a [Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/deed.pt-br). Quem redistribuir o índice, ou uma derivação dele, deve citar as duas fontes:

> Dados: IBGE, Cadastro Nacional de Endereços para Fins Estatísticos (CNEFE), Censo Demográfico 2022. Índice: Candeia (https://github.com/LucasRikelmi/candeia), CC BY 4.0.

Usar o geocodificador para consultar endereços não exige atribuição. A atribuição vale para quem copia ou republica os arquivos do índice.

## Termos de uso do CNEFE (conferido em 2026-11-14)

O que foi encontrado:

- **Não há licença explícita para o CNEFE.** A [página de divulgação dos microdados do CNEFE 2022](https://www.ibge.gov.br/comunicados/40157-ibge-divulga-microdados-do-cadastro-nacional-de-enderecos-para-fins-estatisticos-cnefe-oriundos-do-censo-demografico-2022) não traz termo de uso, licença nem regra de citação. Ela só aponta o termo de uso e a política de privacidade gerais do portal.
- **A posição do IBGE sobre o conteúdo do portal** é a da resposta oficial do atendimento (protocolo 8171/2009, de 08/01/2009), divulgada na [lista do OpenStreetMap](https://lists.openstreetmap.org/pipermail/imports/2013-July/001981.html). Segundo ela, os conteúdos do portal são de domínio público, e o uso em outras publicações ou portais está condicionado à citação da fonte (IBGE). É com base nessa posição que o OpenStreetMap usa dados do IBGE ([wiki](https://wiki.openstreetmap.org/Pt-br:Tag:source=IBGE)).
- **Dados pessoais:** o índice não guarda nome de estabelecimento, complemento de unidade (apartamento, sala) nem qualquer campo além de via, tipo, número, quadra/lote, localidade, CEP, coordenada, nível da coordenada e a contagem de pontos repetidos.

Consequência: a licença CC BY 4.0 do índice está em linha com essa posição, porque exige atribuição e a atribuição acima cita o IBGE primeiro.

Limites desta conferência:
- A resposta de 2009 é anterior ao CNEFE 2022 e não é um termo formal.
- Ela não é uma análise jurídica.

Se o IBGE publicar termo específico para o CNEFE, ou exigir outra forma de atribuição, o termo do IBGE prevalece sobre este texto.
