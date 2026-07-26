const state = {
  user: null,
  projects: [],
  currentProjectId: null,
  currentDraft: null,
  currentApproval: null
};

const elements = {
  loading: document.getElementById('loading-screen'),
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  setupMessage: document.getElementById('setup-message'),
  userName: document.getElementById('user-name'),
  userRole: document.getElementById('user-role'),
  logout: document.getElementById('logout-button'),
  newProjectButton: document.getElementById('new-project-button'),
  cancelProjectButton: document.getElementById('cancel-project-button'),
  backProjectsButton: document.getElementById('back-projects-button'),
  projectListView: document.getElementById('project-list-view'),
  newProjectView: document.getElementById('new-project-view'),
  projectDetailView: document.getElementById('project-detail-view'),
  projectForm: document.getElementById('project-form'),
  projectFormError: document.getElementById('project-form-error'),
  createProjectSubmit: document.getElementById('create-project-submit'),
  projectSearch: document.getElementById('project-search'),
  projectCount: document.getElementById('project-count'),
  projectTableBody: document.getElementById('project-table-body'),
  emptyProjects: document.getElementById('empty-projects'),
  protocolGenerate: document.getElementById('protocol-generate-button'),
  protocolActionMessage: document.getElementById('protocol-action-message'),
  protocolActionError: document.getElementById('protocol-action-error'),
  protocolDraftSection: document.getElementById('protocol-draft-section'),
  protocolQualityBadge: document.getElementById('protocol-quality-badge'),
  protocolQualitySummary: document.getElementById('protocol-quality-summary'),
  protocolWarningReview: document.getElementById('protocol-warning-review'),
  protocolWarningList: document.getElementById('protocol-warning-list'),
  draftCoreProblem: document.getElementById('draft-core-problem'),
  draftWeNoticed: document.getElementById('draft-we-noticed'),
  draftEvidenceBoundary: document.getElementById('draft-evidence-boundary'),
  draftPersonaMix: document.getElementById('draft-persona-mix'),
  draftSpatialSignature: document.getElementById('draft-spatial-signature'),
  draftEvidenceList: document.getElementById('draft-evidence-list'),
  draftProtocolList: document.getElementById('draft-protocol-list'),
  draftDecisionList: document.getElementById('draft-decision-list'),
  draftVerificationList: document.getElementById('draft-verification-list'),
  draftImplementationList: document.getElementById('draft-implementation-list'),
  protocolSave: document.getElementById('protocol-save-button'),
  protocolSaveStatus: document.getElementById('protocol-save-status'),
  protocolApprove: document.getElementById('protocol-approve-button'),
  protocolPdf: document.getElementById('protocol-pdf-button')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'İşlem tamamlanamadı.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setMessage(element, message) {
  element.textContent = message || '';
  element.hidden = !message;
}

function showLogin() {
  elements.loading.hidden = true;
  elements.appView.hidden = true;
  elements.loginView.hidden = false;
}

function showApp() {
  elements.loading.hidden = true;
  elements.loginView.hidden = true;
  elements.appView.hidden = false;
  elements.userName.textContent = state.user.display_name;
  elements.userRole.textContent = state.user.role;
}

function showWorkspace(view) {
  elements.projectListView.hidden = view !== 'list';
  elements.newProjectView.hidden = view !== 'new';
  elements.projectDetailView.hidden = view !== 'detail';
  elements.newProjectButton.hidden = view !== 'list';
}

function statusLabel(value) {
  const labels = { draft: 'Taslak', in_review: 'İncelemede', approved: 'Onaylı', archived: 'Arşiv' };
  return labels[value] || value;
}

function escapeText(value) {
  return String(value == null ? '' : value);
}

