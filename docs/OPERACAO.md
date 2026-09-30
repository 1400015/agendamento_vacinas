# Guia de Operação — Central de Marcações de Vacinas

## Primeira Vez: Arranque Inicial

### 1. Instalar Node.js 18+

**Windows/Linux/macOS:**
- Descarregar em https://nodejs.org (LTS recomendado)
- Instalar normalmente
- Verificar: `node --version`

### 2. Extrair Projeto

- Copiar pasta `agendamento_vacinas` para servidor
- Exemplo: `C:\farmacia\agendamento_vacinas` ou `/home/farmacia/agendamento_vacinas`

### 3. Arrancar Servidor

**Windows (terminal ou PowerShell):**
```bash
cd C:\farmacia\agendamento_vacinas
node servidor.js
```

**Linux/macOS:**
```bash
cd /home/farmacia/agendamento_vacinas
node servidor.js
```

**Esperado:**
```
================================================================
  Central de Marcações de Vacinas — Farmácia Boavista
  Servidor na porta 8080  ·  horário 08:30–12:00 e 14:30–19:30 (cada 30 min)
  Máx. por hora: 2 (exceção justificada com motivo)
  Neste computador:  http://localhost:8080
  Nos postos da frente: http://192.168.1.50:8080
  Dados: /home/farmacia/agendamento_vacinas/dados.json
  Ctrl+C para parar. Não fechar esta janela durante o serviço.
================================================================

█▌ PRIMEIRO ARRANQUE: o PIN ainda não está definido.
█▌ Código de arranque (indique-o na página para definir o PIN):  123456
█▌ Ele é válido apenas enquanto o servidor não for reiniciado.
█▌ Quem tem este código controla a definição do PIN — não o partilhe.
```

### 4. Definir PIN

1. **Neste computador:** Abrir `http://localhost:8080` no browser
2. **Nos postos da frente:** Abrir `http://192.168.1.50:8080` (IP do servidor)
3. Ver página com login
4. Escrever PIN (mín. 4 caracteres) — ex.: "1234"
5. Escrever código de arranque (vê no terminal) — ex.: "123456"
6. Clicar **Definir PIN**
7. Todos os postos podem agora fazer login com este PIN

**Importante:** O PIN é único para toda a rede. Todos os postos partilham o mesmo.

---

## Operação Diária

### Login

1. Abrir no browser: `http://192.168.1.50:8080` (IP do servidor)
2. Escrever o **nome do posto** (ex.: "Balcão 1")
3. Escrever o **PIN**
4. Clicar **Entrar**
5. Sessão válida por **8 horas** (cookie é guardado)

### Adicionar Utente

**Aba Utentes:**
1. Clicar **Novo Utente**
2. Preencher: Nome, Contacto (telefone ou email), Vacina (G / C / G+C)
3. (Opcional) Observações
4. Clicar **Adicionar**

### Importar Lote de Ficheiro TXT

**Aba Utentes:**
1. Clicar **Importar .txt**
2. Selecionar ficheiro (formato: `Nome; Contacto; Vacina`)
3. Ver relatório: quantos inseridos, quantos duplicados, quantos inválidos
4. Confirmado → passam a estar no sistema

**Formato do ficheiro:**
```
Maria Fernandes; 912 345 678; G
João Santos; joao@email.pt; C
Ana Rodrigues; 934 567 890; G+C
```

### Marcar Vacina

**Aba Utentes:**
1. Clique num utente na lista
2. Clicar **Marcar**
3. Selecionar **data e hora**
4. Selecionar **vacina(s)**
5. Se hora está ocupada e sem justificação → escrever motivo
6. Clicar **Guardar**

**OU Aba Calendário:**
1. Selecionar semana (Anterior / Atual / Próxima)
2. Clicar numa **célula vazia** (dia + hora)
3. Selecionar utente
4. Clicar **Agendar**

### Alterar Estado de Marcação

**Estados disponíveis:**
- **Agendado** — marcação confirmada, à espera
- **Administrado** — vacina foi dada (conta nos indicadores semanais)
- **Faltou** — utente não apareceu (hora fica livre, pode ligar novamente)
- **Cancelado** — utente cancelou (hora fica livre)

**Para alterar:**
1. Aba Calendário → clicar na marcação (cor)
2. Clicar **Alterar Estado**
3. Selecionar novo estado
4. Clicar **Guardar**

### Reagendar Marcação

