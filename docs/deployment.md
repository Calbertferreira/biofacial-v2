# Implantação e ambientes

Estado conhecido em 28/09/2026: três projetos web Vercel, API pública Railway, motor facial privado Railway e PostgreSQL Neon. Domínios de teste em [web-preview.md](web-preview.md). Os valores secretos pertencem às variáveis protegidas de cada provedor; este documento mostra **nomes**, nunca valores.

## Matriz de serviços

| Serviço | Contexto de código | Variáveis essenciais | Dependências |
| --- | --- | --- | --- |
| Manager / Vercel | `apps/manager` dentro do monorepo | `API_INTERNAL_URL`, `NEXT_PUBLIC_SCANNER_URL` | API HTTPS |
| Convite / Vercel | `apps/invite` dentro do monorepo | `API_INTERNAL_URL` | API HTTPS |
| Scanner / Vercel | `apps/scanner` dentro do monorepo | `API_INTERNAL_URL` | API HTTPS |
| API / Railway | raiz do monorepo, `apps/api` | `DATABASE_URL`, `PUBLIC_BASE_URL`, `FACE_ENGINE_URL`, `FACE_ENGINE_TOKEN` | Neon, motor privado |
| Motor facial / Railway | `services/face-engine` Docker | `DATABASE_URL`, `FACE_ENGINE_TOKEN`, `FACE_TEMPLATE_KEY`, `PORT` | Neon, rede privada |
| Migração / execução controlada | `packages/db` | `DATABASE_URL_UNPOOLED` | Neon direto |

`PUBLIC_BASE_URL` deve ser a origem HTTPS da aplicação Convite. `FACE_ENGINE_URL` na API aponta para `http://face-engine.railway.internal:8080` no ambiente atual. `FACE_ENGINE_TOKEN` tem o mesmo valor nos dois serviços e ao menos 32 caracteres. `FACE_TEMPLATE_KEY` é uma chave Fernet estável: backup e rotação planejada são necessários. `SCANNER_API_KEY` é opcional para integração de máquina e não é necessário para o Scanner web autenticado. `ADMIN_API_KEY` e `BROWSER_DEMO=true` pertencem apenas à demonstração local, nunca à implantação pública.

## Sequência de publicação

1. Configurar Neon separado para o ambiente e criar segredos nos provedores. Usar URL de conexão com pooler para API e URL direta/unpooled para migração. Não imprimir conexões em logs.
2. Rodar migrações 001–009 pelo comando `pnpm --filter @biofacial/db migrate` com `DATABASE_URL_UNPOOLED`. Verificar `schema_migrations`, `person_face_profiles`, `event_changes` e `guest_responses`.
3. Publicar motor facial no Railway com Dockerfile de `services/face-engine`. Conferir download e SHA-256 dos modelos, variáveis e `/health` apenas na rede interna.
4. Publicar API Railway a partir da raiz do monorepo. Build: `pnpm install --frozen-lockfile`, build de `@biofacial/contracts` e `@biofacial/api`; start: `pnpm --filter @biofacial/api start`. Health check público: `/health`.
5. Publicar três projetos Vercel com o mesmo repositório e diretórios de aplicação separados. O processo de build precisa ter acesso ao workspace e aos pacotes compartilhados. Configurar `API_INTERNAL_URL` para a API Railway HTTPS; no Manager, configurar o URL público do Scanner.
6. Validar em sequência: login Manager, cliente/evento/convidado, abertura do convite, aceite com foto, ativação, entrada, negativa duplicada, saída, histórico e finalização. Testar também imagem desconhecida e indisponibilidade do motor.

O domínio privado Railway é acessível entre serviços Railway do mesmo projeto/ambiente; a Vercel usa a URL pública HTTPS da API. Consulte a [documentação oficial da rede privada Railway](https://docs.railway.com/networking/domains/working-with-domains). O acesso à câmera no navegador requer contexto seguro e permissão; consulte [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Configuração local

Use `.env.example` como inventário de variáveis e `.env` local ignorado pelo Git. Node 24 e pnpm 11 constroem as apps; Python 3.11 e dependências em `services/face-engine/requirements.txt` executam o motor. Portas padrão: 3000 Manager, 3001 API, 3002 Convite, 3003 Scanner. Com o motor desligado, as rotas biométricas retornam indisponibilidade; testes com substituto local não representam reconhecimento real.

## Operação e reversão

Conserve a versão do código, os pesos do modelo, o valor de `FACE_TEMPLATE_KEY` e backups do banco de forma controlada. Para reverter uma atualização de aplicação, implante a versão anterior compatível com o esquema; migrações de banco não devem ser revertidas por edição manual sem plano. Monitore `/health`, erros 503, latência de identificação, registros `denied`, bloqueios de login e consumo de conexões. Evite registrar tokens de sessão, links de convite ou imagens. Para indisponibilidade, interrompa a passagem automática e use procedimento presencial verificado; não substitua a identificação por aceite automático.
