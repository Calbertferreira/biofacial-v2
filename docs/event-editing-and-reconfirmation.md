# Edição, cancelamento e reconfirmação de eventos

Implementado em 15/10/2026. O backend aplica as regras independentemente da interface. A migração `008_event_reconfirmation.sql` acrescenta revisão do evento, histórico de alterações, respostas por revisão e controle de confirmação vigente. Execute a migração antes de publicar a nova API.

## Regras de alteração

| Estado / histórico | Permitido |
| --- | --- |
| `draft` sem convidados | Editar todos os dados; excluir o rascunho |
| Com convidados e sem acessos | Editar nome, data, hora, fuso e local; cliente e identificador externo ficam fixos; mudança relevante exige motivo |
| `active` com entrada ou saída registrada | Apenas correção de nome e ampliação do horário final; local/início/antecipação do fim ficam bloqueados |
| `finished` ou `cancelled` | Dados imutáveis; histórico preservado |

O `PATCH /v1/events/{eventId}` valida o período final já considerando os campos antigos não alterados. Mudança de data, horário, fuso ou local gera nova `revision`, exceto ampliação isolada do término. Aceites anteriores mudam para `reconfirmation_pending`. O campo `confirmed_revision` continua apontando para a versão aceita antes da alteração e o histórico em `guest_responses` preserva a resposta anterior. O perfil facial **não é removido**. O `event_changes` grava valores antes/depois, ator, motivo e horário.

O `DELETE /v1/events/{eventId}` só remove um rascunho sem convidados, auditoria ou histórico de acesso. Um evento com vínculos deve ser cancelado com `POST /v1/events/{eventId}/cancel` e `{ "reason": "..." }`, de pelo menos 10 caracteres. O cancelamento impede novos aceites, cadastros de convidados, envios comuns e scans; os registros permanecem para consulta.

## Resposta do convidado

O link existente continua abrindo a versão atual do evento. A tela mostra data e local atualizados e, quando há `reconfirmation_pending`, informa que a confirmação anterior não autoriza entrada. O convidado pode reconfirmar no mesmo link, com `POST /v1/invitations/{token}/accept` e `consent: true`, ou responder que não comparecerá via `POST /v1/invitations/{token}/decline`. Com perfil facial já associado, não precisa de outra selfie. A nova resposta é gravada em `guest_responses`, com a revisão correspondente; o histórico antigo não é apagado. Quem recusou pode reconsiderar antes de o evento acabar.

O Scanner valida tanto `invitation_status` quanto `confirmed_revision = events.revision` antes de registrar acesso. Um aceite antigo resulta em negativa `reconfirmation_required`. A consulta facial sem registro também só retorna convidado confirmado na revisão atual.

## Comunicação da alteração

Depois de salvar, o Manager tenta avisar automaticamente os convidados que já tiveram envio registrado ou aceitaram o convite. Usa os canais com envio anterior bem-sucedido; para aceite por link manual, prefere e-mail e, na ausência dele, WhatsApp. O endpoint de envio reutiliza `/v1/events/{eventId}/invitations/send` com `purpose: "event_change"` ou `"event_cancelled"`. Cria uma nova URL para a mensagem de alteração, mantendo válidos os links antigos; o convite sempre exibe os dados atuais.

O e-mail de alteração inclui a nova data/local e pede uma resposta quando a reconfirmação é necessária. Para uma simples ampliação do término, informa que o aceite continua válido. Para WhatsApp são necessários modelos aprovados de três parâmetros (nome do convidado, nome do evento e URL ou detalhes do cancelamento): `WHATSAPP_UPDATE_TEMPLATE_NAME` para reconfirmação, `WHATSAPP_INFO_TEMPLATE_NAME` para aviso sem reconfirmação e `WHATSAPP_CANCEL_TEMPLATE_NAME` para cancelamento. O retorno indica envios aceitos pelo provedor e falhas; entrega no aparelho não é garantida pelo aceite do provedor. As tentativas ficam em `invitation_deliveries` com `purpose` e `event_revision` e podem ser consultadas no Manager. Se o canal não estiver configurado ou o provedor falhar, a edição continua válida, o aviso falho fica visível e o convidado permanece pendente de reconfirmação quando aplicável. Operadores podem reenviar pelo Manager ou pela API com o mesmo `purpose`, ou compartilhar o link atualizado manualmente.

## Contratos resumidos

```http
PATCH /v1/events/{eventId}
{ "startsAt": "2026-11-10T18:00:00-03:00", "venue": "Novo endereço", "reason": "Local indisponível na data original" }
```

Resposta: dados atuais do evento, `revision`, `reconfirmationCount` e `notificationRequired`. O Manager pede confirmação antes de aplicar mudanças que afetam convidados. Alteração de evento com acessos incompatível recebe HTTP 409 `event_has_access_history`; tentativa de excluir evento com vínculos recebe `event_delete_forbidden`; evento encerrado recebe `event_immutable`.

## Validação

O roteiro `tests/e2e.mjs` verifica alteração de local após aceite, status pendente, negativa do Scanner, recusa, reconfirmação sem selfie, histórico de respostas, acesso liberado depois da reconfirmação, bloqueio de edição após entradas, cancelamento e exclusão de rascunho vazio. Esse roteiro usa substituto facial e banco de desenvolvimento; não prova entrega real de e-mail/WhatsApp nem operação em tablet físico.