function renderProjects() {
  const query = elements.projectSearch.value.trim().toLowerCase();
  const filtered = state.projects.filter(project => {
    const haystack = [project.project_code, project.name, project.client_name, project.space_type].join(' ').toLowerCase();
    return !query || haystack.includes(query);
  });
  elements.projectTableBody.replaceChildren();
  filtered.forEach(project => {
    const row = document.createElement('tr');
    row.tabIndex = 0;
    row.dataset.projectId = project.id;
    [
      project.project_code,
      project.name,
      project.client_name || '-',
      project.space_type,
      `R${project.current_revision_number}`,
      statusLabel(project.status)
    ].forEach((value, index) => {
      const cell = document.createElement('td');
      if (index === 5) {
        const badge = document.createElement('span');
        badge.className = 'status-badge';
        badge.textContent = escapeText(value);
        cell.appendChild(badge);
      } else {
        cell.textContent = escapeText(value);
      }
      row.appendChild(cell);
    });
    row.addEventListener('click', () => openProject(project.id));
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') openProject(project.id);
    });
    elements.projectTableBody.appendChild(row);
  });
  elements.projectCount.textContent = `${filtered.length} proje`;
  elements.emptyProjects.hidden = filtered.length > 0;
}

async function loadProjects() {
  const payload = await api('/api/protocol-admin/projects');
  state.projects = payload.projects || [];
  renderProjects();
}

function rawText(value) {
  if (!value) return '-';
  if (typeof value === 'string') return value || '-';
  if (Array.isArray(value)) return value.map(item => item.raw_text || JSON.stringify(item)).join('\n') || '-';
  return value.raw_text || JSON.stringify(value, null, 2);
}

function humanize(value) {
  return String(value || '').replaceAll('_', ' ');
}

function badge(text, tone) {
  const element = document.createElement('span');
  element.className = `draft-badge ${tone || ''}`.trim();
  element.textContent = humanize(text);
  return element;
}

function draftField(labelText, value, path, rows = 3) {
  const label = document.createElement('label');
  label.className = 'draft-field';
  const title = document.createElement('span');
  title.textContent = labelText;
  const textarea = document.createElement('textarea');
  textarea.rows = rows;
  textarea.value = value || '';
  textarea.dataset.draftPath = path;
  label.append(title, textarea);
  return label;
}

function draftSelect(labelText, value, path, options) {
  const label = document.createElement('label');
  label.className = 'draft-field';
  const title = document.createElement('span');
  title.textContent = labelText;
  const select = document.createElement('select');
  select.dataset.draftPath = path;
  options.forEach(optionValue => {
    const option = document.createElement('option');
    option.value = optionValue;
    option.textContent = humanize(optionValue);
    option.selected = optionValue === value;
    select.appendChild(option);
  });
  label.append(title, select);
  return label;
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach(part => {
    cursor = cursor[Number.isInteger(Number(part)) ? Number(part) : part];
  });
  cursor[parts.at(-1)] = value;
}

function renderQuality(quality) {
  const result = quality || { status: 'blocked', summary: { blocker_count: 0, warning_count: 0 }, blockers: [], warnings: [] };
  const labels = {
    ready_for_approval: 'Onaya hazır',
    warning_override_required: 'Uyarı incelemesi gerekli',
    blocked: 'Doğrulama gerekli'
  };
  elements.protocolQualityBadge.className = `quality-badge ${result.status}`;
  elements.protocolQualityBadge.textContent = labels[result.status] || humanize(result.status);
  elements.protocolQualitySummary.replaceChildren();

  const counts = document.createElement('p');
  counts.textContent = `${result.summary.blocker_count || 0} engel · ${result.summary.warning_count || 0} uyarı`;
  elements.protocolQualitySummary.appendChild(counts);
  const issues = [...(result.blockers || []), ...(result.warnings || [])].slice(0, 8);
  if (issues.length) {
    const list = document.createElement('ul');
    issues.forEach(item => {
      const row = document.createElement('li');
      row.textContent = item.message;
      list.appendChild(row);
    });
    elements.protocolQualitySummary.appendChild(list);
  }
}

