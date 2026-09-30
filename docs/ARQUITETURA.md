# Arquitetura — Central de Marcações de Vacinas

## Visão Geral

O servidor é construído em **Node.js puro**, dividido em módulos especializados, com um ponto de entrada fino (`servidor.js`) que orquestra o fluxo de requisições HTTP.

```
┌─────────────────────────────────────────────────────────────┐
│  servidor.js (106 linhas) — Ponto de Entrada                │
│  ├─ Setup modules (util, config, armazenamento, autenticacao)
│  ├─ Carregar dados + config
│  ├─ Criar listener HTTP
│  └─ Delegar requisições para API
└─────────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│  Fluxo de Requisição HTTP                                   │
│                                                              │
│  1. Pedido chega → verificar se é /api/...                  │
│  2. Ler corpo da requisição (JSON)                           │
│  3. Chamar criarApi(contexto)(req, res, corpo)              │
│  4. API roteia e aplica lógica de negócio                   │
│  5. Resposta JSON com cabeçalhos de segurança               │
└─────────────────────────────────────────────────────────────┘
         ↓
┌──────────────────────────────┬──────────────────────────────┐
│  Módulos Transversais        │  Módulos de Negócio          │
├──────────────────────────────┼──────────────────────────────┤
│ • util.js (89 linhas)        │ • api.js (349 linhas)        │
│   - Validações               │   - Rotas HTTP               │
│   - Normalizações            │   - Lógica de negócio        │
│   - Log operacional          │   - Concorrência             │
│                              │   - Conflitos                │
│ • autenticacao.js (123 linhas)                              │
│   - PIN (PBKDF2+AES-256-GCM)                                │
│   - Código de arranque                                      │
│   - Sessões (8h)                                            │
│   - Rate-limit (janela deslizante)                          │
│                              │                               │
│ • armazenamento.js (92 linhas)                              │
│   - Carregamento com validação de schema                    │
│   - Persistência atómica                                    │
│   - Proteção contra corrupção                               │
│                              │                               │
│ • config.js (89 linhas)                                     │
│   - Carregamento com validação                              │
│   - Config.json corrompido → preserva + pára               │
│   - Geração de horários                                     │
│                              │                               │
│ • backup.js (63 linhas)                                     │
│   - Cópia diária rotativa                                   │
│   - Teste de pasta de backup                                │
│   - Injeção de dependências (evita ciclos)                  │
└──────────────────────────────┴──────────────────────────────┘
```

---

## Fluxo Detalhado de uma Requisição

### Exemplo: POST /api/marcacoes (marcar uma vacina)

```
1. Cliente envia:
   POST /api/marcacoes
   { baseVersao: 42, utenteId: "...", data: "2025-09-22", ... }

2. servidor.js recebe → buffer do corpo
   ├─ Acumula chunks até 5 MB
   └─ Se exceder → 413 Payload Too Large (não rebenta o servidor)

3. Parse JSON → passa para criarApi(contexto)(req, res, corpo)

4. api.js rota POST /api/marcacoes:
   ├─ Chamar A.sessaoDe(req) → verificar autenticação
   ├─ Chamar baseVersaoOk() → verificar conflito de versão
   ├─ Validar data e hora (util.js)
   ├─ Verificar overlaps (ocupantes)
   ├─ Inserir marcação em dados.marcacoes
   ├─ Chamar gravar():
   │  ├─ Incrementar versão
   │  ├─ Chamar persistir(dados) → armazenamento.js
   │  │  └─ Escrita atómica (tmp + rename)
   │  ├─ Chamar backupAuto() → backup.js
   │  │  └─ Cópia não bloqueia (falha vai para log)
   │  └─ Responder 200 com dados novos
   └─ Se conflito → responder 409 com estado atual

5. Cliente recebe resposta com:
   ├─ versao, utentes[], marcacoes[], config
   └─ Cabeçalhos: X-Frame-Options: DENY, CSP, etc.
```

### Exemplo: GET /api/dados (sincronizar com o servidor)

```
1. Cliente envia:
   GET /api/dados?versao=42

2. api.js:
   ├─ Se versao na query == dados.versao atual
   │  └─ Responder 304 Not Modified (poll leve)
   └─ Senão → responder 200 com estado completo

3. Cliente sabe se houve mudanças SEM baixar dados inteiros
   (Importante para sincronização de 5 segundos em tempo real)
```

---

## Módulos — Responsabilidades

### `servidor.js` (106 linhas) — Orquestrador

**Responsabilidade:** Setup e listeners HTTP, nada de lógica.

```javascript
1. Importar módulos
2. Chamar carregarConfig() → config.js
3. Chamar carregarDados() → armazenamento.js
4. Gerar horários a partir da config
5. Mostrar código de arranque se PIN não estiver definido
6. Criar listener HTTP na porta (padrão 8080)
7. Delegar /api/* para criarApi(contexto)
8. Servir ficheiros estáticos de public/
```

