# Documentação de construção — BioFacial v2

Revisão do fluxo de eventos: **15/10/2026**. Esta documentação descreve o código existente e os ambientes de teste conhecidos; as URLs não são compromisso de disponibilidade. Nenhuma credencial ou chave integra este pacote.

## Caminho de leitura

1. [Arquitetura e fluxos](architecture.md): limites entre aplicações e sequências de negócio.
2. [Mapa de tecnologias](technology-map.md): função, tecnologia, versão, arquivo e motivação.
3. Componentes: [Manager](components/manager.md), [Convite Facial](components/invite.md), [Scanner](components/scanner.md), [API](components/api.md) e [motor facial](components/face-engine.md).
4. [Modelo de dados](data-model.md): tabelas, vínculos, estados e migrações; [edição e reconfirmação de eventos](event-editing-and-reconfirmation.md).
5. [Usuários e clientes](application-users.md), [segurança e biometria](security-and-biometrics.md).
6. [API para integrações](external-api.md), [implantação](deployment.md) e [testes e operação](testing-and-operations.md).
7. [Estado e próximos passos](roadmap.md), [endereços de teste](web-preview.md).

## Código fonte relacionado

| Assunto | Referência principal |
| --- | --- |
| Rotas e regras | `apps/api/src/` |
| Autenticação e RBAC | `apps/api/src/auth.ts`, `security.ts`, `management.ts` |
| Convites, scanner e consulta facial | `apps/api/src/server.ts`, `flows.ts` |
| Formatos de entrada | `packages/contracts/src/index.ts` |
| Estrutura SQL | `packages/db/migrations/001_initial.sql` até `009_event_cancellation_notices.sql` |
| Biometria | `services/face-engine/app.py` |
| Interfaces | `apps/manager/app/`, `apps/invite/app/`, `apps/scanner/app/` |

## Registros históricos

`application-users-run-2026-09-26.md`, `browser-run-2026-09-26.md` e `e2e-run-2026-09-26.md` registram execuções anteriores. `browser-demo.md` descreve uma demonstração local com substituto facial e não representa o fluxo publicado. As descrições funcionais atuais estão nos documentos acima.
