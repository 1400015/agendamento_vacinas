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
  /* horários: dias úteis + sábado. A vacinação ao sábado é excecional e tem
     períodos próprios — por omissão 09:30–12:00 e 15:00–17:00 — recusando-se
     tudo fora deles; o domingo não tem qualquer horário. */
  const HORAS_DEF = [
    ["horaInicio", "08:30"], ["horaFim", "12:00"], ["horaInicio2", "14:30"], ["horaFim2", "19:30"],
    ["sabadoInicio", "09:30"], ["sabadoFim", "12:00"], ["sabadoInicio2", "15:00"], ["sabadoFim2", "17:00"]
  ];
  const def = { maxPorHora: Number(cfg.maxPorHora) || 2 };
  for (const [campo, defeito] of HORAS_DEF) {
    const v = validarHoraTexto(cfg[campo]);
    if (v === null && cfg[campo] !== undefined) {
      logOp("AVISO", campo + " inválida («" + cfg[campo] + "») — a usar " + defeito + ".");
      console.error("AVISO: " + campo + " inválida («" + cfg[campo] + "») — a usar " + defeito + ".");
    }
    def[campo] = v || defeito;
  }
  Object.assign(def, {
    intervaloMin: [15, 30, 60].includes(Number(cfg.intervaloMin)) ? Number(cfg.intervaloMin) : 30,
    mostrarSabado: cfg.mostrarSabado !== undefined ? !!cfg.mostrarSabado : true,
    pastaBackup: typeof cfg.pastaBackup === "string" ? cfg.pastaBackup.trim() : ""
  });
  const minutos = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const slotsPeriodo = (ini, fim) => fim >= ini + def.intervaloMin;
  if (!slotsPeriodo(minutos(def.horaInicio), minutos(def.horaFim)) && !slotsPeriodo(minutos(def.horaInicio2), minutos(def.horaFim2))) {
    logOp("AVISO", `horário sem slots válidos — a usar 08:30–12:00 e 14:30–19:30.`);
    console.error("AVISO: horário sem slots válidos — a usar 08:30–12:00 e 14:30–19:30.");
    def.horaInicio = "08:30"; def.horaFim = "12:00"; def.horaInicio2 = "14:30"; def.horaFim2 = "19:30";
  }
  if (!slotsPeriodo(minutos(def.sabadoInicio), minutos(def.sabadoFim)) && !slotsPeriodo(minutos(def.sabadoInicio2), minutos(def.sabadoFim2))) {
    logOp("AVISO", `horário de sábado sem slots válidos — a usar 09:30–12:00 e 15:00–17:00.`);
    console.error("AVISO: horário de sábado sem slots válidos — a usar 09:30–12:00 e 15:00–17:00.");
    def.sabadoInicio = "09:30"; def.sabadoFim = "12:00"; def.sabadoInicio2 = "15:00"; def.sabadoFim2 = "17:00";
  }
  let atual = "";
  try { atual = fs.readFileSync(FICHEIRO_CONFIG, "utf8"); } catch (e) {}
  const novo = JSON.stringify(def, null, 2);
  if (novo !== atual) fs.writeFileSync(FICHEIRO_CONFIG, novo);
  return def;
}

function gravarConfig(cfg) { fs.writeFileSync(FICHEIRO_CONFIG, JSON.stringify(cfg, null, 2)); }

function gerarPeriodos(periodos, intervaloMin) {
  const horas = [];
  for (const [inicio, fim] of periodos) {
    if (!inicio || !fim) continue;
    const [h1, m1] = inicio.split(":").map(Number);
    const [h2, m2] = fim.split(":").map(Number);
    const ini = h1 * 60 + m1, fimMin = h2 * 60 + m2;
    if (fimMin < ini + intervaloMin) continue;
    for (let t = ini; t <= fimMin; t += intervaloMin) {
      horas.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
  }
  return [...new Set(horas)];
}

function gerarHoras(cfg) {
  return gerarPeriodos([[cfg.horaInicio, cfg.horaFim], [cfg.horaInicio2, cfg.horaFim2]], cfg.intervaloMin);
}

/* horas válidas ao sábado (períodos próprios, mais curtos) */
function gerarHorasSabado(cfg) {
  return gerarPeriodos([[cfg.sabadoInicio, cfg.sabadoFim], [cfg.sabadoInicio2, cfg.sabadoFim2]], cfg.intervaloMin);
}

module.exports = { FICHEIRO_CONFIG, carregarConfig, gravarConfig, gerarHoras, gerarHorasSabado };
