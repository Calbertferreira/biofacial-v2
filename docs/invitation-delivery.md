# Envio de convites

O cadastro inclui a pessoa na lista com status `registered`. Na página do evento, o operador seleciona convidados e escolhe e-mail, WhatsApp ou ambos. Cada ação de envio incrementa `send_attempts` uma vez por convidado e grava um registro por canal em `invitation_deliveries`. O status passa a `invited` após ao menos um provedor aceitar o envio. O aceite muda para `accepted`; uma entrada autorizada pelo scanner muda para `attended`.

O projeto anterior distribuía links manualmente e não tinha provedor de mensagens configurado. Para e-mail, configurar `RESEND_API_KEY` e `INVITATION_EMAIL_FROM` com remetente de domínio verificado no Resend. Para WhatsApp, configurar `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_TEMPLATE_NAME` e `WHATSAPP_TEMPLATE_LANGUAGE`. O template aprovado na Meta precisa ter três parâmetros de texto no corpo, nesta ordem: nome do convidado, nome do evento e URL do convite. Também é necessário `PUBLIC_BASE_URL` para a aplicação de convites.

Sem a configuração do canal, a tentativa fica registrada como `failed` e o status do convidado não avança. `sent` significa que o provedor aceitou a requisição; não comprova a entrega ao destinatário. A migração `005_invitation_delivery.sql` deve ser aplicada antes de iniciar esta versão da API.
