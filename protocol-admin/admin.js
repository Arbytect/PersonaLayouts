const state = {
  user: null,
  projects: [],
  currentProjectId: null,
  currentProject: null,
  currentDraft: null,
  currentApproval: null,
  currentAtlasSelection: null,
  atlasRecommendations: [],
  currentStep: 'brief',
  module: 'projects',
  atlas: null,
  atlasFilter: 'all',
  atlasSelected: null,
  atlasTab: 'overview',
  atlasComparison: null
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
  moduleButtons: [...document.querySelectorAll('[data-module]')],
  workspaceKicker: document.getElementById('workspace-kicker'),
  workspaceTitle: document.getElementById('workspace-title'),
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
  protocolWorkflowNav: document.getElementById('protocol-workflow-nav'),
  protocolBriefPanel: document.getElementById('protocol-brief-panel'),
  briefReadiness: document.getElementById('brief-readiness'),
  atlasRecommend: document.getElementById('atlas-recommend-button'),
  atlasRecommendations: document.getElementById('project-atlas-recommendations'),
  atlasPrimarySelect: document.getElementById('atlas-primary-select'),
  atlasSupportingSelect: document.getElementById('atlas-supporting-select'),
  atlasAlternativeSelect: document.getElementById('atlas-alternative-select'),
  atlasSelectionRationale: document.getElementById('atlas-selection-rationale'),
  atlasSelectionMessage: document.getElementById('atlas-selection-message'),
  atlasSaveSelection: document.getElementById('atlas-save-selection-button'),
  atlasOpenSelection: document.getElementById('atlas-open-selection-button'),
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
  protocolPdf: document.getElementById('protocol-pdf-button'),
  protocolStepPrev: document.getElementById('protocol-step-prev'),
  protocolStepNext: document.getElementById('protocol-step-next'),
  atlasView: document.getElementById('atlas-view'),
  atlasError: document.getElementById('atlas-error'),
  atlasStats: document.getElementById('atlas-stats'),
  atlasSearch: document.getElementById('atlas-search'),
  atlasFilters: document.getElementById('atlas-filters'),
  atlasComparisonSelect: document.getElementById('atlas-comparison-select'),
  atlasComparisonPanel: document.getElementById('atlas-comparison-panel'),
  atlasList: document.getElementById('atlas-list'),
  atlasDetail: document.getElementById('atlas-detail'),
  atlasBoundary: document.getElementById('atlas-boundary-text')
};

const WORKFLOW_STEPS = ['brief', 'diagnosis', 'decisions', 'review'];

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
  elements.userRole.textContent = state.user.role === 'admin' ? 'Yönetici' : 'Görüntüleyici';
}

function showWorkspace(view) {
  state.module = 'projects';
  elements.projectListView.hidden = view !== 'list';
  elements.newProjectView.hidden = view !== 'new';
  elements.projectDetailView.hidden = view !== 'detail';
  elements.atlasView.hidden = true;
  elements.newProjectButton.hidden = view !== 'list';
  elements.workspaceKicker.textContent = 'PROJE YÖNETİM ALANI';
  elements.workspaceTitle.textContent = 'Projeler';
  elements.moduleButtons.forEach(button => button.classList.toggle('active', button.dataset.module === 'projects'));
}

function statusLabel(value) {
  const labels = { draft: 'Taslak', in_review: 'İncelemede', approved: 'Onaylı', archived: 'Arşiv' };
  return labels[value] || value;
}

function escapeText(value) {
  return String(value == null ? '' : value);
}

const ATLAS_PERSONAS = ['sovereign', 'sage', 'alchemist', 'weaver'];
const PERSONA_LABELS = {
  sovereign: 'Egemen',
  sage: 'Bilge',
  alchemist: 'Simyacı',
  weaver: 'Dokuyucu'
};
const TERM_LABELS = {
  high: 'yüksek', medium: 'orta', low: 'düşük', strong: 'güçlü',
  confirmed: 'doğrulandı', strong_inference: 'güçlü çıkarım', assumption: 'varsayım', unknown: 'bilinmiyor',
  not_required: 'gerekli değil', pending: 'bekliyor', field_verification_required: 'saha doğrulaması gerekli',
  verified: 'doğrulandı', failed: 'başarısız', open: 'açık', waived: 'gerekçeyle kaldırıldı',
  blocking: 'engelleyici', historical_lineage: 'tarihsel köken', design_context: 'tasarım bağlamı',
  performance_framework: 'performans çerçevesi', cultural_practice: 'kültürel uygulama',
  editorial_translation: 'editoryal çeviri', supported: 'destekli',
  editoryal_ceviri: 'editoryal çeviri', dogrulama_gerekli: 'doğrulama gerekli',
  tasarim_baglami: 'tasarım bağlamı', editoryal_cikarim: 'editoryal çıkarım', risk_siniri: 'risk sınırı',
  apartment: 'Daire', residence: 'Konut', office: 'Ofis', commercial: 'Ticari mekân',
  full_audit: 'tam inceleme', ai: 'yapay zekâ', admin: 'yönetici', onayli: 'onaylı'
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = escapeText(text);
  return element;
}

function atlasImageUrl(value) {
  const source = escapeText(value);
  const filename = source.split('/').pop();
  return `/protocol-admin/atlas-images/${encodeURIComponent(filename)}`;
}

