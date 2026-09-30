# Guia de Instalação — Central de Marcações de Vacinas da Farmácia Boavista

Instruções passo-a-passo para instalar o servidor no computador do interior
da farmácia, em **Windows** e em **Linux**, incluindo arranque automático e
configuração de firewall. Os postos da frente **não precisam de instalação**
— basta um navegador.

Para a documentação geral do projeto (utilização, concorrência, segurança,
API), ver o `README.md`.

---

## Índice

- [Pré-requisitos](#pré-requisitos)
- [Obter os ficheiros do projeto](#obter-os-ficheiros-do-projeto)
- [Instalação em Windows](#instalação-em-windows)
  - [1. Instalar o Node.js](#1-instalar-o-nodejs-windows)
  - [2. Colocar o projeto](#2-colocar-o-projeto-windows)
  - [3. Arrancar e testar](#3-arrancar-e-testar-windows)
  - [4. Arranque automático (Windows)](#4-arranque-automático-windows)
  - [5. Firewall (Windows)](#5-firewall-windows)
- [Instalação em Linux](#instalação-em-linux)
  - [1. Instalar o Node.js](#1-instalar-o-nodejs-linux)
  - [2. Colocar o projeto](#2-colocar-o-projeto-linux)
  - [3. Arrancar e testar](#3-arrancar-e-testar-linux)
  - [4. Arranque automático com systemd](#4-arranque-automático-com-systemd)
  - [5. Firewall (Linux)](#5-firewall-linux)
- [Configurar os postos da frente](#configurar-os-postos-da-frente)
- [Atualizar o projeto](#atualizar-o-projeto)
- [Cópia de segurança dos dados](#cópia-de-segurança-dos-dados)
- [Verificação final (checklist)](#verificação-final-checklist)

---

## Pré-requisitos

| Componente          | Servidor (interior)              | Postos (frente)         |
|---------------------|----------------------------------|------------------------|
| Sistema             | Windows 10/11 ou Linux           | Qualquer (Windows/Linux) |
| Software            | Node.js 18+                      | Navegador moderno      |
| Rede                | Ligado à rede interna da farmácia | Ligado à mesma rede   |
| Internet            | Só para instalar/atualizar       | Não necessária         |

O servidor não tem **qualquer dependência npm** — não há `npm install`.
Só o Node.js e os ficheiros do projeto.

---

## Obter os ficheiros do projeto

Opção A — Descarregar ZIP (mais simples, sem ferramentas extra):

1. Abrir a página do repositório no GitHub;
2. Botão verde **«<> Code»** → **«Download ZIP»**;
3. Extrair o ZIP para uma pasta, por exemplo:
   - Windows: `C:\farmacia\vacinas\`
   - Linux: `/opt/farmacia/vacinas/`

Opção B — Com Git instalado:

```bash
git clone https://github.com/1400015/agendamento_vacinas.git
```

A pasta do projeto deve conter, no mínimo:

```
servidor.js
public/index.html
README.md
```

Os ficheiros `dados.json`, `config.json` e `config-pin.json` são criados
automaticamente no primeiro arranque.

---

## Instalação em Windows

### 1. Instalar o Node.js (Windows)

1. Ir a <https://nodejs.org>;
2. Descarregar a versão **LTS** (ficheiro `.msi`);
3. Executar o instalador, avançar com as opções predefinidas
   («Next» até «Install» e «Finish»);
4. Verificar a instalação: abrir o **PowerShell** ou a **linha de comandos
   (cmd)** e escrever:

   ```bat
   node --version
   ```

   Deve mostrar algo como `v22.x.x`. Se disser "não é reconhecido", fechar e
   reabrir o terminal; se persistir, reiniciar o computador.

### 2. Colocar o projeto (Windows)

Extrair/copiar os ficheiros para uma pasta fixa, por exemplo
`C:\farmacia\vacinas\`. A pasta **não deve mudar de sítio** depois do primeiro
arranque, porque é aí que ficam os dados (`dados.json`).

### 3. Arrancar e testar (Windows)

1. Abrir o PowerShell na pasta do projeto e executar:

   ```bat
   node servidor.js
   ```

2. O terminal mostra:

   ```
   Central de marcações de vacinas da Farmácia Boavista
   Servidor a correr na porta 8080.
   Neste computador:  http://localhost:8080
   Nos postos da frente: http://192.168.x.x:8080
   ```

3. Testar: abrir o navegador **neste computador** em `http://localhost:8080`
   — deve aparecer o ecrã de PIN da Farmácia Boavista. No primeiro arranque,
   o terminal mostra também o **código de arranque** (6 dígitos) necessário
   para definir o PIN; depois disso já não é preciso.

Para parar o servidor: na janela do terminal, pressionar `Ctrl + C`.

Para usar outra porta (se a 8080 estiver ocupada):

```bat
node servidor.js 9090
```

### 4. Arranque automático (Windows)

Criar o ficheiro `arrancar.bat` dentro da pasta do projeto
(`C:\farmacia\vacinas\arrancar.bat`) com o conteúdo:

```bat
@echo off
cd /d "%~dp0"
start "" /min node servidor.js
```

De seguida, adicionar à pasta de arranque:

1. Pressionar `Win + R`, escrever `shell:startup` e Enter;
2. Copiar um **atalho** do `arrancar.bat` para essa pasta;
3. Se for preciso, clicar com o botão direito no atalho → Propriedades →
   Executar: «Minimizado».

Alternativa mais robusta — Agenda de Tarefas (arranca mesmo sem início de
sessão do utilizador, se assim estiver configurado):

1. Abrir o «Agendador de Tarefas» (`taskschd.msc`);
2. «Criar Tarefa Básica...» → nome: `FarmaciaVacinas`;
3. Acionador: «Ao ligar o computador»;
4. Ação: «Iniciar um programa» → Programar: `arrancar.bat`
   (ou `node` com argumento `servidor.js` e «Iniciar em» = pasta do projeto);
5. Concluir. Testar reiniciando o computador.

### 5. Firewall (Windows)

O firewall do Windows bloqueia por omissão as ligações recebidas. Ao primeiro
arranque pode aparecer um aviso «Firewall do Windows Protegeu o PC» — marcar
**«Permitir acesso»** em redes privadas.

Se o aviso não aparecer, ou os postos não ligarem, criar a regra manualmente
(PowerShell **como Administrador**):

```powershell
New-NetFirewallRule -DisplayName "Farmacia Vacinas 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Para restringir apenas à rede da farmácia, indicar também
`-RemoteAddress 192.168.1.0/24` (ajustar à sub-rede real, por ex.
`10.0.0.0/24`).

Importante: **não** criar regra de encaminhamento (port forwarding) no router —
o servidor destina-se apenas à rede interna.

---

## Instalação em Linux

Testado em Ubuntu/Debian; os passos são semelhantes noutras distribuições.

### 1. Instalar o Node.js (Linux)

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install -y nodejs
node --version    # deve mostrar v18 ou superior
```

Se o Node dos repositórios for antigo, usar o NodeSource (Ubuntu/Debian):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Fedora/RHEL:

```bash
sudo dnf install -y nodejs
```

### 2. Colocar o projeto (Linux)

```bash
sudo mkdir -p /opt/farmacia/vacinas
sudo cp -r caminho/para/projeto/* /opt/farmacia/vacinas/
cd /opt/farmacia/vacinas
ls    # deve mostrar servidor.js e public/
```

### 3. Arrancar e testar (Linux)

```bash
cd /opt/farmacia/vacinas
node servidor.js
```

Saída esperada:

```
Central de marcações de vacinas da Farmácia Boavista
Servidor a correr na porta 8080.
Neste computador:  http://localhost:8080
Nos postos da frente: http://192.168.x.x:8080
```

Testar no próprio servidor: `http://localhost:8080`.
Parar com `Ctrl + C`.

Outra porta: `node servidor.js 9090` (ou env `PORTA`).

Descobrir o endereço IP do servidor (para usar nos postos):

```bash
hostname -I    # mostra o(s) IP(s) na rede local
```

### 4. Arranque automático com systemd

Criar o serviço (ex.: `sudo nano /etc/systemd/system/farmacia-vacinas.service`):

```ini
[Unit]
Description=Central de marcações de vacinas da Farmácia Boavista
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/farmacia/vacinas
ExecStart=/usr/bin/node servidor.js
Restart=always
RestartSec=5
User=seu_utilizador

[Install]
WantedBy=multi-user.target
```

Ajustar `User=` para um utilizador normal (não correr como root).
Ativar e arrancar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now farmacia-vacinas
sudo systemctl status farmacia-vacinas
```

Ver a saída/logs do servidor:

```bash
journalctl -u farmacia-vacinas -f
```

Reiniciar após atualização de ficheiros: `sudo systemctl restart farmacia-vacinas`.

### 5. Firewall (Linux)

Se estiver ativo o `ufw` (Ubuntu):

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp
sudo ufw status
```

(ajustar `192.168.1.0/24` à sub-rede real da farmácia)

Se estiver ativo o `firewalld` (Fedora/RHEL):

```bash
sudo firewall-cmd --add-port=8080/tcp --permanent
sudo firewall-cmd --reload
```

Não abrir a porta no router — rede interna apenas.

---

## Configurar os postos da frente

1. Descobrir o endereço do servidor (o IP mostrado no arranque, ex.:
   `http://192.168.1.50:8080`);
2. Em cada posto, abrir o navegador nesse endereço;
3. Criar atalho:
   - Windows: botão direito no ambiente de trabalho → Novo → Atalho → colar o
     endereço (começa por `http://`);
   - ou marcar a página nos favoritos;
4. No **primeiro acesso de todos** será pedido o PIN (ver secção 6 do README).
   Definir o PIN apenas uma vez, no primeiro posto; os restantes usam o mesmo
   PIN para entrar.

Conselho prático: fixar o IP do servidor (reserva DHCP no router ou IP estático)
para que o endereço dos atalhos nunca mude.

---

## Atualizar o projeto

Os registos (`dados.json`), a configuração (`config.json`) e o verificador do PIN (`config-pin.json`) vivem na pasta do projeto.
Para atualizar o código sem perder dados:

1. Parar o servidor (Ctrl+C / `systemctl stop farmacia-vacinas`);
2. Copiar `dados.json` para um local seguro (ver secção seguinte);
3. Substituir `servidor.js` e `public/index.html` pela nova versão;
4. Devolver `dados.json` à pasta (se entretanto removido);
5. Arrancar de novo o servidor.

---

## Cópia de segurança dos dados

Todo o histórico de utentes e marcações está num único ficheiro:
`dados.json` (junto ao `servidor.js`).

Recomendação: copiar `dados.json` regularmente (ex.: semanalmente, para pen
USB ou pasta na rede). Exemplos:

Windows (PowerShell):

```powershell
Copy-Item C:\farmacia\vacinas\dados.json E:\backup\dados-$(Get-Date -Format yyyyMMdd).json
```

Linux:

```bash
cp /opt/farmacia/vacinas/dados.json /mnt/pen/dados-$(date +%F).json
```

Recuperação: parar o servidor, colocar o `dados.json` guardado na pasta do
projeto e arrancar de novo.

---

## Verificação final (checklist)

Depois da instalação, confirmar:

- [ ] `node --version` responde no servidor (v18+);
- [ ] `node servidor.js` arranca sem erros e mostra os endereços;
- [ ] `http://localhost:8080` abre no próprio servidor;
- [ ] Firewall permite a porta 8080 apenas na rede interna;
- [ ] Cada posto da frente abre o endereço do servidor no navegador;
- [ ] PIN definido no primeiro acesso e conhecido pelos responsáveis;
- [ ] Marcação de teste visível em todos os postos (sincronização a 5s);
- [ ] Tentativa de sobreposição sem justificação é recusada;
- [ ] Arranque automático configurado e testado (reiniciar o servidor);
- [ ] Cópia de segurança de `dados.json` agendada;
- [ ] Nenhuma porta aberta no router para a internet.
