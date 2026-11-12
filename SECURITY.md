# Segurança

## Como reportar

Não abra uma issue pública para vulnerabilidades. Use o recurso **Security > Report a vulnerability** do repositório no GitHub (aviso privado).

## O que o Terminal-Design garante

| Área | Garantia |
|---|---|
| Rede | Downloads só acontecem em `td update` (GitHub), sempre a pedido e com confirmação. A status line nunca espera a rede: ela só lê um cache local. Com `update.auto: notify` (o padrão), quando esse cache passa de `update.checkIntervalHours` (24 h), um processo em segundo plano faz uma única consulta anônima à API pública de releases do GitHub, sem token e sem dados pessoais, e só registra se existe versão nova. Para desligar: `td config set update.auto off` ou a variável `TD_NO_UPDATE_CHECK=1`. |
| Atualizações | O zip só é aceito se o SHA-256 bater com o `SHA256SUMS.txt` da release. Nenhum script do pacote é executado antes da verificação, e não há atualização silenciosa. |
| Áudio | É gravado em um WAV temporário local, transcrito localmente e apagado em seguida. Nada é enviado para fora. |
| Credenciais | Nenhuma fica no repositório (o `npm run lint` procura padrões de token). O `GITHUB_TOKEN` é opcional e só é lido do ambiente. |
| Configurações de outros programas | O `settings.json` do Claude Code passa por backup antes de mudar, e só as chaves `statusLine` e `subagentStatusLine` são alteradas. O `settings.json` do Windows Terminal e o do VS Code não são editados. |
| Telemetria | Não existe. |
| Comandos | Nenhum comando perigoso roda automaticamente. O `td uninstall` só remove as pastas do próprio td. |

## Limitações conhecidas

- Quem pode gravar em `%LOCALAPPDATA%\TerminalDesign` pode alterar o programa. Esse é o mesmo modelo de confiança de qualquer instalação por usuário.
