# Alterações

## 2026-09-29 — Correções de auditoria e integração (commits `595ba9d`, `ca378e1`)

Auditoria independente ao código publicadо (leitura integral + reprodução de
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
