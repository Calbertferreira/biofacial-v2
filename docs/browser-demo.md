# Demonstração local histórica

`node --env-file=.env scripts/browser-demo.mjs` inicia serviços locais com `BROWSER_DEMO=true`, API e substituto facial. O Manager mantém `/demo` para ensaios de interface. Esta demonstração foi usada no desenvolvimento inicial e não representa o fluxo publicado nem reconhecimento biométrico real. Algumas telas do Convite/Scanner evoluíram depois da criação do roteiro antigo; para validação atual use os endereços publicados e [roteiro manual](testing-and-operations.md).

O substituto usa bytes de fixture; nunca configure `BROWSER_DEMO` ou `ADMIN_API_KEY` em implantação pública. Para o fluxo real, configure o motor privado e use contas de operador e câmera em contexto HTTPS.
