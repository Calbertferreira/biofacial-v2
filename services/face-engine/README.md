# Motor facial

Serviço privado FastAPI no Railway. Usa YuNet para detectar um rosto e SFace para extrair um vetor de 128 dimensões. Armazena uma selfie JPEG e um vetor cifrados com Fernet em `person_face_profiles`; `guests.person_face_id` vincula esse perfil a cada convite. A imagem capturada no scanner é descartada após a análise. A API verifica separadamente se o ID facial possui convite aceito para o evento selecionado.

## Implantação

O contexto Docker é esta pasta (`services/face-engine`). O Dockerfile baixa os modelos oficiais do OpenCV Zoo, verifica seus SHA-256 e inicia Uvicorn na porta `PORT` fornecida pelo Railway. Configure `DATABASE_URL`, `FACE_ENGINE_TOKEN` (32 caracteres ou mais) e `FACE_TEMPLATE_KEY` (chave Fernet estável). A API deve usar o mesmo token e `FACE_ENGINE_URL=http://face-engine.railway.internal:8080`. Não crie domínio público para o motor.

O endpoint `GET /health` verifica o banco. A primeira aceitação de convite de uma pessoa chama `POST /v1/verify-or-enroll` com `guestId`, `eventId` e `imageBase64` para criar seu cadastro facial. Convites seguintes que correspondam ao mesmo e-mail ou telefone reutilizam o perfil pela API e exigem apenas o aceite; não capturam outra selfie. `/v1/enroll` é um alias temporário para atualização coordenada da API. `POST /v1/identify` recebe `eventId`, `imageBase64` e retorna `match` com `profileId` e `confidence`, `no_match` ou `review`. A busca facial é global; apenas a API decide se o perfil pode entrar no evento. Os endpoints biométricos exigem `Authorization: Bearer <FACE_ENGINE_TOKEN>`.

## Critérios e limites

A imagem precisa ter resolução mínima de 240 pixels no lado menor, um único rosto detectado e rosto com pelo menos 100 pixels. A comparação usa similaridade de cosseno; abaixo de 0,45 retorna `no_match`, entre 0,45 e 0,55 ou quando dois candidatos têm pontuação próxima retorna `review`, acima disso retorna `match`. Esses limiares são conservadores e precisam de calibração com imagens consentidas nas condições reais de luz e câmera.

Este protótipo não implementa prova de vida. Uma fotografia ou tela exibida à câmera pode produzir identificação; portanto, a decisão física de acesso precisa de supervisão do operador e procedimento alternativo. O operador deve consultar o histórico de tentativas no Manager. A rotação de `FACE_TEMPLATE_KEY` exige recriptografar os vetores e as selfies antes de substituir a chave, ou os dados existentes se tornarão ilegíveis. Ao excluir um convidado da lista, seu vínculo com o perfil facial é removido; o perfil permanece para outros convites e o histórico de acesso permanece. Fotos da tabela legada só devem ser removidas após a atualização e conferência dos serviços.
