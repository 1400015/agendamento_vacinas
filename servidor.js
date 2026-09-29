#!/usr/bin/env node
"use strict";
/* ============================================================================
 * Central de Marcações de Vacinas — Farmácia Boavista (versão unificada)
 * ============================================================================
 * Servidor interno multi-posto, Node.js puro (sem dependências npm).
 *
 * Fusão das três versões anteriores:
 *  - muse  : modelo separado utentes/marcações, rev POR REGISTO, estados que
 *            libertam o horário (faltou/cancelado), limite maxPorHora,
 *            duplicados na importação, auditoria por posto, reagendamento
 *            que cria marcação nova e liberta a antiga.
 *  - mistral : PIN com PBKDF2 (150k iterações) + verificador AES-256-GCM,
 *            sessões 8h, escrita atómica, API por mutações.
 *  - flash : horário configurável (início/fim/intervalo/sábado), calendário
 *            em grelha, vacinas por slot (listas G/C).
 *
 * Dados: dados.json (junto ao script, criado automaticamente; escrita atómica).
 * PIN:   config-pin.json (sal + iv + verificador; nunca guarda o PIN em claro).
 * Config: config.json (maxPorHora, horário do calendário) — editável.
 *
 * Uso:  node servidor.js [porta]     (omissão 8080; alternativa: env PORTA)
 * ==========================================================================*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { networkInterfaces } = require("os");

const RAIZ = __dirname;
const PORTA = Number(process.argv[2] || process.env.PORTA || 8080);
const FICHEIRO_DADOS = path.join(RAIZ, "dados.json");
const FICHEIRO_PIN = path.join(RAIZ, "config-pin.json");
const FICHEIRO_CONFIG = path.join(RAIZ, "config.json");
const PASTA_PUBLICA = path.join(RAIZ, "public");

/* ------------------------------------------------------------- config ----- */
function carregarConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(FICHEIRO_CONFIG, "utf8")); } catch (e) {}
  const def = {
    maxPorHora: Number(cfg.maxPorHora) || 2,
    horaInicio: cfg.horaInicio || "09:00",
    horaFim: cfg.horaFim || "18:30",
    intervaloMin: [15, 30, 60].includes(Number(cfg.intervaloMin)) ? Number(cfg.intervaloMin) : 30,
    mostrarSabado: cfg.mostrarSabado !== undefined ? !!cfg.mostrarSabado : true
  };
  fs.writeFileSync(FICHEIRO_CONFIG, JSON.stringify(def, null, 2));
  return def;
}
const CFG = carregarConfig();

function gerarHoras() {
  const [h1, m1] = CFG.horaInicio.split(":").map(Number);
  const [h2, m2] = CFG.horaFim.split(":").map(Number);
  const ini = h1 * 60 + m1, fim = h2 * 60 + m2;
  const horas = [];
  for (let t = ini; t <= fim; t += CFG.intervaloMin) {
    horas.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
  }
  return horas;
}
const HORAS = gerarHoras();

/* --------------------------------------------------------------- dados ---- */
let dados = { versao: 1, utentes: [], marcacoes: [], historico: [] };

