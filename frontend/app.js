const configuredApiBases = Array.isArray(window.LFN_API_BASES)
  ? window.LFN_API_BASES
  : [window.LFN_API_BASE || 'http://localhost:3333'];

const API_BASES = configuredApiBases.filter(Boolean);
const ACTIVE_API_KEY = 'lfn_active_api_base';
let activeApiBase = localStorage.getItem(ACTIVE_API_KEY) || API_BASES[0] || 'http://localhost:3333';
const TOKEN_KEY = 'lfn_token';

let session = {
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null,
  company: null
};

let pendingSaleId = null;

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const appTopbar = document.getElementById('appTopbar');
const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');
const fillDemoBtn = document.getElementById('fillDemoBtn');
const trialForm = document.getElementById('trialForm');
const trialFeedback = document.getElementById('trialFeedback');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutFeedback = document.getElementById('checkoutFeedback');
const paymentBox = document.getElementById('paymentBox');
const paymentInfo = document.getElementById('paymentInfo');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const planSelect = document.getElementById('planSelect');
const paymentMethodSelect = document.getElementById('paymentMethodSelect');
const installmentsSelect = document.getElementById('installmentsSelect');
const showRecoveryBtn = document.getElementById('showRecoveryBtn');
const hideRecoveryBtn = document.getElementById('hideRecoveryBtn');
const recoverySection = document.getElementById('recoverySection');
const recoveryFeedback = document.getElementById('recoveryFeedback');
const forgotForm = document.getElementById('forgotForm');
const resetForm = document.getElementById('resetForm');
const firstAccessSection = document.getElementById('firstAccessSection');
const firstAccessForm = document.getElementById('firstAccessForm');
const firstAccessFeedback = document.getElementById('firstAccessFeedback');
const sessionInfo = document.getElementById('sessionInfo');
const logoutBtn = document.getElementById('logoutBtn');

const metricMessages = document.getElementById('metricMessages');
const metricSent = document.getElementById('metricSent');
const metricDelivered = document.getElementById('metricDelivered');
const metricResponded = document.getElementById('metricResponded');
const metricRate = document.getElementById('metricRate');
const metricCustomers = document.getElementById('metricCustomers');
const metricActiveLicenses = document.getElementById('metricActiveLicenses');
const metricPaidSales = document.getElementById('metricPaidSales');
const metricRevenue = document.getElementById('metricRevenue');
const commercialCards = document.getElementById('commercialCards');

const companiesSection = document.getElementById('companiesSection');
const companyForm = document.getElementById('companyForm');
const companyFeedback = document.getElementById('companyFeedback');
const companiesTable = document.getElementById('companiesTable');
const companiesCount = document.getElementById('companiesCount');
const customersSection = document.getElementById('customersSection');
const customersTable = document.getElementById('customersTable');
const customersCount = document.getElementById('customersCount');
const plansSection = document.getElementById('plansSection');
const plansTable = document.getElementById('plansTable');
const plansCount = document.getElementById('plansCount');
const adminPlanForm = document.getElementById('adminPlanForm');
const planFeedback = document.getElementById('planFeedback');

const leadsCount = document.getElementById('leadsCount');
const campaignsCount = document.getElementById('campaignsCount');
const leadsTable = document.getElementById('leadsTable');
const campaignsTable = document.getElementById('campaignsTable');

const leadForm = document.getElementById('leadForm');
const campaignForm = document.getElementById('campaignForm');
const leadFeedback = document.getElementById('leadFeedback');
const campaignFeedback = document.getElementById('campaignFeedback');
const refreshAll = document.getElementById('refreshAll');

function setFeedback(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.remove('success', 'error');
  element.classList.add(isError ? 'error' : 'success');
}

function expireSessionAndReturnToLogin(message = 'Sessão expirada. Faça login novamente.') {
  localStorage.removeItem(TOKEN_KEY);
  session = { token: null, user: null, company: null };
  showLoginScreen();
  setFeedback(loginFeedback, message, true);
}

