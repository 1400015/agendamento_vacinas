# Alterações

## 2026-09-30 (4) — Painel de configuração, dias de encerramento e exportação CSV

Três melhorias para o uso no balcão: deixar de obrigar a editar `config.json` à
mão, tratar os dias em que a farmácia está fechada e produzir ficheiros para os
relatórios da campanha.

### Painel de configuração (aba Configuração)
Novo `PUT /api/config` completo: horários dos dias úteis e de sábado,
`intervaloMin`, `maxPorHora`, `mostrarSabado`, `diasFechados` e `pastaBackup`.
A validação passou a viver em `src/config.js` (`validarAlteracoesConfig`) e, ao
contrário do ficheiro editado à mão (onde um valor inválido cai no defeito com
aviso), o que vem da INTERFACE é **recusado com a razão** — não se grava nada
que o utilizador não pediu — e ainda se confirma que sobram horas marcáveis nos
dias úteis e no sábado. Depois de gravar, a API recalcula
`horas`/`horasSabado` (deixaram de ser valores fixos da injeção), pelo que a
alteração se aplica logo, sem reiniciar o servidor.

No cliente, a nova aba junta horários, intervalo, máximo por hora, dias de
encerramento e a cópia de segurança (que saiu da aba Histórico). O formulário só
é reescrito quando a configuração muda mesmo (`assinaturaCfg`): sem isso, a
sincronização de 5 s apagaria o que estivesse a ser escrito. O botão de testar o
caminho de backup passou a testar o caminho escrito (o servidor aceita-o no
corpo) em vez do que estava gravado.

### Dias de encerramento (feriados / férias)
`config.diasFechados` (lista de `AAAA-MM-DD`, normalizada com `validarData`).
Nesses dias o servidor recusa agendamento e reagendamento com `400`, o cliente
não oferece horas nem aceita a marcação, e a grelha mostra o dia como
«encerrado» com as células indisponíveis. O arranque imprime as datas quando a
lista não está vazia.

### Exportação CSV
Nova rota `GET /api/exportar.csv?tipo=utentes|marcacoes` (com `&desde=&ate=`
opcional), com separador «;», BOM UTF-8 (o Excel em português abre com os
acentos corretos) e escape de aspas, «;» e quebras de linha. Botões na lista de
utentes e no calendário (CSV do dia / da semana).

### Testes
Bateria da API: 136 → **173 verificações**; testes de interface: **68**
(total **241**), com `TZ=Europe/Lisbon`.

## 2026-09-30 (3) — Fechar o checklist de testes (config inválida e injeção do backup)

Estavam dois itens por fazer no «Checklist de Testes» de `docs/ARQUITETURA.md`.
Ambos ficam cobertos por testes e o checklist passa a refletir o que o sistema
faz de facto.

### `config.json` com valores inválidos
O item estava escrito como «preserva + pára», o que **não** corresponde ao
desenho: só a config **ilegível** é preservada e trava o arranque; uma config
legível mas fora do esperado deve ser corrigida campo a campo para não impedir
o serviço. Passou a haver uma verificação que arranca um servidor de teste com
`config.json` cheio de lixo (`horaInicio: "25:00"`, `horaFim: "99:99"`,
`maxPorHora: "muitos"`, `intervaloMin: 7`, períodos de sábado inválidos,
`pastaBackup` com espaços) e confirma que: o servidor **arranca**, **avisa** em
log/stderr, volta aos **defeitos** por campo (08:30–12:00 / 14:30–19:30,
30 min, 2 por hora, sábado 09:30–12:00 / 15:00–17:00), **mantém** os valores
válidos (`mostrarSabado`), **normaliza** a pasta de backup (trim) e **reescreve
o ficheiro já corrigido** no disco. O texto do checklist foi corrigido e o
«Tratamento de Erros» de `ARQUITETURA.md` separa agora os dois casos (ilegível
→ preserva + pára; valores inválidos → avisa + defeitos + reescreve).

### Injeção do caminho de dados no backup
`backup.js` recebe o caminho de `dados.json` por `usarFicheiroDados()` (para
não criar um ciclo com `armazenamento.js`), mas só `usarFicheiroDados` estava
exportado — `persistirDados()` era documentado na arquitetura e não era
verificável. Passou a ser exportado e o teste verifica a injeção pelo
**efeito**, não pelo getter: cria um ficheiro de origem com `versao: 7`, regista-o,
corre `backupAuto()` e confirma que a cópia é feita **a partir desse ficheiro**
(e não do `dados.json` por omissão), com o nome
`dados.backup-AAAA-MM-DD.json` e entrada na auditoria — repondo depois o
caminho real do processo.

### Verificação
Bateria da API: 124 → **136 verificações**; testes de interface:
**46/46** (total **182**), com `TZ=Europe/Lisbon`.

