"use strict";
/* backup.js — cópia diária rotativa de dados.json para a pasta configurada
   (rede interna) ou local «backups». Mantém as 7 mais recentes. Falha de
   backup NUNCA bloqueia a gravação — vai para o log e para o histórico.  */
const fs = require("fs");
const path = require("path");
const { RAIZ, logOp, agora } = require("./util");

const RE_BACKUP = /^dados\.backup-\d{4}-\d{2}-\d{2}\.json$/;
const BACKUP_COPIAS = 7;

function pastaBackupEfetiva(cfg) {
  const p = String(cfg.pastaBackup || "").trim();
  return p ? p : path.join(RAIZ, "backups");
}

function dataLocalArquivo() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* registo é injetado para evitar dependência circular com armazenamento */
function backupAuto(dados, cfg, persistir, registar, forcar) {
  const hoje = dataLocalArquivo();
  if (!forcar && dados.ultimoBackup === hoje) return { ok: true, hoje: true, ficheiro: null };
  const pasta = pastaBackupEfetiva(cfg);
  const ficheiro = path.join(pasta, "dados.backup-" + hoje + ".json");
  try {
    fs.mkdirSync(pasta, { recursive: true });
    fs.copyFileSync(persistirDados(), ficheiro);
    const todos = fs.readdirSync(pasta).filter(f => RE_BACKUP.test(f)).sort();
    while (todos.length > BACKUP_COPIAS) fs.unlinkSync(path.join(pasta, todos.shift()));
    dados.ultimoBackup = hoje;
    persistir(dados);
    registar("servidor", "backup", ficheiro, forcar ? "cópia manual" : "cópia diária automática");
    return { ok: true, hoje: false, ficheiro };
  } catch (e) {
    logOp("ERRO", "backup falhou (" + pasta + "): " + e.message);
    console.error("BACKUP FALHOU (" + pasta + "):", e.message);
    registar("servidor", "backup", pasta, "FALHOU: " + e.message);
    return { ok: false, erro: e.message };
  }
}
/* o ficheiro de dados é lido do disco (cópia fiel ao que está persistido) */
let _ficheiroDados = null;
function usarFicheiroDados(f) { _ficheiroDados = f; }
function persistirDados() { return _ficheiroDados; }

function testarPasta(cfg) {
  const pasta = pastaBackupEfetiva(cfg);
  const ficheiro = path.join(pasta, ".teste-backup-" + Date.now());
  try {
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(ficheiro, "teste");
    fs.readFileSync(ficheiro, "utf8");
    fs.unlinkSync(ficheiro);
    return { ok: true, pasta };
  } catch (e) {
    return { ok: false, pasta, erro: e.message };
  }
}

module.exports = { BACKUP_COPIAS, pastaBackupEfetiva, dataLocalArquivo, backupAuto, testarPasta, usarFicheiroDados };
