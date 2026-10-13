# Segurança, privacidade e biometria

## Autenticação de operadores

As contas da aplicação são diferentes dos convidados. Senhas são derivadas com scrypt (N=16384, r=8, p=1), salt aleatório de 16 bytes e chave derivada de 64 bytes. O login devolve token aleatório de 32 bytes; o banco armazena seu SHA-256 em `user_sessions`. Sessões duram 12 horas, podem ser revogadas no logout e são revogadas após troca de senha ou mudanças relevantes da conta. Cinco falhas consecutivas bloqueiam a conta por 15 minutos. O bootstrap inicial gera `adm` com senha temporária e exige troca no primeiro acesso; não existe credencial fixa documentada.

Nas aplicações web, o token vai em cookie `HttpOnly`, `SameSite=Lax` e `Secure` no ambiente de produção. Proxies Next.js verificam origem para escritas. A API externa recebe `Authorization: Bearer <accessToken>`; mantenha esse token apenas no servidor da aplicação integradora. Não o coloque em URL, código cliente, logs ou repositório.

## Autorização

| Papel | Alcance | Escrita de cadastros | Scanner | Consulta facial sem registro |
| --- | --- | --- | --- | --- |
| `adm` | todos os clientes | todos os tipos | sim | sim |
| `staff` | todos os clientes | nenhuma | sim | não |
| `gestor` | clientes atribuídos | eventos/convidados e novos gestores dentro do próprio escopo | sim, no próprio escopo | sim, no próprio escopo |

`gestor` pode ter vários vínculos em `user_clients`; não pode atribuir ao novo gestor cliente fora dos seus vínculos. A API consulta a permissão na operação e filtra listagens; esconder botões na interface não é a barreira de segurança. A chave opcional `SCANNER_API_KEY` autoriza uma integração de máquina a registrar scans, sem sessão humana, e deve ser tratada como segredo poderoso.

## Convites e fotos

O link individual carrega 256 bits aleatórios e o banco guarda somente hash; posse do URL autoriza consultar/aceitar aquele convite. Não há verificação OTP do e-mail ou telefone. A foto chega via HTTPS à API e motor, é processada em memória e não é salva em bruto no banco da aplicação. O motor salva um vetor facial criptografado com Fernet. A chave `FACE_TEMPLATE_KEY` precisa de guarda, backup e plano de rotação por recriptografia; a perda da chave inutiliza perfis antigos.

O aceite exige `consent: true` e gera `audit_events.invitation_accepted`, mas não persiste texto/versão do termo, IP, revogação, base legal ou prazo de retenção. É necessária uma avaliação jurídica e de privacidade antes de tratar dados biométricos reais em escala. Imagens obtidas pelo navegador ou por dispositivos podem permanecer em cache/galeria fora do controle da aplicação; configure os dispositivos operacionais adequadamente.

## Limites do reconhecimento

YuNet detecta uma face, SFace cria vetor de 128 dimensões e a busca é restrita aos aceitos do evento. `review` impede liberação automática quando a pontuação é intermediária ou ambígua. Não há prova de vida, anti-spoofing, calibração de limiares, medição de viés ou certificação de desempenho. Uma foto impressa ou tela pode enganar o motor. Supervisione o acesso físico e tenha verificação alternativa. As decisões de passagem não devem depender apenas da pontuação numérica.

## Controles ainda pendentes

MFA administrativo, recuperação de senha, limitação distribuída de login, auditoria de alterações administrativas, política de retenção/exclusão, segurança de dispositivo, observabilidade com mascaramento, proteção contra replay de convite e prova de vida. A ligação TLS do motor ao Neon usa `sslmode=require`; ainda precisa de verificação explícita do certificado para endurecimento. [Plano de implementação](roadmap.md).
