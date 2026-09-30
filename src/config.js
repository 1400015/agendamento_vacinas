"use strict";
/* config.js — carga/validação de config.json. Ilegível: preserva e pára
   (nunca regravar por cima). Inválida por campo: avisa e usa o defeito.  */
const fs = require("fs");
const path = require("path");
const { RAIZ, logOp, lerJSONcBOM, validarHoraTexto } = require("./util");

const FICHEIRO_CONFIG = path.join(RAIZ, "config.json");

function carregarConfig() {
  let cfg = {};
  if (fs.existsSync(FICHEIRO_CONFIG)) {
    try { cfg = lerJSONcBOM(FICHEIRO_CONFIG); }
    catch (e) {
      const preservado = FICHEIRO_CONFIG + ".corrompida-" + new Date().toISOString().replace(/[:.]/g, "-");
      try { fs.renameSync(FICHEIRO_CONFIG, preservado); } catch (e2) {}
      logOp("ERRO", "config.json ilegível — preservado como " + preservado);
      console.error("CONFIG ILEGÍVEL — foi preservada como " + preservado);
      console.error("Corrija-a (ou apague-a para voltar aos valores por omissão) e volte a arrancar.");
      process.exit(1);
    }
  }
  const def = {
    maxPorHora: Number(cfg.maxPorHora) || 2,
    horaInicio: validarHoraTexto(cfg.horaInicio) || "08:30",
    horaFim: validarHoraTexto(cfg.horaFim) || "12:00",
    horaInicio2: validarHoraTexto(cfg.horaInicio2) || "14:30",
    horaFim2: validarHoraTexto(cfg.horaFim2) || "19:30",
    intervaloMin: [15, 30, 60].includes(Number(cfg.intervaloMin)) ? Number(cfg.intervaloMin) : 30,
    mostrarSabado: cfg.mostrarSabado !== undefined ? !!cfg.mostrarSabado : false,
    pastaBackup: typeof cfg.pastaBackup === "string" ? cfg.pastaBackup.trim() : ""
  };
  if (validarHoraTexto(cfg.horaInicio) === null && cfg.horaInicio !== undefined) {
    logOp("AVISO", "horaInicio inválida («" + cfg.horaInicio + "») — a usar 08:30.");
    console.error("AVISO: horaInicio inválida («" + cfg.horaInicio + "») — a usar 08:30.");
  }
  if (validarHoraTexto(cfg.horaFim) === null && cfg.horaFim !== undefined) {
    logOp("AVISO", "horaFim inválida («" + cfg.horaFim + "») — a usar 12:00.");
    console.error("AVISO: horaFim inválida («" + cfg.horaFim + "») — a usar 12:00.");
  }
  if (validarHoraTexto(cfg.horaInicio2) === null && cfg.horaInicio2 !== undefined) {
    logOp("AVISO", "horaInicio2 inválida («" + cfg.horaInicio2 + "») — a usar 14:30.");
    console.error("AVISO: horaInicio2 inválida («" + cfg.horaInicio2 + "») — a usar 14:30.");
  }
  if (validarHoraTexto(cfg.horaFim2) === null && cfg.horaFim2 !== undefined) {
    logOp("AVISO", "horaFim2 inválida («" + cfg.horaFim2 + "») — a usar 19:30.");
    console.error("AVISO: horaFim2 inválida («" + cfg.horaFim2 + "») — a usar 19:30.");
  }
  const minutos = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const slotsPeriodo = (ini, fim) => fim >= ini + def.intervaloMin;
  if (!slotsPeriodo(minutos(def.horaInicio), minutos(def.horaFim)) && !slotsPeriodo(minutos(def.horaInicio2), minutos(def.horaFim2))) {
    logOp("AVISO", `horário sem slots válidos — a usar 08:30–12:00 e 14:30–19:30.`);
    console.error("AVISO: horário sem slots válidos — a usar 08:30–12:00 e 14:30–19:30.");
    def.horaInicio = "08:30"; def.horaFim = "12:00"; def.horaInicio2 = "14:30"; def.horaFim2 = "19:30";
  }
  let atual = "";
  try { atual = fs.readFileSync(FICHEIRO_CONFIG, "utf8"); } catch (e) {}
  const novo = JSON.stringify(def, null, 2);
  if (novo !== atual) fs.writeFileSync(FICHEIRO_CONFIG, novo);
  return def;
}

function gravarConfig(cfg) { fs.writeFileSync(FICHEIRO_CONFIG, JSON.stringify(cfg, null, 2)); }

function gerarHoras(cfg) {
  const horas = [];
  const gerarPeriodo = (inicio, fim) => {
    if (!inicio || !fim) return;
    const [h1, m1] = inicio.split(":").map(Number);
    const [h2, m2] = fim.split(":").map(Number);
    const ini = h1 * 60 + m1, fimMin = h2 * 60 + m2;
    if (fimMin < ini + cfg.intervaloMin) return;
    for (let t = ini; t <= fimMin; t += cfg.intervaloMin) {
      horas.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
  };
  gerarPeriodo(cfg.horaInicio, cfg.horaFim);
  gerarPeriodo(cfg.horaInicio2, cfg.horaFim2);
  return [...new Set(horas)];
}

module.exports = { FICHEIRO_CONFIG, carregarConfig, gravarConfig, gerarHoras };