function atlasCategoryLabel(value) {
  if (value === 'all') return 'Tümü';
  if (ATLAS_PERSONAS.includes(value)) return PERSONA_LABELS[value];
  const category = state.atlas && state.atlas.taxonomy.find(item => item.id === value);
  return category ? category.label : humanize(value);
}

function filteredAtlasLenses() {
  if (!state.atlas) return [];
  const query = elements.atlasSearch.value.trim().toLowerCase();
  return state.atlas.lenses.filter(lens => {
    const matchesFilter = state.atlasFilter === 'all' ||
      lens.category === state.atlasFilter ||
      (ATLAS_PERSONAS.includes(state.atlasFilter) && lens.admin.persona_support[state.atlasFilter] !== 'low');
    const haystack = [
      lens.name,
      lens.subtitle,
      lens.category,
      lens.public.philosophy && lens.public.philosophy.core,
      lens.public.philosophy && lens.public.philosophy.spatial_why,
      ...(lens.public.not_to_confuse_with || []),
      ...(lens.admin.frictions || []),
      ...Object.keys(lens.admin.persona_support || {})
    ].join(' ').toLowerCase();
    return matchesFilter && (!query || haystack.includes(query));
  });
}

function renderAtlasStats() {
  const lenses = state.atlas.lenses || [];
  const stats = [
    [lenses.length, 'Onaylı yaklaşım'],
    [(state.atlas.sources || []).length, 'Araştırma kaynağı'],
    [(state.atlas.reference_registry || []).length, 'Referans kaydı'],
    [lenses.reduce((sum, lens) => sum + (lens.admin.claims || []).length, 0), 'İddia kaydı'],
    [lenses.reduce((sum, lens) => sum + Object.keys(lens.public.room_applications || {}).length, 0), 'Oda çevirisi']
  ];
  elements.atlasStats.replaceChildren(...stats.map(([value, label]) => {
    const card = createElement('div', 'atlas-stat');
    card.append(createElement('strong', '', value), createElement('span', '', label));
    return card;
  }));
}

function renderAtlasFilters() {
  const ids = ['all', ...(state.atlas.taxonomy || []).map(item => item.id), ...ATLAS_PERSONAS];
  elements.atlasFilters.replaceChildren(...ids.map(id => {
    const button = createElement('button', 'atlas-filter', atlasCategoryLabel(id));
    button.type = 'button';
    button.dataset.atlasFilter = id;
    button.setAttribute('aria-pressed', String(state.atlasFilter === id));
    return button;
  }));
}

function renderAtlasList() {
  const lenses = filteredAtlasLenses();
  if (!lenses.length) {
    elements.atlasList.replaceChildren(createElement('div', 'empty-state', 'Bu filtrede yaklaşım bulunmuyor.'));
    return;
  }
  elements.atlasList.replaceChildren(...lenses.map(lens => {
    const card = createElement('button', 'atlas-card');
    card.type = 'button';
    card.dataset.atlasLens = lens.slug;
    card.setAttribute('aria-current', String(state.atlasSelected === lens.slug));
    const image = createElement('img');
    image.src = atlasImageUrl(lens.image);
    image.alt = `${lens.name} sabit mekân varyantı`;
    image.loading = 'lazy';
    const body = createElement('div', 'atlas-card-body');
    const meta = createElement('div', 'atlas-card-meta');
    meta.append(createElement('span', '', `${lens.number} · ${atlasCategoryLabel(lens.category)}`), createElement('span', '', humanize(lens.admin.status)));
    body.append(meta, createElement('h3', '', lens.name), createElement('p', '', lens.admin.frictions.join(' · ')));
    card.append(image, body);
    return card;
  }));
}

function appendAtlasSection(container, title, rows) {
  container.append(createElement('h3', '', title));
  rows.forEach(row => container.append(row));
}

function atlasLensName(slug) {
  const lens = state.atlas && state.atlas.lenses.find(item => item.slug === slug);
  return lens ? lens.name : humanize(slug);
}

function createAtlasList(items, className = 'atlas-bullet-list') {
  const list = createElement('ul', className);
  (items || []).forEach(item => list.append(createElement('li', '', item)));
  return list;
}

function createAtlasDefinition(label, value) {
  const card = createElement('article', 'atlas-definition');
  card.append(createElement('strong', '', label), createElement('p', '', value || 'Kayıt bekliyor.'));
  return card;
}

function renderAtlasComparisonOptions() {
  const sets = state.atlas.comparison_sets || [];
  state.atlasComparison = state.atlasComparison || (sets[0] && sets[0].id);
  elements.atlasComparisonSelect.replaceChildren(...sets.map(set => {
    const option = createElement('option', '', set.label);
    option.value = set.id;
    option.selected = set.id === state.atlasComparison;
    return option;
  }));
}

function renderAtlasComparison() {
  const set = state.atlas && (state.atlas.comparison_sets || []).find(item => item.id === state.atlasComparison);
  if (!set) {
    elements.atlasComparisonPanel.replaceChildren(createElement('div', 'empty-state', 'Karşılaştırma kaydı yok.'));
    return;
  }
  const header = createElement('div', 'atlas-comparison-copy');
  header.append(createElement('strong', '', set.question), createElement('p', '', set.decision_note));
  const grid = createElement('div', 'atlas-comparison-grid');
  set.lenses.forEach(slug => {
    const lens = state.atlas.lenses.find(item => item.slug === slug);
    if (!lens) return;
    const card = createElement('button', 'atlas-comparison-card');
    card.type = 'button';
    card.dataset.atlasLens = slug;
    card.append(
      createElement('span', '', lens.name),
      createElement('strong', '', lens.public.philosophy.spatial_why),
      createElement('small', '', `Boşluk: ${lens.public.philosophy.role_of_empty_space}`)
    );
    grid.append(card);
  });
  elements.atlasComparisonPanel.replaceChildren(header, grid);
}