## 2026-09-30 (2) — Marcação ao sábado (com aviso) e testes de interface

Pedido: passar a permitir marcar ao **sábado**, avisando quem marca de que se
trata de um sábado (por norma não se vacina nesse dia) e limitando as
marcações desse dia a **09:30–12:00** e **15:00–17:00**; mais as recomendações
anteriores (cliente separado, testes de interface, respostas mais leves).

### Sábado com períodos próprios (servidor)
`config.json` ganhou quatro campos — `sabadoInicio`/`sabadoFim` e
`sabadoInicio2`/`sabadoFim2` — por omissão **09:30–12:00** e **15:00–17:00**,
validados como os restantes períodos (se ficarem sem slots, volta-se ao
defeito). `src/config.js` exporta `gerarHorasSabado(cfg)` (a par de
`gerarHoras`) e `servidor.js` passa a gerá-las, injetando-as no contexto da
API (`horasSabado`) e anunciando-as no arranque. Em `src/api.js`, um único
helper `horasDoDia(data) = diaDaSemana(data) === 6 ? horasSabado : horas`
valida o dia e a hora em `POST /api/marcacoes` e em `PUT
/api/marcacoes/:id` (reagendar e deslocar): fora dos períodos de sábado →
`400` («Hora fora do horário de sábado»); ao **domingo** → `400` («Não é
possível agendar ao domingo»), antes de qualquer ocupação de hora.
`mostrarSabado` passou a `true` por omissão (a coluna do sábado aparece, agora
que marcações são possíveis). `src/util.js` substitui `fimDeSemana(v)` — que
já não serve para decidir o horário — por `diaDaSemana(v)` (0 = domingo,
6 = sábado), por partes da data, imune ao fuso.

### Aviso e regras no cliente
O cliente passou a ter as mesmas regras por dia:
- `diaDaSemanaISO`, `horasDoDia`, `opcoesHoras` — o seletor de hora mostra só
  as horas válidas do dia e **recalcula ao mudar a data** (marcar e reagendar);
- `confirmarDia(data, acao)` — bloqueia o domingo com aviso e, ao sábado, pede
  **confirmação** com o texto «Está a marcar num SÁBADO: por norma não se
  vacina ao sábado…», tanto em *Marcar* como ao reagendar;
- a nota do dia (sábado/domingo) aparece no próprio modal;
- `celulaDisponivel(data, hora)` — a grelha do calendário deixa as horas fora
  dos períodos do dia **indisponíveis** (hachuradas, sem clique) e a coluna do
  sábado anuncia «só 09:30–12:00 · 15:00–17:00».

### Cliente separado do HTML
O JavaScript que vivia num bloco `<script>` dentro de `public/index.html`
passou para **`public/app.js`** (transcrição byte a byte do script original,
confirmada por comparação), carregado com `<script src="/app.js"></script>`.
Ganhos: `node --check`/CI validam o cliente, o ficheiro é testável e o HTML
fica só com a marcação e os estilos. O CI passou a verificar `public/app.js`
em vez de extrair o script do HTML.

### Testes de interface (`testes-cliente.js`)
Novo ficheiro que executa o **`public/app.js` real** num DOM mínimo (Node
`vm`, sem browser nem dependências) e verifica comportamento, não só presença
de cadeias: escape de HTML, dia da semana sem fuso, horário por dia
(sábado vs. dia útil), opções de hora, células válidas/indisponíveis da grelha,
nota por dia, `confirmarDia` (domingo bloqueado, sábado com confirmação) e
`confirmarMarcar` (o domingo não avança, o sábado sem confirmação não avança,
o sábado confirmado avança, hora fora do período é recusada) — **46
verificações**. Ligado ao `package.json` (`npm run test:cliente`) e ao CI (passo
sem servidor, antes da bateria da API).

### Bateria da API: 110 → 124
Os testes antigos que exigiam «sábado recusado» foram substituídos pela regra
nova: `/api/horas` devolve `horasSabado` (com 09:30, 12:00, 15:00 e 17:00 e
sem 08:30, 14:30 e 17:30); marcação ao sábado aceite às 10:00 e às 16:00;
recusada às 08:30, 13:00 e 17:30; reagendamento para sábado fora dos períodos
recusado; domingo recusado. A secção `[Interface]` passou a ler o cliente de
`/app.js` (e não do HTML) e a verificar as novas regras de sábado.

### Outras recomendações aplicadas
- `GET /api/dados?versao=<atual>` responde `304` **sem corpo** (`res.end()`
em vez de um JSON vazio) — o poll de 5 s deixa de transportar carga inútil;
- `/api/estado`, `/api/dados`, `/api/horas` e todas as gravações devolvem
também `horasSabado`, para o cliente não ter de inferir horários.

