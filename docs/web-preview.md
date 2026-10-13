# Endereços de teste

| Aplicação | URL completa | Hospedagem |
| --- | --- | --- |
| Manager | https://biofacial.vercel.app/admin | Vercel, `apps/manager` |
| Convite Facial | https://biofacial-convite.vercel.app/convite/SEU_TOKEN | Vercel, `apps/invite`; o token vem do cadastro do convidado |
| Scanner | https://biofacial-scanner.vercel.app | Vercel, `apps/scanner`; opcional `?eventId=UUID` |
| API, saúde | https://api-production-34f89.up.railway.app/health | Railway, `apps/api` |
| Motor facial | `http://face-engine.railway.internal:8080` | Railway privado; sem acesso pelo navegador público |

Para testar: entre no Manager, cadastre cliente/evento/convidado, copie o link individual e envie manualmente. O convidado aceita no celular com consentimento e foto ou reutilização de perfil. Ative evento. No Scanner, entre com usuário autorizado, escolha **entrada** ou **saída** e permita a câmera. Consulte o histórico no Manager e finalize. O horário atual precisa estar entre início e fim do evento, além de o estado ser `active`.

Esses endereços são do ambiente de teste conhecido na data do [índice](README.md). Para variáveis e ordem de implantação, veja [deployment.md](deployment.md). Não há envio automático de WhatsApp/e-mail nem prova de vida.