async function http(path, options = {}) {
  const headersBase = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session.token) {
    headersBase.Authorization = `Bearer ${session.token}`;
  }

  const { response, body } = await requestWithFallback(path, {
    ...options,
    headers: headersBase
  });

  if (response.status === 401 && session.token) {
    const shouldExpire = body.sessionExpired || path !== '/api/auth/login';
    if (shouldExpire) {
      expireSessionAndReturnToLogin(body.error || 'Sessão inválida. Faça login novamente.');
    }
  }

  if (!response.ok) {
    throw new Error(body.error || 'Falha na requisição');
  }

  return body;
}

function orderedApiBases() {
  return [activeApiBase, ...API_BASES.filter((base) => base !== activeApiBase)].filter(Boolean);
}

async function requestWithFallback(path, options = {}) {
  const headersBase = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const orderedBases = orderedApiBases();
  let lastNetworkError = null;

  for (const base of orderedBases) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: headersBase,
        ...options
      });

      const body = await response.json().catch(() => ({}));
      activeApiBase = base;
      localStorage.setItem(ACTIVE_API_KEY, base);
      return { response, body };
    } catch (error) {
      const isNetworkError = error instanceof TypeError;
      if (isNetworkError) {
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastNetworkError) {
    throw new Error('Falha de conexão com a API (Failed to fetch). Atualize a página e tente novamente.');
  }

  throw new Error('Falha de conexão com a API.');
}

function isAdmin() {
  return session.user?.role === 'admin';
}

function moneyBRL(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function renderPlans(plans) {
  if (!planSelect) return;

  const options = plans
    .filter((plan) => plan.code !== 'trial')
    .map(
      (plan) =>
        `<option value="${plan.id}">${plan.name} • ${moneyBRL(plan.price_brl)} • ${plan.leads_limit} leads</option>`
    )
    .join('');

  planSelect.innerHTML = '<option value="">Selecione o plano</option>' + options;
}

function renderCommercialOverview(overview) {
  if (!overview?.totals) return;
  metricCustomers.textContent = overview.totals.customers ?? 0;
  metricActiveLicenses.textContent = overview.totals.active_licenses ?? 0;
  metricPaidSales.textContent = overview.totals.paid_sales ?? 0;
  metricRevenue.textContent = moneyBRL(overview.totals.total_revenue_brl ?? 0);
}

function renderCustomers(rows) {
  if (!customersTable || !customersCount) return;
  customersCount.textContent = `${rows.length} registros`;

  if (!rows.length) {
    customersTable.innerHTML = '<tr><td colspan="6">Sem clientes compradores.</td></tr>';
    return;
  }

  customersTable.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${row.company_name}</td>
          <td>${row.login_email || '-'}</td>
          <td>${row.plan_name || '-'}</td>
          <td>${row.license_status || '-'}</td>
          <td>${row.leads_used}/${row.leads_limit ?? '∞'}</td>
          <td>${row.last_sale_status || '-'} ${row.last_sale_amount_brl ? '• ' + moneyBRL(row.last_sale_amount_brl) : ''}</td>
        </tr>
      `
    )
    .join('');
}

function renderAdminPlans(plans) {
  if (!plansTable || !plansCount) return;
  plansCount.textContent = `${plans.length} registros`;

  if (!plans.length) {
    plansTable.innerHTML = '<tr><td colspan="7">Sem planos cadastrados.</td></tr>';
    return;
  }

  plansTable.innerHTML = plans
    .map(
      (plan) => `
        <tr>
          <td>${plan.name}</td>
          <td>${plan.code}</td>
          <td>${moneyBRL(plan.price_brl)}</td>
          <td>${plan.leads_limit ?? '∞'}</td>
          <td>${plan.duration_days} dias</td>
          <td>${plan.active ? 'Ativo' : 'Inativo'}</td>
          <td><button class="btn secondary" data-toggle-plan="${plan.id}">${plan.active ? 'Desativar' : 'Ativar'}</button></td>
        </tr>
      `
    )
    .join('');

  plansTable.querySelectorAll('[data-toggle-plan]').forEach((button) => {
    button.addEventListener('click', async () => {
      const planId = button.getAttribute('data-toggle-plan');
      const target = plans.find((item) => item.id === planId);
      if (!target) return;

      try {
        await http(`/api/admin/plans/${planId}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !target.active })
        });
        setFeedback(planFeedback, `Plano ${target.name} atualizado.`);
        await refreshDashboard();
      } catch (error) {
        setFeedback(planFeedback, error.message, true);
      }
    });
  });
}

