# BioFacial v2

Sistema de gestão de eventos, convites individuais, inscrição facial e controle de entrada e saída. Este repositório é um monorepo independente da versão anterior.

## Aplicações

| Componente | Pasta | Hospedagem de teste | Função |
| --- | --- | --- | --- |
| Manager | `apps/manager` | [biofacial.vercel.app/admin](https://biofacial.vercel.app/admin) | Clientes, usuários, eventos, convidados e histórico |
| Convite Facial | `apps/invite` | [biofacial-convite.vercel.app](https://biofacial-convite.vercel.app) | Aceite individual e captura facial no celular |
| Scanner | `apps/scanner` | [biofacial-scanner.vercel.app](https://biofacial-scanner.vercel.app) | Identificação e registro de entrada ou saída no tablet |
| API | `apps/api` | [health](https://api-production-34f89.up.railway.app/health) | Autenticação, autorização, regras de negócio e persistência |
| Motor facial | `services/face-engine` | Railway, rede privada | Detecção, extração e comparação biométrica |

Banco: Neon PostgreSQL. Contratos compartilhados: `packages/contracts`. Migrações: `packages/db`.

## Documentação

Comece pelo [índice completo](docs/README.md). Ele separa arquitetura, mapa de tecnologias, descrição detalhada de cada serviço, API, dados, segurança, testes e implantação. Os relatórios datados em `docs/` registram testes históricos e não substituem o estado atual documentado no índice.

## Execução local

Requisitos: Node.js 24, pnpm 11, Python 3.11 para o motor facial, e PostgreSQL/Neon. Na raiz:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm --filter @biofacial/db migrate:local
pnpm dev:api
```

Em terminais separados, rode `pnpm dev:manager`, `pnpm dev:invite` e `pnpm dev:scanner`. Portas padrão: Manager 3000, API 3001, Convite 3002 e Scanner 3003. Configure as variáveis do motor facial descritas em [implantação](docs/deployment.md) para executar a biometria real. Não salve credenciais no repositório.

## Situação funcional

O fluxo de cliente → evento → convidado → convite → aceite facial → ativação → entrada/saída → histórico → finalização está implementado. Edição relevante do evento exige reconfirmação, preserva a biometria e bloqueia o Scanner até nova resposta. Há envio por e-mail e WhatsApp quando os provedores e modelos estão configurados; falhas aparecem no histórico de tentativas. A captura real em tablet, os limiares biométricos e a operação com público ainda exigem validação presencial. Prova de vida, depoimentos e indicadores de satisfação estão planejados; veja [lacunas e próximos passos](docs/roadmap.md).