function renderWarningReview(content, quality) {
  const warnings = quality && quality.warnings || [];
  const existing = new Map((content.warning_overrides || []).map(item => [item.code, item.reason]));
  elements.protocolWarningList.replaceChildren();
  elements.protocolWarningReview.hidden = warnings.length === 0;
  warnings.forEach(item => {
    const card = document.createElement('article');
    card.className = 'warning-card';
    const heading = document.createElement('strong');
    heading.textContent = item.message;
    const code = document.createElement('span');
    code.textContent = item.code;
    const field = draftField(
      'Mimari gerekçe',
      existing.get(item.code) || '',
      `warning_override.${item.code}`,
      3
    );
    field.querySelector('textarea').dataset.warningCode = item.code;
    delete field.querySelector('textarea').dataset.draftPath;
    card.append(code, heading, field);
    elements.protocolWarningList.appendChild(card);
  });
}

function renderPersonaMix(allocations) {
  elements.draftPersonaMix.replaceChildren();
  (allocations || []).filter(item => item.scope === 'project').forEach(item => {
    const row = document.createElement('div');
    row.className = 'persona-row';
    const head = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = humanize(item.persona);
    const value = document.createElement('span');
    value.textContent = `%${Number(item.percentage).toFixed(0)}`;
    head.append(name, value);
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = Number(item.percentage);
    const rationale = document.createElement('p');
    rationale.textContent = item.rationale;
    row.append(head, progress, rationale);
    elements.draftPersonaMix.appendChild(row);
  });
}

function renderEvidence(evidence) {
  elements.draftEvidenceList.replaceChildren();
  (evidence || []).forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'draft-card';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `E${index + 1} · ${humanize(item.category)}`;
    const tags = document.createElement('div');
    tags.className = 'badge-row';
    tags.append(badge(item.confidence, item.confidence), badge(item.verification_status, item.verification_status));
    header.append(title, tags);
    const controls = document.createElement('div');
    controls.className = 'draft-grid compact-controls';
    controls.append(
      draftSelect(
        'Güven',
        item.confidence,
        `evidence.${index}.confidence`,
        ['confirmed', 'strong_inference', 'assumption', 'unknown']
      ),
      draftSelect(
        'Doğrulama',
        item.verification_status,
        `evidence.${index}.verification_status`,
        ['not_required', 'pending', 'field_verification_required', 'verified', 'failed']
      )
    );
    card.append(
      header,
      controls,
      draftField('Kanıt ifadesi', item.statement, `evidence.${index}.statement`, 3)
    );
    elements.draftEvidenceList.appendChild(card);
  });
}

function renderProtocols(protocols) {
  elements.draftProtocolList.replaceChildren();
  (protocols || []).forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'draft-card';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `Kural ${index + 1}`;
    const tags = document.createElement('div');
    tags.className = 'badge-row';
    tags.append(badge(item.confidence, item.confidence), badge(item.verification_status, item.verification_status));
    header.append(title, tags);
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    grid.append(
      draftField('Tetikleyici', item.trigger, `project_protocols.${index}.trigger`),
      draftField('Soyut reçete', item.abstract_prescription, `project_protocols.${index}.abstract_prescription`),
      draftField('Somut reçete', item.concrete_prescription, `project_protocols.${index}.concrete_prescription`),
      draftField('Başarı testi', item.success_test, `project_protocols.${index}.success_test`)
    );
    card.append(header, grid);
    elements.draftProtocolList.appendChild(card);
  });
}

function renderDecisions(decisions) {
  elements.draftDecisionList.replaceChildren();
  (decisions || []).forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'draft-card';
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = `${index + 1}. ${item.title}`;
    const tags = document.createElement('div');
    tags.className = 'badge-row';
    tags.append(badge(item.status), badge(item.decision_type), badge(item.confidence, item.confidence));
    if (item.dimension_dependent) tags.append(badge('ölçüye bağlı', 'field_verification_required'));
    header.append(title, tags);
    const grid = document.createElement('div');
    grid.className = 'draft-grid';
    grid.append(
      draftField('Karar başlığı', item.title, `decisions.${index}.title`, 2),
      draftField('Soyut ihtiyaç', item.abstract_need, `decisions.${index}.abstract_need`),
      draftField('Somut karar', item.concrete_decision, `decisions.${index}.concrete_decision`, 4),
      draftField('Başarı testi', item.success_test, `decisions.${index}.success_test`)
    );
    if (item.tradeoff) grid.appendChild(draftField('Taviz / tradeoff', item.tradeoff, `decisions.${index}.tradeoff`));
    const controls = document.createElement('div');
    controls.className = 'draft-grid compact-controls';
    controls.append(
      draftSelect(
        'Karar doğrulaması',
        item.verification_status,
        `decisions.${index}.verification_status`,
        ['not_required', 'pending', 'field_verification_required', 'verified', 'failed']
      )
    );
    card.append(header, controls, grid);
    elements.draftDecisionList.appendChild(card);
  });
}

