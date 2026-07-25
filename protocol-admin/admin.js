const state = {
  user: null,
  projects: []
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
  emptyProjects: document.getElementById('empty-projects')
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
