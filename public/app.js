"use strict";
/* ============ estado ============ */
const VAC={G:"Gripe","C":"COVID-19","G+C":"Gripe + COVID-19"};
const EST={agendado:"Agendado",administrado:"Administrado",faltou:"Não compareceu (ligar novamente)",cancelado:"Cancelado"};
let versao=0, utentes=[], marcacoes=[], horas=[], horasSabado=[], config={}, token=null, posto="", semanaBase=null, sessaoAtiva=false;

function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function api(rota,corpo,metodo){
  const r=await fetch(rota,{method:metodo||(corpo?"POST":"GET"),
    headers:Object.assign({"Content-Type":"application/json"},token?{"Authorization":"Bearer "+token}:{}),
    body:corpo?JSON.stringify(corpo):undefined});
  return{s:r.status,d:await r.json().catch(()=>({}))};
}
function banner(txt,erro){const b=document.getElementById("banner");
  b.className="banner"+(erro?" erro":"");document.getElementById("banner-txt").textContent=txt;b.hidden=false;
  clearTimeout(b._t);b._t=setTimeout(()=>b.hidden=true,8000);}
function ligOk(ok){const e=document.getElementById("lig");e.textContent=ok?"ligado ao servidor":"sem ligação";e.className="lig "+(ok?"lig-ok":"lig-ma");}

/* ============ login ============ */
async function recuperarSessao(){
  try{const r=await fetch("/api/dados");
    if(r.status===200){
      const d=await r.json();
      versao=d.versao;utentes=d.utentes;marcacoes=d.marcacoes;horas=d.horas;horasSabado=d.horasSabado||[];config=d.config;posto=d.posto||"Posto";
      document.getElementById("ecra-pin").hidden=true;
      document.getElementById("util-posto").textContent="posto: "+posto;
      ligOk(true);sessaoAtiva=true;semanaBase=segundaDe(new Date());renderTudo();
      if(!window._timer){window._timer=1;setInterval(sincronizar,5000);}
      return true;
    }
  }catch(e){}
  return false;
}
async function initPin(){
  try{const r=await api("/api/estado");
    document.getElementById("pin-estado").textContent=r.d.pinDefinido
      ?"Introduza o PIN e o nome deste posto."
      :"Primeiro acesso: indique o código de arranque impresso no terminal do servidor e defina um PIN (mín. 4 caracteres).";
    document.getElementById("pin-codigo").hidden=!!r.d.pinDefinido;
  }catch(e){document.getElementById("pin-estado").textContent="Servidor indisponível. Verifique se o servidor está a correr.";}}
async function entrar(){
  try{await entrarInterno();}catch(e){document.getElementById("pin-erro").textContent="Servidor indisponível — verifique a ligação.";}}
async function entrarInterno(){
  const pin=document.getElementById("pin-input").value;
  const p=document.getElementById("pin-posto").value.trim();
  const erro=document.getElementById("pin-erro");
  if(!p){erro.textContent="Indique o nome do posto.";return;}
  if(!pin){erro.textContent="Introduza o PIN.";return;}
  const est=await api("/api/estado");
  if(!est.d.pinDefinido){
    const cod=document.getElementById("pin-codigo").value.trim();
    if(!cod){erro.textContent="Indique o código de arranque impresso no terminal do servidor.";return;}
    const r0=await api("/api/setup",{pin,posto:p,codigoArranque:cod});
    if(r0.s!==200){erro.textContent=r0.d.erro||"Falha.";return;}
    token=r0.d.token; posto=r0.d.posto||p; sessaoAtiva=true;
    document.getElementById("ecra-pin").hidden=true;
    document.getElementById("util-posto").textContent="posto: "+posto;
    ligOk(true); await sincronizar(true);
    if(!window._timer){window._timer=1;setInterval(sincronizar,5000);}
    return;
  }
  const r=await api("/api/login",{pin,posto:p});
  if(r.s!==200){erro.textContent=r.d.erro||"Falha.";return;}
  token=r.d.token; posto=r.d.posto||p; sessaoAtiva=true;
  document.getElementById("ecra-pin").hidden=true;
  document.getElementById("util-posto").textContent="posto: "+posto;
  ligOk(true); await sincronizar(true);
  if(!window._timer){window._timer=1;setInterval(sincronizar,5000);}
}
async function sair(){try{await api("/api/logout",{});}catch(e){}token=null;sessaoAtiva=false;location.reload();}

/* ============ sincronização ============ */
async function sincronizar(){
  if(!sessaoAtiva)return;   /* o cookie de sessão é HttpOnly: não aparece em document.cookie */
  try{const r=await api("/api/dados"+(versao>0?"?versao="+versao:""));
    if(r.s===401){sair();return;}
    if(r.s===304){ligOk(true);return;}
    if(r.s!==200)throw 0;
    versao=r.d.versao;utentes=r.d.utentes;marcacoes=r.d.marcacoes;horas=r.d.horas;horasSabado=r.d.horasSabado||horasSabado;config=r.d.config;
    if(!semanaBase)semanaBase=segundaDe(new Date());
    ligOk(true);renderTudo();
  }catch(e){ligOk(false);}
}

