const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3333;
const dbPath = process.env.DATA_FILE_PATH || path.resolve(__dirname, '..', 'data.json');
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 120);
const LOGIN_ATTEMPT_WINDOW_MINUTES = Number(process.env.LOGIN_ATTEMPT_WINDOW_MINUTES || 15);
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const LOGIN_LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 7);
const TRIAL_LEAD_LIMIT = Number(process.env.TRIAL_LEAD_LIMIT || 25);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function sanitizeUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    role: user.role,
    company_id: user.company_id,
    must_change_password: !!user.must_change_password,
    created_at: user.created_at
  };
}

function loadDb() {
  if (!fs.existsSync(dbPath)) {
    const initial = {
      companies: [],
      users: [],
      sessions: [],
      loginGuards: [],
      securityAuditLogs: [],
      passwordResetTokens: [],
      plans: [],
      licenses: [],
      sales: [],
      leads: [],
      campaigns: [],
      messageLogs: []
    };
    fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
  }

  const raw = fs.readFileSync(dbPath, 'utf-8');
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.companies)) parsed.companies = [];
  if (!Array.isArray(parsed.users)) parsed.users = [];
  if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
  if (!Array.isArray(parsed.loginGuards)) parsed.loginGuards = [];
  if (!Array.isArray(parsed.securityAuditLogs)) parsed.securityAuditLogs = [];
  if (!Array.isArray(parsed.passwordResetTokens)) parsed.passwordResetTokens = [];
  if (!Array.isArray(parsed.plans)) parsed.plans = [];
  if (!Array.isArray(parsed.licenses)) parsed.licenses = [];
  if (!Array.isArray(parsed.sales)) parsed.sales = [];
  if (!Array.isArray(parsed.leads)) parsed.leads = [];
  if (!Array.isArray(parsed.campaigns)) parsed.campaigns = [];
  if (!Array.isArray(parsed.messageLogs)) parsed.messageLogs = [];

  const now = new Date().toISOString();
  let defaultCompany = parsed.companies.find((company) => company.slug === 'default');
  if (!defaultCompany) {
    defaultCompany = {
      id: uuidv4(),
      name: 'Operação Principal',
      slug: 'default',
      owner_name: 'Wander Pires Silva Coelho',
      created_at: now
    };
    parsed.companies.push(defaultCompany);
  }

  parsed.leads = parsed.leads.map((lead) => ({ ...lead, company_id: lead.company_id || defaultCompany.id }));
  parsed.campaigns = parsed.campaigns.map((campaign) => ({ ...campaign, company_id: campaign.company_id || defaultCompany.id }));
  parsed.messageLogs = parsed.messageLogs.map((log) => ({ ...log, company_id: log.company_id || defaultCompany.id }));
  parsed.users = parsed.users.map((user) => ({
    ...user,
    must_change_password: user.must_change_password === undefined ? false : !!user.must_change_password
  }));

  const nowDate = new Date();
  parsed.sessions = parsed.sessions
    .map((session) => {
      const baseDate = new Date(session.created_at || nowDate.toISOString());
      const expiresAt =
        session.expires_at || new Date(baseDate.getTime() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
      return { ...session, expires_at: expiresAt };
    })
    .filter((session) => new Date(session.expires_at) > nowDate);

  parsed.passwordResetTokens = parsed.passwordResetTokens.filter((token) => {
    if (token.used_at) return true;
    return new Date(token.expires_at) > nowDate;
  });

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@leadflownexuspro.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  const existingAdmin = parsed.users.find((user) => user.email.toLowerCase() === adminEmail.toLowerCase());

  if (!existingAdmin) {
    parsed.users.push({
      id: uuidv4(),
      full_name: 'Administrador LFN',
      email: adminEmail,
      password_hash: hashPassword(adminPassword),
      role: 'admin',
      company_id: defaultCompany.id,
      must_change_password: true,
      created_at: now
    });
  } else if (existingAdmin.password_hash === hashPassword('Admin@123')) {
    existingAdmin.must_change_password = true;
  }

  if (parsed.plans.length === 0) {
    parsed.plans.push(
      {
        id: uuidv4(),
        name: 'Teste Gratuito',
        code: 'trial',
        price_brl: 0,
        billing_cycle: 'trial',
        leads_limit: TRIAL_LEAD_LIMIT,
        duration_days: TRIAL_DAYS,
        active: true,
        created_at: now
      },
      {
        id: uuidv4(),
        name: 'Plano Start',
        code: 'start',
        price_brl: 97,
        billing_cycle: 'monthly',
        leads_limit: 300,
        duration_days: 30,
        active: true,
        created_at: now
      },
      {
        id: uuidv4(),
        name: 'Plano Pro',
        code: 'pro',
        price_brl: 197,
        billing_cycle: 'monthly',
        leads_limit: 1200,
        duration_days: 30,
        active: true,
        created_at: now
      }
    );
  }

  const adminUnlimitedLicense = parsed.licenses.find(
    (license) => license.company_id === defaultCompany.id && license.status === 'active'
  );

  if (!adminUnlimitedLicense) {
    parsed.licenses.push({
      id: uuidv4(),
      company_id: defaultCompany.id,
      plan_id: null,
      status: 'active',
      leads_limit: null,
      leads_used: 0,
      starts_at: now,
      expires_at: null,
      created_at: now
    });
  }

  const demoEmail = 'demo@leadflownexuspro.com';
  const demoPassword = 'Demo@123';
  let demoCompany = parsed.companies.find((company) => company.slug === 'demo-trial');
  if (!demoCompany) {
    demoCompany = {
      id: uuidv4(),
      name: 'Conta Demonstração LFN',
      slug: 'demo-trial',
      owner_name: 'Equipe Comercial LFN',
      created_at: now
    };
    parsed.companies.push(demoCompany);
  }

  const demoUser = parsed.users.find((user) => user.email.toLowerCase() === demoEmail);
  if (!demoUser) {
    parsed.users.push({
      id: uuidv4(),
      full_name: 'Usuário Demonstração',
      email: demoEmail,
      password_hash: hashPassword(demoPassword),
      role: 'client',
      company_id: demoCompany.id,
      must_change_password: false,
      created_at: now
    });
  }

  const trialPlan = parsed.plans.find((plan) => plan.code === 'trial') || null;
  const demoTrial = parsed.licenses.find((license) => license.company_id === demoCompany.id && license.status === 'trial');
  if (!demoTrial) {
    const startAt = new Date();
    const expiresAt = new Date(startAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    parsed.licenses.push({
      id: uuidv4(),
      company_id: demoCompany.id,
      plan_id: trialPlan?.id || null,
      status: 'trial',
      leads_limit: TRIAL_LEAD_LIMIT,
      leads_used: 0,
      starts_at: startAt.toISOString(),
      expires_at: expiresAt,
      created_at: now
    });
  }

  parsed.licenses = parsed.licenses.map((license) => {
    if ((license.status === 'trial' || license.status === 'active') && license.expires_at) {
      if (new Date(license.expires_at) <= new Date()) {
        return { ...license, status: 'expired' };
      }
    }
    return {
      leads_used: 0,
      ...license
    };
  });

  saveDb(parsed);
  return parsed;
}

function saveDb(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
}

function getBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(value) {
  return String(value || '').toLowerCase().trim();
}

function passwordMeetsPolicy(password) {
  const value = String(password || '');
  if (value.length < 8) return false;
  const hasUppercase = /[A-Z]/.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasNumber = /\d/.test(value);
  return hasUppercase && hasLowercase && hasNumber;
}

function createPasswordToken(db, userId, purpose, ttlMinutes = 20) {
  const plainToken = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();

  db.passwordResetTokens = db.passwordResetTokens.filter(
    (item) => !(item.user_id === userId && item.purpose === purpose)
  );

  db.passwordResetTokens.push({
    id: uuidv4(),
    user_id: userId,
    token_hash: hashToken(plainToken),
    purpose,
    expires_at: expiresAt,
    used_at: null,
    created_at: now.toISOString()
  });

  return plainToken;
}

function consumePasswordToken(db, userId, plainToken, purpose) {
  const now = new Date().toISOString();
  const tokenHash = hashToken(String(plainToken || ''));
  const tokenRecord = db.passwordResetTokens.find(
    (item) =>
      item.user_id === userId &&
      item.purpose === purpose &&
      item.token_hash === tokenHash &&
      !item.used_at &&
      item.expires_at > now
  );

  if (!tokenRecord) {
    return false;
  }

  tokenRecord.used_at = now;
  return true;
}

function getLoginGuard(db, email) {
  const normalizedEmail = normalizeEmail(email);
  let guard = db.loginGuards.find((item) => item.email === normalizedEmail);

  if (!guard) {
    guard = {
      email: normalizedEmail,
      failed_count: 0,
      first_failed_at: null,
      last_failed_at: null,
      locked_until: null
    };
    db.loginGuards.push(guard);
  }

  return guard;
}

function isLoginLocked(guard) {
  if (!guard?.locked_until) return false;
  return new Date(guard.locked_until) > new Date();
}

function registerFailedLogin(db, email) {
  const guard = getLoginGuard(db, email);
  const now = new Date();

  if (guard.first_failed_at) {
    const firstFailedAt = new Date(guard.first_failed_at);
    const windowExpiresAt = new Date(firstFailedAt.getTime() + LOGIN_ATTEMPT_WINDOW_MINUTES * 60 * 1000);
    if (windowExpiresAt <= now) {
      guard.failed_count = 0;
      guard.first_failed_at = null;
      guard.last_failed_at = null;
      guard.locked_until = null;
    }
  }

  if (!guard.first_failed_at) {
    guard.first_failed_at = now.toISOString();
  }

  guard.failed_count += 1;
  guard.last_failed_at = now.toISOString();

  if (guard.failed_count >= MAX_LOGIN_ATTEMPTS) {
    guard.locked_until = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000).toISOString();
  }

  return guard;
}

