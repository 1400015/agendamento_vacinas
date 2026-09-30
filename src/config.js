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
    horaInicio: validarHoraTexto(cfg.horaInicio) || "09:00",
    horaFim: validarHoraTexto(cfg.horaFim) || "18:30",
    intervaloMin: [15, 30, 60].includes(Number(cfg.intervaloMin)) ? Number(cfg.intervaloMin) : 30,
    mostrarSabado: cfg.mostrarSabado !== undefined ? !!cfg.mostrarSabado : true,
    pastaBackup: typeof cfg.pastaBackup === "string" ? cfg.pastaBackup.trim() : ""
  };
  if (validarHoraTexto(cfg.horaInicio) === null && cfg.horaInicio !== undefined) {
    logOp("AVISO", "horaInicio inválida («" + cfg.horaInicio + "») — a usar 09:00.");
    console.error("AVISO: horaInicio inválida («" + cfg.horaInicio + "») — a usar 09:00.");
  }
  if (validarHoraTexto(cfg.horaFim) === null && cfg.horaFim !== undefined) {
    logOp("AVISO", "horaFim inválida («" + cfg.horaFim + "») — a usar 18:30.");
    console.error("AVISO: horaFim inválida («" + cfg.horaFim + "») — a usar 18:30.");
  }
  const [a1, b1] = def.horaInicio.split(":").map(Number), [a2, b2] = def.horaFim.split(":").map(Number);
  if (a2 * 60 + b2 < a1 * 60 + b1 + def.intervaloMin) {
    logOp("AVISO", `horário sem slots válidos (${def.horaInicio}–${def.horaFim}, intervalo ${def.intervaloMin}) — a usar 09:00–18:30.`);
    console.error("AVISO: horário sem slots válidos (" + def.horaInicio + "–" + def.horaFim + " com intervalo " + def.intervaloMin + " min) — a usar 09:00–18:30.");
    def.horaInicio = "09:00"; def.horaFim = "18:30";
  }
  let atual = "";
  try { atual = fs.readFileSync(FICHEIRO_CONFIG, "utf8"); } catch (e) {}
  const novo = JSON.stringify(def, null, 2);
  if (novo !== atual) fs.writeFileSync(FICHEIRO_CONFIG, novo);
  return def;
}

function gravarConfig(cfg) { fs.writeFileSync(FICHEIRO_CONFIG, JSON.stringify(cfg, null, 2)); }

function gerarHoras(cfg) {
  const [h1, m1] = cfg.horaInicio.split(":").map(Number);
  const [h2, m2] = cfg.horaFim.split(":").map(Number);
  const ini = h1 * 60 + m1, fim = h2 * 60 + m2;
  const horas = [];
  for (let t = ini; t <= fim; t += cfg.intervaloMin) {
    horas.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
  }
  return horas;
}

module.exports = { FICHEIRO_CONFIG, carregarConfig, gravarConfig, gerarHoras };
