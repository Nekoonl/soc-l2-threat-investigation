'use strict';

const icons = {
  shield:'<path d="M12 3 21 7v6c0 5-9 9-9 9s-9-4-9-9V7z"/><path d="m8 12 3 3 5-6"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 7-7M12 3v3M3 12h3M12 18v3M18 12h3"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  workflow:'<rect x="3" y="9" width="6" height="6" rx="1"/><rect x="15" y="2" width="6" height="6" rx="1"/><rect x="15" y="16" width="6" height="6" rx="1"/><path d="M9 12h3V5h3M12 12v7h3"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  chart:'<path d="M4 3v17h17M8 15v-4M13 15V7M18 15V4"/>',
  layers:'<path d="m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  play:'<path d="m8 4 12 8-12 8z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  donut:'<path d="M12 3a9 9 0 1 0 9 9h-9zM16 3v5h5a7 7 0 0 0-5-5"/>',
  alert:'<path d="m12 3 10 18H2zM12 9v5M12 17h.01"/>',
  server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
  search:'<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  x:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  spark:'<path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7zM20 2v4M18 4h4"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5M5.5 7a8 8 0 0 1 13-2L20 7M4 17l1.5 2a8 8 0 0 0 13-2"/>',
};
function icon(name){return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.file}</svg>`;}
function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);el.removeAttribute('data-icon');});}
const $ = selector=>document.querySelector(selector);
const esc = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value=>Number(value||0).toLocaleString('es-PA');
const labels={critical:'Crítico',high:'Alto',medium:'Medio',low:'Bajo',new:'Nuevo',investigating:'En investigación',resolved:'Resuelto',false_positive:'Falso positivo'};
const fieldLabels={timestamp:'Fecha / hora',src_ip:'IP de origen',dst_ip:'IP de destino',username:'Usuario',hostname:'Host / equipo',event_type:'Tipo de evento',event_id:'ID de evento',status:'Resultado',dst_port:'Puerto de destino',bytes_sent:'Bytes enviados',message:'Mensaje / comando'};
const titles={overview:'Vista general',incidents:'Incidentes',logs:'Explorador de logs',rules:'Reglas y correlación',reports:'Informes'};
const state={data:null,view:'overview',logPage:1,logTotal:0,events:new Map(),file:null,preview:null,previewVersion:0,currentIncident:null,toastTimer:null};
const severityPill = severity=>`<span class="pill ${esc(severity)}"><i></i>${esc(labels[severity])}</span>`;
const statusLabel = status=>`<span class="status ${esc(status)}">${esc(labels[status])}</span>`;
function date(value,full=false){if(!value)return '—';return new Date(value).toLocaleString('es-PA',{timeZone:'UTC',day:'2-digit',month:'short',...(full?{year:'numeric'}:{}),hour:'2-digit',minute:'2-digit',hour12:false});}
function time(value){return new Date(value).toLocaleTimeString('es-PA',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false});}
function toast(message,error=false){clearTimeout(state.toastTimer);const el=$('#toast');el.textContent=message;el.className=error?'error':'';el.hidden=false;state.toastTimer=setTimeout(()=>{el.hidden=true;},error?9000:5000);}
async function api(path,options={}){
  const response=await fetch(path,options);
  const body=await response.json();
  if(!response.ok){const error=new Error(body.error||'No fue posible completar la solicitud.');error.details=body;throw error;}
  return body;
}
function jsonOptions(method,body){return {method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};}
function empty(title,description,action=false){return `<div class="empty-state"><span class="empty-icon">${icon('radar')}</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action?`<button class="button secondary" data-demo>${icon('play')}Explorar escenario demo</button>`:''}</div>`;}
function table(headers,rows){return `<div class="table-scroll"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;}