function clearLoginGuard(db, email) {
  const guard = getLoginGuard(db, email);
  guard.failed_count = 0;
  guard.first_failed_at = null;
  guard.last_failed_at = null;
  guard.locked_until = null;
}

function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function appendSecurityAudit(db, req, payload) {
  const now = new Date().toISOString();
  const entry = {
    id: uuidv4(),
    event_type: payload.event_type,
    status: payload.status || 'success',
    actor_user_id: payload.actor_user_id || null,
    actor_email: payload.actor_email || null,
    company_id: payload.company_id || null,
    ip: getRequestIp(req),
    user_agent: req.headers['user-agent'] || null,
    details: payload.details || {},
    created_at: now
  };

  db.securityAuditLogs.push(entry);
}

function getLatestLicense(db, companyId) {
  const licenses = db.licenses
    .filter((license) => license.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (licenses.length === 0) return null;
  return licenses[0];
}

function getActiveLicense(db, companyId) {
  const now = new Date();
  const candidates = db.licenses
    .filter((license) => license.company_id === companyId)
    .filter((license) => {
      const statusOk = license.status === 'active' || license.status === 'trial';
      const expiresOk = !license.expires_at || new Date(license.expires_at) > now;
      return statusOk && expiresOk;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return candidates[0] || null;
}

function companyCanAddLead(db, companyId) {
  const license = getActiveLicense(db, companyId);
  if (!license) {
    return {
      allowed: false,
      reason: 'Empresa sem licença ativa. Finalize a compra de um plano.',
      license: null
    };
  }

  if (license.leads_limit === null || license.leads_limit === undefined) {
    return { allowed: true, license };
  }

  if (Number(license.leads_used || 0) >= Number(license.leads_limit)) {
    return {
      allowed: false,
      reason: 'Limite de leads da licença atingido.',
      license
    };
  }

  return { allowed: true, license };
}

function getCompanyCommercialSnapshot(db, companyId) {
  const company = db.companies.find((item) => item.id === companyId) || null;
  const latestLicense = getLatestLicense(db, companyId);
  const activeLicense = getActiveLicense(db, companyId);
  const plan = latestLicense ? db.plans.find((item) => item.id === latestLicense.plan_id) || null : null;
  const sales = db.sales
    .filter((sale) => sale.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return {
    company,
    latestLicense,
    activeLicense,
    plan,
    sales
  };
}

function resolveCompanyId(req, user, db) {
  if (user.role !== 'admin') {
    return user.company_id;
  }

  const requestedCompanyId = req.headers['x-company-id'] || req.query.companyId || req.body?.companyId;
  if (!requestedCompanyId) return user.company_id;

  const company = db.companies.find((item) => item.id === requestedCompanyId);
  if (!company) {
    return null;
  }

  return requestedCompanyId;
}

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token ausente.' });
  }

  const db = loadDb();
  const session = db.sessions.find((item) => item.token === token);
  if (!session) {
    appendSecurityAudit(db, req, {
      event_type: 'session_invalid_token',
      status: 'failed',
      details: { token_prefix: token.slice(0, 8) }
    });
    saveDb(db);
    return res.status(401).json({ error: 'Sessão inválida ou expirada.', sessionExpired: true });
  }

  const now = new Date();
  if (!session.expires_at || new Date(session.expires_at) <= now) {
    db.sessions = db.sessions.filter((item) => item.token !== token);
    appendSecurityAudit(db, req, {
      event_type: 'session_expired',
      status: 'failed',
      actor_user_id: session.user_id,
      details: { expired_at: session.expires_at }
    });
    saveDb(db);
    return res.status(401).json({ error: 'Sessão expirada.', sessionExpired: true });
  }

  const user = db.users.find((item) => item.id === session.user_id);
  if (!user) {
    return res.status(401).json({ error: 'Usuário da sessão não encontrado.' });
  }

  req.auth = {
    token,
    user,
    db
  };
  return next();
}

function requireAdmin(req, res, next) {
  if (req.auth.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso permitido apenas para administrador.' });
  }
  return next();
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'LeadFlow Nexus Pro API' });
});

