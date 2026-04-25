import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(rootDir, 'data');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

const sessions = new Map();
const PORT = Number(process.env.PORT || 3000);
const allowedAdminEmail = '';
const agentOffLabel = (process.env.CHATWOOT_AGENT_OFF_LABEL || 'agente-off').toLowerCase();

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(cookieHeader.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const idx = v.indexOf('=');
    return [decodeURIComponent(v.slice(0, idx)), decodeURIComponent(v.slice(idx + 1))];
  }));
}

function auth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.automacaoone_session;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ message: 'Não autenticado.' });
  }
  req.user = sessions.get(token);
  next();
}

function requireManager(req, res, next) {
  if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
    return res.status(403).json({ message: 'Acesso negado.' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Apenas administradores originais têm acesso.' });
  }
  next();
}

async function readJson(name, fallback = []) {
  const full = path.join(dataDir, name);
  try {
    const raw = await fs.readFile(full, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(name, data) {
  const full = path.join(dataDir, name);
  await fs.writeFile(full, JSON.stringify(data, null, 2), 'utf8');
}

function safeChatwootPayload(raw) {
  return raw?.data?.payload || raw?.payload || raw?.data || [];
}

function summarizeConversation(conv) {
  const parts = [
    conv?.last_non_activity_message?.content,
    conv?.meta?.sender?.additional_attributes?.description,
    conv?.messages?.[0]?.content,
    conv?.last_activity_at ? `Última atividade: ${new Date(conv.last_activity_at * 1000).toLocaleString('pt-BR')}` : '',
  ].filter(Boolean);
  return (parts[0] || 'Sem resumo disponível').toString().slice(0, 140);
}

let cacheChatwoot = { data: null, timestamp: 0 };

async function fetchChatwootConversations() {
  if (!process.env.CHATWOOT_URL || !process.env.CHATWOOT_API_TOKEN || !process.env.CHATWOOT_ACCOUNT_ID) {
    return { conversations: [], error: 'Chatwoot não configurado no .env' };
  }

  const now = Date.now();
  if (now - cacheChatwoot.timestamp < 10000 && cacheChatwoot.data) {
    return cacheChatwoot.data;
  }

  const url = `${process.env.CHATWOOT_URL.replace(/\/$/, '')}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/conversations`;
  try {
    const res = await fetch(url, {
      headers: { api_access_token: process.env.CHATWOOT_API_TOKEN },
    });
    if (!res.ok) {
      return { conversations: [], error: `Chatwoot respondeu ${res.status}` };
    }
    const json = await res.json();
    const payload = safeChatwootPayload(json);
    cacheChatwoot = {
      data: { conversations: Array.isArray(payload) ? payload : [], error: null },
      timestamp: now
    };
    return cacheChatwoot.data;
  } catch (error) {
    return { conversations: [], error: `Falha no Chatwoot: ${error.message}` };
  }
}

let cacheAgents = { data: null, timestamp: 0 };

async function fetchChatwootAgents() {
  if (!process.env.CHATWOOT_URL || !process.env.CHATWOOT_API_TOKEN || !process.env.CHATWOOT_ACCOUNT_ID) {
    return { agents: [], error: null };
  }

  const now = Date.now();
  if (now - cacheAgents.timestamp < 60000 && cacheAgents.data) {
    return cacheAgents.data;
  }

  const url = `${process.env.CHATWOOT_URL.replace(/\/$/, '')}/api/v1/accounts/${process.env.CHATWOOT_ACCOUNT_ID}/agents`;
  try {
    const res = await fetch(url, {
      headers: { api_access_token: process.env.CHATWOOT_API_TOKEN },
    });
    if (!res.ok) return { agents: [], error: null };
    const json = await res.json();
    const arr = Array.isArray(json) ? json : (json.payload || []);
    cacheAgents = { data: { agents: arr, error: null }, timestamp: now };
    return cacheAgents.data;
  } catch {
    return { agents: [], error: null };
  }
}

let cacheN8n = { data: null, timestamp: 0 };

async function fetchN8nWorkflows() {
  if (!process.env.N8N_URL || !process.env.N8N_API_KEY) {
    return { workflows: [], error: 'n8n não configurado no .env' };
  }
  
  const now = Date.now();
  if (now - cacheN8n.timestamp < 60000 && cacheN8n.data) {
    return cacheN8n.data;
  }

  const url = `${process.env.N8N_URL.replace(/\/$/, '')}/api/v1/workflows`;
  try {
    const res = await fetch(url, {
      headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY },
    });
    if (!res.ok) {
      return { workflows: [], error: `n8n respondeu ${res.status}` };
    }
    const json = await res.json();
    const workflows = json.data || json || [];
    cacheN8n = {
      data: { workflows: Array.isArray(workflows) ? workflows : [], error: null },
      timestamp: now
    };
    return cacheN8n.data;
  } catch (error) {
    return { workflows: [], error: `Falha no n8n: ${error.message}` };
  }
}

let cacheN8nExecs = { data: null, timestamp: 0 };

async function fetchN8nExecutions() {
  if (!process.env.N8N_URL || !process.env.N8N_API_KEY) return { executions: [] };

  const now = Date.now();
  if (now - cacheN8nExecs.timestamp < 30000 && cacheN8nExecs.data) return cacheN8nExecs.data;

  const url = `${process.env.N8N_URL.replace(/\/$/, '')}/api/v1/executions?limit=50`;
  try {
    const res = await fetch(url, { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } });
    if (!res.ok) return { executions: [] };
    const json = await res.json();
    cacheN8nExecs = { data: { executions: Array.isArray(json.data) ? json.data : [] }, timestamp: now };
    return cacheN8nExecs.data;
  } catch (e) {
    return { executions: [] };
  }
}

app.get('/api/session', auth, async (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  const users = await readJson('users.json', []);
  const user = users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  }
  if (user.status !== 'approved') {
    return res.status(403).json({ message: 'Seu acesso ainda não foi aprovado.' });
  }
  const token = crypto.randomUUID();
  sessions.set(token, { id: user.id, name: user.name, email: user.email, role: user.role });
  res.setHeader('Set-Cookie', `automacaoone_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
  res.json({ ok: true });
});

app.post('/api/logout', auth, async (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.automacaoone_session;
  sessions.delete(token);
  res.setHeader('Set-Cookie', 'automacaoone_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  const { name, email, password, requestedRole } = req.body || {};
  if (!name || !email || !password || !requestedRole) {
    return res.status(400).json({ message: 'Preencha todos os campos.' });
  }
  const users = await readJson('users.json', []);
  if (users.some(u => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ message: 'Este e-mail já está cadastrado.' });
  }
  const safeRole = ['owner', 'gestor_chefe', 'gestor'].includes(requestedRole) ? requestedRole : 'gestor';
  const id = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
  users.push({ id, name, email, password, role: safeRole, status: 'pending' });
  await writeJson('users.json', users);
  res.json({ ok: true, message: 'Solicitação enviada para aprovação.' });
});

app.get('/api/requests', auth, requireManager, async (req, res) => {
  const users = await readJson('users.json', []);
  res.json({ requests: users.filter(u => u.status === 'pending') });
});

app.post('/api/requests/approve', auth, requireManager, async (req, res) => {
  const { userId, role } = req.body || {};
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === Number(userId));
  if (idx === -1) return res.status(404).json({ message: 'Usuário não encontrado.' });
  const allowedRoles = req.user.role === 'admin' ? ['owner', 'gestor_chefe', 'gestor'] : ['owner', 'gestor_chefe', 'gestor'];
  if (role && !allowedRoles.includes(role)) return res.status(400).json({ message: 'Cargo inválido.' });
  users[idx].status = 'approved';
  if (role) users[idx].role = role;
  await writeJson('users.json', users);
  res.json({ ok: true });
});

app.post('/api/requests/reject', auth, requireManager, async (req, res) => {
  const { userId } = req.body || {};
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === Number(userId));
  if (idx === -1) return res.status(404).json({ message: 'Usuário não encontrado.' });
  users[idx].status = 'rejected';
  await writeJson('users.json', users);
  res.json({ ok: true });
});

app.get('/api/users', auth, async (req, res) => {
  const users = await readJson('users.json', []);
  res.json({ users: users.filter(u => u.status === 'approved').map(({ password, ...rest }) => rest) });
});

app.post('/api/users/update-role', auth, requireManager, async (req, res) => {
  const { userId, role } = req.body || {};
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === Number(userId));
  if (idx === -1) return res.status(404).json({ message: 'Usuário não encontrado.' });
  const target = users[idx];
  if (target.email === allowedAdminEmail) return res.status(400).json({ message: 'O admin principal não pode ser alterado.' });
  const allowedRoles = req.user.role === 'admin' ? ['owner', 'gestor_chefe', 'gestor'] : ['owner', 'gestor_chefe', 'gestor'];
  if (!allowedRoles.includes(role)) return res.status(400).json({ message: 'Cargo inválido.' });
  target.role = role;
  await writeJson('users.json', users);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  const users = await readJson('users.json', []);
  const target = users.find(u => u.id === id);
  if (!target) return res.status(404).json({ message: 'Usuário não encontrado.' });
  if (target.email === allowedAdminEmail) return res.status(400).json({ message: 'O admin principal não pode ser removido.' });
  await writeJson('users.json', users.filter(u => u.id !== id));
  res.json({ ok: true });
});

app.post('/api/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const users = await readJson('users.json', []);
  const idx = users.findIndex(u => u.id === Number(req.user.id));
  if (idx === -1) return res.status(404).json({ message: 'Usuário não encontrado.' });
  if (users[idx].password !== currentPassword) {
    return res.status(400).json({ message: 'Senha atual incorreta.' });
  }
  users[idx].password = newPassword;
  await writeJson('users.json', users);
  res.json({ ok: true });
});

app.get('/api/companies', auth, async (req, res) => {
  const companies = await readJson('companies.json', []);
  res.json({ companies });
});

app.post('/api/companies', auth, requireManager, async (req, res) => {
  const { name, owner, phone } = req.body || {};
  if (!name || !owner || !phone) return res.status(400).json({ message: 'Dados incompletos.' });
  const companies = await readJson('companies.json', []);
  const id = companies.length ? Math.max(...companies.map(c => c.id)) + 1 : 1;
  companies.push({ id, name, owner, phone });
  await writeJson('companies.json', companies);
  res.json({ ok: true });
});

app.delete('/api/companies/:id', auth, requireManager, async (req, res) => {
  const id = Number(req.params.id);
  const companies = await readJson('companies.json', []);
  await writeJson('companies.json', companies.filter(c => c.id !== id));
  res.json({ ok: true });
});

app.get('/api/integrations/overview', auth, async (req, res) => {
  const [{ conversations, error: chatwootError }, { workflows, error: n8nError }, { agents }] = await Promise.all([
    fetchChatwootConversations(),
    fetchN8nWorkflows(),
    fetchChatwootAgents(),
  ]);

  const escalated = conversations.filter(conv => Array.isArray(conv.labels) && conv.labels.map(v => String(v).toLowerCase()).includes(agentOffLabel));
  const recentConversations = conversations.slice(0, 10);

  const contactsToday = conversations.filter(conv => {
    const ts = conv.last_activity_at || conv.created_at || 0;
    const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  }).length;

  const approvalRate = recentConversations.length
    ? Math.round(((recentConversations.length - escalated.length) / recentConversations.length) * 100)
    : 100;

  const graph = Array.from({ length: 7 }).map((_, idx) => {
    const ref = new Date();
    ref.setDate(ref.getDate() - (6 - idx));
    const label = ref.toLocaleDateString('pt-BR', { weekday: 'short' });
    const value = conversations.filter(conv => {
      const ts = conv.last_activity_at || conv.created_at || 0;
      const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
      return date.toDateString() === ref.toDateString();
    }).length;
    return { label, value };
  });

  res.json({
    summary: {
      companies: (await readJson('companies.json', [])).length,
      workflows: workflows.length,
      contactsToday,
      escalatedCount: escalated.length,
      approvalRate,
    },
    chatwootAgents: agents.map(a => ({ id: a.id, name: a.available_name || a.name || 'Agente' })),
    chart: graph,
    escalated: escalated.map((conv, i) => ({
      id: conv.id || i,
      name: conv.meta?.sender?.name || conv.contact_inbox?.contact?.name || 'Sem nome',
      phone: conv.meta?.sender?.phone_number || conv.contact_inbox?.contact?.phone_number || 'Sem número',
      summary: summarizeConversation(conv),
      labels: conv.labels || [],
      conversationId: conv.id || null,
    })),
    recentContacts: recentConversations.map((conv, i) => ({
      id: conv.id || i,
      name: conv.meta?.sender?.name || conv.contact_inbox?.contact?.name || 'Sem nome',
      phone: conv.meta?.sender?.phone_number || conv.contact_inbox?.contact?.phone_number || 'Sem número',
      summary: summarizeConversation(conv),
      labels: conv.labels || [],
      conversationId: conv.id || null,
    })),
    warnings: { chatwootError, n8nError },
  });
});

app.get('/api/escalated', auth, async (req, res) => {
  const { conversations, error } = await fetchChatwootConversations();
  const escalated = conversations.filter(conv => Array.isArray(conv.labels) && conv.labels.map(v => String(v).toLowerCase()).includes(agentOffLabel));
  res.json({
    error,
    escalated: escalated.map((conv, i) => ({
      id: conv.id || i,
      name: conv.meta?.sender?.name || conv.contact_inbox?.contact?.name || 'Sem nome',
      phone: conv.meta?.sender?.phone_number || conv.contact_inbox?.contact?.phone_number || 'Sem número',
      summary: summarizeConversation(conv),
      labels: conv.labels || [],
      conversationId: conv.id || null,
    }))
  });
});

app.get('/api/metrics', auth, async (req, res) => {
  const { conversations, error } = await fetchChatwootConversations();
  const total = conversations.length;
  const escalated = conversations.filter(conv => Array.isArray(conv.labels) && conv.labels.map(v => String(v).toLowerCase()).includes(agentOffLabel)).length;
  const grouped = Array.from({ length: 7 }).map((_, idx) => {
    const ref = new Date();
    ref.setDate(ref.getDate() - (6 - idx));
    const label = ref.toLocaleDateString('pt-BR', { weekday: 'short' });
    const value = conversations.filter(conv => {
      const ts = conv.last_activity_at || conv.created_at || 0;
      const date = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
      return date.toDateString() === ref.toDateString();
    }).length;
    return { label, value };
  });
  res.json({
    error,
    metrics: {
      totalContacts: total,
      newContactsToday: grouped[grouped.length - 1]?.value || 0,
      escalated,
      approvalRate: total ? Math.round(((total - escalated) / total) * 100) : 100,
      grouped,
    }
  });
});

app.get('/api/n8n/dashboard', auth, requireSuperAdmin, async (req, res) => {
  const { workflows, error: wfError } = await fetchN8nWorkflows();
  if (wfError) return res.status(500).json({ error: wfError });

  const activeCount = workflows.filter(w => w.active).length;
  const inactiveCount = workflows.filter(w => !w.active).length;

  const { executions } = await fetchN8nExecutions();
  const errors = executions.filter(e => e.status === 'error' || e.status === 'crashed');

  const n8nUrl = process.env.N8N_URL.replace(/\/$/, '');

  const formattedErrors = errors.map(e => {
    const workflowInfo = workflows.find(w => w.id === e.workflowId) || { name: 'Desconhecido' };
    
    return {
      execId: e.id,
      workflowId: e.workflowId,
      workflowName: workflowInfo.name,
      startedAt: e.startedAt,
      url: `${n8nUrl}/workflow/${e.workflowId}/executions/${e.id}`,
      suggestion: "Carregando erro real do n8n..."
    };
  });

  for (let i = 0; i < Math.min(10, formattedErrors.length); i++) {
    const it = formattedErrors[i];
    try {
      const url = `${n8nUrl}/api/v1/executions/${it.execId}`;
      const execRes = await fetch(url, { headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } });
      const execData = await execRes.json();
      
      const errorObj = execData?.data?.resultData?.error;
      if (errorObj) {
        const nodeName = errorObj.node?.name ? ` no nó [${errorObj.node.name}]` : '';
        const errorDetail = errorObj.message || errorObj.description || 'Erro não especificado';
        it.suggestion = `Erro${nodeName}: ${errorDetail}`;
      } else {
        it.suggestion = "Execução finalizada com erro, porém sem registro de mensagem específica.";
      }
    } catch(err) {
       it.suggestion = "Não foi possível carregar os detalhes do erro vindo do n8n.";
    }
  }

  // Filtra apenas aqueles que conseguimos um erro (que não seja falha vazia se tiver muitos), 
  // mas vamos mostrar todos para ter visibilidade, como no executions.
  res.json({
    totalWorkflows: workflows.length,
    activeCount,
    inactiveCount,
    errors: formattedErrors,
    workflows: workflows.map(w => ({ id: w.id, name: w.name, active: w.active }))
  });
});

app.post('/api/n8n/workflows/:id/toggle', auth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  const url = `${process.env.N8N_URL.replace(/\/$/, '')}/api/v1/workflows/${id}/${active ? 'activate' : 'deactivate'}`;
  try {
    const apiRes = await fetch(url, { method: 'POST', headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY } });
    if (apiRes.ok) {
      cacheN8n.timestamp = 0; // invalidate cache
      return res.json({ ok: true });
    }
    res.json({ ok: false });
  } catch(e) {
    res.json({ ok: false });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`AutomaçãoOne rodando em http://localhost:${PORT}`);
});
