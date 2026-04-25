const state = {
  session: null,
  overview: null,
  companies: [],
  users: [],
  requests: [],
  currentPage: 'dashboard',
  seenEscalatedIds: new Set(),
};

const authScreen = document.getElementById('auth-screen');
const appRoot = document.getElementById('app');
const authMessage = document.getElementById('auth-message');
const modal = createModal();

document.body.appendChild(modal.backdrop);

document.querySelectorAll('[data-auth-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('login-form').classList.toggle('hidden', btn.dataset.authTab !== 'login');
    document.getElementById('register-form').classList.toggle('hidden', btn.dataset.authTab !== 'register');
    authMessage.textContent = '';
  });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMessage.textContent = 'Entrando...';
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    authMessage.textContent = data.message || 'Falha ao entrar.';
    return;
  }
  await bootstrapApp();
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  authMessage.textContent = 'Enviando solicitação...';
  const body = {
    name: document.getElementById('register-name').value.trim(),
    email: document.getElementById('register-email').value.trim(),
    password: document.getElementById('register-password').value,
    requestedRole: document.getElementById('register-role').value,
  };
  const res = await fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await res.json();
  authMessage.textContent = data.message || (res.ok ? 'Solicitação enviada.' : 'Não foi possível criar a conta.');
  if (res.ok) e.target.reset();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

document.getElementById('nav-search').addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('hidden', !item.textContent.toLowerCase().includes(term));
  });
});

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigate(btn.dataset.page));
});

async function bootstrapApp() {
  const sessionRes = await fetch('/api/session');
  if (!sessionRes.ok) {
    authScreen.classList.remove('hidden');
    appRoot.classList.add('hidden');
    return;
  }
  const sessionData = await sessionRes.json();
  state.session = sessionData.user;
  authScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
  renderUserInfo();
  await Promise.all([loadOverview(), loadCompanies(), loadUsers(), loadRequests()]);
  navigate('dashboard');
  startEscalatedPolling();
}

function renderUserInfo() {
  const name = state.session?.name || 'Usuário';
  const role = state.session?.role || 'sem cargo';
  document.getElementById('welcome-title').textContent = `Sr(a) ${name}, seja bem-vindo(a)`;
  document.getElementById('welcome-subtitle').textContent = `Cargo: ${formatRole(role)}`;
  document.getElementById('sidebar-user-name').textContent = name;
  document.getElementById('sidebar-user-role').textContent = formatRole(role);
  document.getElementById('avatar').textContent = name[0]?.toUpperCase() || 'A';
  if (!['admin', 'owner'].includes(state.session.role)) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }
}