**Contexto injetado em api.js:**
```javascript
{
  dados,              // estado completo em memória
  cfg,                // config.json (horários, maxPorHora, etc.)
  horas,              // horas válidas nos dias úteis
  horasSabado,        // horas válidas ao sábado (períodos próprios, mais curtos)
  persistir,          // função para escrever dados.json
  registar,           // função para auditoria
  backupAuto          // função para fazer backup automático
}
```

### `util.js` (89 linhas) — Funções Transversais

**Responsabilidades:**
- **Validações:** `validarData()`, `validarHoraTexto()`
- **Normalizações:** `normalizarVac()` (G/GRIPE/FLU → G), `normalizarSlots()`
- **Chaves:** `chaveUtente()` (normaliza nome+contacto para busca de duplicados)
- **Log operacional:** `logOp(nivel, msg)` — erros de I/O, backups, autenticação
- **Constantes:** `ESTADOS`, `OCUPAM` (estados que bloqueiam horário)

**Exemplo de uso:**
```javascript
const vac = U.normalizarVac("GRIPE");  // → "G"
const data = U.validarData("2025-09-22");  // → "2025-09-22" ou null
U.logOp("ERRO", "backup falhou: Permission denied");
```

### `autenticacao.js` (123 linhas) — PIN, Sessões, Rate-Limit

**Responsabilidades:**

1. **PIN (PBKDF2 + AES-256-GCM)**
   - `definirPin(pin)` — Cria sal + IV + verificador (nunca guarda PIN)
   - `verificarPin(pin)` — Retorna `true`, `false` ou `"corrompido"`

2. **Código de Arranque**
   - `gerarCodigoArranque()` — Gera 6 dígitos, imprime no terminal
   - `apagarCodigoArranque()` — Apaga após PIN definido
   - `codigoArranqueAtual()` — Retorna código atual

3. **Sessões (8h em memória)**
   - `novaSessao(posto)` — Cria token aleatório de 48 caracteres
   - `sessaoDe(req)` — Valida token (Bearer header ou cookie)
   - `tokenDe(req)` — Extrai token de Authorization ou cookies
   - Cleanup automático: sessões expiradas apagadas a cada 10 minutos

4. **Rate-Limit (Janela Deslizante)**
   - 6 tentativas por IP em janela de 5 minutos
   - `rateLimitPermitir(req)` — Retorna `{ok, espera}`
   - `rateLimitLimpar(req)` — Reseta após login bem-sucedido
   - `logOp()` quando bloqueado

### `armazenamento.js` (92 linhas) — Persistência com Validação

**Responsabilidades:**

1. **Carregamento com Validação de Schema**
   - `validarUtente(u, avisos)` — Verifica id, nome, contacto, vacina, rev
   - `validarMarcacao(m, idsUtentes, avisos)` — Verifica referências + tipos
   - Normaliza silenciosamente campos inválidos (ex.: vacina → G)
   - Avisos detalhados em servidor.log e stderr

2. **Proteção contra Corrupção**
   - Se dados.json ilegível → preserva como .corrompida-<timestamp>
   - Servidor recusa arrancar (impede sobrescrita acidental)
   - Mensagem clara: restaurar via `restaurar.js`

3. **Persistência Atómica**
   - Escreve em ficheiro temporário (tmp)
   - Muda permissões para 0o600 (dados de saúde)
   - Rename atómico (dados.json.tmp → dados.json)
   - Protege contra falha de energia ou crash

### `config.js` (89 linhas) — Configuração e Horários

**Responsabilidades:**

1. **Carregamento com Validação**
   - Se config.json ilegível → preserva + pára (como dados.json)
   - Campos inválidos → usa defeito (ex.: horaInicio "25:00" → "08:30")
   - Valida períodos: cada um (manhã e tarde) tem de ter pelo menos um slot; senão usa 08:30–12:00 e 14:30–19:30

2. **Defaults**
   ```javascript
   {
     maxPorHora: 2,              // máx. marcações simultâneas por hora
     horaInicio: "08:30",        // início da manhã
     horaFim: "12:00",           // fim da manhã
     horaInicio2: "14:30",      // início da tarde
     horaFim2: "19:30",         // fim da tarde
     sabadoInicio: "09:30",      // períodos PRÓPRIOS do sábado (mais curtos)
     sabadoFim: "12:00",
     sabadoInicio2: "15:00",
     sabadoFim2: "17:00",
     intervaloMin: 30,           // 15, 30 ou 60 minutos
     mostrarSabado: true,        // mostra a coluna do sábado na grelha
     pastaBackup: ""             // pasta de backup (rede ou local)
   }
   ```
   Fora dos períodos de sábado o servidor recusa marcações (`400`); o domingo
   não tem horário nenhum. Os períodos de sábado têm validação própria (se
   ficarem sem slots válidos, volta-se a 09:30–12:00 / 15:00–17:00).