Verificação: `node --check` em servidor, cliente, `src/*.js` e testes; testes
de interface **46/46**; bateria da API **124/124** com `TZ=Europe/Lisbon`
(total **170**).

## 2026-09-30 — Auditoria de interface e endurecimento

Nova leitura integral do código (servidor + cliente) contra uma cópia limpa do
projeto, com a bateria a correr. A bateria passava (103 → **110
verificações**), mas a auditoria encontrou defeitos no cliente que os testes
anteriores não podiam detetar: só verificavam a presença de cadeias no HTML,
nunca executavam o JavaScript da página.

### P0 — Calendário semanal rebentava com a configuração por omissão
Em `renderCal`, o rótulo da semana fazia `fmtData(dias[5])`; com
`mostrarSabado: false` (omissão) a lista só tem 5 dias e `dias[5]` é
`undefined` → `TypeError` em cada `renderTudo()`. Efeito visível: a grelha
nunca aparecia, o indicador passava a «sem ligação» a cada sincronização de 5 s
(a exceção era apanhada pelo `catch` do `sincronizar`) e os indicadores
deixavam de atualizar após gravar. Corrigido para `dias[dias.length-1]`, com
verificação de regressão na bateria.

### P1 — «Guardar» a pasta de backup nunca funcionava
`guardarBackupCfg()` chamava `mutacao("/api/config", …)` sem método; a rota é
`PUT` e o pedido saía como `POST` → `404`. Corrigido (passa `"PUT"`), com
regressão na bateria. O mesmo defeito existia no retry da justificação em
conflito de horário (`api(rota,c2)` sem método — o `PUT /api/marcacoes/:id`
morria em `404`); corrigido para `api(rota,c2,metodo)`.

### P1 — Sincronização automática morria após F5
O cookie de sessão é `HttpOnly` e por isso não aparece em `document.cookie`; a
guarda `if(!token&&document.cookie.indexOf("sessao=")<0)return;` fazia o
`sincronizar()` (a cada 5 s) sair sem pedir nada depois de recuperar a sessão
pelo cookie. Passou a usar a flag `sessaoAtiva`, ativada no login e na
recuperação de sessão.

### P1 — «Fechar sessão» podia não fechar
`sair()` disparava o `logout` sem esperar e recarregava logo a página; a
navegação podia cancelar o pedido, o cookie ficava válido e a página
recuperava a sessão. Passou a aguardar a resposta (`await`) antes do reload.

### P2 — Grelha do calendário sem colunas
`.cal-grelha{display:grid}` sem `grid-template-columns` coloca cada célula
numa linha própria (uma única coluna): a grelha era desenhada empilhada. O
`renderCal` passa a definir `grid-template-columns` (coluna das horas + 5/6
dias).

### P2 — Cópia de segurança podia descartar utentes sem contacto
No `restaurar.js`, a validação exigia contacto não vazio, mas o contacto é
opcional no schema do servidor — uma cópia com utentes sem contacto perdia-os
em silêncio. Passou a aceitar contacto vazio (como `armazenamento.js`) e os
avisos de registos ignorados são agora impressos **antes** da confirmação.

### P2 — Edição com «justificada» sem motivo
`PUT /api/marcacoes/:id` aceitava `justificada:true` sem `motivo` quando não
era um reagendamento (POST e reagendar já recusavam). Passou a `400` nas duas
vias, com verificação de regressão.

### P2 — Outros
- `servidor.js` valida a porta indicada (antes, `node servidor.js abc`
  rebentava com `listen(NaN)`) e aceita também `PORT` (além de `PORTA`).
- `abrirEstadoUtente` deixou de rebentar quando o utente do conflito de
  duplicado ainda não está na lista local (sincroniza e avisa).
- Mudar de semana passou a atualizar também os contadores semanais
  (`renderStats`), que ficavam na semana anterior.
- Bateria: o teste de «validação de schema na carga» era vacuoso — relia o
  ficheiro original que acabara de ser restaurado, não o resultado validado.
  Passou a chamar `carregarDados()` diretamente, que é o que valida em memória.
- Documentação: README (contagem de testes, 2.ª–6.ª, duplicação «Sem CORS»,
  rotas em falta), INSTALL.md (a pasta `src/` tem de ser substituída nas
  atualizações e consta da lista de ficheiros), OPERACAO.md (local correto da
  configuração de backup).

Verificação: `node --check` em todos os ficheiros (incl. o script extraído de
`public/index.html`, agora também no CI), bateria **110/110**, `renderCal`
executado em DOM mínimo nos dois modos (5 e 6 dias) e restauro de uma cópia
com utente sem contacto (fica incluído, com aviso dos registos inválidos).