async function loadPublicPlans() {
  try {
    const { response, body } = await requestWithFallback('/api/public/plans');
    if (!response.ok) return;
    const result = body;
    renderPlans(result.data || []);
  } catch (_error) {
  }
}

function enablePasswordVisibilityToggles() {
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  passwordInputs.forEach((input) => {
    if (input.dataset.toggleAttached === 'true') return;
    input.dataset.toggleAttached = 'true';

    const wrapper = document.createElement('div');
    wrapper.className = 'password-wrap';

    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn secondary password-toggle';
    button.textContent = 'Mostrar';
    button.addEventListener('click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? 'Mostrar' : 'Ocultar';
    });

    wrapper.appendChild(button);
  });
}

function setRecoveryVisible(visible) {
  if (!recoverySection) return;
  recoverySection.classList.toggle('hidden', !visible);
}

function setFirstAccessVisible(visible) {
  if (!firstAccessSection) return;
  firstAccessSection.classList.toggle('hidden', !visible);
}

function renderCompanies(companies) {
  if (!companiesTable || !companiesCount) return;

  companiesCount.textContent = `${companies.length} registros`;

  if (!companies.length) {
    companiesTable.innerHTML = '<tr><td colspan="3">Sem empresas.</td></tr>';
    return;
  }

  companiesTable.innerHTML = companies
    .map(
      (company) => `
        <tr>
          <td>${company.name}</td>
          <td>${company.owner_name}</td>
          <td>${company.slug}</td>
        </tr>
      `
    )
    .join('');
}

function renderLeads(leads) {
  leadsCount.textContent = `${leads.length} registros`;

  if (!leads.length) {
    leadsTable.innerHTML = '<tr><td colspan="4">Sem leads ativos.</td></tr>';
    return;
  }

  leadsTable.innerHTML = leads
    .map((lead) => {
      const contact = [lead.email, lead.phone].filter(Boolean).join(' / ');
      return `
        <tr>
          <td>${lead.full_name}</td>
          <td>${lead.niche}</td>
          <td>${contact || '-'}</td>
          <td>${lead.source}</td>
        </tr>
      `;
    })
    .join('');
}

function renderCampaigns(campaigns) {
  campaignsCount.textContent = `${campaigns.length} registros`;

  if (!campaigns.length) {
    campaignsTable.innerHTML = '<tr><td colspan="4">Sem campanhas.</td></tr>';
    return;
  }

  campaignsTable.innerHTML = campaigns
    .map(
      (campaign) => `
        <tr>
          <td>${campaign.name}</td>
          <td>${campaign.niche}</td>
          <td>${campaign.channel}</td>
          <td><button class="btn" data-send-id="${campaign.id}">Disparar</button></td>
        </tr>
      `
    )
    .join('');

  campaignsTable.querySelectorAll('[data-send-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const campaignId = button.getAttribute('data-send-id');
      button.disabled = true;
      button.textContent = 'Enviando...';
      try {
        const result = await http(`/api/campaigns/${campaignId}/send`, { method: 'POST' });
        setFeedback(campaignFeedback, `Disparo concluído: ${result.leadsProcessed} leads processados.`);
        await refreshDashboard();
      } catch (error) {
        setFeedback(campaignFeedback, error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Disparar';
      }
    });
  });
}

function renderSummary(summary) {
  const totals = summary.totals || {};
  metricMessages.textContent = totals.total_messages ?? 0;
  metricSent.textContent = totals.total_sent ?? 0;
  metricDelivered.textContent = totals.total_delivered ?? 0;
  metricResponded.textContent = totals.total_responded ?? 0;
  metricRate.textContent = `${summary.responseRate ?? 0}%`;
}

