# Validação de usuários da aplicação — 26/09/2026

Resultado: **aprovado** no Neon de desenvolvimento e no Manager local.

## API e banco

- Migração 003 aplicada: `clients`, `app_users`, `user_clients`, `user_sessions` e `events.client_id`.
- Primeiro administrador criado: `49586b1b-2f56-4f97-acaf-1db2458a39ed` (`admin@biofacial.local`). Login aceito e cadastros bloqueados até a troca da senha temporária.
- `staff`: leu clientes e não conseguiu criar clientes, usuários ou editar evento/convidado.
- `gestor`: viu apenas o cliente atribuído, criou outro gestor nesse escopo, criou e editou evento/convidado nesse cliente. Tentativas em outro cliente e de criação de `staff` foram negadas.
- Consulta de foto: uma imagem PNG enviada com o ID do evento retornou o convidado aceito; outra imagem retornou `no_match`; `staff` recebeu `403`.
- Última execução automatizada: `clientA=4c6282fb-7588-4976-9d61-f8f6e2709eae`, `clientB=1d194453-857c-4091-8868-adb4de5d3c07`, `eventId=14a4d55f-3e80-4e56-a0a3-2a292349c4b6`.
- Todas as contas sintéticas dos testes foram desativadas. Verificação final do banco: **um usuário ativo, papel `adm`**.

## Navegador

Na tela `/admin`, uma conta sintética percorreu login, troca obrigatória de senha, novo login, cadastro de cliente e cadastro de gestor vinculado a dois clientes. A proteção de origem foi ajustada para comparar o navegador com o cabeçalho `Host` da requisição. A conta sintética foi desativada; a aba foi deixada na tela de login para o administrador inicial.

## Limite da validação facial

O serviço facial usado foi um substituto determinístico. A rota HTTP e a checagem de que a pessoa está aceita e convidada para o evento passaram; a precisão de reconhecimento facial, prova de vida e implantação do motor biométrico real continuam pendentes.
