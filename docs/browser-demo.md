# Validação no navegador interno

Execute `node --env-file=.env scripts/browser-demo.mjs` na raiz do projeto após compilar `packages/contracts` e `apps/api`. O script inicia API, Manager, Convite, Scanner e um substituto local do motor facial. Todos escutam em `127.0.0.1`; interrompa com Ctrl+C.

1. Abra `http://127.0.0.1:3000/demo` no navegador interno.
2. Crie um evento com início alguns minutos no passado e fim no futuro.
3. Cadastre um convidado com endereço de teste `example.invalid` e abra o link exclusivo gerado.
4. Na tela de convite, aceite com o rosto de teste.
5. Volte ao Manager e ative o evento.
6. Abra o Scanner do evento. Teste uma pessoa desconhecida, depois leia duas vezes o convidado de teste.
7. No Manager, atualize o histórico e confira `denied`, `entry`, `exit`.

O endereço de email só identifica o convidado de teste: não há entrega de mensagem. Os botões de rosto usam bytes de fixture e não acionam câmera ou biometria real. As rotas de demonstração respondem apenas quando `BROWSER_DEMO=true`; não habilite esse modo em uma implantação pública.