async function refresh(){
  const data=await api('/api/overview');state.data=data;
  $('#incident-count').textContent=number(data.metrics.open);
  const mode=$('#data-mode');mode.classList.toggle('demo',data.synthetic);
  mode.innerHTML=`<span class="status-dot"></span>${data.synthetic?'Laboratorio · datos sintéticos':data.metrics.events?'Evidencia local':'Sin evidencia'}`;
  const demo=$('#demo-button');demo.innerHTML=`${icon(data.synthetic?'refresh':'play')}${data.synthetic?'Reiniciar demo':'Cargar demo'}`;demo.disabled=Boolean(data.metrics.events&&!data.synthetic);
  demo.title=demo.disabled?'La demo requiere una base vacía para no mezclar fuentes.':'';
  renderDashboard();renderRules();renderImports();renderAudit();
  if(state.view==='incidents')renderIncidents();
  if(state.view==='logs')await loadLogs();
}
function renderDashboard(){
  const d=state.data,m=d.metrics;
  const metrics=[['Eventos analizados',m.events,'database','Filas válidas y sin duplicados',''],['Incidentes detectados',m.incidents,'radar',`${number(m.open)} pendientes de investigación`, ''],['Alertas críticas',m.critical,'alert','Prioridad de atención inmediata','critical'],['Activos observados',m.assets,'server','Hosts o destinos identificados','']];
  $('#metrics').innerHTML=metrics.map(([title,value,symbol,caption,cls])=>`<div class="metric ${cls}"><div class="metric-top"><span>${esc(title)}</span><span class="metric-icon">${icon(symbol)}</span></div><div class="metric-number">${number(value)}</div><div class="metric-caption">${icon('check')}${esc(caption)}</div></div>`).join('');
  $('#range-label').textContent=d.range?`${date(d.range.start)} — ${date(d.range.end)}`:'Sin periodo de evidencia';
  $('#chart-total').textContent=`${number(m.events)} eventos`;
  $('#priority-count').textContent=number(d.incidents.filter(i=>i.status==='new'||i.status==='investigating').length);
  const priority=d.incidents.filter(i=>i.status==='new'||i.status==='investigating').slice(0,5);
  $('#priority-table').innerHTML=priority.length?incidentTable(priority):empty(m.incidents?'Sin investigaciones pendientes':'Tu próxima investigación comienza aquí',m.incidents?'Todas las alertas están resueltas o clasificadas como falso positivo.':'Importa tus logs o explora un escenario sintético con patrones de ataque.',!m.events);
  renderTimeline(d.timeline);renderRisk(m.severity,m.incidents);
  const max=d.top_sources[0]?.count||1;
  $('#top-sources').innerHTML=d.top_sources.length?`<div class="source-list">${d.top_sources.map(s=>`<div class="source-row"><span class="source-ip mono">${esc(s.ip)}</span><div class="source-meter"><span style="width:${Math.max(3,s.count/max*100)}%"></span></div><span class="source-number">${number(s.count)}</span></div>`).join('')}</div>`:empty('Sin orígenes registrados','Las IP aparecerán después de importar evidencia.');
}
function renderTimeline(bins){
  const el=$('#timeline-chart');
  if(!bins.length){el.innerHTML=`<div class="chart-empty">${icon('chart')}<span>La actividad aparecerá al importar tus logs</span></div>`;return;}
  const max=Math.max(...bins.map(b=>b.events),1),w=680,h=184,left=38,right=12,top=15,bottom=31,plotH=h-top-bottom,plotW=w-left-right;
  const point=(value,index)=>[left+index/(bins.length-1)*plotW,top+plotH-value/max*plotH];
  const line=values=>values.map((v,i)=>`${i?'L':'M'}${point(v,i).map(n=>n.toFixed(2)).join(',')}`).join(' ');
  const eventsLine=line(bins.map(b=>b.events)),flagsLine=line(bins.map(b=>b.flagged));
  const ticks=[0,.25,.5,.75,1];
  el.innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Distribución temporal de ${number(state.data.metrics.events)} eventos; ${number(state.data.incidents.length)} incidentes detectados"><defs><linearGradient id="mintGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#70cfa7" stop-opacity=".2"/><stop offset="100%" stop-color="#70cfa7" stop-opacity="0"/></linearGradient></defs>${ticks.map(t=>`<line class="chart-grid" x1="${left}" x2="${w-right}" y1="${top+plotH-t*plotH}" y2="${top+plotH-t*plotH}"/><text text-anchor="end" x="${left-9}" y="${top+plotH-t*plotH+3}">${Math.round(max*t)}</text>`).join('')}<path class="chart-area" d="${eventsLine} L${w-right},${top+plotH} L${left},${top+plotH} Z"/><path class="chart-line" d="${eventsLine}"/><path class="flag-line" d="${flagsLine}"/>${[0,5,11,17,23].map(i=>`<text text-anchor="${i===0?'start':i===23?'end':'middle'}" x="${point(0,i)[0]}" y="${h-7}">${time(bins[i].timestamp)}</text>`).join('')}${bins.map((b,i)=>`<circle cx="${point(b.events,i)[0]}" cy="${point(b.events,i)[1]}" r="6" fill="transparent"><title>${esc(date(b.timestamp))} UTC: ${b.events} eventos, ${b.flagged} vinculados a alertas</title></circle>`).join('')}</svg>`;
}
function renderRisk(severity,total){
  const colors={critical:'#e6919e',high:'#deb17b',medium:'#b9bf88',low:'#88cda7'},circumference=2*Math.PI*52;let offset=0;
  const segments=Object.keys(colors).map(key=>{const length=total?severity[key]/total*circumference:0;const segment=`<circle cx="66" cy="66" r="52" fill="none" stroke="${colors[key]}" stroke-width="11" stroke-dasharray="${Math.max(0,length-(length?3:0))} ${circumference}" stroke-dashoffset="${-offset}"/>`;offset+=length;return segment;}).join('');
  $('#risk-chart').innerHTML=`<div class="risk-content"><div class="donut-wrap"><svg viewBox="0 0 132 132" role="img" aria-label="${Object.keys(colors).map(k=>`${labels[k]}: ${severity[k]}`).join(', ')}"><circle cx="66" cy="66" r="52" fill="none" stroke="#26382f" stroke-width="11"/>${total?segments:''}</svg><div class="donut-center"><strong>${number(total)}</strong><span>incidentes</span></div></div><div class="risk-legend">${Object.keys(colors).map(k=>`<div class="risk-row"><i style="background:${colors[k]}"></i><span>${labels[k]}</span><strong>${number(severity[k])}</strong></div>`).join('')}</div></div>`;
}
function incidentTable(items){return table(['INCIDENTE','RIESGO','ORIGEN','MITRE ATT&CK','ESTADO',''],items.map(i=>`<tr><td><button class="table-button" data-incident="${esc(i.id)}"><span class="incident-title"><span class="incident-symbol">${icon(i.rule_id.startsWith('AUTH')?'lock':i.rule_id.startsWith('NET')?'radar':'alert')}</span><span>${esc(i.title)}<small>${esc(i.id)} · ${number(i.event_count)} eventos</small></span></span></button></td><td>${severityPill(i.severity)}</td><td><span class="mono">${esc(i.src_ip||i.hostname||'No disponible')}</span></td><td><a class="mitre-chip" href="${mitreLink(i.technique)}" target="_blank" rel="noopener noreferrer">${esc(i.technique)}</a></td><td>${statusLabel(i.status)}</td><td><button class="table-arrow" data-incident="${esc(i.id)}" aria-label="Abrir ${esc(i.title)}">${icon('arrow-right')}</button></td></tr>`));}
function mitreLink(technique){return 'https://attack.mitre.org/techniques/'+technique.replace('.','/')+'/';}
function renderIncidents(){
  if(!state.data)return;
  const q=$('#incident-search').value.toLowerCase(),severity=$('#severity-filter').value,status=$('#status-filter').value;
  const items=state.data.incidents.filter(i=>(!severity||i.severity===severity)&&(!status||i.status===status)&&(!q||[i.id,i.title,i.src_ip,i.hostname,i.username].join(' ').toLowerCase().includes(q)));
  $('#all-incidents').innerHTML=items.length?incidentTable(items):empty('Sin incidentes para mostrar',state.data.metrics.events?'Ningún incidente coincide con los filtros actuales.':'Importa logs para iniciar la investigación.');
}
async function loadLogs(){
  const result=await api(`/api/events?page=${state.logPage}&q=${encodeURIComponent($('#log-search').value)}`);
  state.logTotal=result.total;result.events.forEach(e=>state.events.set(e.id,e));
  $('#logs-table').innerHTML=result.events.length?table(['FECHA / HORA UTC','ORIGEN','DESTINO','USUARIO / HOST','EVENTO','RESULTADO',''],result.events.map(e=>`<tr><td class="mono">${esc(date(e.timestamp))}</td><td class="mono">${esc(e.src_ip||'—')}</td><td class="mono">${esc(e.dst_ip||'—')}${e.dst_port?':'+e.dst_port:''}</td><td>${esc(e.username||'—')}<br><small class="subtle">${esc(e.hostname||'—')}</small></td><td>${esc(e.event_id||e.event_type||'—')}</td><td>${esc(e.status||'—')}</td><td><button class="table-arrow" data-event="${e.id}" aria-label="Ver evento ${e.id}">${icon('arrow-right')}</button></td></tr>`)):empty('Sin eventos para mostrar','Importa un archivo o ajusta la búsqueda.');
  $('#logs-total').textContent=`${number(result.total)} eventos · 50 por página`;
  $('#logs-page').textContent=String(state.logPage);$('#logs-prev').disabled=state.logPage<=1;$('#logs-next').disabled=state.logPage*50>=result.total;
}
function renderImports(){
  const items=state.data.imports;
  $('#imports-table').innerHTML=items.length?table(['ARCHIVO','IMPORTACIÓN UTC','NUEVOS','DUPLICADOS','RECHAZADOS','SHA-256'],items.map(i=>`<tr><td>${esc(i.filename)}</td><td class="mono">${esc(date(i.created_at))}</td><td>${number(i.accepted)}</td><td>${number(i.duplicates)}</td><td>${number(i.rejected)}</td><td class="mono" title="${esc(i.sha256)}">${esc(i.sha256.slice(0,16))}…</td></tr>`)):empty('Sin importaciones','Aquí aparecerá la trazabilidad de cada archivo analizado.');
}
function renderRules(){
  $('#rules-grid').innerHTML=state.data.rules.map(r=>`<section class="card rule-card"><div class="rule-card-top"><span class="rule-id">${esc(r.id)}</span><span class="pill green">Activa · ${r.score}/100</span></div><h2>${esc(r.name)}</h2><p>${esc(r.condition)}</p><div class="rule-mitre"><a class="mitre-chip" href="${mitreLink(r.technique)}" target="_blank" rel="noopener noreferrer">${esc(r.technique)}</a><span>${esc(r.tactic)}</span></div><p class="rule-limit">${esc(r.limitations)}</p></section>`).join('');
}
function renderAudit(){
  const actions={import:'Importación',triage:'Triage',analysis:'Análisis',analysis_invalidated:'Nueva evidencia',report:'Informe PDF',reset_demo:'Reinicio demo'};
  $('#audit-table').innerHTML=state.data.audit.length?table(['FECHA / HORA UTC','ACCIÓN','DETALLE'],state.data.audit.map(a=>`<tr><td class="mono">${esc(date(a.created_at))}</td><td class="audit-action">${esc(actions[a.action]||a.action)}</td><td class="truncate">${esc(a.details)}</td></tr>`)):empty('El laboratorio está listo','La actividad de importación, investigación e informes quedará registrada aquí.');
}
async function switchView(){
  const name=location.hash.slice(1)||'overview';state.view=titles[name]?name:'overview';
  document.querySelectorAll('.view').forEach(el=>{el.hidden=el.id!==`view-${state.view}`;});
  document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===state.view);el.toggleAttribute('aria-current',el.dataset.view===state.view);});
  $('#breadcrumb-title').textContent=titles[state.view];document.title=`${titles[state.view]} | SOC L2`;
  if(state.view==='incidents')renderIncidents();
  if(state.view==='logs')try{await loadLogs();}catch(e){toast(e.message,true);}
}
function openImport(){
  if(state.data?.synthetic){$('#reset-dialog').showModal();toast('Reinicia los datos demo para comenzar con tu propia evidencia.');return;}
  $('#import-dialog').showModal();
}
async function previewFile(file){
  const version=++state.previewVersion;state.file=file;state.preview=null;$('#confirm-import').disabled=true;$('#mapping-area').hidden=true;$('#import-result').innerHTML='';
  if(!file)return;
  $('#file-label').textContent=file.name;
  if(file.size>10*1024*1024){$('#import-result').innerHTML=resultBox('El archivo supera el límite de 10 MB.',true);return;}
  $('#import-result').innerHTML=resultBox('Leyendo el archivo y detectando columnas…');
  const form=new FormData();form.append('file',file);
  try{
    const preview=await api('/api/import/preview',{method:'POST',body:form});
    if(version!==state.previewVersion)return;
    state.preview=preview;$('#import-result').innerHTML='';
    $('#mapping-area').innerHTML=`<div class="mapping-heading"><h3>Mapeo de columnas</h3><p>${number(preview.total)} filas detectadas · * Obligatorio</p></div><div class="mapping-grid">${preview.fields.map(f=>`<div class="mapping-field ${f==='timestamp'?'required':''}"><label for="map-${esc(f)}">${esc(fieldLabels[f])}</label><select id="map-${esc(f)}" data-map-field="${esc(f)}"><option value="">Sin asignar</option>${preview.headers.map(h=>`<option value="${esc(h)}"${preview.mapping[f]===h?' selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div><details class="preview-data"><summary>Vista previa del archivo · primeras ${preview.rows.length} filas</summary>${table(preview.headers.map(esc),preview.rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell.length>100?cell.slice(0,100)+'…':cell)}</td>`).join('')}</tr>`))}</details>`;
    $('#mapping-area').hidden=false;$('#confirm-import').disabled=false;
  }catch(e){if(version===state.previewVersion)$('#import-result').innerHTML=resultBox(e.message,true);}
}
function resultBox(message,error=false,errors=[]){return `<div class="result-box${error?' error':''}"><strong>${esc(message)}</strong>${errors.length?`<details><summary>Ver errores de filas (hasta 100)</summary><ul>${errors.map(e=>`<li>Fila ${e.row}: ${esc(e.error)}</li>`).join('')}</ul></details>`:''}</div>`;}
async function importFile(){
  if(!state.file||!state.preview)return;
  const button=$('#confirm-import'),mapping={};
  document.querySelectorAll('[data-map-field]').forEach(el=>{if(el.value)mapping[el.dataset.mapField]=el.value;});
  if(!mapping.timestamp){$('#import-result').innerHTML=resultBox('Asigna la columna Fecha / hora.',true);return;}
  const form=new FormData();form.append('file',state.file);form.append('mapping',JSON.stringify(mapping));
  button.disabled=true;button.innerHTML=`${icon('clock')}Analizando…`;$('#file-input').disabled=true;$('#import-result').innerHTML='';
  try{
    const result=await api('/api/import',{method:'POST',body:form});
    $('#import-result').innerHTML=resultBox(`Importación finalizada: ${number(result.accepted)} nuevos · ${number(result.duplicates)} duplicados · ${number(result.rejected)} rechazados.`,Boolean(result.rejected),result.errors);
    state.preview=null;await refresh();toast('Evidencia importada y detecciones actualizadas.');
  }catch(e){$('#import-result').innerHTML=resultBox(e.message,true,e.details?.errors||[]);button.disabled=false;}
  finally{button.innerHTML=`${icon('radar')}Importar y analizar`;$('#file-input').disabled=false;}
}
async function loadDemo(button){
  if(state.data?.synthetic){$('#reset-dialog').showModal();return;}
  if(button)button.disabled=true;
  try{await api('/api/demo',{method:'POST'});await refresh();toast('Escenario sintético cargado. Abre un incidente para explorar su evidencia.');}
  catch(e){toast(e.message,true);}finally{if(button&&!state.data?.metrics.events)button.disabled=false;}
}
async function resetDemo(){
  const button=$('#confirm-reset');button.disabled=true;
  try{await api('/api/demo/reset',jsonOptions('POST',{confirmation:'REINICIAR DEMO'}));$('#reset-dialog').close();state.events.clear();await refresh();toast('Laboratorio reiniciado. Puedes importar tus propios logs.');}
  catch(e){toast(e.message,true);}finally{button.disabled=false;}
}
async function openIncident(id){
  const item=await api('/api/incidents/'+encodeURIComponent(id));state.currentIncident=item;item.evidence.forEach(e=>state.events.set(e.id,e));
  $('#incident-detail').innerHTML=`<div class="detail-hero"><div class="detail-hero-top"><div><span class="mono subtle">${esc(item.id)}</span>${severityPill(item.severity)}<span class="mitre-chip">${esc(item.technique)}</span></div><button class="icon-button" data-close aria-label="Cerrar incidente">${icon('x')}</button></div><h2>${esc(item.title)}</h2><p>${esc(item.explanation)}</p><div class="detail-meta"><span>Origen<strong class="mono">${esc(item.src_ip||'—')}</strong></span><span>Usuario<strong>${esc(item.username||'—')}</strong></span><span>Host<strong>${esc(item.hostname||'—')}</strong></span><span>Prioridad<strong>${item.score}/100</strong></span></div></div><div class="detail-body"><div class="detail-columns"><div><section class="detail-section"><h3>Línea de evidencia · ${number(item.evidence.length)} eventos</h3><p class="subtle">${esc(date(item.first_seen,true))} — ${esc(date(item.last_seen,true))} UTC</p><div style="margin-top:17px">${item.evidence.slice(0,100).map(e=>`<div class="evidence-item"><time>${esc(date(e.timestamp))} UTC</time><p><strong>${esc(e.event_id||e.event_type||'Evento')}</strong> · ${esc(e.username||e.src_ip||e.hostname||'—')} · ${esc(e.status||'sin resultado')}</p><p>${esc(e.message.slice(0,200))}</p><details><summary>Evento #${e.id} · ${esc(e.filename)} · fila ${e.row_number}</summary><pre class="raw-event">${esc(JSON.stringify(e.raw,null,2))}</pre></details></div>`).join('')}</div>${item.evidence.length>100?`<p>Se muestran 100 de ${number(item.evidence.length)} eventos. Consulta la evidencia completa en el explorador.</p>`:''}</section></div><div><section class="detail-section"><h3>Seguimiento del analista</h3><form id="triage-form" class="triage-form"><label for="triage-status">Estado de investigación</label><select id="triage-status">${['new','investigating','resolved','false_positive'].map(s=>`<option value="${s}"${item.status===s?' selected':''}>${labels[s]}</option>`).join('')}</select><label for="triage-notes">Notas y decisiones</label><textarea id="triage-notes" rows="5" maxlength="10000" placeholder="Contexto, validaciones realizadas y próximos pasos…">${esc(item.notes)}</textarea><button class="button secondary" type="submit">${icon('check')}Guardar seguimiento</button></form></section><section class="detail-section"><h3>Incidentes relacionados · ${item.related.length}</h3>${item.related.length?item.related.map(r=>`<button class="related-link" data-incident="${esc(r.id)}"><span>${esc(r.title)}<small>${esc(r.reasons.join(' · '))}</small></span>${icon('arrow-right')}</button>`).join(''):'<p>Sin relaciones que cumplan los criterios actuales.</p>'}</section><section class="detail-section"><h3>Validación necesaria</h3><p>${esc(item.limitations)}</p></section></div></div><section class="analysis-box"><h3>${icon('spark')}Asistente de investigación</h3><p>Documenta una hipótesis y próximos pasos a partir de la evidencia. Revisa el resultado antes de usarlo en una decisión.</p><div id="analysis-content">${item.analysis?analysisHTML(item.analysis):''}</div><div class="analysis-buttons"><button class="button secondary" data-analyze="guided">${icon('workflow')}Análisis guiado</button><button class="button primary" data-analyze="ollama"${!state.data.ai_configured?' disabled':''}>${icon('spark')}Analizar con IA local</button></div>${!state.data.ai_configured?'<div class="analysis-config">IA local sin configurar. Instala Ollama y define <code>SOC_OLLAMA_MODEL</code> antes de iniciar la plataforma. El análisis guiado usa reglas y está disponible sin un modelo.</div>':`<div class="analysis-config">Modelo local: ${esc(state.data.ai_model)} · Muestra máxima de 40 eventos por análisis.</div>`}</section></div>`;
  if(!$('#incident-dialog').open)$('#incident-dialog').showModal();
}
function analysisHTML(a){return `<div class="analysis-result"><span class="pill ${a.provider==='ollama'?'green':'medium'}">${a.provider==='ollama'?'IA local · '+esc(a.model):'Análisis guiado por reglas · sin IA'}</span><h4>Resumen</h4><p>${esc(a.summary)}</p><h4>Hipótesis</h4><p>${esc(a.hypothesis)}</p><h4>Evidencia considerada</h4><ul>${a.evidence.map(e=>`<li>${esc(e)}</li>`).join('')}</ul><h4>Recomendaciones</h4><ul>${a.recommendations.map(r=>`<li>${esc(r)}</li>`).join('')}</ul><h4>Limitaciones</h4><p>${esc(a.limitations)}</p><div class="analysis-meta">Generado ${esc(date(a.created_at,true))} UTC${a.sampled_events!==undefined?` · ${a.sampled_events} de ${a.evidence_total} eventos enviados al modelo`:''}. Requiere revisión del analista.</div></div>`;}
async function runAnalysis(provider){
  const id=state.currentIncident.id,buttons=[...document.querySelectorAll('[data-analyze]')];
  buttons.forEach(b=>b.disabled=true);$('#analysis-content').innerHTML='<p>Preparando el análisis. El modelo local puede tardar hasta dos minutos…</p>';
  try{const analysis=await api(`/api/incidents/${encodeURIComponent(id)}/analysis`,jsonOptions('POST',{provider}));if(state.currentIncident?.id===id){state.currentIncident.analysis=analysis;$('#analysis-content').innerHTML=analysisHTML(analysis);}toast(provider==='ollama'?'Análisis de IA guardado. Revisa sus conclusiones.':'Análisis guiado guardado.');}
  catch(e){if(state.currentIncident?.id===id)$('#analysis-content').innerHTML=resultBox(e.message,true);toast(e.message,true);}
  finally{if(state.currentIncident?.id===id)document.querySelectorAll('[data-analyze]').forEach(b=>{b.disabled=b.dataset.analyze==='ollama'&&!state.data.ai_configured;});}
}
async function saveTriage(form){
  const button=form.querySelector('button');button.disabled=true;
  try{const item=await api('/api/incidents/'+encodeURIComponent(state.currentIncident.id),jsonOptions('PATCH',{status:$('#triage-status').value,notes:$('#triage-notes').value}));state.currentIncident.status=item.status;state.currentIncident.notes=item.notes;await refresh();toast('Seguimiento guardado.');}
  catch(e){toast(e.message,true);}finally{button.disabled=false;}
}
function openEvent(id){
  const e=state.events.get(Number(id));if(!e)return;
  const fields=['timestamp','src_ip','dst_ip','username','hostname','event_type','event_id','status','dst_port','bytes_sent'];
  $('#event-detail').innerHTML=`<span class="eyebrow">EVENTO #${e.id} ${e.synthetic?'· SINTÉTICO':''}</span><dl class="event-fields">${fields.map(f=>`<div><dt>${esc(fieldLabels[f])}${f==='timestamp'?' UTC':''}</dt><dd>${esc(e[f]||'—')}</dd></div>`).join('')}</dl><h3>Mensaje normalizado</h3><pre class="raw-event">${esc(e.message||'Sin mensaje')}</pre><h3>Fila de origen</h3><p class="subtle">${esc(e.filename)} · fila ${e.row_number}</p><pre class="raw-event">${esc(JSON.stringify(e.raw,null,2))}</pre>`;
  $('#event-dialog').showModal();
}
async function downloadReport(kind,button){
  button.disabled=true;const original=button.innerHTML;button.innerHTML=`${icon('clock')}Generando informe…`;
  try{const response=await fetch(`/api/reports/${kind}.pdf`);if(!response.ok){const error=await response.json();throw new Error(error.error||'Error al generar el informe.');}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`SOC-L2-${kind}.pdf`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Informe PDF generado.');await refresh();}
  catch(e){toast(e.message,true);}finally{button.disabled=false;button.innerHTML=original;}
}
function debounce(fn,delay=300){let timer;return (...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);};}

