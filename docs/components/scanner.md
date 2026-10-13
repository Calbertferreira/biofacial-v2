# Scanner — entrada e saída no tablet

**Código:** `apps/scanner`. **Execução:** Vercel, Next.js 15, React 19, TypeScript, câmera via Web API. **URL de teste:** https://biofacial-scanner.vercel.app.

## Operador e câmera

O Scanner exige login de usuário da aplicação. `app/api/session/[action]/route.ts` guarda a sessão em cookie `HttpOnly`; `app/api/events/route.ts` carrega eventos acessíveis ao operador. A aplicação pode receber `?eventId=UUID` no link do Manager e permite selecionar evento ativo. No tablet, `ScannerPanel.tsx` usa `navigator.mediaDevices.getUserMedia` e canvas para tirar um quadro JPEG; a câmera depende de HTTPS, permissão do navegador e dispositivo compatível.

O operador escolhe explicitamente **entrada** ou **saída**. `app/api/scan/route.ts` encaminha `imageBase64` e `direction` à API. A resposta mostra pessoa identificada e ação registrada ou o motivo de negativa. `adm` e `staff` podem operar em qualquer cliente; `gestor` apenas em clientes vinculados. A API confere esse escopo, independentemente do filtro visual.

## Decisão da API

A identificação facial pesquisa somente perfis de convidados aceitos daquele evento. Depois de um `match`, a API revalida o convite, o perfil, o status `active` e a janela entre início/fim. A última ação `entry` ou `exit` define se a pessoa está dentro. Nova entrada de quem está dentro gera `already_inside`; saída sem entrada gera `not_inside`. `no_match`, `review`, imagem inválida e convidado inelegível também negam e registram motivo. A falha do motor facial retorna 503 e não libera o acesso.

## Operação e contingência

Posicione a câmera na altura do rosto, com iluminação uniforme; confirme a identidade na tela e supervisione a passagem. Casos `review` precisam de verificação humana, sem contornar silenciosamente o registro. Antes de uso físico com público, teste câmera, rede, latência e limiares no local; defina procedimento manual para indisponibilidade. Não há prova de vida, associação de tentativa a dispositivo, modo offline ou mecanismo antifraude de foto de tela.