app.get('/api/public/plans', (_req, res) => {
  const db = loadDb();
  const plans = db.plans
    .filter((plan) => plan.active)
    .sort((a, b) => a.price_brl - b.price_brl)
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      code: plan.code,
      price_brl: plan.price_brl,
      billing_cycle: plan.billing_cycle,
      leads_limit: plan.leads_limit,
      duration_days: plan.duration_days
    }));

  return res.json({ total: plans.length, data: plans });
});

app.post('/api/public/trial/register', (req, res) => {
  const { name, ownerName, slug, adminEmail, adminPassword } = req.body;
  if (!name || !ownerName || !slug || !adminEmail || !adminPassword) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, ownerName, slug, adminEmail, adminPassword.'
    });
  }

  if (!passwordMeetsPolicy(adminPassword)) {
    return res.status(400).json({
      error: 'A senha deve ter mínimo 8 caracteres com maiúscula, minúscula e número.'
    });
  }

  const db = loadDb();
  const normalizedSlug = String(slug).toLowerCase().trim();
  const normalizedEmail = normalizeEmail(adminEmail);

  if (db.companies.some((company) => company.slug === normalizedSlug)) {
    return res.status(409).json({ error: 'Slug já em uso.' });
  }

  if (db.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'E-mail já cadastrado.' });
  }

  const trialPlan = db.plans.find((plan) => plan.code === 'trial');
  if (!trialPlan) {
    return res.status(500).json({ error: 'Plano de teste não configurado.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const companyId = uuidv4();
  const userId = uuidv4();
  const expiresAt = new Date(now.getTime() + trialPlan.duration_days * 24 * 60 * 60 * 1000).toISOString();

  db.companies.push({
    id: companyId,
    name: String(name).trim(),
    slug: normalizedSlug,
    owner_name: String(ownerName).trim(),
    created_at: nowIso
  });

  db.users.push({
    id: userId,
    full_name: `${String(name).trim()} Admin`,
    email: normalizedEmail,
    password_hash: hashPassword(String(adminPassword)),
    role: 'client',
    company_id: companyId,
    must_change_password: false,
    created_at: nowIso
  });

  db.licenses.push({
    id: uuidv4(),
    company_id: companyId,
    plan_id: trialPlan.id,
    status: 'trial',
    leads_limit: trialPlan.leads_limit,
    leads_used: 0,
    starts_at: nowIso,
    expires_at: expiresAt,
    created_at: nowIso
  });

  appendSecurityAudit(db, req, {
    event_type: 'trial_registered',
    status: 'success',
    actor_user_id: userId,
    actor_email: normalizedEmail,
    company_id: companyId,
    details: { plan_code: trialPlan.code }
  });

  saveDb(db);

  return res.status(201).json({
    message: 'Conta de teste criada com sucesso.',
    credentials: {
      email: normalizedEmail,
      password: adminPassword
    },
    trial: {
      expires_at: expiresAt,
      leads_limit: trialPlan.leads_limit
    }
  });
});

app.post('/api/public/register-checkout', (req, res) => {
  const {
    name,
    ownerName,
    slug,
    adminEmail,
    adminPassword,
    planId,
    paymentMethod,
    installments
  } = req.body;

  if (!name || !ownerName || !slug || !adminEmail || !adminPassword || !planId || !paymentMethod) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, ownerName, slug, adminEmail, adminPassword, planId, paymentMethod.'
    });
  }

  if (!['pix', 'card'].includes(String(paymentMethod))) {
    return res.status(400).json({ error: 'paymentMethod deve ser pix ou card.' });
  }

  if (!passwordMeetsPolicy(adminPassword)) {
    return res.status(400).json({
      error: 'A senha deve ter mínimo 8 caracteres com maiúscula, minúscula e número.'
    });
  }

  const db = loadDb();
  const normalizedSlug = String(slug).toLowerCase().trim();
  const normalizedEmail = normalizeEmail(adminEmail);

  if (db.companies.some((company) => company.slug === normalizedSlug)) {
    return res.status(409).json({ error: 'Slug já em uso.' });
  }

  if (db.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'E-mail já cadastrado.' });
  }

  const plan = db.plans.find((item) => item.id === planId && item.active && item.code !== 'trial');
  if (!plan) {
    return res.status(404).json({ error: 'Plano não encontrado para compra.' });
  }

  const nowIso = new Date().toISOString();
  const companyId = uuidv4();
  const userId = uuidv4();
  const saleId = uuidv4();

  db.companies.push({
    id: companyId,
    name: String(name).trim(),
    slug: normalizedSlug,
    owner_name: String(ownerName).trim(),
    created_at: nowIso
  });

  db.users.push({
    id: userId,
    full_name: `${String(name).trim()} Admin`,
    email: normalizedEmail,
    password_hash: hashPassword(String(adminPassword)),
    role: 'client',
    company_id: companyId,
    must_change_password: false,
    created_at: nowIso
  });

  const totalAmount = Number(plan.price_brl);
  db.sales.push({
    id: saleId,
    company_id: companyId,
    plan_id: plan.id,
    amount_brl: totalAmount,
    payment_method: String(paymentMethod),
    installments: paymentMethod === 'card' ? Math.max(1, Number(installments || 1)) : 1,
    status: 'pending',
    paid_at: null,
    created_at: nowIso
  });

  appendSecurityAudit(db, req, {
    event_type: 'checkout_created',
    status: 'success',
    actor_user_id: userId,
    actor_email: normalizedEmail,
    company_id: companyId,
    details: { sale_id: saleId, payment_method: paymentMethod, plan_code: plan.code }
  });

  saveDb(db);

  return res.status(201).json({
    message: 'Cadastro concluído. Finalize o pagamento para ativar sua licença.',
    saleId,
    payment: {
      method: paymentMethod,
      amount_brl: totalAmount,
      installments: paymentMethod === 'card' ? Math.max(1, Number(installments || 1)) : 1,
      pix_key: paymentMethod === 'pix' ? 'pix@leadflownexuspro.com' : null,
      card_note: paymentMethod === 'card' ? 'Pagamento em cartão simulado no MVP.' : null
    },
    credentials: {
      email: normalizedEmail,
      password: adminPassword
    }
  });
});