const ATLAS_TABS = [
  ['overview', 'Karar özeti'],
  ['philosophy', 'Felsefe DNA’sı'],
  ['rooms', 'Oda protokolleri'],
  ['references', 'Referanslar'],
  ['claims', 'İddia & kaynak'],
  ['hybrids', 'Hibrit & bağlam']
];

function renderAtlasTabNav() {
  const nav = createElement('div', 'atlas-detail-tabs');
  nav.setAttribute('role', 'tablist');
  ATLAS_TABS.forEach(([id, label]) => {
    const button = createElement('button', 'atlas-detail-tab', label);
    button.type = 'button';
    button.dataset.atlasTab = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(state.atlasTab === id));
    nav.append(button);
  });
  return nav;
}

function renderAtlasOverview(lens) {
  const panel = createElement('div', 'atlas-tab-panel');
  panel.append(createAtlasDefinition('En uygun kullanım', lens.public.best_for));
  panel.append(createAtlasDefinition('Dikkat sınırı', lens.public.watch_for));

  const tokens = createElement('div', 'atlas-tokens');
  Object.entries(lens.admin.persona_support || {}).forEach(([persona, level]) => {
    tokens.append(createElement('span', `atlas-token ${level}`, `${PERSONA_LABELS[persona] || humanize(persona)} · ${humanize(level)}`));
  });
  appendAtlasSection(panel, 'Persona desteği · teşhis değildir', [tokens]);

  const leverGrid = createElement('div', 'atlas-lever-grid');
  (lens.public.levers || []).forEach(lever => {
    const card = createElement('article', 'atlas-lever');
    card.append(
      createElement('strong', '', lever.name),
      createElement('p', '', lever.abstract),
      createElement('small', '', `Hamle: ${lever.concrete}`),
      createElement('small', '', `Test: ${lever.success_test}`)
    );
    leverGrid.append(card);
  });
  appendAtlasSection(panel, 'Tasarım kaldıraçları', [leverGrid]);
  appendAtlasSection(panel, 'Başarısızlık biçimleri', [createAtlasList(lens.admin.failure_modes)]);
  panel.append(createAtlasDefinition('Proje kullanım kuralı', lens.admin.context_rule));
  return panel;
}

function renderAtlasPhilosophy(lens) {
  const philosophy = lens.public.philosophy || {};
  const panel = createElement('div', 'atlas-tab-panel');
  const grid = createElement('div', 'atlas-definition-grid');
  [
    ['Felsefi öz', philosophy.core],
    ['Mekânsal neden', philosophy.spatial_why],
    ['Boşluğun rolü', philosophy.role_of_empty_space],
    ['Malzeme mantığı', philosophy.material_logic],
    ['Işık mantığı', philosophy.light_logic],
    ['Sosyal mantık', philosophy.social_logic]
  ].forEach(([label, value]) => grid.append(createAtlasDefinition(label, value)));
  panel.append(grid);
  appendAtlasSection(panel, 'Bununla karıştırmayın', [createAtlasList(lens.public.not_to_confuse_with)]);
  return panel;
}

function renderAtlasRooms(lens) {
  const panel = createElement('div', 'atlas-tab-panel atlas-room-protocols');
  (state.atlas.rooms || []).forEach((room, index) => {
    const protocol = lens.public.room_applications[room.id];
    const details = createElement('details', 'atlas-room-detail');
    if (index === 0) details.open = true;
    const summary = createElement('summary');
    summary.append(createElement('strong', '', room.label), createElement('span', '', humanize(protocol.evidence_status)));
    const content = createElement('div', 'atlas-room-detail-body');
    [
      ['Amaç', protocol.intent],
      ['Ana mekânsal hamle', protocol.move],
      ['Mobilya ve yerleşim', protocol.furniture_direction],
      ['Malzeme', protocol.material_direction],
      ['Işık', protocol.lighting_direction],
      ['Kaçınılacaklar', protocol.avoid],
      ['Başarı testi', protocol.success_test],
      ['Doğrulama', protocol.verification]
    ].forEach(([label, value]) => content.append(createAtlasDefinition(label, value)));
    const checks = createElement('div', 'atlas-checks');
    (protocol.project_checks || []).forEach(check => checks.append(createElement('span', '', check)));
    content.append(createElement('strong', 'atlas-inline-label', 'Proje kontrolleri'), checks);
    details.append(summary, content);
    panel.append(details);
  });
  return panel;
}

