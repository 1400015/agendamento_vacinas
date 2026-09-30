"use strict";
/* armazenamento.js — carga/persistência de dados.json com validação de
   schema por registo (edição manual acidental não entra no sistema),
   escrita atómica e proteção contra ficheiros corrompidos.               */
const fs = require("fs");
const path = require("path");
const { RAIZ, logOp, lerJSONcBOM, validarData, validarHoraTexto, normalizarSlots, normalizarVac, ESTADOS } = require("./util");

const FICHEIRO_DADOS = path.join(RAIZ, "dados.json");

const SCHEMA = 2;   // versão de schema: 1 = original, 2 = validação por registo

/* valida um utente: campos obrigatórios com tipos certos; normaliza o resto */
function validarUtente(u, avisos) {
  if (!u || typeof u !== "object") { avisos.push("utente não-objeto ignorado"); return null; }
  if (typeof u.id !== "string" || !u.id) { avisos.push("utente sem id ignorado"); return null; }
  if (typeof u.nome !== "string" || !u.nome.trim()) { avisos.push(`utente ${u.id.slice(0, 8)} sem nome ignorado`); return null; }
  if (typeof u.contacto !== "string" || !u.contacto.trim()) { avisos.push(`utente ${u.nome} sem contacto ignorado`); return null; }
  const vacina = normalizarVac(u.vacina);
  if (!vacina) { avisos.push(`utente ${u.nome} com vacina inválida — assumida G`); }
  return Object.assign({}, u, {
    nome: u.nome.trim(), contacto: u.contacto.trim(),
    vacina: vacina || "G",
    obs: typeof u.obs === "string" ? u.obs : "",
    rev: Number.isInteger(u.rev) && u.rev > 0 ? u.rev : 1
  });
}

/* valida uma marcação: mantém só o que faz sentido; o resto é sinalizado */
function validarMarcacao(m, idsUtentes, avisos) {
  if (!m || typeof m !== "object") { avisos.push("marcação não-objeto ignorada"); return null; }
  if (typeof m.id !== "string" || !m.id) { avisos.push("marcação sem id ignorada"); return null; }
  if (!idsUtentes.has(m.utenteId)) { avisos.push(`marcação de utente inexistente ignorada (${m.id.slice(0, 8)})`); return null; }
  if (!validarData(m.data)) { avisos.push(`marcação ${m.id.slice(0, 8)} com data inválida ignorada`); return null; }
  if (!validarHoraTexto(m.hora)) { avisos.push(`marcação ${m.id.slice(0, 8)} com hora inválida ignorada`); return null; }
  const estado = ESTADOS.includes(m.estado) ? m.estado : "agendado";
  if (!ESTADOS.includes(m.estado)) avisos.push(`marcação ${m.id.slice(0, 8)} com estado inválido — assumida agendado`);
  return Object.assign({}, m, {
    vacinas: normalizarSlots(m.vacinas),
    estado,
    justificada: !!m.justificada,
    motivo: typeof m.motivo === "string" ? m.motivo : "",
    rev: Number.isInteger(m.rev) && m.rev > 0 ? m.rev : 1,
    historico: Array.isArray(m.historico) ? m.historico : []
  });
}

function carregarDados() {
  try {
    const j = lerJSONcBOM(FICHEIRO_DADOS);
    const avisos = [];
    const utentesBrutos = Array.isArray(j.utentes) ? j.utentes : [];
    const utentes = utentesBrutos.map(u => validarUtente(u, avisos)).filter(Boolean);
    const idsUtentes = new Set(utentes.map(u => u.id));
    const marcacoes = (Array.isArray(j.marcacoes) ? j.marcacoes : [])
      .map(m => validarMarcacao(m, idsUtentes, avisos)).filter(Boolean);
    const historico = Array.isArray(j.historico) ? j.historico : [];
    const dados = {
      versao: Number.isInteger(j.versao) ? j.versao : 1,
      schema: SCHEMA,
      utentes, marcacoes, historico,
      ultimoBackup: typeof j.ultimoBackup === "string" ? j.ultimoBackup : undefined
    };
    if (avisos.length) {
      logOp("AVISO", "validação de dados.json: " + avisos.length + " registo(s) corrigido(s)/ignorado(s): " + avisos.slice(0, 5).join("; "));
      console.error("AVISO: dados.json continha " + avisos.length + " registo(s) inválido(s) — corrigidos ou ignorados (detalhe em servidor.log).");
    }
    return dados;
  } catch (e) {
    if (e.code === "ENOENT") return { versao: 1, schema: SCHEMA, utentes: [], marcacoes: [], historico: [] };
    // nunca recomeçar do zero por cima de dados possivelmente recuperáveis
    // (utentes = dados pessoais): preservar o ficheiro e parar
    const preservado = FICHEIRO_DADOS + ".corrompida-" + new Date().toISOString().replace(/[:.]/g, "-");
    try { fs.renameSync(FICHEIRO_DADOS, preservado); } catch (e2) {}
    logOp("ERRO", "dados.json ilegível: " + e.message + " — preservado como " + preservado);
    console.error("FICHEIRO DE DADOS ILEGÍVEL (" + e.message + ")");
    console.error("Foi preservado como: " + preservado);
    console.error("O servidor NÃO arranca para não apagar dados — restaure a última");
    console.error("cópia de segurança para dados.json (ver INSTALL.md) e volte a arrancar.");
    process.exit(1);
  }
}

function persistir(dados) {
  const tmp = FICHEIRO_DADOS + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 1));
  try { fs.chmodSync(tmp, 0o600); } catch (e) {}   // dados de saúde: só o dono lê
  fs.renameSync(tmp, FICHEIRO_DADOS);
}

module.exports = { FICHEIRO_DADOS, SCHEMA, carregarDados, persistir };
