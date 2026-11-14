# Contribuindo

A contribuição mais útil é um **caso de teste**: um endereço escrito do jeito que as pessoas escrevem na sua cidade e o que o motor deveria entender dele. Não precisa saber JavaScript.

## Casos de teste por UF

Ficam em `test/casos/<UF>.json` (`BR.json` para o que vale no país todo). Cada caso é uma entrada e os campos esperados:

```json
{ "entrada": "Rua 8, Qd 21 Lt 4", "esperado": { "via": "8", "quadra": "21", "lote": "4", "numero": null } }
```

Só os campos listados em `esperado` são conferidos. Os campos possíveis são os de `extrairEntidades`:

| campo | o que é | exemplo |
|---|---|---|
| `tipo` | tipo do logradouro, por extenso | `rua`, `avenida`, `ramal` |
| `via` | nome da via sem o tipo, minúsculo, sem acento, títulos por extenso | `doutor moraes` |
| `numero` | número de porta (ou o km, em rodovia) | `"120"` |
| `quadra`, `lote` | quadra e lote | `"21"`, `"4"` |
| `km` | quilômetro em rodovia ou ramal | `"12"` |
| `viaCruzamento` | segunda via em "Rua X esquina com Rua Y" | `"2"` |
| `viaSemNumero`, `numeroSemVirgula` | leitura alternativa quando o número vem colado no nome ("Avenida Brasil 1500") | `"brasil"`, `"1500"` |

Use `null` para dizer "este campo deve sair vazio".

**Caso que o motor ainda erra:** adicione mesmo assim, com `"todo": "o que está errado"`. Ele aparece como pendente sem quebrar o CI, e vira a lista de trabalho de quem mexe no parser.

Para conferir o que o motor devolve hoje:

```sh
node -e 'import("./src/index.js").then(({ extrairEntidades }) => console.log(extrairEntidades("Rua 8, Qd 21 Lt 4")))'
```

### O que faz um bom caso

- Endereço real, do jeito que chega num cadastro ou formulário. Não use endereço de uma pessoa: troque o número ou a quadra.
- Um padrão por caso. Se a sua cidade escreve "Qd" e "Q." de formas diferentes, são dois casos.
- No campo `notas` do arquivo, diga de onde vem o padrão (loteamento, zona rural, cadastro de prefeitura).

## Mudanças no motor

```sh
npm test             # testes, incluindo os casos por UF
node bench/ci.mjs    # benchmark de regressão sobre o índice publicado (~25 s)
```

O CI roda os dois em todo pull request. O benchmark falha se qualquer grupo perder mais de 1 ponto em "até 100 m" ou piorar mais de 1 ponto em "acima de 1 km".

Se a mudança altera o resultado de propósito:

1. Rode o benchmark completo (`bench/rodar.mjs`, recorte gerado por `pipeline/amostrar_benchmark.py`) e compare antes e depois, inclusive o cenário N (rua que não existe no município).
2. Se mudou a regra de cor ou de raio, regere a calibração: `node bench/calibrar.mjs --resultados <resultados_candeia.json>`.
3. Atualize a referência do CI: `node bench/ci.mjs --atualizar`.
4. Coloque no PR a tabela de antes e depois por grupo.

Mudança que só melhora a média e piora algum grupo precisa justificar a troca.

## Dados

Arquivos do índice nunca entram por pull request: eles são gerados pelo `pipeline/` a partir do CNEFE. Correção de dado vem como mudança no pipeline, com a medição do efeito.
