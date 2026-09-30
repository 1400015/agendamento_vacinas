# 💉 Central de Marcações de Vacinas — Farmácia Boavista

**Versão unificada** — sistema de rede interna para gerir, em vários postos ao
mesmo tempo, a lista de utentes e o calendário de administração das vacinas da
gripe (G) e da COVID-19 (C), com marcação telefónica, controlo de estados e
exportação em PDF.

Corre **na rede local da farmácia**: um computador (interior) corre o
servidor e os restantes postos acedem pelo navegador — sem internet, sem
mensalidades, sem dependências. Acesso protegido por **PIN**, com auditoria
por posto.

> Esta versão reúne o melhor das três implementações anteriores
> (`agendamento_muse`, `agendamento_glm5.3flash`, `agendamento_glm5.3_mistral`).

---

## Índice

1. [O que reúne de cada versão](#1-o-que-reúne-de-cada-versão)
2. [Funcionalidades](#2-funcionalidades)
3. [Arquitetura](#3-arquitetura)
4. [Instalação rápida](#4-instalação-rápida)
5. [Utilização](#5-utilização)
6. [Regras de marcação](#6-regras-de-marcação)
7. [Controlo de concorrência](#7-controlo-de-concorrência)
8. [Segurança](#8-segurança)
9. [Importação de utentes (.txt)](#9-importação-de-utentes-txt)
10. [Exportação (PDF e CSV)](#10-exportação-pdf-e-csv)
11. [Testes](#11-testes)
12. [Configuração (config.json)](#12-configuração-configjson)
13. [API (referência)](#13-api-referência)
14. [Estrutura dos dados](#14-estrutura-dos-dados)
15. [Resolução de problemas](#15-resolução-de-problemas)

---

## 1. O que reúne de cada versão

| Origem | O que foi adotado |
|---|---|
| **muse** (Python/SQLite) | Modelo separado utentes/marcações; `rev` **por registo** (concorrência fina); estados `faltou`/`cancelado` **libertam a hora**; limite `maxPorHora`; **deteção de duplicados** na importação; reagendamento que cria marcação nova e liberta a antiga; **auditoria com posto**; testes de regressão versionados |
| **mistral** (Node) | PIN com **PBKDF2 (150k iterações) + verificador AES-256-GCM** (o PIN nunca fica em claro); sessões 8h em cookie HttpOnly; escrita atómica; documentação completa |
| **flash** (Node) | **Calendário em grelha**; **horário configurável** (início/fim/intervalo/sábado); vacinas **por slot** (G+C pode levar as duas vacinas na mesma hora); interface visual |

Runtime único: **Node.js puro**, num só ficheiro de servidor, sem `npm install`.

## 2. Funcionalidades

- **Lista de utentes** — nome, contacto, vacina (G / C / G+C), pesquisa;
- **Importação via TXT** — `nome; contacto; vacina`; duplicados ignorados;
- **Marcação telefónica** — dia + hora + vacinas a administrar; utentes G+C
  podem levar ambas na mesma hora ou em marcações separadas;
- **Calendário semanal** (2.ª a sábado por omissão, configurável)
  partilhado entre postos, com sobreposições só com justificação escrita;
- **Sábado com períodos próprios** — marcações aceites apenas entre
  **09:30–12:00** e **15:00–17:00**, com **aviso de confirmação** ao marcar
  (por norma não se vacina ao sábado); as restantes horas dessa coluna ficam
  indisponíveis na grelha;
- **Domingo sem marcações** — recusado no cliente e no servidor;
- **Estados**: `Agendado` · `Administrado` · `Não compareceu (ligar novamente)`
  · `Cancelado` — faltas e cancelamentos **libertam a hora**;
- **Reagendamento**: marcação antiga é preservada no histórico, nova nasce
  `agendada`, hora antiga fica livre;
- **Indicadores semanais** no topo: programadas vs. administradas (G+C conta
  2 doses), faltas e canceladas;
- **Histórico/auditoria**: cada operação fica registada com o posto que a
  executou (aba Histórico);
- **Exportação PDF e CSV**: lista de utentes, calendário por dia/semana e CSV
  de utentes/marcações (com filtro de datas) para os relatórios da campanha;
- **Configuração pela interface** (aba Configuração): horários dos dias úteis e
  de sábado, intervalo, máximo por hora, dias de encerramento e pasta de backup
  — validados no servidor, sem editar ficheiros nem reiniciar;
- **Dias de encerramento** (feriados/férias): o servidor recusa marcações
  nesses dias e a grelha marca-os como «encerrado»;
- **Multi-posto sem perdas**: sincronização automática (5 s) e confirmação
  obrigatória em conflitos.

## 3. Arquitetura

```
┌────────────────────┐        ┌─────────┐ ┌─────────┐ ┌─────────┐
│  PC interior       │        │ Posto 1 │ │ Posto 2 │ │  ...    │
│  node servidor.js  │◄─rede─►│ browser │ │ browser │ │ browser │
│   ├ public/        │  HTTP  └─────────┘ └─────────┘ └─────────┘
│   ├ dados.json     │
│   ├ config.json    │
│   └ config-pin.json│
└────────────────────┘
```

| Componente | Tecnologia | Notas |
|---|---|---|
| Servidor | Node.js puro (`servidor.js`) | Sem `npm install`; porta 8080 por omissão |
| Cliente | HTML + JS vanilla (`public/index.html` + `public/app.js`) | Servido pelo próprio servidor |
| Dados | `dados.json` | Escrita atómica (tmp + rename) |
| PIN | `config-pin.json` | Sal + IV + verificador AES-GCM; nunca em claro |
| Configuração | `config.json` | maxPorHora, horário do calendário |

## 4. Instalação rápida

```bash
node servidor.js          # porta 8080
node servidor.js 9090     # outra porta
```

Abrir nos postos o endereço mostrado no arranque (ex.:
`http://192.168.1.50:8080`). Guia detalhado para Windows e Linux
(arranque automático, firewall, cópias de segurança): **[`INSTALL.md`](INSTALL.md)**.

Requisitos: Node.js 18+ apenas no servidor; nos postos basta navegador.

## 5. Utilização

### Primeiro acesso
Definir um **PIN** (mín. 4 caracteres). Em cada posto, ao entrar, indica-se o
**nome do posto** (ex.: "Posto 1") — todas as operações ficam associadas a
esse posto na auditoria.

### Aba Utentes
- Adicionar utente (nome, contacto, vacina);
- Importar `.txt` (com relatório de inseridos/duplicados/inválidos);
- Pesquisar; clicar num utente para ver marcações e editar dados;
- *Marcar* abre o registo de chamada telefónica (dia, hora, vacinas);
- Exportar PDF ou **CSV** da lista.

### Aba Calendário semanal
- Contadores no topo: **programadas**, **administradas**, faltas, canceladas;
- Clique numa célula vazia → marcar utente nesse dia/hora;
- Clique numa marcação → alterar estado, reagendar ou eliminar;
- **Sábado**: a coluna mostra só os períodos 09:30–12:00 e 15:00–17:00 (as
  restantes células ficam indisponíveis) e marcar nesse dia pede confirmação;
- Cores: azul = agendado, verde = administrado, âmbar = faltou,
  cinza = cancelado; **J** = justificada;
- Exportar PDF (dia / semana completa) e **CSV** (dia / semana).

### Aba Configuração
- **Horários** dos dias úteis e de sábado (dois períodos por dia), **intervalo**
  entre marcações e **máximo por hora**;
- **Dias de encerramento** (feriados/férias), uma data por linha (AAAA-MM-DD);
- **Cópia de segurança**: pasta na rede, testar caminho e backup imediato.

Aplica-se logo, sem reiniciar o servidor. Um valor inválido é **recusado com a
razão** (não é substituído em silêncio) e alterar horários **não move**
marcações já feitas.

### Aba Histórico
Últimas 500 operações: quando, posto, ação e detalhe.

## 6. Regras de marcação

| Regra | Comportamento |
|---|---|
| Ocupação de hora | Só `agendado` e `administrado` bloqueiam o horário; `faltou` e `cancelado` **libertam** |
| Sobreposição | Recusada sem **justificação escrita** (motivo obrigatório) |
| Limite por hora | `maxPorHora` (por omissão 2) — mesmo justificado, não excede |
| Duplicado do utente | O mesmo utente não tem 2 marcações ativas na mesma hora |
| Reagendamento | Marcação nova nasce `agendada`; a antiga passa ao estado escolhido e liberta a hora. Se ficar num estado que ocupe (`agendado`/`administrado`), a antiga é cancelada automaticamente e fica ligada à nova (`supersedidaPor`), sem contar nas «Canceladas» ou «Faltas» |
| Horário | Validado no servidor e no cliente (ex.: recusa 07:00 fora do horário) |
| Sábado | Só **09:30–12:00** e **15:00–17:00** (períodos próprios em `config.json`); fora deles → `400`. O cliente avisa que é sábado e pede confirmação, e a grelha desativa as horas fora dos períodos |
| Domingo | Nunca aceita marcações (`400`), mesmo que o dia apareça noutra vista |
| Dias de encerramento | Datas em `diasFechados` (aba Configuração): o servidor recusa marcações (`400`) e a grelha mostra o dia como «encerrado» |

## 7. Controlo de concorrência

1. **Duas camadas**: `versao` global (deteta que *alguma coisa* mudou) e `rev`
   **por registo** (deteta que *este* utente/marcação mudou).
2. Toda a mutação envia `baseVersao`; se outro posto gravou entretanto →
   `409` com o estado atual, e a página mostra o diálogo
   *"Registo alterado noutro posto"* — só grava após **«Confirmar e gravar»**,
   mostrando onde a alteração vai ficar.
3. Edições/eliminações enviam a `rev` do registo visto; se outro posto alterou
   esse registo → `409` com o registo atual.
4. Sobreposições verificadas **no servidor no momento da gravação** — dois
   postos a marcar a mesma hora em simultâneo: um grava, o outro recebe aviso
   com o nome do ocupante.
5. Sincronização automática de cada posto a cada 5 segundos; indicador
   "ligado ao servidor" sempre visível.

## 8. Segurança

- **PIN** com PBKDF2 (150 000 iterações) e verificador AES-256-GCM — o PIN
  nunca é guardado em claro (aprendizado da versão mistral);
- **Sessões** de 8h em cookie `HttpOnly` + `SameSite=Strict` (o PIN nunca fica
  no browser); sem sessão, a API recusa tudo (`401`);
- Sem CORS: a API é mesma-origem; nenhuma página externa a consegue ler;
- Dados apenas no servidor da farmácia; nada sai para a internet;
- **Redefinir PIN esquecido**: parar o servidor, apagar `config-pin.json`,
  arrancar de novo (dados de utentes não são afetados);
- Restringir a porta 8080 no firewall à rede interna; **não** abrir no router.

## 9. Importação de utentes (.txt)

```
nome; contacto; vacina
```

Exemplo (`exemplo-utentes.txt`):

```
Maria Fernandes; 912 345 678; G
João Santos; joao.santos@email.pt; C
Ana Rodrigues; 934 567 890; G+C
Carlos Pereira; 945 678 901; gripe
```

- Aceita `G`, `C`, `G+C` e palavras (`GRIPE`, `COVID`, `AMBAS`, `FLU`);
- **Duplicados ignorados** (normalização de nome/contacto) — importar duas
  vezes não duplica;
- Codificação UTF-8; linhas inválidas reportadas.

## 10. Exportação (PDF e CSV)

**PDF** — os botões de exportação (lista / calendário) abrem uma janela de
impressão: escolher a impressora «Guardar como PDF». Os documentos incluem
cabeçalho da farmácia, data/hora, posto responsável e, no calendário, o resumo
semanal de programadas vs. administradas e as justificações.

**CSV** — «Exportar CSV» na lista de utentes e no calendário (dia / semana)
descarrega um ficheiro com separador «;» e BOM UTF-8 (o Excel em português abre
com os acentos corretos). O CSV de marcações aceita filtro de datas
(`desde`/`ate`), útil para os relatórios da campanha; campos com «;» ou aspas
saem entre aspas duplas.

## 11. Testes

```bash
node testes-cliente.js     # interface (cliente em DOM mínimo): 68 verificações
node servidor.js 18090     # numa janela (para a bateria da API)
node testes.js             # noutra: 173 verificações
```

Cobrem: PIN/sessões (incl. rate-limit), validações, duplicados na importação,
sobreposições e justificações, `maxPorHora`, estados a libertar horário,
reagendamento, conflitos de versão e de registo, dois postos em simultâneo,
eliminações, auditoria, validação de schema na carga, `config.json` inválida
(avisa e volta aos defeitos, corrigindo o ficheiro) ou ilegível (preserva e não
arranca), injeção do caminho de dados no backup, backup/exportação, **alteração
de configuração pela API** (horários, sábado, intervalo, máximo por hora — com
recusa do que é inválido e recálculo das horas), **dias de encerramento**
(marcação e reagendamento recusados), **exportação CSV** (cabeçalho, BOM,
filtro de datas e escape de «;»/aspas), regras de **sábado** (períodos próprios)
e **domingo** (recusado) e as regressões do cliente (métodos HTTP,
sincronização com cookie, grelha do calendário, código de arranque). Os
`testes-cliente.js` executam o `app.js` real (num DOM mínimo) e verificam o
aviso de sábado, a recusa do domingo, os dias de encerramento, o horário por
dia, as células indisponíveis da grelha, o painel de configuração e o URL da
exportação CSV.

## 12. Configuração (config.json)

Criado automaticamente junto ao servidor; editável no ficheiro (reiniciar
depois) **ou pela aba Configuração da interface** (aplica-se logo, sem
reiniciar):

```json
{
  "maxPorHora": 2,
  "horaInicio": "08:30",
  "horaFim": "12:00",
  "horaInicio2": "14:30",
  "horaFim2": "19:30",
  "sabadoInicio": "09:30",
  "sabadoFim": "12:00",
  "sabadoInicio2": "15:00",
  "sabadoFim2": "17:00",
  "intervaloMin": 30,
  "mostrarSabado": true,
  "diasFechados": ["2026-12-08", "2026-12-25"],
  "pastaBackup": ""
}
```

- `maxPorHora` — máximo de marcações ativas por horário (com ou sem
  justificação, o limite é absoluto);
- `intervaloMin` — 15, 30 ou 60 minutos;
- `horaInicio2`/`horaFim2` — segundo período do dia (pausa de almoço entre `horaFim` e `horaInicio2`);
- `sabadoInicio`/`sabadoFim`/`sabadoInicio2`/`sabadoFim2` — períodos próprios do
  sábado (por omissão 09:30–12:00 e 15:00–17:00); fora deles o servidor recusa
  marcações ao sábado. O aviso ao marcar no sábado é dado na mesma, porque por
  norma não há vacinação nesse dia;
- `mostrarSabado` — `true` (por omissão) mostra a coluna do sábado no
  calendário; `false` esconde-a (grelha só de 2.ª a 6.ª);
- `diasFechados` — datas em que a farmácia está fechada (feriados/férias); o
  servidor recusa marcações nesses dias;
- o **domingo** nunca aceita marcações.

## 13. API (referência)

Autenticação: `Authorization: Bearer <token>` ou cookie `sessao`.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/estado` | Se o PIN já foi definido; config e horário |
| POST | `/api/setup` | Define o PIN inicial; devolve token |
| POST | `/api/login` | Valida PIN + posto; devolve token |
| POST | `/api/logout` | Termina a sessão |
| GET | `/api/dados` | `{versao, utentes, marcacoes, config, horas, horasSabado}` (`304` se `?versao=` atual) |
| GET | `/api/historico` | Últimas 500 operações de auditoria |
| GET | `/api/horas` | Horas válidas (`horas`, `horasSabado`) e config |
| POST | `/api/utentes` | Criar utente |
| POST | `/api/importar` | Importar lote |
| PUT | `/api/utentes/:id` | Editar (com `rev` do registo) |
| DELETE | `/api/utentes/:id` | Eliminar (com `rev`; apaga as marcações) |
| POST | `/api/marcacoes` | Criar marcação |
| PUT | `/api/marcacoes/:id` | Alterar estado / reagendar |
| DELETE | `/api/marcacoes/:id` | Eliminar |
| PUT | `/api/config` | Alterar horários, `intervaloMin`, `maxPorHora`, `mostrarSabado`, `diasFechados` e `pastaBackup` (valida e recusa com `400`) |
| POST | `/api/backup/testar` | Testar escrita na pasta de backup |
| POST | `/api/backup` | Backup manual imediato |
| GET | `/api/exportar` | Descarregar cópia JSON dos dados |
| GET | `/api/exportar.csv` | CSV para relatórios: `?tipo=utentes\|marcacoes` (+ `&desde=&ate=` opcional) |

Toda a mutação envia `baseVersao`. Respostas:

- `200` — aplicada; devolve o estado completo atualizado;
- `409` — `motivo: "versao"` (outro posto gravou), `"registo"`
  (este registo mudou; devolve `atual`) ou `"slot_ocupado"`
  (com `ocupantes`); sempre com o estado mais recente;
- `400/401/403` — validação, sem sessão ou PIN já definido.

## 14. Estrutura dos dados

`dados.json` (gerado pelo servidor — não editar à mão):

```json
{
  "versao": 42,
  "utentes":   [ { "id", "nome", "contacto", "vacina", "obs",
                   "rev", "criadoEm", "criadoPor", "atualizadoEm" } ],
  "marcacoes": [ { "id", "utenteId", "data", "hora", "vacinas": ["G","C"],
                   "estado", "justificada", "motivo", "rev",
                   "criadoEm", "criadoPor", "historico": [...] } ],
  "historico": [ { "quando", "posto", "acao", "alvo", "detalhe" } ]
}
```

- `estado`: `agendado` · `administrado` · `faltou` · `cancelado`;
- `vacinas`: lista por marcação (G+C = `["G","C"]` → conta 2 doses);
- `rev`: revisão do registo para concorrência fina;
- Escrita atómica (ficheiro temporário + renomeação).

## 15. Resolução de problemas

| Problema | Solução |
|---|---|
| Postos não abrem a página | Mesma rede? Usar o IP mostrado no arranque; firewall (ver `INSTALL.md`) |
| PIN esquecido | Parar servidor, apagar `config-pin.json`, arrancar de novo |
| «FICHEIRO DE DADOS ILEGÍVEL» ao arrancar | O ficheiro é preservado como `dados.json.corrompida-…` e o servidor não arranca para não apagar dados; restaure a última cópia de segurança para `dados.json` |
| «Registo alterado noutro posto» | Normal: outro posto gravou — confirmar e gravar |
| «Hora cheia» | `maxPorHora` atingido — ver secção 12 |
| «Hora fora do horário de sábado» | Ao sábado só há marcações das 09:30–12:00 e das 15:00–17:00 (ver secção 12) |
| Marcação ao domingo recusada | O domingo não tem horário — escolha outro dia |
| «A farmácia está encerrada nesse dia» | A data está em «Dias de encerramento» (aba Configuração) — remova-a para voltar a aceitar marcações |
| «Nenhuma alteração indicada» ao guardar a configuração | Enviou um pedido sem campos conhecidos — use a aba Configuração |
| Porta ocupada | `node servidor.js 9090` |
| Popup bloqueada nos PDF | Permitir popups para o endereço do servidor |
| Dados "desapareceram" | O servidor tem de correr a partir da mesma pasta (`dados.json`) |
