const puppeteer = require('puppeteer');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function text(value, fallback = '-') {
  const result = String(value == null ? '' : value).trim();
  return escapeHtml(result || fallback);
}

function label(value) {
  return text(String(value || '').replaceAll('_', ' '));
}

function sectionNumber(index) {
  return String(index).padStart(2, '0');
}

function renderPersonaMix(items) {
  return (items || [])
    .filter(item => item.scope === 'project')
    .map(item => `
      <div class="persona">
        <div><strong>${label(item.persona)}</strong><b>${Number(item.percentage || 0).toFixed(0)}%</b></div>
        <span><i style="width:${Math.max(0, Math.min(100, Number(item.percentage || 0)))}%"></i></span>
        <p>${text(item.rationale)}</p>
      </div>`)
    .join('');
}

function renderProtocolRules(items) {
  return (items || []).map((item, index) => `
    <article class="rule avoid-break">
      <header><b>${sectionNumber(index + 1)}</b><span>${label(item.confidence)} / ${label(item.verification_status)}</span></header>
      <dl>
        <div><dt>Tetikleyici</dt><dd>${text(item.trigger)}</dd></div>
        <div><dt>Soyut ihtiyaç</dt><dd>${text(item.abstract_prescription)}</dd></div>
        <div><dt>Somut karar</dt><dd>${text(item.concrete_prescription)}</dd></div>
        <div><dt>Başarı testi</dt><dd>${text(item.success_test)}</dd></div>
      </dl>
    </article>`).join('');
}

function renderDecisions(items) {
  return (items || []).map((item, index) => `
    <article class="decision avoid-break">
      <header>
        <div><b>${sectionNumber(index + 1)}</b><h3>${text(item.title)}</h3></div>
        <span>${label(item.status)} / ${label(item.confidence)}</span>
      </header>
      <p class="decision-main">${text(item.concrete_decision)}</p>
      <div class="decision-grid">
        <p><small>Soyut ihtiyaç</small>${text(item.abstract_need)}</p>
        <p><small>Başarı testi</small>${text(item.success_test)}</p>
        ${item.tradeoff ? `<p><small>Taviz</small>${text(item.tradeoff)}</p>` : ''}
        ${item.required_measurements && item.required_measurements.length
          ? `<p><small>Gerekli ölçüler</small>${text(item.required_measurements.join(', '))}</p>`
          : ''}
      </div>
    </article>`).join('');
}

function renderVerifications(items) {
  if (!(items || []).length) return '<p class="empty">Açık doğrulama bulunmuyor.</p>';
  return items.map(item => `
    <article class="verification avoid-break">
      <span class="${item.status === 'verified' ? 'verified' : 'pending'}">${label(item.status)}</span>
      <div>
        <p>${text(item.statement)}</p>
        ${item.resolution ? `<small>Çözüm: ${text(item.resolution)}</small>` : ''}
      </div>
    </article>`).join('');
}

function renderEvidence(items) {
  return (items || []).map((item, index) => `
    <tr>
      <td>E${index + 1}</td>
      <td>${label(item.category)}</td>
      <td>${text(item.statement)}</td>
      <td>${label(item.confidence)}</td>
      <td>${label(item.verification_status)}</td>
    </tr>`).join('');
}

function sourceTypeLabel(value) {
  const labels = {
    photo: 'Mekân fotoğrafı',
    measured_plan: 'Ölçülü plan veya çizim',
    uploaded_document: 'Proje belgesi'
  };
  return text(labels[value] || value);
}