function carregarDados() {
  try {
    const j = JSON.parse(fs.readFileSync(FICHEIRO_DADOS, "utf8"));
    if (!Array.isArray(j.utentes)) j.utentes = [];
    if (!Array.isArray(j.marcacoes)) j.marcacoes = [];
    if (!Array.isArray(j.historico)) j.historico = [];
    if (!Number.isInteger(j.versao)) j.versao = 1;
    dados = j;
  } catch (e) {
    if (e.code !== "ENOENT") {
      // nunca recomeçar do zero por cima de dados possivelmente recuperáveis
      // (utentes = dados pessoais): preservar o ficheiro e parar
      const preservado = FICHEIRO_DADOS + ".corrompida-" + new Date().toISOString().replace(/[:.]/g, "-");
      try { fs.renameSync(FICHEIRO_DADOS, preservado); } catch (e2) {}
      console.error("FICHEIRO DE DADOS ILEGÍVEL (" + e.message + ")");
      console.error("Foi preservado como: " + preservado);
      console.error("O servidor NÃO arranca para não apagar dados — restaure a última");
      console.error("cópia de segurança para dados.json (ver INSTALL.md) e volte a arrancar.");
      process.exit(1);
    }
  }
}
function persistir() {
  const tmp = FICHEIRO_DADOS + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(dados, null, 1));
  fs.renameSync(tmp, FICHEIRO_DADOS);
}
function bumpVersao() { dados.versao += 1; }
function agora() { return new Date().toISOString(); }
function registar(posto, acao, alvo, detalhe) {
  dados.historico.push({ quando: agora(), posto: posto || "?", acao, alvo, detalhe: String(detalhe || "").slice(0, 500) });
  if (dados.historico.length > 5000) dados.historico.splice(0, dados.historico.length - 5000);
}

/* ----------------------------------------------------------- validações --- */
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
function validarHora(v) { return HORAS.includes(v) ? v : null; }
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
const OCUPAM = ["agendado", "administrado"];   // estados que bloqueiam o horário

/* ----------------------------------------------------------------- PIN ---- */
function b64(a) { return Buffer.from(a).toString("base64"); }
function unb64(s) { return new Uint8Array(Buffer.from(s, "base64")); }
async function derivarChave(pin, sal) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sal, iterations: 150000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function pinDefinido() { return fs.existsSync(FICHEIRO_PIN); }
async function definirPin(pin) {
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await derivarChave(pin, sal);
  const ver = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, new TextEncoder().encode("ok"));
  fs.writeFileSync(FICHEIRO_PIN, JSON.stringify({ sal: b64(sal), iv: b64(iv), ver: b64(new Uint8Array(ver)) }));
}
async function verificarPin(pin) {
  try {
    const cfg = JSON.parse(fs.readFileSync(FICHEIRO_PIN, "utf8"));
    const k = await derivarChave(pin, unb64(cfg.sal));
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(cfg.iv) }, k, unb64(cfg.ver));
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------ sessões ----- */
const sessoes = new Map(); // token -> {posto, expira}
function novaSessao(posto) {
  const t = crypto.randomBytes(24).toString("hex");
  sessoes.set(t, { posto, expira: Date.now() + 8 * 3600 * 1000 });
  return t;
}
function tokenDe(req) {
  const h = req.headers["authorization"] || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  const c = (req.headers.cookie || "").match(/sessao=([a-f0-9]+)/);
  return c ? c[1] : null;
}
function sessaoDe(req) {
  const t = tokenDe(req);
  if (!t) return null;
  const s = sessoes.get(t);
  if (!s) return null;
  if (Date.now() > s.expira) { sessoes.delete(t); return null; }
  return s;
}

/* ------------------------------------------------------------ HTTP base -- */
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on("data", c => { tam += c.length; if (tam > 5e6) { req.destroy(); reject(new Error("grande demais")); } partes.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };
function servirFicheiro(res, f) {
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end("Não encontrado"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(buf);
  });
}

