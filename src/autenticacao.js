"use strict";
/* autenticacao.js — PIN (PBKDF2 150k + verificador AES-256-GCM), código de
   arranque do primeiro acesso, sessões 8h em memória e rate-limit por IP.  */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { RAIZ, logOp, lerJSONcBOM } = require("./util");

const FICHEIRO_PIN = path.join(RAIZ, "config-pin.json");
const FICHEIRO_CODIGO = path.join(RAIZ, "codigo-arranque.txt");

/* ---------------- PIN ---------------- */
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
  let cfg;
  try {
    cfg = lerJSONcBOM(FICHEIRO_PIN);
    const k = await derivarChave(pin, unb64(cfg.sal));
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(cfg.iv) }, k, unb64(cfg.ver));
    return true;
  } catch (e) {
    // distinguir PIN errado de ficheiro corrompido: sem os campos, é o ficheiro
    if (!cfg || !cfg.sal || !cfg.iv || !cfg.ver) return "corrompido";
    return false;
  }
}

/* --------- código de arranque (primeiro acesso) ---------
   Enquanto o PIN não estiver definido, o primeiro acesso exige o código
   impresso NO TERMINAL do servidor — quem está na consola (responsável)
   controla quem define o PIN; um visitante no WIFI não o conhece.       */
let codigoArranque = null;
function gerarCodigoArranque() {
  codigoArranque = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  // também em ficheiro local: quem está NESTA máquina já tem acesso ao
  // terminal; o ficheiro é apagado logo que o PIN fica definido
  try { fs.writeFileSync(FICHEIRO_CODIGO, codigoArranque + "\n"); } catch (e) {}
  return codigoArranque;
}
function apagarCodigoArranque() {
  codigoArranque = null;
  try { fs.unlinkSync(FICHEIRO_CODIGO); } catch (e) {}
}
function codigoArranqueAtual() { return codigoArranque; }

/* ---------------- sessões ---------------- */
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
setInterval(() => {
  const agoraT = Date.now();
  for (const [t, s] of sessoes) if (agoraT > s.expira) sessoes.delete(t);
}, 10 * 60 * 1000).unref();
function sessaoDe(req) {
  const t = tokenDe(req);
  if (!t) return null;
  const s = sessoes.get(t);
  if (!s) return null;
  if (Date.now() > s.expira) { sessoes.delete(t); return null; }
  return s;
}
function encerrarSessao(req) {
  const t = tokenDe(req);
  if (t) sessoes.delete(t);
}

/* ---------------- rate-limit (janela deslizante por IP) ----------------
   Rede interna, mas impede força-bruta ao PIN mesmo em LAN:
   6 tentativas por janela de 5 minutos por IP.                          */
const RL_JANELA_MS = 5 * 60 * 1000;
const RL_MAX = 6;
const rlTentativas = new Map();   // ip -> [timestamps]
function ipDe(req) { return req.socket.remoteAddress || "?"; }
function rateLimitPermitir(req) {
  const ip = ipDe(req);
  const agoraT = Date.now();
  const lista = (rlTentativas.get(ip) || []).filter(t => agoraT - t < RL_JANELA_MS);
  if (lista.length >= RL_MAX) {
    const espera = Math.ceil((RL_JANELA_MS - (agoraT - lista[0])) / 1000);
    rlTentativas.set(ip, lista);
    logOp("AVISO", "rate-limit: IP " + ip + " bloqueado por mais " + espera + " s");
    return { ok: false, espera };
  }
  lista.push(agoraT);
  rlTentativas.set(ip, lista);
  return { ok: true };
}
function rateLimitLimpar(req) {
  rlTentativas.delete(ipDe(req));   // login bem-sucedido reinicia a contagem
}

module.exports = {
  pinDefinido, definirPin, verificarPin,
  gerarCodigoArranque, apagarCodigoArranque, codigoArranqueAtual,
  novaSessao, sessaoDe, encerrarSessao,
  ipDe, rateLimitPermitir, rateLimitLimpar
};
