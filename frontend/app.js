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
let checkoutStep = 1;

const authScreen = document.getElementById('authScreen');
const appScreen = document.getElementById('appScreen');
const appTopbar = document.getElementById('appTopbar');
const loginForm = document.getElementById('loginForm');
const loginFeedback = document.getElementById('loginFeedback');
const fillDemoBtn = document.getElementById('fillDemoBtn');
const checkoutForm = document.getElementById('checkoutForm');
const checkoutFeedback = document.getElementById('checkoutFeedback');
const paymentBox = document.getElementById('paymentBox');
const paymentInfo = document.getElementById('paymentInfo');
const confirmPaymentBtn = document.getElementById('confirmPaymentBtn');
const checkoutReview = document.getElementById('checkoutReview');
const planSelect = document.getElementById('planSelect');
const paymentMethodSelect = document.getElementById('paymentMethodSelect');
const installmentsSelect = document.getElementById('installmentsSelect');
const checkoutStepBlocks = Array.from(document.querySelectorAll('.checkout-step'));
const checkoutIndicators = Array.from(document.querySelectorAll('[data-step-indicator]'));
const checkoutNext1 = document.getElementById('checkoutNext1');
const checkoutNext2 = document.getElementById('checkoutNext2');
const checkoutNext3 = document.getElementById('checkoutNext3');
const checkoutBack2 = document.getElementById('checkoutBack2');
const checkoutBack3 = document.getElementById('checkoutBack3');
const checkoutBack4 = document.getElementById('checkoutBack4');
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
const generateReportBtn = document.getElementById('generateReportBtn');
const reportFeedback = document.getElementById('reportFeedback');
const reportsTable = document.getElementById('reportsTable');
const reportsCount = document.getElementById('reportsCount');
const dispatchHistoryTable  = document.getElementById('dispatchHistoryTable');
const dispatchHistoryCount  = document.getElementById('dispatchHistoryCount');

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

// ===== Template WhatsApp — canal e busca =====
const campaignChannelSelect = document.getElementById('campaignChannelSelect');
const whatsappTemplateFields = document.getElementById('whatsappTemplateFields');
const fetchTemplatesBtn = document.getElementById('fetchTemplatesBtn');
const templatePickerSelect = document.getElementById('templatePickerSelect');
const templateNameInput = document.getElementById('templateNameInput');
const templateLanguageInput = document.getElementById('templateLanguageInput');

campaignChannelSelect?.addEventListener('change', () => {
  const isWhatsApp = campaignChannelSelect.value === 'whatsapp';
  whatsappTemplateFields?.classList.toggle('hidden', !isWhatsApp);
});

fetchTemplatesBtn?.addEventListener('click', async () => {
  fetchTemplatesBtn.disabled = true;
  fetchTemplatesBtn.textContent = 'Buscando…';
  try {
    const result = await http('/api/admin/whatsapp/templates');
    const templates = result.data || [];
    if (!templates.length) {
      setFeedback(campaignFeedback, 'Nenhum template aprovado encontrado na WABA.', true);
      return;
    }
    templatePickerSelect.innerHTML =
      '<option value="">— Selecione um template —</option>' +
      templates
        .map(
          (t) =>
            `<option value="${t.name}" data-lang="${t.language}">${t.name} (${t.language}) — ${t.body.slice(0, 60)}${t.body.length > 60 ? '…' : ''}</option>`
        )
        .join('');
    templatePickerSelect.classList.remove('hidden');
  } catch (err) {
    setFeedback(campaignFeedback, `Erro ao buscar templates: ${err.message}`, true);
  } finally {
    fetchTemplatesBtn.disabled = false;
    fetchTemplatesBtn.textContent = 'Buscar';
  }
});

templatePickerSelect?.addEventListener('change', () => {
  const selected = templatePickerSelect.options[templatePickerSelect.selectedIndex];
  if (selected?.value) {
    if (templateNameInput) templateNameInput.value = selected.value;
    if (templateLanguageInput) templateLanguageInput.value = selected.dataset.lang || 'pt_BR';
  }
});
// ===== fim template WhatsApp =====