app.post('/api/public/checkout/:saleId/confirm', (req, res) => {
  const db = loadDb();
  const sale = db.sales.find((item) => item.id === req.params.saleId);
  if (!sale) {
    return res.status(404).json({ error: 'Venda não encontrada.' });
  }

  if (sale.status === 'paid') {
    return res.json({ message: 'Venda já confirmada anteriormente.' });
  }

  const plan = db.plans.find((item) => item.id === sale.plan_id);
  if (!plan) {
    return res.status(500).json({ error: 'Plano da venda não localizado.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + Number(plan.duration_days || 30) * 24 * 60 * 60 * 1000).toISOString();

  sale.status = 'paid';
  sale.paid_at = nowIso;

  db.licenses = db.licenses.map((license) => {
    if (license.company_id === sale.company_id && (license.status === 'active' || license.status === 'trial')) {
      return { ...license, status: 'expired' };
    }
    return license;
  });

  db.licenses.push({
    id: uuidv4(),
    company_id: sale.company_id,
    plan_id: plan.id,
    status: 'active',
    leads_limit: plan.leads_limit,
    leads_used: 0,
    starts_at: nowIso,
    expires_at: expiresAt,
    created_at: nowIso
  });

  appendSecurityAudit(db, req, {
    event_type: 'checkout_paid',
    status: 'success',
    company_id: sale.company_id,
    details: { sale_id: sale.id, amount_brl: sale.amount_brl, payment_method: sale.payment_method }
  });

  saveDb(db);

  return res.json({
    message: 'Pagamento confirmado e licença ativada.',
    saleId: sale.id,
    companyId: sale.company_id,
    license: {
      status: 'active',
      expires_at: expiresAt,
      leads_limit: plan.leads_limit
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe email e password.' });
  }

  const db = loadDb();
  const normalizedEmail = normalizeEmail(email);
  const guard = getLoginGuard(db, normalizedEmail);

  if (isLoginLocked(guard)) {
    appendSecurityAudit(db, req, {
      event_type: 'login_blocked',
      status: 'blocked',
      actor_email: normalizedEmail,
      details: { locked_until: guard.locked_until }
    });
    saveDb(db);
    return res.status(429).json({
      error: 'Conta temporariamente bloqueada por tentativas excedidas.',
      lockedUntil: guard.locked_until
    });
  }

  const user = db.users.find((item) => item.email.toLowerCase() === normalizedEmail);
  if (!user || user.password_hash !== hashPassword(String(password))) {
    const updatedGuard = registerFailedLogin(db, normalizedEmail);
    appendSecurityAudit(db, req, {
      event_type: updatedGuard.locked_until ? 'login_blocked' : 'login_failed',
      status: updatedGuard.locked_until ? 'blocked' : 'failed',
      actor_email: normalizedEmail,
      details: {
        failed_count: updatedGuard.failed_count,
        locked_until: updatedGuard.locked_until
      }
    });
    saveDb(db);

    if (updatedGuard.locked_until) {
      return res.status(429).json({
        error: 'Conta temporariamente bloqueada por tentativas excedidas.',
        lockedUntil: updatedGuard.locked_until
      });
    }

    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  clearLoginGuard(db, normalizedEmail);

  if (user.must_change_password) {
    const changeToken = createPasswordToken(db, user.id, 'first_access', 30);
    appendSecurityAudit(db, req, {
      event_type: 'login_first_access_required',
      status: 'blocked',
      actor_user_id: user.id,
      actor_email: user.email,
      company_id: user.company_id
    });
    saveDb(db);
    return res.status(403).json({
      error: 'Troca de senha obrigatória no primeiro acesso.',
      requiresPasswordChange: true,
      changeToken,
      user: sanitizeUser(user)
    });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  db.sessions.push({
    id: uuidv4(),
    user_id: user.id,
    token,
    created_at: now.toISOString(),
    expires_at: expiresAt
  });
  appendSecurityAudit(db, req, {
    event_type: 'login_success',
    status: 'success',
    actor_user_id: user.id,
    actor_email: user.email,
    company_id: user.company_id,
    details: { session_expires_at: expiresAt }
  });
  saveDb(db);

  return res.json({ token, expiresAt, user: sanitizeUser(user) });
});

app.post('/api/auth/first-access/change-password', (req, res) => {
  const { email, changeToken, newPassword } = req.body;
  if (!email || !changeToken || !newPassword) {
    return res.status(400).json({ error: 'Informe email, changeToken e newPassword.' });
  }

  if (!passwordMeetsPolicy(newPassword)) {
    return res.status(400).json({
      error: 'A nova senha deve ter mínimo 8 caracteres com maiúscula, minúscula e número.'
    });
  }

  const db = loadDb();
  const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const consumed = consumePasswordToken(db, user.id, changeToken, 'first_access');
  if (!consumed) {
    appendSecurityAudit(db, req, {
      event_type: 'first_access_change_failed',
      status: 'failed',
      actor_user_id: user.id,
      actor_email: user.email,
      company_id: user.company_id,
      details: { reason: 'invalid_or_expired_token' }
    });
    saveDb(db);
    return res.status(400).json({ error: 'Token de primeiro acesso inválido ou expirado.' });
  }

  user.password_hash = hashPassword(String(newPassword));
  user.must_change_password = false;
  db.sessions = db.sessions.filter((session) => session.user_id !== user.id);
  appendSecurityAudit(db, req, {
    event_type: 'first_access_password_changed',
    status: 'success',
    actor_user_id: user.id,
    actor_email: user.email,
    company_id: user.company_id
  });
  saveDb(db);

  return res.json({ message: 'Senha de primeiro acesso alterada com sucesso.' });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Informe o email da conta.' });
  }

  const db = loadDb();
  const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());

  if (!user) {
    appendSecurityAudit(db, req, {
      event_type: 'forgot_password_requested_unknown',
      status: 'failed',
      actor_email: normalizeEmail(email)
    });
    saveDb(db);
    return res.json({
      message: 'Se o e-mail estiver cadastrado, um token de recuperação foi gerado.'
    });
  }

  const resetToken = createPasswordToken(db, user.id, 'recovery', 20);
  appendSecurityAudit(db, req, {
    event_type: 'forgot_password_requested',
    status: 'success',
    actor_user_id: user.id,
    actor_email: user.email,
    company_id: user.company_id
  });
  saveDb(db);

  return res.json({
    message: 'Token de recuperação gerado. Em produção, envie por e-mail.',
    resetToken
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, resetToken, newPassword } = req.body;
  if (!email || !resetToken || !newPassword) {
    return res.status(400).json({ error: 'Informe email, resetToken e newPassword.' });
  }

  if (!passwordMeetsPolicy(newPassword)) {
    return res.status(400).json({
      error: 'A nova senha deve ter mínimo 8 caracteres com maiúscula, minúscula e número.'
    });
  }

  const db = loadDb();
  const user = db.users.find((item) => item.email.toLowerCase() === String(email).toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const consumed = consumePasswordToken(db, user.id, resetToken, 'recovery');
  if (!consumed) {
    appendSecurityAudit(db, req, {
      event_type: 'reset_password_failed',
      status: 'failed',
      actor_user_id: user.id,
      actor_email: user.email,
      company_id: user.company_id,
      details: { reason: 'invalid_or_expired_token' }
    });
    saveDb(db);
    return res.status(400).json({ error: 'Token de recuperação inválido ou expirado.' });
  }

  user.password_hash = hashPassword(String(newPassword));
  user.must_change_password = false;
  db.sessions = db.sessions.filter((session) => session.user_id !== user.id);
  appendSecurityAudit(db, req, {
    event_type: 'reset_password_success',
    status: 'success',
    actor_user_id: user.id,
    actor_email: user.email,
    company_id: user.company_id
  });
  saveDb(db);

  return res.json({ message: 'Senha redefinida com sucesso.' });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = req.auth.db;
  appendSecurityAudit(db, req, {
    event_type: 'logout_success',
    status: 'success',
    actor_user_id: req.auth.user.id,
    actor_email: req.auth.user.email,
    company_id: req.auth.user.company_id
  });
  db.sessions = db.sessions.filter((item) => item.token !== req.auth.token);
  saveDb(db);
  return res.json({ message: 'Logout realizado com sucesso.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = req.auth.db;
  const user = req.auth.user;
  const snapshot = getCompanyCommercialSnapshot(db, user.company_id);
  return res.json({
    user: sanitizeUser(user),
    company: snapshot.company,
    plan: snapshot.plan,
    license: snapshot.latestLicense
  });
});

app.post('/api/companies', requireAuth, requireAdmin, (req, res) => {
  const { name, ownerName, slug, adminEmail, adminPassword } = req.body;
  if (!name || !ownerName || !slug || !adminEmail || !adminPassword) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, ownerName, slug, adminEmail, adminPassword.'
    });
  }

  const db = req.auth.db;
  const normalizedSlug = String(slug).toLowerCase().trim();
  const normalizedEmail = String(adminEmail).toLowerCase().trim();

  if (db.companies.some((company) => company.slug === normalizedSlug)) {
    return res.status(409).json({ error: 'Slug já em uso.' });
  }

  if (db.users.some((user) => user.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'E-mail de administrador já cadastrado.' });
  }

  const now = new Date().toISOString();
  const companyId = uuidv4();
  const userId = uuidv4();

  db.companies.push({
    id: companyId,
    name: String(name).trim(),
    slug: normalizedSlug,
    owner_name: String(ownerName).trim(),
    created_at: now
  });

  db.users.push({
    id: userId,
    full_name: `${String(name).trim()} Admin`,
    email: normalizedEmail,
    password_hash: hashPassword(String(adminPassword)),
    role: 'client',
    company_id: companyId,
    must_change_password: true,
    created_at: now
  });

  saveDb(db);

  return res.status(201).json({
    message: 'Empresa cliente criada com sucesso.',
    company: db.companies.find((item) => item.id === companyId),
    clientAdmin: sanitizeUser(db.users.find((item) => item.id === userId))
  });
});

app.get('/api/companies', requireAuth, (req, res) => {
  const db = req.auth.db;
  const user = req.auth.user;

  if (user.role === 'admin') {
    return res.json({ total: db.companies.length, data: db.companies });
  }

  const ownCompany = db.companies.filter((company) => company.id === user.company_id);
  return res.json({ total: ownCompany.length, data: ownCompany });
});

app.get('/api/admin/security-audit', requireAuth, requireAdmin, (req, res) => {
  const db = req.auth.db;
  const limitValue = Number(req.query.limit || 100);
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 100;
  const eventFilter = req.query.event ? String(req.query.event) : null;
  const emailFilter = req.query.email ? normalizeEmail(req.query.email) : null;

  const logs = [...db.securityAuditLogs]
    .filter((item) => {
      const eventMatch = eventFilter ? item.event_type === eventFilter : true;
      const emailMatch = emailFilter ? normalizeEmail(item.actor_email) === emailFilter : true;
      return eventMatch && emailMatch;
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);

  const summary = logs.reduce(
    (acc, log) => {
      acc.total += 1;
      if (log.status === 'success') acc.success += 1;
      if (log.status === 'failed') acc.failed += 1;
      if (log.status === 'blocked') acc.blocked += 1;
      acc.byEvent[log.event_type] = (acc.byEvent[log.event_type] || 0) + 1;
      return acc;
    },
    { total: 0, success: 0, failed: 0, blocked: 0, byEvent: {} }
  );

  return res.json({
    total: logs.length,
    summary,
    data: logs
  });
});

app.get('/api/admin/commercial/overview', requireAuth, requireAdmin, (req, res) => {
  const db = req.auth.db;
  const customerCompanies = db.companies.filter((company) => company.slug !== 'default' && company.slug !== 'demo-trial');
  const paidSales = db.sales.filter((sale) => sale.status === 'paid');
  const pendingSales = db.sales.filter((sale) => sale.status === 'pending');
  const activeLicenses = db.licenses.filter((license) => license.status === 'active' || license.status === 'trial');

  const totalRevenue = paidSales.reduce((sum, sale) => sum + Number(sale.amount_brl || 0), 0);

  return res.json({
    totals: {
      customers: customerCompanies.length,
      plans: db.plans.filter((plan) => plan.active).length,
      paid_sales: paidSales.length,
      pending_sales: pendingSales.length,
      active_licenses: activeLicenses.length,
      total_revenue_brl: Number(totalRevenue.toFixed(2))
    }
  });
});

app.get('/api/admin/plans', requireAuth, requireAdmin, (req, res) => {
  const db = req.auth.db;
  const plans = [...db.plans].sort((a, b) => a.price_brl - b.price_brl);
  return res.json({ total: plans.length, data: plans });
});

app.post('/api/admin/plans', requireAuth, requireAdmin, (req, res) => {
  const { name, code, price_brl, billing_cycle, leads_limit, duration_days, active } = req.body;
  if (!name || !code || price_brl === undefined || !billing_cycle || duration_days === undefined) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, code, price_brl, billing_cycle, duration_days.'
    });
  }

  const db = req.auth.db;
  const normalizedCode = String(code).toLowerCase().trim();
  if (db.plans.some((plan) => plan.code === normalizedCode)) {
    return res.status(409).json({ error: 'Já existe um plano com este code.' });
  }

  const now = new Date().toISOString();
  const plan = {
    id: uuidv4(),
    name: String(name).trim(),
    code: normalizedCode,
    price_brl: Number(price_brl),
    billing_cycle: String(billing_cycle),
    leads_limit: leads_limit === null || leads_limit === undefined || leads_limit === '' ? null : Number(leads_limit),
    duration_days: Number(duration_days),
    active: active === undefined ? true : !!active,
    created_at: now
  };

  db.plans.push(plan);
  appendSecurityAudit(db, req, {
    event_type: 'admin_plan_created',
    status: 'success',
    actor_user_id: req.auth.user.id,
    actor_email: req.auth.user.email,
    company_id: req.auth.user.company_id,
    details: { plan_code: plan.code }
  });
  saveDb(db);

  return res.status(201).json({ message: 'Plano criado com sucesso.', plan });
});

app.patch('/api/admin/plans/:id', requireAuth, requireAdmin, (req, res) => {
  const db = req.auth.db;
  const plan = db.plans.find((item) => item.id === req.params.id);
  if (!plan) {
    return res.status(404).json({ error: 'Plano não encontrado.' });
  }

  const fields = ['name', 'price_brl', 'billing_cycle', 'leads_limit', 'duration_days', 'active'];
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      if (field === 'price_brl' || field === 'duration_days') {
        plan[field] = Number(req.body[field]);
      } else if (field === 'leads_limit') {
        const value = req.body[field];
        plan[field] = value === null || value === '' ? null : Number(value);
      } else if (field === 'active') {
        plan[field] = !!req.body[field];
      } else {
        plan[field] = req.body[field];
      }
    }
  });

  appendSecurityAudit(db, req, {
    event_type: 'admin_plan_updated',
    status: 'success',
    actor_user_id: req.auth.user.id,
    actor_email: req.auth.user.email,
    company_id: req.auth.user.company_id,
    details: { plan_code: plan.code }
  });
  saveDb(db);

  return res.json({ message: 'Plano atualizado com sucesso.', plan });
});

