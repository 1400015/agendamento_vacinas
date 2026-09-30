#!/usr/bin/env node
"use strict";
/* ============================================================================
 * testes-cliente.js — Testes de INTERFACE (o cliente a correr a sério)
 * ============================================================================
 * Executa `public/app.js` num DOM mínimo (Node `vm`, sem browser e sem
 * dependências) e verifica o comportamento real das regras por dia:
 *   - o sábado usa o horário próprio (09:30–12:00 e 15:00–17:00) e avisa;
 *   - o domingo é recusado no cliente, antes de chegar ao servidor;
 *   - a grelha do calendário marca as células fora dos períodos como
 *     indisponíveis (não clicáveis);
 *   - o escape de HTML nos textos.
 * Complementa `testes.js` (servidor/API): este ficheiro não precisa de
 * servidor a correr.  Uso:  node testes-cliente.js
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passou = 0, falhou = 0;
function ok(nome, cond) { if (cond) { passou++; console.log("  ✔", nome); } else { falhou++; console.log("  ✘", nome); } }
function igual(nome, a, b) { ok(nome, JSON.stringify(a) === JSON.stringify(b)); }

const HORAS = ["08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
  "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00", "19:30"];
const HORAS_SAB = ["09:30", "10:00", "10:30", "11:00", "11:30", "12:00",
  "15:00", "15:30", "16:00", "16:30", "17:00"];

/* ---- DOM mínimo reutilizado por todos os testes ---- */
function novoElemento(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", className: "", hidden: false, checked: false,
    style: {}, children: [],
    addEventListener() {}, appendChild(c) { this.children.push(c); }, click() {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }
  };
}
function carregar() {
  const elementos = new Map();
  const document = {
    getElementById(id) {
      if (!elementos.has(id)) {
        const e = novoElemento(id);
        if (id === "modal") e.hidden = true;   // sem modal aberto: renderTudo corre
        elementos.set(id, e);
      }
      return elementos.get(id);
    },
    createElement(tag) { return novoElemento(tag); }
  };
  const alertas = [], confirmacoes = [], chamadas = [];
  let resposta = true;
  const sandbox = {
    document, window: {}, location: { reload() {} },
    console,
    alert: m => alertas.push(String(m)),
    confirm: m => { confirmacoes.push(String(m)); return resposta; },
    prompt: () => null,
    setInterval: () => 0, clearInterval: () => {},
    setTimeout: () => 0, clearTimeout: () => {},
    fetch: async (url, opt) => {
      chamadas.push({ url: String(url), method: (opt && opt.method) || "GET", headers: (opt && opt.headers) || {}, body: (opt && opt.body) || "" });
      if (String(url).startsWith("/api/exportar.csv"))
        return { status: 200, json: async () => ({}), blob: async () => "blob" };
      return { status: 401, json: async () => ({}) };
    },
    URLSearchParams,
    URL: { createObjectURL: () => "blob:teste", revokeObjectURL() {} },
    Date, JSON, Math, String, Number, Boolean, Array, Object, RegExp, Promise, Set, Map, Error
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "public", "app.js"), "utf8"), sandbox, { filename: "public/app.js" });
  return {
    sandbox, document, alertas, confirmacoes, chamadas,
    el: id => document.getElementById(id),
    responder(v) { resposta = v; },
    /* estado da aplicação (as variáveis são lexicais: entram por aplicarResposta) */
    estado(marcacoes, cfgExtra) {
      sandbox.aplicarResposta({
        versao: 1, utentes: [], marcacoes: marcacoes || [],
        config: Object.assign({
          horaInicio: "08:30", horaFim: "12:00", horaInicio2: "14:30", horaFim2: "19:30",
          sabadoInicio: "09:30", sabadoFim: "12:00", sabadoInicio2: "15:00", sabadoFim2: "17:00",
          mostrarSabado: true, maxPorHora: 2, intervaloMin: 30, pastaBackup: "", diasFechados: []
        }, cfgExtra || {}),
        horas: HORAS, horasSabado: HORAS_SAB
      });
      sandbox.irParaSemanaAtual();
    }
  };
}

