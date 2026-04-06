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
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY || '';
const WHATSAPP_GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v20.0';
// Intervalo mínimo entre envios (ms) — evita rate-limit da Meta. Padrão: 1200ms (~50/min)
const WHATSAPP_SEND_DELAY_MS = Number(process.env.WHATSAPP_SEND_DELAY_MS || 1200);
// WABA ID para listar templates (opcional — necessário apenas para /api/admin/whatsapp/templates)
// Definido em WHATSAPP_BUSINESS_ACCOUNT_ID no ambiente

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
      invoices: [],
      notificationLogs: [],
      dispatchBatches: [],
      reportSnapshots: [],
      leads: [],
      campaigns: [],
      messageLogs: [],
      prospects: [],
      whatsappConfigs: []
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
  if (!Array.isArray(parsed.invoices)) parsed.invoices = [];
  if (!Array.isArray(parsed.notificationLogs)) parsed.notificationLogs = [];
  if (!Array.isArray(parsed.dispatchBatches)) parsed.dispatchBatches = [];
  if (!Array.isArray(parsed.reportSnapshots)) parsed.reportSnapshots = [];
  if (!Array.isArray(parsed.leads)) parsed.leads = [];
  if (!Array.isArray(parsed.campaigns)) parsed.campaigns = [];
  if (!Array.isArray(parsed.messageLogs)) parsed.messageLogs = [];
  if (!Array.isArray(parsed.prospects)) parsed.prospects = [];
  if (!Array.isArray(parsed.whatsappConfigs)) parsed.whatsappConfigs = [];

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
  parsed.prospects = parsed.prospects.map((p) => ({ ...p, company_id: p.company_id || defaultCompany.id }));
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
      must_change_password: false,
      created_at: now
    });
  } else {
    existingAdmin.must_change_password = false;
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

function normalizeDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTimeBR(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function toMoneyBRL(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function generateInvoiceNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const serial = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `NFS-${y}${m}${d}-${serial}`;
}

async function logEmailNotification(db, payload) {
  const now = new Date().toISOString();
  const mode = process.env.EMAIL_DELIVERY_MODE || 'log_only';
  let status = 'logged';
  let providerResponse = null;

  if (mode === 'webhook' && process.env.EMAIL_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.EMAIL_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      status = response.ok ? 'sent' : 'provider_error';
      providerResponse = { status: response.status };
    } catch (error) {
      status = 'provider_error';
      providerResponse = { error: error.message };
    }
  }

  const entry = {
    id: uuidv4(),
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    company_id: payload.company_id || null,
    sale_id: payload.sale_id || null,
    invoice_id: payload.invoice_id || null,
    status,
    mode,
    provider_response: providerResponse,
    created_at: now
  };

  db.notificationLogs.push(entry);
  return entry;
}

function isWhatsAppConfigured() {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Retorna as credenciais WhatsApp de uma empresa específica.
 * Prioridade: configuração salva no banco → variáveis de ambiente do servidor (fallback).
 */
function getCompanyWhatsAppCreds(db, companyId) {
  const saved = db.whatsappConfigs
    ? db.whatsappConfigs.find((c) => c.company_id === companyId)
    : null;

  if (saved && saved.access_token && saved.phone_number_id) {
    return {
      accessToken: saved.access_token,
      phoneNumberId: saved.phone_number_id,
      businessAccountId: saved.business_account_id || null,
      apiVersion: saved.api_version || WHATSAPP_GRAPH_API_VERSION,
      source: 'company'
    };
  }

  // Fallback: variáveis de ambiente do servidor
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return {
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
      apiVersion: WHATSAPP_GRAPH_API_VERSION,
      source: 'env'
    };
  }

  return null;
}

function normalizeWhatsAppRecipient(phone) {
  const raw = String(phone || '').trim();
  if (!raw) return null;

  let digits = normalizeDigits(raw);
  if (!digits) return null;

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }

  if (digits.length < 12) {
    return null;
  }

  return digits;
}

function renderCampaignMessage(template, lead) {
  return String(template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, lead.full_name || '')
    .replace(/\{\{\s*name\s*\}\}/gi, lead.full_name || '')
    .trim();
}