function renderAtlasReferences(lens, sourceMap) {
  const panel = createElement('div', 'atlas-tab-panel');
  const references = (state.atlas.reference_registry || []).filter(reference => (lens.public.reference_ids || []).includes(reference.id));
  references.forEach(reference => {
    const card = createElement('article', 'atlas-reference-card');
    card.append(
      createElement('span', 'atlas-reference-type', humanize(reference.type)),
      createElement('strong', '', reference.label),
      createElement('p', '', `${reference.creator} · ${reference.year}`),
      createElement('p', '', reference.principle),
      createElement('small', '', reference.use_as)
    );
    const links = createElement('div', 'atlas-reference-links');
    (reference.source_refs || []).forEach(sourceId => {
      const source = sourceMap.get(sourceId);
      if (!source) return;
      const link = createElement('a', '', source.label);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener';
      links.append(link);
    });
    card.append(links);
    panel.append(card);
  });
  if (!references.length) panel.append(createElement('div', 'empty-state', 'Referans kaydı bekliyor.'));
  panel.append(createAtlasDefinition('Referans kullanım kuralı', state.atlas.research_governance.reference_rule));
  return panel;
}

function renderAtlasClaims(lens, sourceMap) {
  const panel = createElement('div', 'atlas-tab-panel');
  const claimRows = (lens.admin.claims || []).map(claim => {
    const row = createElement('div', 'atlas-claim');
    row.append(createElement('strong', '', `${humanize(claim.type)} · ${humanize(claim.status)}`));
    row.append(createElement('p', '', claim.text), createElement('small', '', claim.scope));
    return row;
  });
  appendAtlasSection(panel, 'İddia kayıtları', claimRows);
  panel.append(createAtlasDefinition('İddia sınırı', lens.admin.claim_caution));

  const sourceRows = (lens.admin.source_refs || []).map(sourceId => {
    const source = sourceMap.get(sourceId);
    if (!source) return null;
    const row = createElement('div', 'atlas-source');
    const link = createElement('a', '', source.label);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener';
    row.append(link, createElement('p', '', source.claim_scope), createElement('small', '', `Sınır: ${source.limitations}`));
    return row;
  }).filter(Boolean);
  appendAtlasSection(panel, 'Kaynak bağlantıları', sourceRows.length ? sourceRows : [createElement('div', 'atlas-source', 'Kaynak kaydı bekliyor.')]);
  appendAtlasSection(panel, 'Canlı yayından ayrılmış içerik', [createAtlasList(state.atlas.research_governance.public_claim_quarantine)]);
  return panel;
}

function renderAtlasHybrids(lens) {
  const panel = createElement('div', 'atlas-tab-panel');
  panel.append(createAtlasDefinition('Seçim kuralı', state.atlas.hybrid_framework.selection_rule));
  panel.append(createAtlasDefinition('Persona sınırı', state.atlas.hybrid_framework.persona_boundary));
  const relationGrid = createElement('div', 'atlas-relation-grid');
  const compatible = createElement('article', 'atlas-relation compatible');
  compatible.append(createElement('strong', '', 'Uyumlu destekleyiciler'), createAtlasList((lens.admin.hybrid_relations.compatible || []).map(atlasLensName)));
  const tensions = createElement('article', 'atlas-relation tension');
  tensions.append(createElement('strong', '', 'Açıkça çözülmesi gereken gerilimler'), createAtlasList((lens.admin.hybrid_relations.tensions || []).map(atlasLensName)));
  relationGrid.append(compatible, tensions);
  panel.append(relationGrid);
  appendAtlasSection(panel, 'Hibrit çatışma testi', [createAtlasList(state.atlas.hybrid_framework.conflict_test)]);

  const context = state.atlas.local_context;
  const local = createElement('article', 'atlas-local-context');
  local.append(createElement('span', 'atlas-reference-type', context.label), createElement('strong', '', 'Yerel bağlam kontrolü'), createElement('p', '', context.public_boundary));
  local.append(createAtlasList(context.checks));
  const suggestion = (context.suggested_lenses || []).find(item => item.lens === lens.slug);
  if (suggestion) local.append(createElement('small', '', `Bu yaklaşım için bağlam notu: ${suggestion.reason}`));
  panel.append(local);
  return panel;
}

function renderAtlasDetail() {
  const lens = state.atlas && state.atlas.lenses.find(item => item.slug === state.atlasSelected);
  if (!lens) {
    elements.atlasDetail.replaceChildren(createElement('div', 'empty-state', 'Bir yaklaşım seçin.'));
    return;
  }
  const sourceMap = new Map((state.atlas.sources || []).map(source => [source.id, source]));
  const hero = createElement('div', 'atlas-detail-hero');
  const image = createElement('img');
  image.src = atlasImageUrl(lens.image);
  image.alt = lens.name;
  hero.append(image, createElement('span', 'atlas-detail-badge', `${humanize(lens.evidence_type)} · ${humanize(lens.confidence)}`));

  const body = createElement('div', 'atlas-detail-body');
  body.append(createElement('span', 'section-kicker', `${lens.number} · ${atlasCategoryLabel(lens.category)}`));
  body.append(createElement('h2', '', lens.name));
  body.append(createElement('p', '', lens.public.room_reading));

  body.append(renderAtlasTabNav());
  const panels = {
    overview: () => renderAtlasOverview(lens),
    philosophy: () => renderAtlasPhilosophy(lens),
    rooms: () => renderAtlasRooms(lens),
    references: () => renderAtlasReferences(lens, sourceMap),
    claims: () => renderAtlasClaims(lens, sourceMap),
    hybrids: () => renderAtlasHybrids(lens)
  };
  body.append((panels[state.atlasTab] || panels.overview)());

  elements.atlasDetail.replaceChildren(hero, body);
}

