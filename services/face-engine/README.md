# Serviço facial

Serviço Python planejado para rodar na rede privada do Railway. Ainda não há implementação de reconhecimento nem modelo selecionado. A API de negócio nunca deve considerar uma resposta de teste como identificação válida.

## Contrato proposto

`POST /v1/enroll` recebe identificador opaco da pessoa, imagem temporária e contexto de consentimento. Retorna identificador do template, versão do modelo e resultado de qualidade/prova de vida. A imagem e o template não devem trafegar ou aparecer em logs.

`POST /v1/identify` recebe identificador do evento e uma imagem temporária. Pesquisa apenas pessoas aptas ao evento e retorna `match`, `no_match` ou `review`, pontuação, versão do modelo e identificador opaco. A API de negócio aplica autorização, estado do convite, limiar e regra de entrada/saída antes de registrar a decisão final.

Os endpoints exigirão autenticação serviço a serviço. A escolha de modelo, limiares, prova de vida e armazenamento dos templates depende de validação técnica e jurídica antes de habilitar produção.
