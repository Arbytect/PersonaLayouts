const assert = require('assert');
const { materializeProtocolDraft, parseModelJson } = require('./protocol_admin_ai');

const context = {
  project_id: '11111111-1111-4111-8111-111111111111',
  project_code: 'PL-2026-001',
  project_name: 'Test project',
  space_type: 'apartment',
  output_language: 'tr',
  revision_number: 1,
  client_narrative: 'Düzenli bir yatak odası ve iki kişilik kullanım hedefleniyor.',
  measurements: '400 x 400 cm',
  fixed_elements: 'Kapı ve pencere'
};

const raw = {
  evidence: [
    {
      source_type: 'client_statement',
      statement: 'Odanın iki kişilik kullanıma hazır olması isteniyor.',
      category: 'future_scenario',
      confidence: 'confirmed',
      verification_status: 'not_required'
    },
    {
      source_type: 'admin_entry',
      statement: 'Oda ölçüsü 400 x 400 cm olarak girildi.',
      category: 'dimension',
      confidence: 'confirmed',
      verification_status: 'pending'
    }
  ],
  rooms: [{ name: 'Yatak odası', room_type: 'bedroom', geometry_status: 'partial' }],
  core_diagnosis: {
    core_problem: 'Tek kişilik mevcut düzen, iki kişilik gelecek kullanımına hazırlık sunmuyor.',
    we_noticed: 'Gelecek senaryosu bugünkü düzen kararlarını yönlendiriyor.',
    evidence_boundary: 'Kapı ve pencerenin kesin konumu sahada doğrulanmalı.'
  },
  frictions: [{
    room_ref: 1,
    title: 'Gelecek kullanımı',
    statement: 'Tek kişilik kurgu iki kişilik kullanımı karşılamıyor.',
    behavioral_impact: 'İkinci kullanıcı geldiğinde depolama ve yatak çevresi paylaşımı zorlaşır.',
    abstract_prescription: 'Eşit ve okunabilir ortak kullanım kur.',
    concrete_prescription: 'Yatağın iki yanında erişim ve iki kullanıcılı depolama kapasitesi planla.',
    evidence_refs: [1, 2]
  }],
  persona_mix: [
    { persona: 'sovereign', percentage: 70, rationale: 'Düzen ve okunabilirlik talebi.', evidence_refs: [1] },
    { persona: 'weaver', percentage: 30, rationale: 'İki kişilik gelecek senaryosu.', evidence_refs: [1] }
  ],
  spatial_signature: {
    statement: 'Bugünkü düzen ihtiyacını, iki kişinin eşit kullanacağı okunabilir bir yatak odası sistemiyle çöz.',
    evidence_refs: [1, 2]
  },
  identity_anchors: [
    { label: 'Eşit erişim', description: 'İki kullanıcının yatağa ve depolamaya dengeli erişimi.', evidence_refs: [1] },
    { label: 'Görsel düzen', description: 'Günlük eşyanın görünür taşmayı azaltacak biçimde gruplanması.', evidence_refs: [1] }
  ],
  project_protocols: [
    {
      trigger: 'İki kişilik kullanım',
      abstract_prescription: 'Eşit kullanım kur.',
      concrete_prescription: 'Yatağın iki yanındaki erişimi koru.',
      success_test: 'İki kullanıcı birbirinin yolunu kesmeden yatağa erişir.',
      confidence: 'strong_inference',
      verification_status: 'field_verification_required',
      evidence_refs: [1, 2]
    },
    {
      trigger: 'Depolama paylaşımı',
      abstract_prescription: 'Sahipliği okunabilir kıl.',
      concrete_prescription: 'Depolamayı iki kullanıcı için bölümlendir.',
      success_test: 'Her kullanıcı günlük eşyasına diğer alanı boşaltmadan ulaşır.',
      confidence: 'strong_inference',
      verification_status: 'not_required',
      evidence_refs: [1]
    },
    {
      trigger: 'Görsel sakinlik',
      abstract_prescription: 'Açık yüzey yükünü sınırla.',
      concrete_prescription: 'Günlük ürünleri kapalı depolamada topla.',
      success_test: 'Yatak çevresinde yalnızca seçilmiş nesneler görünür.',
      confidence: 'strong_inference',
      verification_status: 'not_required',
      evidence_refs: [1]
    }
  ],
  room_protocols: [{
    room_ref: 1,
    personal_moment: 'Akşam dinlenme geçişi',
    target: 'İki kişilik sakin yatak odası',
    abstract_prescription: 'Eşitlik ve görsel kapanış sağla.',
    concrete_prescription: 'Yatak çevresi erişimi ile depolama bölgelerini birlikte çöz.',
    success_test: 'İki kullanıcı aynı anda hazırlanabilir.',
    confidence: 'strong_inference',
    verification_status: 'field_verification_required',
    evidence_refs: [1, 2]
  }],
  decisions: [
    {
      room_ref: 1,
      status: 'recommendation',
      decision_type: 'layout',
      title: 'İki yönlü yatak erişimi',
      abstract_need: 'Eşit kullanım',
      concrete_decision: 'Yatağın iki yanında kesintisiz erişim bırak.',
      success_test: 'Her iki kullanıcı bağımsız erişir.',
      tradeoff: 'Depolama genişliği azalabilir.',
      confidence: 'strong_inference',
      verification_status: 'pending',
      dimension_dependent: true,
      required_measurements: ['Kapı ve pencere arasındaki net duvar'],
      structural_or_service_change: false,
      evidence_refs: [1, 2],
      friction_refs: [1],
      cost_min: 0,
      cost_max: 0,
      cost_currency: 'USD'
    },
    {
      room_ref: 1,
      status: 'recommendation',
      decision_type: 'storage',
      title: 'İki kullanıcılı depolama',
      abstract_need: 'Okunabilir paylaşım',
      concrete_decision: 'Dolap içini iki sahiplik bölgesine ayır.',
      success_test: 'Günlük erişim çakışmaz.',
      tradeoff: 'Ortak büyük hacim azalır.',
      confidence: 'strong_inference',
      verification_status: 'not_required',
      dimension_dependent: false,
      required_measurements: [],
      structural_or_service_change: false,
      evidence_refs: [1],
      friction_refs: [1],
      cost_min: 0,
      cost_max: 0,
      cost_currency: 'USD'
    },
    {
      room_ref: 1,
      status: 'option',
      decision_type: 'layout',
      title: 'Tek taraflı erişim alternatifi',
      abstract_need: 'Daha fazla depolama',
      concrete_decision: 'Yatağı tek duvara yaklaştır.',
      success_test: 'Ek depolama sığar.',
      tradeoff: 'İki kişilik kullanım kalitesi düşer.',
      confidence: 'strong_inference',
      verification_status: 'field_verification_required',
      dimension_dependent: true,
      required_measurements: ['Yatak ve duvar arası net mesafe'],
      structural_or_service_change: false,
      evidence_refs: [1, 2],
      friction_refs: [1],
      cost_min: 0,
      cost_max: 0,
      cost_currency: 'USD'
    }
  ],
  open_verifications: [{
    room_ref: 1,
    statement: 'Kapı ve pencere arasındaki net duvar ölçüsü doğrulanmalı.',
    blocking: false,
    decision_refs: [1, 3]
  }],
  implementation_order: [
    { title: 'Geometriyi doğrula', decision_refs: [1, 3] },
    { title: 'Depolama bölümlendirmesini kur', decision_refs: [2] }
  ]
};

const generated = materializeProtocolDraft(raw, context);
assert.strictEqual(generated.audit.schema_version, '1.0');
assert.strictEqual(generated.audit.mode, 'admin_full_protocol');
assert.strictEqual(generated.audit.persona_allocations.reduce((sum, item) => sum + item.percentage, 0), 100);
assert.strictEqual(generated.audit.decisions[0].verification_status, 'field_verification_required');
assert.strictEqual(generated.audit.decisions[0].required_measurements.length, 1);
assert.strictEqual(generated.audit.project.output_language, 'tr');
assert(['ready_for_approval', 'warning_override_required', 'blocked'].includes(generated.quality_gate.status));
assert.deepStrictEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });

console.log('Protocol Admin AI materialization tests passed.');
