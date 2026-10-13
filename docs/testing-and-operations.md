# Testes, evidências e operação

## Verificações de código

Na raiz do repositório, `pnpm typecheck` verifica tipos em todos os pacotes e `pnpm build` constrói as três interfaces, API e contratos. `pnpm test:rbac` exercita papéis e escopo; `pnpm test:e2e` percorre o fluxo HTTP com substituto local do motor facial. Esses testes usam banco de desenvolvimento e não validam a qualidade do reconhecimento. Consulte [e2e.md](e2e.md) e os relatórios datados em `docs/` para execuções anteriores.

## Validação do ambiente publicado

Na publicação de teste anterior, foi executado um roteiro HTTP contra os endereços públicos da API, Manager, Convite e Scanner, usando uma foto de amostra processada pelo motor real no Railway. O roteiro criou dados temporários, aceitou convite com face, registrou entrada, negou entrada duplicada, registrou saída, negou imagem fora do escopo do evento, reutilizou perfil em segundo evento, consultou o histórico e finalizou. Os dados temporários foram removidos. Isso confirma integração dos endpoints naquele momento; **não confirma** funcionamento da câmera de um tablet específico, resistência a fraude, latência com público ou precisão estatística.

## Roteiro manual recomendado

1. Verificar saúde da API e credenciais de operador. Cadastrar cliente ativo, gestor associado, evento com janela que inclua o horário de teste e um convidado com contato real autorizado.
2. Abrir o link em celular, conferir dados do evento, aceitar e capturar um único rosto. Reabrir o link e confirmar status. Se houver perfil anterior no mesmo cliente, testar aceite sem nova foto.
3. Ativar evento. No tablet, entrar no Scanner com conta autorizada, selecionar o evento, permitir câmera e marcar **entrada**. Confirmar pessoa e horário no Manager.
4. Repetir entrada e confirmar negativa `already_inside`. Marcar **saída** e confirmar `exit`. Repetir saída e confirmar `not_inside`.
5. Apresentar imagem de outra pessoa e confirmar `no_match`/`review` ou negativa; verificar registro. Testar operador sem vínculo e evento fora da janela.
6. Finalizar evento e confirmar que não admite scan. Repetir o teste em rede e iluminação do local físico antes de usar com participantes.

## Observabilidade e limites

O histórico de acesso grava evento, convidado quando conhecido, ação, motivo, confiança e data. A consulta pública de gestão limita a 500 linhas por evento; não há paginação nem exportação. Sem tabela de device ID, o registro não indica qual tablet capturou a face. Em falha do motor, a API retorna 503 mas não grava `access_events`; monitore logs e métricas do Railway para essa classe de erro. O Manager não atualiza métricas por streaming e não calcula depoimentos/satisfação.

## Critério antes de operação com público

Testar qualidade e viés do modelo com participantes consentidos, taxa de falso aceite/negação, rede, luz, altura da câmera e carga simultânea. Definir supervisão humana, resposta a `review`, contingência sem rede, retenção/exclusão de biometria e procedimento de incidente. O fluxo atual é apto a teste controlado; esses critérios ainda precisam de validação operacional e jurídica.