function renderVerifications(items) {
  elements.draftVerificationList.replaceChildren();
  (items || []).forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'verification-row';
    row.append(badge(item.blocking ? 'blocking' : 'open', item.blocking ? 'assumption' : 'pending'));
    const body = document.createElement('div');
    body.className = 'verification-editor';
    const text = document.createElement('p');
    text.textContent = item.statement;
    const fields = document.createElement('div');
    fields.className = 'verification-fields';
    fields.append(
      draftSelect(
        'Durum',
        item.status,
        `open_verifications.${index}.status`,
        ['open', 'verified', 'failed', 'waived']
      ),
      draftField(
        'Doğrulama / feragat notu',
        item.resolution || '',
        `open_verifications.${index}.resolution`,
        2
      )
    );
    body.append(text, fields);
    row.appendChild(body);
    elements.draftVerificationList.appendChild(row);
  });
  if (!(items || []).length) {
    const empty = document.createElement('p');
    empty.textContent = 'Açık doğrulama bulunmuyor.';
    elements.draftVerificationList.appendChild(empty);
  }
}

function renderImplementation(items) {
  elements.draftImplementationList.replaceChildren();
  (items || []).sort((a, b) => a.sequence - b.sequence).forEach(item => {
    const row = document.createElement('li');
    row.textContent = item.title;
    elements.draftImplementationList.appendChild(row);
  });
}

function setProtocolLocked(locked) {
  elements.protocolDraftSection.querySelectorAll('textarea, select').forEach(control => {
    control.disabled = locked;
  });
  elements.protocolSave.hidden = locked;
  elements.protocolApprove.hidden = locked;
  elements.protocolPdf.hidden = !locked;
  if (locked && state.currentProjectId) {
    elements.protocolPdf.href = `/api/protocol-admin/projects/${encodeURIComponent(state.currentProjectId)}/approved-pdf`;
  }
}

function renderProtocolDraft(draft, approval = state.currentApproval) {
  state.currentDraft = draft;
  state.currentApproval = approval || null;
  setMessage(elements.protocolActionMessage, '');
  setMessage(elements.protocolActionError, '');
  setMessage(elements.protocolSaveStatus, '');
  elements.protocolDraftSection.hidden = true;
  elements.protocolGenerate.hidden = false;
  elements.protocolGenerate.disabled = false;

  if (!draft) return;
  if (draft.status === 'generating') {
    elements.protocolGenerate.disabled = true;
    setMessage(elements.protocolActionMessage, 'Protokol üretiliyor. Bu ekranı açık tut.');
    return;
  }
  if (draft.status === 'failed') {
    setMessage(elements.protocolActionError, 'Önceki üretim tamamlanamadı. Kanıtları kontrol edip tekrar deneyebilirsin.');
    return;
  }
  if (draft.status !== 'ready' || !draft.content) return;

  elements.protocolGenerate.hidden = true;
  elements.protocolDraftSection.hidden = false;
  const content = draft.content;
  elements.draftCoreProblem.value = content.diagnosis && content.diagnosis.core_problem || '';
  elements.draftWeNoticed.value = content.diagnosis && content.diagnosis.we_noticed || '';
  elements.draftEvidenceBoundary.value = content.diagnosis && content.diagnosis.evidence_boundary || '';
  elements.draftSpatialSignature.value = content.spatial_signature && content.spatial_signature.statement || '';
  renderQuality(draft.quality_gate_result);
  renderPersonaMix(content.persona_allocations);
  renderEvidence(content.evidence);
  renderProtocols(content.project_protocols);
  renderDecisions(content.decisions);
  renderVerifications(content.open_verifications);
  renderImplementation(content.implementation_order);
  renderWarningReview(content, draft.quality_gate_result);
  elements.protocolApprove.disabled = !draft.quality_gate_result || !draft.quality_gate_result.can_approve;
  elements.protocolApprove.title = elements.protocolApprove.disabled
    ? 'Önce tüm engelleri çöz ve uyarılara mimari gerekçe ekle.'
    : '';
  setProtocolLocked(Boolean(state.currentApproval));
  if (state.currentApproval) {
    setMessage(elements.protocolSaveStatus, `Onaylandı · ${state.currentApproval.snapshot_sha256.slice(0, 12)}…`);
  }
}

