# Manager — gestão do evento

**Código:** `apps/manager`. **Execução:** Vercel, Next.js 15, React 19, TypeScript e CSS próprio. **URL de teste:** https://biofacial.vercel.app/admin.

## Telas e responsabilidades

`/admin` concentra login, primeiro acesso com troca obrigatória de senha, clientes, usuários e eventos. `/admin/events/{eventId}` apresenta convidados, URL individual do convite, ativação/finalização e registros de acesso. A tela `/demo` é legado local de desenvolvimento. A marca AllTicket usa arquivos em `public/brand/`.

O papel exibido orienta a interface, mas a API é a autoridade: `adm` pode administrar todos os clientes e contas, `staff` consulta os cadastros, `gestor` atua nos clientes vinculados. O Manager não envia convites automaticamente; permite copiar o link gerado pela API.

## Integração

`app/api/session/[action]/route.ts` faz login, consulta sessão, troca de senha e logout. O token de sessão fica em cookie `HttpOnly`, `SameSite=Lax` e `Secure` na produção. `app/api/manage/[...path]/route.ts` encaminha apenas rotas autorizadas à API com o token do cookie e confere a origem nas operações de escrita. `API_INTERNAL_URL` é lida no servidor. `NEXT_PUBLIC_SCANNER_URL` define o destino do link para o Scanner e é pública no build.

O navegador não se conecta diretamente ao Neon nem recebe `FACE_ENGINE_TOKEN`. Para integração externa, use a [API](../external-api.md), com sessão de usuário própria.

## Dados e limitações da interface

As listas e formulários usam endpoints de clientes, usuários, eventos, convidados e histórico. A API oferece algumas alterações por `PATCH` que ainda não têm todos os controles correspondentes na interface. O histórico é consultado com teto de 500 registros por evento e não tem paginação. Os números mostrados no painel são básicos; ainda não há cálculo consolidado de permanência, depoimentos, sentimento de redes sociais, exportação ou atualização em tempo real garantida.

## Operação

Para testar, entre como `adm` ou `gestor`, confirme um cliente ativo, crie evento com início/fim adequados, adicione convidado, copie o link e acompanhe o aceite. Ative o evento antes de usar o Scanner. Ao terminar, finalize no Manager. Um evento finalizado não recebe novos scans.
