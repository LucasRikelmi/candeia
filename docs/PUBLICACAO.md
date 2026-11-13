# Publicar o índice no Cloudflare R2

Destino: um bucket do R2 ligado a um subdomínio de um domínio que já está na Cloudflare (por exemplo `dados.lucasrikelmi.dev`). URL final do índice: `https://dados.lucasrikelmi.dev/cnefe2022/v1/`.

Tudo abaixo é feito uma vez. Atualizar o índice depois é gerar de novo e subir num prefixo novo (`v2`), sem apagar o anterior.

## 1. Criar o bucket e ligar o subdomínio (painel da Cloudflare)

1. R2 → Create bucket → nome `candeia`, localização automática.
2. No bucket: Settings → Public access → Custom Domains → Connect Domain → `dados.lucasrikelmi.dev`. A Cloudflare cria o registro DNS.
3. Não habilite a URL `r2.dev`. Ela tem limite de requisições e não passa pelo cache.

## 2. Liberar CORS

No bucket: Settings → CORS Policy → adicione as origens que vão consultar (o seu site, `http://localhost:8080` para testes):

```json
[
  {
    "AllowedOrigins": ["https://<seu site>", "http://localhost:8080"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

Sem isso o navegador bloqueia a leitura, mesmo com o arquivo público.

## 3. Criar a chave de API do R2

R2 → Manage R2 API Tokens → Create API token → permissão "Object Read & Write" só no bucket `candeia`. Guarde o Access Key ID, o Secret Access Key e o endpoint `https://<account id>.r2.cloudflarestorage.com`. A chave não vai para o repositório nem para o chat.

## 4. Configurar o rclone (máquina que tem o índice)

```bash
sudo apt install rclone
rclone config create r2 s3 provider=Cloudflare \
  access_key_id=<Access Key ID> secret_access_key=<Secret Access Key> \
  endpoint=https://<account id>.r2.cloudflarestorage.com acl=private
rclone lsd r2:            # deve listar o bucket candeia
```

## 5. Subir

```bash
cd <pasta do pipeline>
./publicar_r2.sh ../indice_distribuicao r2:candeia/cnefe2022/v1
```

São ~5,7 mil arquivos e ~1 GB. Em conexão doméstica, conte com dezenas de minutos. O script pode ser rodado de novo se cair: o rclone pula o que já subiu. O manifesto sobe por último, então nenhum cliente enxerga a versão incompleta.

## 6. Conferir pela URL pública

```bash
python verificar_publicacao.py https://dados.lucasrikelmi.dev/cnefe2022/v1/ --origem https://<seu site>
```

Confere HTTP 200, sha256 contra o manifesto, ausência de `Content-Encoding` e CORS numa amostra (SP, DF, Goiânia, Boa Vista, Porto Alegre). `--todos` confere os ~5,7 mil arquivos.

## Custos e limites

O R2 não cobra saída de dados. A camada grátis (conferir os valores atuais na página de preços da Cloudflare) cobre com folga ~1 GB armazenado. Cada consulta fria baixa de 0,6 a 2,4 MB (medido em `docs/ARQUITETURA.md`). Com o cache do navegador, a segunda consulta no mesmo município não vai à rede.
