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
  
  const avatar = document.getElementById('avatar');
  const savedPhoto = localStorage.getItem('profilePhoto_' + state.session.id);
  if (savedPhoto) {
    avatar.innerHTML = `<img src="${savedPhoto}" style="width:100%;height:100%;object-fit:cover;display:block;" />`;
  } else {
    avatar.innerHTML = '';
    avatar.textContent = name[0]?.toUpperCase() || 'A';
  }

  if (!['admin', 'owner'].includes(state.session.role)) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }
  if (state.session.role !== 'admin') {
    document.querySelectorAll('.super-admin-only').forEach(el => el.classList.add('hidden'));
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
  if (page === 'membros') renderMembros();
  if (page === 'metricas') renderMetrics();
  if (page === 'fluxos') renderFluxos();
  if (page === 'configuracoes') renderSettings();
  if (page === 'solicitacoes') renderRequests();
}

function renderDashboard() {
  const root = document.getElementById('page-dashboard');
  const summary = state.overview?.summary || {};
  const chart = state.overview?.chart || [];
  const recent = state.overview?.recentContacts || [];
  const warnings = state.overview?.warnings || {};
  const agents = state.overview?.chatwootAgents || [];

  const companyOptions = state.companies.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') || '<option value="">Nenhuma empresa</option>';
  const inboxOptions = agents.map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('') || '<option value="">Nenhum usuário (Chatwoot vazio)</option>';

  root.innerHTML = `
    <div class="grid-2-even" style="margin-bottom:16px;">
      <div class="card glass">
        <h3 class="section-title" style="margin-bottom:12px;">Selecionar Empresa</h3>
        <select id="select-active-company" class="sidebar-search" style="margin-bottom:0;">
          ${companyOptions}
        </select>
      </div>
      <div class="card glass">
        <h3 class="section-title" style="margin-bottom:12px;">Selecionar Inbox / Usuário</h3>
        <select id="select-active-inbox" class="sidebar-search" style="margin-bottom:0;">
          ${inboxOptions}
        </select>
      </div>
    </div>

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
        <div class="notice" style="margin-top:10px">Escalados identificados por tags: <strong>${state.overview?.escalated?.length || 0}</strong></div>
      </div>
    </div>

    <div class="card glass">
      <div class="pill">Ação rápida</div>
      <h3 class="section-title">Contatos recentes</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Nome</th><th>Número</th><th>Resumo</th><th>Tags</th><th>Detalhe</th></tr></thead>
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
      ${['admin', 'owner'].includes(state.session.role) ? `
        <form id="company-form" class="form-grid" style="margin-top:16px">
          <input id="company-name" placeholder="Nome da empresa" required />
          <input id="company-owner" placeholder="Responsável" required />
          <input id="company-phone" placeholder="Telefone" required />
          <button class="primary-btn" type="submit" style="grid-column: span 3;">Cadastrar empresa</button>
        </form>
      ` : ''}
      <div class="table-wrap" style="margin-top:18px">
        <table class="table"><thead><tr><th>Empresa</th><th>Responsável</th><th>Telefone</th>${['admin', 'owner'].includes(state.session.role) ? '<th>Ação</th>' : ''}</tr></thead><tbody>
        ${state.companies.map(c => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.owner)}</td><td>${escapeHtml(c.phone)}</td>${['admin', 'owner'].includes(state.session.role) ? `<td><button class="danger-btn" data-delete-company="${c.id}">Excluir</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="4">Nenhuma empresa cadastrada.</td></tr>'}
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

function renderMembros() {
  const root = document.getElementById('page-membros');
  const team = state.users.filter(u => ['owner', 'gestor_chefe', 'gestor'].includes(u.role));
  const canManage = ['admin', 'owner'].includes(state.session.role);
  const roleOptions = canManage ? ['owner', 'gestor_chefe', 'gestor'] : [];

  root.innerHTML = `
    <div class="card glass">
      <div class="pill">Equipe</div>
      <h3 class="section-title">Gestão de membros</h3>
      <p class="section-sub">Nível de acesso hierárquico à plataforma.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th>${canManage ? '<th>Alterar cargo</th><th>Ação</th>' : ''}</tr></thead><tbody>
        ${team.map(u => `<tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${formatRole(u.role)}</td>
          ${canManage ? `<td>
            <select data-role-user="${u.id}" class="sidebar-search" style="margin:0; padding:6px 10px;">
              ${roleOptions.map(r => `<option value="${r}" ${u.role===r?'selected':''}>${formatRole(r)}</option>`).join('')}
            </select>
            <button class="secondary-btn" data-save-role="${u.id}" style="padding:6px 10px;">Salvar</button>
          </td>
          <td><button class="danger-btn" data-delete-user="${u.id}" style="padding:6px 10px;">Excluir</button></td>` : ''}
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
      <div class="pill">Métricas</div>
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
      <div class="pill">Sua Conta</div>
      
      <h3 class="section-title">Foto do perfil</h3>
      <p class="section-sub">Escolha uma foto de perfil, que aparecerá no menu principal e no canto superior direito.</p>
      <input type="file" id="profile-upload" accept="image/*" class="sidebar-search" style="cursor:pointer;" />
      
      <h3 class="section-title" style="margin-top:24px;">Trocar senha</h3>
      <form id="password-form" class="form-grid" style="margin-top:16px">
        <input id="current-password" type="password" placeholder="Senha atual" required />
        <input id="new-password" type="password" placeholder="Nova senha" required />
        <button class="primary-btn" type="submit">Salvar nova senha</button>
      </form>
      <div id="password-message" class="message"></div>
    </div>
  `;
  
  root.querySelector('#password-form').addEventListener('submit', changePassword);
  
  root.querySelector('#profile-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const img = new Image();
    const reader = new FileReader();
    reader.onload = ev => { img.src = ev.target.result; };
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 250;
      let w = img.width;
      let h = img.height;
      if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } }
      else { if (h > MAX) { w *= MAX / h; h = MAX; } }
      canvas.width = w; canvas.height = h;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      
      try {
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        localStorage.setItem('profilePhoto_' + state.session.id, compressed);
        renderUserInfo();
      } catch (err) {
        alert('Erro ao salvar a foto. Seu navegador pode estar bloqueando ou limitando acesso. Tente novamente!');
      }
    };
    reader.readAsDataURL(file);
  });
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
            <select data-role-select="${r.id}" class="sidebar-search" style="margin:0; padding:6px 10px;">
              <option value="owner" ${r.role==='owner'?'selected':''}>Dono</option>
              <option value="gestor_chefe" ${r.role==='gestor_chefe'?'selected':''}>Gestor-chefe</option>
              <option value="gestor" ${r.role==='gestor'?'selected':''}>Gestor</option>
            </select>
          </td>
          <td>
            <button class="primary-btn" data-approve="${r.id}" style="padding:6px 10px;">Aprovar</button>
            <button class="danger-btn" data-reject="${r.id}" style="padding:6px 10px;">Recusar</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4">Nenhuma solicitação pendente.</td></tr>'}
      </tbody></table></div>
    </div>`;
  root.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', approveRequest));
  root.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', rejectRequest));
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
  renderPage(state.currentPage);
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
    <div class="notice" style="margin-top:10px">Tags: ${Array.isArray(item.labels) && item.labels.length ? item.labels.map(escapeHtml).join(', ') : 'Nenhuma tag'}</div>
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
  const sound = document.getElementById("plimSound");
  if (sound) {
    sound.volume = 1.0;
    sound.play().catch(e => console.log('Audio error autoplay:', e));
  }
}

// Permitir tocar no primeiro click na tela (libera a politica do browser)
document.body.addEventListener('click', () => {
    const sound = document.getElementById("plimSound");
    if(sound && sound.paused && sound.currentTime === 0) {
        sound.volume = 0; // Toca mudo 1x rápido pra liberar o bloqueio do navegador
        sound.play().then(() => { sound.pause(); sound.currentTime = 0; sound.volume = 1; }).catch(()=>{});
    }
}, { once: true });

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

async function loadN8nDashboard() {
  const res = await fetch('/api/n8n/dashboard');
  if (res.ok) state.n8nDashboard = await res.json();
}

async function renderFluxos() {
  const root = document.getElementById('page-fluxos');
  if (state.session.role !== 'admin') {
    root.innerHTML = `<div class="card glass"><h3 class="section-title">Acesso restrito</h3><p>Apenas o Administrador pode visualizar e gerenciar Fluxos.</p></div>`;
    return;
  }
  
  root.innerHTML = `<div class="pill">Carregando Fluxos e Erros...</div>`;
  await loadN8nDashboard();
  
  const d = state.n8nDashboard || {};
  if (d.error) {
     root.innerHTML = `<div class="card glass">Erro ao conectar com n8n: ${d.error}</div>`;
     return;
  }

  root.innerHTML = `
    <div class="cards" style="margin-bottom:16px;">
      ${metricCard('Total de Fluxos', d.totalWorkflows || 0, 'fluxos', false)}
      ${metricCard('Ativos (Publicados)', d.activeCount || 0, 'fluxos', false)}
      ${metricCard('Inativos (Off)', d.inactiveCount || 0, 'fluxos', false)}
      ${metricCard('Falhas recentes', (d.errors || []).length, 'fluxos', false)}
    </div>

    <div class="card glass" style="margin-bottom: 16px;">
      <div class="pill">Fluxos de Automação</div>
      <h3 class="section-title">Todos os Fluxos do n8n</h3>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Nome do Fluxo</th><th>Status atual</th><th>Ação</th></tr></thead>
          <tbody>
            ${(d.workflows || []).map(w => `
              <tr>
                <td><strong>${escapeHtml(w.name)}</strong></td>
                <td>
                   <span class="badge ${w.active ? 'badge-green' : 'badge-orange'}">${w.active ? 'Ativado' : 'Desativado'}</span>
                </td>
                <td>
                  <button class="${w.active ? 'danger-btn' : 'primary-btn'}" data-toggle-workflow="${w.id}" data-action-state="${!w.active}" style="padding:4px 10px;">
                    ${w.active ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card glass">
      <div class="pill">Controle de Erros</div>
      <h3 class="section-title">Workflows com erro de execução</h3>
      <p class="section-sub">Registros originais e reais de falhas enviadas diretamente pelo seu n8n.</p>
      
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Workflow</th><th>Horário</th><th>Mensagem de Erro (n8n)</th><th>Ver no n8n</th></tr></thead>
          <tbody>
            ${(d.errors || []).map(e => `
              <tr>
                <td><strong>${escapeHtml(e.workflowName)}</strong></td>
                <td>${new Date(e.startedAt).toLocaleString('pt-BR')}</td>
                <td style="color:#ef4444">${escapeHtml(e.suggestion)}</td>
                <td><a href="${escapeHtml(e.url)}" target="_blank" class="secondary-btn" style="text-decoration:none; padding:6px 10px; display:inline-block;">Abrir n8n</a></td>
              </tr>
            `).join('') || '<tr><td colspan="4">Nenhum erro encontrado ultimamente. Excelente estabilidade!</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  root.querySelectorAll('[data-toggle-workflow]').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = e.target.dataset.toggleWorkflow;
    const active = e.target.dataset.actionState === 'true';
    e.target.textContent = 'Processando...';
    await fetch(`/api/n8n/workflows/${id}/toggle`, {
       method: 'POST', 
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ active })
    });
    renderFluxos();
  }));
}

bootstrapApp();
