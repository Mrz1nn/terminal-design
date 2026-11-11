# Segurança

## Como reportar

Não abra uma issue pública para vulnerabilidades. Use o recurso **Security > Report a vulnerability** do repositório no GitHub (aviso privado).

## O que o Terminal-Design garante

| Área | Garantia |
|---|---|
| Rede | Só há acesso à rede em `td update` (API e downloads do GitHub) e em `td voice setup` (GitHub e Hugging Face), sempre a pedido e com confirmação. A status line nunca acessa a rede. |
| Atualizações | O zip só é aceito se o SHA-256 bater com o `SHA256SUMS.txt` da release. Nenhum script do pacote é executado antes da verificação, e não há atualização silenciosa. |
| Downloads da voz | O modelo é verificado pelo hash publicado no whisper.cpp. Veja docs/voice.md. |
| Áudio | É gravado em um WAV temporário local, transcrito localmente e apagado em seguida. Nada é enviado para fora. |
| Credenciais | Nenhuma fica no repositório (o `npm run lint` procura padrões de token). O `GITHUB_TOKEN` é opcional e só é lido do ambiente. |
| Configurações de outros programas | O `settings.json` do Claude Code passa por backup antes de mudar, e só as chaves `statusLine` e `subagentStatusLine` são alteradas. O `settings.json` do Windows Terminal e o do VS Code não são editados. |
| Telemetria | Não existe. |
| Comandos | Nenhum comando perigoso roda automaticamente. O `td uninstall` só remove as pastas do próprio td. |

## Limitações conhecidas

- A digitação por voz usa `SendInput`. Como em qualquer programa de usuário comum, ela não consegue digitar em janelas abertas como administrador.
- Quem pode gravar em `%LOCALAPPDATA%\TerminalDesign` pode alterar o programa. Esse é o mesmo modelo de confiança de qualquer instalação por usuário.