/* ============ mutações com confirmação em conflito ============ */
async function mutacao(rota,corpo,msg,metodo){
  const c=Object.assign({baseVersao:versao},corpo);
  const r=await api(rota,c,metodo);
  if(r.s===200){aplicarResposta(r.d);ligOk(true);return{ok:true,d:r.d};}
  if(r.s===409){
    const d=r.d;
    if(d.utentes){versao=d.versao;utentes=d.utentes;marcacoes=d.marcacoes||marcacoes;renderTudo();}
    if(d.motivo==="registo"&&d.atual){
      const c2=Object.assign({},c,{rev:d.atual.rev});
      const r2=await api(rota,c2,metodo);
      if(r2.s===200){aplicarResposta(r2.d);banner("Gravado sobre a versão mais recente do registo.");return{ok:true,d:r2.d};}
      banner(r2.d.erro||"Outro posto voltou a alterar o registo — feche e reveja.",true);
      return{ok:false};
    }
    if(d.motivo==="versao"||d.erro==="conflito"){
      const pos=posicaoNaLista(corpo,d);
      const ok=await confirmarConflito(msg?msg+(pos?`<br>${pos}`:""):null);
      if(ok)return mutacao(rota,corpo,null,metodo);
      return{ok:false};
    }
    if(d.motivo==="duplicado"&&d.existenteId){
      if(confirm(`Já existe um utente com este nome/contacto: ${d.existente.nome} (${d.existente.contacto}).\nAbrir o registo existente?`))
        abrirEstadoUtente(d.existenteId);
      return{ok:false};
    }
    if(d.motivo==="slot_ocupado"){
      const nomes=(d.ocupantes||[]).map(o=>o.nome).join(", ");
      const just=prompt(`A hora está ocupada (${nomes}). Máx. ${config.maxPorHora} por horário.\nEscreva o motivo da exceção justificada, ou cancele.`);
      if(just&&just.trim().length>=4){
        const c2=Object.assign({},c,{justificada:true,motivo:just.trim()});
        const r2=await api(rota,c2,metodo);   /* PUT/DELETE têm de manter o método também no retry justificado */
        if(r2.s===200){aplicarResposta(r2.d);return{ok:true,d:r2.d};}
        banner(r2.d.erro||"Não foi possível gravar.",true);return{ok:false};
      }
      banner("Gravação cancelada.",true);return{ok:false};
    }
    banner(d.erro||"Conflito — dados atualizados.",true);
    return{ok:false};
  }
  banner(r.d.erro||"Erro ao gravar.",true);
  return{ok:false};
}
function aplicarResposta(d){
  versao=d.versao;utentes=d.utentes;marcacoes=d.marcacoes;config=d.config||config;horas=d.horas||horas;horasSabado=d.horasSabado||horasSabado;
  renderTudo();banner("Alteração gravada.");
}
function posicaoNaLista(corpo,d){
  /* posição exata do utente na lista fresca devolvida no 409 (estilo flash):
     mostrar «entre o utente anterior e o seguinte» antes de gravar */
  if(!corpo.nome||!d||!Array.isArray(d.utentes))return null;
  const nome=corpo.nome.toLowerCase();
  const alvo=d.utentes.find(u=>u.nome.toLowerCase()===nome)||{nome:corpo.nome};
  const ordenados=[...d.utentes,u].sort((a,b)=>a.nome.localeCompare(b.nome,"pt"));
  const i=ordenados.findIndex(u=>u===alvo||u.nome===corpo.nome&&!u.id);
  if(i<0)return null;
  const antes=i>0?ordenados[i-1].nome:null, depois=i<ordenados.length-1?ordenados[i+1].nome:null;
  if(antes&&depois)return`Na lista, <b>${esc(corpo.nome)}</b> ficará <b>entre ${esc(antes)}</b> e <b>${esc(depois)}</b>.`;
  if(antes)return`Na lista, <b>${esc(corpo.nome)}</b> ficará <b>a seguir a ${esc(antes)}</b> (último lugar).`;
  if(depois)return`Na lista, <b>${esc(corpo.nome)}</b> ficará <b>antes de ${esc(depois)}</b> (primeiro lugar).`;
  return`A lista está vazia — <b>${esc(corpo.nome)}</b> ficará em primeiro lugar.`;
}
function confirmarConflito(msg){
  return new Promise(res=>{
    abrirModal(`<h3>Registo alterado noutro posto</h3>
      <p>${msg||"A sua alteração vai ser aplicada sobre os dados mais recentes."}</p>
      <p class="mut">Outro posto gravou entretanto. O estado mais recente já foi carregado — confirme onde a alteração vai ficar antes de gravar.</p>
      <div class="botoes"><button class="btn" onclick="fecharModal();resolverConflito(false)">Cancelar</button>
      <button class="btn primario" onclick="fecharModal();resolverConflito(true)">Confirmar e gravar</button></div>`);
    window._resConflito=res;
  });
}
function resolverConflito(ok){const r=window._resConflito;window._resConflito=null;if(r)r(ok);}