app.get('/api/admin/customers', requireAuth, requireAdmin, (req, res) => {
  const db = req.auth.db;

  const rows = db.companies
    .filter((company) => company.slug !== 'default')
    .map((company) => {
      const snapshot = getCompanyCommercialSnapshot(db, company.id);
      const mainUser = db.users.find((user) => user.company_id === company.id && user.role === 'client') || null;

      return {
        company_id: company.id,
        company_name: company.name,
        owner_name: company.owner_name,
        slug: company.slug,
        login_email: mainUser?.email || null,
        license_status: snapshot.latestLicense?.status || 'none',
        license_expires_at: snapshot.latestLicense?.expires_at || null,
        leads_limit: snapshot.latestLicense?.leads_limit ?? null,
        leads_used: snapshot.latestLicense?.leads_used ?? 0,
        plan_name: snapshot.plan?.name || null,
        last_sale_status: snapshot.sales[0]?.status || null,
        last_sale_amount_brl: snapshot.sales[0]?.amount_brl || 0,
        last_sale_payment_method: snapshot.sales[0]?.payment_method || null
      };
    })
    .sort((a, b) => a.company_name.localeCompare(b.company_name));

  return res.json({ total: rows.length, data: rows });
});

app.get('/api/client/license', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = req.auth.user.company_id;
  const snapshot = getCompanyCommercialSnapshot(db, companyId);

  if (!snapshot.latestLicense) {
    return res.status(404).json({ error: 'Nenhuma licença encontrada para sua empresa.' });
  }

  const leadsLimit = snapshot.latestLicense.leads_limit;
  const leadsUsed = Number(snapshot.latestLicense.leads_used || 0);
  const remainingLeads = leadsLimit === null ? null : Math.max(0, Number(leadsLimit) - leadsUsed);

  return res.json({
    company: snapshot.company,
    plan: snapshot.plan,
    license: {
      ...snapshot.latestLicense,
      remaining_leads: remainingLeads
    }
  });
});

