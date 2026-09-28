# Usuários da aplicação e clientes

Convidados de eventos continuam em `guests`. As pessoas que operam o produto ficam em `app_users`; os clientes ficam em `clients`. Um evento novo contém `client_id`. A tabela `user_clients` permite que um gestor pertença a vários clientes, sem duplicar sua conta. `user_sessions` guarda somente o hash dos tokens de sessão.

## Papéis

| Papel | Consulta | Cadastro e alteração |
| --- | --- | --- |
| `adm` | Todos os clientes, usuários, eventos, convidados e registros de acesso | Clientes, usuários de qualquer papel, eventos e convidados de qualquer cliente |
| `staff` | Todos os clientes, usuários, eventos, convidados e registros de acesso | Nenhum cadastro |
| `gestor` | Clientes vinculados, seus eventos e convidados, e gestores que compartilham esses clientes | Eventos e convidados dos clientes vinculados; novos gestores vinculados somente a um subconjunto dos próprios clientes |

Um gestor com dois clientes aparece uma vez em `app_users` e possui duas linhas em `user_clients`. As respostas de lista para gestores mostram somente os vínculos que o próprio solicitante pode ver. Contas inativas não conseguem iniciar sessão; alterações de papel, ativação e senha revogam as sessões existentes.

## Administrador inicial

O bootstrap criou a conta `admin@biofacial.local`, com senha aleatória temporária. As credenciais estão em `.bootstrap-admin.txt` na raiz do projeto; o arquivo é ignorado pelo Git. A primeira autenticação só permite consultar a própria conta, trocar a senha ou sair. Após a troca, é necessário entrar novamente. Apague o arquivo local após registrar sua nova senha em um gerenciador de senhas.

O comando `node --env-file=../../.env src/bootstrap-admin.mjs` em `packages/db` recusa criar outra conta se já existir um `adm`. Para alterar o email do administrador, use `PATCH /v1/users/{id}` depois do primeiro login.

## Segurança atual

Senhas usam `scrypt` com salt aleatório. Tokens opacos de 256 bits são devolvidos uma vez no login; o banco armazena apenas SHA-256 do token. A sessão dura 12 horas, pode ser encerrada por logout e é revogada na troca de senha. Cinco falhas seguidas bloqueiam a conta por 15 minutos.

O Manager guarda o token em cookie `HttpOnly` e `SameSite=Lax`. As rotas do navegador validam a origem das operações de escrita. Antes de publicar, adicione limitação distribuída de requisições, recuperação de senha, auditoria administrativa, TLS/domínios definitivos e autenticação multifator para administradores.

Os eventos de teste criados antes desta migração permanecem com `client_id` nulo. Apenas `adm` e `staff` conseguem consultá-los; gestores não recebem acesso a eles.
