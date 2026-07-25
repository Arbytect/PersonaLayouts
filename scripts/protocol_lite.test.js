const assert = require('assert');
const {
  buildProtocolLiteFallback,
  buildProtocolLitePrompt,
  buildReviewPacket,
  normalizeProtocolLite,
  toDossierEnrichment,
  validateProtocolLite
} = require('./protocol_lite');

const order = {
  order_id: 'test-protocol-59',
  package: '59',
  persona: 'sage',
  variant: 'hermit',
  room_type: 'living_room',
  room_size: 'compact',
  occupancy: 'solo',
  pain: 'storage',
  pets: false
};

const fallback = buildProtocolLiteFallback(order);
assert.strictEqual(validateProtocolLite(fallback), true);
assert.strictEqual(fallback.observations.length, 5);
assert.strictEqual(fallback.seven_day_plan.length, 7);
assert.strictEqual(fallback.evidence_boundary.geometry_status, 'unverified');
assert.strictEqual(fallback.persona_context.percentages_used, false);

const modelShape = JSON.parse(JSON.stringify(fallback));
modelShape.persona_context.dominant = 'weaver';
modelShape.persona_context.percentages_used = true;
modelShape.persona_context.supporting = ['sovereign', 'invalid'];
modelShape.core_diagnosis.confidence = 'certain';
modelShape.observations[0].confidence = 'certain';
modelShape.observations[0].requires_measurement = false;

const normalized = normalizeProtocolLite(modelShape, order);
assert.strictEqual(normalized.persona_context.dominant, 'sage');
assert.strictEqual(normalized.persona_context.percentages_used, false);
assert.deepStrictEqual(normalized.persona_context.supporting, ['sovereign']);
assert.strictEqual(normalized.core_diagnosis.confidence, 'needs_verification');
assert.strictEqual(normalized.observations[0].confidence, 'needs_verification');
assert.strictEqual(normalized.observations[0].requires_measurement, true);

const enrichment = toDossierEnrichment(normalized);
assert.strictEqual(enrichment.cards.length, 4);
assert.strictEqual(enrichment.observations.length, 5);
assert.strictEqual(enrichment.protocol_lite.schema_version, '1.0');

const shadowReview = buildReviewPacket(normalized, order, 'shadow');
assert.strictEqual(shadowReview.status, 'shadow_review_pending');
assert.strictEqual(shadowReview.protocol_summary.observation_count, 5);

const holdReview = buildReviewPacket(normalized, order, 'hold');
assert.strictEqual(holdReview.status, 'awaiting_admin_approval');

const prompt = buildProtocolLitePrompt(order);
assert(prompt.includes('Do not assign persona percentages'));
assert(prompt.includes('Geometry status must remain unverified'));

const invalid = JSON.parse(JSON.stringify(normalized));
invalid.observations.pop();
assert.throws(() => validateProtocolLite(invalid), /observations must contain exactly 5/);

console.log('Protocol Lite contract tests passed.');
