# Teste ponta a ponta local

Depois de configurar `.env`, aplicar migrações e construir os pacotes, execute `pnpm test:e2e` na raiz. O script `tests/e2e.mjs` inicia API temporária e substituto local do motor facial, cria evento e convidado de teste no banco configurado, consulta link individual, aceita convite, ativa evento, registra negativa, entrada e saída e confere o histórico. Ele deixa dados de teste no banco para inspeção. Use somente banco de desenvolvimento.

O substituto facial retorna correspondências predeterminadas. Logo, esse teste verifica contrato HTTP, transações e estado de acesso, mas não qualidade biométrica, câmera, deploy Vercel/Railway ou envio de mensagens. Para autorização por papel, execute também `pnpm test:rbac`. Para evidência do ambiente publicado com motor real, consulte [testes e operação](testing-and-operations.md). Os relatórios `e2e-run-2026-09-26.md` e `browser-run-2026-09-26.md` são registros históricos.