async function refreshDashboard() {
  const requests = [
    http('/api/leads'),
    http('/api/campaigns'),
    http('/api/reports/summary'),
    http('/api/client/license')
  ];

  if (isAdmin()) {
    requests.push(http('/api/companies'));
    requests.push(http('/api/admin/commercial/overview'));
    requests.push(http('/api/admin/customers'));
    requests.push(http('/api/admin/plans'));
  }

  const [leads, campaigns, summary, licenseInfo, companies, commercialOverview, customers, adminPlans] = await Promise.all(
    requests
  );

  renderLeads(leads.data || []);
  renderCampaigns(campaigns.data || []);
  renderSummary(summary);

  if (licenseInfo?.license && !isAdmin()) {
    const remaining =
      licenseInfo.license.remaining_leads === null || licenseInfo.license.remaining_leads === undefined
        ? '∞'
        : licenseInfo.license.remaining_leads;
    setFeedback(campaignFeedback, `Plano: ${licenseInfo.plan?.name || '-'} • Leads restantes: ${remaining}`);
  }

  if (isAdmin()) {
    renderCompanies(companies?.data || []);
    renderCommercialOverview(commercialOverview || {});
    renderCustomers(customers?.data || []);
    renderAdminPlans(adminPlans?.data || []);
  }
}

function showAuthenticatedScreens() {
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  appTopbar.classList.remove('hidden');
  sessionInfo.textContent = `${session.user.full_name} • ${session.user.role} • ${session.company?.name || ''}`;

  if (isAdmin()) {
    companiesSection?.classList.remove('hidden');
    commercialCards?.classList.remove('hidden');
    customersSection?.classList.remove('hidden');
    plansSection?.classList.remove('hidden');
  } else {
    companiesSection?.classList.add('hidden');
    commercialCards?.classList.add('hidden');
    customersSection?.classList.add('hidden');
    plansSection?.classList.add('hidden');
  }
}

function showLoginScreen() {
  authScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
  appTopbar.classList.add('hidden');
  setRecoveryVisible(false);
  loadPublicPlans();
}

async function loadSession() {
  if (!session.token) {
    showLoginScreen();
    return;
  }

  try {
    const me = await http('/api/auth/me');
    session.user = me.user;
    session.company = me.company;
    showAuthenticatedScreens();
    await refreshDashboard();
  } catch (_error) {
    localStorage.removeItem(TOKEN_KEY);
    session = { token: null, user: null, company: null };
    showLoginScreen();
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);

  try {
    const payload = {
      email: formData.get('email')?.toString().trim(),
      password: formData.get('password')?.toString()
    };

    const { response, body: result } = await requestWithFallback('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      if (result.requiresPasswordChange) {
        setFirstAccessVisible(true);
        setRecoveryVisible(false);

        const emailInput = firstAccessForm?.querySelector('input[name="email"]');
        const tokenInput = firstAccessForm?.querySelector('input[name="changeToken"]');
        if (emailInput) emailInput.value = payload.email || '';
        if (tokenInput) tokenInput.value = result.changeToken || '';
        setFeedback(firstAccessFeedback, 'Primeiro acesso: defina sua nova senha para continuar.');
        setFeedback(loginFeedback, 'Troca obrigatória de senha detectada.', true);
        return;
      }

      if (result.lockedUntil) {
        const lockDate = new Date(result.lockedUntil);
        const lockTime = Number.isNaN(lockDate.getTime())
          ? null
          : lockDate.toLocaleString('pt-BR');
        throw new Error(
          lockTime
            ? `Conta temporariamente bloqueada por tentativas excedidas. Tente novamente após ${lockTime}.`
            : 'Conta temporariamente bloqueada por tentativas excedidas.'
        );
      }

      throw new Error(result.error || 'Falha no login');
    }

    session.token = result.token;
    session.user = result.user;
    localStorage.setItem(TOKEN_KEY, result.token);

    const me = await http('/api/auth/me');
    session.user = me.user;
    session.company = me.company;

    setFeedback(loginFeedback, 'Login realizado com sucesso.');
    setFirstAccessVisible(false);
    setRecoveryVisible(false);
    loginForm.reset();
    showAuthenticatedScreens();
    await refreshDashboard();
  } catch (error) {
    setFeedback(loginFeedback, error.message, true);
  }
});

firstAccessForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(firstAccessForm);

  try {
    await http('/api/auth/first-access/change-password', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email')?.toString().trim(),
        changeToken: formData.get('changeToken')?.toString().trim(),
        newPassword: formData.get('newPassword')?.toString()
      })
    });

    setFeedback(firstAccessFeedback, 'Senha inicial alterada. Faça login com a nova senha.');
    firstAccessForm.reset();
    setFirstAccessVisible(false);
  } catch (error) {
    setFeedback(firstAccessFeedback, error.message, true);
  }
});

