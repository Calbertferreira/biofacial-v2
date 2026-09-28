# API para outra aplicação

Base: `https://SUA-API/v1`. Todos os endpoints de cadastro exigem `Authorization: Bearer <accessToken>` obtido em `POST /auth/login`. A outra aplicação deve usar uma conta própria com papel adequado. O token expira em 12 horas; não o inclua em URL, logs ou código do navegador.

## Autenticação

`POST /auth/login` recebe `{ "email": "...", "password": "..." }` e devolve `accessToken`, `expiresAt` e `user`. Uma conta com `mustChangePassword: true` deve chamar `POST /auth/change-password` com `currentPassword` e `newPassword` (mínimo 12 caracteres); depois deve fazer login novamente. `GET /auth/me` retorna identidade, papel e IDs dos clientes permitidos. `POST /auth/logout` revoga a sessão.

## Cadastros

| Método e rota | Papel que escreve | Corpo principal |
| --- | --- | --- |
| `POST /clients` | `adm` | `name`, `externalId?` |
| `PATCH /clients/{clientId}` | `adm` | `name?`, `externalId?`, `active?` |
| `POST /users` | `adm`; `gestor` apenas para novo gestor dentro do próprio escopo | `name`, `email`, `role`, `clientIds`, `temporaryPassword` |
| `PATCH /users/{userId}` | `adm` | `name?`, `email?`, `role?`, `clientIds?`, `active?`, `temporaryPassword?` |
| `POST /events` | `adm`; `gestor` no cliente vinculado | `clientId`, `name`, `startsAt`, `endsAt`, `timezone`, `venue`, `externalId?` |
| `PATCH /events/{eventId}` | `adm`; `gestor` no cliente vinculado | Campos do evento a alterar; apenas `adm` pode transferir `clientId` |
| `POST /events/{eventId}/guests` | `adm`; `gestor` no cliente vinculado | `name`, `email?`, `phoneE164?` |
| `PATCH /events/{eventId}/guests/{guestId}` | `adm`; `gestor` no cliente vinculado | `name?`, `email?`, `phoneE164?` |
| `POST /events/{eventId}/activate` | `adm`; `gestor` no cliente vinculado | Corpo vazio |

`externalId` de cliente é único e faz o envio repetido atualizar o nome. Emails de usuários são únicos sem distinção de maiúsculas. Um gestor precisa de pelo menos um `clientId`; `adm` e `staff` não recebem vínculos. `temporaryPassword` tem no mínimo 12 caracteres e deve ser entregue ao usuário por um canal seguro.

Exemplos de cliente e gestor:

```json
{ "name": "Empresa A", "externalId": "erp-cliente-42" }
```

```json
{
  "name": "Gestora A",
  "email": "gestora@empresa.example",
  "role": "gestor",
  "clientIds": ["UUID_DO_CLIENTE_1", "UUID_DO_CLIENTE_2"],
  "temporaryPassword": "SENHA_TEMPORARIA_SEGURA"
}
```

Exemplo de evento:

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

Consultas autenticadas: `GET /clients`, `GET /users`, `GET /events`, `GET /events/{eventId}`, `GET /events/{eventId}/guests` e `GET /events/{eventId}/access-events`. A API filtra automaticamente o resultado conforme o papel. `staff` só dispõe dessas operações de leitura.

## Consultar uma foto para um evento

`POST /events/{eventId}/face-lookup` aceita uma foto binária com `Content-Type: image/jpeg` ou `image/png`. Também aceita JSON `{ "imageBase64": "..." }`. Exige `adm` ou `gestor` vinculado ao cliente do evento.

```bash
curl -X POST "https://SUA-API/v1/events/UUID_DO_EVENTO/face-lookup" \
  -H "Authorization: Bearer TOKEN_DE_LOGIN" \
  -H "Content-Type: image/jpeg" \
  --data-binary @foto.jpg
```

Resposta quando o serviço facial encontra uma identidade aceita e convidada para esse evento:

```json
{ "matched": true, "guestId": "UUID_DO_CONVIDADO", "guestName": "Nome", "confidence": 0.99 }
```

Sem correspondência ou sem convite válido, retorna `{ "matched": false, "reason": "no_match" }` ou `reason: "not_invited"`. Falha do serviço facial retorna HTTP `503` com `face_engine_unavailable`; nunca resulta em acesso autorizado. Esta consulta **não registra entrada nem saída**. Para a operação do tablet, a rota separada `POST /events/{eventId}/scan` decide e registra a movimentação.

O contrato foi exercitado com um substituto local de reconhecimento. A precisão de reconhecimento facial real ainda não foi validada, e nenhum motor comercial foi integrado. Não envie fotografias reais antes dessa integração e da revisão de privacidade.
