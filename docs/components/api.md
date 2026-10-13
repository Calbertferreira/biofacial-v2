# API — regras de negócio

**Código:** `apps/api`. **Execução:** Node.js 24 e Fastify 5 no Railway; PostgreSQL Neon via `pg`. **URL de teste:** https://api-production-34f89.up.railway.app.

## Módulos

- `server.ts`: inicialização, `/health`, criação/edição de evento e convidado, consulta de convite e registro dos demais módulos.
- `auth.ts`: login, sessão, logout, troca de senha, bloqueio temporário.
- `security.ts`: leitura do Bearer, comparação de chave de scanner, regras de escopo por cliente.
- `management.ts`: clientes, usuários e listagens de eventos/convidados.
- `flows.ts`: aceite, ativação/finalização, scanner, histórico e consulta facial.
- `packages/contracts`: validação Zod dos dados recebidos.

## Invariantes principais

Um evento de produção exige `clientId` ativo. Convidado exige e-mail ou telefone E.164 e recebe link exclusivo. `adm` alcança todos os registros; `staff` consulta cadastros mas também pode operar o Scanner; `gestor` escreve apenas em clientes vinculados. O backend faz essas checagens em cada rota.

`/v1/events/{id}/scan` exige evento ativo e horário corrente dentro do período. Faz uma chamada ao motor privado com timeout de 10 s, valida o retorno, confirma que o convidado pertence ao evento e aceitou, serializa o estado de acesso com `SELECT ... FOR UPDATE` e grava uma ação. A consulta `/face-lookup` identifica sem registrar movimentação e é permitida a `adm`/`gestor`, não a `staff`.

`/health` faz `SELECT 1` no banco. O pool usa no máximo 10 conexões por instância da API. A API limita corpo HTTP a 3 MiB; os esquemas limitam Base64 a 2 milhões de caracteres. Requisições Fastify não são registradas automaticamente, para reduzir exposição de tokens de convite nas URLs.

## Dependências e falhas

Sem `PUBLIC_BASE_URL`, a criação de convidados devolve 503. Sem motor facial configurado/disponível, aceite que precisa de foto, scanner e consulta facial devolvem 503. A API nunca transforma esse erro em acesso aceito. Migrações devem preceder deploy de código que exige novas colunas. Veja [contrato HTTP](../external-api.md), [modelo de dados](../data-model.md) e [implantação](../deployment.md).
