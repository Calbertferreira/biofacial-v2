# Convite Facial — aceite no celular

**Código:** `apps/invite`. **Execução:** Vercel, Next.js 15, React 19, TypeScript. **URL base de teste:** https://biofacial-convite.vercel.app.

## Entrada e identidade

Cada convidado recebe `https://biofacial-convite.vercel.app/convite/{token}`. A API cria um token aleatório de 32 bytes, retorna o URL apenas no cadastro e armazena seu hash SHA-256. A rota pública `GET /v1/invitations/{token}` apresenta nome, evento, horário, local, estado do convite e indicação de perfil facial reutilizável. Não exige conta de operador: a posse do link é a credencial.

## Aceite sem e com imagem

`app/convite/[token]/page.tsx` renderiza a informação da API; `AcceptButton.tsx` controla consentimento e captura. Sem perfil reutilizável, a pessoa seleciona/tira foto no celular por campo de arquivo com `capture=user`. A interface carrega a imagem com `createImageBitmap`, reduz para largura/altura máxima de 1280 px em canvas, exporta JPEG e envia Base64. A API exige `consent: true` e imagem para o primeiro cadastro; o motor facial exige um único rosto em qualidade mínima.

Se existir perfil aceito anterior dentro do mesmo cliente, associado ao mesmo e-mail (comparação sem distinção de maiúsculas) ou telefone E.164, o aceite pode ocorrer sem nova foto. O sistema não prova a posse do e-mail/telefone por OTP; por isso, a reutilização pressupõe que o cadastro do convidado e a distribuição do link foram confiáveis.

`app/api/invitations/[token]/accept/route.ts` é o proxy de aceite para a API. A API marca o convidado como `accepted`, define `accepted_at`, associa o perfil e grava `audit_events.invitation_accepted`. Não existe envio automático do URL nem botão implementado de recusar convite. Eventos `finished` ou `cancelled` não aceitam novos registros.

## Limites

A confirmação de consentimento é um booleano e o evento de aceite fica no banco; ainda não há versão do texto legal, trilha de consentimento específica, revogação, exclusão ou prazo de retenção. A imagem não é armazenada em bruto pelo sistema, mas o perfil vetorial criptografado é dado biométrico sensível. A captura precisa de iluminação e orientação adequadas; não implementa prova de vida.
