# Validação pelo navegador interno — 26/09/2026

Resultado: **aprovado para o fluxo de demonstração**. As três telas foram abertas no navegador interno e cada ação foi feita pela interface.

| Tela | Ação observada |
| --- | --- |
| Manager | Evento `7779a51a-2d88-4baf-b6b6-349a2ef637c3` criado; convidado de teste e link exclusivo gerados |
| Convite | Dados do evento e do convidado exibidos; estado passou de Pendente para Aceito e persistiu após recarga |
| Manager | Evento ativado |
| Scanner | Captura desconhecida exibiu `Acesso negado: no_match` |
| Scanner | Primeira leitura exibiu `Entrada autorizada: Convidado de teste` |
| Scanner | Segunda leitura exibiu `Saída registrada: Convidado de teste` |
| Manager | Histórico exibiu `denied`, `entry`, `exit` nessa ordem |

Durante a navegação, foram corrigidos o envio de JSON vazio na ativação e o texto de situação desatualizado na página do convite. As aplicações passaram novamente na checagem de tipos.

Esta validação usa email sintético `example.invalid` e um motor facial local de teste. Não comprova entrega de email/WhatsApp, uso da câmera, reconhecimento facial real, prova de vida ou operação pública na Vercel/Railway.