(async () => {
  console.log("Central de Marcações de Vacinas — testes de interface (cliente)\n");
  const c = carregar();
  const S = c.sandbox;

  if (typeof S.horasDoDia !== "function")
    throw new Error("public/app.js não expôs as funções do cliente — verificar o carregamento no DOM mínimo");

  console.log("[Escape de HTML]");
  ok("esc() neutraliza tags e aspas",
    S.esc('<b class="x">A & B</b>') === "&lt;b class=&quot;x&quot;&gt;A &amp; B&lt;/b&gt;");

  console.log("\n[Dia da semana (sem fuso)]");
  ok("sábado é o dia 6", S.diaDaSemanaISO("2099-10-03") === 6);
  ok("domingo é o dia 0", S.diaDaSemanaISO("2099-10-04") === 0);
  ok("terça-feira é o dia 2", S.diaDaSemanaISO("2099-09-22") === 2);

  console.log("\n[Horas por dia]");
  c.estado();
  igual("sábado usa o horário próprio", S.horasDoDia("2099-10-03"), HORAS_SAB);
  igual("dia útil usa o horário normal", S.horasDoDia("2099-09-22"), HORAS);
  ok("opções de hora de sábado não oferecem 08:30, 14:30 nem 17:30",
    !S.opcoesHoras("2099-10-03", null).includes("08:30") &&
    !S.opcoesHoras("2099-10-03", null).includes("14:30") &&
    !S.opcoesHoras("2099-10-03", null).includes("17:30"));
  ok("opções de hora de sábado incluem 09:30 e 15:00",
    S.opcoesHoras("2099-10-03", null).includes("09:30") && S.opcoesHoras("2099-10-03", null).includes("15:00"));

  console.log("\n[Células válidas da grelha (sábado reduzido)]");
  ok("sábado às 09:30 é marcável", S.celulaDisponivel("2099-10-03", "09:30") === true);
  ok("sábado às 12:00 é marcável", S.celulaDisponivel("2099-10-03", "12:00") === true);
  ok("sábado às 15:00 é marcável", S.celulaDisponivel("2099-10-03", "15:00") === true);
  ok("sábado às 17:00 é marcável", S.celulaDisponivel("2099-10-03", "17:00") === true);
  ok("sábado às 08:30 não é marcável", S.celulaDisponivel("2099-10-03", "08:30") === false);
  ok("sábado às 13:00 não é marcável", S.celulaDisponivel("2099-10-03", "13:00") === false);
  ok("sábado às 17:30 não é marcável", S.celulaDisponivel("2099-10-03", "17:30") === false);
  ok("dia útil às 08:30 continua marcável", S.celulaDisponivel("2099-09-22", "08:30") === true);

  console.log("\n[Nota por dia]");
  ok("sábado mostra o aviso de que não se vacina ao sábado", /SÁBADO/.test(S.notaDoDia("2099-10-03")) && /não se vacina/.test(S.notaDoDia("2099-10-03")));
  ok("domingo avisa que não há vacinação", /domingo/.test(S.notaDoDia("2099-10-04")));
  ok("dia útil não mostra nota", S.notaDoDia("2099-09-22") === "");

  console.log("\n[Confirmação por dia]");
  const nAlertas = c.alertas.length, nConf = c.confirmacoes.length;
  ok("domingo é recusado no cliente", S.confirmarDia("2099-10-04", "marcação") === false);
  ok("domingo recusado avisa o utilizador", c.alertas.length === nAlertas + 1 && /domingo/.test(c.alertas[c.alertas.length - 1]));
  ok("domingo não chega a pedir confirmação", c.confirmacoes.length === nConf);
  c.responder(false);
  ok("sábado pede confirmação (cancelar devolve false)", S.confirmarDia("2099-10-03", "marcação") === false);
  ok("o pedido de confirmação diz que é sábado", /SÁBADO/.test(c.confirmacoes[c.confirmacoes.length - 1]));
  c.responder(true);
  ok("sábado confirmado devolve true", S.confirmarDia("2099-10-03", "marcação") === true);
  ok("dia útil não pede confirmação", S.confirmarDia("2099-09-22", "marcação") === true);

  console.log("\n[Marcar: bloqueios reais (confirmarMarcar)]");
  c.responder(true);
  c.el("modal").hidden = false;
  c.el("m-data").value = "2099-10-04"; c.el("m-hora").value = "10:00"; c.el("m-vac").value = "G";
  await S.confirmarMarcar("u1");
  ok("marcar ao domingo é bloqueado (modal continua aberto)", c.el("modal").hidden === false);
  ok("marcar ao domingo explica o motivo", /domingo/.test(c.alertas[c.alertas.length - 1]));
  c.responder(false);
  c.el("modal").hidden = false;
  c.el("m-data").value = "2099-10-03"; c.el("m-hora").value = "10:00";
  await S.confirmarMarcar("u1");
  ok("sábado sem confirmação não avança (modal continua aberto)", c.el("modal").hidden === false);
  c.responder(true);
  c.el("modal").hidden = false;
  c.el("m-data").value = "2099-10-03"; c.el("m-hora").value = "10:00";
  await S.confirmarMarcar("u1");
  ok("sábado confirmado avança (modal fecha)", c.el("modal").hidden === true);
  c.el("modal").hidden = false;
  c.el("m-data").value = "2099-10-03"; c.el("m-hora").value = "13:00";
  await S.confirmarMarcar("u1");
  ok("sábado fora dos períodos é bloqueado no cliente", c.el("modal").hidden === false && /fora do horário de sábado/.test(c.alertas[c.alertas.length - 1]));

  console.log("\n[Grelha do calendário]");
  c.estado();
  const seg = S.segundaDe(new Date());
  const sab = new Date(seg); sab.setDate(sab.getDate() + 5);
  const isoSab = S.iso(sab);
  const dom = new Date(seg); dom.setDate(dom.getDate() + 6);
  const isoDom = S.iso(dom);
  const html = c.el("grelha").innerHTML;
  ok("grelha desenhada", html.length > 500);
  ok("coluna do sábado anuncia os períodos reduzidos", html.includes("só 09:30–12:00 · 15:00–17:00"));
  ok("células fora dos períodos marcadas como indisponíveis", html.includes("cal-celula indisponivel"));
  ok("sábado às 09:30 é clicável", html.includes(`clicarCelula('${isoSab}','09:30')`));
  ok("sábado às 08:30 NÃO é clicável", !html.includes(`clicarCelula('${isoSab}','08:30')`));
  ok("sábado às 13:00 NÃO é clicável", !html.includes(`clicarCelula('${isoSab}','13:00')`));
  ok("domingo não aparece na grelha", !html.includes(isoDom));
  igual("semana por omissão mostra 6 dias (2.ª a sábado)", S.diasDaSemana().length, 6);

  console.log("\n[Mudar a data do modal recalcula as horas]");
  c.el("t-data").value = "2099-10-03";
  S.atualizarHoras("t-data", "t-hora", "t-nota");
  ok("sábado: seletor sem 08:30 e com 09:30",
    !c.el("t-hora").innerHTML.includes("08:30") && c.el("t-hora").innerHTML.includes("09:30"));
  ok("sábado: aparece a nota de aviso", c.el("t-nota").hidden === false && /SÁBADO/.test(c.el("t-nota").textContent));
  c.el("t-data").value = "2099-10-04";
  S.atualizarHoras("t-data", "t-hora", "t-nota");
  ok("domingo: nota explica que não há vacinação", /domingo/.test(c.el("t-nota").textContent));
  c.el("t-data").value = "2099-09-22";
  S.atualizarHoras("t-data", "t-hora", "t-nota");
  ok("dia útil: volta o horário normal e a nota desaparece",
    c.el("t-nota").hidden === true && c.el("t-hora").innerHTML.includes("08:30"));

  console.log("\n[Modal de marcar]");
  S.abrirMarcar("u1", "2099-10-03", null);
  const modalSab = c.el("modal-conteudo").innerHTML;
  ok("modal de sábado só oferece as horas do sábado",
    modalSab.includes(">10:00<") && !modalSab.includes(">08:30<") && !modalSab.includes(">14:30<"));
  ok("modal de sábado traz o aviso", /SÁBADO/.test(modalSab));
  S.abrirMarcar("u1", "2099-09-22", null);
  ok("modal de dia útil volta ao horário normal", c.el("modal-conteudo").innerHTML.includes(">08:30<"));
  c.el("modal").hidden = true;

  console.log("\n[Dias de encerramento (cliente)]");
  c.estado([], { diasFechados: ["2099-10-05"] });
  ok("horasDoDia devolve [] num dia de encerramento", S.horasDoDia("2099-10-05").length === 0);
  ok("celulaDisponivel é falso num dia de encerramento", S.celulaDisponivel("2099-10-05", "10:00") === false);
  ok("a nota diz que a farmácia está encerrada", /encerrada/.test(S.notaDoDia("2099-10-05")));
  ok("não há opções de hora num dia de encerramento", S.opcoesHoras("2099-10-05", null) === "");
  const nAl = c.alertas.length, nCf = c.confirmacoes.length;
  ok("marcar num dia de encerramento é bloqueado", S.confirmarDia("2099-10-05", "marcação") === false);
  ok("o bloqueio avisa e não chega a pedir confirmação",
    c.alertas.length === nAl + 1 && /encerrada/.test(c.alertas[c.alertas.length - 1]) && c.confirmacoes.length === nCf);
  ok("o dia seguinte mantém o horário normal", S.horasDoDia("2099-10-06").length === HORAS.length);
  ok("lerDiasFechados aceita linhas, vírgulas e pontos e vírgulas, sem duplicar",
    JSON.stringify(S.lerDiasFechados("2026-12-08\n2026-12-25; 2026-12-08, 2026-01-01")) === JSON.stringify(["2026-12-08", "2026-12-25", "2026-01-01"]));
  ok("lerDiasFechados ignora linhas vazias", JSON.stringify(S.lerDiasFechados("  \n\n  2026-12-08  \n")) === JSON.stringify(["2026-12-08"]));

  console.log("\n[Grelha com um dia de encerramento]");
  const seg2 = S.segundaDe(new Date());
  const quarta = new Date(seg2); quarta.setDate(quarta.getDate() + 2);
  const isoQuarta = S.iso(quarta);
  c.estado([], { diasFechados: [isoQuarta] });
  const htmlFechado = c.el("grelha").innerHTML;
  ok("o dia encerrado aparece marcado no cabeçalho", htmlFechado.includes("encerrado"));
  ok("nenhuma célula do dia encerrado é clicável", !htmlFechado.includes(`clicarCelula('${isoQuarta}',`));
  ok("as células do dia encerrado ficam indisponíveis", htmlFechado.includes("cal-celula indisponivel"));

  console.log("\n[Painel de configuração (cliente)]");
  c.estado([], { diasFechados: ["2026-12-08", "2026-12-25"] });
  ok("o painel mostra os horários atuais", c.el("g-horaInicio").value === "08:30" && c.el("g-sabadoFim2").value === "17:00");
  ok("o painel mostra os dias de encerramento (um por linha)", c.el("g-diasFechados").value === "2026-12-08\n2026-12-25");
  ok("o painel mostra intervalo e máximo por hora", c.el("g-intervaloMin").value === "30" && c.el("g-maxPorHora").value === "2");
  let nCh = c.chamadas.length;
  await S.guardarConfigUI();
  let chCfg = c.chamadas.slice(nCh).filter(x => x.url === "/api/config").pop();
  ok("guardar o painel envia tudo num PUT /api/config", !!chCfg && chCfg.method === "PUT");
  ok("o corpo leva horários, dias de encerramento e pasta de backup",
    !!chCfg && /"horaInicio":"08:30"/.test(chCfg.body) && /"diasFechados":\["2026-12-08","2026-12-25"\]/.test(chCfg.body) && /"pastaBackup"/.test(chCfg.body) && /"intervaloMin":30/.test(chCfg.body));
  c.el("g-maxPorHora").value = "0";
  nCh = c.chamadas.length;
  const nAl2 = c.alertas.length;
  await S.guardarConfigUI();
  ok("o painel recusa um máximo por hora inválido sem enviar nada",
    c.alertas.length === nAl2 + 1 && /máximo por hora/.test(c.alertas[c.alertas.length - 1]) && c.chamadas.length === nCh);
  c.el("g-maxPorHora").value = "2";
  c.el("g-horaFim").value = "";
  const nAl3 = c.alertas.length;
  await S.guardarConfigUI();
  ok("o painel exige todos os horários antes de guardar",
    c.alertas.length === nAl3 + 1 && /Preencha todos os horários/.test(c.alertas[c.alertas.length - 1]));
  c.el("g-horaFim").value = "12:00";

  console.log("\n[Exportação CSV (cliente)]");
  await S.exportarCSV("marcacoes", "2099-10-01", "2099-10-07");
  const chCsv = c.chamadas.filter(x => x.url.startsWith("/api/exportar.csv")).pop();
  ok("exportarCSV pede o endpoint com tipo e datas",
    !!chCsv && chCsv.url.includes("tipo=marcacoes") && chCsv.url.includes("desde=2099-10-01") && chCsv.url.includes("ate=2099-10-07"));
  await S.exportarCSV("utentes");
  const chUt = c.chamadas.filter(x => x.url.startsWith("/api/exportar.csv")).pop();
  ok("exportarCSV de utentes vai sem filtro de datas", !!chUt && chUt.url === "/api/exportar.csv?tipo=utentes");
  ok("a exportação avisa o utilizador", /CSV exportado/.test(c.el("banner-txt").textContent));

  console.log("\n════════════════════════════════════════");
  console.log(`  Resultado: ${passou} passaram, ${falhou} falharam`);
  process.exit(falhou ? 1 : 0);
})().catch(e => { console.error("ERRO NOS TESTES DE CLIENTE:", e); process.exit(1); });