1. Aba Calendário → clicar na marcação
2. Clicar **Reagendar**
3. Selecionar **nova data e hora**
4. Clicar **Guardar**
5. Marcação antiga liberta-se (não fica como cancelada nos contadores)

---

## Resolução de Problemas

### Postos não conseguem abrir a página

**Checklist:**
1. Servidor está a correr? (terminal deve estar aberto)
2. IP está correto? (ex.: `http://192.168.1.50:8080` e não `192.168.1.51`)
3. Mesma rede? (WiFi? Cabo?)
4. Firewall? Pode ser preciso permitir porta 8080

**Para descobrir o IP:**
- **Windows:** Terminal → `ipconfig` → "IPv4 Address" (começa por 192.168.x.x)
- **Linux:** Terminal → `hostname -I`

**Permitir Firewall (Windows):**
1. Abrir Windows Defender Firewall
2. "Permitir aplicações através da firewall"
3. Encontrar Node.js → marcar ambos (Privado + Público)

### PIN Esquecido

**Se todos os postos esqueceram:**
1. Parar o servidor (Ctrl+C no terminal)
2. Apagar ficheiro `config-pin.json` (que fica junto ao servidor)
3. Arrancar servidor de novo
4. Novo código de arranque aparece no terminal
5. Definir novo PIN

**Nota:** Dados de utentes (`dados.json`) NÃO são afetados.

### Dados Desapareceram

**Se arrancar e mensagem "FICHEIRO DE DADOS ILEGÍVEL":**
1. Servidor PARA e recusa arrancar
2. Ficheiro é preservado como `dados.json.corrompida-<data>`
3. Restaurar a última cópia de segurança:

```bash
node restaurar.js                    # lista cópias
node restaurar.js backups/dados.backup-2025-09-30.json
# Escrever RESTAURAR para confirmar
```

**Se não houver backups:**
1. Contactar suporte — ficheiro pode ser recuperável

### Porta 8080 Já em Uso

Se outra aplicação está a usar porta 8080:

```bash
node servidor.js 9090    # Arrancar em porta 9090
# Depois: http://192.168.1.50:9090
```

### Popup Bloqueada na Exportação PDF

Alguns browsers bloqueiam popups:
1. Permitir popups para `http://192.168.1.50:8080`
2. Tentar de novo

---

## Backup e Segurança

### Backup Automático

- **Diário**: Cópia automática de dados.json é criada em `backups/` (ou outro local configurado)
- **Formato:** `dados.backup-YYYY-MM-DD.json`
- **Mantém:** Últimas 7 cópias (mais antigas são apagadas automaticamente)
- **Falhas nunca bloqueiam:** Se o backup falhar, o servidor continua a funcionar (log registado)

### Onde Está o Backup

**Local (padrão):**
```
./backups/dados.backup-2025-09-30.json
./backups/dados.backup-2025-09-29.json
...
```

**Rede (configurável):**
1. Aba Configuração (na interface)
2. Escrever caminho: `\\SERVIDOR\compartilha\backups`
3. Clicar **Testar** para verificar se funciona
4. Clicar **Guardar**

### Como Restaurar

**Passo-a-passo:**

1. Parar o servidor (Ctrl+C no terminal onde corre)

2. Abrir terminal na pasta do servidor:
   ```bash
   cd C:\farmacia\agendamento_vacinas    # Windows
   # OU
   cd /home/farmacia/agendamento_vacinas # Linux
   ```

3. Listar backups:
   ```bash
   node restaurar.js
   ```
   
   Verá algo como:
   ```
   Cópias de segurança locais (mais recentes primeiro):

     ./backups/dados.backup-2025-09-30.json   (45.2 KB, 30/09/2025 10:22)
     ./backups/dados.backup-2025-09-29.json   (44.8 KB, 29/09/2025 15:30)
     ...
   ```

4. Restaurar a cópia desejada:
   ```bash
   node restaurar.js ./backups/dados.backup-2025-09-30.json
   ```
   
   Pedirá confirmação:
   ```
   Cópia válida: 245 utentes, 1830 marcações.
   
   Vai substituir /home/farmacia/agendamento_vacinas/dados.json pelos dados da cópia.
   Escreva RESTAURAR para confirmar: 
   ```

5. Escrever **RESTAURAR** (maiúsculas)

6. Ficheiro anterior fica guardado como `dados.json.antes-restauro`

7. Arrancar servidor de novo:
   ```bash
   node servidor.js
   ```

