# Candeia

Geocodificação de endereços brasileiros que roda no seu próprio código, sem servidor, sem chave de API e sem custo por consulta.

> **Status: v1.2.0.** O motor, o índice das 27 UFs e o loader funcionam. O índice está publicado em `https://dados.lucasrikelmi.dev/cnefe2022/v1/` (Cloudflare Pages, CC BY 4.0, ver [DADOS.md](DADOS.md)). Instalação pelo npm (ver [Uso](#uso)). Os números de acurácia vêm de um benchmark sintético sobre o próprio CNEFE (132 municípios, 19.800 endereços), descrito em [docs/ARQUITETURA.md](docs/ARQUITETURA.md), e foram conferidos numa amostra nova de 104 municípios que nunca entraram no ajuste. A v1.2.0 traz o [motor híbrido](#motor-híbrido): busca da via por chave canônica e grafias candidatas, "S/N" escrito e margem do ponto da rua. Um benchmark de regressão roda no CI a cada PR.

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
npm install candeia
```

No navegador, direto de um CDN:

```js
import { criarGeocodificador } from "https://cdn.jsdelivr.net/npm/candeia@1.2.0/src/index.js";
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

Medido no benchmark (cenário com o endereço no índice, variante limpa; rodada 10): 77,7% até 100 m no geral e 94,9% com número de porta; com erro de digitação no nome, 75,6%. Verde acerta até 100 m em 99,9% dos casos. Endereço sem número fica em ~44%, limitado pela extensão da via, e o `raio` diz isso. Rua que não existe na cidade volta vermelho (centro do município) em 83% dos casos; no resto, casa com uma rua de nome parecido, e a cor e o `raio` mostram a incerteza. Numa amostra nova, de municípios que nunca entraram no ajuste, a consulta limpa cai para 74,3% até 100 m, e com número de porta fica em 96,0% (ver [Comparação numa amostra nova](#comparação-numa-amostra-nova)).

Fluxo de uma consulta:

1. **Normalização local.** Tipo da via, nome, número, quadra e lote são extraídos e padronizados.
2. **Município** pelo código IBGE de 7 dígitos, informado por quem chama.
3. **Download do arquivo do município** (ou do índice de vias e da fatia da via, nos grandes), ou leitura do que já está em memória.
4. **Busca da via:** chave exata, depois chave canônica e grafias candidatas ([motor híbrido](#motor-híbrido)), depois busca por token do nome, para não comparar com todas as ruas da cidade.
5. **Pontuação do nome** com Jaro-Winkler e Jaccard por tokens. Bairro e CEP desempatam ruas homônimas.
6. **Refinamento por número, quadra e lote.** Sem número, o motor tenta interpolar entre vizinhos, depois cai para o eixo da via, o CEP e o centro do município. `metodo` diz até onde chegou e `raio` quanto o ponto pode estar longe.

## Motor híbrido

O índice guarda o nome da via como o CNEFE grava. O próprio CNEFE às vezes grava a mesma rua de mais de um jeito, e quem digita escreve de outro ("C-2" para "C2", "Rua Central 2" para "Central II"). A busca da via combina duas ideias: uma chave canônica única e, quando ela não basta, grafias candidatas conferidas no índice. Daí o nome. Cada etapa só roda se a anterior não achou a via:

1. **Chave exata**, como o CNEFE grava.
2. **Chave canônica:** letra+número sem espaço nem hífen (1 ou 2 letras, para não juntar palavras) e sem zero à esquerda. "C2", "C 2", "C-2" e "C 02" viram a mesma chave.
3. **Grafia candidata:** número romano no fim do nome escrito em algarismo, ou o contrário, de 2 a 30 ("Rua Central 2" ↔ "Central II"). "I", "V" e "X" ficam de fora, porque podem ser letra. A candidata só é aceita se existir no índice do município. Se a cidade tem "Rua 2" e "Rua II" como ruas diferentes, vale a exata.

Duas mudanças acompanham a busca:

- **"S/N" escrito na consulta** ("S/N", "SN" ou "sem número" no fim): o ponto sai só dos endereços sem número da via, que costumam ficar em outro trecho. Sem o "S/N" escrito, nada muda, porque não dá para separar endereço sem número de número esquecido.
- **Raio do ponto da rua 15% maior.** O raio cobria só ~75% dos erros desse método. O ponto não muda, só a margem declarada.

Nada disso exige regerar o índice: tudo acontece na consulta. Nas consultas escritas como o CNEFE e sem "S/N", o ponto devolvido é idêntico ao do Candeia normal; muda só o `raio` do ponto da rua. Os números estão em [Comparação numa amostra nova](#comparação-numa-amostra-nova), e as medições, em `docs/ARQUITETURA.md` (rodadas 11 e 12).

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

### Comparação numa amostra nova

Três motores nos mesmos endereços: o geocodebr 0.7.0 (entrada em campos separados, `resolver_empates = TRUE`; scripts em `bench/geocodebr/`), o Candeia normal (v1.1.1, sem o motor híbrido) e o Candeia com o [motor híbrido](#motor-híbrido) (v1.2.0). A amostra tem 14.314 endereços de 104 municípios que nunca foram usados para ajustar o Candeia, 4 por UF sorteados por hash com semente fixa (o DF fica de fora: só tem Brasília, que já estava na amostra de ajuste). O critério foi registrado antes de rodar qualquer motor. ≤100 m é a fração de respostas a até 100 m do ponto certo (maior é melhor); >1 km é a fração que errou por mais de 1 km, incluindo as sem resposta (menor é melhor). O intervalo de 95% da diferença vem de reamostrar municípios (1.000 vezes).

| grupo | n | ≤100 m geocodebr | ≤100 m Candeia normal | ≤100 m Candeia híbrido | diferença híbrido − geocodebr (IC 95%) | >1 km geocodebr | >1 km Candeia (normal e híbrido) |
|---|---|---|---|---|---|---|---|
| endereço limpo | 14.314 | 66,9% | 74,3% | 74,3% | +7,4 [+6,1; +8,9] | 10,8% | 9,0% |
| com número de porta | 8.635 | 91,4% | 96,0% | 96,0% | +4,5 [+3,0; +6,5] | 2,4% | 0,9% |
| sem número | 5.679 | 29,6% | 41,3% | 41,3% | +11,7 [+10,2; +13,4] | 23,6% | 21,2% |
| número omitido | 8.635 | 51,0% | 59,6% | 59,6% | +8,6 [+7,3; +10,0] | 6,5% | 5,4% |
| erro de digitação no nome | 12.990 | 67,8% | 73,0% | 73,0% | +5,2 [+3,7; +6,8] | 9,4% | 9,3% |
| sem bairro e CEP | 14.314 | 62,5% | 70,1% | 70,1% | +7,6 [+6,2; +9,1] | 18,1% | 13,4% |
| "S/N" escrito na consulta | 5.516 | 29,1% | 39,8% | 43,0% | +13,9 [+12,2; +15,9] | 24,0% | normal 21,8%, híbrido 20,8% |
| erro dentro da margem declarada (`desvio_metros` × `raio`, limpo) | 14.314 | 92,7% | 89,7% | 93,5% | — | — | — |

Grafias diferentes da do CNEFE (variantes desenhadas para problemas conhecidos do Candeia; amostras pequenas, sem intervalo):

| como a consulta escreve | n | ≤100 m geocodebr | ≤100 m Candeia normal | ≤100 m Candeia híbrido |
|---|---|---|---|---|
| letra+número com espaço trocado ("T28" ↔ "T 28") | 171 | 24,6% | 51,5% | 60,8% |
| letra+número com hífen ("T-28") | 171 | 38,0% | 18,7% | 60,2% |
| romano no fim do nome escrito em algarismo ("Central 2" para "Central II") | 54 | 48,1% | 13,0% | 66,7% |

Pareado, na consulta limpa: só o Candeia acerta até 100 m em 1.379 endereços, só o geocodebr em 321.

Leitura:

- Nas variantes padrão, o Candeia normal e o híbrido dão o mesmo resultado endereço por endereço. O híbrido só muda a resposta quando a consulta escreve a via de outro jeito que o CNEFE ou escreve "S/N", e muda o tamanho do `raio` do ponto da rua.
- Fora da amostra de ajuste, a vantagem do Candeia não encolheu: na amostra antiga era 79,0 × 73,1% na consulta limpa, aqui é 74,3 × 66,9%. Os dois motores caíram, então os municípios novos são mais difíceis para ambos.
- A margem declarada era o único ponto em que o geocodebr ganhava com folga (92,7 × 89,7%). O híbrido aumenta em 15% o raio do ponto da rua e passa a 93,5%. Nenhum acerto muda, só a margem fica mais honesta.
- Em erro de digitação, os dois empatam acima de 1 km (9,3 × 9,4%).
- Por UF, o Candeia fica à frente em todas na consulta limpa, mas em PE e SP o intervalo cruza zero, ou seja, é empate estatístico. A maior diferença é em RO (75,3 × 46,2%).
- Nos 321 endereços em que só o geocodebr acerta, 216 são do ponto da rua (consulta sem número) e 105 são número de porta repetido em pontos distantes da mesma via.

Limites desta comparação:

- O gabarito sai do CNEFE, e o Candeia indexa o CNEFE ponto a ponto, enquanto o geocodebr usa uma base agregada e padronizada. Isso favorece o Candeia por construção e não diz nada sobre endereço fora do CNEFE.
- As variantes com erro foram geradas pelo benchmark do Candeia, que também escolheu os grupos. As variantes de grafia e romano foram desenhadas olhando para problemas do Candeia.
- O fator do raio e a regra de romano foram ajustados na amostra antiga, mas a decisão de mexer na margem veio de ver o resultado do geocodebr nesta amostra.
- O geocodebr recebeu os campos já separados. O Candeia recebe o texto livre. Aqui o geocodebr teve essa ajuda.
- Quadra e lote não entram nesta tabela: o geocodebr não tem campo para eles (na amostra antiga, com só o logradouro, ficou em 58,1% contra 94,9%).
- Não foram medidos tempo, memória nem tamanho de download.

A comparação anterior, na amostra em que o Candeia foi ajustado (66 mil consultas de 132 municípios), está em [docs/ARQUITETURA.md](docs/ARQUITETURA.md#comparação-com-o-geocodebr-na-amostra-de-ajuste).

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
- [x] Comparação com o geocodebr nos mesmos endereços, também numa amostra nova (ver [Relação com outros projetos](#relação-com-outros-projetos))
- [x] Motor híbrido: grafia canônica, romano ↔ número, "S/N" escrito e margem do ponto da rua (ver [Motor híbrido](#motor-híbrido))
- [ ] Script da amostra nova no repositório, para reproduzir a validação fora da amostra
- [x] Pacote no npm
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
