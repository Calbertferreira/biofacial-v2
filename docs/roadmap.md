# Estado funcional e próximos passos

## Implementado no código atual

Monorepo e três aplicações web separadas; clientes e usuários com `adm`/`staff`/`gestor`; vínculos de gestores a vários clientes; autenticação com sessão revogável; eventos e convidados por cliente; URL exclusiva; aceite público com consentimento e foto; reutilização de perfil no mesmo cliente; motor YuNet/SFace privado com vetor cifrado; ativação e finalização; identificação restrita ao evento; entrada, saída, negativa e histórico; consulta facial sem registrar passagem.

## Validado em testes

Compilação/tipos e testes locais com substituto facial; fluxo HTTP do ambiente publicado com motor facial real e foto de amostra, incluindo duplicidade, ausência de correspondência e reutilização. A câmera física de celular/tablet e a qualidade estatística do reconhecimento precisam de teste presencial. [Detalhes](testing-and-operations.md).

## Necessário antes de operação em escala

1. **Biometria e privacidade:** prova de vida/anti-spoofing, calibração de limiares, avaliação de viés, consentimento versionado, base legal, retenção/exclusão e rotação de chave.
2. **Operação de acesso:** ensaio com tablets reais, identificação de dispositivo/operador por tentativa, contingência offline ou manual, monitoramento de indisponibilidade e paginação/exportação do histórico.
3. **Convites:** envio por WhatsApp/e-mail com fila, retry, idempotência, status de entrega e proteção adicional da posse do link quando necessário.
4. **Segurança administrativa:** MFA, recuperação de senha, limitação distribuída, auditoria de alterações e revisão de conexão TLS/certificado do banco pelo motor.
5. **Acompanhamento:** check-ins em tempo real, cálculo de permanência, depoimentos moderados, gráficos, integração consentida com redes sociais e exportação após finalização.

Os estados `published`, `cancelled`, `declined` e `expired` existem no banco, mas não têm fluxo completo publicado. As métricas do Manager são básicas e não devem ser apresentadas como medição de satisfação. A escolha do provedor de mensageria e as políticas jurídicas/operacionais ainda dependem de decisão do projeto.