async function sendWhatsAppTextMessage({ to, message, creds }) {
  const c = creds || {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: WHATSAPP_GRAPH_API_VERSION
  };

  if (!c.accessToken || !c.phoneNumberId) {
    throw new Error('WhatsApp Cloud API não configurada.');
  }

  const url = `https://graph.facebook.com/${c.apiVersion || WHATSAPP_GRAPH_API_VERSION}/${c.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: message
      }
    })
  });

  let providerResponse = null;
  try {
    providerResponse = await response.json();
  } catch (_error) {
    providerResponse = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    providerResponse
  };
}

/**
 * Envia uma mensagem usando template aprovado pela Meta.
 * Obrigatório para contatos frios (janela de 24 h não aberta pelo lead).
 * @param {object} opts
 * @param {string} opts.to           – número em formato E.164 sem '+'  (ex: 5511999999999)
 * @param {string} opts.templateName – nome exato do template aprovado na WABA
 * @param {string} [opts.languageCode] – código de idioma do template (padrão: 'pt_BR')
 * @param {string[]} [opts.bodyParams]  – valores para os placeholders {{1}}, {{2}}… no corpo
 */
async function sendWhatsAppTemplateMessage({ to, templateName, languageCode = 'pt_BR', bodyParams = [], creds }) {
  const c = creds || {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    apiVersion: WHATSAPP_GRAPH_API_VERSION
  };

  if (!c.accessToken || !c.phoneNumberId) {
    throw new Error('WhatsApp Cloud API não configurada.');
  }

  const url = `https://graph.facebook.com/${c.apiVersion || WHATSAPP_GRAPH_API_VERSION}/${c.phoneNumberId}/messages`;

  const components = [];
  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text) }))
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 ? { components } : {})
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  let providerResponse = null;
  try {
    providerResponse = await response.json();
  } catch (_err) {
    providerResponse = null;
  }

  return { ok: response.ok, status: response.status, providerResponse };
}

/**
 * Extrai os parâmetros posicionais ({{1}}, {{2}}, …) a partir do template
 * de mensagem e dos dados do lead, para uso na API de template do WhatsApp.
 */
function extractTemplateParams(template, lead) {
  const params = [];
  if (/\{\{\s*(nome|name|1)\s*\}\}/i.test(template)) params.push(lead.full_name || '');
  if (/\{\{\s*(telefone|phone|2)\s*\}\}/i.test(template)) params.push(lead.phone || '');
  if (/\{\{\s*(email|3)\s*\}\}/i.test(template)) params.push(lead.email || '');
  return params;
}