## 2026-09-29 — Correções de auditoria e integração (commits `595ba9d`, `ca378e1`)

Auditoria independente ao código publicado (leitura integral + reprodução de
cada suspeita contra um servidor a correr) encontrou três defeitos. As correções
foram feitas EM PARALELO por duas vias — `595ba9d` (a partir do relatório de
auditoria) e `ca378e1` (a auditoria, com testes de regressão) — e este último
foi integrado por rebase sobre o primeiro, mantendo a variante mais protetora
em cada ponto. Bateria final: **50 verificações, 50 a passar**.

### P0 — Marcações recusadas de março a outubro (fuso horário)
`validarData` fazia `new Date(data + "T00:00:00")` (meia-noite **local**) e
comparava com `toISOString()` (**UTC**). Nos fusos a leste de UTC — Portugal em
horário de verão — a meia-noite local corresponde ao dia anterior em UTC e
**todas as marcações eram recusadas com 400** em todo o período de DST (fim de
março a fim de outubro: a fase de marcação da campanha da gripe). A bateria
abortava ao meio neste fuso; as «44 verificações» nunca se verificavam aqui.
As duas vias corrigiram com comparações por partes imunes a fuso (local vs
`Date.UTC`); ficou a variante local (`getFullYear/getMonth/getDate`), que de
passagem recusa datas inexistentes (ex.: 30 de fevereiro).

### P1 — «Fantasma» no reagendamento
Reagendar pela interface (mudar dia/hora; o estado fica «agendado», que é o
valor pré-selecionado) criava a marcação nova **mas deixava a antiga também
como `agendado`, a ocupar a hora antiga** — bloqueava disponibilidade e inflava
as «Programadas». `595ba9d` libertou a hora forçando a antiga para `faltou`;
`ca378e1` foi mais longe, porque uma remarcação feita ao telefone **não é uma
falta**: a antiga fica **`cancelado` + `supersedidaPor` (ligada à nova)**, com
entrada no histórico, e o cliente não a conta nas «Canceladas» (`renderStats`).
Foi esta a semântica que ficou, com testes que afixam `cancelado` +
`supersedidaPor` e ausência de marcação ativa na hora antiga.

### P2 — Perda de dados com `dados.json` corrompido
Se o ficheiro de dados estivesse ilegível, o servidor avisava e **recomeçava do
zero**; a primeira gravação sobrescrevia o ficheiro antigo (dados pessoais
perdidos). Ambas as vias fazem o servidor **recusar-se a arrancar**; ficou a
variante que **preserva automaticamente** o ficheiro como
`dados.json.corrompida-<data/hora>` antes de sair (não depende de alguém o
copiar à mão a tempo).

### Mantido de `595ba9d`
- Pré-verificação de idempotência na bateria de testes (avisa quando o
  servidor já tem PIN/dados e exige servidor a correr).

### Verificação feita antes de publicar
- `node --check` nos dois ficheiros alterados; bateria completa contra
  servidor com dados frescos: **50/50**.
- Guarda de corrupção provocada: ficheiro quebrado → preservado com nome
  datado + saída com instruções.
- Fluxo real na interface (browser): entrada com PIN, criar utente, marcar
  **hoje** (data em horário de verão — o caso que o P0 bloqueava), reagendar
  pela interface → hora antiga libertada, sem fantasma, indicadores coerentes.

### Não alterado (registado para decisão futura)
- Importação `.txt` sem fallback para ficheiros ANSI/windows-1252 do Windows
  (nomes acentuados podem chegar trocados); sugerido portar do
  `agendamento_glm5.3flash`.
- Sem rate-limit no `/api/login` (aceitável em rede interna).
- Sem licença no repositório.

## 2026-09-29 — Pontos menores (segunda ronda)

Resolução dos três itens registados como «não alterado» na ronda anterior:

- **Fallback ANSI/CP1252 na importação `.txt`** (cliente): se a leitura UTF-8
  produzir caracteres de substituição (U+FFFD), o ficheiro é relido como
  `windows-1252` — ficheiros criados no Notepad antigo/Excel do Windows com
  nomes acentuados deixam de chegar trocados. (Portado do
  `agendamento_glm5.3flash`, como sugerido.)
- **Rate-limit no login/setup** (servidor): janela deslizante por IP — 6
  tentativas por 5 minutos; a 7.ª recebe `429` com tempo de espera. O login
  bem-sucedido limpa a contagem. Impede força-bruta ao PIN mesmo em LAN.
- **Licença MIT** adicionada (`LICENSE`).

Testes: 50 → **53 verificações** (bloqueio após excesso de tentativas,
persistência do bloqueio na mesma janela, presença do fallback CP1252 na
página). Bateria: **53/53** no fuso Europe/Lisbon.
