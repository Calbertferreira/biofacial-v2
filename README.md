# BioFacial v2

Nova implementação do fluxo de clientes, usuários da aplicação, eventos, convites e acesso facial. Os projetos legados permanecem em suas pastas originais.

## Componentes

| Pasta | Destino | Responsabilidade |
| --- | --- | --- |
| `apps/manager` | Vercel | Administração do evento e indicadores |
| `apps/invite` | Vercel | Convite individual e cadastro no celular |
| `apps/scanner` | Vercel | Interface de entrada no tablet |
| `apps/api` | Railway | Regras de negócio e persistência |
| `services/face-engine` | Railway privado | Verificação facial; contrato inicial, sem modelo carregado |
| `packages/contracts` | Compartilhado | Tipos e validações HTTP |
| `packages/db` | Neon | Migração SQL e acesso ao banco |

## Começar localmente

1. Instale Node 24 e pnpm 11.
2. Execute `pnpm install` na raiz.
3. Crie `.env` a partir de `.env.example` e configure um banco PostgreSQL/Neon de desenvolvimento.
4. Execute `pnpm --filter @biofacial/db migrate:local`.
5. Inicie a API com `pnpm dev:api` e as interfaces com `pnpm dev:manager`, `pnpm dev:invite` e `pnpm dev:scanner` em terminais separados.

Portas locais: Manager 3000, Convite 3002, Scanner 3003 e API 3001. A aplicação de convites usa `API_INTERNAL_URL` ou `NEXT_PUBLIC_API_URL` para localizar a API; localmente usa `http://localhost:3001` como padrão.

## Estado da implementação

Esta etapa inclui clientes, usuários `adm`/`staff`/`gestor`, eventos por cliente, convidados, consulta e aceite de convites, entrada/saída e consulta facial por evento. O Manager local abre o cadastro em `http://localhost:3000` (redirecionado para `/admin`; na validação atual, `http://127.0.0.1:3100/admin`). A demonstração antiga permanece em `/demo`. Veja [usuários e clientes](docs/application-users.md) e [rotas externas](docs/external-api.md).

O envio de mensagens, o motor biométrico real e os indicadores ainda precisam ser implementados. Sem um serviço facial configurado, a API falha fechada nas operações biométricas. Os testes usam um substituto local; isso valida os contratos e permissões, não a precisão biométrica.

Para publicar uma prévia do Manager e da API, veja [publicação de teste](docs/web-preview.md). A API pode iniciar sem motor facial; nesse caso, os endpoints biométricos retornam indisponível.