app.post('/api/leads', requireAuth, (req, res) => {
  const { fullName, email, phone, niche, source, consent } = req.body;

  if (!fullName || !niche || !source || consent !== true) {
    return res.status(400).json({
      error: 'Campos obrigatórios: fullName, niche, source e consent=true.'
    });
  }

  if (!email && !phone) {
    return res.status(400).json({
      error: 'Informe ao menos um canal de contato: email ou phone.'
    });
  }

  const now = new Date().toISOString();
  const id = uuidv4();
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para operação.' });
  }

  const permission = companyCanAddLead(db, companyId);
  if (!permission.allowed) {
    return res.status(403).json({ error: permission.reason });
  }

  db.leads.push({
    id,
    company_id: companyId,
    full_name: fullName,
    email: email || null,
    phone: phone || null,
    niche,
    source,
    consent: 1,
    consent_at: now,
    opt_out: 0,
    created_at: now
  });

  if (permission.license && permission.license.leads_limit !== null && permission.license.leads_limit !== undefined) {
    permission.license.leads_used = Number(permission.license.leads_used || 0) + 1;
  }

  saveDb(db);

  return res.status(201).json({ id, message: 'Lead cadastrado com consentimento.' });
});

app.get('/api/leads', requireAuth, (req, res) => {
  const { niche } = req.query;
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const leads = niche
    ? db.leads.filter((lead) => lead.company_id === companyId && lead.niche === niche && lead.opt_out === 0)
    : db.leads.filter((lead) => lead.company_id === companyId && lead.opt_out === 0);

  leads.sort((a, b) => b.created_at.localeCompare(a.created_at));

  res.json({ total: leads.length, data: leads });
});