/* ============ utentes ============ */
async function addUtente(){
  const nome=document.getElementById("f-nome").value.trim();
  const contacto=document.getElementById("f-contacto").value.trim();
  const vacina=document.getElementById("f-vacina").value;
  if(!nome){alert("Preencha o nome.");return;}
  const obs=document.getElementById("f-obs").value.trim();
  const r=await mutacao("/api/utentes",{nome,contacto,vacina,obs},
    `O utente <b>${esc(nome)}</b> vai ser adicionado à lista.`);
  if(r.ok){document.getElementById("f-nome").value="";document.getElementById("f-contacto").value="";document.getElementById("f-obs").value="";}
}
function importarTxt(ev){
  const f=ev.target.files[0];if(!f)return;
  const l=new FileReader();
  l.onload=async()=>{
    // deteção de codificação: se o UTF-8 produziu caracteres de substituição,
    // o ficheiro deve estar em ANSI/Windows-1252 (Notepad antigo, Excel) — reler
    let texto=l.result;
    if(/\uFFFD/.test(texto)){
      const l2=new FileReader();
      texto=await new Promise(res=>{l2.onload=()=>res(l2.result);l2.readAsText(f,"windows-1252");});
    }
    const linhas=texto.split(/\r?\n/).filter(x=>x.trim()).map(ln=>{
      const p=ln.split(";");return{nome:p[0],contacto:(p[1]||"").trim(),vacina:p[2]};
    });
    if(!linhas.length){alert("Nenhuma linha válida.");ev.target.value="";return;}
    const r=await mutacao("/api/importar",{linhas},`${linhas.length} utentes vão ser adicionados.`);
    if(r.ok)banner(`Importação: ${r.d.inseridos} importados, ${r.d.duplicados} duplicados ignorados, ${r.d.ignorados} inválidos.`);
    ev.target.value="";
  };
  l.readAsText(f,"UTF-8");
}
function apagarUtente(id){
  const u=utentes.find(x=>x.id===id);
  if(u&&confirm(`Apagar o utente "${u.nome}" e as suas marcações?`))
    mutacao("/api/utentes/"+id,{rev:u.rev},null,"DELETE");
}
function abrirEstadoUtente(id){
  const u=utentes.find(x=>x.id===id);
  if(!u){banner("Utente não está na lista atual — a sincronizar…");sincronizar();return;}
  const suas=marcacoes.filter(m=>m.utenteId===id);
  abrirModal(`<h3>${esc(u.nome)}</h3>
    <p class="mut">${esc(u.contacto)} · ${VAC[u.vacina]}${u.obs?" · "+esc(u.obs):""}</p>
    ${suas.length?`<table><tr><th>Data</th><th>Hora</th><th>Vacinas</th><th>Estado</th></tr>${suas.map(m=>
      `<tr><td>${m.data}</td><td>${m.hora}</td><td>${m.vacinas.join("+")}</td><td>${EST[m.estado]}</td></tr>`).join("")}</table>`
      :"<p class='mut'>Sem marcações.</p>"}
    <div class="barra" style="margin-top:12px">
      <div class="campo"><label>Nome</label><input id="e-nome" value="${esc(u.nome)}"></div>
      <div class="campo"><label>Contacto</label><input id="e-contacto" value="${esc(u.contacto)}"></div>
      <div class="campo"><label>Vacina</label><select id="e-vacina">
        ${["G","C","G+C"].map(v=>`<option value="${v}" ${u.vacina===v?"selected":""}>${VAC[v]}</option>`).join("")}</select></div>
      <div class="campo"><label>Observações</label><input id="e-obs" value="${esc(u.obs||"")}" maxlength="200" style="width:100%"></div>
    </div>
    <div class="botoes">
      <button class="btn" onclick="apagarUtente('${u.id}');fecharModal()">Apagar</button>
      <button class="btn" onclick="fecharModal()">Fechar</button>
      <button class="btn primario" onclick="guardarUtente('${u.id}',${u.rev})">Gravar</button>
    </div>`);
}
async function guardarUtente(id,rev){
  const r=await mutacao("/api/utentes/"+id,{rev,nome:val("e-nome"),contacto:val("e-contacto"),vacina:val("e-vacina"),obs:val("e-obs")},
    `Os dados de <b>${esc(val("e-nome"))}</b> vão ser atualizados.`,"PUT");
  if(r.ok)fecharModal();
}
function val(id){return document.getElementById(id).value;}