---

## Log Operacional

**Ficheiro:** `servidor.log` (junto ao servidor)

Contém:
- Arranques do servidor
- Erros de I/O (ficheiros corrompidos, permissões)
- Falhas de backup
- Tentativas de login falhadas
- Rate-limit (múltiplas tentativas de PIN erradas)

**Formato:**
```
[2025-09-30T08:27:58.123Z] INFO PIN definido pelo posto Balcão 1
[2025-09-30T08:28:15.456Z] AVISO login falhado do posto Balcão 2 (192.168.1.20)
[2025-09-30T12:00:00.789Z] INFO backup OK: ./backups/dados.backup-2025-09-30.json
```

**Rotação:** Quando ultrapassa 5 MB, ficheiro passa a `servidor.log.antigo`

**Para ver os últimos erros:**
- Windows: `type servidor.log | findstr ERRO`
- Linux: `grep ERRO servidor.log | tail -20`

---

## Auditoria

**Ficheiro:** Integrado em `dados.json` (campo `historico`)

Contém:
- Quem criou/editou/eliminou utentes
- Quem fez marcações
- Quem reagendou
- Quando (data/hora)
- Que posto (ex.: "Balcão 1")

**Ver auditoria:**
- Aba Histórico (interface)
- Últimas 500 operações
- Ordenadas por mais recentes primeiro

---

## Configuração Avançada

**Ficheiro:** `config.json` (gerado automaticamente)

```json
{
  "maxPorHora": 2,           // máx. marcações simultâneas por hora
  "horaInicio": "08:30",     // início da manhã
  "horaFim": "12:00",        // fim da manhã
  "horaInicio2": "14:30",    // início da tarde
  "horaFim2": "19:30",       // fim da tarde
  "intervaloMin": 30,        // 15, 30 ou 60 minutos
  "mostrarSabado": false,    // grelha de 2.ª a 6.ª (sábado/domingo nunca aceitam marcações)
  "pastaBackup": ""          // pasta de backup (rede ou local)
}
```

**Editar:**
1. Parar servidor
2. Abrir `config.json` em editor de texto
3. Modificar valores
4. Guardar
5. Arrancar servidor

**Exemplo: Horário diferente**
```json
{
  "horaInicio": "08:00",
  "horaFim": "12:30",
  "horaInicio2": "14:00",
  "horaFim2": "17:00",
  "intervaloMin": 15
}
```

**Exemplo: Backup na rede**
```json
{
  "pastaBackup": "\\\\SERVIDOR\\compartilha\\backups"
}
```

---

## Manutenção Periódica

### Semanal
- [ ] Verificar se `servidor.log` tem erros (grep ERRO)
- [ ] Confirmar último backup (ls backups/ -lrt)

### Mensal
- [ ] Copiar pasta `backups/` para pen USB ou nuvem
- [ ] Testar restauro numa pasta de teste
- [ ] Revisar auditoria (aba Histórico)

### Anual
- [ ] Atualizar Node.js se há segurança updates
- [ ] Arquivar backups antigos (2 anos atrás)
- [ ] Revisar `config.json` (horários, maxPorHora)

---

## Segurança

### Recomendações

1. **PIN**: Mínimo 4 caracteres, memorável só para responsável
2. **Firewall**: Porta 8080 acessível APENAS na rede interna
3. **Rede**: Não expor para internet (sem VPN)
4. **Backups**: Manter cópia física fora do servidor (pen USB)
5. **Permissões**: Só responsável tem acesso ao terminal do servidor

### O que o sistema protege

✅ PIN nunca é guardado em claro (PBKDF2 + AES-256-GCM)  
✅ Dados de utentes nunca saem da rede interna  
✅ Sessões de 8h (automaticamente expiram)  
✅ Rate-limit: máx. 6 tentativas por IP em 5 minutos (força-bruta impossível)  
✅ Auditoria completa (quem fez o quê, quando, de onde)  
✅ Backup automático (recuperação de acidentes)  

---

## Contacto e Suporte

Se encontrar problemas:

1. Verificar `servidor.log` para mensagens de erro
2. Consultar "Resolução de Problemas" acima
3. Se dados parecem corrompidos: **NÃO REINICIAR O SERVIDOR**
   - O servidor recusa arrancar para evitar sobrescrita
   - Contactar suporte antes de restaurar

---

**Versão:** 1.0 (Setembro 2025)  
**Última atualização:** 2025-09-30