app.post('/api/leads/:id/opt-out', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para operação.' });
  }

  const lead = db.leads.find((item) => item.id === req.params.id && item.company_id === companyId);

  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado.' });
  }

  lead.opt_out = 1;
  saveDb(db);

  return res.json({ message: 'Lead marcado como opt-out.' });
});

app.post('/api/campaigns', requireAuth, (req, res) => {
  const { name, niche, channel, messageTemplate } = req.body;

  if (!name || !niche || !channel || !messageTemplate) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, niche, channel, messageTemplate.'
    });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para operação.' });
  }

  db.campaigns.push({
    id,
    company_id: companyId,
    name,
    niche,
    channel,
    message_template: messageTemplate,
    created_at: now
  });
  saveDb(db);

  return res.status(201).json({ id, message: 'Campanha criada.' });
});

app.get('/api/campaigns', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const campaigns = db.campaigns
    .filter((campaign) => campaign.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ total: campaigns.length, data: campaigns });
});

function randomStatus() {
  const deliveryRoll = Math.random();
  const engagementRoll = Math.random();

  const deliveryStatus = deliveryRoll > 0.2 ? 'delivered' : 'failed';
  let engagementStatus = 'no_response';

  if (deliveryStatus === 'delivered' && engagementRoll > 0.75) {
    engagementStatus = 'responded';
  }

  return {
    sendStatus: 'sent',
    deliveryStatus,
    engagementStatus
  };
}