async function loadAtlas() {
  setMessage(elements.atlasError, '');
  try {
    const payload = await api('/api/protocol-admin/spatial-atlas');
    state.atlas = payload.atlas;
    state.atlasSelected = state.atlasSelected || (state.atlas.lenses[0] && state.atlas.lenses[0].slug);
    renderAtlasStats();
    renderAtlasFilters();
    renderAtlasComparisonOptions();
    renderAtlasComparison();
    renderAtlasList();
    renderAtlasDetail();
    elements.atlasBoundary.textContent = `${state.atlas.publication.evidence_boundary} ${state.atlas.publication.persona_boundary}`;
  } catch (error) {
    setMessage(elements.atlasError, error.message);
  }
}

async function showAtlas() {
  state.module = 'atlas';
  elements.projectListView.hidden = true;
  elements.newProjectView.hidden = true;
  elements.projectDetailView.hidden = true;
  elements.atlasView.hidden = false;
  elements.newProjectButton.hidden = true;
  elements.workspaceKicker.textContent = 'TASARIM BİLGİ SİSTEMİ';
  elements.workspaceTitle.textContent = 'Mekânsal Tasarım Atlası';
  elements.moduleButtons.forEach(button => button.classList.toggle('active', button.dataset.module === 'atlas'));
  if (!state.atlas) await loadAtlas();
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
      humanize(project.space_type),
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
  const sourceLabels = {
    unknown: 'Henüz doğrulanmadı',
    client_reported: 'Müşteri beyanı',
    plan_measured: 'Ölçülü plan',
    site_measured: 'Sahada ölçüldü'
  };
  const lines = [
    value.room_width_cm ? `Genişlik: ${value.room_width_cm} cm` : '',
    value.room_length_cm ? `Uzunluk: ${value.room_length_cm} cm` : '',
    value.ceiling_height_cm ? `Tavan: ${value.ceiling_height_cm} cm` : '',
    value.source_status ? `Kaynak: ${sourceLabels[value.source_status] || humanize(value.source_status)}` : '',
    value.raw_text || ''
  ].filter(Boolean);
  return lines.join('\n') || '-';
}

function renderBriefReadiness(project) {
  const measurements = project.measurements && typeof project.measurements === 'object'
    ? project.measurements
    : {};
  const geometryCount = [
    measurements.room_width_cm,
    measurements.room_length_cm,
    measurements.ceiling_height_cm
  ].filter(Boolean).length;
  const source = measurements.source_status || 'unknown';
  const items = [
    {
      label: 'Müşteri anlatımı',
      value: project.client_narrative && project.client_narrative.length > 80 ? 'Yeterli başlangıç' : 'Detay gerekli',
      tone: project.client_narrative && project.client_narrative.length > 80 ? 'ready' : 'attention'
    },
    {
      label: 'Temel geometri',
      value: `${geometryCount}/3 ölçü`,
      tone: geometryCount === 3 ? 'ready' : 'attention'
    },
    {
      label: 'Ölçü güveni',
      value: source === 'site_measured' || source === 'plan_measured' ? 'Doğrulanabilir kaynak' : 'Saha kontrolü gerekli',
      tone: source === 'site_measured' || source === 'plan_measured' ? 'ready' : 'attention'
    },
    {
      label: 'Sabit elemanlar',
      value: rawText(project.fixed_elements) !== '-' ? 'Kayıtlı' : 'Eksik',
      tone: rawText(project.fixed_elements) !== '-' ? 'ready' : 'attention'
    }
  ];
  elements.briefReadiness.replaceChildren();
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `readiness-item ${item.tone}`;
    const label = document.createElement('span');
    label.textContent = item.label;
    const value = document.createElement('strong');
    value.textContent = item.value;
    card.append(label, value);
    elements.briefReadiness.appendChild(card);
  });
}

const ATLAS_SIGNAL_MAP = {
  'bauhaus-modernist': ['netlik', 'düzen', 'eksen', 'işlev', 'karmaşa'],
  minimalism: ['sade', 'fazlalık', 'dağınık', 'temiz', 'az eşya', 'odak'],
  'japanese-minimalism': ['sakin', 'ritüel', 'boşluk', 'eşik', 'sessiz'],
  biophilic: ['doğa', 'bitki', 'gün ışığı', 'manzara', 'iyileşme'],
  ergonomic: ['ergonomi', 'ağrı', 'çalışma', 'erişim', 'verim', 'konfor'],
  scandinavian: ['sıcak', 'aile', 'rahat', 'aydınlık', 'hygge', 'samimi'],
  'organic-architecture': ['organik', 'akış', 'bütünlük', 'doğa', 'yer'],
  parametric: ['modüler', 'değişken', 'sistem', 'üretim', 'uyarlanabilir'],
  'feng-shui': ['giriş', 'denge', 'yönelim', 'destek', 'akış'],
  'wabi-sabi': ['kusur', 'yaşlanma', 'patina', 'doğal', 'sakin'],
  'sustainable-circular': ['sürdürülebilir', 'onarım', 'döngüsel', 'atık', 'dayanıklı'],
  'controlled-maximalism': ['renk', 'koleksiyon', 'ifade', 'katman', 'cesur'],
  japandi: ['sade', 'sıcak', 'doğal', 'düzen', 'huzur'],
  'mid-century-modern': ['sosyallik', 'hafif', 'açık plan', 'modern', 'televizyon'],
  'art-deco': ['lüks', 'simetri', 'geometrik', 'dramatik', 'gösterişli'],
  brutalism: ['ham', 'beton', 'ağır', 'dürüst', 'anıtsal'],
  postmodernism: ['oyun', 'mizah', 'renk', 'kimlik', 'beklenmedik'],
  'industrial-adaptive-reuse': ['endüstriyel', 'yeniden kullanım', 'eski yapı', 'tuğla', 'tesisat'],
  'universal-inclusive': ['erişilebilir', 'engelli', 'çocuk', 'yaşlı', 'kapsayıcı', 'güvenli'],
  'sensory-regulated': ['duyusal', 'otizm', 'ses', 'parlama', 'uyaran', 'geri çekilme']
};

