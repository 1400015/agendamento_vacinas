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

  /* ---- estado e PIN ---- */
  console.log("[PIN e sessões]");
  let r = await api("/api/estado");
  ok("GET /api/estado responde com pinDefinido (booleano)", typeof r.d.pinDefinido === "boolean");
  const pinDef = r.d.pinDefinido;

  if (pinDef) {
    r = await api("/api/login", { pin: "errado", posto: "Teste" });
    ok("PIN errado rejeitado (401)", r.s === 401);
    r = await api("/api/login", { pin: process.env.PIN_TESTE || "1234", posto: "Teste" });
    ok("PIN correto aceito", r.s === 200 && !!r.d.token);
    token = r.d.token;
  } else {
    r = await api("/api/setup", { pin: "abc", posto: "Teste" });
    ok("PIN curto rejeitado (400)", r.s === 400);
    r = await api("/api/setup", { pin: "1234", posto: "Teste" });
    ok("setup define PIN e devolve sessão", r.s === 200 && !!r.d.token);
    token = r.d.token;
    r = await api("/api/setup", { pin: "9999", posto: "X" });
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
  r = await api("/api/marcacoes/" + joaoMarc.id, { baseVersao: base, rev: joaoMarc.rev, estado: "cancelado", reagendar: true, novaData: "2099-09-23", novaHora: "11:30" }, "PUT");
  ok("reagendar cria marcação nova", r.s === 200 && !!r.d.novaId);
  base = r.d.versao;
  const dadosDepois = (await api("/api/dados")).d;
  const nova = dadosDepois.marcacoes.find(m => m.id === r.d.novaId);
  ok("marcação nova 'agendada' no novo slot", nova && nova.estado === "agendado" && nova.data === "2099-09-23" && nova.hora === "11:30");
  ok("marcação antiga libertou a hora original (cancelado)", !dadosDepois.marcacoes.some(m => m.utenteId === joao.id && m.data === D && m.hora === H && ["agendado", "administrado"].includes(m.estado)));

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

  /* ---- página ---- */
  console.log("\n[Interface]");
  const pg = await fetch(B + "/");
  const html = await pg.text();
  ok("página servida", pg.status === 200);
  ok("título correto", html.includes("Farmácia Boavista"));

  console.log("\n════════════════════════════════════════");
  console.log(`  Resultado: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.error("ERRO NA BATERIA:", e); process.exit(1); });