// ===== Modal de disparo =====
const dispatchModalTitle = document.getElementById('dispatchModalTitle');
const dispatchModalClose = document.getElementById('dispatchModalClose');
const dispatchSelectAll = document.getElementById('dispatchSelectAll');
const dispatchDeselectAll = document.getElementById('dispatchDeselectAll');
const dispatchSelectedCount = document.getElementById('dispatchSelectedCount');
const dispatchLeadList = document.getElementById('dispatchLeadList');
const dispatchConfirmBtn = document.getElementById('dispatchConfirmBtn');
const dispatchCancelBtn = document.getElementById('dispatchCancelBtn');
const dispatchModalFeedback = document.getElementById('dispatchModalFeedback');

// ===== DOM Prospecção =====
const prospectSearchForm    = document.getElementById('prospectSearchForm');
const prospectNicheEl       = document.getElementById('prospectNiche');
const prospectCityEl        = document.getElementById('prospectCity');
const prospectStateEl       = document.getElementById('prospectState');
const prospectCountryEl     = document.getElementById('prospectCountry');
const prospectSearchFeedback = document.getElementById('prospectSearchFeedback');
const prospectResultsPanel  = document.getElementById('prospectResultsPanel');
const prospectResultsTitle  = document.getElementById('prospectResultsTitle');
const prospectResultsCount  = document.getElementById('prospectResultsCount');
const prospectResultsList   = document.getElementById('prospectResultsList');
const prospectLoadMore      = document.getElementById('prospectLoadMore');
const prospectsTable        = document.getElementById('prospectsTable');
const prospectsCount        = document.getElementById('prospectsCount');

let _prospectNextPageToken = null;
let _lastProspectQuery     = {};

let _dispatchCampaignId = null;
let _dispatchCampaignName = '';

function closeDispatchModal() {
  dispatchModal.classList.add('hidden');
  _dispatchCampaignId = null;
  _dispatchCampaignName = '';
  dispatchLeadList.innerHTML = '';
  dispatchModalFeedback.textContent = '';
  dispatchConfirmBtn.disabled = true;
  dispatchConfirmBtn.textContent = 'Confirmar disparo';
}

function updateDispatchCount() {
  const checked = dispatchLeadList.querySelectorAll('input[type="checkbox"]:checked').length;
  dispatchSelectedCount.textContent = `${checked} selecionado${checked !== 1 ? 's' : ''}`;
  dispatchConfirmBtn.disabled = checked === 0;
}

dispatchModalClose.addEventListener('click', closeDispatchModal);
dispatchCancelBtn.addEventListener('click', closeDispatchModal);
dispatchModal.addEventListener('click', (e) => { if (e.target === dispatchModal) closeDispatchModal(); });

dispatchSelectAll.addEventListener('click', () => {
  dispatchLeadList.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = true; });
  updateDispatchCount();
});

dispatchDeselectAll.addEventListener('click', () => {
  dispatchLeadList.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
  updateDispatchCount();
});

dispatchConfirmBtn.addEventListener('click', async () => {
  if (!_dispatchCampaignId) return;
  const checked = [...dispatchLeadList.querySelectorAll('input[type="checkbox"]:checked')];
  const leadIds = checked.map((cb) => cb.value);
  if (!leadIds.length) return;

  dispatchConfirmBtn.disabled = true;
  dispatchConfirmBtn.textContent = 'Agendando…';
  dispatchModalFeedback.textContent = '';

  try {
    const result = await http(`/api/campaigns/${_dispatchCampaignId}/send`, {
      method: 'POST',
      body: JSON.stringify({ leadIds })
    });

    // API retorna 202: disparo está em segundo plano
    const skippedNote = result.leadsSkipped > 0 ? ` (${result.leadsSkipped} já receberam esta campanha)` : '';
    const modeNote = result.dispatchMode === 'whatsapp_template'
      ? ' via template WhatsApp'
      : result.dispatchMode === 'whatsapp_text'
        ? ' via WhatsApp (texto livre)'
        : ' (simulação)';

    setFeedback(
      dispatchModalFeedback,
      `Disparo em andamento${modeNote}: ${result.leadsTotal} leads${skippedNote}. Acompanhe no histórico de disparos.`
    );
    setFeedback(
      campaignFeedback,
      `Campanha "${_dispatchCampaignName}" disparada${modeNote} para ${result.leadsTotal} leads.${skippedNote}`
    );

    await refreshDashboard();
    setTimeout(closeDispatchModal, 3500);
  } catch (error) {
    setFeedback(dispatchModalFeedback, error.message, true);
    dispatchConfirmBtn.disabled = false;
    dispatchConfirmBtn.textContent = 'Confirmar disparo';
  }
});

