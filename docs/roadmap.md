# Plano de implementação

## Etapa 1 — base (neste repositório)

- Monorepo independente dos sistemas atuais.
- Modelo de eventos, convidados, convites e auditoria.
- API para criar evento, adicionar convidados, consultar e aceitar convite, ativar evento e registrar entrada, saída e negativa. O reconhecimento real ainda depende do motor facial.
- Três aplicações web implantáveis separadamente.
- Contrato do serviço facial definido sem usar os pesos `buffalo_l` do protótipo.

## Etapa 2 — identidade e inscrição

- Login local de usuários da aplicação com papéis `adm`, `staff` e `gestor` e escopo por cliente implementado; OIDC e MFA administrativos ainda pendentes.
- Cadastro consentido de biometria com prova de vida e prevenção de foto de tela.
- Associação entre a identidade facial e o convidado, com reutilização de cadastro mediante consentimento.
- Política de retenção, exclusão, base legal e registros de consentimento revisados juridicamente.

## Etapa 3 — operação do evento

- Scanner com identificação 1:N restrita ao evento, revisão de limiar e prevenção de duplicidade.
- Registro de entrada, saída e tentativas negadas com horário e motivo. O vínculo com dispositivo ainda falta.
- Fila de envio de convites por email/WhatsApp, retries e idempotência.
- Procedimento de contingência quando o serviço facial ou rede falhar.

## Etapa 4 — acompanhamento

- Painel em tempo real, depoimentos moderados, satisfação e métricas de permanência.
- Finalização do evento, consolidação de indicadores e exportação.
- Teste de carga no tablet e na região de implantação antes da operação real.

## Decisões pendentes

- Modelo facial com licença comercial e validação de desempenho/viés.
- Provedor de WhatsApp/email e respectivos templates.
- Provedor de identidade do administrador.
- Base legal e prazos de retenção dos dados sensíveis.
