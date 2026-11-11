# Atualizações

O Terminal-Design se atualiza pelas [Releases do GitHub](https://github.com/Mrz1nn/terminal-design/releases). Ele **nunca instala nada sozinho**: no máximo avisa que existe versão nova.

## Comandos

```powershell
td update              # verifica, mostra as novidades e pergunta antes de instalar
td update --check      # só verifica, não baixa nada
td update --yes        # instala sem perguntar
td update --prerelease # inclui versões de teste nesta execução
td update --rollback   # volta para a versão anterior
```

## Configuração

No `config.json` (`td config set <chave> <valor>`):

| Chave | Valores | Padrão | O que faz |
|---|---|---|---|
| `update.auto` | `notify`, `off` | `notify` | `notify` mostra um aviso no painel quando há versão nova. `off` desliga até a verificação em segundo plano. |
| `update.checkIntervalHours` | número | `24` | De quanto em quanto tempo verificar. |
| `update.channel` | `stable`, `prerelease` | `stable` | `prerelease` também considera versões de teste (`1.2.0-beta.1`). |
| `update.repository` | `dono/repo` ou `null` | `null` | Repositório de onde vêm as atualizações. `null` usa o do `package.json`. |

A variável de ambiente `TD_NO_UPDATE_CHECK=1` desliga o aviso. `GITHUB_TOKEN` é opcional e só serve para evitar o limite de consultas da API do GitHub. Ela é enviada apenas para `api.github.com`.

## Como uma atualização acontece

1. Consulta `https://api.github.com/repos/<repo>/releases` e escolhe a maior versão do canal, ignorando rascunhos.
2. Compara com a versão instalada e mostra o resumo das novidades.
3. Pede confirmação, a menos que você use `--yes`.
4. Baixa `terminal-design-<versão>.zip` e `SHA256SUMS.txt`, só por HTTPS.
5. **Confere o SHA-256** do zip. Se o checksum não bater ou não existir, a atualização é recusada.
6. Valida os nomes dentro do zip, para que nada seja gravado fora da pasta temporária, e extrai em `staging\` com o `tar.exe` do Windows.
7. Confere o pacote: a versão do `package.json` precisa ser igual à da release, e `bin\td.js` precisa existir.
8. Faz um teste rodando `td version` da nova versão. É o único código baixado que é executado, e só depois do checksum.
9. Faz um backup do `config.json` em `backups\`. A configuração em si não é alterada.
10. Move a nova versão para `versions\<versão>` e troca o `current.json` de uma vez só. A versão anterior fica registrada em `previous`.
11. Mantém só as duas últimas versões (a atual e a anterior) e apaga as mais antigas.

Se qualquer passo depois da instalação falhar, o `current.json` volta ao que era, a pasta nova é removida e você continua na versão que já tinha. Duas atualizações ao mesmo tempo são bloqueadas.

## Voltar uma versão

```powershell
td update --rollback
```

Troca a versão atual pela anterior. A versão de que você saiu continua instalada, então rodar o rollback de novo desfaz a troca.

Se a versão atual não carregar de jeito nenhum, o `launcher.js` usa a anterior automaticamente e mostra um aviso no stderr.

## Modo dev (clone git)

Quando o `td` roda de um clone git e não da instalação, `td update` mostra a versão disponível e pede para você usar:

```powershell
git pull
```

## Aviso de nova versão no painel

O painel e a status line chamam `getUpdateNotice()` (em `packages/updater/src/notice.js`). Essa função:

- só lê o arquivo `cache\update-check.json` e **nunca espera a rede**;
- quando o cache está vencido, dispara uma verificação em segundo plano, escondida e no máximo uma vez a cada 10 minutos;
- devolve um texto curto, como `Terminal-Design 0.2.0 disponível: rode td update`, ou `null`.

## Publicar uma release (mantenedores)

1. Atualize `version` no `package.json` e faça o commit.
2. Crie e envie a tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. O workflow `.github/workflows/release.yml` roda os testes no `windows-latest`, confere se a tag bate com o `package.json`, gera os arquivos com `node scripts/pack-release.js` e cria a Release com o `gh`. Tags com `-` (por exemplo `v0.3.0-beta.1`) saem como prerelease.

Para gerar os arquivos localmente:

```powershell
node scripts/pack-release.js            # cria dist\terminal-design-<versão>.zip e dist\SHA256SUMS.txt
```

O zip é gerado em Node puro, sem dependências, e sai igual byte a byte para os mesmos arquivos de origem. Dentro dele, tudo fica numa pasta `terminal-design-<versão>/`.