async function openDispatchModal(campaignId, campaignName) {
  _dispatchCampaignId = campaignId;
  _dispatchCampaignName = campaignName;
  dispatchModalTitle.textContent = `Disparar: ${campaignName}`;
  dispatchLeadList.innerHTML = '<p style="color:var(--muted);font-size:13px">Carregando leads...</p>';
  dispatchModalFeedback.textContent = '';
  dispatchConfirmBtn.disabled = true;
  dispatchConfirmBtn.textContent = 'Confirmar disparo';
  dispatchModal.classList.remove('hidden');

  try {
    const result = await http(`/api/campaigns/${campaignId}/leads`);
    const leads = result.data || [];

    if (!leads.length) {
      dispatchLeadList.innerHTML = '<p style="color:var(--danger);font-size:13px">Nenhum lead elegível para esta campanha.</p>';
      return;
    }

    dispatchLeadList.innerHTML = leads.map((lead) => {
      const contact = [lead.phone, lead.email].filter(Boolean).join(' / ') || '-';
      return `
        <label class="modal-lead-item">
          <input type="checkbox" value="${lead.id}" />
          <span class="modal-lead-info">
            <span class="modal-lead-name">${lead.full_name}</span>
            <span class="modal-lead-contact">${contact}</span>
          </span>
        </label>
      `;
    }).join('');

    dispatchLeadList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', updateDispatchCount);
    });

    updateDispatchCount();
  } catch (error) {
    dispatchLeadList.innerHTML = `<p style="color:var(--danger);font-size:13px">${error.message}</p>`;
  }
}
// ===== fim modal =====