showRecoveryBtn?.addEventListener('click', () => {
  setRecoveryVisible(true);
  setFirstAccessVisible(false);
});

hideRecoveryBtn?.addEventListener('click', () => {
  setRecoveryVisible(false);
});

forgotForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(forgotForm);

  try {
    const result = await http('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email')?.toString().trim()
      })
    });

    const resetTokenInput = resetForm?.querySelector('input[name="resetToken"]');
    const resetEmailInput = resetForm?.querySelector('input[name="email"]');
    if (resetTokenInput && result.resetToken) {
      resetTokenInput.value = result.resetToken;
    }
    if (resetEmailInput) {
      resetEmailInput.value = formData.get('email')?.toString().trim() || '';
    }

    setFeedback(
      recoveryFeedback,
      result.resetToken
        ? `Token gerado: ${result.resetToken}`
        : 'Se o e-mail existir, o token de recuperação foi gerado.'
    );
  } catch (error) {
    setFeedback(recoveryFeedback, error.message, true);
  }
});

resetForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(resetForm);

  try {
    await http('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        email: formData.get('email')?.toString().trim(),
        resetToken: formData.get('resetToken')?.toString().trim(),
        newPassword: formData.get('newPassword')?.toString()
      })
    });

    setFeedback(recoveryFeedback, 'Senha redefinida com sucesso. Faça login com a nova senha.');
    resetForm.reset();
  } catch (error) {
    setFeedback(recoveryFeedback, error.message, true);
  }
});

fillDemoBtn?.addEventListener('click', () => {
  const emailInput = loginForm?.querySelector('input[name="email"]');
  const passwordInput = loginForm?.querySelector('input[name="password"]');
  if (emailInput) emailInput.value = 'demo@leadflownexuspro.com';
  if (passwordInput) passwordInput.value = 'Demo@123';
  setFeedback(loginFeedback, 'Credencial de demonstração preenchida.');
});

paymentMethodSelect?.addEventListener('change', () => {
  const isCard = paymentMethodSelect.value === 'card';
  installmentsSelect.disabled = !isCard;
  if (!isCard) installmentsSelect.value = '1';
});

trialForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(trialForm);

  try {
    const { response, body } = await requestWithFallback('/api/public/trial/register', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name')?.toString().trim(),
        ownerName: formData.get('ownerName')?.toString().trim(),
        slug: formData.get('slug')?.toString().trim(),
        adminEmail: formData.get('adminEmail')?.toString().trim(),
        adminPassword: formData.get('adminPassword')?.toString()
      })
    });

    if (!response.ok) {
      throw new Error(body.error || 'Falha ao criar teste grátis.');
    }

    setFeedback(
      trialFeedback,
      `Teste criado. Válido até ${new Date(body.trial.expires_at).toLocaleDateString('pt-BR')} com ${body.trial.leads_limit} leads.`
    );
    trialForm.reset();
  } catch (error) {
    setFeedback(trialFeedback, error.message, true);
  }
});

checkoutForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(checkoutForm);

  try {
    const { response, body } = await requestWithFallback('/api/public/register-checkout', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.get('name')?.toString().trim(),
        ownerName: formData.get('ownerName')?.toString().trim(),
        slug: formData.get('slug')?.toString().trim(),
        adminEmail: formData.get('adminEmail')?.toString().trim(),
        adminPassword: formData.get('adminPassword')?.toString(),
        planId: formData.get('planId')?.toString(),
        paymentMethod: formData.get('paymentMethod')?.toString(),
        installments: Number(formData.get('installments') || 1)
      })
    });

    if (!response.ok) {
      throw new Error(body.error || 'Falha no cadastro para compra.');
    }

    pendingSaleId = body.saleId;
    paymentBox?.classList.remove('hidden');

    const text =
      body.payment.method === 'pix'
        ? `Pix: ${body.payment.pix_key} • Valor: ${moneyBRL(body.payment.amount_brl)}`
        : `Cartão: ${body.payment.installments}x • Valor: ${moneyBRL(body.payment.amount_brl)}`;

    if (paymentInfo) {
      paymentInfo.textContent = text;
    }

    setFeedback(checkoutFeedback, 'Cadastro concluído. Finalize o pagamento para ativar a licença.');
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

