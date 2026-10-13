/* CSVs are parsed in the browser. No uploaded content leaves this page. */
(function () {
  'use strict';
  const config = Object.assign({source:'data', dataUrl:'./data/', examplesUrl:'./examples/', refreshMs:60000, timeoutMs:15000, historyLimit:240}, window.SERVER1_CONFIG);
  let busy = false, manual = false, lastFetch = '';
  const files = {
    users: 'user_disk_usage.csv', quotas: 'user_quotas.csv',
    disk: 'disk_summary.csv', memory: 'memory_summary.csv'
  };
  const fields = {
    users: { username: ['username','user','usuario','usuário','login'], used_gb: ['used_gb','usage_gb','disk_used_gb','size_gb','total_gb'] },
    quotas: { username: ['username','user','usuario','usuário','login'], soft_limit_gb: ['soft_limit_gb','soft_gb','quota_soft_gb'], hard_limit_gb: ['hard_limit_gb','hard_gb','quota_hard_gb'] },
    disk: { filesystem: ['filesystem','mountpoint','mount_point','mount','volume','device'], total_gb: ['total_gb','size_gb','capacity_gb'], used_gb: ['used_gb','usage_gb'] },
    memory: { timestamp: ['timestamp','datetime','date_time','time','data_hora'], total_gb: ['total_gb','ram_total_gb','memory_total_gb'], used_gb: ['used_gb','ram_used_gb','memory_used_gb'] }
  };
  const optional = {
    users: { home_gb: ['home_gb'], projects_gb: ['projects_gb'], updated_at: ['updated_at','timestamp'] },
    quotas: { used_gb: ['used_gb','usage_gb'], grace_expires: ['grace_expires','grace_until','grace_date'], updated_at: ['updated_at','timestamp'] },
    disk: { available_gb: ['available_gb','free_gb'], usage_pct: ['usage_pct','used_pct'], updated_at: ['updated_at','timestamp'] },
    memory: { swap_total_gb: ['swap_total_gb'], swap_used_gb: ['swap_used_gb'] }
  };
  const data = { users: [], quotas: [], disk: [], memory: [] };
  const sources = { users: false, quotas: false, disk: false, memory: false };
  let demo = true;
  let live = false;
  let remoteError = '';
  const $ = id => document.getElementById(id);
  const number = value => {
    if (value === undefined || value === null || String(value).trim() === '') return NaN;
    let s = String(value).trim().replace(/\s/g, '').replace('%', '');
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(',', '.');
    return Number(s);
  };
  const fmt = (n, digits = 0) => Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n) : '—';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key = s => String(s).trim().toLowerCase().replace(/^\ufeff/, '').replace(/[\s-]+/g, '_');

  function parseCsv(text) {
    const source = text.replace(/^\ufeff/, '');
    const firstLine = source.split(/\r?\n/, 1)[0];
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], cell = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
      else if (ch === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && source[i + 1] === '\n') i++;
        row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (quoted) throw Error('Há aspas sem fechamento no CSV.');
    row.push(cell.trim()); if (row.some(v => v !== '')) rows.push(row);
    if (!rows.length) throw Error('O CSV está vazio.');
    const headers = rows.shift().map(key);
    return { headers, rows: rows.map(cells => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']))) };
  }
  function normalize(type, input) {
    // Legacy repquota export: timestamp,user,flags,used_kb,soft_kb,hard_kb,grace.
    if (type==='quotas' && /^\s*\d{4}-\d{2}-\d{2}/.test(input)) {
      const legacy=parseCsv('timestamp,user,flags,used_kb,soft_kb,hard_kb,grace\n'+input).rows;
      return legacy.filter(r=>r.user).map(r=>({username:r.user,used_gb:number(r.used_kb)/1048576,soft_limit_gb:number(r.soft_kb)>0?number(r.soft_kb)/1048576:'',hard_limit_gb:number(r.hard_kb)>0?number(r.hard_kb)/1048576:'',updated_at:r.timestamp,grace_expires:r.grace}));
    }
    const { headers, rows } = parseCsv(input);
    if (headers.includes('used_bytes') || headers.includes('home_used_kb') || headers.includes('size_bytes') || (type === 'memory' && headers.includes('type'))) {
      const bytes = v => number(v) / 1073741824;
      const kb = v => number(v) / 1048576;
      if (type === 'users') return rows.map(r => ({username:r.user, used_gb:headers.includes('used_bytes')?bytes(r.used_bytes):kb(r.home_used_kb), updated_at:r.timestamp}));
      if (type === 'quotas') return rows.map(r => ({username:r.user, used_gb:bytes(r.used_bytes), soft_limit_gb:number(r.soft_bytes)>0?bytes(r.soft_bytes):'', hard_limit_gb:number(r.hard_bytes)>0?bytes(r.hard_bytes):'', updated_at:r.timestamp, grace_expires:r.grace}));
      if (type === 'disk') return rows.map(r => ({filesystem:r.mount||r.filesystem,total_gb:bytes(r.size_bytes),used_gb:bytes(r.used_bytes),available_gb:bytes(r.available_bytes),usage_pct:number(r.use_percent),updated_at:r.timestamp}));
      if (type === 'memory') {
        return rows.filter(r => /^mem:?$/i.test(r.type)).map(r => {
          const sw=rows.find(s => /^swap:?$/i.test(s.type) && s.timestamp===r.timestamp);
          return {timestamp:r.timestamp,total_gb:bytes(r.total),used_gb:bytes(r.used),available_gb:bytes(r.available),swap_total_gb:sw?bytes(sw.total):NaN,swap_used_gb:sw?bytes(sw.used):NaN};
        });
      }
    }
    const mapping = {};
    for (const [name, aliases] of Object.entries({ ...fields[type], ...optional[type] })) {
      const found = aliases.find(a => headers.includes(key(a)));
      if (!found && name in fields[type]) throw Error(`Falta a coluna “${name}” em ${files[type]}. Colunas encontradas: ${headers.join(', ')}.`);
      mapping[name] = found;
    }
    const result = rows.map(row => Object.fromEntries(Object.entries(mapping).map(([name, header]) => [name, header ? row[key(header)] : ''])));
    for (const row of result) {
      for (const name of Object.keys(fields[type])) {
        if (name !== 'username' && name !== 'filesystem' && name !== 'timestamp' && !Number.isFinite(number(row[name]))) throw Error(`Valor inválido em “${name}”: ${row[name] || '(vazio)'}.`);
        if (!String(row[name]).trim()) throw Error(`Há uma linha sem “${name}”.`);
      }
    }
    return result;
  }
  const n = (row, field) => number(row?.[field]);
  function userRows() {
    const names = new Map();
    for (const u of data.users) names.set(u.username.toLowerCase(), { username: u.username, usage: u, quota: null });
    for (const q of data.quotas) {
      const k = q.username.toLowerCase(), found = names.get(k);
      if (!found && !Number.isFinite(n(q, 'hard_limit_gb'))) continue;
      if (found) found.quota = q;
      else names.set(k, { username: q.username, usage: null, quota: q });
    }
    return [...names.values()].map(u => {
      const used = Number.isFinite(n(u.usage, 'used_gb')) ? n(u.usage, 'used_gb') : n(u.quota, 'used_gb');
      const soft = n(u.quota, 'soft_limit_gb'), hard = n(u.quota, 'hard_limit_gb');
      const status = u.quota && !Number.isFinite(hard) ? 'unlimited' : !Number.isFinite(soft) || !Number.isFinite(hard) || !Number.isFinite(used) ? 'unknown' : used > hard ? 'hard' : used > soft ? 'soft' : 'normal';
      return { ...u, used, soft, hard, status };
    }).sort((a,b) => ({hard:0,soft:1,unknown:2,normal:3,unlimited:4}[a.status] - {hard:0,soft:1,unknown:2,normal:3,unlimited:4}[b.status]) || b.used - a.used || a.username.localeCompare(b.username));
  }
  function latestMemory() { return [...data.memory].sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp))).at(-1); }
  function percent(used, total) { return Number.isFinite(used) && Number.isFinite(total) && total > 0 ? used / total * 100 : NaN; }
  function severity(pct) { return pct >= 95 ? 'critical' : pct >= 85 ? 'warn' : ''; }
  function updateSource() {
    const count = Object.values(sources).filter(Boolean).length;
    $('dataBadge').textContent = live ? 'CSVs · dados reais' : demo ? 'Dados de exemplo' : `CSVs reais · ${count}/4`;
    $('dataBadge').className = `badge ${demo ? 'demo' : 'real'}`;
    $('resetDemo').hidden = demo;
    $('resetDemo').textContent = 'Usar exemplos';
    const dates = [...data.users,...data.quotas,...data.disk].map(r => r.updated_at).concat(data.memory.map(r => r.timestamp)).filter(Boolean).sort();
    const prefix = live ? 'CSVs · ' : demo ? 'Demonstração · ' : 'Dados locais · ';
    const newest = dates.at(-1);
    const age = newest ? Math.floor((Date.now() - new Date(newest.replace(' ', 'T')).getTime()) / 86400000) : NaN;
    $('lastUpdate').textContent = prefix + (newest ? `última coleta: ${newest}${!demo && age >= 2 ? ` · há ${age} dias` : ''}` : 'aguardando arquivos CSV') + (lastFetch ? ` · consulta: ${lastFetch}` : '') + (manual ? ' · atualização automática pausada' : '');
  }
  function render() {
    updateSource();
    const all = userRows(), hard = all.filter(u => u.status === 'hard'), soft = all.filter(u => u.status === 'soft');
    const disks = data.disk.map(d => ({...d, pct: Number.isFinite(n(d,'usage_pct')) ? n(d,'usage_pct') : percent(n(d,'used_gb'),n(d,'total_gb'))}));
    const highest = [...disks].sort((a,b) => b.pct - a.pct)[0];
    const mem = latestMemory(), ramPct = percent(n(mem,'used_gb'),n(mem,'total_gb'));
    $('kpiUsers').textContent = fmt(all.length);
    $('kpiUsersDetail').textContent = `${data.users.length} com uso registrado`;
    $('kpiQuotas').textContent = fmt(hard.length + soft.length);
    $('kpiQuotasDetail').textContent = `${hard.length} acima do rígido · ${soft.length} acima do flexível`;
    $('kpiDisk').textContent = highest ? `${fmt(highest.pct,1)}%` : '—';
    $('kpiDiskDetail').textContent = highest ? highest.filesystem : 'Sem dados de volumes';
    $('kpiRam').textContent = Number.isFinite(ramPct) ? `${fmt(ramPct,1)}%` : '—';
    $('kpiRamDetail').textContent = mem ? `${fmt(n(mem,'used_gb'),1)} de ${fmt(n(mem,'total_gb'),1)} GiB` : 'Sem dados de memória';
    const alerts = [];
    const dates = [...data.users,...data.quotas,...data.disk].map(r => r.updated_at).concat(data.memory.map(r => r.timestamp)).filter(Boolean).sort();
    const age = dates.length ? Math.floor((Date.now() - new Date(dates.at(-1).replace(' ', 'T')).getTime()) / 86400000) : NaN;
    if (!demo && age >= 2) alerts.push(`Coleta antiga: ${dates.at(-1)}. Verifique a atualização dos logs`);
    if (!demo && !live && Object.values(sources).some(v => !v)) alerts.push(`Faltam ${Object.values(sources).filter(v => !v).length} CSV(s) para completar o painel`);
    if (hard.length) alerts.push(`${hard.length} usuário${hard.length > 1 ? 's' : ''} acima do limite rígido`);
    if (soft.length) alerts.push(`${soft.length} acima do limite flexível`);
    for (const d of disks.filter(d => d.pct >= 85)) alerts.push(`${d.filesystem}: ${fmt(d.pct,1)}% ocupado`);
    if (ramPct >= 85) alerts.push(`RAM: ${fmt(ramPct,1)}% em uso`);
    const swapPct = percent(n(mem,'swap_used_gb'),n(mem,'swap_total_gb'));
    if (swapPct >= 70) alerts.push(`Swap: ${fmt(swapPct,1)}% em uso`);
    $('alerts').replaceChildren(...(alerts.length ? alerts : ['Nenhuma situação acima dos limites definidos.']).map(s => { const el = document.createElement('span'); el.textContent = s; return el; }));
    renderUsers(all); renderDisk(disks); renderMemory();
  }
  function renderUsers(all) {
    const q = $('userSearch').value.trim().toLocaleLowerCase('pt-BR'), filter = $('statusFilter').value;
    const selected = all.filter(u => u.username.toLocaleLowerCase('pt-BR').includes(q) && (filter === 'all' || u.status === filter));
    $('resultCount').textContent = `${selected.length} de ${all.length}`;
    $('usersEmpty').hidden = selected.length > 0;
    $('usersBody').innerHTML = selected.map(u => {
      const ratio = percent(u.used,u.hard), fill = Number.isFinite(ratio) ? Math.min(100, Math.max(0,ratio)) : 0;
      const label = { hard:'Acima do rígido', soft:'Acima do flexível', normal:'Dentro do limite', unknown:'Sem dados de quota', unlimited:'Sem limite' }[u.status];
      const caption = Number.isFinite(u.hard) ? `${fmt(u.soft)} / ${fmt(u.hard)} GiB` : '—';
      return `<tr><td>${esc(u.username)}</td><td>${fmt(u.used,1)} GiB</td><td class="quota-cell"><span class="quota-caption">${caption}</span><div class="quota-track" aria-label="${Number.isFinite(ratio) ? fmt(ratio,1)+'% do limite rígido' : 'quota não disponível'}"><div class="quota-fill ${u.status === 'hard' ? 'critical' : u.status === 'soft' ? 'warn' : ''}" style="width:${fill}%"></div></div></td><td><span class="status ${u.status}">${label}</span></td></tr>`;
    }).join('');
  }
  function renderDisk(disks) {
    $('diskList').innerHTML = disks.length ? disks.map(d => {
      const severityClass = severity(d.pct), free = Number.isFinite(n(d,'available_gb')) ? n(d,'available_gb') : n(d,'total_gb') - n(d,'used_gb');
      return `<div class="disk-row"><div class="disk-head"><strong>${esc(d.filesystem)}</strong><span class="${severityClass}">${fmt(d.pct,1)}%</span></div><div class="disk-track" aria-label="${esc(d.filesystem)}: ${fmt(d.pct,1)}% ocupado"><div class="disk-fill ${severityClass}" style="width:${Math.min(100,Math.max(0,d.pct))}%"></div></div><div class="disk-caption">${fmt(n(d,'used_gb'),1)} GiB usados · ${fmt(free,1)} GiB livres de ${fmt(n(d,'total_gb'),1)} GiB</div></div>`;
    }).join('') : '<p class="empty-state">Importe disk_summary.csv para ver os volumes.</p>';
  }
  function renderMemory() {
    const rows = [...data.memory].sort((a,b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const chart = $('memoryChart'), latest = rows.at(-1);
    if (!rows.length) { chart.innerHTML = '<p class="empty-state">Importe memory_summary.csv para ver a série.</p>'; $('memoryLatest').textContent = ''; return; }
    const left=34,right=12,top=12,bottom=28,w=480,h=180,plotW=w-left-right,plotH=h-top-bottom;
    const points = (field,total) => rows.map((r,i) => ({x:left+(rows.length === 1 ? plotW/2 : i*plotW/(rows.length-1)),y:top+plotH*(1-Math.min(100,Math.max(0,percent(n(r,field),n(r,total))||0))/100),pct:percent(n(r,field),n(r,total)),time:r.timestamp}));
    const ram=points('used_gb','total_gb'), swap=points('swap_used_gb','swap_total_gb');
    const poly = p => p.map((v,i) => `${i ? 'L':'M'}${v.x.toFixed(1)},${v.y.toFixed(1)}`).join(' ');
    const area = `${poly(ram)} L${ram.at(-1).x.toFixed(1)},${top+plotH} L${ram[0].x.toFixed(1)},${top+plotH} Z`;
    const xlabels = [...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])].map(i => `<text x="${ram[i].x}" y="175" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}" class="axis">${esc(String(rows[i].timestamp).split(' ').at(-1))}</text>`).join('');
    chart.innerHTML = `<svg viewBox="0 0 480 180" role="img" aria-label="Uso de RAM e swap ao longo de ${rows.length} registros. RAM atual ${fmt(ram.at(-1).pct,1)}%; swap atual ${fmt(swap.at(-1).pct,1)}%"><defs><linearGradient id="ramFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#52cbd4" stop-opacity=".28"/><stop offset="1" stop-color="#52cbd4" stop-opacity="0"/></linearGradient></defs>${[0,50,100].map(p=>`<line class="grid" x1="${left}" x2="${w-right}" y1="${top+plotH*(1-p/100)}" y2="${top+plotH*(1-p/100)}"/><text class="axis" x="0" y="${top+plotH*(1-p/100)+4}">${p}%</text>`).join('')}<path class="area" d="${area}"/><path class="ram-line" d="${poly(ram)}"/><path class="swap-line" d="${poly(swap)}"/><circle cx="${ram.at(-1).x}" cy="${ram.at(-1).y}" r="5"/>${xlabels}</svg>`;
    $('memoryLatest').innerHTML = `<span>RAM <strong>${fmt(n(latest,'used_gb'),1)} / ${fmt(n(latest,'total_gb'),1)} GiB</strong></span><span>Swap <strong>${fmt(n(latest,'swap_used_gb'),1)} / ${fmt(n(latest,'swap_total_gb'),1)} GiB</strong></span>`;
  }
  function toggleImport(show) { $('importPanel').hidden = !show; $('importToggle').setAttribute('aria-expanded', String(show)); if (show) $('importPanel').scrollIntoView({block:'nearest'}); }
  async function loadDemo() {
    manual = true;
    try {
      const entries = await Promise.all(Object.entries(files).map(async ([type,file]) => {
        const response = await fetch(`${config.examplesUrl}${file}`, {cache:'no-store'}); if (!response.ok) throw Error(`Não foi possível carregar ${file}.`);
        return [type, normalize(type, await response.text())];
      }));
      for (const [type,rows] of entries) { data[type]=rows; sources[type]=false; }
      demo = true; live = false; $('errorBanner').hidden = true; $('importStatus').textContent = 'Aceita CSV com vírgulas ou ponto e vírgula; números decimais com ponto ou vírgula.';
      for (const type of Object.keys(files)) $(`file${type[0].toUpperCase()+type.slice(1)}`).value = '';
      render();
    } catch (e) { $('errorBanner').textContent = e.message; $('errorBanner').hidden = false; }
  }
  async function importFile(type, file) {
    if (!file) return;
    manual = true;
    try {
      const rows = normalize(type, await file.text());
      if (demo || live) { for (const name of Object.keys(files)) { data[name]=[]; sources[name]=false; } demo=false; live=false; }
      data[type]=rows; sources[type]=true;
      $('errorBanner').hidden=true;
      $('importStatus').textContent = `${file.name}: ${rows.length} registro(s) importado(s). Faltam ${4-Object.values(sources).filter(Boolean).length} CSV(s).`;
      render();
    } catch (e) {
      $('errorBanner').textContent = `${file.name}: ${e.message}`; $('errorBanner').hidden=false; $('importStatus').textContent='O arquivo anterior foi mantido. Corrija o CSV e selecione-o novamente.';
      $(`file${type[0].toUpperCase()+type.slice(1)}`).value='';
    }
  }
  async function loadRemote() {
    if (busy) return;
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const base = config.source === 'examples' ? config.examplesUrl : config.dataUrl;
      const entries = await Promise.all(Object.entries(files).map(async ([type,file]) => {
        const response = await fetch(`${base}${file}`, {cache:'no-store',signal:controller.signal});
        if (!response.ok) throw Error(`${file}: HTTP ${response.status}`);
        const rows = normalize(type, await response.text());
        const numericFields={users:['used_gb'],quotas:['used_gb'],disk:['total_gb','used_gb'],memory:['total_gb','used_gb']}[type];
        if (rows.some(r=>numericFields.some(f=>!Number.isFinite(number(r[f]))||number(r[f])<0))) throw Error(`${file}: valor numérico ausente ou inválido`);
        if ((type==='disk'||type==='memory') && !rows.length) throw Error(`${file}: sem registros`);
        if (rows.some(r => (type==='users'||type==='quotas') && !r.username)) throw Error(`${file}: usuário ausente`);
        return [type, rows];
      }));
      const next = Object.fromEntries(entries);
      // Retain recent samples in this tab when the source contains only a snapshot.
      if (next.memory.length===1 && !manual && live) {
        const history = new Map(data.memory.map(r => [r.timestamp,r]));
        next.memory.forEach(r => history.set(r.timestamp,r));
        next.memory = [...history.values()].sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp))).slice(-config.historyLimit);
      }
      for (const type of Object.keys(files)) {data[type]=next[type]; sources[type]=config.source!=='examples';}
      demo=config.source==='examples'; live=!demo; manual=false; remoteError='';
      lastFetch=new Date().toLocaleTimeString('pt-BR');
      $('errorBanner').hidden=true; render();
    } catch (e) {
      remoteError=e.name==='AbortError'?'Tempo de consulta excedido':e.message;
      $('errorBanner').textContent=`Falha na atualização: ${remoteError}. Os últimos dados válidos foram mantidos.`;
      $('errorBanner').hidden=false;
    } finally {clearTimeout(timeout);busy=false;}
  }
  async function poll() {
    if (!manual && !document.hidden) await loadRemote();
    setTimeout(poll, Math.max(5000, Number(config.refreshMs)||60000));
  }
  document.addEventListener('visibilitychange', () => {if (!document.hidden && !manual) loadRemote();});
  $('importToggle').addEventListener('click', () => toggleImport($('importPanel').hidden));
  $('importClose').addEventListener('click', () => toggleImport(false));
  $('resetDemo').addEventListener('click', loadDemo);
  $('refreshRemote').addEventListener('click', loadRemote);
  $('userSearch').addEventListener('input', () => renderUsers(userRows()));
  $('statusFilter').addEventListener('change', () => renderUsers(userRows()));
  for (const type of Object.keys(files)) $(`file${type[0].toUpperCase()+type.slice(1)}`).addEventListener('change', e => importFile(type,e.target.files[0]));
  window.Server1Dashboard = { parseCsv, normalize, userRows, data, sources, render, importFile, loadDemo, loadRemote };
  poll();
})();
