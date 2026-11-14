# Roda o geocodebr (IPEA) na entrada gerada por bench/geocodebr/preparar.mjs.
#
# Uso (na pasta onde está entrada_geocodebr.csv):
#   Rscript rodar.R entrada_geocodebr.csv saida_geocodebr.csv
#
# O geocodebr baixa os dados dele (CNEFE padronizado) na primeira execução e guarda em cache.
# A saída mantém todas as colunas que o geocodebr devolve; bench/geocodebr/comparar.mjs lê
# lat/lon e a precisão.

args <- commandArgs(trailingOnly = TRUE)
entrada <- if (length(args) >= 1) args[1] else "entrada_geocodebr.csv"
saida   <- if (length(args) >= 2) args[2] else "saida_geocodebr.csv"

# Pacotes binários do Posit Package Manager (Ubuntu): evita compilar arrow/duckdb, que leva
# horas numa máquina modesta. Fora do Ubuntu, cai no CRAN normal.
codinome <- tryCatch(system("lsb_release -cs", intern = TRUE), error = function(e) "")
if (nzchar(codinome)) {
  options(repos = c(CRAN = sprintf("https://packagemanager.posit.co/cran/__linux__/%s/latest", codinome)))
  options(HTTPUserAgent = sprintf("R/%s R (%s)", getRversion(),
    paste(getRversion(), R.version["platform"], R.version["arch"], R.version["os"])))
} else {
  options(repos = c(CRAN = "https://cloud.r-project.org"))
}
lib <- Sys.getenv("R_LIBS_USER")
dir.create(lib, recursive = TRUE, showWarnings = FALSE)
.libPaths(c(lib, .libPaths()))
for (p in c("geocodebr", "data.table", "jsonlite")) {
  if (!requireNamespace(p, quietly = TRUE)) install.packages(p, lib = lib)
}
library(data.table)
library(geocodebr)
cat("geocodebr", as.character(packageVersion("geocodebr")), "\n")

ent <- fread(entrada, colClasses = "character", na.strings = "")

# Nome do município pelo código IBGE (o geocodebr recebe nome ou código; o nome é o caso
# documentado).
mun <- as.data.table(jsonlite::fromJSON(
  "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado"))
mun <- mun[, .(cod = as.character(`municipio-id`), municipio = `municipio-nome`)]
ent <- merge(ent, mun, by = "cod", all.x = TRUE)
if (anyNA(ent$municipio)) stop("município sem nome na API do IBGE: ", paste(unique(ent[is.na(municipio), cod]), collapse = " "))

campos <- definir_campos(
  estado = "uf", municipio = "municipio", logradouro = "logradouro",
  numero = "numero", cep = "cep", localidade = "localidade"
)
t0 <- Sys.time()
res <- geocode(ent, campos_endereco = campos, resultado_completo = FALSE,
               resolver_empates = TRUE, resultado_sf = FALSE, verboso = TRUE)
cat(nrow(res), "linhas em", round(as.numeric(difftime(Sys.time(), t0, units = "secs"))), "s\n")
fwrite(res, saida)
cat("gravado", saida, "\n")
