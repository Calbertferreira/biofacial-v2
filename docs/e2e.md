# Teste ponta a ponta de desenvolvimento

Com a migração aplicada e a API compilada, execute `pnpm test:e2e` na raiz. O teste inicia uma API temporária e um substituto local do serviço facial. Ele cria no Neon um evento `E2E BioFacial ...` e um convidado com endereço `example.invalid`; não envia email nem WhatsApp.

O roteiro consulta o link exclusivo, aceita o convite com consentimento e uma captura de teste, ativa o evento, registra uma tentativa sem correspondência, uma entrada e uma saída. Em seguida consulta o histórico pela API e exige a ordem `denied`, `entry`, `exit`. O evento e as tentativas ficam no banco de desenvolvimento para inspeção.

O substituto compara bytes idênticos e devolve uma identidade predeterminada. Ele **não** testa reconhecimento facial, prova de vida, entrega de mensagens, câmera do tablet ou implantação Vercel/Railway. Nunca deve ser configurado como serviço facial de produção.
