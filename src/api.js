"use strict";
/* api.js — rotas da API: estado/login, utentes, marcações, config, backup,
   exportação. A lógica de negócio vive aqui sobre o modelo `dados`.        */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const U = require("./util");
const A = require("./autenticacao");
const BK = require("./backup");
const CFG_MOD = require("./config");

const CAB_SEGURANCA = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
};

/* contexto: { dados, cfg, horas, horasSabado, persistir, registar, backupAuto } */
function criarApi(ctx) {
  const { dados, cfg, persistir, registar } = ctx;
  /* horas e horasSabado são recalculados quando a configuração muda a correr
     (painel de configuração) — deixam de ser valores fixos da injecção */
  let horas = ctx.horas, horasSabado = ctx.horasSabado;
  const recarregarHorarios = () => { horas = CFG_MOD.gerarHoras(cfg); horasSabado = CFG_MOD.gerarHorasSabado(cfg); };

  function utenteDe(id) { const u = dados.utentes.find(x => x.id === id); return u ? u.nome : "?"; }
  function ocupantes(data, hora, excetoId) {
    return dados.marcacoes.filter(m => m.data === data && m.hora === hora && U.OCUPAM.includes(m.estado) && m.id !== excetoId);
  }
  /* lugares ocupados numa hora: cada marcação conta 1 + os acompanhantes do grupo */
  function lugares(data, hora, excetoId) {
    return ocupantes(data, hora, excetoId).reduce((t, m) => t + 1 + (m.grupo && m.grupo.extras ? m.grupo.extras : 0), 0);
  }
  /* validação da reserva múltipla (grupo): extras 1-9 e vacinas G/C/G+C */
  function validarGrupo(corpo) {
    const extras = Number(corpo.grupoExtras);
    if (corpo.grupoExtras === undefined || corpo.grupoExtras === null || corpo.grupoExtras === "") return { extras: 0 };
    if (!Number.isInteger(extras) || extras < 1 || extras > 9)
      return { erro: "Número de pessoas extra inválido (inteiro entre 1 e 9)." };
    const v = U.normalizarVac(corpo.grupoVacinas);
    if (!v) return { erro: "Vacinas do grupo inválidas (G, C ou G+C)." };
    return { extras, vacinas: v === "G+C" ? ["G", "C"] : [v] };
  }
  /* dias de encerramento (feriados/férias): a farmácia não vacina nesses dias */
  const encerrado = data => (Array.isArray(cfg.diasFechados) ? cfg.diasFechados : []).includes(data);
  /* horas válidas por dia: dias de encerramento não têm nenhuma; o sábado tem
     períodos próprios; o domingo não tem nenhum */
  const horasDoDia = data => encerrado(data) ? [] : (U.diaDaSemana(data) === 6 ? horasSabado : horas);

  /* ---- CSV (relatórios): Excel pt-PT abre com «;» e BOM UTF-8 ---- */
  function csvCampo(v) {
    const s = v === undefined || v === null ? "" : String(v);
    return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csvUtentes() {
    const linhas = [["Nome", "Contacto", "Vacina", "Observações", "Última marcação", "Data", "Hora", "Criado por"]];
    for (const u of dados.utentes.slice().sort((a, b) => a.nome.localeCompare(b.nome, "pt"))) {
      const m = dados.marcacoes.filter(x => x.utenteId === u.id).sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora))[0];
      linhas.push([u.nome, u.contacto, u.vacina, u.obs || "", m ? m.estado : "sem marcação", m ? m.data : "", m ? m.hora : "", u.criadoPor || ""]);
    }
    return linhas;
  }
  function csvMarcacoes(desde, ate) {
    const linhas = [["Data", "Hora", "Utente", "Contacto", "Vacinas", "Estado", "Justificada", "Motivo", "Criada por"]];
    const lista = dados.marcacoes
      .filter(m => (!desde || m.data >= desde) && (!ate || m.data <= ate))
      .sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
    for (const m of lista) {
      const u = dados.utentes.find(x => x.id === m.utenteId) || { nome: "(utente eliminado)", contacto: "" };
      linhas.push([m.data, m.hora, u.nome, u.contacto, m.vacinas.join("+"), m.estado,
        m.justificada ? "sim" : "", m.justificada ? (m.motivo || "") : "", m.criadoPor || ""]);
    }
    return linhas;
  }

  async function api(req, res, corpo) {
    const rota = req.url.split("?")[0];
    const partes = rota.replace(/^\/+/, "").split("/");
    const resp = (cod, obj, cookie) => {
      const cab = Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CAB_SEGURANCA);
      if (cookie) cab["Set-Cookie"] = cookie;
      res.writeHead(cod, cab); res.end(JSON.stringify(obj));
    };
    const sessao = A.sessaoDe(req);
    const exigir = () => { if (!sessao) { resp(401, { erro: "Sessão expirada ou não iniciada.", login: true }); return false; } return true; };

    /* ---------- estado / login ---------- */
    if (rota === "/api/estado" && req.method === "GET")
      return resp(200, { pinDefinido: A.pinDefinido(), config: cfg, horas, horasSabado });

    if (rota === "/api/setup" && req.method === "POST") {
      if (A.pinDefinido()) return resp(403, { erro: "PIN já definido. Para redefinir, pare o servidor e apague config-pin.json." });
      const rl = A.rateLimitPermitir(req);
      if (!rl.ok) return resp(429, { erro: `Demasiadas tentativas. Aguarde ${rl.espera} s.` });
      const codigo = String(corpo.codigoArranque || "").trim();
      if (codigo !== A.codigoArranqueAtual())
        return resp(403, { erro: "Código de arranque incorreto. Está impresso no terminal do servidor." });
      const pin = String(corpo.pin || "");
      if (pin.length < 4) return resp(400, { erro: "O PIN deve ter pelo menos 4 caracteres." });
      await A.definirPin(pin);
      A.apagarCodigoArranque();
      A.rateLimitLimpar(req);
      const posto = String(corpo.posto || "").trim() || "Posto";
      const t = A.novaSessao(posto);
      U.logOp("INFO", "PIN definido pelo posto " + posto);
      return resp(200, { ok: true, token: t, posto },
        `sessao=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    }

    if (rota === "/api/login" && req.method === "POST") {
      const rl = A.rateLimitPermitir(req);
      if (!rl.ok) return resp(429, { erro: `Demasiadas tentativas deste posto. Aguarde ${rl.espera} s e tente de novo.` });
      if (!A.pinDefinido()) return resp(400, { erro: "PIN ainda não definido." });
      const posto = String(corpo.posto || "").trim();
      if (!posto) return resp(400, { erro: "Indique o nome do posto (ex.: Posto 1)." });
      const verPin = await A.verificarPin(String(corpo.pin || ""));
      if (verPin === "corrompido") return resp(500, { erro: "config-pin.json está corrompido — pare o servidor, apague-o e volte a definir o PIN (os dados dos utentes ficam intactos)." });
      if (verPin !== true) {
        registar(A.ipDe(req), "login falhado", "PIN", "posto=" + String(corpo.posto || "?"));
        U.logOp("AVISO", "login falhado do posto " + posto + " (" + A.ipDe(req) + ")");
        return resp(401, { erro: "PIN incorreto." });
      }
      A.rateLimitLimpar(req);
      const t = A.novaSessao(posto);
      U.logOp("INFO", "login OK do posto " + posto);
      return resp(200, { ok: true, token: t, posto }, `sessao=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    }

    if (rota === "/api/logout" && req.method === "POST") {
      A.encerrarSessao(req);
      return resp(200, { ok: true }, "sessao=; Path=/; Max-Age=0");
    }

    if (!exigir()) return;
    const posto = sessao.posto;

    /* ---------- leitura ---------- */
    if (rota === "/api/dados" && req.method === "GET") {
      const v = Number((req.url.split("versao=")[1] || "").split("&")[0]);
      if (Number.isInteger(v) && v === dados.versao) {
        res.writeHead(304, Object.assign({ "Cache-Control": "no-store" }, CAB_SEGURANCA));   // 304 sem corpo
        return res.end();
      }
      return resp(200, { versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes, config: cfg, horas, horasSabado, posto });
    }

    if (rota === "/api/historico" && req.method === "GET")
      return resp(200, { versao: dados.versao, historico: dados.historico.slice(-500).reverse() });

    if (rota === "/api/horas" && req.method === "GET")
      return resp(200, { horas, horasSabado, config: cfg });

    /* ---------- exportação de dados (cópia de segurança pela interface) ---------- */
    if (rota === "/api/exportar" && req.method === "GET") {
      const nome = "dados-exportados-" + BK.dataLocalArquivo() + ".json";
      const carga = JSON.stringify({ exportadoEm: U.agora(), por: posto, dados }, null, 1);
      res.writeHead(200, Object.assign({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + nome + '"'
      }, CAB_SEGURANCA));
      return res.end(carga);
    }

    /* ---------- exportação CSV (relatórios da campanha) ---------- */
    if (rota === "/api/exportar.csv" && req.method === "GET") {
      const q = new URLSearchParams(req.url.split("?")[1] || "");
      const tipo = q.get("tipo") || "marcacoes";
      if (!["marcacoes", "utentes"].includes(tipo))
        return resp(400, { erro: 'tipo inválido (use "marcacoes" ou "utentes").' });
      const brutoDesde = q.get("desde"), brutoAte = q.get("ate");
      const desde = brutoDesde ? U.validarData(brutoDesde) : null;
      const ate = brutoAte ? U.validarData(brutoAte) : null;
      if ((brutoDesde && !desde) || (brutoAte && !ate))
        return resp(400, { erro: "Filtro de datas inválido (use AAAA-MM-DD)." });
      const linhas = tipo === "utentes" ? csvUtentes() : csvMarcacoes(desde, ate);
      const csv = "\uFEFF" + linhas.map(l => l.map(csvCampo).join(";")).join("\r\n") + "\r\n";
      res.writeHead(200, Object.assign({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="vacinas-' + tipo + "-" + BK.dataLocalArquivo() + '.csv"'
      }, CAB_SEGURANCA));
      return res.end(csv);
    }

    if (rota === "/api/backup/testar" && req.method === "POST") {
      /* testa o caminho indicado (a interface testa antes de guardar) ou, se
         não vier nenhum, o que está configurado */
      const alvo = corpo.pastaBackup !== undefined
        ? Object.assign({}, cfg, { pastaBackup: String(corpo.pastaBackup || "").trim() })
        : cfg;
      const t = BK.testarPasta(alvo);
      if (!t.ok) return resp(400, { ok: false, pasta: t.pasta, erro: "Não foi possível escrever em " + t.pasta + " — " + t.erro });
      return resp(200, { ok: true, pasta: t.pasta, maxCopias: BK.BACKUP_COPIAS, ultimoBackup: dados.ultimoBackup || null });
    }

    if (rota === "/api/backup" && req.method === "POST") {
      const resultado = ctx.backupAuto(true);
      if (!resultado.ok) return resp(500, { erro: "Backup falhou: " + resultado.erro, pasta: BK.pastaBackupEfetiva(cfg) });
      return resp(200, { ok: true, ficheiro: resultado.ficheiro, pasta: BK.pastaBackupEfetiva(cfg), ultimoBackup: dados.ultimoBackup });
    }

    /* ---------- helpers de mutação ---------- */
    const baseVersaoOk = () => {
      if (!Number.isInteger(corpo.baseVersao)) { resp(400, { erro: "baseVersao em falta." }); return false; }
      if (corpo.baseVersao !== dados.versao) {
        resp(409, { erro: "conflito", motivo: "versao", versao: dados.versao,
          utentes: dados.utentes, marcacoes: dados.marcacoes, config: cfg });
        return false;
      }
      return true;
    };
    const gravar = (extra) => {
      dados.versao += 1;
      persistir(dados);
      ctx.backupAuto(false);   // cópia diária; falha nunca bloqueia a gravação
      resp(200, Object.assign({ versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes, config: cfg, horas, horasSabado }, extra || {}));
    };

    /* ---------- configuração (horários, dias de encerramento, backup) ----------
       A validação é a de config.js: o valor inválido que vem da INTERFACE é
       recusado com a razão (não é substituído em silêncio como no ficheiro).  */
    if (rota === "/api/config" && req.method === "PUT") {
      if (!baseVersaoOk()) return;
      const v = CFG_MOD.validarAlteracoesConfig(cfg, corpo);
      if (!v.ok) return resp(400, { erro: v.erros.join(" ") });
      Object.assign(cfg, v.alteracoes);
      CFG_MOD.gravarConfig(cfg);
      recarregarHorarios();
      registar(posto, "config", Object.keys(v.alteracoes).join(", "), JSON.stringify(v.alteracoes).slice(0, 500));
      return gravar({ config: cfg });
    }

    /* ---------- utentes ---------- */
    if (rota === "/api/utentes" && req.method === "POST") {
      if (!baseVersaoOk()) return;
      const nome = String(corpo.nome || "").trim();
      const contacto = String(corpo.contacto || "").trim();
      const vacina = U.normalizarVac(corpo.vacina);
      if (!nome) return resp(400, { erro: "Nome obrigatório." });
      if (!vacina) return resp(400, { erro: "Vacina inválida (G, C ou G+C)." });
      const k = U.chaveUtente(nome, contacto);
      const dup = dados.utentes.find(u => U.chaveUtente(u.nome, u.contacto)[0] === k[0] && U.chaveUtente(u.nome, u.contacto)[1] === k[1]);
      if (dup)
        return resp(409, { erro: "Já existe um utente com este nome/contacto.", motivo: "duplicado", existenteId: dup.id, existente: dup });
      const u = { id: crypto.randomUUID(), nome, contacto, vacina, obs: String(corpo.obs || "").trim(), rev: 1, criadoEm: U.agora(), criadoPor: posto };
      dados.utentes.push(u);
      registar(posto, "criar utente", u.id, `${nome} | ${contacto} | ${vacina}`);
      return gravar();
    }

    if (rota === "/api/importar" && req.method === "POST") {
      if (!baseVersaoOk()) return;
      const linhas = corpo.linhas;
      if (!Array.isArray(linhas) || !linhas.length) return resp(400, { erro: "Lista de linhas vazia." });
      const existentes = new Set(dados.utentes.map(u => U.chaveUtente(u.nome, u.contacto).join("|")));
      let inseridos = 0, ignorados = 0, duplicados = 0;
      for (const ln of linhas) {
        const n = String((ln && ln.nome) || "").trim();
        const c = String((ln && ln.contacto) || "").trim();
        const v = U.normalizarVac(ln && ln.vacina);
        if (!n || !v) { ignorados++; continue; }
        const k = U.chaveUtente(n, c).join("|");
        if (existentes.has(k)) { duplicados++; continue; }
        existentes.add(k);
        dados.utentes.push({ id: crypto.randomUUID(), nome: n, contacto: c, vacina: v, obs: "", rev: 1, criadoEm: U.agora(), criadoPor: posto });
        inseridos++;
      }
      if (inseridos) registar(posto, "importar", "lote", `inseridos=${inseridos} ignorados=${ignorados} duplicados=${duplicados}`);
      return gravar({ inseridos, ignorados, duplicados });
    }

    if (partes[0] === "api" && partes[1] === "utentes" && partes[2] && req.method === "PUT") {
      if (!baseVersaoOk()) return;
      const u = dados.utentes.find(x => x.id === partes[2]);
      if (!u) return resp(409, { erro: "Utente eliminado noutro posto." });
      if (Number(corpo.rev) !== u.rev)
        return resp(409, { erro: "conflito", motivo: "registo", atual: u, versao: dados.versao, utentes: dados.utentes, marcacoes: dados.marcacoes });
      const nome = corpo.nome !== undefined ? String(corpo.nome).trim() : u.nome;
      const contacto = corpo.contacto !== undefined ? String(corpo.contacto).trim() : u.contacto;
      const vacina = corpo.vacina !== undefined ? U.normalizarVac(corpo.vacina) : u.vacina;
      if (!nome) return resp(400, { erro: "Nome obrigatório." });
      if (vacina === null) return resp(400, { erro: "Vacina inválida." });
      registar(posto, "editar utente", u.id, `${u.nome} -> ${nome}`);
      Object.assign(u, { nome, contacto, vacina, obs: corpo.obs !== undefined ? String(corpo.obs).trim() : u.obs, rev: u.rev + 1, atualizadoEm: U.agora() });
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
      const data = U.validarData(corpo.data);
      const utente = dados.utentes.find(x => x.id === corpo.utenteId);
      if (!utente) return resp(409, { erro: "Utente não existe (eliminado noutro posto?)" });
      if (!data) return resp(400, { erro: "Data válida (AAAA-MM-DD) obrigatória." });
      if (U.diaDaSemana(data) === 0) return resp(400, { erro: "Não é possível agendar ao domingo." });
      if (encerrado(data)) return resp(400, { erro: "A farmácia está encerrada nesse dia (dia de encerramento)." });
      const horasDia = horasDoDia(data);
      if (!horasDia.includes(corpo.hora))
        return resp(400, { erro: `Hora fora do horário${U.diaDaSemana(data) === 6 ? " de sábado" : ""} (${horasDia[0]}–${horasDia[horasDia.length - 1]}).` });
      const hora = corpo.hora;
      const vacinas = U.normalizarSlots(corpo.vacinas);
      const just = !!corpo.justificada;
      const motivo = String(corpo.motivo || "").trim();
      if (dados.marcacoes.some(m => m.utenteId === utente.id && m.data === data && m.hora === hora && U.OCUPAM.includes(m.estado)))
        return resp(409, { erro: "Este utente já tem marcação ativa nessa hora." });
      const g = validarGrupo(corpo);
      if (g.erro) return resp(400, { erro: g.erro });
      const ocup = ocupantes(data, hora, null);
      if (lugares(data, hora, null) + 1 + g.extras > cfg.maxPorHora)
        return resp(409, { erro: `Hora cheia (máx. ${cfg.maxPorHora} lugares por horário; reserva múltipla conta ${1 + g.extras}).`, motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
      if (ocup.length > 0 && !just)
        return resp(409, { erro: "Hora já ocupada.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
      if (just && !motivo)
        return resp(400, { erro: "Exceção justificada exige motivo." });
      const m = { id: crypto.randomUUID(), utenteId: utente.id, data, hora, vacinas,
        grupo: g.extras ? { extras: g.extras, vacinas: g.vacinas } : undefined,
        estado: "agendado", justificada: just, motivo: just ? motivo : "",
        rev: 1, criadoEm: U.agora(), criadoPor: posto, historico: [{ quando: U.agora(), acc: "criada", posto }] };
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
      if (corpo.estado === null) return resp(400, { erro: "Estado inválido." });
      const estado = corpo.estado !== undefined ? corpo.estado : m.estado;
      if (!U.ESTADOS.includes(estado)) return resp(400, { erro: "Estado inválido." });
      const nd = corpo.novaData !== undefined ? U.validarData(corpo.novaData) : null;
      const nh = corpo.novaHora !== undefined ? String(corpo.novaHora) : null;
      if ((corpo.novaData || corpo.novaHora) && !(nd && nh))
        return resp(400, { erro: "Para reagendar indique data e hora válidas." });
      if (nd && U.diaDaSemana(nd) === 0)
        return resp(400, { erro: "Não é possível agendar ao domingo." });
      if (nd && encerrado(nd))
        return resp(400, { erro: "A farmácia está encerrada nesse dia (dia de encerramento)." });
      if (nd && nh && !horasDoDia(nd).includes(nh))
        return resp(400, { erro: `Hora fora do horário${U.diaDaSemana(nd) === 6 ? " de sábado" : ""}.` });
      const reagendar = !!corpo.reagendar;

      if (reagendar && nd && nh) {
        // marcação nova nasce 'agendada'; a antiga liberta a hora
        if (dados.marcacoes.some(x => x.utenteId === m.utenteId && x.data === nd && x.hora === nh && U.OCUPAM.includes(x.estado) && x.id !== m.id))
          return resp(409, { erro: "Este utente já tem marcação ativa nessa hora." });
        const ocup = ocupantes(nd, nh, m.id);
        const g = (m.grupo && m.grupo.extras) ? m.grupo.extras : 0;
        if (lugares(nd, nh, m.id) + 1 + g > cfg.maxPorHora || (ocup.length > 0 && !corpo.justificada))
          return resp(409, { erro: "Nova hora ocupada noutro posto.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
        if (corpo.justificada && !String(corpo.motivo || "").trim())
          return resp(400, { erro: "Exceção justificada exige motivo." });
        const nova = { id: crypto.randomUUID(), utenteId: m.utenteId, data: nd, hora: nh, vacinas: m.vacinas, grupo: m.grupo,
          estado: "agendado", justificada: !!corpo.justificada, motivo: String(corpo.motivo || "").trim(),
          rev: 1, criadoEm: U.agora(), criadoPor: posto, historico: [{ quando: U.agora(), acc: `reagendada de ${m.data} ${m.hora}`, posto }] };
        dados.marcacoes.push(nova);
        // a antiga TEM de libertar a hora: se o estado escolhido ainda ocupasse
        // (agendado/administrado — o caso normal da interface, que deixa o
        // estado como está), é cancelada automaticamente e fica ligada à nova
        // (supersedidaPor) para não contar nas «Canceladas» dos indicadores
        if (U.OCUPAM.includes(estado)) {
          m.estado = "cancelado";
          m.supersedidaPor = nova.id;
          m.historico.push({ quando: U.agora(), acc: "antiga cancelada pelo reagendamento (liberta a hora)", posto });
        } else {
          m.estado = estado || "faltou";
        }
        m.rev += 1; m.atualizadoEm = U.agora();
        m.historico.push({ quando: U.agora(), acc: `reagendada para ${nd} ${nh} (nova ${nova.id.slice(0, 8)})`, posto });
        registar(posto, "reagendar", m.id, `${m.data} ${m.hora} -> ${nd} ${nh}`);
        return gravar({ novaId: nova.id });
      }

      // alteração na própria marcação (estado e/ou deslocação)
      if (nd && nh && (nd !== m.data || nh !== m.hora)) {
        if (dados.marcacoes.some(x => x.utenteId === m.utenteId && x.data === nd && x.hora === nh && U.OCUPAM.includes(x.estado) && x.id !== m.id))
          return resp(409, { erro: "Este utente já tem marcação ativa nessa hora." });
        const ocup = ocupantes(nd, nh, m.id);
        const g2 = (m.grupo && m.grupo.extras) ? m.grupo.extras : 0;
        if (lugares(nd, nh, m.id) + 1 + g2 > cfg.maxPorHora || (ocup.length > 0 && !corpo.justificada))
          return resp(409, { erro: "Hora destino ocupada.", motivo: "slot_ocupado", ocupantes: ocup.map(o => ({ id: o.id, nome: utenteDe(o.utenteId) })) });
        m.data = nd; m.hora = nh;
      }
      if (corpo.estado !== undefined) m.estado = estado;
      if (corpo.justificada !== undefined) {
        // coerente com POST/reagendar: justificação sem motivo escrito não entra
        if (corpo.justificada && !String(corpo.motivo || "").trim())
          return resp(400, { erro: "Exceção justificada exige motivo." });
        m.justificada = !!corpo.justificada; m.motivo = String(corpo.motivo || "").trim();
      }
      if (corpo.vacinas !== undefined) m.vacinas = U.normalizarSlots(corpo.vacinas);
      m.rev += 1; m.atualizadoEm = U.agora();
      m.historico.push({ quando: U.agora(), acc: `alterada: ${Object.keys(corpo).filter(k => !["rev", "baseVersao"].includes(k)).join(", ")}`, posto });
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

  return api;
}

module.exports = { CAB_SEGURANCA, criarApi };
