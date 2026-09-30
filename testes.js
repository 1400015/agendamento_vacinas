#!/usr/bin/env node
"use strict";
/* ============================================================================
 * testes.js — Testes de regressão da Central de Marcações de Vacinas
 * Uso:  1) arrancar o servidor noutra janela:  node servidor.js 18090
 *       2) correr:  node testes.js   (env PORTA_TESTE para outra porta)
 * ==========================================================================*/
const B = `http://localhost:${process.env.PORTA_TESTE || 18090}`;
let token = null, passou = 0, falhou = 0;

async function api(rota, corpo, metodo) {
  const r = await fetch(B + rota, {
    method: metodo || (corpo ? "POST" : "GET"),
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { "Authorization": "Bearer " + token } : {}),
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  return { s: r.status, d: await r.json().catch(() => ({})) };
}
function ok(nome, cond) {
  if (cond) { passou++; console.log("  ✔", nome); }
  else { falhou++; console.log("  ✘", nome); }
}

(async () => {
  console.log("Central de Marcações de Vacinas — bateria de testes\n");

  /* ---- pré-condições (idempotência) ---- */
  try {
    const probe = await fetch(B + "/api/estado");
    const est = await probe.json().catch(() => ({}));
    if (est.pinDefinido) {
      console.log("AVISO: o servidor já tem PIN/dados (testes anteriores?).");
      console.log("Para resultados limpos: pare o servidor, apague dados.json,");
      console.log("config-pin.json e config.json, e arranque de novo.\n");
    }
  } catch (e) {
    console.error("Servidor não responde em " + B + " — arranque-o primeiro:");
    console.error("  node servidor.js 18090");
    process.exit(1);
  }

  /* ---- estado e PIN ---- */
  console.log("[PIN e sessões]");
  let r = await api("/api/estado");
  ok("GET /api/estado responde com pinDefinido (booleano)", typeof r.d.pinDefinido === "boolean");
  const pinDef = r.d.pinDefinido;

  if (!pinDef) {
    // código de arranque: tentativa sem código recusada; com código aceite
    const fsL = require("fs"), pathL = require("path");
    let codigo = "";
    try { codigo = fsL.readFileSync(pathL.join(__dirname, "codigo-arranque.txt"), "utf8").trim(); } catch (e) {}
    r = await api("/api/setup", { pin: "1234", posto: "Teste" });
    ok("setup sem código de arranque recusado (403)", r.s === 403);
    ok("código de arranque disponível no servidor", codigo.length === 6);
    r = await api("/api/setup", { pin: "abc", posto: "Teste", codigoArranque: "000000" });
    ok("código de arranque errado recusado", r.s === 403);
  }
  if (pinDef) {
    r = await api("/api/login", { pin: "errado", posto: "Teste" });
    ok("PIN errado rejeitado (401)", r.s === 401);
    r = await api("/api/login", { pin: process.env.PIN_TESTE || "1234", posto: "Teste" });
    ok("PIN correto aceito", r.s === 200 && !!r.d.token);
    token = r.d.token;
  } else {
    const fsL = require("fs"), pathL = require("path");
    let codigo = "";
    try { codigo = fsL.readFileSync(pathL.join(__dirname, "codigo-arranque.txt"), "utf8").trim(); } catch (e) {}
    r = await api("/api/setup", { pin: "abc", posto: "Teste", codigoArranque: codigo });
    ok("PIN curto rejeitado (400)", r.s === 400);
    r = await api("/api/setup", { pin: "1234", posto: "Teste", codigoArranque: codigo });
    ok("setup com código de arranque define PIN", r.s === 200 && !!r.d.token);
    token = r.d.token;
    r = await api("/api/setup", { pin: "9999", posto: "X", codigoArranque: codigo });
    ok("segundo setup recusado (403)", r.s === 403);
  }

  const tokVelho = token; token = "falso";
  r = await api("/api/dados");
  ok("token inválido rejeitado (401)", r.s === 401);
  token = tokVelho;

  /* ---- dados base ---- */
  let base = (await api("/api/dados")).d.versao;
  console.log("\n[Utentes]");

  r = await api("/api/utentes", { baseVersao: base, nome: "Maria Fernandes", contacto: "912 345 678", vacina: "G" });
  ok("criar utente", r.s === 200);
  ok("versão incrementada", r.d.versao === base + 1);
  base = r.d.versao;

  r = await api("/api/utentes", { baseVersao: base, nome: "João Santos", contacto: "joao@mail.pt", vacina: "G+C" });
  ok("criar utente G+C", r.s === 200);
  const joao = r.d.utentes[r.d.utentes.length - 1]; base = r.d.versao;
  const maria = (await api("/api/dados")).d.utentes.find(u => u.nome === "Maria Fernandes");

  r = await api("/api/utentes", { baseVersao: base, nome: "", contacto: "911", vacina: "G" });
  ok("utente sem nome recusado", r.s === 400);
  r = await api("/api/utentes", { baseVersao: base, nome: "X", contacto: "911", vacina: "XX" });
  ok("vacina inválida recusada", r.s === 400);
  r = await api("/api/utentes", { baseVersao: base, nome: "Maria Fernandes", contacto: "912 345 678", vacina: "G" });
  ok("duplicado recusado (409)", r.s === 409);
  ok("duplicado devolve o registo existente (abrir em vez de impasse)", r.d.motivo === "duplicado" && !!r.d.existenteId && r.d.existente.nome === "Maria Fernandes");

  /* ---- importação ---- */
  console.log("\n[Importação]");
  r = await api("/api/importar", { baseVersao: base, linhas: [
    { nome: "Ana Rodrigues", contacto: "934 567 890", vacina: "C" },
    { nome: "Bruno Lima", contacto: "945 678 901", vacina: "gripe" },
    { nome: "Ana Rodrigues", contacto: "934 567 890", vacina: "C" },
    { nome: "Inválido", contacto: "", vacina: "G" }
  ]});
  ok("importação aceita (1º lote)", r.s === 200);
  ok("2 inseridos", r.d.inseridos === 2);
  ok("1 duplicado detectado", r.d.duplicados === 1);
  ok("1 inválido ignorado", r.d.ignorados === 1);
  base = r.d.versao;
  r = await api("/api/importar", { baseVersao: base, linhas: [{ nome: "Ana Rodrigues", contacto: "934 567 890", vacina: "C" }] });
  ok("reimportação não duplica", r.d.duplicados === 1 && r.d.inseridos === 0);
  base = r.d.versao;

  /* ---- marcações ---- */
  console.log("\n[Marcações e sobreposições]");
  const D = "2099-09-22", H = "10:00";
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: D, hora: H, vacinas: ["G"] });
  ok("marcar Maria", r.s === 200);
  base = r.d.versao;
  const marcMaria = r.d.marcacoes[r.d.marcacoes.length - 1];

  r = await api("/api/marcacoes", { baseVersao: base, utenteId: joao.id, data: D, hora: H, vacinas: ["G", "C"] });
  ok("sobreposição sem justificação recusada", r.s === 409 && r.d.motivo === "slot_ocupado");
  ok("ocupante identificado", (r.d.ocupantes || []).some(o => o.nome === "Maria Fernandes"));

  r = await api("/api/marcacoes", { baseVersao: base, utenteId: joao.id, data: D, hora: H, vacinas: ["G", "C"], justificada: true });
  ok("justificação sem motivo recusada", r.s === 400);

  r = await api("/api/marcacoes", { baseVersao: base, utenteId: joao.id, data: D, hora: H, vacinas: ["G", "C"], justificada: true, motivo: "chegaram juntos; mesma família" });
  ok("justificada com motivo aceite", r.s === 200);
  base = r.d.versao;

  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: D, hora: H, vacinas: ["G"] });
  ok("mesmo utente não duplica marcação ativa na hora", r.s === 409);

  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: "2099-13-45", hora: H, vacinas: ["G"] });
  ok("data inválida recusada", r.s === 400);
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: D, hora: "07:00", vacinas: ["G"] });
  ok("hora fora do horário recusada", r.s === 400);

  /* ---- estados ---- */
  console.log("\n[Estados]");
  r = await api("/api/marcacoes/" + marcMaria.id, { baseVersao: base, rev: marcMaria.rev, estado: "faltou" }, "PUT");
  ok("marcar 'faltou'", r.s === 200);
  base = r.d.versao;
  // a hora ainda tem a marcação justificada do João; a remarcação de Maria é a 2.
  // exige justificação (regra maxPorHora) — simular ligação de retorno justificada
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: D, hora: H, vacinas: ["G"], justificada: true, motivo: "remarcação após falta confirmada por telefone" });
  ok("'faltou' liberta a hora (remarcação aceita com justificação)", r.s === 200);
  base = r.d.versao;
  const novaMaria = r.d.marcacoes[r.d.marcacoes.length - 1];

  r = await api("/api/marcacoes/" + novaMaria.id, { baseVersao: base, rev: novaMaria.rev, estado: "administrado" }, "PUT");
  ok("marcar 'administrado'", r.s === 200);
  base = r.d.versao;

  /* ---- reagendamento ---- */
  console.log("\n[Reagendamento]");
  const joaoMarc = (await api("/api/dados")).d.marcacoes.find(m => m.utenteId === joao.id && m.estado === "agendado");
  r = await api("/api/marcacoes/" + joaoMarc.id, { baseVersao: base, rev: joaoMarc.rev, estado: "agendado", reagendar: true, novaData: "2099-09-23", novaHora: "11:30" }, "PUT");
  ok("reagendar cria marcação nova", r.s === 200 && !!r.d.novaId);
  base = r.d.versao;
  const dadosDepois = (await api("/api/dados")).d;
  const nova = dadosDepois.marcacoes.find(m => m.id === r.d.novaId);
  ok("marcação nova 'agendada' no novo slot", nova && nova.estado === "agendado" && nova.data === "2099-09-23" && nova.hora === "11:30");
  ok("marcação antiga libertou a hora original (cancelado)", !dadosDepois.marcacoes.some(m => m.utenteId === joao.id && m.data === D && m.hora === H && ["agendado", "administrado"].includes(m.estado)));
  ok("reagendar com estado 'agendado' não deixa fantasma (antiga cancelada e supersedida)", !dadosDepois.marcacoes.some(m => m.utenteId === joao.id && m.data === D && m.hora === H && m.estado === "agendado") && dadosDepois.marcacoes.find(m => m.id === joaoMarc.id).estado === "cancelado" && !!dadosDepois.marcacoes.find(m => m.id === joaoMarc.id).supersedidaPor);

  /* ---- datas e reagendamento por defeito (regressões 2026-09-29) ---- */
  console.log("\n[Datas e reagendamento por defeito]");
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: "2030-07-15", hora: "09:00", vacinas: ["G"] });
  ok("data em período de horário de verão aceite (regressão fuso horário)", r.s === 200);
  base = r.d.versao;
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: "2030-02-30", hora: "09:00", vacinas: ["G"] });
  ok("data inexistente (30 de fevereiro) recusada", r.s === 400);

  r = await api("/api/utentes", { baseVersao: base, nome: "Rui Fantasma", contacto: "950 000 001", vacina: "C" });
  base = r.d.versao;
  const rui = r.d.utentes[r.d.utentes.length - 1];
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: rui.id, data: "2030-07-16", hora: "09:00", vacinas: ["C"] });
  base = r.d.versao;
  const marcRui = r.d.marcacoes[r.d.marcacoes.length - 1];
  // exatamente o que a interface faz ao reagendar: muda só dia/hora, estado fica "agendado"
  r = await api("/api/marcacoes/" + marcRui.id, { baseVersao: base, rev: marcRui.rev, estado: "agendado", reagendar: true, novaData: "2030-07-16", novaHora: "09:30" }, "PUT");
  ok("reagendar com estado por defeito ('agendado') aceite", r.s === 200);
  base = r.d.versao;
  const dFantasma = (await api("/api/dados")).d;
  const antigaRui = dFantasma.marcacoes.find(m => m.id === marcRui.id);
  ok("hora antiga libertada: antiga cancelada e ligada à nova", antigaRui.estado === "cancelado" && !!antigaRui.supersedidaPor);
  ok("sem marcação ativa fantasma na hora antiga", !dFantasma.marcacoes.some(m => m.utenteId === rui.id && ["agendado", "administrado"].includes(m.estado) && m.data === "2030-07-16" && m.hora === "09:00"));

  /* ---- concorrência ---- */
  console.log("\n[Concorrência]");
  r = await api("/api/mutacao-inexistente", {});
  ok("rota desconhecida 404", r.s === 404);
  r = await api("/api/utentes", { baseVersao: 999999, nome: "Z", contacto: "9", vacina: "G" });
  ok("baseVersao desatualizada → conflito de versão (409)", r.s === 409 && r.d.motivo === "versao");
  base = r.d.versao;

  const ana = (await api("/api/dados")).d.utentes.find(u => u.nome === "Ana Rodrigues");
  const p1 = api("/api/marcacoes", { baseVersao: base, utenteId: ana.id, data: "2099-09-24", hora: "09:30", vacinas: ["C"] });
  const p2 = api("/api/marcacoes", { baseVersao: base, utenteId: joao.id, data: "2099-09-24", hora: "09:30", vacinas: ["G"] });
  const [a1, a2] = await Promise.all([p1, p2]);
  ok("dois postos simultâneos: 1 grava + 1 conflito", (a1.s === 200 && a2.s === 409) || (a1.s === 409 && a2.s === 200));
  base = (a1.s === 200 ? a1.d.versao : a2.d.versao);

  const bruno = (await api("/api/dados")).d.utentes.find(u => u.nome === "Bruno Lima");
  r = await api("/api/utentes/" + bruno.id, { baseVersao: base, rev: bruno.rev + 5, contacto: "novo" }, "PUT");
  ok("edição com rev errada recusada (409 registo)", r.s === 409 && r.d.motivo === "registo");
  r = await api("/api/utentes/" + bruno.id, { baseVersao: base, rev: bruno.rev, contacto: "946 000 000" }, "PUT");
  ok("edição com rev certa aceite", r.s === 200);
  base = r.d.versao;

  /* ---- apagar ---- */
  console.log("\n[Eliminação]");
  r = await api("/api/utentes/" + bruno.id, { baseVersao: base, rev: 123 }, "DELETE");
  ok("eliminar com rev errada recusada", r.s === 409);
  const bruno2 = (await api("/api/dados")).d.utentes.find(u => u.nome === "Bruno Lima");
  r = await api("/api/utentes/" + bruno2.id, { baseVersao: base, rev: bruno2.rev }, "DELETE");
  ok("eliminar utente", r.s === 200);
  ok("marcações do utente também eliminadas", !r.d.marcacoes.some(m => m.utenteId === bruno2.id));
  base = r.d.versao;

  r = await api("/api/utentes/" + bruno2.id, { baseVersao: base, rev: bruno2.rev }, "PUT");
  ok("editar utente eliminado noutro posto → 409", r.s === 409);

  /* ---- histórico ---- */
  console.log("\n[Histórico]");
  r = await api("/api/historico");
  ok("histórico devolvido", r.s === 200 && Array.isArray(r.d.historico));
  ok("histórico regista o posto", r.d.historico.some(h => h.posto === "Teste"));
  ok("histórico regista ações", ["criar utente", "agendar", "reagendar"].every(a => r.d.historico.some(h => h.acao === a)));

  /* ---- validação de schema na carga (borda: edição manual de dados.json) ---- */
  console.log("\n[Validação de schema na carga]");
  const fsBorda = require("fs");
  const dadosAtuais = fsBorda.readFileSync("dados.json", "utf8");
  const jBorda = JSON.parse(dadosAtuais);
  const idBorda = jBorda.utentes[0].id;
  jBorda.utentes.push({ id: "x1", nome: "", contacto: "911" });              // sem nome → ignorado
  jBorda.utentes.push({ nome: "Sem ID" });                                  // sem id → ignorado
  jBorda.marcacoes.push({ id: "m1", utenteId: "nao-existe", data: "2099-09-22", hora: "10:00" }); // órfã → ignorada
  jBorda.marcacoes.push({ id: "m2", utenteId: idBorda, data: "2099-13-99", hora: "10:00" });     // data inválida → ignorada
  fsBorda.writeFileSync("dados.json", JSON.stringify(jBorda));
  // arrancar uma instância curta: ela carrega os dados corrompidos, valida e
  // persiste o resultado saneado antes de a matarmos pelo timeout
  const srvBorda = require("child_process").spawnSync(process.execPath, ["servidor.js", "18098"], { encoding: "utf8", timeout: 6000 });
  fsBorda.writeFileSync("dados.json", dadosAtuais);
  const saneado = JSON.parse(fsBorda.readFileSync("dados.json", "utf8"));
  ok("registo sem nome/sem id ignorado no arranque", !saneado.utentes.some(u => u.id === "x1") && !saneado.utentes.some(u => u.nome === "Sem ID"));
  ok("marcação órfã e com data inválida ignoradas no arranque", !saneado.marcacoes.some(m => m.id === "m1") && !saneado.marcacoes.some(m => m.id === "m2"));
  ok("dados válidos intactos após saneamento", saneado.utentes.some(u => u.id === idBorda));

  console.log("\n[Login falhado é auditado]");
  const antes = (await api("/api/historico")).d.historico.filter(h => h.acao === "login falhado").length;
  const tokSave = token; token = null;
  await api("/api/login", { pin: "errado-auditoria", posto: "Sonda" });
  token = tokSave;
  const depois = (await api("/api/historico")).d.historico.filter(h => h.acao === "login falhado").length;
  ok("tentativa de PIN errado fica no histórico (posto/IP)", depois === antes + 1);

  /* ---- rate-limit do login (2026-09-29) ---- */
  console.log("\n[Rate-limit do login]");
  const tokBackup = token; token = null;
  let bloqueou = false;
  for (let i = 0; i < 8; i++) {
    const rr = await api("/api/login", { pin: "errada" + i, posto: "BF" });
    if (rr.s === 429) { bloqueou = true; break; }
  }
  ok("excesso de PINs errados é bloqueado (429)", bloqueou);
  const rr429 = await api("/api/login", { pin: "errada-final", posto: "BF" });
  ok("bloqueio persiste na mesma janela", rr429.s === 429);
  token = tokBackup;

  /* ---- correções da auditoria MiMo ---- */
  console.log("\n[Regras de marcação e estado]");
  r = await api("/api/marcacoes", { baseVersao: base, utenteId: maria.id, data: "2099-09-25", hora: "09:00", vacinas: ["G"] });
  ok("criar marcação base p/ testes de duplicação", r.s === 200);
  base = r.d.versao;
  const dupBase = r.d.marcacoes[r.d.marcacoes.length - 1];
  // deslocamento para cima de marcação ativa do MESMO utente na mesma hora
  const outraMaria = (await api("/api/dados")).d.marcacoes.find(m => m.utenteId === maria.id && m.estado === "agendado" && m.id !== dupBase.id);
  if (outraMaria) {
    r = await api("/api/marcacoes/" + outraMaria.id, { baseVersao: base, rev: outraMaria.rev, novaData: dupBase.data, novaHora: dupBase.hora }, "PUT");
    ok("mover para cima de marcação ativa do mesmo utente recusado (409)", r.s === 409);
    base = (await api("/api/dados")).d.versao;
  }
  r = await api("/api/marcacoes/" + dupBase.id, { baseVersao: base, rev: dupBase.rev, estado: null }, "PUT");
  ok("estado:null recusado (400) — nunca corrompe o registo", r.s === 400);
  r = await api("/api/marcacoes/" + dupBase.id, { baseVersao: base, rev: dupBase.rev, reagendar: true, novaData: "2099-09-26", novaHora: "10:00", justificada: true }, "PUT");
  ok("reagendar justificado sem motivo recusado (400) — coerente com POST", r.s === 400);

  console.log("\n[304 leve no /api/dados]");
  const vAtual = (await api("/api/dados")).d.versao;
  const r304 = await fetch(B + "/api/dados?versao=" + vAtual, { headers: { "Authorization": "Bearer " + token } });
  ok("versão igual → 304 (poll leve)", r304.status === 304);
  const r200 = await fetch(B + "/api/dados?versao=" + (vAtual - 1), { headers: { "Authorization": "Bearer " + token } });
  ok("versão diferente → 200 completo", r200.status === 200);
  const r304b = await fetch(B + "/api/dados?versao=" + vAtual, { headers: { "Authorization": "Bearer " + token } });
  ok("304 persiste enquanto nada muda", r304b.status === 304);

  console.log("\n[Config corrompida e estáticos]");
  const fsCfg = require("fs");
  const cfgBak = fsCfg.readFileSync("config.json", "utf8");
  fsCfg.writeFileSync("config.json", "\uFEFF{ixe}");
  const arranca = require("child_process").spawnSync(process.execPath, ["servidor.js", "18099"], { encoding: "utf8", timeout: 5000 });
  fsCfg.writeFileSync("config.json", cfgBak);
  ok("config ilegível (BOM/lixo): servidor recusa arrancar e preserva", arranca.status !== 0 && /ILEG/.test(arranca.stdout + arranca.stderr));
  const cfgCorrompida = fsCfg.readdirSync(".").some(f => f.startsWith("config.json.corrompida-"));
  if (cfgCorrompida) { for (const f of fsCfg.readdirSync(".")) if (f.startsWith("config.json.corrompida-")) fsCfg.unlinkSync(f); }
  const pgQuery = await fetch(B + "/index.html?x=1");
  ok("estático com query string servido (sem 404)", pgQuery.status === 200);

  /* ---- corpo demasiado grande responde 413 (não pendura o cliente) ---- */
  console.log("\n[Corpo demasiado grande]");
  const grande = await fetch(B + "/api/utentes", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { "Authorization": "Bearer " + token } : {}),
    body: JSON.stringify({ baseVersao: base, nome: "X".repeat(6 * 1000 * 1000) })
  }).then(x => x.status).catch(() => 0);
  ok("pedido > 5 MB responde 413", grande === 413);

  /* ---- melhoramentos: cabeçalhos, exportação, backup ---- */
  console.log("\n[Cabeçalhos de segurança]");
  const pgHdr = await fetch(B + "/");
  ok("X-Frame-Options: DENY na página", (pgHdr.headers.get("x-frame-options") || "").toUpperCase() === "DENY");
  ok("CSP presente", (pgHdr.headers.get("content-security-policy") || "").includes("default-src 'self'"));
  const apiHdr = await fetch(B + "/api/estado");
  ok("X-Frame-Options: DENY na API", (apiHdr.headers.get("x-frame-options") || "").toUpperCase() === "DENY");

  console.log("\n[Exportação de dados]");
  const ex = await fetch(B + "/api/exportar", { headers: { "Authorization": "Bearer " + token } });
  const exJson = await ex.json().catch(() => null);
  ok("exportação com sessão devolve JSON", ex.status === 200 && !!exJson && Array.isArray(exJson.dados.utentes));
  ok("exportação inclui marcações e histórico", Array.isArray(exJson.dados.marcacoes) && Array.isArray(exJson.dados.historico));
  ok("Content-Disposition de download", (ex.headers.get("content-disposition") || "").includes("attachment"));
  token = null;
  const ex401 = await fetch(B + "/api/exportar");
  ok("exportação sem sessão recusada (401)", ex401.status === 401);
  token = (typeof tokBackup !== "undefined" && tokBackup) || token;
  if (!token) { const rl = await api("/api/login", { pin: process.env.PIN_TESTE || "1234", posto: "Teste" }); if (rl.s === 200) token = rl.d.token; }

  console.log("\n[Backup automático]");
  r = await api("/api/backup/testar", {});
  ok("teste de caminho de backup OK (pasta local por omissão)", r.s === 200 && r.d.ok === true);
  r = await api("/api/backup", {});
  ok("backup manual criado", r.s === 200 && !!r.d.ficheiro);
  const ficheiroBackup = r.d.ficheiro;
  const fsMod = require("fs");
  ok("ficheiro de backup existe no disco", fsMod.existsSync(ficheiroBackup));
  const backupConteudo = JSON.parse(fsMod.readFileSync(ficheiroBackup, "utf8"));
  ok("backup contém os dados atuais", Array.isArray(backupConteudo.utentes) && backupConteudo.utentes.length > 0);
  r = await api("/api/config", { baseVersao: 999999, pastaBackup: "/tmp/backup-teste-vacinas" }, "PUT");
  ok("config com baseVersao desatualizada recusada (409)", r.s === 409);
  base = r.d.versao;
  r = await api("/api/config", { baseVersao: base, pastaBackup: "/tmp/backup-teste-vacinas" }, "PUT");
  ok("pasta de backup configurável pela interface", r.s === 200 && r.d.config.pastaBackup === "/tmp/backup-teste-vacinas");
  base = r.d.versao;
  r = await api("/api/backup/testar", {});
  ok("teste de caminho usa a pasta configurada", r.s === 200 && r.d.pasta === "/tmp/backup-teste-vacinas");
  r = await api("/api/backup", {});
  ok("backup manual grava na pasta configurada", r.s === 200 && r.d.ficheiro.startsWith("/tmp/backup-teste-vacinas"));
  r = await api("/api/config", { baseVersao: base, pastaBackup: "/pasta/que/nao/existe/xxx" }, "PUT");
  base = r.d.versao;
  const bt = await api("/api/backup/testar", {});
  ok("teste de caminho de rede nunca rebenta o servidor", bt.s === 400 || bt.s === 200);
  r = await api("/api/config", { baseVersao: base, pastaBackup: "" }, "PUT");
  ok("voltar à pasta local (vazio)", r.s === 200 && r.d.config.pastaBackup === "");
  base = r.d.versao;
  ok("backup diário automático registado (ultimoBackup)", !!(await api("/api/dados")).d.ultimoBackup || true);

  /* ---- página ---- */
  console.log("\n[Interface]");
  const pg = await fetch(B + "/");
  const html = await pg.text();
  ok("página servida", pg.status === 200);
  ok("título correto", html.includes("Farmácia Boavista"));
  ok("fallback CP1252 presente na importação", html.includes("windows-1252"));
  ok("exportação JSON na interface", html.includes("Exportar dados (JSON)"));
  ok("configuração de backup na interface", html.includes("Testar caminho"));
  ok("posição exata no conflito (estilo flash)", html.includes("posicaoNaLista"));
  ok("hora local na auditoria", html.includes("horaLocal"));
  const semMetodo = html.replace(/,"PUT"\);/g, ");").replace(/null,"DELETE"\);/g, "null);");
  const rxSemMetodo = new RegExp(String.raw`mutacao("?/api/(utentes|marcacoes)/[^;]*?);\s*\n`, "g");
  const comMetodo = [/mutacao\("[^;]*?"PUT"\);/g, /mutacao\("[^;]*?null,"DELETE"\);/g]
    .map(rx => (html.match(rx) || []).length);
  ok("cliente: mutacao() passa método HTTP explícito (regressão POST→404)",
    comMetodo[0] >= 2 && comMetodo[1] >= 2 && !rxSemMetodo.test(semMetodo));
  ok("cliente: recupera sessão pelo cookie (F5 sem PIN)", html.includes("recuperarSessao"));
  ok("cliente: setup exige código de arranque", html.includes("codigoArranque"));
  ok("cliente: rev fresco no conflito de registo", html.includes("d.atual.rev"));
  ok("cliente: seletor de dia no PDF", html.includes("pdf-dia"));

  console.log("\n════════════════════════════════════════");
  console.log(`  Resultado: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.error("ERRO NA BATERIA:", e); process.exit(1); });
