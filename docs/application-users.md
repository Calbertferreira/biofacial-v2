# Contas da aplicação e clientes

`app_users` representa operadores; `guests` representa convidados e não recebe login administrativo. `clients` representa organizações. A relação muitos para muitos `user_clients` dá acesso de um gestor a um ou mais clientes. Eventos novos devem apontar para um cliente ativo.

## Papéis aplicados pela API

| Operação | `adm` | `staff` | `gestor` |
| --- | --- | --- | --- |
| Consultar clientes, usuários, eventos, convidados, histórico | todos | todos | somente clientes associados; usuários gestores visíveis no escopo |
| Criar/alterar cliente | sim | não | não |
| Criar usuários | qualquer papel | não | apenas `gestor` com clientes dentro dos próprios vínculos |
| Alterar usuários | sim | não | não |
| Criar/alterar evento e convidado | qualquer cliente | não | clientes associados |
| Ativar/finalizar evento | qualquer cliente | não | clientes associados |
| Registrar entrada/saída no Scanner | sim | sim | clientes associados |
| `face-lookup` sem registro de acesso | sim | não | clientes associados |

Uma conta inativa não inicia sessão. `must_change_password` restringe ações até a troca da senha temporária. Mudanças de papel, ativação ou senha revogam sessões antigas. Eventos migrados anteriores à tabela de clientes podem ter `client_id` nulo; apenas `adm` e `staff` conseguem visualizá-los.

## Primeiro administrador

`packages/db/src/bootstrap-admin.mjs` cria o primeiro `adm` com senha temporária aleatória, somente quando ainda não existe outro `adm`. A senha não deve entrar em Git ou nesta documentação. Use o arquivo local gerado pelo bootstrap ou o procedimento autorizado de recuperação para o ambiente correspondente; troque a senha no primeiro login e armazene a nova em um gerenciador de segredos. A existência de um e-mail administrativo específico não é pressuposta por este guia.

## Integrações de terceiros

Uma aplicação externa usa `POST /v1/auth/login` e Bearer em chamadas de cadastro. Escolha conta com escopo mínimo necessário. O token dura 12 horas e pode ser revogado por logout. Não repasse conta `adm` ou `SCANNER_API_KEY` ao navegador. Exemplos e formatos em [API para integrações](external-api.md).