function navigate(page) {
  state.currentPage = page;
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  document.querySelectorAll('.page').forEach(sec => sec.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  renderPage(page);
}

async function loadOverview() {
  const res = await fetch('/api/integrations/overview');
  state.overview = await res.json();
  (state.overview.escalated || []).forEach(item => state.seenEscalatedIds.add(String(item.id)));
}
async function loadCompanies() { const res = await fetch('/api/companies'); state.companies = (await res.json()).companies || []; }
async function loadUsers() { const res = await fetch('/api/users'); state.users = (await res.json()).users || []; }
async function loadRequests() {
  if (state.session?.role !== 'admin') { state.requests = []; return; }
  const res = await fetch('/api/requests');
  state.requests = res.ok ? ((await res.json()).requests || []) : [];
}

function renderPage(page) {
  if (page === 'dashboard') renderDashboard();
  if (page === 'empresas') renderCompanies();
  if (page === 'escalados') renderEscalados();
  if (page === 'gestores') renderGestores();
  if (page === 'metricas') renderMetrics();
  if (page === 'configuracoes') renderSettings();
  if (page === 'solicitacoes') renderRequests();
}

function renderDashboard() {
  const root = document.getElementById('page-dashboard');
  const summary = state.overview?.summary || {};
  const chart = state.overview?.chart || [];
  const recent = state.overview?.recentContacts || [];
  const warnings = state.overview?.warnings || {};
  root.innerHTML = `
    <div class="cards">
      ${metricCard('Empresas', summary.companies || 0, 'empresas')}
      ${metricCard('Contatos novos hoje', summary.contactsToday || 0, 'metricas')}
      ${metricCard('Escalados', summary.escalatedCount || 0, 'escalados')}
      ${metricCard('Taxa de aprovação', `${summary.approvalRate || 0}%`, 'metricas')}
    </div>

    <div class="grid-2">
      <div class="card glass">
        <div class="pill">Contatos reais</div>
        <h3 class="section-title">Quantidade de contatos novos na sua empresa</h3>
        <p class="section-sub">Dados puxados do Chatwoot e visão operacional do n8n.</p>
        <div class="chart">
          ${chart.map(item => `
            <div class="bar-wrap">
              <div class="bar-value">${item.value}</div>
              <div class="bar" style="height:${Math.max(18, item.value * 24)}px"></div>
              <div class="bar-label">${item.label}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card glass">
        <div class="pill">Conexões</div>
        <h3 class="section-title">Status das integrações</h3>
        <p class="section-sub">Tudo importante em um só lugar.</p>
        <div class="notice">Chatwoot: ${warnings.chatwootError ? warnings.chatwootError : 'Conectado'}</div>
        <div class="notice" style="margin-top:10px">n8n: ${warnings.n8nError ? warnings.n8nError : 'Conectado'}</div>
        <div class="notice" style="margin-top:10px">Escalados identificados por label: <strong>${state.overview?.escalated?.length || 0}</strong></div>
      </div>
    </div>

    <div class="card glass">
      <div class="pill">Ação rápida</div>
      <h3 class="section-title">Contatos recentes</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Nome</th><th>Número</th><th>Resumo</th><th>Labels</th><th>Detalhe</th></tr></thead>
          <tbody>
            ${recent.map(item => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.phone)}</td>
                <td>${escapeHtml(item.summary)}</td>
                <td>${(item.labels || []).map(l => `<span class="badge badge-orange">${escapeHtml(l)}</span>`).join(' ') || '-'}</td>
                <td><span class="detail-link" data-open-detail='${encodeURIComponent(JSON.stringify(item))}'>Ver contato</span></td>
              </tr>
            `).join('') || '<tr><td colspan="5">Nenhum contato encontrado.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  bindDetailLinks(root);
  bindMetricCardLinks(root);
}

function renderCompanies() {
  const root = document.getElementById('page-empresas');
  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Cadastro</div>
      <h3 class="section-title">Empresas</h3>
      <p class="section-sub">Lista simples com exclusão, como você pediu.</p>
      ${state.session.role === 'admin' ? `
        <form id="company-form" class="form-grid" style="margin-top:16px">
          <input id="company-name" placeholder="Nome da empresa" required />
          <input id="company-owner" placeholder="Responsável" required />
          <input id="company-phone" placeholder="Telefone" required />
          <button class="primary-btn" type="submit" style="grid-column: span 3;">Cadastrar empresa</button>
        </form>
      ` : ''}
      <div class="table-wrap" style="margin-top:18px">
        <table class="table"><thead><tr><th>Empresa</th><th>Responsável</th><th>Telefone</th>${state.session.role === 'admin' ? '<th>Ação</th>' : ''}</tr></thead><tbody>
        ${state.companies.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.owner)}</td><td>${escapeHtml(c.phone)}</td>${state.session.role === 'admin' ? `<td><button class="danger-btn" data-delete-company="${c.id}">Excluir</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4">Nenhuma empresa cadastrada.</td></tr>'}
        </tbody></table>
      </div>
    </div>
  `;
  const form = root.querySelector('#company-form');
  if (form) form.addEventListener('submit', submitCompany);
  root.querySelectorAll('[data-delete-company]').forEach(btn => btn.addEventListener('click', deleteCompany));
}

function renderEscalados() {
  const root = document.getElementById('page-escalados');
  const escalated = state.overview?.escalated || [];
  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Chatwoot</div>
      <h3 class="section-title">Escalados para humano</h3>
      <p class="section-sub">Dados puxados direto do Chatwoot com a tag <strong>agent-off</strong>.</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Nome</th><th>Número</th><th>Resumo da conversa</th><th>Detalhes</th></tr></thead>
          <tbody>
            ${escalated.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.phone)}</td><td>${escapeHtml(item.summary)}</td><td><span class="detail-link" data-open-detail='${encodeURIComponent(JSON.stringify(item))}'>Abrir</span></td></tr>`).join('') || '<tr><td colspan="4">Nenhum escalado no momento.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  bindDetailLinks(root);
}

