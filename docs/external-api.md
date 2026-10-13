# API HTTP para integrações

Base de teste: `https://api-production-34f89.up.railway.app`. Prefixo das rotas de negócio: `/v1`. `GET /health` não exige login e verifica acesso ao banco. JSON usa `Content-Type: application/json`. Falhas retornam `{ "error": "codigo" }`, às vezes com `details`; códigos HTTP mais comuns: 400 entrada inválida, 401 sem autenticação, 403 sem permissão, 404 ausente ou fora do escopo, 409 conflito, 413/422 imagem inadequada, 503 dependência indisponível.

## Autenticação

| Método e rota | Entrada / efeito |
| --- | --- |
| `POST /v1/auth/login` | `{ "email": "...", "password": "..." }` → `accessToken`, `expiresAt`, `user` |
| `GET /v1/auth/me` | identidade, papel e clientes permitidos |
| `POST /v1/auth/change-password` | `currentPassword`, `newPassword` de ao menos 12 caracteres; revoga sessões |
| `POST /v1/auth/logout` | revoga a sessão corrente |

Envie `Authorization: Bearer <accessToken>` em toda rota administrativa. Primeiro acesso exige troca de senha antes de outras operações. Tokens são pessoais e não devem ser distribuídos em URL ou JavaScript público.

## Cadastros e consultas

| Método | Rota | Papel/escopo | Campos principais |
| --- | --- | --- | --- |
| GET, POST | `/v1/clients` | leitura: todos conforme papel; escrita: `adm` | `name`, `externalId?` |
| PATCH | `/v1/clients/{clientId}` | `adm` | `name?`, `externalId?`, `active?` |
| GET, POST | `/v1/users` | leitura: todos conforme papel; escrita: `adm` ou `gestor` para outro gestor | `name`, `email`, `role`, `clientIds`, `temporaryPassword` |
| PATCH | `/v1/users/{userId}` | `adm` | nome, email, papel, clientes, ativo, senha temporária |
| GET, POST | `/v1/events` | leitura: escopo do papel; escrita: `adm`/`gestor` | `clientId`, `externalId?`, `name`, `startsAt`, `endsAt`, `timezone`, `venue` |
| GET, PATCH | `/v1/events/{eventId}` | leitura: escopo; escrita: `adm`/`gestor` | subconjunto dos campos do evento; só `adm` muda cliente |
| GET, POST | `/v1/events/{eventId}/guests` | leitura: escopo; escrita: `adm`/`gestor` | `name`, `email?`, `phoneE164?` |
| PATCH | `/v1/events/{eventId}/guests/{guestId}` | `adm`/`gestor` | nome e contatos opcionais |
| POST | `/v1/events/{eventId}/activate` | `adm`/`gestor` | corpo vazio; `draft`/`published` → `active` |
| POST | `/v1/events/{eventId}/finish` | `adm`/`gestor` | corpo vazio; `active` → `finished` |
| GET | `/v1/events/{eventId}/access-events` | leitura no escopo | até 500 ações, cronológicas |

`externalId` de cliente é único; cliente com mesmo ID externo pode ter nome atualizado na criação repetida. `externalId` de evento é único por cliente, mas uma repetição conflita (409), sem atualização automática. E-mail de usuário é único sem diferenciar maiúsculas. Convidado requer ao menos e-mail ou telefone E.164; combinações repetidas no evento conflitam. Criar convidado devolve `invitationUrl`, que deve ser tratado como segredo. Datas exigem offset, por exemplo `2026-10-01T18:00:00-03:00`.

```json
{
  "clientId": "UUID_DO_CLIENTE",
  "externalId": "evento-123",
  "name": "Conferência",
  "startsAt": "2026-10-01T18:00:00-03:00",
  "endsAt": "2026-10-02T01:00:00-03:00",
  "timezone": "America/Sao_Paulo",
  "venue": "Centro de eventos"
}
```

## Convite público

`GET /v1/invitations/{token}` devolve nome do convidado, evento, horários, local, status e `hasFaceProfile`. `POST /v1/invitations/{token}/accept` recebe `{ "consent": true, "imageBase64": "..." }`; a imagem pode ser omitida se houver perfil reutilizável. O retorno é `{ "status": "accepted", "guestId": "..." }`. O token tem 64 caracteres hexadecimais e já autentica o convite; não precisa Bearer de operador. O URL individual não deve ser exposto em logs, analítica ou páginas de terceiros.

## Identificação versus registro de acesso

`POST /v1/events/{eventId}/face-lookup` aceita JSON `{ "imageBase64": "..." }` ou bytes `image/jpeg`/`image/png`. Requer `adm` ou `gestor` vinculado. Responde `{ "matched": true, "guestId": "...", "guestName": "...", "confidence": 0.8 }` ou `{ "matched": false, "reason": "no_match|review|not_invited" }`. **Não grava entrada nem saída.**

`POST /v1/events/{eventId}/scan` recebe `{ "imageBase64": "...", "direction": "entry" }` ou `"exit"`. Requer sessão de `adm`, `staff` ou gestor do cliente; aceita também `SCANNER_API_KEY` opcional de integração de máquina. `direction` é opcional no contrato da API e, sem ela, a API alterna conforme o último registro; a interface Scanner sempre envia a direção explícita. Respostas de sucesso: `{ "action": "entry|exit", "guestId": "...", "guestName": "...", "id": "...", "createdAt": "..." }`. Negativa: `{ "action": "denied", "reason": "no_match|review|guest_not_eligible|already_inside|not_inside" }`, podendo incluir identidade nos casos de duplicidade. Imagem inválida retorna 413/422 e cria negativa `invalid_capture`.

O evento precisa estar `active` **e** o horário atual deve estar entre `startsAt` e `endsAt`. Uma falha do motor retorna 503 `face_engine_unavailable`; nunca concede acesso. O registro é persistido em `access_events` para consultas posteriores.

## Serviço facial interno

Somente a API deve chamar `POST /v1/enroll` e `POST /v1/identify` no motor privado com `Authorization: Bearer <FACE_ENGINE_TOKEN>`. O primeiro recebe `guestId`, `eventId`, `imageBase64` e devolve `profileId`; o segundo recebe `eventId`, `imageBase64` e devolve `status` igual a `match`, `no_match` ou `review`. Não exponha o endereço privado nem o token para parceiros.