function renderSourceFiles(items) {
  if (!(items || []).length) return '<p class="empty">Bu revizyonda yüklenmiş proje dosyası bulunmuyor.</p>';
  return `<table class="source-table">
    <thead><tr><th>Dosya</th><th>Tür</th><th>Sürüm</th><th>SHA-256</th><th>İnceleme</th></tr></thead>
    <tbody>${items.map(item => `
      <tr>
        <td>${text(item.filename)}</td>
        <td>${sourceTypeLabel(item.source_type)}</td>
        <td>${text(item.revision)}</td>
        <td class="hash">${text(String(item.sha256 || '').slice(0, 16))}…</td>
        <td>${label(item.ai_review_status)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function safePaletteColor(value) {
  return /^#[a-f0-9]{6}$/i.test(String(value || '')) ? value : '#d7d5cd';
}

function renderAtlasLens(role, lens, primary = false) {
  if (!lens) return '';
  return `<article class="atlas-lens ${primary ? 'primary' : ''} avoid-break">
    <span>${text(role)}</span>
    <h3>${text(lens.name)}</h3>
    <p class="atlas-subtitle">${text(lens.subtitle)}</p>
    <p>${text(lens.summary)}</p>
    ${lens.spatial_why ? `<p><small>Mekânsal neden</small>${text(lens.spatial_why)}</p>` : ''}
    ${lens.watch_for ? `<p><small>Dikkat sınırı</small>${text(lens.watch_for)}</p>` : ''}
    <div class="atlas-palette">${(lens.palette || []).map(color => `<i style="background:${safePaletteColor(color)}"></i>`).join('')}</div>
  </article>`;
}

function renderAtlasDirection(direction) {
  if (!direction || !direction.primary) {
    return '<p class="empty">Bu revizyon için bir Atlas yaklaşımı kaydedilmedi.</p>';
  }
  return `
    <p class="lead atlas-lead">${text(direction.rationale, direction.primary.summary)}</p>
    <div class="atlas-direction-grid">
      ${renderAtlasLens('Birincil yaklaşım', direction.primary, true)}
      ${renderAtlasLens('Destekleyici yaklaşım', direction.supporting)}
      ${renderAtlasLens('Alternatif yaklaşım', direction.alternative)}
    </div>
    <div class="atlas-boundary"><strong>Karar sınırı</strong><p>${text(direction.evidence_boundary)} ${text(direction.persona_boundary)}</p></div>`;
}

function renderProtocolReportHtml(approval) {
  const audit = approval.snapshot && approval.snapshot.audit
    ? approval.snapshot.audit
    : approval.snapshot;
  const context = approval.snapshot && approval.snapshot.report_context || {};
  const atlasDirection = approval.snapshot && approval.snapshot.atlas_direction || null;
  const language = audit.project.output_language || 'tr';
  const approvedAt = new Date(approval.approved_at || Date.now());
  const date = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Istanbul'
  }).format(approvedAt);
  const anchors = (audit.identity_anchors || []).map(item => `
    <article class="anchor avoid-break">
      <h3>${text(item.label)}</h3>
      <p>${text(item.description)}</p>
    </article>`).join('');
  const implementation = (audit.implementation_order || [])
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map(item => `<li><b>${sectionNumber(item.sequence)}</b><span>${text(item.title)}</span></li>`)
    .join('');
  const sourceFiles = audit.source_files || [];

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <title>${text(audit.project.name)} - Persona Layouts Protokolü</title>
  <style>
    :root { --ink:#1d211e; --forest:#174f42; --ochre:#b18435; --paper:#f4f2ec; --rule:#d7d5cd; --muted:#676c68; }
    * { box-sizing:border-box; }
    @page { size:A4; margin:17mm 16mm 18mm; }
    body { margin:0; color:var(--ink); font:10.5pt/1.52 Arial, sans-serif; background:white; }
    h1,h2,h3,p { margin-top:0; }
    h1,h2,h3 { font-family:Georgia, serif; font-weight:500; }
    h1 { max-width:150mm; margin-bottom:7mm; font-size:31pt; line-height:1.06; }
    h2 { margin:0 0 6mm; font-size:20pt; line-height:1.15; }
    h3 { font-size:12.5pt; }
    .cover { min-height:255mm; display:flex; flex-direction:column; padding-top:7mm; break-after:page; }
    .brand { display:flex; align-items:center; gap:4mm; color:var(--forest); font-size:9pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .mark { display:grid; width:12mm; height:12mm; place-items:center; background:var(--forest); color:white; font-family:Georgia,serif; }
    .eyebrow { margin:43mm 0 5mm; color:var(--ochre); font-size:9pt; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
    .signature { max-width:145mm; color:#424743; font:italic 15pt/1.48 Georgia,serif; }
    .cover-meta { display:grid; grid-template-columns:repeat(3,1fr); gap:7mm; margin-top:auto; border-top:1px solid var(--ink); padding-top:5mm; }
    .cover-meta small,.meta small,.decision-grid small { display:block; margin-bottom:1.5mm; color:var(--muted); font-size:7pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .cover-meta strong { font-size:9pt; }
    .seal { margin-top:8mm; color:var(--muted); font-size:7pt; overflow-wrap:anywhere; }
    .section { break-before:page; }
    .section-head { display:flex; align-items:baseline; gap:5mm; border-bottom:1px solid var(--ink); margin-bottom:7mm; }
    .section-head b { color:var(--ochre); font:16pt Georgia,serif; }
    .section-head h2 { margin-bottom:3mm; }
    .lead { margin-bottom:7mm; font:15pt/1.45 Georgia,serif; }
    .notice { border-left:3px solid var(--ochre); padding:4mm 5mm; background:var(--paper); color:#404541; }
    .persona-grid,.anchor-grid { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
    .persona,.anchor { border:1px solid var(--rule); padding:4mm; }
    .persona>div { display:flex; justify-content:space-between; text-transform:capitalize; }
    .persona span { display:block; height:2mm; margin:2.5mm 0; background:#e3e1da; }
    .persona i { display:block; height:100%; background:var(--forest); }
    .persona p,.anchor p { margin:0; color:#4f5551; font-size:8.5pt; }
    .rule,.decision { border-top:1px solid var(--rule); padding:5mm 0; }
    .rule header,.decision header,.decision header>div { display:flex; align-items:baseline; justify-content:space-between; gap:4mm; }
    .rule header b,.decision header b { color:var(--ochre); font:14pt Georgia,serif; }
    .rule header span,.decision header>span { color:var(--muted); font-size:7pt; text-transform:uppercase; }
    dl { margin:3mm 0 0; }
    dl div { display:grid; grid-template-columns:31mm 1fr; gap:4mm; padding:2mm 0; }
    dt { color:var(--muted); font-size:7pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    dd { margin:0; }
    .decision h3 { margin:0; }
    .decision-main { margin:3mm 0; font-size:11pt; }
    .decision-grid { display:grid; grid-template-columns:1fr 1fr; gap:4mm; }
    .decision-grid p { margin:0; border:1px solid var(--rule); padding:3mm; font-size:8.5pt; }
    .atlas-lead { max-width:165mm; }
    .atlas-direction-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:4mm; }
    .atlas-lens { position:relative; border:1px solid var(--rule); border-top:3px solid #a7aaa6; padding:4mm; }
    .atlas-lens.primary { border-top-color:var(--ochre); background:#f8f4ea; }
    .atlas-lens>span { display:block; margin-bottom:2mm; color:var(--ochre); font-size:7pt; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
    .atlas-lens h3 { margin-bottom:1mm; }
    .atlas-lens p { color:#4f5551; font-size:8.2pt; }
    .atlas-lens p small { display:block; margin-bottom:1mm; color:var(--muted); font-size:6.8pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .atlas-subtitle { font-style:italic; }
    .atlas-palette { display:flex; gap:1mm; margin-top:4mm; }
    .atlas-palette i { display:block; width:9mm; height:3mm; }
    .atlas-boundary { margin-top:6mm; border-left:3px solid var(--ochre); padding:3mm 4mm; background:var(--paper); }
    .atlas-boundary p { margin:1mm 0 0; color:var(--muted); font-size:7.5pt; }
    .verification { display:grid; grid-template-columns:25mm 1fr; gap:4mm; border-bottom:1px solid var(--rule); padding:4mm 0; }
    .verification span { align-self:start; border:1px solid var(--rule); padding:1mm 2mm; color:#7d382f; font-size:7pt; font-weight:700; text-align:center; text-transform:uppercase; }
    .verification span.verified { color:var(--forest); border-color:#9ebcb2; }
    .verification p { margin:0 0 1.5mm; }
    .verification small { color:var(--muted); }
    .implementation { margin:0; padding:0; list-style:none; }
    .implementation li { display:grid; grid-template-columns:15mm 1fr; border-bottom:1px solid var(--rule); padding:4mm 0; }
    .implementation b { color:var(--ochre); font:14pt Georgia,serif; }
    table { width:100%; border-collapse:collapse; font-size:7.5pt; }
    .source-table { margin-bottom:9mm; }
    .hash { font-family:monospace; font-size:6.8pt; }
    th { color:var(--muted); text-align:left; text-transform:uppercase; }
    th,td { border-bottom:1px solid var(--rule); padding:2.4mm 1.5mm; vertical-align:top; }
    .avoid-break { break-inside:avoid; }
    .empty { color:var(--muted); font-style:italic; }
    footer { margin-top:10mm; border-top:1px solid var(--rule); padding-top:3mm; color:var(--muted); font-size:7pt; }
  </style>
</head>
<body>
  <section class="cover">
    <div class="brand"><span class="mark">PL</span> Persona Layouts Protocol</div>
    <p class="eyebrow">Onaylı mekânsal protokol / ${text(audit.project.code)}</p>
    <h1>${text(audit.project.name)}</h1>
    <p class="signature">${text(audit.spatial_signature.statement)}</p>
    <div class="cover-meta">
      <div><small>Müşteri</small><strong>${text(context.client_name)}</strong></div>
      <div><small>Mekân</small><strong>${text(audit.project.space_type)}</strong></div>
      <div><small>Onay tarihi</small><strong>${text(date)}</strong></div>
    </div>
    <p class="seal">Onay mührü: ${text(approval.snapshot_sha256)}</p>
  </section>

  <section class="section">
    <div class="section-head"><b>01</b><h2>Teşhis</h2></div>
    <p class="lead">${text(audit.diagnosis.core_problem)}</p>
    <div class="notice"><strong>Gözlemimiz...</strong><br>${text(audit.diagnosis.we_noticed)}</div>
    <h3>Kanıt sınırı</h3>
    <p>${text(audit.diagnosis.evidence_boundary)}</p>
  </section>

  <section class="section">
    <div class="section-head"><b>02</b><h2>Persona karışımı</h2></div>
    <div class="persona-grid">${renderPersonaMix(audit.persona_allocations)}</div>
    <h2 style="margin-top:10mm">Kimlik çıpaları</h2>
    <div class="anchor-grid">${anchors || '<p class="empty">Kimlik çıpası tanımlanmadı.</p>'}</div>
  </section>

  <section class="section">
    <div class="section-head"><b>03</b><h2>Mekânsal tasarım yaklaşımı</h2></div>
    ${renderAtlasDirection(atlasDirection)}
  </section>

  <section class="section">
    <div class="section-head"><b>04</b><h2>Proje protokolü</h2></div>
    ${renderProtocolRules(audit.project_protocols)}
  </section>

  <section class="section">
    <div class="section-head"><b>05</b><h2>Tasarım kararları</h2></div>
    ${renderDecisions(audit.decisions)}
  </section>

  <section class="section">
    <div class="section-head"><b>06</b><h2>Doğrulama kaydı</h2></div>
    ${renderVerifications(audit.open_verifications)}
    <h2 style="margin-top:10mm">Uygulama sırası</h2>
    <ol class="implementation">${implementation}</ol>
  </section>

  ${audit.report_configuration.include_evidence_appendix ? `
  <section class="section">
    <div class="section-head"><b>07</b><h2>Kanıt eki</h2></div>
    <h3>Proje dosyaları</h3>
    ${renderSourceFiles(sourceFiles)}
    <h3>Karar kanıtları</h3>
    <table>
      <thead><tr><th>ID</th><th>Kategori</th><th>Kanıt</th><th>Güven</th><th>Doğrulama</th></tr></thead>
      <tbody>${renderEvidence(audit.evidence)}</tbody>
    </table>
  </section>` : ''}

  <footer>
    Bu rapor Persona Layouts Protokol Yönetimi tarafından oluşturulmuş ve mimari inceleme sonrasında onaylanmıştır.
    Onay sonrası içerik değiştirilemez; yeni kararlar yeni bir revizyon gerektirir.
  </footer>
</body>
</html>`;
}

async function generateProtocolReportPdf(approval) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(renderProtocolReportHtml(approval), { waitUntil: 'networkidle0' });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;padding:0 16mm;color:#777;font:7px Arial;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '17mm', right: '16mm', bottom: '18mm', left: '16mm' }
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

module.exports = { escapeHtml, generateProtocolReportPdf, renderProtocolReportHtml };