/* ================================================================ API ==== */
async function api(req, res, corpo) {
  const rota = req.url.split("?")[0];
  const partes = rota.replace(/^\/+/, "").split("/");   // ex.: ["api","utentes","abc"]
  const resp = (cod, obj, cookie) => {
    const cab = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (cookie) cab["Set-Cookie"] = cookie;
    res.writeHead(cod, cab); res.end(JSON.stringify(obj));
  };
  const sessao = sessaoDe(req);
  const exigir = () => { if (!sessao) { resp(401, { erro: "Sessão expirada ou não iniciada.", login: true }); return false; } return true; };

  /* ---------- estado / login ---------- */
  if (rota === "/api/estado" && req.method === "GET")
    return resp(200, { pinDefinido: pinDefinido(), config: CFG, horas: HORAS });

  if (rota === "/api/setup" && req.method === "POST") {
    if (pinDefinido()) return resp(403, { erro: "PIN já definido. Para redefinir, pare o servidor e apague config-pin.json." });
    const pin = String(corpo.pin || "");
    if (pin.length < 4) return resp(400, { erro: "O PIN deve ter pelo menos 4 caracteres." });
    await definirPin(pin);
    const posto = String(corpo.posto || "").trim() || "Posto";
    const t = novaSessao(posto);
    return resp(200, { ok: true, token: t, posto },
      `sessao=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
  }

  if (rota === "/api/login" && req.method === "POST") {
    if (!pinDefinido()) return resp(400, { erro: "PIN ainda não definido." });
    const posto = String(corpo.posto || "").trim();
    if (!posto) return resp(400, { erro: "Indique o nome do posto (ex.: Posto 1)." });
    if (!(await verificarPin(String(corpo.pin || "")))) return resp(401, { erro: "PIN incorreto." });
    const t = novaSessao(posto);
    return resp(200, { ok: true, token: t, posto }, `sessao=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
  }

  if (rota === "/api/logout" && req.method === "POST") {
    if (sessao && tokenDe(req)) sessoes.delete(tokenDe(req));
    return resp(200, { ok: true }, "sessao=; Path=/; Max-Age=0");
  }

  if (!exigir()) return;
  const posto = sessao.posto;

  /* ---------- leitura ---------- */
  if (rota === "/api/dados" && req.method === "GET")
    return resp(200, { versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes, config: CFG, horas: HORAS, posto });

  if (rota === "/api/historico" && req.method === "GET")
    return resp(200, { versao: dados.versao, historico: dados.historico.slice(-500).reverse() });

  if (rota === "/api/horas" && req.method === "GET")
    return resp(200, { horas: HORAS, config: CFG });

  /* ---------- helpers de mutação ---------- */
  const baseVersaoOk = () => {
    if (!Number.isInteger(corpo.baseVersao)) { resp(400, { erro: "baseVersao em falta." }); return false; }
    if (corpo.baseVersao !== dados.versao) {
      resp(409, { erro: "conflito", motivo: "versao", versao: dados.versao,
        utentes: dados.utentes, marcacoes: dados.marcacoes, config: CFG });
      return false;
    }
    return true;
  };
  const gravar = (extra) => { bumpVersao(); persistir(); resp(200, Object.assign({ versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes, config: CFG, horas: HORAS }, extra || {})); };
  const ocupantes = (data, hora, excetoId) => dados.marcacoes.filter(m =>
    m.data === data && m.hora === hora && OCUPAM.includes(m.estado) && m.id !== excetoId);

  /* ---------- utentes ---------- */
  if (rota === "/api/utentes" && req.method === "POST") {
    if (!baseVersaoOk()) return;
    const nome = String(corpo.nome || "").trim();
    const contacto = String(corpo.contacto || "").trim();
    const vacina = normalizarVac(corpo.vacina);
    if (!nome || !contacto) return resp(400, { erro: "Nome e contacto obrigatórios." });
    if (!vacina) return resp(400, { erro: "Vacina inválida (G, C ou G+C)." });
    const k = chaveUtente(nome, contacto);
    if (dados.utentes.some(u => chaveUtente(u.nome, u.contacto)[0] === k[0] && chaveUtente(u.nome, u.contacto)[1] === k[1]))
      return resp(409, { erro: "Já existe um utente com este nome/contacto." });
    const u = { id: crypto.randomUUID(), nome, contacto, vacina, obs: String(corpo.obs || "").trim(), rev: 1, criadoEm: agora(), criadoPor: posto };
    dados.utentes.push(u);
    registar(posto, "criar utente", u.id, `${nome} | ${contacto} | ${vacina}`);
    return gravar();
  }

  if (rota === "/api/importar" && req.method === "POST") {
    if (!baseVersaoOk()) return;
    const linhas = corpo.linhas;
    if (!Array.isArray(linhas) || !linhas.length) return resp(400, { erro: "Lista de linhas vazia." });
    const existentes = new Set(dados.utentes.map(u => chaveUtente(u.nome, u.contacto).join("|")));
    let inseridos = 0, ignorados = [], duplicados = [];
    for (const ln of linhas) {
      const n = String((ln && ln.nome) || "").trim();
      const c = String((ln && ln.contacto) || "").trim();
      const v = normalizarVac(ln && ln.vacina);
      if (!n || !c || !v) { ignorados.push(ln); continue; }
      const k = chaveUtente(n, c).join("|");
      if (existentes.has(k)) { duplicados.push(ln); continue; }
      existentes.add(k);
      dados.utentes.push({ id: crypto.randomUUID(), nome: n, contacto: c, vacina: v, obs: "", rev: 1, criadoEm: agora(), criadoPor: posto });
      inseridos++;
    }
    if (inseridos) registar(posto, "importar", "lote", `inseridos=${inseridos} ignorados=${ignorados.length} duplicados=${duplicados.length}`);
    return gravar({ inseridos, ignorados: ignorados.length, duplicados: duplicados.length });
  }

  if (partes[0] === "api" && partes[1] === "utentes" && partes[2] && req.method === "PUT") {
    if (!baseVersaoOk()) return;
    const u = dados.utentes.find(x => x.id === partes[2]);
    if (!u) return resp(409, { erro: "Utente eliminado noutro posto." });
    if (Number(corpo.rev) !== u.rev)
      return resp(409, { erro: "conflito", motivo: "registo", atual: u, versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes });
    const nome = corpo.nome !== undefined ? String(corpo.nome).trim() : u.nome;
    const contacto = corpo.contacto !== undefined ? String(corpo.contacto).trim() : u.contacto;
    const vacina = corpo.vacina !== undefined ? normalizarVac(corpo.vacina) : u.vacina;
    if (!nome || !contacto) return resp(400, { erro: "Nome e contacto obrigatórios." });
    if (vacina === null) return resp(400, { erro: "Vacina inválida." });
    registar(posto, "editar utente", u.id, `${u.nome} -> ${nome}`);
    Object.assign(u, { nome, contacto, vacina, obs: corpo.obs !== undefined ? String(corpo.obs).trim() : u.obs, rev: u.rev + 1, atualizadoEm: agora() });
    return gravar();
  }

  if (partes[0] === "api" && partes[1] === "utentes" && partes[2] && req.method === "DELETE") {
    if (!baseVersaoOk()) return;
    const u = dados.utentes.find(x => x.id === partes[2]);
    if (!u) return resp(409, { erro: "Utente já eliminado." });
    if (Number(corpo.rev) !== u.rev)
      return resp(409, { erro: "conflito", motivo: "registo", atual: u, versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes });
    const n = dados.marcacoes.filter(m => m.utenteId === u.id).length;
    dados.marcacoes = dados.marcacoes.filter(m => m.utenteId !== u.id);
    dados.utentes = dados.utentes.filter(x => x.id !== u.id);
    registar(posto, "eliminar utente", u.id, `${u.nome} (+${n} marcações)`);
    return gravar();
  }

  /* ---------- marcações ---------- */
  if (rota === "/api/marcacoes" && req.method === "POST") {
    if (!baseVersaoOk()) return;
    const data = validarData(corpo.data), hora = validarHora(corpo.hora);
    const utente = dados.utentes.find(x => x.id === corpo.utenteId);
    if (!utente) return resp(409, { erro: "Utente não existe (eliminado noutro posto?)" });
    if (!data || !hora) return resp(400, { erro: `Data válida e hora entre ${HORAS[0]} e ${HORAS[HORAS.length - 1]} obrigatórias.` });
    const vacinas = normalizarSlots(corpo.vacinas);
    const just = !!corpo.justificada;
    const motivo = String(corpo.motivo || "").trim();
    if (dados.marcacoes.some(m => m.utenteId === utente.id && m.data === data && m.hora === hora && OCUPAM.includes(m.estado)))
      return resp(409, { erro: "Este utente já tem marcação ativa nessa hora." });
    const ocup = ocupantes(data, hora, null);
    if (ocup.length >= CFG.maxPorHora)
      return resp(409, { erro: `Hora cheia (máx. ${CFG.maxPorHora} por horário).`, motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
    if (ocup.length > 0 && !just)
      return resp(409, { erro: "Hora já ocupada.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
    if (just && !motivo)
      return resp(400, { erro: "Exceção justificada exige motivo." });
    const m = { id: crypto.randomUUID(), utenteId: utente.id, data, hora, vacinas,
      estado: "agendado", justificada: just, motivo: just ? motivo : "",
      rev: 1, criadoEm: agora(), criadoPor: posto, historico: [{ quando: agora(), acc: "criada", posto }] };
    dados.marcacoes.push(m);
    registar(posto, "agendar", m.id, `${data} ${hora} ${vacinas.join("+")}${just ? " justificada: " + motivo : ""}`);
    return gravar();
  }

  if (partes[0] === "api" && partes[1] === "marcacoes" && partes[2] && req.method === "PUT") {
    if (!baseVersaoOk()) return;
    const m = dados.marcacoes.find(x => x.id === partes[2]);
    if (!m) return resp(409, { erro: "Marcação eliminada noutro posto." });
    if (Number(corpo.rev) !== m.rev)
      return resp(409, { erro: "conflito", motivo: "registo", atual: m, versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes });
    const estado = corpo.estado !== undefined ? corpo.estado : m.estado;
    if (estado !== null && !ESTADOS.includes(estado)) return resp(400, { erro: "Estado inválido." });
    const nd = corpo.novaData !== undefined ? validarData(corpo.novaData) : null;
    const nh = corpo.novaHora !== undefined ? validarHora(corpo.novaHora) : null;
    if ((corpo.novaData || corpo.novaHora) && !(nd && nh))
      return resp(400, { erro: "Para reagendar indique data e hora válidas." });
    const reagendar = !!corpo.reagendar;

    if (reagendar && nd && nh) {
      // marcação nova nasce 'agendada'; a antiga liberta a hora
      const ocup = ocupantes(nd, nh, m.id);
      if (ocup.length >= CFG.maxPorHora || (ocup.length > 0 && !corpo.justificada))
        return resp(409, { erro: "Nova hora ocupada noutro posto.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
      const nova = { id: crypto.randomUUID(), utenteId: m.utenteId, data: nd, hora: nh, vacinas: m.vacinas,
        estado: "agendado", justificada: !!corpo.justificada, motivo: String(corpo.motivo || "").trim(),
        rev: 1, criadoEm: agora(), criadoPor: posto, historico: [{ quando: agora(), acc: `reagendada de ${m.data} ${m.hora}`, posto }] };
      dados.marcacoes.push(nova);
      // a antiga TEM de libertar a hora: se o estado escolhido ainda ocupasse
      // (agendado/administrado — o caso normal da interface, que deixa o
      // estado como está), é cancelada automaticamente e fica ligada à nova
      // (supersedidaPor) para não contar nas «Canceladas» dos indicadores
      if (OCUPAM.includes(estado)) {
        m.estado = "cancelado";
        m.supersedidaPor = nova.id;
        m.historico.push({ quando: agora(), acc: "antiga cancelada pelo reagendamento (liberta a hora)", posto });
      } else {
        m.estado = estado || "faltou";
      }
      m.rev += 1; m.atualizadoEm = agora();
      m.historico.push({ quando: agora(), acc: `reagendada para ${nd} ${nh} (nova ${nova.id.slice(0, 8)})`, posto });
      registar(posto, "reagendar", m.id, `${m.data} ${m.hora} -> ${nd} ${nh}`);
      return gravar({ novaId: nova.id });
    }

    // alteração na própria marcação (estado e/ou deslocação)
    if (nd && nh) {
      const ocup = ocupantes(nd, nh, m.id);
      if (ocup.length >= CFG.maxPorHora || (ocup.length > 0 && !corpo.justificada))
        return resp(409, { erro: "Hora destino ocupada.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
      m.data = nd; m.hora = nh;
    }
    if (corpo.estado !== undefined) m.estado = estado;
    if (corpo.justificada !== undefined) { m.justificada = !!corpo.justificada; m.motivo = String(corpo.motivo || "").trim(); }
    if (corpo.vacinas !== undefined) m.vacinas = normalizarSlots(corpo.vacinas);
    m.rev += 1; m.atualizadoEm = agora();
    m.historico.push({ quando: agora(), acc: `alterada: ${Object.keys(corpo).filter(k => !["rev", "baseVersao"].includes(k)).join(", ")}`, posto });
    registar(posto, "alterar marcação", m.id, `${m.data} ${m.hora} estado=${m.estado}`);
    return gravar();
  }

  if (partes[0] === "api" && partes[1] === "marcacoes" && partes[2] && req.method === "DELETE") {
    if (!baseVersaoOk()) return;
    const m = dados.marcacoes.find(x => x.id === partes[2]);
    if (!m) return resp(409, { erro: "Marcação já eliminada." });
    if (Number(corpo.rev) !== m.rev)
      return resp(409, { erro: "conflito", motivo: "registo", atual: m, versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes });
    dados.marcacoes = dados.marcacoes.filter(x => x.id !== m.id);
    registar(posto, "eliminar marcação", m.id, `${m.data} ${m.hora}`);
    return gravar();
  }

  return resp(404, { erro: "Rota não encontrada." });
}

function utenteDe(id) { const u = dados.utentes.find(x => x.id === id); return u ? u.nome : "?"; }

/* ------------------------------------------------------------ servidor --- */
carregarDados();
const servidor = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    let bruto = "";
    req.on("data", c => { bruto += c; if (bruto.length > 5e6) req.destroy(); });
    req.on("end", () => {
      let corpo = {};
      try { corpo = JSON.parse(bruto || "{}"); } catch (e) {}
      api(req, res, corpo).catch(e => {
        console.error("Erro API:", e);
        res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"erro":"erro interno"}');
      });
    });
    return;
  }
  if (req.url === "/" || req.url === "/index.html") return servirFicheiro(res, path.join(PASTA_PUBLICA, "index.html"));
  if (req.url === "/exemplo-utentes.txt") return servirFicheiro(res, path.join(RAIZ, "exemplo-utentes.txt"));
  if (req.url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  servirFicheiro(res, path.join(PASTA_PUBLICA, path.normalize(req.url).replace(/^([.][.][/\\])+/g, "")));
});

servidor.listen(PORTA, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
  console.log("═".repeat(64));
  console.log("  Central de Marcações de Vacinas — Farmácia Boavista");
  console.log(`  Servidor na porta ${PORTA}  ·  horário ${CFG.horaInicio}–${CFG.horaFim} (cada ${CFG.intervaloMin} min)`);
  console.log(`  Máx. por hora: ${CFG.maxPorHora} (exceção justificada com motivo)`);
  console.log(`  Neste computador:  http://localhost:${PORTA}`);
  (ips.length ? ips : ["<ip-do-servidor>"]).forEach(ip => console.log(`  Nos postos da frente: http://${ip}:${PORTA}`));
  console.log(`  Dados: ${FICHEIRO_DADOS}   (não editar com o servidor a correr)`);
  console.log("  Ctrl+C para parar. Não fechar esta janela durante o serviço.");
  console.log("═".repeat(64));
});