async function openProject(projectId) {
  try {
    const payload = await api(`/api/protocol-admin/projects/${encodeURIComponent(projectId)}`);
    const project = payload.project;
    document.getElementById('detail-code').textContent = project.project_code;
    document.getElementById('detail-name').textContent = project.name;
    document.getElementById('detail-client').textContent = project.client_email
      ? `${project.client_name} · ${project.client_email}`
      : project.client_name;
    document.getElementById('detail-space').textContent = project.space_type;
    document.getElementById('detail-revision').textContent = `R${project.revision_number}`;
    document.getElementById('detail-status').textContent = statusLabel(project.status);
    document.getElementById('detail-narrative').textContent = project.client_narrative;
    document.getElementById('detail-measurements').textContent = rawText(project.measurements);
    document.getElementById('detail-fixed').textContent = rawText(project.fixed_elements);
    state.currentProjectId = project.id;
    state.currentApproval = payload.approval || null;
    renderProtocolDraft(payload.protocol_draft, payload.approval);
    showWorkspace('detail');
  } catch (error) {
    window.alert(error.message);
  }
}

elements.loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage(elements.loginError, '');
  const button = elements.loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const form = new FormData(elements.loginForm);
    const payload = await api('/api/protocol-admin/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    });
    state.user = payload.user;
    showApp();
    showWorkspace('list');
    await loadProjects();
  } catch (error) {
    setMessage(elements.loginError, error.message);
  } finally {
    button.disabled = false;
  }
});

elements.logout.addEventListener('click', async () => {
  try {
    await api('/api/protocol-admin/logout', { method: 'POST', body: '{}' });
  } finally {
    state.user = null;
    state.projects = [];
    elements.loginForm.reset();
    showLogin();
  }
});

elements.newProjectButton.addEventListener('click', () => {
  elements.projectForm.reset();
  setMessage(elements.projectFormError, '');
  showWorkspace('new');
});
elements.cancelProjectButton.addEventListener('click', () => showWorkspace('list'));
elements.backProjectsButton.addEventListener('click', () => showWorkspace('list'));
elements.projectSearch.addEventListener('input', renderProjects);