function buildReportSnapshot(db, companyId) {
  const company = db.companies.find((item) => item.id === companyId) || null;
  const leads = db.leads.filter((item) => item.company_id === companyId);
  const campaigns = db.campaigns.filter((item) => item.company_id === companyId);
  const messageLogs = db.messageLogs.filter((item) => item.company_id === companyId);
  const sales = db.sales.filter((item) => item.company_id === companyId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const notifications = db.notificationLogs
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const invoices = db.invoices.filter((item) => item.company_id === companyId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const dispatchBatches = db.dispatchBatches
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const activeLicense = getActiveLicense(db, companyId);

  const totalMessages = messageLogs.length;
  const totalSent = messageLogs.filter((item) => item.send_status === 'sent').length;
  const totalDelivered = messageLogs.filter((item) => item.delivery_status === 'delivered').length;
  const totalResponded = messageLogs.filter((item) => item.engagement_status === 'responded').length;
  const responseRate = totalDelivered ? Number(((totalResponded / totalDelivered) * 100).toFixed(2)) : 0;

  const campaignRows = campaigns
    .map((campaign) => {
      const logs = messageLogs.filter((log) => log.campaign_id === campaign.id);
      return {
        campaign_id: campaign.id,
        name: campaign.name,
        channel: campaign.channel,
        niche: campaign.niche,
        total_messages: logs.length,
        delivered: logs.filter((log) => log.delivery_status === 'delivered').length,
        responded: logs.filter((log) => log.engagement_status === 'responded').length
      };
    })
    .sort((a, b) => b.total_messages - a.total_messages);

  return {
    company,
    generated_at: new Date().toISOString(),
    summary: {
      total_leads: leads.length,
      total_campaigns: campaigns.length,
      total_messages: totalMessages,
      total_sent: totalSent,
      total_delivered: totalDelivered,
      total_responded: totalResponded,
      response_rate: responseRate,
      paid_sales: sales.filter((item) => item.status === 'paid').length,
      pending_sales: sales.filter((item) => item.status === 'pending').length,
      total_revenue_brl: Number(
        sales
          .filter((item) => item.status === 'paid')
          .reduce((sum, sale) => sum + Number(sale.amount_brl || 0), 0)
          .toFixed(2)
      )
    },
    active_license: activeLicense,
    campaigns: campaignRows,
    dispatch_batches: dispatchBatches.slice(0, 30),
    sales: sales.slice(0, 20),
    notifications: notifications.slice(0, 20),
    invoices: invoices.slice(0, 20)
  };
}

function buildPrintableHtml(snapshot) {
  const companyName = snapshot.company?.name || 'Empresa';
  const generatedAt = formatDateTimeBR(snapshot.generated_at);

  const campaignRows = snapshot.campaigns
    .map(
      (item) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.channel)}</td>
        <td>${escapeHtml(item.niche)}</td>
        <td>${item.total_messages}</td>
        <td>${item.delivered}</td>
        <td>${item.responded}</td>
      </tr>`
    )
    .join('');

  const salesRows = snapshot.sales
    .map(
      (sale) => `
      <tr>
        <td>${formatDateTimeBR(sale.created_at)}</td>
        <td>${escapeHtml(sale.status)}</td>
        <td>${toMoneyBRL(sale.amount_brl)}</td>
        <td>${escapeHtml(sale.payment_method)}</td>
      </tr>`
    )
    .join('');

  const invoiceRows = snapshot.invoices
    .map(
      (invoice) => `
      <tr>
        <td>${escapeHtml(invoice.number)}</td>
        <td>${formatDateTimeBR(invoice.issued_at)}</td>
        <td>${toMoneyBRL(invoice.amount_brl)}</td>
        <td>${escapeHtml(invoice.municipality)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Relatório LFN - ${escapeHtml(companyName)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #222; }
    h1, h2 { margin: 0 0 8px; }
    .meta { margin-bottom: 12px; color: #555; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 8px; margin: 12px 0 16px; }
    .card { border: 1px solid #ddd; padding: 10px; border-radius: 8px; }
    .label { font-size: 12px; color: #666; }
    .value { font-size: 18px; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 6px; font-size: 12px; text-align: left; }
    th { background: #f5f5f5; }
    @media print { .no-print { display: none; } body { margin: 8mm; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()">Imprimir</button>
  <h1>Relatório de Acompanhamento - LeadFlow Nexus Pro</h1>
  <div class="meta">Empresa: ${escapeHtml(companyName)} | Gerado em: ${generatedAt}</div>

  <div class="cards">
    <div class="card"><div class="label">Leads</div><div class="value">${snapshot.summary.total_leads}</div></div>
    <div class="card"><div class="label">Campanhas</div><div class="value">${snapshot.summary.total_campaigns}</div></div>
    <div class="card"><div class="label">Mensagens</div><div class="value">${snapshot.summary.total_messages}</div></div>
    <div class="card"><div class="label">Taxa resposta</div><div class="value">${snapshot.summary.response_rate}%</div></div>
  </div>

  <h2>Campanhas e envios</h2>
  <table>
    <thead><tr><th>Campanha</th><th>Canal</th><th>Nicho</th><th>Mensagens</th><th>Entregues</th><th>Respondidas</th></tr></thead>
    <tbody>${campaignRows || '<tr><td colspan="6">Sem dados.</td></tr>'}</tbody>
  </table>

  <h2>Vendas</h2>
  <table>
    <thead><tr><th>Data</th><th>Status</th><th>Valor</th><th>Pagamento</th></tr></thead>
    <tbody>${salesRows || '<tr><td colspan="4">Sem dados.</td></tr>'}</tbody>
  </table>

  <h2>Faturas emitidas</h2>
  <table>
    <thead><tr><th>Número</th><th>Emissão</th><th>Valor</th><th>Município</th></tr></thead>
    <tbody>${invoiceRows || '<tr><td colspan="4">Sem dados.</td></tr>'}</tbody>
  </table>
</body>
</html>`;
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
    installments,
    buyerName,
    buyerEmail,
    buyerPhone,
    buyerDocument,
    addressStreet,
    addressNumber,
    addressComplement,
    addressDistrict,
    addressCity,
    addressState,
    addressZipCode
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
    buyer: {
      name: sanitizeText(buyerName || ownerName || name),
      email: normalizeEmail(buyerEmail || adminEmail),
      phone: sanitizeText(buyerPhone || ''),
      document: normalizeDigits(buyerDocument || '')
    },
    billing_address: {
      street: sanitizeText(addressStreet || ''),
      number: sanitizeText(addressNumber || ''),
      complement: sanitizeText(addressComplement || ''),
      district: sanitizeText(addressDistrict || ''),
      city: sanitizeText(addressCity || 'Curimatá'),
      state: sanitizeText(addressState || 'PI').toUpperCase(),
      zip_code: normalizeDigits(addressZipCode || '')
    },
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

app.post('/api/public/checkout/:saleId/confirm', async (req, res) => {
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

  const invoiceId = uuidv4();
  const invoiceNumber = generateInvoiceNumber();
  const invoice = {
    id: invoiceId,
    number: invoiceNumber,
    sale_id: sale.id,
    company_id: sale.company_id,
    amount_brl: Number(sale.amount_brl || 0),
    municipality: 'Curimatá-PI',
    tax_type: 'ISS',
    issued_at: nowIso,
    buyer: sale.buyer || null,
    billing_address: sale.billing_address || null,
    created_at: nowIso
  };

  db.invoices.push(invoice);
  sale.invoice_id = invoiceId;
  sale.invoice_number = invoiceNumber;

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
    details: {
      sale_id: sale.id,
      amount_brl: sale.amount_brl,
      payment_method: sale.payment_method,
      invoice_number: invoiceNumber
    }
  });

  const company = db.companies.find((item) => item.id === sale.company_id);
  const companyUser = db.users.find((item) => item.company_id === sale.company_id && item.role === 'client');
  const sellerEmail = process.env.ADMIN_EMAIL || 'wanderpsc@gmail.com';
  const buyerEmail = sale.buyer?.email || companyUser?.email || null;

  if (buyerEmail) {
    await logEmailNotification(db, {
      to: buyerEmail,
      subject: `Pagamento confirmado - ${company?.name || 'LFN'}`,
      body: `Pagamento confirmado. Fatura ${invoiceNumber} emitida com ISS Curimatá-PI.`,
      company_id: sale.company_id,
      sale_id: sale.id,
      invoice_id: invoiceId
    });
  }

  await logEmailNotification(db, {
    to: sellerEmail,
    subject: `Nova venda confirmada - ${company?.name || 'Cliente'}`,
    body: `Venda ${sale.id} confirmada. Fatura ${invoiceNumber}. Valor ${toMoneyBRL(sale.amount_brl)}.`,
    company_id: sale.company_id,
    sale_id: sale.id,
    invoice_id: invoiceId
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
    },
    invoice: {
      id: invoiceId,
      number: invoiceNumber,
      municipality: 'Curimatá-PI',
      tax_type: 'ISS'
    }
  });
});

app.post('/api/reports/generate', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para gerar relatório.' });
  }

  const snapshot = buildReportSnapshot(db, companyId);
  const report = {
    id: uuidv4(),
    company_id: companyId,
    created_by: req.auth.user.id,
    created_at: new Date().toISOString(),
    data: snapshot
  };

  db.reportSnapshots.push(report);
  appendSecurityAudit(db, req, {
    event_type: 'report_generated',
    status: 'success',
    actor_user_id: req.auth.user.id,
    actor_email: req.auth.user.email,
    company_id: companyId,
    details: {
      report_id: report.id,
      total_messages: snapshot.summary.total_messages,
      total_leads: snapshot.summary.total_leads
    }
  });
  saveDb(db);

  return res.status(201).json({
    message: 'Relatório salvo com sucesso.',
    report: {
      id: report.id,
      created_at: report.created_at,
      summary: snapshot.summary
    }
  });
});

app.get('/api/reports/history', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const limitValue = Number(req.query.limit || 30);
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 30;

  const rows = db.reportSnapshots
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      company_id: item.company_id,
      created_at: item.created_at,
      created_by: item.created_by,
      summary: item.data?.summary || null
    }));

  return res.json({ total: rows.length, data: rows });
});

app.get('/api/reports/dispatch-history', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const limitValue = Number(req.query.limit || 50);
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 300) : 50;

  const data = db.dispatchBatches
    .filter((item) => item.company_id === companyId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);

  return res.json({ total: data.length, data });
});

app.get('/api/reports/:id/print', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para impressão.' });
  }

  const report = db.reportSnapshots.find((item) => item.id === req.params.id && item.company_id === companyId);
  if (!report) {
    return res.status(404).json({ error: 'Relatório não encontrado.' });
  }

  const html = buildPrintableHtml(report.data || {});
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
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
    must_change_password: false,
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
  const { name, niche, channel, messageTemplate, templateName, templateLanguage } = req.body;

  if (!name || !niche || !channel || !messageTemplate) {
    return res.status(400).json({
      error: 'Campos obrigatórios: name, niche, channel, messageTemplate.'
    });
  }

  // Para canal WhatsApp, o templateName é fortemente recomendado (contatos frios)
  const normalizedTemplateName = templateName ? String(templateName).trim() : null;
  const normalizedTemplateLanguage = templateLanguage ? String(templateLanguage).trim() : 'pt_BR';

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
    template_name: normalizedTemplateName,
    template_language: normalizedTemplateLanguage,
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

app.get('/api/campaigns/:id/leads', requireAuth, (req, res) => {
  const campaignId = req.params.id;
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada para consulta.' });
  }

  const campaign = db.campaigns.find((item) => item.id === campaignId && item.company_id === companyId);
  if (!campaign) {
    return res.status(404).json({ error: 'Campanha não encontrada.' });
  }

  const leads = db.leads
    .filter((lead) => lead.company_id === companyId && lead.niche === campaign.niche && lead.opt_out === 0)
    .map((lead) => ({
      id: lead.id,
      full_name: lead.full_name,
      phone: lead.phone || null,
      email: lead.email || null,
      niche: lead.niche
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  res.json({ total: leads.length, data: leads });
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

app.post('/api/campaigns/:id/send', requireAuth, async (req, res) => {
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

  const { leadIds } = req.body || {};
  const allLeads = db.leads.filter(
    (lead) => lead.company_id === companyId && lead.niche === campaign.niche && lead.opt_out === 0
  );

  const leads = Array.isArray(leadIds) && leadIds.length > 0
    ? allLeads.filter((lead) => leadIds.includes(lead.id))
    : allLeads;

  if (leads.length === 0) {
    return res.status(400).json({ error: 'Não há leads elegíveis para esta campanha.' });
  }

  // Pula leads que já receberam esta campanha com sucesso (evita spam/bloqueio)
  const alreadySentLeadIds = new Set(
    db.messageLogs
      .filter((log) => log.campaign_id === campaignId && log.send_status === 'sent')
      .map((log) => log.lead_id)
  );
  const pendingLeads = leads.filter((lead) => !alreadySentLeadIds.has(lead.id));

  if (pendingLeads.length === 0) {
    return res.status(400).json({ error: 'Todos os leads selecionados já receberam esta campanha.' });
  }

  const now = new Date().toISOString();
  const batchId = uuidv4();
  const companyCreds = getCompanyWhatsAppCreds(db, companyId);
  const canUseRealWhatsApp = campaign.channel === 'whatsapp' && !!companyCreds;
  const usesTemplate = canUseRealWhatsApp && !!campaign.template_name;

  // Cria o registro do lote imediatamente com status 'processing'
  db.dispatchBatches.push({
    id: batchId,
    company_id: companyId,
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    channel: campaign.channel,
    total_leads: pendingLeads.length,
    totals: { sent: 0, delivered: 0, responded: 0, failed: 0 },
    status: 'processing',
    dispatch_mode: canUseRealWhatsApp ? (usesTemplate ? 'whatsapp_template' : 'whatsapp_text') : 'simulation',
    created_by: req.auth.user.id,
    created_at: now
  });
  saveDb(db);

  // Responde imediatamente — o envio real ocorre em segundo plano
  res.status(202).json({
    message: canUseRealWhatsApp
      ? `Disparo iniciado em segundo plano via WhatsApp${usesTemplate ? ' (template)' : ' (texto)'} para ${pendingLeads.length} leads. Acompanhe o histórico de disparos.`
      : `Disparo simulado iniciado para ${pendingLeads.length} leads. Acompanhe o histórico de disparos.`,
    batchId,
    leadsTotal: pendingLeads.length,
    leadsSkipped: leads.length - pendingLeads.length,
    dispatchMode: canUseRealWhatsApp ? (usesTemplate ? 'whatsapp_template' : 'whatsapp_text') : 'simulation',
    sent: 0,
    failed: 0
  });

  // ─── Background: executa envios sem bloquear o HTTP ───────────────────────
  setImmediate(async () => {
    const byStatus = { sent: 0, delivered: 0, responded: 0, failed: 0 };
    const logEntries = [];
    const dispatchNow = new Date().toISOString();

    for (let i = 0; i < pendingLeads.length; i++) {
      const lead = pendingLeads[i];

      // Delay com jitter entre envios reais (evita rate-limit e padrão robótico)
      if (canUseRealWhatsApp && i > 0 && WHATSAPP_SEND_DELAY_MS > 0) {
        const jitter = Math.floor(Math.random() * 1500);
        await new Promise((resolve) => setTimeout(resolve, WHATSAPP_SEND_DELAY_MS + jitter));
      }

      let status;
      let providerResponse = null;

      if (canUseRealWhatsApp) {
        const recipient = normalizeWhatsAppRecipient(lead.phone);
        if (!recipient) {
          status = { sendStatus: 'failed', deliveryStatus: 'failed', engagementStatus: 'no_response' };
          providerResponse = { error: 'Lead sem telefone válido para WhatsApp.' };
        } else {
          try {
            let providerResult;

            if (usesTemplate) {
              // ✅ Template aprovado: funciona com contatos frios (leads de anúncios)
              const bodyParams = extractTemplateParams(campaign.message_template, lead);
              providerResult = await sendWhatsAppTemplateMessage({
                to: recipient,
                templateName: campaign.template_name,
                languageCode: campaign.template_language || 'pt_BR',
                bodyParams,
                creds: companyCreds
              });
            } else {
              // ⚠️ Texto livre: só funciona se o lead enviou mensagem nas últimas 24 h
              const message = renderCampaignMessage(campaign.message_template, lead);
              providerResult = await sendWhatsAppTextMessage({ to: recipient, message, creds: companyCreds });
            }

            providerResponse = providerResult.providerResponse || { status: providerResult.status };
            status = providerResult.ok
              ? { sendStatus: 'sent', deliveryStatus: 'delivered', engagementStatus: 'no_response' }
              : { sendStatus: 'failed', deliveryStatus: 'failed', engagementStatus: 'no_response' };
          } catch (err) {
            status = { sendStatus: 'failed', deliveryStatus: 'failed', engagementStatus: 'no_response' };
            providerResponse = { error: err.message };
          }
        }
      } else {
        status = randomStatus();
      }

      byStatus.sent += status.sendStatus === 'sent' ? 1 : 0;
      byStatus.delivered += status.deliveryStatus === 'delivered' ? 1 : 0;
      byStatus.responded += status.engagementStatus === 'responded' ? 1 : 0;
      byStatus.failed += status.deliveryStatus === 'failed' ? 1 : 0;

      logEntries.push({
        id: uuidv4(),
        company_id: companyId,
        campaign_id: campaign.id,
        lead_id: lead.id,
        channel: campaign.channel,
        send_status: status.sendStatus,
        delivery_status: status.deliveryStatus,
        engagement_status: status.engagementStatus,
        provider_response: providerResponse,
        created_at: dispatchNow
      });
    }

    // Persiste resultados de forma atômica após o loop
    try {
      const finalDb = loadDb();
      finalDb.messageLogs.push(...logEntries);
      const batch = finalDb.dispatchBatches.find((item) => item.id === batchId);
      if (batch) {
        batch.totals = byStatus;
        batch.status = 'done';
        batch.completed_at = new Date().toISOString();
      }
      saveDb(finalDb);
    } catch (persistErr) {
      console.error(`[dispatch:${batchId}] Erro ao persistir resultados:`, persistErr.message);
    }
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

// ===== PROSPECÇÃO =====

app.post('/api/prospects/search', requireAuth, async (req, res) => {
  if (!GOOGLE_PLACES_API_KEY) {
    return res.status(503).json({
      error: 'Google Places API não configurada. Defina GOOGLE_PLACES_API_KEY nas variáveis de ambiente.'
    });
  }

  const { niche, city, state, country, pagetoken } = req.body || {};
  if (!niche) {
    return res.status(400).json({ error: 'Nicho é obrigatório.' });
  }

  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) {
    return res.status(404).json({ error: 'Empresa não encontrada.' });
  }

  const locationParts = [city, state, country || 'Brasil'].filter(Boolean);
  const locationStr = locationParts.join(', ');
  const query = `${niche} em ${locationStr}`;

  const params = new URLSearchParams({ query, key: GOOGLE_PLACES_API_KEY, language: 'pt-BR' });
  if (pagetoken) params.set('pagetoken', pagetoken);

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      return res.status(502).json({
        error: `Google Places API: ${data.status}${data.error_message ? ' - ' + data.error_message : ''}`
      });
    }

    const savedPlaceIds = new Set(
      db.prospects
        .filter((p) => p.company_id === companyId)
        .map((p) => p.place_id)
        .filter(Boolean)
    );

    const results = (data.results || []).map((place) => ({
      place_id: place.place_id,
      name: place.name,
      address: place.formatted_address || '',
      rating: place.rating || null,
      total_ratings: place.user_ratings_total || 0,
      types: (place.types || []).filter((t) => !['point_of_interest', 'establishment'].includes(t)).slice(0, 3),
      niche,
      location: locationStr,
      already_saved: savedPlaceIds.has(place.place_id)
    }));

    return res.json({
      query,
      total: results.length,
      next_page_token: data.next_page_token || null,
      data: results
    });
  } catch (error) {
    return res.status(502).json({ error: `Erro ao consultar Google Places: ${error.message}` });
  }
});

app.get('/api/prospects', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const { niche, location } = req.query;
  let list = db.prospects.filter((p) => p.company_id === companyId && p.status !== 'converted');
  if (niche) list = list.filter((p) => p.niche === niche);
  if (location) list = list.filter((p) => (p.location || '').toLowerCase().includes(location.toLowerCase()));

  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return res.json({ total: list.length, data: list });
});

app.post('/api/prospects', requireAuth, (req, res) => {
  const { place_id, name, address, phone, niche, location, rating, total_ratings, types } = req.body || {};
  if (!name || !niche) {
    return res.status(400).json({ error: 'name e niche são obrigatórios.' });
  }

  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  if (place_id) {
    const exists = db.prospects.find((p) => p.company_id === companyId && p.place_id === place_id && p.status !== 'converted');
    if (exists) return res.status(409).json({ error: 'Prospect já salvo.' });
  }

  const now = new Date().toISOString();
  const id = uuidv4();
  db.prospects.push({
    id,
    company_id: companyId,
    place_id: place_id || null,
    name: sanitizeText(name),
    address: sanitizeText(address || ''),
    phone: sanitizeText(phone || ''),
    niche: sanitizeText(niche),
    location: sanitizeText(location || ''),
    rating: rating || null,
    total_ratings: total_ratings || 0,
    types: types || [],
    status: 'prospect',
    notes: '',
    created_at: now,
    updated_at: now
  });
  saveDb(db);
  return res.status(201).json({ id, message: 'Prospect salvo.' });
});

app.delete('/api/prospects/:id', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const idx = db.prospects.findIndex((p) => p.id === req.params.id && p.company_id === companyId);
  if (idx === -1) return res.status(404).json({ error: 'Prospect não encontrado.' });

  db.prospects.splice(idx, 1);
  saveDb(db);
  return res.json({ message: 'Prospect removido.' });
});

app.post('/api/prospects/:id/convert', requireAuth, (req, res) => {
  const { phone, email, source, consent } = req.body || {};
  if (consent !== true) {
    return res.status(400).json({ error: 'consent=true é obrigatório para converter prospect em lead.' });
  }

  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const prospect = db.prospects.find((p) => p.id === req.params.id && p.company_id === companyId);
  if (!prospect) return res.status(404).json({ error: 'Prospect não encontrado.' });

  const contactPhone = sanitizeText(phone || prospect.phone || '');
  const contactEmail = sanitizeText(email || '');
  if (!contactPhone && !contactEmail) {
    return res.status(400).json({ error: 'Informe ao menos telefone ou e-mail para converter.' });
  }

  const permission = companyCanAddLead(db, companyId);
  if (!permission.allowed) return res.status(403).json({ error: permission.reason });

  const now = new Date().toISOString();
  const leadId = uuidv4();
  db.leads.push({
    id: leadId,
    company_id: companyId,
    full_name: prospect.name,
    email: contactEmail || null,
    phone: contactPhone || null,
    niche: prospect.niche,
    source: sanitizeText(source || `Prospecção Google: ${prospect.location}`),
    consent: 1,
    consent_at: now,
    opt_out: 0,
    created_at: now
  });

  if (permission.license && permission.license.leads_limit !== null && permission.license.leads_limit !== undefined) {
    permission.license.leads_used = Number(permission.license.leads_used || 0) + 1;
  }

  prospect.status = 'converted';
  prospect.lead_id = leadId;
  prospect.updated_at = now;
  saveDb(db);

  return res.json({ message: 'Prospect convertido em lead com sucesso.', leadId });
});

// ===== fim prospecção =====

// ===== Configurações WhatsApp por empresa =====

function maskSecret(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}${'*'.repeat(s.length - 8)}${s.slice(-4)}`;
}

/**
 * GET /api/settings/whatsapp
 * Retorna a configuração WhatsApp da empresa logada (valores mascarados).
 */
app.get('/api/settings/whatsapp', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const cfg = db.whatsappConfigs.find((c) => c.company_id === companyId);

  if (!cfg) {
    return res.json({
      configured: false,
      phone_number_id: null,
      business_account_id: null,
      access_token_set: false,
      source: null
    });
  }

  return res.json({
    configured: !!(cfg.access_token && cfg.phone_number_id),
    phone_number_id: maskSecret(cfg.phone_number_id),
    business_account_id: maskSecret(cfg.business_account_id),
    access_token_set: !!cfg.access_token,
    access_token_preview: maskSecret(cfg.access_token),
    api_version: cfg.api_version || WHATSAPP_GRAPH_API_VERSION,
    updated_at: cfg.updated_at,
    source: 'company'
  });
});

/**
 * PUT /api/settings/whatsapp
 * Salva ou atualiza as credenciais WhatsApp da empresa logada.
 * Body: { accessToken, phoneNumberId, businessAccountId, apiVersion }
 */
app.put('/api/settings/whatsapp', requireAuth, (req, res) => {
  const { accessToken, phoneNumberId, businessAccountId, apiVersion } = req.body || {};

  if (!accessToken || !phoneNumberId) {
    return res.status(400).json({ error: 'accessToken e phoneNumberId são obrigatórios.' });
  }

  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const now = new Date().toISOString();
  const existing = db.whatsappConfigs.find((c) => c.company_id === companyId);

  if (existing) {
    existing.access_token = String(accessToken).trim();
    existing.phone_number_id = String(phoneNumberId).trim();
    existing.business_account_id = businessAccountId ? String(businessAccountId).trim() : (existing.business_account_id || null);
    existing.api_version = apiVersion ? String(apiVersion).trim() : (existing.api_version || WHATSAPP_GRAPH_API_VERSION);
    existing.updated_at = now;
  } else {
    db.whatsappConfigs.push({
      id: uuidv4(),
      company_id: companyId,
      access_token: String(accessToken).trim(),
      phone_number_id: String(phoneNumberId).trim(),
      business_account_id: businessAccountId ? String(businessAccountId).trim() : null,
      api_version: apiVersion ? String(apiVersion).trim() : WHATSAPP_GRAPH_API_VERSION,
      created_at: now,
      updated_at: now
    });
  }

  appendSecurityAudit(db, req, {
    event_type: 'whatsapp_config_updated',
    status: 'success',
    actor_user_id: req.auth.user.id,
    actor_email: req.auth.user.email,
    company_id: companyId
  });

  saveDb(db);

  return res.json({ message: 'Configuração WhatsApp salva com sucesso.' });
});

/**
 * DELETE /api/settings/whatsapp
 * Remove as credenciais WhatsApp da empresa (volta para o fallback de ambiente).
 */
app.delete('/api/settings/whatsapp', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  db.whatsappConfigs = db.whatsappConfigs.filter((c) => c.company_id !== companyId);
  saveDb(db);
  return res.json({ message: 'Configuração WhatsApp removida.' });
});

/**
 * POST /api/settings/whatsapp/test
 * Testa as credenciais WhatsApp da empresa enviando mensagem de teste.
 * Body: { phone: "+5511999999999", message?: "..." }
 */
app.post('/api/settings/whatsapp/test', requireAuth, async (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const creds = getCompanyWhatsAppCreds(db, companyId);
  if (!creds) {
    return res.status(400).json({ error: 'Nenhuma configuração WhatsApp encontrada para esta empresa.' });
  }

  const { phone, message } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Informe o campo "phone".' });

  const recipient = normalizeWhatsAppRecipient(phone);
  if (!recipient) {
    return res.status(400).json({ error: `Número inválido: "${phone}". Use formato internacional, ex: +5511999999999` });
  }

  try {
    const result = await sendWhatsAppTextMessage({
      to: recipient,
      message: message || 'Mensagem de teste enviada pelo LeadFlow Nexus Pro ✅',
      creds
    });

    if (result.ok) {
      return res.json({ success: true, recipient, source: creds.source, providerResponse: result.providerResponse });
    }
    return res.status(502).json({ success: false, recipient, status: result.status, providerResponse: result.providerResponse });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/settings/whatsapp/templates
 * Lista templates aprovados usando as credenciais da empresa logada.
 */
app.get('/api/settings/whatsapp/templates', requireAuth, async (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const creds = getCompanyWhatsAppCreds(db, companyId);
  if (!creds) {
    return res.status(400).json({ error: 'Configure suas credenciais WhatsApp primeiro.' });
  }

  if (!creds.businessAccountId) {
    return res.status(400).json({ error: 'businessAccountId (WABA ID) não configurado. Adicione-o nas configurações WhatsApp.' });
  }

  try {
    const params = new URLSearchParams({
      fields: 'name,status,language,category,components',
      limit: '100',
      access_token: creds.accessToken
    });
    const url = `https://graph.facebook.com/${creds.apiVersion}/${creds.businessAccountId}/message_templates?${params}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({ error: `Meta API: ${data.error?.message || 'Erro ao buscar templates.'}` });
    }

    const templates = (data.data || [])
      .filter((t) => t.status === 'APPROVED')
      .map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        body: t.components?.find((c) => c.type === 'BODY')?.text || ''
      }));

    return res.json({ total: templates.length, data: templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== fim configurações WhatsApp por empresa =====

// ===== WhatsApp Cloud API – status e teste (admin) =====

/**
 * GET /api/admin/whatsapp/status
 * Retorna se a integração WhatsApp está configurada e exibe o Phone Number ID mascarado.
 */
app.get('/api/admin/whatsapp/status', requireAuth, requireAdmin, (_req, res) => {
  const configured = isWhatsAppConfigured();
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const tokenSet = !!process.env.WHATSAPP_ACCESS_TOKEN;
  return res.json({
    configured,
    phone_number_id: phoneId ? `${phoneId.slice(0, 4)}${'*'.repeat(Math.max(0, phoneId.length - 4))}` : null,
    access_token_set: tokenSet,
    api_version: WHATSAPP_GRAPH_API_VERSION
  });
});

/**
 * GET /api/admin/whatsapp/templates
 * Lista os templates aprovados cadastrados na WABA.
 * Documentação Meta: GET /<WABA_ID>/message_templates
 */
app.get('/api/admin/whatsapp/templates', requireAuth, requireAdmin, async (_req, res) => {
  if (!isWhatsAppConfigured()) {
    return res.status(400).json({ error: 'WhatsApp Cloud API não configurada.' });
  }

  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!wabaId) {
    return res.status(400).json({
      error: 'WHATSAPP_BUSINESS_ACCOUNT_ID não definido. Adicione nas variáveis de ambiente.'
    });
  }

  try {
    const params = new URLSearchParams({
      fields: 'name,status,language,category,components',
      limit: '100',
      access_token: process.env.WHATSAPP_ACCESS_TOKEN
    });
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${wabaId}/message_templates?${params}`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: `Meta API: ${data.error?.message || 'Erro ao buscar templates.'}`
      });
    }

    const templates = (data.data || [])
      .filter((t) => t.status === 'APPROVED')
      .map((t) => ({
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        body: t.components?.find((c) => c.type === 'BODY')?.text || ''
      }));

    return res.json({ total: templates.length, data: templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/campaigns/:id/batch/:batchId
 * Consulta o status de um lote de disparo (para polling frontend).
 */
app.get('/api/campaigns/:id/batch/:batchId', requireAuth, (req, res) => {
  const db = req.auth.db;
  const companyId = resolveCompanyId(req, req.auth.user, db);
  if (!companyId) return res.status(404).json({ error: 'Empresa não encontrada.' });

  const batch = db.dispatchBatches.find(
    (item) => item.id === req.params.batchId && item.campaign_id === req.params.id && item.company_id === companyId
  );
  if (!batch) return res.status(404).json({ error: 'Lote não encontrado.' });

  return res.json({ batch });
});

/**
 * POST /api/admin/whatsapp/test
 * Envia uma mensagem de teste ao número informado.
 * Body: { phone: "+5511999999999", message: "Olá, teste!" }
 */
app.post('/api/admin/whatsapp/test', requireAuth, requireAdmin, async (req, res) => {
  if (!isWhatsAppConfigured()) {
    return res.status(400).json({
      error: 'WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID não estão definidos nas variáveis de ambiente do servidor.'
    });
  }

  const { phone, message } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Informe o campo "phone".' });

  const recipient = normalizeWhatsAppRecipient(phone);
  if (!recipient) {
    return res.status(400).json({ error: `Número de telefone inválido: "${phone}". Use formato internacional, ex: +5511999999999` });
  }

  try {
    const result = await sendWhatsAppTextMessage({
      to: recipient,
      message: message || 'Mensagem de teste enviada pelo LeadFlow Nexus Pro ✅'
    });

    if (result.ok) {
      return res.json({ success: true, recipient, providerResponse: result.providerResponse });
    } else {
      return res.status(502).json({
        success: false,
        recipient,
        status: result.status,
        providerResponse: result.providerResponse
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== fim WhatsApp status/teste =====

app.listen(PORT, () => {
  console.log(`LeadFlow Nexus Pro API running on http://localhost:${PORT}`);
});