function renderGestores() {
  const root = document.getElementById('page-gestores');
  const team = state.users.filter(u => ['owner', 'gestor_chefe', 'gestor'].includes(u.role));
  const canManage = ['admin', 'owner'].includes(state.session.role);
  const roleOptions = state.session.role === 'admin'
    ? ['owner', 'gestor_chefe', 'gestor']
    : ['owner', 'gestor_chefe', 'gestor'];

  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Equipe</div>
      <h3 class="section-title">Gestão de equipe</h3>
      <p class="section-sub">Defina cargos de dono, gestor-chefe e gestor.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th>${canManage ? '<th>Alterar cargo</th><th>Ação</th>' : ''}</tr></thead><tbody>
        ${team.map(u => `<tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${formatRole(u.role)}</td>
          ${canManage ? `<td>
            <select data-role-user="${u.id}">
              ${roleOptions.map(r => `<option value="${r}" ${u.role===r?'selected':''}>${formatRole(r)}</option>`).join('')}
            </select>
            <button class="secondary-btn" data-save-role="${u.id}">Salvar</button>
          </td>
          <td><button class="danger-btn" data-delete-user="${u.id}">Excluir</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="${canManage ? '5' : '3'}">Nenhum usuário encontrado.</td></tr>`}
      </tbody></table></div>
    </div>`;
  bindDeleteUser(root);
  root.querySelectorAll('[data-save-role]').forEach(btn => btn.addEventListener('click', updateUserRole));
}

function renderMetrics() {
  const root = document.getElementById('page-metricas');
  const summary = state.overview?.summary || {};
  const chart = state.overview?.chart || [];
  root.innerHTML = `
    <div class="cards">
      ${metricCard('Total de contatos', state.overview?.recentContacts?.length || 0, 'metricas', false)}
      ${metricCard('Novos hoje', summary.contactsToday || 0, 'metricas', false)}
      ${metricCard('Escalados', summary.escalatedCount || 0, 'escalados', true)}
      ${metricCard('Aprovação', `${summary.approvalRate || 0}%`, 'metricas', false)}
    </div>
    <div class="card glass">
      <div class="pill">Métricas reais</div>
      <h3 class="section-title">Volume de contatos por dia</h3>
      <div class="chart">
        ${chart.map(item => `
          <div class="bar-wrap">
            <div class="bar-value">${item.value}</div>
            <div class="bar" style="height:${Math.max(18, item.value * 24)}px"></div>
            <div class="bar-label">${item.label}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  bindMetricCardLinks(root);
}

function renderSettings() {
  const root = document.getElementById('page-configuracoes');
  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Conta</div>
      <h3 class="section-title">Trocar senha</h3>
      <form id="password-form" class="form-grid" style="margin-top:16px">
        <input id="current-password" type="password" placeholder="Senha atual" required />
        <input id="new-password" type="password" placeholder="Nova senha" required />
        <button class="primary-btn" type="submit">Salvar nova senha</button>
      </form>
      <div id="password-message" class="message"></div>
    </div>
  `;
  root.querySelector('#password-form').addEventListener('submit', changePassword);
}

function renderRequests() {
  const root = document.getElementById('page-solicitacoes');
  if (!['admin','owner'].includes(state.session.role)) {
    root.innerHTML = `<div class="card glass"><h3 class="section-title">Acesso negado</h3></div>`;
    return;
  }
  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Aprovação</div>
      <h3 class="section-title">Solicitações pendentes</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Cargo solicitado</th><th>Ações</th></tr></thead><tbody>
      ${state.requests.map(r => `
        <tr>
          <td>${escapeHtml(r.name)}</td>
          <td>${escapeHtml(r.email)}</td>
          <td>
            <select data-role-select="${r.id}">
              <option value="owner" ${r.role==='owner'?'selected':''}>Dono</option>
              <option value="gestor_chefe" ${r.role==='gestor_chefe'?'selected':''}>Gestor-chefe</option>
              <option value="gestor" ${r.role==='gestor'?'selected':''}>Gestor</option>
            </select>
          </td>
          <td>
            <button class="primary-btn" data-approve="${r.id}">Aprovar</button>
            <button class="danger-btn" data-reject="${r.id}">Recusar</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4">Nenhuma solicitação pendente.</td></tr>'}
      </tbody></table></div>
    </div>`;
  root.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', approveRequest));
  root.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', rejectRequest));
}

function userTableSection(title, subtitle, users) {
  return `
    <div class="card glass">
      <div class="pill">Equipe</div>
      <h3 class="section-title">${title}</h3>
      <p class="section-sub">${subtitle}</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th>${state.session.role === 'admin' ? '<th>Ação</th>' : ''}</tr></thead><tbody>
        ${users.map(u => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${formatRole(u.role)}</td>${state.session.role === 'admin' ? `<td><button class="danger-btn" data-delete-user="${u.id}">Excluir</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4">Nenhum usuário encontrado.</td></tr>'}
      </tbody></table></div>
    </div>`;
}

function metricCard(title, value, page, interactive = true) {
  return `<div class="card glass metric-card ${interactive ? 'detail-link' : ''}" ${interactive ? `data-go-page="${page}"` : ''}><div class="metric-title">${title}</div><div class="metric-value">${value}</div></div>`;
}

function bindMetricCardLinks(root) { root.querySelectorAll('[data-go-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.goPage))); }
function bindDetailLinks(root) {
  root.querySelectorAll('[data-open-detail]').forEach(el => el.addEventListener('click', () => {
    const item = JSON.parse(decodeURIComponent(el.dataset.openDetail));
    openDetailModal(item);
  }));
}
function bindDeleteUser(root) { root.querySelectorAll('[data-delete-user]').forEach(btn => btn.addEventListener('click', deleteUser)); }

async function submitCompany(e) {
  e.preventDefault();
  const body = {
    name: document.getElementById('company-name').value.trim(),
    owner: document.getElementById('company-owner').value.trim(),
    phone: document.getElementById('company-phone').value.trim(),
  };
  const res = await fetch('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return alert('Não foi possível cadastrar a empresa.');
  await loadCompanies();
  renderCompanies();
  e.target.reset();
}

async function deleteCompany(e) {
  const id = e.target.dataset.deleteCompany;
  if (!confirm('Excluir esta empresa?')) return;
  await fetch(`/api/companies/${id}`, { method: 'DELETE' });
  await loadCompanies();
  renderCompanies();
  await loadOverview();
  renderDashboard();
}

async function deleteUser(e) {
  const id = e.target.dataset.deleteUser;
  if (!confirm('Excluir este usuário?')) return;
  const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return alert(data.message || 'Não foi possível excluir.');
  await loadUsers();
  renderPage(state.currentPage);
}


async function updateUserRole(e) {
  const userId = Number(e.target.dataset.saveRole);
  const role = document.querySelector(`[data-role-user="${userId}"]`).value;
  const res = await fetch('/api/users/update-role', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message || 'Não foi possível atualizar o cargo.');
  await loadUsers();
  renderGestores();
}

async function changePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const res = await fetch('/api/change-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword, newPassword })
  });
  const data = await res.json();
  document.getElementById('password-message').textContent = data.message || (res.ok ? 'Senha alterada com sucesso.' : 'Falha ao trocar a senha.');
  if (res.ok) e.target.reset();
}

async function approveRequest(e) {
  const userId = Number(e.target.dataset.approve);
  const role = document.querySelector(`[data-role-select="${userId}"]`).value;
  await fetch('/api/requests/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }) });
  await loadRequests();
  await loadUsers();
  renderRequests();
}

async function rejectRequest(e) {
  const userId = Number(e.target.dataset.reject);
  await fetch('/api/requests/reject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
  await loadRequests();
  renderRequests();
}

function openDetailModal(item) {
  modal.content.innerHTML = `
    <div class="pill">Detalhes</div>
    <h3 class="section-title" style="margin-top:12px">${escapeHtml(item.name || 'Contato')}</h3>
    <div class="notice">Número: ${escapeHtml(item.phone || 'Sem número')}</div>
    <div class="notice" style="margin-top:10px">Resumo: ${escapeHtml(item.summary || 'Sem resumo')}</div>
    <div class="notice" style="margin-top:10px">Labels: ${Array.isArray(item.labels) && item.labels.length ? item.labels.map(escapeHtml).join(', ') : 'Sem labels'}</div>
    <div class="notice" style="margin-top:10px">Conversation ID: ${item.conversationId || 'N/A'}</div>
  `;
  modal.backdrop.classList.add('show');
}

function createModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal glass"><div id="modal-content"></div><div class="modal-actions"><button id="close-modal" class="secondary-btn">Fechar</button></div></div>`;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.classList.remove('show'); });
  backdrop.querySelector('#close-modal').addEventListener('click', () => backdrop.classList.remove('show'));
  return { backdrop, content: backdrop.querySelector('#modal-content') };
}

function formatRole(role) {
  const map = { admin: 'Admin', owner: 'Dono', gestor_chefe: 'Gestor-chefe', gestor: 'Gestor' };
  return map[role] || role;
}
function escapeHtml(str) { return String(str ?? '').replace(/[&<>"]/g, s => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[s])); }

function playPlim() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.value = 0.0001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
  osc.stop(ctx.currentTime + 0.5);
}

async function startEscalatedPolling() {
  setInterval(async () => {
    const res = await fetch('/api/escalated');
    if (!res.ok) return;
    const data = await res.json();
    let hasNew = false;
    (data.escalated || []).forEach(item => {
      const id = String(item.id);
      if (!state.seenEscalatedIds.has(id)) {
        state.seenEscalatedIds.add(id);
        hasNew = true;
      }
    });
    state.overview = { ...(state.overview || {}), escalated: data.escalated || [] };
    if (hasNew) playPlim();
    if (state.currentPage === 'escalados') renderEscalados();
    if (state.currentPage === 'dashboard') {
      await loadOverview();
      renderDashboard();
    }
  }, 10000);
}

bootstrapApp();


// =======================
// ALTERAÇÕES FRONTEND
// =======================

// 1 - Selecionar Empresa
async function loadCompanies(){
  const res = await fetch('/api/companies');
  const data = await res.json();
  console.log("Empresas disponíveis:", data);
}
loadCompanies();

// 3 - Som plim
function playPlim(){
  const audio = new Audio("https://www.soundjay.com/buttons/sounds/button-3.mp3");
  audio.play();
}

// 4 - Foto de perfil
function setProfilePhoto(url){
  const img = document.createElement("img");
  img.src = url;
  img.style.width = "40px";
  img.style.height = "40px";
  img.style.borderRadius = "50%";
  img.style.position = "fixed";
  img.style.top = "10px";
  img.style.right = "20px";
  document.body.appendChild(img);
}

// 6 - Labels -> Tags
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Labels") el.innerText = "Tags";
});

// 8 - Métricas reais -> Métricas
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Métricas reais") el.innerText = "Métricas";
});

// 11 - Gestores -> Membros
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Gestores") el.innerText = "Membros";
});



// =======================
// ALTERAÇÕES FRONTEND
// =======================

// 1 - Selecionar Empresa
async function loadCompanies(){
  const res = await fetch('/api/companies');
  const data = await res.json();
  console.log("Empresas disponíveis:", data);
}
loadCompanies();

// 3 - Som plim
function playPlim(){
  const audio = new Audio("https://www.soundjay.com/buttons/sounds/button-3.mp3");
  audio.play();
}

// 4 - Foto de perfil
function setProfilePhoto(url){
  const img = document.createElement("img");
  img.src = url;
  img.style.width = "40px";
  img.style.height = "40px";
  img.style.borderRadius = "50%";
  img.style.position = "fixed";
  img.style.top = "10px";
  img.style.right = "20px";
  document.body.appendChild(img);
}

// 6 - Labels -> Tags
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Labels") el.innerText = "Tags";
});

// 8 - Métricas reais -> Métricas
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Métricas reais") el.innerText = "Métricas";
});

// 11 - Gestores -> Membros
document.querySelectorAll("*").forEach(el => {
  if (el.innerText === "Gestores") el.innerText = "Membros";
});
