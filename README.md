# Candeia

Geocodificação de endereços brasileiros que roda no seu próprio código, sem servidor, sem chave de API e sem custo por consulta.

> **Status: v1.0.1.** O motor, o índice das 27 UFs e o loader funcionam. O índice está publicado em `https://dados.lucasrikelmi.dev/cnefe2022/v1/` (Cloudflare Pages, CC BY 4.0, ver [DADOS.md](DADOS.md)). O pacote não está no npm: instale pelo GitHub (ver [Uso](#uso)). Os números de acurácia vêm de um benchmark sintético sobre o próprio CNEFE (132 municípios, 19.800 endereços), descrito em [docs/ARQUITETURA.md](docs/ARQUITETURA.md). Um benchmark de regressão roda no CI a cada PR.

## O problema

Quem precisa transformar um endereço brasileiro em coordenada hoje tem, na prática, duas saídas:

1. **APIs comerciais (Google Maps e similares).** Funcionam bem, mas cobram por consulta, exigem chave e mandam os endereços dos seus clientes para um terceiro.
2. **Ferramentas de pesquisa baseadas no CNEFE do IBGE.** Gratuitas e offline, mas pensadas para análise em lote por quem programa em R, com download de dados grande e sem suporte a quadra e lote, que é como muito endereço brasileiro realmente se escreve (Goiânia, Distrito Federal, Palmas, loteamentos em geral).

Falta uma opção gratuita que rode dentro de um site ou de um backend comum e entenda o jeito brasileiro de escrever endereço.

## A premissa

O IBGE publica o CNEFE, o cadastro de endereços usado no Censo, com coordenadas. Com ele dá para montar um geocodificador **estático**:

- **Sem servidor.** O código roda no navegador ou no Node de quem usa. Os dados são arquivos estáticos públicos. Nenhuma lógica roda do nosso lado, e o host dos arquivos nunca vê o endereço consultado, só qual município foi baixado.
- **Dados por município.** Quem consulta Belo Horizonte baixa o arquivo de Belo Horizonte, não o Brasil. O arquivo fica em memória (e no cache HTTP do navegador), e a segunda consulta não usa rede. Quem quiser tudo no próprio ambiente pode espelhar os arquivos do índice (CC BY 4.0) e apontar `base` para lá.
- **Resposta com qualidade explícita.** Cada resultado traz o nível em que o endereço foi encontrado e uma estimativa de erro em metros, em vez de fingir precisão que não tem.
- **Endereço do jeito que é digitado.** Abreviações ("R.", "Av.", "Tv."), rodovias com a sigla da UF, quadra e lote no lugar do número de porta, complemento no campo errado.

## Uso

Node 22 ou mais (sem dependências):

```sh
npm install github:LucasRikelmi/candeia#v1.0.1
```

No navegador, direto de um CDN que serve o GitHub:

```js
import { criarGeocodificador } from "https://cdn.jsdelivr.net/gh/LucasRikelmi/candeia@v1.0.1/src/index.js";
```

```js
import { criarGeocodificador } from "candeia";

const geo = criarGeocodificador({ base: "https://dados.lucasrikelmi.dev/cnefe2022/v1/" });
const r = await geo.geocodificar("Rua 8, Qd 21 Lt 4", {
  municipio: "5208707", // código IBGE
  bairro: "Setor Central",
  cep: "74000-000",
});

// {
//   status: "verde" | "azul" | "amarelo" | "laranja" | "vermelho",
//   metodo: "numero" | "quadra_lote" | "lote" | "quadra" | "interpolacao" | "eixo" | "cep" | "cruzamento" | "falha",
//   coord: { lat, lon },
//   raio,        // metros: até onde o ponto pode estar (null quando não dá para estimar)
//   confianca,   // { ate100m, acima1km, amostra }: frações medidas no benchmark para essa cor e raio
//   viaKey, motivo, ...
// }
```

Município pequeno é um arquivo só. Município grande baixa o índice de vias e só a fatia da via pedida: no benchmark, uma consulta fria em São Paulo baixa ~1,3 MB e a seguinte na mesma via não baixa nada. O loader confere o sha256 de cada arquivo contra o manifesto. A página `exemplo/index.html` mostra o uso no navegador. Fora do navegador, passe um `fetch` com `User-Agent` próprio, por exemplo `criarGeocodificador({ base, fetch: (u) => fetch(u, { headers: { "User-Agent": "meu-sistema/1.0" } }) })`: a Cloudflare barra assinaturas genéricas de cliente, como a do Python (ver [docs/PUBLICACAO.md](docs/PUBLICACAO.md)).

Medido no benchmark (cenário com o endereço no índice, variante limpa; rodada 8): 74,2% até 100 m no geral e 92,5% com número de porta. Verde acerta até 100 m em 99,8% dos casos. Endereço sem número fica em ~38%, limitado pela extensão da via, e o `raio` diz isso. Rua que não existe na cidade volta vermelho (centro do município) em 83% dos casos; no resto, casa com uma rua de nome parecido, e a cor e o `raio` mostram a incerteza.

Fluxo de uma consulta:

1. **Normalização local.** Tipo da via, nome, número, quadra e lote são extraídos e padronizados.
2. **Município** pelo código IBGE de 7 dígitos, informado por quem chama.
3. **Download do arquivo do município** (ou do índice de vias e da fatia da via, nos grandes), ou leitura do que já está em memória.
4. **Busca por token do nome da via**, para não comparar com todas as ruas da cidade.
5. **Pontuação do nome** com Jaro-Winkler e Jaccard por tokens. Bairro e CEP desempatam ruas homônimas.
6. **Refinamento por número, quadra e lote.** Sem número, o motor tenta interpolar entre vizinhos, depois cai para o eixo da via, o CEP e o centro do município. `metodo` diz até onde chegou e `raio` quanto o ponto pode estar longe.

## Dados

- **Fonte:** CNEFE, Censo 2022, IBGE. O IBGE trata o conteúdo do portal como domínio público, com citação obrigatória da fonte. O índice sai sob CC BY 4.0. O que foi conferido e os limites dessa conferência estão em [DADOS.md](DADOS.md).
- **Formato:** o artefato canônico do pipeline é Parquet sem perda, particionado por UF e município (CSV 18,2 GB → Parquet 3,2 GB no país). O que o cliente baixa é um índice próprio em JSON comprimido com gzip: um arquivo por município (abaixo de 1 MB em 5.425 dos 5.570) e, nos 145 maiores, um índice de vias mais fatias de pontos de até ~0,6 MB. O país inteiro soma ~1 GB; o pior caso de uma consulta (São Paulo capital) baixa ~1,3 MB. Detalhes e medições em `docs/ARQUITETURA.md`.
- **Pipeline:** os dados nunca entram por pull request. Eles são gerados apenas pelo pipeline do repositório, de forma reproduzível.
- **Medições:** as análises que definiram as regras (tipos de logradouro, rodovias por UF, tamanho por município, DF) estão em `docs/ARQUITETURA.md` e nos scripts `pipeline/medir_*.py`.

Cada UF escreve endereço de um jeito. Na amostra inicial, o DF tem 96% dos registros com tipo "EDF" e 97% sem número de porta, com o endereço real em quadra, conjunto e lote. O AC tem 57% de CEPs genéricos da cidade e vias rurais como ramal, igarapé e seringal. Um motor que só funciona com "rua + número" não cobre isso.

## Qualidade e honestidade sobre os números

- Um score de similaridade não é probabilidade. A `confianca` devolvida é a fração medida no benchmark para a mesma cor e faixa de raio, validada fora da amostra (metade dos municípios ajusta, a outra mede). Ela não é separada por UF de propósito: a tabela por UF, mesmo encolhida para a nacional, errou mais nos municípios que ficaram fora do ajuste (Brier 0,0959 contra 0,0917 da nacional). A diferença entre municípios da mesma UF é maior que a diferença entre UFs, e a cor e o raio já carregam o que importa.
- O benchmark sintético sorteia endereços do próprio CNEFE e os suja (abreviações, erros de digitação, campos faltando). Ele é otimista por construção, porque o gabarito vem da mesma base. Ainda não há validação com pontos conferidos em campo.
- O CNEFE é de 2022. Endereços novos não existem nele.
- Coordenadas aproximadas servem para mapa, roteirização grosseira, estatística e triagem. Não servem para localizar um portão específico quando o nível devolvido for `logradouro` ou menor.

## Relação com outros projetos

O [geocodebr](https://ipeagit.github.io/geocodebr), do IPEA, também usa o CNEFE, funciona offline e retorna nível de precisão e desvio em metros. É mais maduro e cobre geocodificação reversa e busca por CEP. A proposta do Candeia é outra: rodar em JavaScript (navegador e Node), baixar só o município consultado e tratar quadra e lote.

Comparação nas mesmas 66 mil consultas do benchmark (geocodebr 0.7.0, entrada em campos separados; scripts em `bench/geocodebr/`). Os dois usam o CNEFE 2022 e o gabarito também vem dele, então mede o que cada motor faz com a mesma entrada, não a acurácia no mundo real.

| grupo | ≤100 m Candeia | ≤100 m geocodebr | >1 km Candeia | >1 km geocodebr |
|---|---|---|---|---|
| endereço limpo | 75,6% | 73,1% | 8,1% | 8,1% |
| com número de porta | 92,8% | 92,5% | 1,9% | 1,8% |
| quadra e lote | 91,7% | 58,1% | 1,6% | 2,4% |
| sem número | 34,0% | 30,1% | 22,9% | 23,4% |
| sem bairro e CEP | 70,9% | 67,8% | 13,3% | 16,2% |
| erro de digitação no nome | 72,7% | 74,1% | 7,8% | 7,2% |

| erro dentro da margem declarada (`raio` × `desvio_metros`, limpo) | 91,7% | 93,7% | | |

Leitura:

- Com número de porta os dois empatam: a diferença (0,3 ponto) está dentro do ruído de uma amostra desse tamanho.
- A vantagem do Candeia em quadra e lote vem de o geocodebr não ter campo para quadra e lote: ele recebeu só o logradouro. É uma diferença de escopo, não de qualidade do casamento, e são só 627 consultas.
- Sem bairro e CEP o Candeia erra menos acima de 1 km (13,3% contra 16,2%).
- O geocodebr ganha com erro de digitação. Ele usa o número de porta mesmo quando o nome da rua só casou por semelhança, e o Candeia não usa.
- O geocodebr também é mais honesto sobre a própria margem: o erro fica dentro do `desvio_metros` que ele declara em 93,7% dos casos, contra 91,7% do `raio` do Candeia.

Limites desta comparação:

- O gabarito sai do CNEFE, a mesma base dos dois motores. Isso favorece quem reproduz o CNEFE com fidelidade e não diz nada sobre endereço fora dele.
- As variantes com erro foram geradas pelo benchmark do Candeia, que também escolheu os grupos.
- O geocodebr recebeu os campos já separados. Na prática, quem usa o geocodebr precisa separar o endereço antes, e o Candeia recebe o texto livre: aqui o geocodebr teve essa ajuda.
- Não foram medidos tempo, memória nem tamanho de download.

## Roadmap

- [x] Núcleo de normalização e matching em JavaScript, portado do geocodificador do NEXO, com testes de regressão
- [x] Pipeline de dados (CNEFE → Parquet por município → índice) com manifesto e hash
- [x] Medição de tamanho por município e escolha do formato de distribuição
- [x] Suporte a quadra e lote, incluindo o endereço estruturado do DF
- [x] Interpolação para número de porta inexistente
- [x] Benchmark sintético e calibração de confiança por cor e raio
- [x] Índice publicado e loader sob demanda
- [x] Benchmark de regressão no CI
- [ ] Validação com pontos conferidos em campo
- [x] Calibração de confiança por UF: medida e descartada, piora fora da amostra (ver abaixo)
- [x] Comparação com o geocodebr nos mesmos endereços (ver [Relação com outros projetos](#relação-com-outros-projetos))
- [ ] Pacote no npm
- [x] Guia de contribuição com casos de teste por UF ([CONTRIBUTING.md](CONTRIBUTING.md))

## Desenvolvimento

```sh
npm test             # Node >= 22, sem dependências
node bench/ci.mjs    # benchmark de regressão sobre o índice publicado (~12 MB, ~25 s)
```

## Contribuindo

A ideia é que contribuir seja barato: o jeito de escrever endereço de cada UF fica em casos de teste legíveis (`test/casos/<UF>.json`, "entrada, resultado esperado"), sem precisar saber JavaScript. Ver [CONTRIBUTING.md](CONTRIBUTING.md). O CI roda um benchmark de regressão em todo pull request e falha se a acurácia cair mais de 1 ponto em qualquer grupo (`bench/ci.mjs`). Mudança intencional atualiza a referência com `node bench/ci.mjs --atualizar`.

## Origem

O motor parte do geocodificador do NEXO, ferramenta de gestão de operações de campo do mesmo autor, hoje restrito a GO. O Candeia o generaliza para as 27 UFs e o separa como biblioteca independente.

## Nome

Candeia é a lamparina de óleo. Na parábola da moeda perdida, a mulher acende a candeia e varre a casa até achar. É isso que o motor faz: procura com a luz que tem e diz até onde conseguiu enxergar.

## Licença

Código: [MIT](LICENSE). Índice de dados: [CC BY 4.0](DADOS.md), derivado do CNEFE 2022 do IBGE, com atribuição obrigatória ao IBGE em redistribuições.
