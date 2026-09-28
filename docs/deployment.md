# Implantação inicial

## Vercel

Crie três projetos com o mesmo repositório e diretórios raiz distintos:

| Projeto | Root directory | Variáveis |
| --- | --- | --- |
| Manager | `apps/manager` | Nenhuma nesta etapa |
| Convite | `apps/invite` | `API_INTERNAL_URL` com URL pública HTTPS da API Railway |
| Scanner | `apps/scanner` | Nenhuma nesta etapa |

O build depende do pacote compartilhado `packages/contracts`; mantenha acesso ao monorepo inteiro no processo de instalação. Ajuste o comando de build para `pnpm --filter @biofacial/<app> build` a partir da raiz se o painel da Vercel não resolver automaticamente o workspace.

## Railway

Implante a API como serviço Node a partir do monorepo. Build: `pnpm install --frozen-lockfile && pnpm --filter @biofacial/contracts build && pnpm --filter @biofacial/api build`. Start: `pnpm --filter @biofacial/api start`. Configure `DATABASE_URL`, `SCANNER_API_KEY`, `FACE_ENGINE_URL`, `FACE_ENGINE_TOKEN`, `PUBLIC_BASE_URL` (domínio HTTPS da aplicação Convite) e `PORT` quando necessário. `ADMIN_API_KEY` funciona apenas com `BROWSER_DEMO=true` em localhost e não deve ser configurada na implantação pública. Health check: `/health`.

O serviço facial será um serviço Railway separado, acessível apenas por rede privada a partir da API. Não o exponha antes de implementar autenticação entre serviços e validação do modelo.

## Neon

Crie banco de desenvolvimento isolado e aplique `pnpm --filter @biofacial/db migrate` com `DATABASE_URL_UNPOOLED` configurada. A API usa `DATABASE_URL` com pooler. A migração é idempotente para a criação inicial das tabelas, mas futuras alterações deverão usar migrações versionadas, nunca editar esta migração após implantação.

## Antes de produção

Configure domínios, segredos, observabilidade, MFA administrativo e limitação distribuída de login. Avalie substituir o login local por OIDC conforme o provedor escolhido. Teste o caminho completo de cadastro facial, entrada/saída e auditoria antes de receber convidados reais.