3. **Geração de Horários**
   - `gerarHoras(cfg)` — Array de strings dos dois períodos ["08:30", "09:00", …, "12:00", "14:30", …, "19:30"]
   - `gerarHorasSabado(cfg)` — o mesmo para os dois períodos do sábado (por omissão ["09:30", …, "12:00", "15:00", …, "17:00"])
   - `api.js` usa `horasDoDia(data)` (sábado → `horasSabado`, restantes → `horas`) na validação de cada marcação e reagendamento

### `backup.js` (63 linhas) — Cópia Diária Rotativa

**Responsabilidades:**

1. **Backup Automático**
   - Cópia diária de dados.json
   - Nome: `dados.backup-YYYY-MM-DD.json`
   - Mantém 7 cópias mais recentes
   - Uma falha NUNCA bloqueia gravação de dados

2. **Pasta Configurável**
   - Se `cfg.pastaBackup` vazio → pasta local `./backups`
   - Se preenchido → rede interna (ex.: `\\POSTO\compartilha\`)

3. **Injeção de Dependências**
   - `usarFicheiroDados(caminho)` — Regista caminho de leitura
   - `persistirDados()` — Retorna caminho registado
   - Evita ciclo de dependência com armazenamento.js
   - **Linha 30:** `fs.copyFileSync(persistirDados(), ficheiro)` 
     - `persistirDados()` retorna o caminho em `_ficheiroDados`

4. **Teste de Pasta**
   - `testarPasta(cfg)` — Cria ficheiro, lê, apaga
   - Retorna `{ok, pasta, erro}`
   - Usado pela interface para validar antes de configurar

### `api.js` (349 linhas) — Lógica de Negócio

**Responsabilidades:** Todas as rotas HTTP e regras de negócio.

#### Rotas Públicas (sem autenticação)
- `GET /api/estado` — PIN definido? config, horas
- `POST /api/setup` — Definir PIN inicial (exige código de arranque)
- `POST /api/login` — Login com PIN (rate-limit)

#### Rotas Autenticadas
- `GET /api/dados` — Estado completo (com 304 sem corpo se a versão for igual)
- `GET /api/historico` — Últimas 500 operações (auditoria)
- `GET /api/horas` — Horários válidos (`horas` para dias úteis e `horasSabado`)

#### Utentes
- `POST /api/utentes` — Criar
- `PUT /api/utentes/:id` — Editar
- `DELETE /api/utentes/:id` — Apagar (+ todas as marcações)
- `POST /api/importar` — Batch import de TXT

#### Marcações
- `POST /api/marcacoes` — Criar (valida o dia/hora pelo horário do dia — sábado reduzido — e verifica overlap)
- `PUT /api/marcacoes/:id` — Alterar estado / reagendar
- `DELETE /api/marcacoes/:id` — Apagar

#### Config e Backup
- `PUT /api/config` — Alterar pasta de backup
- `POST /api/backup/testar` — Testar escrita na pasta
- `POST /api/backup` — Forçar backup manual
- `GET /api/exportar` — Download JSON para cópia de segurança

---

### `public/index.html` + `public/app.js` — Cliente (interface)

O cliente é servido em dois ficheiros: a marcação e os estilos em
`index.html` e o comportamento em `app.js` (carregado com
`<script src="/app.js">`). O JavaScript da página passa assim a ser
validável (`node --check`), testável (`testes-cliente.js`, em DOM mínimo) e
legível fora do meio do HTML.

Regras por dia aplicadas no cliente (a par da validação do servidor):

- `diaDaSemanaISO(data)` — 0 = domingo … 6 = sábado, por partes da data
  (imune ao fuso, como `util.js`);
- `horasDoDia(data)` — horário normal (`horas`) ou o do sábado (`horasSabado`,
  recebido em `/api/dados`, `/api/estado` e `/api/horas`);
- `celulaDisponivel(data, hora)` — usado pela grelha: fora dos períodos do dia
  a célula fica indisponível (não clicável);
- `confirmarDia(data, acao)` — bloqueia o domingo e pede confirmação no sábado
  («por norma não se vacina ao sábado»), tanto ao marcar como ao reagendar.

---

## Padrões de Design

### 1. **Contexto Injetado**
Em vez de módulos se importarem entre si (ciclos), `servidor.js` cria um contexto passado a `api.js`:

```javascript
const ctx = {
  dados, cfg, horas, horasSabado, persistir, registar, backupAuto
};
const api = criarApi(ctx);
// Depois: api(req, res, corpo)
```

**Benefício:** Sem dependências circulares, testes unitários mais fáceis.

### 2. **Validação Multi-Camada**
```
Input → API (tipo, tamanho) → util.js (formato) → armazenamento.js (schema)
```
- API valida tipos básicos ("é string?")
- util.js valida formato ("é data YYYY-MM-DD?")
- armazenamento.js valida integridade ("id existe? estado é válido?")

### 3. **Log Operacional ≠ Auditoria**
- **Log operacional** (servidor.log): erros de I/O, backups, autenticação
- **Auditoria** (dados.historico): "João criou utente Maria" — é negócio

Estão **separados** porque têm ciclos de vida diferentes.

### 4. **Escrita Atómica**
Todas as mutações seguem:
```javascript
1. Verificar versão global (detecta "outro posto gravou")
2. Verificar rev do registo (detecta "este registo mudou")
3. Modificar em memória
4. Incrementar versão
5. persistir(dados) — escrita tmp + rename
6. backupAuto() — não bloqueia se falhar
7. Responder 200 com novo estado
```

Nunca há estado "meio-gravado".

### 5. **Horário de Verão (Timezone)**
```javascript
// ERRADO (converte local para UTC, perde hora em DST):
const dt = new Date("2025-03-22").toISOString();

// CORRETO (compara partes, imune a DST):
const [a, m, d] = v.split("-").map(Number);
const dt = new Date(a, m - 1, d);
if (dt.getFullYear() !== a || ...) return null;
```

Por isso o CI roda com `TZ: Europe/Lisbon`.

---

## Fluxo de Dados na Memória

```
dados = {
  versao: 42,                // incrementa a cada mutação
  schema: 2,                 // versão de schema para migrações
  utentes: [
    { id, nome, contacto, vacina, obs, rev, criadoEm, criadoPor, atualizadoEm }
  ],
  marcacoes: [
    { id, utenteId, data, hora, vacinas: ["G"], 
      estado: "agendado",     // agendado, administrado, faltou, cancelado
      justificada: false,
      motivo: "",
      rev: 1,
      criadoEm, criadoPor,
      atualizadoEm,
      historico: [{ quando, acc, posto }],
      supersedidaPor: null    // se reagendado, aponta à nova
    }
  ],
  historico: [               // últimas 5000 operações
    { quando, posto, acao, alvo, detalhe }
  ],
  ultimoBackup: "2025-09-22" // data do último backup
}
```

---

## Tratamento de Erros

### Dados Corrompidos
1. **dados.json ilegível**
   - Preservar como `dados.json.corrompida-2025-09-30T08-27-58Z`
   - Logar: `logOp("ERRO", "dados.json ilegível...")`
   - Parar servidor (não sobrescrever)
   - Instruir: restaurar via `restaurar.js`

2. **config.json ilegível**
   - Preservar como `config.json.corrompida-...`
   - Parar servidor (nunca regravar por cima da configuração do utilizador)

3. **config.json com valores inválidos** (legível, mas fora do esperado)
   - Avisar em log + stderr e usar o defeito de cada campo
   - Reescrever já o ficheiro corrigido — não trava o arranque

4. **Registo inválido durante carregamento**
   - Normalizar silenciosamente
   - Avisar em log + stderr
   - Continuar carregamento

### Conflitos Operacionais
- **Versão desatualizada (409):** Outro posto gravou, cliente recebe estado novo
- **Registo modificado (409):** Este utente/marcação mudou, cliente re-tenta
- **Slot ocupado (409):** Hora já tem máximo de marcações, rejeitar ou exigir justificação

---

## Checklist de Testes

Para validar a arquitetura:

- [x] CI executa `node --check` em todos os ficheiros
- [x] CI executa bateria com `TZ: Europe/Lisbon`
- [x] Teste: dados.json corrompido → servidor recusa arrancar
- [x] Teste: config.json corrompido → servidor recusa arrancar
- [x] Teste: backup falha → gravação continua, log registado
- [x] Teste: PIN com PBKDF2 nunca fica em claro no config-pin.json
- [x] Teste: rate-limit bloqueia após 6 tentativas (429)
- [x] Teste: datas em DST (março-outubro Portugal) são aceites
- [x] Teste: reagendamento liberta a hora antiga (não deixa fantasma)
- [x] Teste: `restaurar.js` valida schema antes de restaurar
- [x] Teste: marcação ao sábado só nos períodos 09:30–12:00 / 15:00–17:00 e domingo recusado (400)
- [x] Teste: config.json inválida → avisa, volta aos defeitos e corrige o ficheiro; ilegível → preserva e trava o arranque
- [x] Teste: backup.js copia o ficheiro de dados injetado por `usarFicheiroDados()` (não o `dados.json` por omissão)
- [x] Testes de interface: `public/app.js` executado em DOM mínimo (46 verificações)
