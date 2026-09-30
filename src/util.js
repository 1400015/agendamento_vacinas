"use strict";
/* util.js — funções transversais: leitura JSON, validações, normalizações e
   log operacional de baixo nível (erros de I/O, backups, autenticação).     */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const FICHEIRO_LOG = path.join(RAIZ, "servidor.log");
const LOG_TAM_MAX = 5 * 1024 * 1024;

/* -------- log operacional (não é a auditoria de negócio) --------
   Erros de I/O, falhas de backup, autenticação e arranques — as coisas
   que se precisam para diagnosticar uma máquina sem acesso ao terminal.
   Rotação simples: ao passar 5 MB, o ficheiro passa a .antigo.        */
function logOp(nivel, msg) {
  try {
    try {
      const st = fs.statSync(FICHEIRO_LOG);
      if (st.size > LOG_TAM_MAX) fs.renameSync(FICHEIRO_LOG, FICHEIRO_LOG + ".antigo");
    } catch (e) {}
    fs.appendFileSync(FICHEIRO_LOG, `[${new Date().toISOString()}] ${nivel} ${msg}\n`);
  } catch (e) { /* o log nunca pode rebentar o servidor */ }
}

function lerJSONcBOM(f) {
  let txt = fs.readFileSync(f, "utf8");
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);   // BOM UTF-8 (Notepad/PowerShell)
  return JSON.parse(txt);
}

function validarHoraTexto(v) {
  if (typeof v !== "string" || !/^\d{2}:\d{2}$/.test(v)) return null;
  const [h, m] = v.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return v;
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
function validarData(v) {
  if (typeof v !== "string" || !RE_DATA.test(v)) return null;
  // comparar por PARTES da data, nunca via toISOString(): converter meia-noite
  // local para UTC desloca o dia nos fusos a leste de UTC (Portugal no horário
  // de verão) e recusava TODAS as datas de março a outubro
  const [a, m, d] = v.split("-").map(Number);
  const dt = new Date(a, m - 1, d);
  if (dt.getFullYear() !== a || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return v;
}

function normalizarVac(v) {
  const s = String(v || "").toUpperCase().replace(/[\s+\/]/g, "");
  if (["G", "GRIPE", "FLU"].includes(s)) return "G";
  if (["C", "COVID", "COVID19", "COVID-19", "COVD"].includes(s)) return "C";
  if (["GC", "CG", "AMBAS", "AM", "AMBASAS"].includes(s)) return "G+C";
  return null;
}

function normalizarSlots(v) {
  if (v === null || v === undefined) return ["G"];
  if (typeof v === "string") v = [v];
  if (!Array.isArray(v)) return ["G"];
  const out = [];
  for (const x of v) {
    const n = normalizarVac(x);
    if (n === "G" && !out.includes("G")) out.push("G");
    if (n === "C" && !out.includes("C")) out.push("C");
    if (n === "G+C") { if (!out.includes("G")) out.push("G"); if (!out.includes("C")) out.push("C"); }
  }
  return out.length ? out : ["G"];
}

function chaveUtente(nome, contacto) {
  const digitos = String(contacto || "").replace(/\D/g, "");
  const n = String(nome || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return [n, digitos || String(contacto || "").trim().toLowerCase()];
}

const ESTADOS = ["agendado", "administrado", "faltou", "cancelado"];

/* fim de semana: 0 = domingo, 6 = sábado — nunca por toISOString() (fuso) */
function fimDeSemana(v) {
  const [a, m, d] = v.split("-").map(Number);
  const dia = new Date(a, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}
const OCUPAM = ["agendado", "administrado"];   // estados que bloqueiam o horário

function agora() { return new Date().toISOString(); }

module.exports = { RAIZ, logOp, lerJSONcBOM, validarHoraTexto, validarData, fimDeSemana, normalizarVac, normalizarSlots, chaveUtente, ESTADOS, OCUPAM, agora };