elements.projectForm.addEventListener('submit', async event => {
  event.preventDefault();
  setMessage(elements.projectFormError, '');
  elements.createProjectSubmit.disabled = true;
  try {
    const form = new FormData(elements.projectForm);
    const body = Object.fromEntries(form.entries());
    const payload = await api('/api/protocol-admin/projects', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    await loadProjects();
    await openProject(payload.project.id);
  } catch (error) {
    setMessage(elements.projectFormError, error.message);
  } finally {
    elements.createProjectSubmit.disabled = false;
  }
});

elements.protocolGenerate.addEventListener('click', async () => {
  if (!state.currentProjectId) return;
  setMessage(elements.protocolActionError, '');
  setMessage(elements.protocolActionMessage, 'Kanıtlar ayrıştırılıyor ve protokol taslağı hazırlanıyor...');
  elements.protocolGenerate.disabled = true;
  try {
    const payload = await api(`/api/protocol-admin/projects/${encodeURIComponent(state.currentProjectId)}/generate-protocol`, {
      method: 'POST',
      body: '{}'
    });
    renderProtocolDraft(payload.protocol_draft);
  } catch (error) {
    setMessage(elements.protocolActionMessage, '');
    setMessage(elements.protocolActionError, error.message);
    elements.protocolGenerate.disabled = false;
  }
});

function collectDraftContent() {
  const content = structuredClone(state.currentDraft.content);
  content.diagnosis.core_problem = elements.draftCoreProblem.value.trim();
  content.diagnosis.we_noticed = elements.draftWeNoticed.value.trim();
  content.diagnosis.evidence_boundary = elements.draftEvidenceBoundary.value.trim();
  content.spatial_signature.statement = elements.draftSpatialSignature.value.trim();
  elements.protocolDraftSection.querySelectorAll('[data-draft-path]').forEach(field => {
    setPath(content, field.dataset.draftPath, field.value.trim());
  });
  content.warning_overrides = [...elements.protocolWarningList.querySelectorAll('[data-warning-code]')]
    .map(field => ({ code: field.dataset.warningCode, reason: field.value.trim() }))
    .filter(item => item.reason);
  return content;
}

async function saveCurrentDraft() {
  const content = collectDraftContent();
  const payload = await api(`/api/protocol-admin/projects/${encodeURIComponent(state.currentProjectId)}/protocol-draft`, {
    method: 'PUT',
    body: JSON.stringify({ content })
  });
  renderProtocolDraft(payload.protocol_draft);
  return payload.protocol_draft;
}

elements.protocolSave.addEventListener('click', async () => {
  if (!state.currentProjectId || !state.currentDraft || !state.currentDraft.content) return;
  setMessage(elements.protocolSaveStatus, '');
  elements.protocolSave.disabled = true;
  try {
    await saveCurrentDraft();
    setMessage(elements.protocolSaveStatus, 'Taslak ve kalite kontrol sonucu kaydedildi.');
  } catch (error) {
    setMessage(elements.protocolSaveStatus, error.message);
  } finally {
    elements.protocolSave.disabled = false;
  }
});

elements.protocolApprove.addEventListener('click', async () => {
  if (!state.currentProjectId || state.currentApproval) return;
  if (!window.confirm('Bu revizyon değişmez biçimde onaylanacak. Devam edilsin mi?')) return;
  setMessage(elements.protocolSaveStatus, 'Taslak kaydediliyor ve kalite kapısı yeniden çalıştırılıyor...');
  elements.protocolSave.disabled = true;
  elements.protocolApprove.disabled = true;
  try {
    const saved = await saveCurrentDraft();
    if (!saved.quality_gate_result.can_approve) {
      setMessage(elements.protocolSaveStatus, 'Onay durduruldu. Görünen engelleri ve uyarıları çöz.');
      return;
    }
    const payload = await api(`/api/protocol-admin/projects/${encodeURIComponent(state.currentProjectId)}/approve`, {
      method: 'POST',
      body: '{}'
    });
    state.currentApproval = payload.approval;
    await openProject(state.currentProjectId);
  } catch (error) {
    setMessage(elements.protocolSaveStatus, error.message);
  } finally {
    elements.protocolSave.disabled = false;
    if (!state.currentApproval) {
      elements.protocolApprove.disabled = !state.currentDraft ||
        !state.currentDraft.quality_gate_result ||
        !state.currentDraft.quality_gate_result.can_approve;
    }
  }
});

async function initialize() {
  try {
    const status = await api('/api/protocol-admin/status');
    if (!status.ready) {
      showLogin();
      const message = !status.configured
        ? 'Veritabanı bağlantısı henüz yapılandırılmadı.'
        : 'İlk admin hesabı henüz yapılandırılmadı.';
      setMessage(elements.setupMessage, message);
      elements.loginForm.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
      return;
    }
    const session = await api('/api/protocol-admin/session');
    if (!session.authenticated) {
      showLogin();
      return;
    }
    state.user = session.user;
    showApp();
    showWorkspace('list');
    await loadProjects();
  } catch (error) {
    showLogin();
    setMessage(elements.setupMessage, 'Protocol Admin şu anda kullanılamıyor.');
  }
}

initialize();
