# Como contribuir

Obrigado por ajudar. As regras abaixo existem para o projeto continuar gratuito, offline e confiável.

## Ambiente

```powershell
git clone https://github.com/Mrz1nn/terminal-design.git
cd terminal-design
node bin/td.js doctor      # roda direto do clone (modo "dev")
npm test
npm run lint
```

Não há `npm install`, porque o projeto não tem dependências. Para testar sem mexer na sua configuração real, defina `TD_CONFIG_HOME`, `TD_DATA_HOME` e `CLAUDE_CONFIG_DIR` apontando para pastas temporárias. Os testes já fazem isso.

## Regras

1. **Sem dependências em tempo de execução.** Se uma for realmente necessária, abra uma issue antes. A licença precisa ser compatível com MIT e entrar em `THIRD_PARTY_NOTICES.md`.
2. **Nenhuma métrica inventada.** Todo número exibido precisa vir de uma fonte oficial ou do sistema local. Estimativas precisam aparecer como estimativas (por exemplo, `est.`).
3. **Não destruir configuração.** Faça backup antes de alterar qualquer arquivo de outro programa e grave sempre de forma atômica (`writeJsonAtomic`).
4. **Nada de rede sem o usuário pedir.** A status line nunca acessa a rede.
5. **Os módulos são independentes.** O cockpit não importa a voz e a voz não importa o cockpit. O que for comum vai para `packages/core`.
6. **Um teste para cada comportamento novo**, usando `node:test`.

## Convenções

- ESM, Node 18.17 ou mais novo, 2 espaços (veja `.editorconfig`).
- Mensagens ao usuário em português (pt-BR). Código e comentários em inglês.
- Commits no formato [Conventional Commits](https://www.conventionalcommits.org): `feat(themes): ...`, `fix(cockpit): ...`, `docs: ...`.
- [Versionamento semântico](https://semver.org). Toda mudança visível entra no `CHANGELOG.md`, na seção "Não lançado".

## Adicionar um widget

1. Crie o objeto `{ id, group, priority, render(d, ctx) }` em `apps/terminal-cockpit/src/widgets.js`.
2. Use `ctx.paint` para as cores e devolva `null` quando não houver dado.
3. Adicione um teste em `tests/cockpit.test.js` e documente o widget em `docs/claude-code.md`.

## Adicionar um comando

Crie `packages/cli/src/commands/<nome>.js` seguindo o contrato de [docs/architecture.md](docs/architecture.md) e registre o arquivo em `commands/index.js`.

## Lançar uma versão (mantenedores)

1. Atualize a versão no `package.json` e mova as entradas de "Não lançado" no `CHANGELOG.md` para a nova versão.
2. Crie a tag `git tag vX.Y.Z` e dê `git push --tags`.
3. O workflow `release.yml` roda os testes, empacota com `scripts/pack-release.js` e publica o zip junto com o `SHA256SUMS.txt`.
