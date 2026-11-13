# Candeia

Geocodificação de endereços brasileiros que roda no seu próprio código, sem servidor, sem chave de API e sem custo por consulta.

> **Status: em planejamento.** Este README descreve a premissa e o desenho do projeto. Ainda não há pacote publicado, e nenhuma métrica de acurácia foi medida. Quando houver números, eles entram aqui com a metodologia.

## O problema

Quem precisa transformar um endereço brasileiro em coordenada hoje tem, na prática, duas saídas:

1. **APIs comerciais (Google Maps e similares).** Funcionam bem, mas cobram por consulta, exigem chave e mandam os endereços dos seus clientes para um terceiro.
2. **Ferramentas de pesquisa baseadas no CNEFE do IBGE.** Gratuitas e offline, mas pensadas para análise em lote por quem programa em R, com download de dados grande e sem suporte a quadra e lote, que é como muito endereço brasileiro realmente se escreve (Goiânia, Distrito Federal, Palmas, loteamentos em geral).

Falta uma opção gratuita que rode dentro de um site ou de um backend comum e entenda o jeito brasileiro de escrever endereço.

## A premissa

O IBGE publica o CNEFE, o cadastro de endereços usado no Censo, com coordenadas. Com ele dá para montar um geocodificador **estático**:

- **Sem servidor.** O código roda no navegador ou no Node de quem usa. Os dados são arquivos estáticos públicos. Nenhuma lógica roda do nosso lado, e o host dos arquivos nunca vê o endereço consultado, só qual município foi baixado.
- **Dados por município.** Quem consulta Belo Horizonte baixa o arquivo de Belo Horizonte, não o Brasil. O arquivo fica em cache local, e a segunda consulta não usa rede. Quem quiser tudo offline baixa o pacote da UF e serve do próprio ambiente.
- **Resposta com qualidade explícita.** Cada resultado traz o nível em que o endereço foi encontrado e uma estimativa de erro em metros, em vez de fingir precisão que não tem.
- **Endereço do jeito que é digitado.** Abreviações ("R.", "Av.", "Tv."), rodovias com a sigla da UF, quadra e lote no lugar do número de porta, complemento no campo errado.

## Como deve funcionar

```js
import { geocodificar } from "candeia";

const r = await geocodificar({
  uf: "MG",
  municipio: "Belo Horizonte",
  logradouro: "Rua dos Bobos",
  numero: "0",
  quadra: "75",
  bairro: "Centro",
  cep: "30000-000",
});

// {
//   lat, lon,
//   nivel: "numero" | "quadra_lote" | "logradouro" | "bairro" | "cep" | "municipio",
//   confianca,     // calibrada contra o benchmark, não é só um score de similaridade
//   raio_m,        // erro estimado em metros
//   candidatos: [] // alternativas quando há empate
// }
```

(Interface proposta. Pode mudar até a primeira versão. O código atual em `src/` ainda expõe a API herdada do NEXO; ver [docs/ARQUITETURA.md](docs/ARQUITETURA.md).)

Fluxo de uma consulta:

1. **Normalização local.** Tipo da via, nome, número, quadra e lote são extraídos e padronizados.
2. **Escolha do município** por código, nome ou CEP, usando uma tabela pequena embutida.
3. **Download do arquivo do município** (uma única requisição GET de arquivo estático) ou leitura do cache local.
4. **Busca por token do nome da via**, para não comparar com todas as ruas da cidade.
5. **Pontuação do nome** com Jaro-Winkler e Jaccard por tokens. Bairro e CEP desempatam ruas homônimas.
6. **Refinamento por número, quadra e lote.** Sem número, a busca desce para quadra, depois logradouro, depois bairro, CEP e município, e o nível devolvido diz até onde chegou.

## Dados

- **Fonte:** CNEFE, Censo 2022, IBGE. O IBGE permite o reuso citando a fonte. O termo exato de uso será conferido e transcrito aqui antes da primeira publicação de dados.
- **Formato:** Parquet particionado por UF e município, com manifesto versionado e hash. Em amostra de duas UFs, a conversão reduziu o CSV bruto em duas ordens de grandeza (por exemplo, 236 MB para 3,5 MB no DF). Tamanhos do Brasil inteiro ainda serão medidos.
- **Pipeline:** os dados nunca entram por pull request. Eles são gerados apenas pelo pipeline do repositório, de forma reproduzível.
- **Análise por UF:** o repositório também guarda a análise exploratória de cada UF (tipos de logradouro, abreviações, proporção de endereços sem número, qualidade de CEP). É dela que saem as regras de normalização.

Cada UF escreve endereço de um jeito. Na amostra inicial, o DF tem 96% dos registros com tipo "EDF" e 97% sem número de porta, com o endereço real em quadra, conjunto e lote. O AC tem 57% de CEPs genéricos da cidade e vias rurais como ramal, igarapé e seringal. Um motor que só funciona com "rua + número" não cobre isso.

## Qualidade e honestidade sobre os números

- Um score de similaridade não é probabilidade. A confiança só será exibida em percentual depois de calibrada contra o benchmark, separadamente por UF.
- O benchmark sintético sorteia endereços do próprio CNEFE e os suja (abreviações, erros de digitação, campos faltando). Ele é otimista por construção, porque o gabarito vem da mesma base. O README vai dizer isso junto com os resultados.
- O CNEFE é de 2022. Endereços novos não existem nele.
- Coordenadas aproximadas servem para mapa, roteirização grosseira, estatística e triagem. Não servem para localizar um portão específico quando o nível devolvido for `logradouro` ou menor.

## Relação com outros projetos

O [geocodebr](https://ipeagit.github.io/geocodebr), do IPEA, também usa o CNEFE, funciona offline e retorna nível de precisão e desvio em metros. É mais maduro e cobre geocodificação reversa e busca por CEP. A proposta do Candeia é outra: rodar em JavaScript (navegador e Node), baixar só o município consultado e tratar quadra e lote. Um dos entregáveis planejados é um benchmark comparando os dois nos mesmos endereços.

## Roadmap

- [x] Núcleo de normalização e matching em JavaScript, portado do geocodificador do NEXO, com testes de regressão
- [ ] Pipeline de dados (CNEFE → Parquet por município) com manifesto e hash
- [ ] Análise exploratória por UF
- [ ] Medição de tamanho por município e escolha do formato de distribuição
- [ ] Suporte a quadra e lote (GO, DF e demais UFs que usam)
- [ ] Interpolação para número de porta inexistente
- [ ] Benchmark sintético, calibração de confiança por UF e comparação com o geocodebr
- [ ] Pacote npm e distribuição dos dados
- [ ] Guia de contribuição com casos de teste por UF

## Desenvolvimento

```sh
npm test   # Node >= 22, sem dependências
```

## Contribuindo

A ideia é que contribuir seja barato: regras de abreviação e tipos de via por UF ficam em casos de teste legíveis ("entrada, resultado esperado"). O CI roda o benchmark em todo pull request e bloqueia mudanças que reduzam a acurácia. Detalhes virão com o guia de contribuição.

## Origem

O motor parte do geocodificador do NEXO, ferramenta de gestão de operações de campo do mesmo autor, hoje restrito a GO. O Candeia o generaliza para as 27 UFs e o separa como biblioteca independente.

## Nome

Candeia é a lamparina de óleo. Na parábola da moeda perdida, a mulher acende a candeia e varre a casa até achar. É isso que o motor faz: procura com a luz que tem e diz até onde conseguiu enxergar.

## Licença

A definir. O código e os dados terão licenças separadas, e os dados seguem os termos de uso do IBGE.
