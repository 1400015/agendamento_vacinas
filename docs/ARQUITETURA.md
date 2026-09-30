# Arquitetura do código

O servidor é Node.js puro (zero dependências npm) dividido em módulos sob `src/`.
O `servidor.js` é apenas o ponto de entrada: arranca, monta o contexto e serve HTTP.

## Módulos

| Ficheiro | Responsabilidade |
|---|---|
| `servidor.js` | Ponto de entrada: HTTP, ficheiros estáticos, arranque |
| `src/util.js` | Validaciones (data/hora/vacina), normalizações, chave de utente, log operacional |
| `src/armazenamento.js` | Carga/persistência de `dados.json` com validação de schema por registo, escrita atómica, proteção contra corrupção |
| `src/config.js` | Carga/validação de `config.json` (BOM, formatos, horário com slots) |
| `src/autenticacao.js` | PIN (PBKDF2 150k + verificador AES-256-GCM), código de arranque, sessões 8h, rate-limit por IP |
| `src/backup.js` | Cópia diária rotativa (rede interna ou `backups/` local), teste de caminho |
| `src/api.js` | Todas as rotas e regras de negócio (utentes, marcações, conflitos, exportação, config) |
| `restaurar.js` | Restauro validado de cópia (com o servidor parado) |

## Fluxo de um pedido de mutação

1. `servidor.js` lê o corpo (limite 5 MB → 413) e chama `src/api.js`.
2. A rota exige sessão (`autenticacao.js`) e `baseVersao` igual à do servidor (concorrência entre postos → 409 com estado fresco).
3. Nos registo individuais, exige `rev` do registo (conflito → 409 com `atual`).
4. Muta o modelo `dados` em memória (Node single-threaded = sem corrida dentro do pedido).
5. `gravar()`: incrementa `versao`, persiste atomicamente (`armazenamento.js`), dispara o backup diário (falha nunca bloqueia) e responde com o estado completo.

## Regras de negócio essenciais

- Estados: `agendado`, `administrado`, `faltou`, `cancelado`. Só `agendado`/`administrado` ocupam horário (`OCUPAM`).
- `maxPorHora` por slot; excesso só com exceção **justificada com motivo**.
- O mesmo utente não pode ter 2 marcações ativas na mesma hora (verificado na criação, no deslocamento e no reagendamento).
- Reagendar cria marcação nova `agendada` e cancela a antiga (`supersedidaPor`) — liberta a hora sem inflacionar «canceladas».
- Validação de datas **por partes** (nunca `toISOString()` — bug de fuso horário PT).

## Ficheiros de runtime (não versionados)

- `dados.json` — todos os dados (utentes, marcações, histórico). Permissão 600.
- `config.json` — validado no arranque; ilegível → preserva e não arranca.
- `config-pin.json` — PIN derivado (nunca em claro).
- `codigo-arranque.txt` — só existe até o PIN ficar definido.
- `backups/` — cópias rotativas (7 dias); pode apontar para a rede interna via interface.
- `servidor.log` — log operacional de baixo nível (I/O, backups, autenticação); rotação a 5 MB.

## CI

`.github/workflows/ci.yml` corre em cada push/PR: `node --check` em todos os ficheiros e a bateria `testes.js` contra um servidor de teste em `TZ=Europe/Lisbon` (o fuso importa — ver regressão do horário de verão no histórico de commits).