function normalizeSearchText(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function projectPersonaLevels() {
  const levels = {};
  const allocations = state.currentDraft && state.currentDraft.content && state.currentDraft.content.persona_allocations || [];
  allocations.filter(item => item.scope === 'project').forEach(item => {
    levels[item.persona] = Number(item.percentage) || 0;
  });
  return levels;
}

function recommendAtlasLenses(project) {
  if (!state.atlas) return [];
  const projectText = normalizeSearchText([
    project.client_narrative,
    rawText(project.fixed_elements),
    rawText(project.measurements),
    humanize(project.space_type),
    state.currentDraft && state.currentDraft.content && state.currentDraft.content.diagnosis && state.currentDraft.content.diagnosis.core_problem
  ].filter(Boolean).join(' '));
  const projectWords = new Set(projectText.split(/[^a-z0-9çğıöşü]+/i).filter(word => word.length >= 5));
  const personaLevels = projectPersonaLevels();
  return state.atlas.lenses.map(lens => {
    let score = 0;
    const reasons = [];
    const signals = ATLAS_SIGNAL_MAP[lens.slug] || [];
    const matchedSignals = signals.filter(signal => projectText.includes(normalizeSearchText(signal)));
    if (matchedSignals.length) {
      score += matchedSignals.length * 5;
      reasons.push(`Anlatımdaki “${matchedSignals.slice(0, 2).join('” ve “')}” sinyalleriyle örtüşüyor.`);
    }
    const lensText = normalizeSearchText([
      lens.name,
      lens.subtitle,
      lens.public.summary,
      lens.public.best_for,
      ...(lens.admin.frictions || []),
      ...(lens.admin.requirements || [])
    ].join(' '));
    const overlaps = [...projectWords].filter(word => lensText.includes(word)).slice(0, 3);
    if (overlaps.length) {
      score += overlaps.length * 2;
      reasons.push(`Proje diliyle ortak karar alanları: ${overlaps.join(', ')}.`);
    }
    Object.entries(personaLevels).forEach(([persona, percentage]) => {
      const support = lens.admin.persona_support && lens.admin.persona_support[persona];
      if (!support || percentage < 15) return;
      const points = support === 'strong' ? 7 : support === 'medium' ? 3 : 0;
      score += points * (percentage / 100);
      if (points && percentage >= 25) reasons.push(`${PERSONA_LABELS[persona] || persona} dağılımını ${humanize(support)} düzeyde destekliyor.`);
    });
    if (lens.slug === 'ergonomic' && ['office', 'commercial'].includes(project.space_type)) score += 3;
    if (lens.slug === 'universal-inclusive' && projectText.includes('eris')) score += 4;
    return { lens, score: Math.round(score * 10) / 10, reasons: reasons.slice(0, 2) };
  }).sort((a, b) => b.score - a.score || Number(a.lens.number) - Number(b.lens.number)).slice(0, 3);
}

function fillAtlasSelectionOptions(selection) {
  const controls = [elements.atlasPrimarySelect, elements.atlasSupportingSelect, elements.atlasAlternativeSelect];
  controls.forEach(control => {
    const current = control.value;
    control.replaceChildren(createElement('option', '', 'Seçilmedi'));
    control.firstElementChild.value = '';
    state.atlas.lenses.forEach(lens => {
      const option = createElement('option', '', `${lens.number} · ${lens.name}`);
      option.value = lens.slug;
      control.append(option);
    });
    control.value = current;
  });
  elements.atlasPrimarySelect.value = selection && selection.primary_lens_slug || '';
  elements.atlasSupportingSelect.value = selection && selection.supporting_lens_slug || '';
  elements.atlasAlternativeSelect.value = selection && selection.alternative_lens_slug || '';
  elements.atlasSelectionRationale.value = selection && selection.rationale || '';
}

function renderProjectAtlasRecommendations(useAsSelection = false) {
  state.atlasRecommendations = recommendAtlasLenses(state.currentProject);
  const roleLabels = ['Birincil öneri', 'Destekleyici öneri', 'Alternatif öneri'];
  elements.atlasRecommendations.replaceChildren(...state.atlasRecommendations.map((item, index) => {
    const card = createElement('article', 'project-atlas-card');
    const image = createElement('img');
    image.src = atlasImageUrl(item.lens.image);
    image.alt = `${item.lens.name} yaklaşımı`;
    const body = createElement('div', 'project-atlas-card-body');
    body.append(
      createElement('span', 'project-atlas-role', roleLabels[index]),
      createElement('h4', '', item.lens.name),
      createElement('p', '', item.reasons[0] || item.lens.public.best_for),
      createElement('small', '', `Eşleşme puanı: ${item.score}`)
    );
    card.append(image, body);
    return card;
  }));
  if (useAsSelection && state.atlasRecommendations.length) {
    elements.atlasPrimarySelect.value = state.atlasRecommendations[0] && state.atlasRecommendations[0].lens.slug || '';
    elements.atlasSupportingSelect.value = state.atlasRecommendations[1] && state.atlasRecommendations[1].lens.slug || '';
    elements.atlasAlternativeSelect.value = state.atlasRecommendations[2] && state.atlasRecommendations[2].lens.slug || '';
    const names = state.atlasRecommendations.map(item => item.lens.name);
    elements.atlasSelectionRationale.value = `Birincil yaklaşım olarak ${names[0]} önerildi. ${names[1] || 'İkinci yaklaşım'} destekleyici, ${names[2] || 'üçüncü yaklaşım'} ise alternatif karar çerçevesi olarak değerlendirilecek. Nihai seçim ölçü, dolaşım, kullanıcı rutini ve proje kanıtlarıyla doğrulanmalıdır.`;
  }
}

async function prepareProjectAtlas(selection) {
  if (!state.atlas) await loadAtlas();
  state.currentAtlasSelection = selection || null;
  fillAtlasSelectionOptions(selection);
  renderProjectAtlasRecommendations(!selection);
  setMessage(elements.atlasSelectionMessage, selection ? 'Bu revizyon için kayıtlı Atlas seçimi yüklendi.' : 'Üç başlangıç önerisi hazırlandı; kaydetmeden önce düzenleyebilirsin.');
}

function humanize(value) {
  const key = String(value || '');
  return PERSONA_LABELS[key] || TERM_LABELS[key] || key.replaceAll('_', ' ');
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
    if (item.tradeoff) grid.appendChild(draftField('Taviz', item.tradeoff, `decisions.${index}.tradeoff`));
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

function showProtocolStep(step) {
  const hasDraft = Boolean(state.currentDraft && state.currentDraft.status === 'ready' && state.currentDraft.content);
  const target = WORKFLOW_STEPS.includes(step) && (step === 'brief' || hasDraft) ? step : 'brief';
  state.currentStep = target;
  elements.protocolBriefPanel.hidden = target !== 'brief';
  elements.protocolDraftSection.hidden = target === 'brief' || !hasDraft;
  elements.protocolWorkflowNav.querySelectorAll('[data-workflow-step]').forEach(button => {
    const buttonStep = button.dataset.workflowStep;
    button.disabled = buttonStep !== 'brief' && !hasDraft;
    button.classList.toggle('active', buttonStep === target);
    button.setAttribute('aria-current', buttonStep === target ? 'step' : 'false');
  });
  elements.protocolDraftSection.querySelectorAll('[data-workflow-panel]').forEach(panel => {
    const matches = panel.dataset.workflowPanel === target;
    const hasWarnings = panel !== elements.protocolWarningReview ||
      Boolean(state.currentDraft && state.currentDraft.quality_gate_result &&
        state.currentDraft.quality_gate_result.warnings &&
        state.currentDraft.quality_gate_result.warnings.length);
    panel.hidden = !matches || !hasWarnings;
  });
  const index = WORKFLOW_STEPS.indexOf(target);
  elements.protocolStepPrev.hidden = index <= 0;
  elements.protocolStepNext.hidden = index < 1 || index >= WORKFLOW_STEPS.length - 1;
  elements.protocolApprove.hidden = target !== 'review' || Boolean(state.currentApproval);
  elements.protocolPdf.hidden = target !== 'review' || !state.currentApproval;
  elements.protocolSave.hidden = target === 'brief' || Boolean(state.currentApproval);
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

  if (!draft) {
    showProtocolStep('brief');
    return;
  }
  if (draft.status === 'generating') {
    elements.protocolGenerate.disabled = true;
    setMessage(elements.protocolActionMessage, 'Protokol üretiliyor. Bu ekranı açık tut.');
    showProtocolStep('brief');
    return;
  }
  if (draft.status === 'failed') {
    setMessage(elements.protocolActionError, 'Önceki üretim tamamlanamadı. Kanıtları kontrol edip tekrar deneyebilirsin.');
    showProtocolStep('brief');
    return;
  }
  if (draft.status !== 'ready' || !draft.content) {
    showProtocolStep('brief');
    return;
  }

  elements.protocolGenerate.hidden = true;
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
  showProtocolStep(state.currentStep);
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
    document.getElementById('detail-space').textContent = humanize(project.space_type);
    document.getElementById('detail-revision').textContent = `R${project.revision_number}`;
    document.getElementById('detail-status').textContent = statusLabel(project.status);
    document.getElementById('detail-narrative').textContent = project.client_narrative;
    document.getElementById('detail-measurements').textContent = rawText(project.measurements);
    document.getElementById('detail-fixed').textContent = rawText(project.fixed_elements);
    state.currentProjectId = project.id;
    state.currentProject = project;
    state.currentApproval = payload.approval || null;
    state.currentStep = 'brief';
    renderBriefReadiness(project);
    renderProtocolDraft(payload.protocol_draft, payload.approval);
    await prepareProjectAtlas(payload.atlas_selection);
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

elements.moduleButtons.forEach(button => {
  button.addEventListener('click', async () => {
    if (button.dataset.module === 'atlas') await showAtlas();
    else showWorkspace('list');
  });
});

elements.atlasSearch.addEventListener('input', renderAtlasList);
elements.atlasFilters.addEventListener('click', event => {
  const button = event.target.closest('[data-atlas-filter]');
  if (!button) return;
  state.atlasFilter = button.dataset.atlasFilter;
  renderAtlasFilters();
  renderAtlasList();
});
elements.atlasList.addEventListener('click', event => {
  const card = event.target.closest('[data-atlas-lens]');
  if (!card) return;
  state.atlasSelected = card.dataset.atlasLens;
  state.atlasTab = 'overview';
  renderAtlasList();
  renderAtlasDetail();
});
elements.atlasDetail.addEventListener('click', event => {
  const tab = event.target.closest('[data-atlas-tab]');
  if (!tab) return;
  state.atlasTab = tab.dataset.atlasTab;
  renderAtlasDetail();
});
elements.atlasComparisonSelect.addEventListener('change', event => {
  state.atlasComparison = event.target.value;
  renderAtlasComparison();
});
elements.atlasComparisonPanel.addEventListener('click', event => {
  const card = event.target.closest('[data-atlas-lens]');
  if (!card) return;
  state.atlasSelected = card.dataset.atlasLens;
  state.atlasTab = 'philosophy';
  renderAtlasList();
  renderAtlasDetail();
  elements.atlasDetail.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

elements.newProjectButton.addEventListener('click', () => {
  elements.projectForm.reset();
  setMessage(elements.projectFormError, '');
  showWorkspace('new');
});
elements.cancelProjectButton.addEventListener('click', () => showWorkspace('list'));
elements.backProjectsButton.addEventListener('click', () => showWorkspace('list'));
elements.projectSearch.addEventListener('input', renderProjects);
elements.protocolWorkflowNav.addEventListener('click', event => {
  const button = event.target.closest('[data-workflow-step]');
  if (!button || button.disabled) return;
  showProtocolStep(button.dataset.workflowStep);
});
elements.protocolStepPrev.addEventListener('click', () => {
  const index = WORKFLOW_STEPS.indexOf(state.currentStep);
  if (index > 0) showProtocolStep(WORKFLOW_STEPS[index - 1]);
});
elements.protocolStepNext.addEventListener('click', () => {
  const index = WORKFLOW_STEPS.indexOf(state.currentStep);
  if (index >= 0 && index < WORKFLOW_STEPS.length - 1) showProtocolStep(WORKFLOW_STEPS[index + 1]);
});

elements.atlasRecommend.addEventListener('click', () => {
  if (!state.currentProject || !state.atlas) return;
  renderProjectAtlasRecommendations(true);
  setMessage(elements.atlasSelectionMessage, 'Öneriler güncellendi. Seçimleri ve gerekçeyi kontrol edip kaydedebilirsin.');
});

elements.atlasSaveSelection.addEventListener('click', async () => {
  if (!state.currentProjectId) return;
  const selected = [
    elements.atlasPrimarySelect.value,
    elements.atlasSupportingSelect.value,
    elements.atlasAlternativeSelect.value
  ].filter(Boolean);
  if (!elements.atlasPrimarySelect.value) {
    setMessage(elements.atlasSelectionMessage, 'Kaydetmek için bir birincil yaklaşım seçmelisin.');
    return;
  }
  if (new Set(selected).size !== selected.length) {
    setMessage(elements.atlasSelectionMessage, 'Üç seçim birbirinden farklı olmalı.');
    return;
  }
  elements.atlasSaveSelection.disabled = true;
  setMessage(elements.atlasSelectionMessage, 'Atlas seçimi kaydediliyor…');
  try {
    const payload = await api(`/api/protocol-admin/projects/${encodeURIComponent(state.currentProjectId)}/atlas-selection`, {
      method: 'PUT',
      body: JSON.stringify({
        primary_lens_slug: elements.atlasPrimarySelect.value,
        supporting_lens_slug: elements.atlasSupportingSelect.value,
        alternative_lens_slug: elements.atlasAlternativeSelect.value,
        rationale: elements.atlasSelectionRationale.value.trim()
      })
    });
    state.currentAtlasSelection = payload.atlas_selection;
    setMessage(elements.atlasSelectionMessage, 'Atlas seçimi bu proje revizyonuna kaydedildi.');
  } catch (error) {
    setMessage(elements.atlasSelectionMessage, error.message);
  } finally {
    elements.atlasSaveSelection.disabled = false;
  }
});

elements.atlasOpenSelection.addEventListener('click', async () => {
  const slug = elements.atlasPrimarySelect.value || elements.atlasSupportingSelect.value || elements.atlasAlternativeSelect.value;
  await showAtlas();
  if (!slug) return;
  state.atlasSelected = slug;
  state.atlasTab = 'overview';
  renderAtlasList();
  renderAtlasDetail();
});

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
    state.currentStep = 'diagnosis';
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
        : 'İlk yönetici hesabı henüz yapılandırılmadı.';
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
    setMessage(elements.setupMessage, 'Protokol yönetim sistemi şu anda kullanılamıyor.');
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/protocol-admin/sw.js?v=atlas-tr-20260817-1', {
      scope: '/protocol-admin/',
      updateViaCache: 'none'
    }).then(registration => registration.update()).catch(() => {});
  });
}

initialize();
