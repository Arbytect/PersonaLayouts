const assert = require('assert');
const { escapeHtml, renderProtocolReportHtml } = require('./protocol_admin_report');

assert.strictEqual(escapeHtml('<script>"x"&</script>'), '&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;');

const approval = {
  snapshot_sha256: 'a'.repeat(64),
  approved_at: '2026-07-26T12:00:00.000Z',
  snapshot: {
    report_context: { client_name: 'Test <Client>' },
    atlas_direction: {
      primary: {
        slug: 'japanese-minimalism',
        name: 'Japon Minimalizmi',
        subtitle: 'Eşik, boşluk ve dikkat',
        summary: 'Azaltılmış ama ritüelleri destekleyen mekânsal düzen.',
        spatial_why: 'Boşluk kullanımı ve geçişleri görünür kılar.',
        watch_for: 'Sadelik günlük erişimi zorlaştırmamalıdır.',
        palette: ['#1D211E', '#D7D0C5']
      },
      supporting: null,
      alternative: null,
      rationale: 'Müşterinin sakinleşme ritüeli ve düşük uyaran ihtiyacı birincil yönü destekliyor.',
      evidence_boundary: 'Ölçüye bağlı kararlar doğrulanmalıdır.',
      persona_boundary: 'Yaklaşım persona tanısı değildir.'
    },
    audit: {
      project: {
        code: 'PL-2026-999',
        name: 'Protocol Test',
        space_type: 'apartment',
        output_language: 'tr'
      },
      diagnosis: {
        core_problem: 'Core problem',
        we_noticed: 'Observed behavior',
        evidence_boundary: 'Measured geometry is pending.'
      },
      spatial_signature: { statement: 'A calm, legible spatial rhythm.' },
      persona_allocations: [
        { scope: 'project', persona: 'sage', percentage: 60, rationale: 'Evidence A' },
        { scope: 'project', persona: 'sovereign', percentage: 40, rationale: 'Evidence B' }
      ],
      identity_anchors: [
        { label: 'Quiet order', description: 'A clear visual hierarchy.' },
        { label: 'Warm precision', description: 'Measured but not clinical.' }
      ],
      project_protocols: [{
        trigger: 'Shared use',
        abstract_prescription: 'Clarify ownership.',
        concrete_prescription: 'Assign storage zones.',
        success_test: 'Daily items return to one place.',
        confidence: 'confirmed',
        verification_status: 'verified'
      }],
      decisions: [{
        title: 'Storage wall',
        status: 'recommendation',
        confidence: 'confirmed',
        concrete_decision: 'Use one continuous storage elevation.',
        abstract_need: 'Reduce visual noise.',
        success_test: 'Loose objects are concealed.',
        tradeoff: 'Less display area.',
        required_measurements: ['wall width']
      }],
      open_verifications: [{
        status: 'verified',
        statement: 'Wall width checked on site.',
        resolution: 'Verified at 320 cm.'
      }],
      implementation_order: [{ sequence: 1, title: 'Verify dimensions' }],
      evidence: [{
        category: 'dimension',
        statement: 'Wall width is 320 cm.',
        confidence: 'confirmed',
        verification_status: 'verified'
      }],
      source_files: [{
        id: 'source-1',
        source_type: 'measured_plan',
        filename: 'plan.pdf',
        revision: 1,
        sha256: 'b'.repeat(64),
        ai_review_status: 'not_requested'
      }],
      report_configuration: { include_evidence_appendix: true }
    }
  }
};

const html = renderProtocolReportHtml(approval);
assert(html.includes('PL-2026-999'));
assert(html.includes('Onay mührü'));
assert(html.includes('&lt;Client&gt;'));
assert(html.includes('Kanıt eki'));
assert(html.includes('Mekânsal tasarım yaklaşımı'));
assert(html.includes('Japon Minimalizmi'));
assert(html.includes('plan.pdf'));
assert(!html.includes('<script>'));
assert(html.length > 5000);

console.log('Protocol Admin approved report tests passed.');

module.exports = { approval };
