#!/usr/bin/env node
"use strict";
/* ============================================================================
 * Central de Marcações de Vacinas — Farmácia Boavista (versão unificada)
 * ============================================================================
 * Servidor interno multi-posto, Node.js puro (sem dependências npm).
 * Ponto de entrada fino: a lógica vive em src/ (ver docs/ARQUITETURA.md):
 *   src/util.js          — validações, normalizações, log operacional
 *   src/armazenamento.js — carga/persistência com validação de schema
 *   src/config.js        — config.json validada (BOM, horários, defeitos)
 *   src/autenticacao.js  — PIN PBKDF2, código de arranque, sessões, rate-limit
 *   src/backup.js        — cópia diária rotativa (rede interna ou local)
 *   src/api.js           — rotas e regras de negócio
 *
 * Uso:  node servidor.js [porta]     (omissão 8080; alternativa: env PORTA)
 * ==========================================================================*/
const http = require("http");
const fs = require("fs");
const path = require("path");
const { networkInterfaces } = require("os");
const U = require("./src/util");
const ARM = require("./src/armazenamento");
const CFG_MOD = require("./src/config");
const A = require("./src/autenticacao");
const BK = require("./src/backup");
const { CAB_SEGURANCA, criarApi } = require("./src/api");

const PORTA = Number(process.argv[2] || process.env.PORTA || process.env.PORT || 8080);
if (!Number.isInteger(PORTA) || PORTA < 1 || PORTA > 65535) {
  console.error("Porta inválida — indique um número entre 1 e 65535, ex.:  node servidor.js 9090");
  process.exit(1);
}
const PASTA_PUBLICA = path.join(U.RAIZ, "public");

/* ----- modelo e contexto ----- */
const cfg = CFG_MOD.carregarConfig();
const horas = CFG_MOD.gerarHoras(cfg);
const horasSabado = CFG_MOD.gerarHorasSabado(cfg);
const dados = ARM.carregarDados();
BK.usarFicheiroDados(ARM.FICHEIRO_DADOS);

function registar(posto, acao, alvo, detalhe) {
  dados.historico.push({ quando: U.agora(), posto: posto || "?", acao, alvo, detalhe: String(detalhe || "").slice(0, 500) });
  if (dados.historico.length > 5000) dados.historico.splice(0, dados.historico.length - 5000);
}
const backupAuto = (forcar) => BK.backupAuto(dados, cfg, ARM.persistir, registar, forcar);
const api = criarApi({ dados, cfg, horas, horasSabado, persistir: ARM.persistir, registar, backupAuto });

/* ----- primeiro arranque: código de arranque ----- */
if (!A.pinDefinido()) {
  console.log("█▌ PRIMEIRO ARRANQUE: o PIN ainda não está definido.");
  console.log("█▌ Código de arranque (indique-o na página para definir o PIN):  " + A.gerarCodigoArranque());
  console.log("█▌ Ele é válido apenas enquanto o servidor não for reiniciado.");
  console.log("█▌ Quem tem este código controla a definição do PIN — não o partilhe.");
}
U.logOp("INFO", "arranque na porta " + PORTA);

/* ----- HTTP ----- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain; charset=utf-8", ".png": "image/png" };
function servirFicheiro(res, f) {
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404, CAB_SEGURANCA); res.end("Não encontrado"); return; }
    res.writeHead(200, Object.assign({ "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" }, CAB_SEGURANCA));
    res.end(buf);
  });
}

const servidor = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    let bruto = "";
    req.on("data", c => { bruto += c; if (bruto.length > 5e6) {
      res.writeHead(413, Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CAB_SEGURANCA));
      res.end('{"erro":"Pedido demasiado grande (máx. 5 MB)."}');
      req.destroy();
    } });
    req.on("end", () => {
      let corpo = {};
      try { corpo = JSON.parse(bruto || "{}"); } catch (e) {}
      api(req, res, corpo).catch(e => {
        U.logOp("ERRO", "API: " + (e && e.stack || e));
        console.error("Erro API:", e);
        res.writeHead(500, { "Content-Type": "application/json" }); res.end('{"erro":"erro interno"}');
      });
    });
    return;
  }
  if (req.url === "/" || req.url === "/index.html") return servirFicheiro(res, path.join(PASTA_PUBLICA, "index.html"));
  if (req.url.split("?")[0] === "/exemplo-utentes.txt") return servirFicheiro(res, path.join(U.RAIZ, "exemplo-utentes.txt"));
  if (req.url.split("?")[0] === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const rotaEstatica = req.url.split("?")[0];
  servirFicheiro(res, path.join(PASTA_PUBLICA, path.normalize(rotaEstatica).replace(/^([.][.][/\\])+/g, "")));
});

servidor.keepAliveTimeout = 60_000;
servidor.headersTimeout = 65_000;
servidor.listen(PORTA, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === "IPv4" && !i.internal).map(i => i.address);
  console.log("═".repeat(64));
  console.log("  Central de Marcações de Vacinas — Farmácia Boavista");
  console.log(`  Servidor na porta ${PORTA}  ·  horário ${cfg.horaInicio}–${cfg.horaFim} e ${cfg.horaInicio2}–${cfg.horaFim2} (cada ${cfg.intervaloMin} min)`);
  console.log(`  Sábado: ${cfg.sabadoInicio}–${cfg.sabadoFim} e ${cfg.sabadoInicio2}–${cfg.sabadoFim2} — marcações de sábado só nestes períodos`);
  console.log(`  Máx. por hora: ${cfg.maxPorHora} (exceção justificada com motivo)`);
  console.log(`  Neste computador:  http://localhost:${PORTA}`);
  (ips.length ? ips : ["<ip-do-servidor>"]).forEach(ip => console.log(`  Nos postos da frente: http://${ip}:${PORTA}`));
  console.log(`  Dados: ${ARM.FICHEIRO_DADOS}   (não editar com o servidor a correr)`);
  console.log("  Ctrl+C para parar. Não fechar esta janela durante o serviço.");
  console.log("═".repeat(64));
});