function renderCampaigns(campaigns) {
  campaignsCount.textContent = `${campaigns.length} registros`;

  if (!campaigns.length) {
    campaignsTable.innerHTML = '<tr><td colspan="5">Sem campanhas.</td></tr>';
    return;
  }

  campaignsTable.innerHTML = campaigns
    .map(
      (campaign) => {
        const templateBadge = campaign.template_name
          ? `<span title="Template: ${campaign.template_name}" style="font-size:11px;background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:4px;margin-left:4px">✓ template</span>`
          : (campaign.channel === 'whatsapp'
              ? `<span title="Sem template — só funciona em janela de 24h" style="font-size:11px;background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:4px;margin-left:4px">⚠ texto livre</span>`
              : '');
        return `
        <tr>
          <td>${campaign.name}</td>
          <td>${campaign.niche}</td>
          <td>${campaign.channel}${templateBadge}</td>
          <td>${campaign.template_name ? `<span style="font-size:11px;color:var(--muted)">${campaign.template_name}</span>` : '—'}</td>
          <td><button class="btn" data-send-id="${campaign.id}" data-send-name="${campaign.name}">Disparar</button></td>
        </tr>`;
      }
    ).join('');

  campaignsTable.querySelectorAll('[data-send-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const campaignId = button.getAttribute('data-send-id');
      const campaignName = button.getAttribute('data-send-name') || 'Campanha';
      openDispatchModal(campaignId, campaignName);
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

function setCheckoutStep(targetStep) {
  checkoutStep = Math.max(1, Math.min(4, Number(targetStep) || 1));

  checkoutStepBlocks.forEach((block) => {
    const blockStep = Number(block.getAttribute('data-step') || 0);
    block.classList.toggle('hidden', blockStep !== checkoutStep);
  });

  checkoutIndicators.forEach((item) => {
    const itemStep = Number(item.getAttribute('data-step-indicator') || 0);
    item.classList.toggle('active', itemStep === checkoutStep);
  });
}

function collectCheckoutData() {
  if (!checkoutForm) return {};
  const formData = new FormData(checkoutForm);
  const value = (name) => formData.get(name)?.toString().trim() || '';

  return {
    name: value('name'),
    ownerName: value('ownerName'),
    slug: value('slug').toLowerCase(),
    adminEmail: value('adminEmail').toLowerCase(),
    adminPassword: formData.get('adminPassword')?.toString() || '',
    buyerName: value('buyerName'),
    buyerEmail: value('buyerEmail').toLowerCase(),
    buyerPhone: value('buyerPhone'),
    buyerDocument: value('buyerDocument'),
    addressStreet: value('addressStreet'),
    addressNumber: value('addressNumber'),
    addressComplement: value('addressComplement'),
    addressDistrict: value('addressDistrict'),
    addressCity: value('addressCity'),
    addressState: value('addressState').toUpperCase(),
    addressZipCode: value('addressZipCode'),
    planId: value('planId'),
    paymentMethod: value('paymentMethod'),
    installments: Number(value('installments') || 1)
  };
}

function validateStep(step) {
  const payload = collectCheckoutData();

  if (step === 1) {
    if (!payload.name || !payload.ownerName || !payload.slug || !payload.adminEmail || !payload.adminPassword) {
      throw new Error('Preencha todos os dados da empresa e acesso.');
    }
    if (!payload.buyerName || !payload.buyerEmail || !payload.buyerPhone || !payload.buyerDocument) {
      throw new Error('Preencha todos os dados pessoais do comprador.');
    }
  }

  if (step === 2) {
    if (!payload.addressStreet || !payload.addressNumber || !payload.addressDistrict || !payload.addressCity || !payload.addressState || !payload.addressZipCode) {
      throw new Error('Preencha o endereço completo para faturamento.');
    }
  }

  if (step === 3) {
    if (!payload.planId || !payload.paymentMethod) {
      throw new Error('Selecione plano e forma de pagamento.');
    }
    if (payload.paymentMethod === 'card' && (!payload.installments || payload.installments < 1)) {
      throw new Error('Parcelamento inválido para pagamento com cartão.');
    }
  }

  return payload;
}

function renderCheckoutReview() {
  if (!checkoutReview) return;
  const payload = collectCheckoutData();
  checkoutReview.textContent = [
    `Empresa: ${payload.name}`,
    `Responsável: ${payload.ownerName}`,
    `Slug: ${payload.slug}`,
    `Login principal: ${payload.adminEmail}`,
    `Comprador: ${payload.buyerName} • ${payload.buyerEmail} • ${payload.buyerPhone}`,
    `Documento: ${payload.buyerDocument}`,
    `Endereço: ${payload.addressStreet}, ${payload.addressNumber} ${payload.addressComplement ? '- ' + payload.addressComplement : ''}`,
    `${payload.addressDistrict} • ${payload.addressCity}/${payload.addressState} • CEP ${payload.addressZipCode}`,
    `Pagamento: ${payload.paymentMethod === 'card' ? 'Cartão' : 'Pix'} • ${payload.installments || 1}x`
  ].join('\n');
}

function renderReportsHistory(rows) {
  if (!reportsTable || !reportsCount) return;

  reportsCount.textContent = `${rows.length} registros`;
  if (!rows.length) {
    reportsTable.innerHTML = '<tr><td colspan="6">Nenhum relatório salvo.</td></tr>';
    return;
  }

  reportsTable.innerHTML = rows
    .map((row) => {
      const summary = row.summary || {};
      const created = new Date(row.created_at);
      const createdText = Number.isNaN(created.getTime()) ? '-' : created.toLocaleString('pt-BR');
      return `
        <tr>
          <td>${createdText}</td>
          <td>${summary.total_leads ?? 0}</td>
          <td>${summary.total_messages ?? 0}</td>
          <td>${summary.response_rate ?? 0}%</td>
          <td>${moneyBRL(summary.total_revenue_brl ?? 0)}</td>
          <td><button class="btn secondary" data-print-report="${row.id}">Imprimir</button></td>
        </tr>
      `;
    })
    .join('');

  reportsTable.querySelectorAll('[data-print-report]').forEach((button) => {
    button.addEventListener('click', async () => {
      const reportId = button.getAttribute('data-print-report');
      if (!reportId || !session.token) return;

      try {
        const html = await requestHtmlWithFallback(`/api/reports/${reportId}/print`, {
          headers: { Authorization: `Bearer ${session.token}` }
        });

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          throw new Error('Não foi possível abrir a janela de impressão.');
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
      } catch (error) {
        setFeedback(reportFeedback, error.message, true);
      }
    });
  });
}

async function requestHtmlWithFallback(path, options = {}) {
  const orderedBases = orderedApiBases();
  let lastNetworkError = null;

  for (const base of orderedBases) {
    try {
      const response = await fetch(`${base}${path}`, options);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || 'Falha ao carregar relatório para impressão.');
      }
      const html = await response.text();
      activeApiBase = base;
      localStorage.setItem(ACTIVE_API_KEY, base);
      return html;
    } catch (error) {
      if (error instanceof TypeError) {
        lastNetworkError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastNetworkError) {
    throw new Error('Falha de conexão ao buscar relatório para impressão.');
  }

  throw new Error('Não foi possível carregar o relatório para impressão.');
}

async function refreshDashboard() {
  const requests = [
    http('/api/leads'),
    http('/api/campaigns'),
    http('/api/reports/summary'),
    http('/api/client/license'),
    http('/api/reports/history?limit=20')
  ];

  if (isAdmin()) {
    requests.push(http('/api/companies'));
    requests.push(http('/api/admin/commercial/overview'));
    requests.push(http('/api/admin/customers'));
    requests.push(http('/api/admin/plans'));
  }

  const [leads, campaigns, summary, licenseInfo, reportsHistory, companies, commercialOverview, customers, adminPlans] = await Promise.all(
    requests
  );

  renderLeads(leads.data || []);
  renderCampaigns(campaigns.data || []);
  renderSummary(summary);
  renderReportsHistory(reportsHistory.data || []);
  loadProspects();
  loadDispatchHistory();

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
  pendingSaleId = null;
  paymentBox?.classList.add('hidden');
  setCheckoutStep(1);
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

checkoutNext1?.addEventListener('click', () => {
  try {
    validateStep(1);
    setCheckoutStep(2);
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

checkoutBack2?.addEventListener('click', () => setCheckoutStep(1));

checkoutNext2?.addEventListener('click', () => {
  try {
    validateStep(2);
    setCheckoutStep(3);
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

checkoutBack3?.addEventListener('click', () => setCheckoutStep(2));

checkoutNext3?.addEventListener('click', () => {
  try {
    validateStep(3);
    renderCheckoutReview();
    setCheckoutStep(4);
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

checkoutBack4?.addEventListener('click', () => setCheckoutStep(3));

checkoutForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const payload = collectCheckoutData();
    validateStep(1);
    validateStep(2);
    validateStep(3);

    const { response, body } = await requestWithFallback('/api/public/register-checkout', {
      method: 'POST',
      body: JSON.stringify(payload)
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
    setCheckoutStep(1);
    await refreshDashboard();
  } catch (error) {
    setFeedback(checkoutFeedback, error.message, true);
  }
});

generateReportBtn?.addEventListener('click', async () => {
  try {
    await http('/api/reports/generate', { method: 'POST' });
    setFeedback(reportFeedback, 'Relatório gerado e salvo com sucesso.');
    await refreshDashboard();
  } catch (error) {
    setFeedback(reportFeedback, error.message, true);
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
    messageTemplate: formData.get('messageTemplate')?.toString().trim(),
    templateName: formData.get('templateName')?.toString().trim() || null,
    templateLanguage: formData.get('templateLanguage')?.toString().trim() || 'pt_BR'
  };

  try {
    await http('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const templateHint = payload.templateName
      ? ` (template: ${payload.templateName})`
      : ' (texto livre — apenas para contatos que já iniciaram conversa)';
    setFeedback(campaignFeedback, `Campanha criada com sucesso${payload.channel === 'whatsapp' ? templateHint : ''}.`);
    campaignForm.reset();
    document.getElementById('whatsappTemplateFields')?.classList.add('hidden');
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

// ===== Prospecção – funções =====

function renderProspectResults(results, append) {
  if (!append) prospectResultsList.innerHTML = '';
  if (!results || results.length === 0) {
    if (!append) prospectResultsList.innerHTML = '<p class="empty-state">Nenhum resultado encontrado.</p>';
    return;
  }
  results.forEach((place) => {
    const card = document.createElement('div');
    card.className = 'prospect-result-card' + (place.already_saved ? ' already-saved' : '');
    const stars = place.rating ? '★'.repeat(Math.round(place.rating)) + ' ' + place.rating.toFixed(1) : '';
    card.innerHTML = `
      <div class="prospect-result-info">
        <strong>${place.name}</strong>
        ${stars ? `<span class="prospect-stars">${stars} <small>(${place.total_ratings})</small></span>` : ''}
        <small>${place.address}</small>
        ${place.types?.length ? `<small class="prospect-types">${place.types.join(' • ')}</small>` : ''}
      </div>
      <button class="btn btn-sm" ${place.already_saved ? 'disabled' : ''} data-place-id="${place.place_id}" data-name="${encodeURIComponent(place.name)}" data-address="${encodeURIComponent(place.address)}" data-niche="${encodeURIComponent(place.niche)}" data-location="${encodeURIComponent(place.location)}" data-rating="${place.rating || ''}" data-total="${place.total_ratings || 0}">
        ${place.already_saved ? 'Salvo ✓' : 'Salvar prospect'}
      </button>
    `;
    if (!place.already_saved) {
      card.querySelector('button').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const payload = {
          place_id: btn.dataset.placeId,
          name: decodeURIComponent(btn.dataset.name),
          address: decodeURIComponent(btn.dataset.address),
          niche: decodeURIComponent(btn.dataset.niche),
          location: decodeURIComponent(btn.dataset.location),
          rating: btn.dataset.rating ? Number(btn.dataset.rating) : null,
          total_ratings: Number(btn.dataset.total)
        };
        try {
          await http('/api/prospects', { method: 'POST', body: JSON.stringify(payload) });
          btn.textContent = 'Salvo ✓';
          btn.disabled = true;
          card.classList.add('already-saved');
          await loadProspects();
        } catch (err) {
          setFeedback(prospectSearchFeedback, err.message, true);
        }
      });
    }
    prospectResultsList.appendChild(card);
  });
}

async function loadProspects() {
  try {
    const res = await http('/api/prospects');
    const list = res.data || [];
    if (prospectsCount) prospectsCount.textContent = `${list.length} prospect${list.length !== 1 ? 's' : ''}`;
    if (!prospectsTable) return;
    if (list.length === 0) {
      prospectsTable.innerHTML = '<p class="empty-state">Nenhum prospect salvo.</p>';
      return;
    }
    prospectsTable.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Nome</th><th>Nicho</th><th>Local</th><th>Telefone</th><th>Ações</th></tr></thead>
        <tbody>
          ${list.map((p) => `
            <tr>
              <td>${p.name}</td>
              <td>${p.niche}</td>
              <td>${p.location || p.address || '-'}</td>
              <td><input class="tbl-phone-input" data-id="${p.id}" placeholder="WhatsApp do responsável" value="${p.phone || ''}" /></td>
              <td>
                <button class="btn btn-sm convert-prospect-btn" data-id="${p.id}">Converter em Lead</button>
                <button class="btn btn-sm secondary remove-prospect-btn" data-id="${p.id}">✕</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    prospectsTable.querySelectorAll('.remove-prospect-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover este prospect?')) return;
        try {
          await http(`/api/prospects/${btn.dataset.id}`, { method: 'DELETE' });
          await loadProspects();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    prospectsTable.querySelectorAll('.convert-prospect-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const row = btn.closest('tr');
        const phoneInput = row.querySelector('.tbl-phone-input');
        const phone = phoneInput ? phoneInput.value.trim() : '';
        if (!phone) {
          alert('Preencha o telefone/WhatsApp do responsável antes de converter.');
          return;
        }
        if (!confirm('Confirmo que obtive o opt-in deste contato e autorizo a conversão em lead.')) return;
        try {
          await http(`/api/prospects/${btn.dataset.id}/convert`, {
            method: 'POST',
            body: JSON.stringify({ phone, consent: true, source: 'Prospecção Google' })
          });
          await Promise.all([loadProspects(), refreshDashboard()]);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } catch (err) {
    if (prospectsTable) prospectsTable.innerHTML = `<p class="empty-state error">${err.message}</p>`;
  }
}

prospectSearchForm && prospectSearchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  _prospectNextPageToken = null;
  const query = {
    niche: prospectNicheEl.value.trim(),
    city: prospectCityEl.value.trim(),
    state: prospectStateEl.value.trim(),
    country: prospectCountryEl.value.trim() || 'Brasil'
  };
  _lastProspectQuery = query;
  setFeedback(prospectSearchFeedback, 'Buscando…');
  try {
    const res = await http('/api/prospects/search', { method: 'POST', body: JSON.stringify(query) });
    setFeedback(prospectSearchFeedback, '');
    _prospectNextPageToken = res.next_page_token || null;
    prospectResultsTitle.textContent = `Resultados para "${res.query}"`;
    prospectResultsCount.textContent = `${res.total} encontrados`;
    prospectResultsPanel.classList.remove('hidden');
    renderProspectResults(res.data, false);
    if (_prospectNextPageToken) {
      prospectLoadMore.classList.remove('hidden');
    } else {
      prospectLoadMore.classList.add('hidden');
    }
  } catch (err) {
    setFeedback(prospectSearchFeedback, err.message, true);
  }
});

prospectLoadMore && prospectLoadMore.addEventListener('click', async () => {
  if (!_prospectNextPageToken) return;
  try {
    prospectLoadMore.disabled = true;
    const res = await http('/api/prospects/search', {
      method: 'POST',
      body: JSON.stringify({ ..._lastProspectQuery, pagetoken: _prospectNextPageToken })
    });
    _prospectNextPageToken = res.next_page_token || null;
    prospectResultsCount.textContent = `${prospectResultsList.children.length + res.total} encontrados`;
    renderProspectResults(res.data, true);
    if (_prospectNextPageToken) {
      prospectLoadMore.disabled = false;
    } else {
      prospectLoadMore.classList.add('hidden');
    }
  } catch (err) {
    setFeedback(prospectSearchFeedback, err.message, true);
    prospectLoadMore.disabled = false;
  }
});

// ===== fim prospecção =====

async function loadDispatchHistory() {
  if (!dispatchHistoryTable) return;
  try {
    const res = await http('/api/reports/dispatch-history?limit=50');
    const rows = res.data || [];
    if (dispatchHistoryCount) dispatchHistoryCount.textContent = `${rows.length} disparo${rows.length !== 1 ? 's' : ''}`;
    if (!rows.length) {
      dispatchHistoryTable.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Nenhum disparo realizado ainda.</td></tr>';
      return;
    }
    dispatchHistoryTable.innerHTML = rows.map((b) => {
      const date = new Date(b.created_at);
      const dateStr = Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('pt-BR');
      const t = b.totals || {};
      const sent = t.sent ?? 0;
      const failed = t.failed ?? 0;
      const total = b.total_leads ?? 0;
      const failColor = failed > 0 && sent === 0 ? 'color:var(--danger,#dc2626)' : failed > 0 ? 'color:#d97706' : '';

      const modeLabel = {
        whatsapp_template: '✓ template',
        whatsapp_text: '⚠ texto livre',
        whatsapp_cloud_api: '⚠ texto livre',
        simulation: '— simulação'
      }[b.dispatch_mode] || (b.channel === 'whatsapp' ? '⚠ texto livre' : b.channel || '-');

      const statusBadge = b.status === 'processing'
        ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:4px">em andamento</span>'
        : b.status === 'done'
          ? '<span style="font-size:11px;background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:4px">concluído</span>'
          : '';

      return `<tr>
        <td>${dateStr}</td>
        <td>${b.campaign_name || '-'}</td>
        <td>${modeLabel}</td>
        <td>${total}</td>
        <td style="color:var(--success,#16a34a)">${sent}</td>
        <td style="${failColor}">${failed}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');
  } catch (_err) {
    if (dispatchHistoryTable) dispatchHistoryTable.innerHTML = '<tr><td colspan="7">Erro ao carregar histórico.</td></tr>';
  }
}

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
setCheckoutStep(1);
loadPublicPlans();
loadSession();
