# Motor facial privado

**Código:** `services/face-engine`. **Execução:** Python 3.11, FastAPI/Uvicorn, OpenCV/NumPy e psycopg no Railway. O serviço não tem URL pública; a API o acessa em `http://face-engine.railway.internal:8080` na rede privada.

## Pipeline de inscrição

`POST /v1/enroll` recebe `guestId`, `eventId` e `imageBase64`, autenticados por Bearer `FACE_ENGINE_TOKEN`. O serviço decodifica a imagem em memória, exige lado menor de pelo menos 240 px, exatamente um rosto detectado e face de pelo menos 100 px. YuNet encontra a face; SFace extrai e normaliza vetor de 128 dimensões. O vetor é criptografado com Fernet (`FACE_TEMPLATE_KEY`) e persistido em `face_profiles.embedding_ciphertext`; `model` registra o modelo. A resposta traz `profileId`.

## Pipeline de identificação

`POST /v1/identify` recebe evento e imagem. Aplica a mesma extração, lê somente perfis associados a convidados aceitos do evento, decifra os vetores e compara por produto escalar/cosseno. Abaixo de 0,45 retorna `no_match`; entre 0,45 e 0,55 ou dois candidatos com diferença inferior a 0,08 retorna `review`; acima retorna `match` com `guestId` e `confidence`. São limiares de protótipo; não há calibração documentada em cenário real.

## Construção e proteção

O Dockerfile baixa pesos oficiais YuNet/SFace do OpenCV Zoo e confere SHA-256 antes da inicialização. As dependências Python têm versão fixa em `requirements.txt`. `FACE_ENGINE_TOKEN` autentica as chamadas; `FACE_TEMPLATE_KEY` precisa ser estável entre reinícios e deploys. Perder ou trocar a chave sem recriptografar impede leitura dos perfis já existentes. O motor não persiste foto original e usa Neon com conexão TLS. A configuração atual de psycopg usa `sslmode=require`, sem validação explícita do certificado do servidor; endureça a configuração antes de uso sensível.

## Riscos operacionais

Não há prova de vida ou detecção de apresentação por foto/tela. As pontuações não equivalem a uma probabilidade calibrada de identidade. Operação física exige supervisão, avaliação de falsos positivos/negativos, viés, iluminação e dispositivo. `GET /health` verifica banco e permite monitorar disponibilidade, mas não substitui teste ponta a ponta do modelo. Veja também [segurança e biometria](../security-and-biometrics.md).