/* ============ marcações ============ */
function utenteDe(id){const u=utentes.find(x=>x.id===id);return u||{nome:"?"};}
function abrirMarcar(id,data,hora){
  const u=utenteDe(id);
  const slots=data&&hora?marcacoes.filter(m=>m.data===data&&m.hora===hora&&["agendado","administrado"].includes(m.estado)):[];
  abrirModal(`<h3>Marcar: ${esc(u.nome)} — ${VAC[u.vacina]}</h3>
    <p class="mut">Contacto telefónico: ${esc(u.contacto)}${slots.length?` · <span class="just">hora com ${slots.length} marcação(ões): ${slots.map(s=>esc(utenteDe(s.utenteId).nome)).join(", ")}</span>`:""}</p>
    <div class="barra">
      <div class="campo"><label>Dia</label><input type="date" id="m-data" value="${data||isoHoje()}" onchange="atualizarHoras('m-data','m-hora','m-nota')"></div>
      <div class="campo"><label>Hora</label><select id="m-hora">${opcoesHoras(data||isoHoje(),hora)}</select></div>
      <div class="campo"><label>Vacinas a administrar</label><select id="m-vac">
        ${u.vacina==="G+C"?"<option value='G+C'>Ambas (G+C)</option><option value='G'>Só Gripe (G)</option><option value='C'>Só COVID (C)</option>"
        :`<option value='${u.vacina}'>${VAC[u.vacina]}</option>`}</select></div>
    </div>
    <label class="check" style="margin-top:8px"><input type="checkbox" id="m-multiple" onchange="document.getElementById('m-grupo-campos').hidden=!this.checked"> Reserva múltipla (marcar para acompanhantes na mesma hora)</label>
    <div id="m-grupo-campos" hidden>
      <div class="barra" style="margin-top:6px">
        <div class="campo"><label>Pessoas extra</label><input type="number" id="m-grupo-extras" min="1" max="9" value="1" style="width:90px"></div>
        <div class="campo"><label>Vacinas dos acompanhantes</label>
          <select id="m-grupo-vac"><option value="G">Gripe (G)</option><option value="C">COVID-19 (C)</option><option value="G+C">Ambas (G+C)</option></select></div>
      </div>
      <p class="mut" style="margin-top:4px">A reserva múltipla ocupa ${1} lugar(es) por cada acompanhante no horário escolhido.</p>
    </div>
    ${notaHtml("m-nota",data||isoHoje())}
    <div class="botoes"><button class="btn" onclick="fecharModal()">Cancelar</button>
    <button class="btn primario" onclick="confirmarMarcar('${u.id}')">Marcar</button></div>`);
}
async function confirmarMarcar(id){
  const data=val("m-data"),hora=val("m-hora");
  if(!confirmarDia(data,"marcação"))return;
  const horasDia=horasDoDia(data);
  if(!horasDia.length){alert("Não há horas marcáveis nesse dia.");return;}
  if(!horasDia.includes(hora)){alert(`Hora fora do horário${diaDaSemanaISO(data)===6?" de sábado":""} (${horasDia[0]}–${horasDia[horasDia.length-1]}).`);return;}
  const vac=val("m-vac")==="G+C"?["G","C"]:[val("m-vac")];
  fecharModal();
  await mutacao("/api/marcacoes",{utenteId:id,data,hora,vacinas:vac},
    `${esc(utenteDe(id).nome)} vai ficar marcado para ${data} às ${hora}.`);
}
function abrirEstadoMarcacao(mid){
  const m=marcacoes.find(x=>x.id===mid);if(!m)return;
  const u=utenteDe(m.utenteId);
  const outras=marcacoes.filter(x=>x.id!==mid&&x.data===m.data&&x.hora===m.hora&&["agendado","administrado"].includes(x.estado));
  abrirModal(`<h3>${esc(u.nome)} — ${m.data} ${m.hora}</h3>
    <p class="mut">Vacinas: ${m.vacinas.join(" + ")} · criada por ${esc(m.criadoPor||"?")}${m.grupo&&m.grupo.extras?` · +${m.grupo.extras} acompanhante(s) — ${m.grupo.vacinas.join(" + ")}`:""}${m.justificada?` · <span class="just">justificada: ${esc(m.motivo)}</span>`:""}</p>
    ${outras.length?`<p class="just">Hora partilhada com: ${outras.map(o=>esc(utenteDe(o.utenteId).nome)).join(", ")}</p>`:""}
    <label class="mut">Estado</label>
    <select id="x-estado">${ESTADOS_UI().map(e=>`<option value="${e}" ${m.estado===e?"selected":""}>${EST[e]}</option>`).join("")}</select>
    <label class="mut">Reagendar (opcional)</label>
    <div class="barra" style="margin-top:6px">
      <div class="campo"><label>Dia</label><input type="date" id="x-data" value="${m.data}" onchange="atualizarHoras('x-data','x-hora','x-nota')"></div>
      <div class="campo"><label>Hora</label><select id="x-hora">${opcoesHoras(m.data,m.hora)}</select></div>
    </div>
    ${notaHtml("x-nota",m.data)}
    <p class="mut">Se mudar dia/hora, a marcação atual liberta a hora e nasce uma nova (reagendamento).</p>
    <div class="botoes">
      <button class="btn" onclick="apagarMarcacao('${m.id}',${m.rev})">Eliminar</button>
      <button class="btn" onclick="fecharModal()">Fechar</button>
      <button class="btn primario" onclick="guardarMarcacao('${m.id}',${m.rev},'${m.data}','${m.hora}')">Gravar</button>
    </div>`);
}
function ESTADOS_UI(){return["agendado","administrado","faltou","cancelado"];}
async function guardarMarcacao(id,rev,dataAntiga,horaAntiga){
  const nd=val("x-data"),nh=val("x-hora"),estado=val("x-estado");
  if(nd!==dataAntiga||nh!==horaAntiga){
    if(!confirmarDia(nd,"reagendamento"))return;
    const horasDia=horasDoDia(nd);
    if(!horasDia.length){alert("Não há horas marcáveis nesse dia.");return;}
    if(!horasDia.includes(nh)){alert(`Hora fora do horário${diaDaSemanaISO(nd)===6?" de sábado":""} (${horasDia[0]}–${horasDia[horasDia.length-1]}).`);return;}
  }
  const corpo={rev,estado};
  if(nd!==dataAntiga||nh!==horaAntiga){corpo.novaData=nd;corpo.novaHora=nh;corpo.reagendar=true;}
  fecharModal();
  await mutacao("/api/marcacoes/"+id,corpo,
    `A marcação vai passar a <b>${EST[estado]}</b>${nd!==dataAntiga?` em ${nd} às ${nh}`:""}.`,"PUT");
}
async function apagarMarcacao(id,rev){
  fecharModal();
  await mutacao("/api/marcacoes/"+id,{rev},null,"DELETE");
}

