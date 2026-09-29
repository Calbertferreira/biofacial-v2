# Motor facial

Serviço privado FastAPI no Railway. Usa YuNet para detectar um rosto e SFace para extrair um vetor de 128 dimensões. As imagens são processadas em memória e descartadas; a tabela `face_profiles` guarda somente o vetor criptografado com Fernet. O serviço autentica chamadas com `FACE_ENGINE_TOKEN` e pesquisa apenas convidados aceitos do evento informado.

## Implantação

O contexto Docker é esta pasta (`services/face-engine`). O Dockerfile baixa os modelos oficiais do OpenCV Zoo, verifica seus SHA-256 e inicia Uvicorn na porta `PORT` fornecida pelo Railway. Configure `DATABASE_URL`, `FACE_ENGINE_TOKEN` (32 caracteres ou mais) e `FACE_TEMPLATE_KEY` (chave Fernet estável). A API deve usar o mesmo token e `FACE_ENGINE_URL=http://face-engine.railway.internal:8080`. Não crie domínio público para o motor.

O endpoint `GET /health` verifica o banco. `POST /v1/enroll` recebe `guestId`, `eventId`, `imageBase64` e retorna `profileId`. `POST /v1/identify` recebe `eventId`, `imageBase64` e retorna `match` com `guestId` e `confidence`, `no_match` ou `review`. Ambos exigem `Authorization: Bearer <FACE_ENGINE_TOKEN>`.

## Critérios e limites

A imagem precisa ter resolução mínima de 240 pixels no lado menor, um único rosto detectado e rosto com pelo menos 100 pixels. A comparação usa similaridade de cosseno; abaixo de 0,45 retorna `no_match`, entre 0,45 e 0,55 ou quando dois candidatos têm pontuação próxima retorna `review`, acima disso retorna `match`. Esses limiares são conservadores e precisam de calibração com imagens consentidas nas condições reais de luz e câmera.

Este protótipo não implementa prova de vida. Uma fotografia ou tela exibida à câmera pode produzir identificação; portanto, a decisão física de acesso precisa de supervisão do operador e procedimento alternativo. O operador deve consultar o histórico de tentativas no Manager. A rotação de `FACE_TEMPLATE_KEY` exige recriptografar os registros antes de substituir a chave, ou os modelos existentes se tornarão ilegíveis.
