# Tecnologias por função

Versões verificadas no lockfile, `package.json`, `requirements.txt` e Dockerfiles desta revisão. Onde não há versão fixa de infraestrutura, ela é gerenciada pelo provedor.

| Função | Tecnologia | Onde | Como é usada |
| --- | --- | --- | --- |
| Monorepo e dependências JS | pnpm 11.19.0, workspace | raiz, `pnpm-workspace.yaml` | Instala e constrói três interfaces, API e pacotes compartilhados |
| Runtime da API | Node.js 24, TypeScript 5.9.3 | `apps/api` | HTTP, regras de negócio e integração entre serviços |
| HTTP da API | Fastify 5.12.5 | `apps/api/src/server.ts` | Rotas REST, parsing, limite de corpo de 3 MiB e erros |
| Validação e contratos | Zod 4.6.5 | `packages/contracts`, API | UUID, datas com offset, imagem Base64, contatos e respostas do motor |
| SQL e pool | PostgreSQL Neon, `pg` 8.23.0 | API, `packages/db` | Transações, consultas parametrizadas e migrações versionadas |
| Interface de gestão | Next.js 15.5.26, React 19.3.0, TypeScript | `apps/manager` | Painel administrativo e proxies de sessão/gestão |
| Interface de convite | Next.js 15.5.26, React 19.3.0, APIs de navegador | `apps/invite` | URL individual, captura por canvas e aceite |
| Interface do tablet | Next.js 15.5.26, React 19.3.0, `getUserMedia` | `apps/scanner` | Vídeo, captura, escolha de sentido e resultado |
| Autenticação humana | Node `crypto` scrypt, token aleatório SHA-256 | `apps/api/src/auth.ts`, `security.ts` | Senha com salt, sessão revogável, RBAC |
| Links individuais | Node `randomBytes`, SHA-256 | `apps/api/src/server.ts` | URL de 64 caracteres hexadecimais; hash no banco |
| Motor biométrico | Python 3.11, FastAPI 0.115.12, Uvicorn 0.34.2 | `services/face-engine` | Serviço HTTP privado de inscrição e identificação |
| Detecção facial | OpenCV headless 4.11.0.86, modelo YuNet | `services/face-engine/app.py` | Verifica uma face e seu tamanho mínimo |
| Reconhecimento | OpenCV SFace, NumPy 2.2.5 | `services/face-engine/app.py` | Vetor normalizado de 128 dimensões e similaridade cosseno |
| Criptografia do modelo | `cryptography` 44.0.2, Fernet | motor facial | Criptografa vetor antes da coluna `embedding_ciphertext` |
| SQL do motor | psycopg 3.2.6 | motor facial | Busca candidatos aceitos do evento no Neon |
| Hospedagem web | Vercel | três projetos | Build e execução das interfaces Next.js |
| Hospedagem da API e motor | Railway | dois serviços | API pública HTTPS e motor em rede privada |
| Banco gerenciado | Neon PostgreSQL | banco de desenvolvimento/teste | Persistência de usuários, eventos, acessos e modelos |
| Imagens de marca | PNG e CSS | `apps/manager/public/brand`, `app/site.css` | Identidade AllTicket na interface |

## Escolhas de construção

As interfaces ficam separadas porque têm usuários e permissões distintos: gestão, aceite público no celular e controle por operador no tablet. As três usam rotas servidoras Next.js como intermediárias para a API. O motor facial fica separado para isolar dependências Python/OpenCV e não expor seus modelos ao navegador. O banco único mantém integridade referencial entre clientes, eventos, convidados e acessos; isso também exige coordenação de migrações antes de novos deploys.

## Fluxo da imagem

O celular ou tablet captura um quadro, reduz a imagem via canvas e envia JPEG Base64 à rota da própria aplicação. O proxy encaminha à API, que chama o motor facial com timeout de 10 segundos. O motor decodifica em memória, usa YuNet para detecção, SFace para vetor, e descarta os bytes da foto. O vetor criptografado fica no banco. A imagem original não é gravada por esta aplicação; logs externos ou capturas manuais do dispositivo exigem controle operacional próprio.