confirmPaymentBtn?.addEventListener('click', async () => {
  if (!pendingSaleId) {
    setFeedback(checkoutFeedback, 'Nenhuma venda pendente para confirmar.', true);
    return;
  }

  try {
    const { response: result, body } = await requestWithFallback(`/api/public/checkout/${pendingSaleId}/confirm`, {
      method: 'POST'
    });

    if (!result.ok) {
      throw new Error(body.error || 'Falha ao confirmar pagamento.');
    }

    setFeedback(checkoutFeedback, 'Pagamento confirmado. Sua licença foi ativada e o login já está liberado.');
    pendingSaleId = null;
    paymentBox?.classList.add('hidden');
    checkoutForm?.reset();
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await http('/api/auth/logout', { method: 'POST' });
  } catch (_error) {
  } finally {
    localStorage.removeItem(TOKEN_KEY);
    session = { token: null, user: null, company: null };
    showLoginScreen();
  }
});

leadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(leadForm);
  const payload = {
    fullName: formData.get('fullName')?.toString().trim(),
    email: formData.get('email')?.toString().trim() || null,
    phone: formData.get('phone')?.toString().trim() || null,
    niche: formData.get('niche')?.toString().trim(),
    source: formData.get('source')?.toString().trim(),
    consent: formData.get('consent') === 'on'
  };

  try {
    await http('/api/leads', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback(leadFeedback, 'Lead cadastrado com sucesso.');
    leadForm.reset();
    await refreshDashboard();
  } catch (error) {
    setFeedback(leadFeedback, error.message, true);
  }
});

campaignForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(campaignForm);
  const payload = {
    name: formData.get('name')?.toString().trim(),
    niche: formData.get('niche')?.toString().trim(),
    channel: formData.get('channel')?.toString().trim(),
    messageTemplate: formData.get('messageTemplate')?.toString().trim()
  };

  try {
    await http('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback(campaignFeedback, 'Campanha criada com sucesso.');
    campaignForm.reset();
    await refreshDashboard();
  } catch (error) {
    setFeedback(campaignFeedback, error.message, true);
  }
});

companyForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(companyForm);

  const payload = {
    name: formData.get('name')?.toString().trim(),
    ownerName: formData.get('ownerName')?.toString().trim(),
    slug: formData.get('slug')?.toString().trim(),
    adminEmail: formData.get('adminEmail')?.toString().trim(),
    adminPassword: formData.get('adminPassword')?.toString()
  };

  try {
    const result = await http('/api/companies', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    setFeedback(
      companyFeedback,
      `Cliente criado: ${result.company.name}. Login: ${result.clientAdmin.email}`
    );
    companyForm.reset();
    await refreshDashboard();
  } catch (error) {
    setFeedback(companyFeedback, error.message, true);
  }
});

adminPlanForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(adminPlanForm);

  const payload = {
    name: formData.get('name')?.toString().trim(),
    code: formData.get('code')?.toString().trim(),
    price_brl: Number(formData.get('price_brl') || 0),
    billing_cycle: formData.get('billing_cycle')?.toString().trim(),
    leads_limit: formData.get('leads_limit')?.toString().trim() || null,
    duration_days: Number(formData.get('duration_days') || 30),
    active: formData.get('active') === 'on'
  };

  try {
    await http('/api/admin/plans', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    setFeedback(planFeedback, 'Plano criado com sucesso.');
    adminPlanForm.reset();
    await refreshDashboard();
  } catch (error) {
    setFeedback(planFeedback, error.message, true);
  }
});

refreshAll.addEventListener('click', async () => {
  try {
    await refreshDashboard();
    setFeedback(campaignFeedback, 'Dados atualizados.');
  } catch (error) {
    setFeedback(campaignFeedback, error.message, true);
  }
});

installmentsSelect && (installmentsSelect.disabled = true);
enablePasswordVisibilityToggles();
loadPublicPlans();
loadSession();