/* ============ calendário ============ */
const DIAS=["Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
/* Dia/horas válidos: o sábado tem períodos próprios e mais curtos; o domingo não
   tem nenhum. Mesmas regras do servidor (nunca por toISOString: fuso). */
function diaDaSemanaISO(isoD){const[a,m,d]=String(isoD).split("-").map(Number);return new Date(a,m-1,d).getDay();}
function diasFechadosDoCfg(){return Array.isArray(config.diasFechados)?config.diasFechados:[];}
function diaFechado(data){return diasFechadosDoCfg().includes(data);}
function horasDoDia(data){return diaFechado(data)?[]:(diaDaSemanaISO(data)===6?horasSabado:horas);}
function opcoesHoras(data,selecionada){return horasDoDia(data).map(h=>`<option ${h===selecionada?"selected":""}>${h}</option>`).join("");}
const MSG_SABADO="Está a marcar num SÁBADO: por norma não se vacina ao sábado. Só há períodos reduzidos (09:30–12:00 e 15:00–17:00).";
function notaDoDia(data){
  if(diaFechado(data))return"A farmácia está encerrada nesse dia (dia de encerramento) — não há vacinação.";
  const g=diaDaSemanaISO(data);
  if(g===0)return"Não é possível marcar ao domingo — não há vacinação nesse dia.";
  if(g===6)return MSG_SABADO;
  return"";}
function notaHtml(id,data){const t=notaDoDia(data);
  return`<p class="mut" id="${id}"${t?"":" hidden"}>${esc(t)}</p>`;}
/* confirmação do dia: false = bloqueado (domingo) ou o utilizador cancelou */
function confirmarDia(data,acao){
  if(diaFechado(data)){alert("A farmácia está encerrada nesse dia (dia de encerramento) — escolha outro dia.");return false;}
  const g=diaDaSemanaISO(data);
  if(g===0){alert("Não é possível agendar ao domingo — não há vacinação nesse dia.");return false;}
  if(g===6)return confirm(MSG_SABADO+"\n\nConfirmar a "+acao+" num sábado?");
  return true;
}
function atualizarHoras(idData,idHora,idNota){
  const data=val(idData);
  document.getElementById(idHora).innerHTML=opcoesHoras(data,null);
  const n=idNota?document.getElementById(idNota):null;
  if(n){const t=notaDoDia(data);n.textContent=t;n.hidden=!t;}
}
/* uma célula da grelha só é marcável se a hora pertence ao dia (sábado reduzido) */
function celulaDisponivel(data,hora){return horasDoDia(data).includes(hora);}
function segundaDe(d){const d2=new Date(d);d2.setHours(0,0,0,0);d2.setDate(d2.getDate()-(d2.getDay()+6)%7);return d2;}
function mudarSemana(n){semanaBase.setDate(semanaBase.getDate()+7*n);renderCal();renderStats();}
function irParaSemanaAtual(){semanaBase=segundaDe(new Date());renderCal();renderStats();}
function iso(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}
function isoHoje(){return iso(new Date());}
function fmtData(isoStr){const[y,m,d]=isoStr.split("-");return`${d}/${m}/${y}`;}

function renderTudo(){
  if(!document.getElementById("modal").hidden)return;
  renderStats();renderUtentes();renderCal();renderHistorico();renderConfig();
}

function renderStats(){
  const diasSemana=diasDaSemana();
  let prog=0,feitas=0,faltas=0,canc=0;
  marcacoes.forEach(m=>{
    if(!diasSemana.includes(m.data))return;
    if(m.estado==="cancelado"){if(!m.supersedidaPor)canc++;return;}/* supersedida por reagendamento não é "cancelada" */
    const doses=m.vacinas.length+(m.grupo&&m.grupo.extras?m.grupo.extras*m.grupo.vacinas.length:0);
    if(m.estado==="administrado"){prog+=doses;feitas+=doses;}
    else if(m.estado==="faltou"){prog+=doses;faltas+=doses;}
    else prog+=doses;
  });
  document.getElementById("stats").innerHTML=
    `<span class="stat"><svg class="icone" style="color:var(--prim)"><use href="#i-calendario"/></svg>Programadas: <b id="s-prog">${prog}</b></span>
     <span class="stat"><svg class="icone" style="color:#15803d"><use href="#i-check"/></svg>Administradas: <b id="s-feitas">${feitas}</b></span>
     <span class="stat"><svg class="icone" style="color:var(--aviso)"><use href="#i-alerta"/></svg>Faltas: <b>${faltas}</b></span>
     <span class="stat">Canceladas: <b>${canc}</b></span>`;
}
function diasDaSemana(){const n=(config.mostrarSabado===false)?5:6;const a=[];for(let i=0;i<n;i++){const d=new Date(semanaBase);d.setDate(d.getDate()+i);a.push(iso(d));}return a;}

function renderUtentes(){
  const q=(document.getElementById("pesquisa").value||"").toLowerCase();
  const corpo=document.getElementById("corpo-utentes");corpo.innerHTML="";
  const lista=utentes.filter(u=>!q||u.nome.toLowerCase().includes(q)||u.contacto.toLowerCase().includes(q));
  if(!lista.length){corpo.innerHTML="<tr><td colspan='6' class='vazio'>Sem utentes.</td></tr>";return;}
  lista.forEach(u=>{
    const ativa=marcacoes.find(m=>m.utenteId===u.id&&m.estado==="agendado");
    const ultima=marcacoes.filter(m=>m.utenteId===u.id).sort((a,b)=>(b.data+b.hora).localeCompare(a.data+a.hora))[0];
    const est=ultima?`<span class="badge b-${ultima.estado}">${EST[ultima.estado]}</span>`:'<span class="mut">sem marcação</span>';
    const marc=ativa?`${ativa.data} ${ativa.hora}`:(ultima?`<span class="mut">${ultima.data} ${ultima.hora}</span>`:"—");
    const tr=document.createElement("tr");tr.className="utl";
    tr.innerHTML=`<td>${esc(u.nome)}</td><td>${esc(u.contacto)}</td>
      <td><span class="chip">${u.vacina}</span>${VAC[u.vacina].replace("Gripe + COVID-19","")}</td>
      <td>${est}</td><td>${marc}</td>
      <td class="sem-print"><button class="btn mini" onclick="abrirMarcar('${u.id}')">Marcar</button>
      <button class="btn mini" onclick="abrirEstadoUtente('${u.id}')">Editar</button></td>`;
    tr.onclick=e=>{if(e.target.tagName==="BUTTON")return;abrirEstadoUtente(u.id);};
    corpo.appendChild(tr);
  });
}

function renderCal(){
  const dias=diasDaSemana();
  const ini=fmtData(dias[0]),fim=fmtData(dias[dias.length-1]);
  document.getElementById("cal-periodo").textContent=`Semana ${ini} – ${fim}`;
  const nDias=config.mostrarSabado===false?5:6;
  const hoje=isoHoje();
  const ativas=d=>h=>marcacoes.filter(m=>m.data===d&&m.hora===h);
  let html=`<div class="cal-hora"></div>`;
  for(let i=0;i<nDias;i++){const d=new Date(semanaBase);d.setDate(d.getDate()+i);const di=iso(d);
    const fechado=diaFechado(di);
    html+=`<div class="cal-dia${di===hoje?" hoje":""}${fechado?" fechado":""}">${DIAS[i]}<small>${fmtData(di)}</small>`+
      (fechado?`<small class="mut">encerrado</small>`:(i===5?`<small class="mut">só 09:30–12:00 · 15:00–17:00</small>`:""))+`</div>`;}
  horas.forEach(h=>{
    html+=`<div class="cal-hora">${h}</div>`;
    for(let i=0;i<nDias;i++){const d=new Date(semanaBase);d.setDate(d.getDate()+i);const di=iso(d);
      const ms=ativas(di)(h);
      if(!celulaDisponivel(di,h)&&!ms.length){
        html+=`<div class="cal-celula indisponivel" title="Fora dos períodos de sábado (09:30–12:00 · 15:00–17:00)"></div>`;
        continue;}
      html+=`<div class="cal-celula" onclick="clicarCelula('${di}','${h}')">`+
        ms.map(m=>{const u=utenteDe(m.utenteId);
          return`<div class="cartao est-${m.estado}" onclick="event.stopPropagation();abrirEstadoMarcacao('${m.id}')" title="${esc(u.nome)} — ${EST[m.estado]}${m.justificada?" (justificada: "+esc(m.motivo)+")":""}">
            <strong>${esc(u.nome)}</strong>${m.vacinas.join("+")}${m.justificada?' <span class="just">J</span>':""}</div>`;}).join("")+
        `</div>`;}
  });
  const grelha=document.getElementById("grelha");
  grelha.style.gridTemplateColumns=`64px repeat(${nDias},minmax(118px,1fr))`;   /* sem isto a grelha ficava numa única coluna */
  grelha.innerHTML=html;
}
function clicarCelula(d,h){
  const disponiveis=utentes.filter(u=>!marcacoes.some(m=>m.utenteId===u.id&&m.data===d&&m.hora===h&&["agendado","administrado"].includes(m.estado)));
  if(!disponiveis.length){alert("Sem utentes disponíveis para esta hora (todos os utentes já têm marcação neste horário).");return;}
  abrirModal(`<h3>Marcar em ${fmtData(d)} às ${h}</h3>
    <label class="mut">Utente</label>
    <select id="m-utente">${disponiveis.map(u=>`<option value="${u.id}">${esc(u.nome)} — ${esc(u.contacto)} (${u.vacina})</option>`).join("")}</select>
    <label style="margin-top:8px"><input type="checkbox" id="m-multiple" onchange="document.getElementById('m-grupo-campos').hidden=!this.checked"> Reserva múltipla (marcar para acompanhantes na mesma hora)</label>
    <div id="m-grupo-campos" hidden>
      <div class="barra" style="margin-top:6px">
        <div class="campo"><label>Pessoas extra</label><input type="number" id="m-grupo-extras" min="1" max="9" value="1"></div>
        <div class="campo"><label>Vacinas dos acompanhantes</label><select id="m-grupo-vac"><option value="G">Gripe (G)</option><option value="C">COVID (C)</option><option value="G+C">Gripe + COVID (G+C)</option></select></div>
      </div>
    </div>
    <div class="botoes"><button class="btn" onclick="fecharModal()">Cancelar</button>
    <button class="btn primario" onclick="confirmarMarcarCal('${d}','${h}')">Marcar</button></div>`);
}
async function confirmarMarcarCal(d,h){
  const id=val("m-utente");const u=utenteDe(id);
  const vac=u.vacina==="G+C"?["G","C"]:[u.vacina];
  const corpo={utenteId:id,data:d,hora:h,vacinas:vac};
  let msg=`${esc(u.nome)} vai ficar marcado para ${fmtData(d)} às ${h}.`;
  const chk=document.getElementById("m-multiple");
  if(chk&&chk.checked){
    const extras=Number(val("m-grupo-extras"));
    if(!Number.isInteger(extras)||extras<1||extras>9){alert("Número de pessoas extra inválido (1 a 9).");return;}
    const gv=val("m-grupo-vac");
    if(!["G","C","G+C"].includes(gv)){alert("Vacinas dos acompanhantes inválidas.");return;}
    corpo.grupoExtras=extras;corpo.grupoVacinas=gv;
    msg=`${esc(u.nome)} vai ficar marcado para ${fmtData(d)} às ${h}, com +${extras} acompanhante(s) (${gv}).`;
  }
  fecharModal();
  await mutacao("/api/marcacoes",corpo,msg);
}

function horaLocal(iso){
  /* guardar em UTC (agora()), mostrar em hora local pt-PT — sem alterar o formato guardado */
  try{return new Date(iso).toLocaleString("pt-PT",{dateStyle:"short",timeStyle:"medium"});}catch(e){return iso;}
}
function renderHistorico(){
  if(document.getElementById("tab-h").hidden)return;
  api("/api/historico").then(r=>{
    if(r.s!==200)return;
    document.getElementById("corpo-historico").innerHTML=
      r.d.historico.map(h=>`<tr><td>${horaLocal(h.quando)}</td><td>${esc(h.posto)}</td><td>${esc(h.acao)}</td><td>${esc(h.detalhe)}</td></tr>`).join("");
  });
}

/* ============ exportação de dados / backup ============ */
async function exportarCSV(tipo,desde,ate){
  const q=new URLSearchParams({tipo:tipo||"marcacoes"});
  if(desde)q.set("desde",desde);
  if(ate)q.set("ate",ate);
  try{
    const r=await fetch("/api/exportar.csv?"+q.toString(),{headers:token?{"Authorization":"Bearer "+token}:{}});
    if(r.status!==200){banner("Não foi possível exportar o CSV.",true);return;}
    const blob=await r.blob();
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="vacinas-"+(tipo||"marcacoes")+"-"+isoHoje()+".csv";
    a.click();URL.revokeObjectURL(a.href);
    banner("CSV exportado"+(tipo==="utentes"?" (utentes)":" (marcações)")+".");
  }catch(e){banner("Falha na exportação do CSV.",true);}
}
async function exportarJSON(){
  try{const r=await fetch("/api/exportar",{headers:{"Authorization":"Bearer "+token}});
    if(r.status!==200){banner("Não foi possível exportar.",true);return;}
    const blob=await r.blob();
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="dados-exportados-"+isoHoje()+".json";
    a.click();URL.revokeObjectURL(a.href);
    banner("Dados exportados em JSON.");
  }catch(e){banner("Falha na exportação.",true);}
}
/* ============ painel de configuração ============ */
const CAMPOS_CFG=[["g-horaInicio","horaInicio"],["g-horaFim","horaFim"],["g-horaInicio2","horaInicio2"],["g-horaFim2","horaFim2"],
  ["g-sabadoInicio","sabadoInicio"],["g-sabadoFim","sabadoFim"],["g-sabadoInicio2","sabadoInicio2"],["g-sabadoFim2","sabadoFim2"]];
let cfgAssinatura=null;
function assinaturaCfg(){
  return JSON.stringify([config.horaInicio,config.horaFim,config.horaInicio2,config.horaFim2,
    config.sabadoInicio,config.sabadoFim,config.sabadoInicio2,config.sabadoFim2,
    config.intervaloMin,config.maxPorHora,!!config.mostrarSabado,diasFechadosDoCfg(),config.pastaBackup||""]);
}
function defCampo(id,v){const e=document.getElementById(id);if(e)e.value=v;}
function renderConfig(){
  const assin=assinaturaCfg();
  /* só reescreve o formulário quando a configuração mudou mesmo: a página
     sincroniza a cada 5 s e não pode apagar o que está a ser escrito */
  if(assin===cfgAssinatura)return;
  cfgAssinatura=assin;
  CAMPOS_CFG.forEach(([id,campo])=>defCampo(id,config[campo]||""));
  defCampo("g-intervaloMin",String(config.intervaloMin||30));
  defCampo("g-maxPorHora",String(config.maxPorHora||2));
  document.getElementById("g-mostrarSabado").checked=config.mostrarSabado!==false;
  defCampo("g-diasFechados",diasFechadosDoCfg().join("\n"));
  defCampo("g-pastaBackup",config.pastaBackup||"");
}
function lerDiasFechados(txt){return [...new Set(String(txt||"").split(/[\s,;]+/).filter(Boolean))];}
async function guardarConfigUI(){
  const corpo={};
  for(const [id,campo] of CAMPOS_CFG){
    const v=val(id);
    if(!v){alert("Preencha todos os horários (dias úteis e sábado).");return;}
    corpo[campo]=v;
  }
  const intervalo=Number(val("g-intervaloMin")),max=Number(val("g-maxPorHora"));
  if(![15,30,60].includes(intervalo)){alert("O intervalo tem de ser 15, 30 ou 60 minutos.");return;}
  if(!Number.isInteger(max)||max<1||max>20){alert("O máximo por hora tem de ser um número entre 1 e 20.");return;}
  corpo.intervaloMin=intervalo;corpo.maxPorHora=max;
  corpo.mostrarSabado=document.getElementById("g-mostrarSabado").checked;
  corpo.diasFechados=lerDiasFechados(val("g-diasFechados"));
  corpo.pastaBackup=val("g-pastaBackup").trim();
  const r=await mutacao("/api/config",corpo,
    "A configuração (horários, dias de encerramento e pasta de backup) vai ser atualizada.","PUT");
  if(r.ok)document.getElementById("config-estado").textContent="Configuração guardada.";
}
async function testarBackup(){
  const est=document.getElementById("backup-estado");est.textContent="a testar…";
  /* testa o caminho escrito (antes de guardar), não o que está gravado */
  const r=await api("/api/backup/testar",{pastaBackup:val("g-pastaBackup").trim()});
  est.textContent=r.s===200?"Caminho OK: "+r.d.pasta:(r.d.erro||"Falhou.");
}
async function backupAgora(){
  const r=await api("/api/backup",{});
  if(r.s===200)banner("Backup criado: "+r.d.ficheiro);
  else banner(r.d.erro||"Backup falhou.",true);
}

/* ============ exportação PDF ============ */
function janelaPDF(titulo){
  const w=window.open("","_blank","width=950,height=750");
  if(!w){alert("Permita janelas popup para exportar em PDF.");return null;}
  w.document.write(`<!DOCTYPE html><html lang="pt-PT"><head><meta charset="UTF-8"><title>${titulo}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#0f172a;margin:24px}
  h1{font-size:17px;color:#0f766e;margin:0 0 2px}h2{font-size:14px;color:#0f766e;margin:18px 0 6px}
  .mut{color:#64748b;font-size:11px}table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th,td{border:1px solid #bbb;padding:5px 7px;text-align:left;font-size:11px}
  th{background:#e6f4f1;color:#0f766e}.info{background:#e6f4f1;border:1px solid #ccc;padding:8px 12px;margin:10px 0}
  .confid{margin-top:22px;border-top:1px solid #bbb;padding-top:8px;color:#64748b;font-size:10px;font-style:italic}
  @media print{.confid{position:fixed;bottom:0;left:0;right:0;margin-top:0}}</style></head><body>
  <h1>Central de Marcações de Vacinas — Farmácia Boavista</h1>
  <div class="mut">Gerado em ${new Date().toLocaleString("pt-PT")} por ${esc(posto)}</div>
  <div class="confid">Documento de uso interno — contém dados pessoais de utentes sujeitos a confidencialidade e ao Regulamento Geral sobre a Proteção de Dados. Não distribuir fora da Farmácia Boavista.</div>`);
  return w;
}
function fecharPDF(w){w.document.write("<script>window.onload=()=>window.print()<\/script></body></html>");w.document.close();}
function exportarUtentesPDF(){
  const w=janelaPDF("Utentes");if(!w)return;
  w.document.write("<h2>Lista de utentes</h2><table><tr><th>Nome</th><th>Contacto</th><th>Vacina</th><th>Estado</th><th>Marcação</th></tr>");
  utentes.forEach(u=>{
    const ult=marcacoes.filter(m=>m.utenteId===u.id).sort((a,b)=>(b.data+b.hora).localeCompare(a.data+a.hora))[0];
    w.document.write(`<tr><td>${esc(u.nome)}</td><td>${esc(u.contacto)}</td><td>${VAC[u.vacina]}</td>
      <td>${ult?EST[ult.estado]:"—"}</td><td>${ult?ult.data+" "+ult.hora+(ult.grupo&&ult.grupo.extras?` (+${ult.grupo.extras} acomp.)`:""):"—"}</td></tr>`);
  });
  w.document.write("</table>");fecharPDF(w);
}
function exportarCalPDF(modo){
  const w=janelaPDF("Calendário");if(!w)return;
  const selDia=document.getElementById("pdf-dia");
  const diaEscolhido=selDia?selDia.value:isoHoje();
  const dias=(modo==="dia")?[diaEscolhido||isoHoje()]:diasDaSemana();
  let prog=0,feitas=0;
  const rotulo=(modo==="dia")?`Dia ${fmtData(dias[0])}`:`Semana de ${fmtData(diasDaSemana()[0])} a ${fmtData(diasDaSemana()[diasDaSemana().length-1])}`;
  w.document.write(`<div class="info"><b>${rotulo}</b> · Programadas: <b id="p"></b> · Administradas: <b id="f"></b></div>`);
  dias.forEach(d=>{
    const ms=marcacoes.filter(m=>m.data===d);
    w.document.write(`<h2>${fmtData(d)}</h2>`);
    if(!ms.length){w.document.write("<p class='mut'>Sem marcações.</p>");return;}
    w.document.write("<table><tr><th>Hora</th><th>Utente</th><th>Contacto</th><th>Vacinas</th><th>Estado</th><th>Justificação</th></tr>");
    ms.sort((a,b)=>a.hora.localeCompare(b.hora)).forEach(m=>{
      const u=utenteDe(m.utenteId);
      const doses=m.vacinas.length+(m.grupo&&m.grupo.extras?m.grupo.extras*m.grupo.vacinas.length:0);
      if(m.estado==="administrado"){prog+=doses;feitas+=doses;}else if(m.estado!=="cancelado")prog+=doses;
      w.document.write(`<tr><td>${m.hora}</td><td>${esc(u.nome)}${m.grupo&&m.grupo.extras?` <span class="chip">+${m.grupo.extras}</span>`:""}</td><td>${esc(u.contacto)}</td><td>${m.vacinas.join("+")}</td><td>${EST[m.estado]}</td><td>${esc(m.motivo||"—")}</td></tr>`);
    });
    w.document.write("</table>");
  });
  w.document.write(`<script>document.getElementById('p').textContent='${prog}';document.getElementById('f').textContent='${feitas}'<\/script>`);
  fecharPDF(w);
}

/* ============ tabs / modal ============ */
function mostrarTab(t){
  ["l","c","g","h"].forEach(x=>{
    document.getElementById("tab-"+x).hidden=x!==t;
    document.getElementById("tab-"+x+"-btn").classList.toggle("ativa",x===t);
  });
  if(t==="g")renderConfig();
  if(t==="h")renderHistorico();
}
function abrirModal(html){document.getElementById("modal-conteudo").innerHTML=html;document.getElementById("modal").hidden=false;}
function fecharModal(){document.getElementById("modal").hidden=true;renderTudo();}

/* ============ arranque ============ */
document.getElementById("ficheiro-txt").addEventListener("change",importarTxt);
document.getElementById("pesquisa").addEventListener("input",renderUtentes);
document.getElementById("pin-input").addEventListener("keydown",e=>{if(e.key==="Enter")entrar();});
(async()=>{await initPin();await recuperarSessao();})();