document.addEventListener('click',async event=>{
  const button=event.target.closest('button,a');if(!button)return;
  try{
    if(button.hasAttribute('data-import'))openImport();
    else if(button.hasAttribute('data-close'))button.closest('dialog').close();
    else if(button.hasAttribute('data-demo'))await loadDemo(button);
    else if(button.dataset.incident)await openIncident(button.dataset.incident);
    else if(button.dataset.event)openEvent(button.dataset.event);
    else if(button.dataset.analyze)await runAnalysis(button.dataset.analyze);
    else if(button.dataset.report)await downloadReport(button.dataset.report,button);
  }catch(e){toast(e.message,true);}
});
document.addEventListener('submit',event=>{if(event.target.id==='triage-form'){event.preventDefault();saveTriage(event.target);}});
$('#demo-button').addEventListener('click',event=>loadDemo(event.currentTarget));
$('#file-input').addEventListener('change',event=>previewFile(event.target.files[0]));
$('#confirm-import').addEventListener('click',importFile);
$('#confirm-reset').addEventListener('click',resetDemo);
$('#incident-search').addEventListener('input',renderIncidents);
$('#severity-filter').addEventListener('change',renderIncidents);
$('#status-filter').addEventListener('change',renderIncidents);
$('#log-search').addEventListener('input',debounce(async()=>{state.logPage=1;try{await loadLogs();}catch(e){toast(e.message,true);}}));
$('#logs-prev').addEventListener('click',async()=>{state.logPage=Math.max(1,state.logPage-1);try{await loadLogs();}catch(e){toast(e.message,true);}});
$('#logs-next').addEventListener('click',async()=>{state.logPage++;try{await loadLogs();}catch(e){toast(e.message,true);}});
const dropzone=$('#dropzone');
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.add('dragover');}));
['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,event=>{event.preventDefault();dropzone.classList.remove('dragover');}));
dropzone.addEventListener('drop',event=>{if(!$('#file-input').disabled&&event.dataTransfer.files.length)previewFile(event.dataTransfer.files[0]);});
window.addEventListener('hashchange',switchView);
hydrateIcons();$('#today').textContent=new Date().toLocaleDateString('es-PA',{day:'2-digit',month:'short',year:'numeric'});
refresh().then(switchView).catch(error=>{toast('No se pudo cargar la plataforma: '+error.message,true);$('#priority-table').innerHTML=empty('No se pudo conectar con la API','Revisa que el servidor esté iniciado y recarga la página.');});
