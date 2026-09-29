# Ambientes de teste publicados

| Aplicação | URL | Hospedagem |
| --- | --- | --- |
| Manager | https://biofacial.vercel.app/admin | Vercel, projeto `biofacial`, pasta `apps/manager` |
| Convite Facial | https://biofacial-convite.vercel.app | Vercel, projeto `biofacial-convite`, pasta `apps/invite` |
| Scanner | https://biofacial-scanner.vercel.app | Vercel, projeto `biofacial-scanner`, pasta `apps/scanner` |
| API | https://api-production-34f89.up.railway.app/health | Railway, serviço `api` |
| Motor facial | sem URL pública | Railway, serviço `face-engine` |

## Fluxo para testar

1. Entre no Manager com uma conta `adm` ou `gestor` habilitada. Cadastre um cliente e um evento com horário que englobe o momento do teste.
2. Abra o evento no Manager, cadastre um convidado e copie o link individual. Envie o link por WhatsApp ou e-mail usando o canal de sua escolha; o envio automático ainda não está implementado.
3. No celular do convidado, abra o link, tire uma foto nítida de um único rosto, marque o consentimento e aceite o convite. Se houver modelo facial anterior associado ao mesmo e-mail ou telefone no mesmo cliente, a tela oferece confirmação sem nova foto.
4. Ative o evento no Manager. Abra o Scanner pelo link na página do evento, entre com um usuário da aplicação que tenha acesso ao cliente e permita a câmera no tablet.
5. Selecione o evento e identifique o convidado. A primeira identificação registra entrada e a segunda registra saída. Consulte os registros no Manager e finalize o evento quando terminar.

## Configuração

- A API usa `DATABASE_URL` para Neon, `PUBLIC_BASE_URL=https://biofacial-convite.vercel.app`, `FACE_ENGINE_URL=http://face-engine.railway.internal:8080` e `FACE_ENGINE_TOKEN` igual ao do motor facial. `BROWSER_DEMO` deve ficar desativado.
- O motor facial usa `DATABASE_URL`, `FACE_ENGINE_TOKEN` e `FACE_TEMPLATE_KEY`. O último valor é uma chave Fernet persistente; perder essa chave torna os modelos já cadastrados ilegíveis. O serviço não precisa de domínio público.
- Os três projetos Vercel usam `API_INTERNAL_URL` apontando para a API Railway. O Manager também usa `NEXT_PUBLIC_SCANNER_URL=https://biofacial-scanner.vercel.app`.
- A migração `004_face_profiles.sql` deve estar aplicada antes de aceitar fotos.

## Limites deste teste

A identificação usa fotos reais e modelos YuNet/SFace. Ainda não há prova de vida nem envio automático de mensagens. Fotos ou vídeos apresentados à câmera podem enganar o reconhecimento; mantenha supervisão humana na entrada e confira manualmente casos `review`. Os limiares precisam ser calibrados no local e com participantes consentidos antes de operar controle físico sem acompanhamento. As imagens não são salvas; os modelos faciais são criptografados no Neon.
