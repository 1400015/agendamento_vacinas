"use strict";
/* config.js — carga/validação de config.json. Ilegível: preserva e pára
   (nunca regravar por cima). Inválida por campo: avisa e usa o defeito.  */
const fs = require("fs");
const path = require("path");
const { RAIZ, logOp, lerJSONcBOM, validarHoraTexto, validarData } = require("./util");

const FICHEIRO_CONFIG = path.join(RAIZ, "config.json");

/* períodos aceites na configuração (dias úteis + sábado) */
const CAMPOS_HORA = ["horaInicio", "horaFim", "horaInicio2", "horaFim2", "sabadoInicio", "sabadoFim", "sabadoInicio2", "sabadoFim2"];

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
  /* dias de encerramento (feriados/férias): a farmácia não vacina; entram
     normalizados e as datas inválidas não passam do ficheiro para a memória */
  const diasBrutos = Array.isArray(cfg.diasFechados) ? cfg.diasFechados : [];
  const diasFechados = [...new Set(diasBrutos.map(validarData).filter(Boolean))];
  if (diasBrutos.length !== diasFechados.length) {
    logOp("AVISO", "diasFechados: " + diasBrutos.length + " entrada(s), " + diasFechados.length + " válida(s) — as restantes ignoradas.");
    console.error("AVISO: diasFechados com datas inválidas ignoradas (use AAAA-MM-DD).");
  }
  Object.assign(def, {
    intervaloMin: [15, 30, 60].includes(Number(cfg.intervaloMin)) ? Number(cfg.intervaloMin) : 30,
    maxPorHora: Number.isInteger(Number(cfg.maxPorHora)) && Number(cfg.maxPorHora) >= 1 ? Number(cfg.maxPorHora) : 2,
    mostrarSabado: cfg.mostrarSabado !== undefined ? !!cfg.mostrarSabado : true,
    pastaBackup: typeof cfg.pastaBackup === "string" ? cfg.pastaBackup.trim() : "",
    diasFechados
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

/* Validação das alterações de configuração vindas da interface (PUT /api/config).
   Ao contrário do ficheiro editado à mão (onde um valor inválido cai no defeito
   com aviso), aqui o pedido é do utilizador e o valor inválido é RECUSADO com a
   razão — não se grava nada que ele não tenha pedido. Devolve
   { ok, alteracoes } ou { ok: false, erros: [...] }.                      */
function validarAlteracoesConfig(atuais, corpo) {
  const alteracoes = {};
  const erros = [];
  for (const campo of CAMPOS_HORA) {
    if (corpo[campo] === undefined) continue;
    const v = validarHoraTexto(corpo[campo]);
    if (!v) { erros.push(`${campo} inválida (use HH:MM).`); continue; }
    alteracoes[campo] = v;
  }
  if (corpo.intervaloMin !== undefined) {
    const n = Number(corpo.intervaloMin);
    if (![15, 30, 60].includes(n)) erros.push("intervaloMin tem de ser 15, 30 ou 60 minutos.");
    else alteracoes.intervaloMin = n;
  }
  if (corpo.maxPorHora !== undefined) {
    const n = Number(corpo.maxPorHora);
    if (!Number.isInteger(n) || n < 1 || n > 20) erros.push("maxPorHora tem de ser um número inteiro entre 1 e 20.");
    else alteracoes.maxPorHora = n;
  }
  if (corpo.mostrarSabado !== undefined) alteracoes.mostrarSabado = !!corpo.mostrarSabado;
  if (corpo.pastaBackup !== undefined) alteracoes.pastaBackup = String(corpo.pastaBackup || "").trim();
  if (corpo.diasFechados !== undefined) {
    if (!Array.isArray(corpo.diasFechados)) erros.push("diasFechados tem de ser uma lista de datas.");
    else {
      const datas = corpo.diasFechados.map(d => validarData(String(d || "").trim()));
      if (datas.includes(null)) erros.push("diasFechados contém uma data inválida (use AAAA-MM-DD).");
      else alteracoes.diasFechados = [...new Set(datas)];
    }
  }
  if (erros.length) return { ok: false, erros };
  if (!Object.keys(alteracoes).length) return { ok: false, erros: ["Nenhuma alteração indicada."] };
  const proposta = Object.assign({}, atuais, alteracoes);
  const minutos = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const comSlot = (ini, fim) => minutos(fim) >= minutos(ini) + proposta.intervaloMin;
  if (!comSlot(proposta.horaInicio, proposta.horaFim) && !comSlot(proposta.horaInicio2, proposta.horaFim2))
    return { ok: false, erros: ["O horário dos dias úteis não deixa nenhuma hora marcável (verifique início, fim e intervalo)."] };
  if (!comSlot(proposta.sabadoInicio, proposta.sabadoFim) && !comSlot(proposta.sabadoInicio2, proposta.sabadoFim2))
    return { ok: false, erros: ["O horário de sábado não deixa nenhuma hora marcável (verifique início, fim e intervalo)."] };
  return { ok: true, alteracoes };
}

module.exports = { FICHEIRO_CONFIG, carregarConfig, gravarConfig, gerarHoras, gerarHorasSabado, validarAlteracoesConfig, CAMPOS_HORA };
