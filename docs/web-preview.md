# Publicação de teste na web

## Escopo desta prévia

O Manager em `apps/manager` permite login e gestão de clientes, usuários e eventos. A API em `apps/api` é servida pelo Railway e usa o Neon. A prévia não valida reconhecimento facial: `services/face-engine` ainda não contém um modelo real. Sem `FACE_ENGINE_URL` e `FACE_ENGINE_TOKEN`, a API responde `503 face_engine_unavailable` nas operações biométricas. Sem `SCANNER_API_KEY`, o scanner responde `503 scanner_unavailable`.

O convite só deve ser habilitado quando o aplicativo `apps/invite` estiver publicado e sua URL estiver em `PUBLIC_BASE_URL`. Sem ela, a criação de convidados responde `503 invitation_app_unavailable` antes de inserir dados. Não configure `BROWSER_DEMO=true` em serviços públicos.

## API no Railway

1. Crie um serviço de teste com o diretório raiz do monorepo. O `Dockerfile` na raiz instala as dependências, compila os contratos e a API e inicia `@biofacial/api`.
2. Configure `DATABASE_URL` como variável secreta no serviço, preferencialmente apontando para uma branch de teste do Neon. A migração do banco deve ser aplicada antes da primeira publicação.
3. Não configure as variáveis de biometria ou scanner enquanto seus serviços reais não estiverem disponíveis. Configure `PUBLIC_BASE_URL` apenas depois de publicar o aplicativo de convites.
4. Configure o health check em `/health`, gere um domínio Railway e verifique que o retorno é HTTP 200 com `{ "status": "ok" }`.

O serviço aceita a porta fornecida por `PORT` e escuta em `0.0.0.0`. A chave `ADMIN_API_KEY` só pertence à demonstração local e não é necessária na prévia pública.

## Manager na Vercel

1. Crie um projeto Vercel com o diretório raiz `apps/manager` e framework Next.js.
2. Configure `API_INTERNAL_URL` como variável de servidor, com a URL HTTPS pública da API Railway, sem barra final.
3. Faça uma publicação **Preview**. A rota `/` redireciona para `/admin`.
4. Proteja a prévia com os controles de acesso da Vercel e use um usuário real de `app_users` para entrar. O cookie de sessão é `HttpOnly`, `SameSite=Lax` e `Secure` em produção.

## Verificações após publicar

- A API `/health` retorna 200.
- O Manager `/` abre `/admin` e carrega a logomarca e a imagem.
- Login, listagem de clientes, usuários e eventos funcionam para um administrador.
- A criação de cliente e evento funciona com um usuário autorizado.
- A API não aceita a chave de demonstração quando `BROWSER_DEMO` está ausente.
- As rotas biométricas permanecem indisponíveis até conectar e validar um motor real.

Não envie `.env`, `.bootstrap-admin.txt` ou fotos reais junto com o código. O `.dockerignore` exclui esses arquivos do build da API. Armazene segredos apenas nas variáveis de ambiente das plataformas.
