#!/usr/bin/env node
"use strict";
/* ============================================================================
 * restaurar.js — Restauro de cópia de segurança (executar com o SERVIDOR PARADO)
 *
 * Uso:
 *   node restaurar.js                          → lista as cópias locais
 *   node restaurar.js <ficheiro>               → valida, guarda o estado atual
 *                                                e restaura a cópia
 *   node restaurar.js backups/dados.backup-2026-01-15.json
 *   node restaurar.js "\\POSTO\vacinas\dados.backup-2026-01-15.json"
 *
 * Segurança: nunca substitui dados.json sem (1) validar a cópia com as MESMAS
 * regras de schema do servidor, (2) guardar o estado atual como .antes-restauro
 * e (3) confirmação explícita (escrever RESTAURAR).
 * ==========================================================================*/
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const U = require("./src/util");
const ARM = require("./src/armazenamento");

const FICHEIRO_DADOS = ARM.FICHEIRO_DADOS;

function listarCopias() {
  const pasta = path.join(U.RAIZ, "backups");
  console.log("Cópias de segurança locais (mais recentes primeiro):\n");
  let ficheiros = [];
  try { ficheiros = fs.readdirSync(pasta).filter(f => /^dados\.backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse(); } catch (e) {}
  if (!ficheiros.length) {
    console.log("  (nenhuma cópia em backups/ — pode indicar o caminho de uma");
    console.log("   cópia na rede:  node restaurar.js \\\\POSTO\\pasta\\dados.backup-....json)");
    return;
  }
  for (const f of ficheiros) {
    const st = fs.statSync(path.join(pasta, f));
    console.log(`  ${path.join(pasta, f)}   (${(st.size / 1024).toFixed(1)} KB, ${st.mtime.toLocaleString("pt-PT")})`);
  }
  console.log("\nPara restaurar:  node restaurar.js <caminho-da-cópia>");
}

function perguntar(pergunta) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(pergunta, r => { rl.close(); res(r.trim()); });
  });
}

/* validação com as mesmas regras do servidor (schema de armazenamento.js) */
function validarCopia(alvo) {
  const j = U.lerJSONcBOM(alvo);   // lança se ilegível/BOM com lixo
  // a cópia TEM de ter a estrutura de um ficheiro de dados: sem utentes nem
  // marcações em array, é outro ficheiro qualquer — recusar em vez de apagar
  if (!Array.isArray(j.utentes) || !Array.isArray(j.marcacoes))
    throw new Error("não tem a estrutura de um ficheiro de dados (utentes/marcações)");
  if (!j.utentes.length && !j.marcacoes.length)
    throw new Error("a cópia está vazia (0 utentes e 0 marcações) — recusado para não apagar os dados atuais");
  const avisos = [];
  const utentes = (Array.isArray(j.utentes) ? j.utentes : [])
    .map(u => (u && typeof u === "object" && typeof u.id === "string" && u.id &&
      typeof u.nome === "string" && u.nome.trim() &&
      typeof u.contacto === "string" && u.contacto.trim())
      ? Object.assign({}, u, { nome: u.nome.trim(), contacto: u.contacto.trim(), vacina: U.normalizarVac(u.vacina) || "G", obs: typeof u.obs === "string" ? u.obs : "", rev: Number.isInteger(u.rev) && u.rev > 0 ? u.rev : 1 })
      : (avisos.push("utente inválido ignorado"), null)).filter(Boolean);
  const ids = new Set(utentes.map(u => u.id));
  const marcacoes = (Array.isArray(j.marcacoes) ? j.marcacoes : [])
    .map(m => (m && typeof m === "object" && typeof m.id === "string" && m.id &&
      ids.has(m.utenteId) && U.validarData(m.data) && U.validarHoraTexto(m.hora))
      ? Object.assign({}, m, { estado: U.ESTADOS.includes(m.estado) ? m.estado : "agendado", vacinas: U.normalizarSlots(m.vacinas), rev: Number.isInteger(m.rev) && m.rev > 0 ? m.rev : 1 })
      : (avisos.push("marcação inválida ignorada"), null)).filter(Boolean);
  if (avisos.length && !utentes.length && !marcacoes.length)
    throw new Error("a cópia não contém nenhum registo válido");
  return {
    versao: Number.isInteger(j.versao) ? j.versao : 1,
    schema: ARM.SCHEMA,
    utentes, marcacoes,
    historico: Array.isArray(j.historico) ? j.historico : [],
    ultimoBackup: typeof j.ultimoBackup === "string" ? j.ultimoBackup : undefined
  };
}

async function main() {
  const alvo = process.argv[2];
  if (!alvo) return listarCopias();

  if (!fs.existsSync(alvo)) { console.error("ERRO: ficheiro não encontrado: " + alvo); process.exit(1); }
  console.log("AVISO: o servidor tem de estar PARADO durante o restauro.");

  let dadosNovos;
  try {
    dadosNovos = validarCopia(alvo);
  } catch (e) {
    console.error("ERRO: a cópia não é um ficheiro de dados válido — " + e.message);
    console.error("Nada foi alterado.");
    process.exit(1);
  }
  console.log(`Cópia válida: ${dadosNovos.utentes.length} utentes, ${dadosNovos.marcacoes.length} marcações.`);

  const resposta = await perguntar(`\nVai substituir ${FICHEIRO_DADOS} pelos dados da cópia.\nEscreva RESTAURAR para confirmar: `);
  if (resposta !== "RESTAURAR") { console.log("Cancelado — nada foi alterado."); return; }

  if (fs.existsSync(FICHEIRO_DADOS)) {
    const seguranca = FICHEIRO_DADOS + ".antes-restauro";
    fs.copyFileSync(FICHEIRO_DADOS, seguranca);
    console.log("Estado anterior guardado como: " + seguranca);
  }
  ARM.persistir(dadosNovos);
  console.log("Restauro concluído: " + FICHEIRO_DADOS);
  console.log("Pode agora arrancar o servidor:  node servidor.js");
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
