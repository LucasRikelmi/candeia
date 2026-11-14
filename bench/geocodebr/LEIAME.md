# Comparação com o geocodebr

O [geocodebr](https://ipeagit.github.io/geocodebr) (IPEA) é um pacote R. Os dois motores usam o CNEFE 2022 e o gabarito do benchmark também vem dele, então a comparação mede o que cada um faz com a mesma entrada, não a acurácia no mundo real.

1. Gere a entrada (Node, a partir do recorte de `pipeline/amostrar_benchmark.py`):
   `node bench/geocodebr/preparar.mjs --dados <pasta do recorte> --saida entrada_geocodebr.csv`
2. Rode o geocodebr (R ≥ 4.1; o script instala os pacotes binários do Posit Package Manager no Ubuntu). No Ubuntu, antes, instale as bibliotecas de sistema do `sf`:
   `sudo apt install -y r-base libudunits2-dev libgdal-dev libgeos-dev libproj-dev libssl-dev libcurl4-openssl-dev`

   Depois:
   `Rscript bench/geocodebr/rodar.R entrada_geocodebr.csv saida_geocodebr.csv`
3. Rode o Candeia no mesmo recorte (`bench/rodar.mjs`) e compare:
   `node bench/geocodebr/comparar.mjs --dados <pasta do recorte> --geocodebr saida_geocodebr.csv --candeia <resultados_candeia.json>`

A entrada vai em campos separados (logradouro, número, CEP, bairro), que é como o geocodebr recebe. Quadra e lote não têm campo no geocodebr: nesses endereços vai só o logradouro.