app.post('/api/campaigns/:id/send', requireAuth, (req, res) => {
  const campaignId = req.params.id;
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para operação.' });
  }

  const campaign = db.campaigns.find((item) => item.id === campaignId && item.company_id === companyId);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  const leads = db.leads.filter(
    (lead) => lead.company_id === companyId && lead.niche === campaign.niche && lead.opt_out === 0
  );
  if (leads.length === 0) {
    return res.status(400).json({ error: 'Não há leads elegíveis para esta campanha.' });
  }

  const now = new Date().toISOString();
  leads.forEach((lead) => {
    const status = randomStatus();
    db.messageLogs.push({
      id: uuidv4(),
      company_id: companyId,
      campaign_id: campaign.id,
      lead_id: lead.id,
      channel: campaign.channel,
      send_status: status.sendStatus,
      delivery_status: status.deliveryStatus,
      engagement_status: status.engagementStatus,
      created_at: now
    });
  });
  saveDb(db);

  return res.json({
    message: 'Disparo processado com sucesso (simulação de MVP).',
    campaignId,
    leadsProcessed: leads.length
  });
});

app.get('/api/reports/summary', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const companyLogs = db.messageLogs.filter((log) => log.company_id === companyId);
  const companyCampaigns = db.campaigns.filter((campaign) => campaign.company_id === companyId);

  const totalMessages = companyLogs.length;
  const totalSent = companyLogs.filter((item) => item.send_status === 'sent').length;
  const totalDelivered = companyLogs.filter((item) => item.delivery_status === 'delivered').length;
  const totalResponded = companyLogs.filter((item) => item.engagement_status === 'responded').length;

  const totals = {
    total_messages: totalMessages,
    total_sent: totalSent,
    total_delivered: totalDelivered,
    total_responded: totalResponded
  };

  const byCampaign = companyCampaigns
    .map((campaign) => {
      const logs = companyLogs.filter((log) => log.campaign_id === campaign.id);
      return {
        id: campaign.id,
        name: campaign.name,
        channel: campaign.channel,
        niche: campaign.niche,
        messages: logs.length,
        delivered: logs.filter((log) => log.delivery_status === 'delivered').length,
        responded: logs.filter((log) => log.engagement_status === 'responded').length
      };
    })
    .sort((a, b) => b.messages - a.messages);

  const responseRate = totals.total_delivered
    ? Number(((totals.total_responded / totals.total_delivered) * 100).toFixed(2))
    : 0;

  res.json({
    totals,
    responseRate,
    byCampaign
  });
});

app.listen(PORT, () => {
  console.log(`LeadFlow Nexus Pro API running on http://localhost:${PORT}`);
});
