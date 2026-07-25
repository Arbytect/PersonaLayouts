const VALID_PERSONAS = ['sovereign', 'sage', 'alchemist', 'weaver'];
const VALID_CONFIDENCE = ['observed', 'strong_inference', 'needs_verification'];

function text(value, fallback = '') {
  const result = String(value || '').replace(/\s+/g, ' ').trim();
  return result || fallback;
}

function list(value, min, max, label) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain ${min === max ? `exactly ${min}` : `${min}-${max}`} item(s).`);
  }
  return value;
}

function confidence(value) {
  return VALID_CONFIDENCE.includes(value) ? value : 'needs_verification';
}

function buildProtocolLitePrompt(order) {
  return `You are the server-side Persona Layouts Protocol Lite engine for a paid $59 room analysis.

Analyze only the supplied room photo and confirmed quiz facts. Return one valid JSON object matching this contract:
{
  "schema_version":"1.0",
  "mode":"protocol_lite",
  "evidence_boundary":{"sources":["quiz","photo"],"geometry_status":"unverified","limitations":["string"]},
  "working_spatial_signature":"string",
  "core_diagnosis":{"statement":"string","evidence":["string","string"],"confidence":"observed|strong_inference|needs_verification"},
  "persona_context":{"dominant":"${order.persona}","variant":${JSON.stringify(order.variant || null)},"supporting":[],"percentages_used":false},
  "project_rules":[{"id":"R1","trigger":"string","abstract_prescription":"string","concrete_prescription":"string","success_test":"string","confidence":"observed|strong_inference|needs_verification"}],
  "observations":[{"id":"O1","title":"string","visible_evidence":"string","friction":"string","behavioral_impact":"string","abstract_prescription":"string","concrete_prescription":"string","success_test":"string","confidence":"observed|strong_inference|needs_verification","requires_measurement":false}],
  "assumptions":[{"statement":"string","impact":"string","confidence":"needs_verification"}],
  "open_verifications":["string"],
  "seven_day_plan":["string"],
  "visual_prompt":"string"
}

Hard rules:
- Return exactly 5 observations, exactly 7 seven_day_plan steps, and 3-5 project_rules.
- Describe visible evidence using actual objects, positions, light conditions, openings, or circulation conflicts seen in the photo.
- Do not invent measurements, hidden dimensions, structural conditions, client biography, rituals, budget, or code compliance.
- Geometry status must remain unverified. Any dimension-dependent move must use confidence=needs_verification and requires_measurement=true.
- Do not propose demolition, moving walls/openings, plumbing relocation, or electrical work.
- Do not assign persona percentages. The persona is context, not proof of a psychological diagnosis.
- Link every observation as evidence -> friction -> behavioral impact -> abstract prescription -> concrete prescription -> success test.
- The visual prompt must preserve walls, ceiling, windows, doors, built-ins, floor geometry, viewpoint, camera angle, and the room's identity. Change only movable furniture, storage, clutter, decor, and lighting.

Confirmed quiz facts: ${JSON.stringify({ persona: order.persona, variant: order.variant || null, room_type: order.room_type, room_size: order.room_size, occupancy: order.occupancy, pain: order.pain, pets: order.pets })}`;
}

function buildProtocolLiteFallback(order) {
  const room = order.room_type.replace(/_/g, ' ');
  const persona = order.persona;
  const observations = [
    ['Primary circulation', 'Movable furniture appears to compress the main route.', 'Movement may feel negotiated instead of intuitive.', 'Protect a legible movement hierarchy.', 'Open one continuous walking lane using only movable elements.', 'A person can cross the room without sidestepping furniture.'],
    ['Activity overlap', 'Multiple activities appear to compete for the same central surface.', 'Resetting the room between tasks may add daily friction.', 'Give each repeated activity a readable state.', 'Assign one clear surface or zone to each repeated activity.', 'Each activity can begin without clearing another activity first.'],
    ['Visual hierarchy', 'Several visible objects compete to anchor the room.', 'The eye may lack a stable resting point.', 'Create one dominant visual decision.', 'Choose one anchor and reduce competing objects around it.', 'The primary anchor is identifiable within three seconds of entering.'],
    ['Storage boundary', 'Frequently used objects appear distributed across visible surfaces.', 'Loose items may repeatedly return to work and circulation zones.', 'Create immediate visual closure for daily inventory.', 'Consolidate daily-use storage along one room boundary.', 'Daily items can be put away without crossing the room.'],
    ['Lighting layers', 'General lighting appears to carry tasks that benefit from local light.', 'The room may feel flat and less adaptable after dark.', 'Separate ambient and task lighting roles.', 'Add task light at the primary activity and soften the perimeter.', 'The main activity works without relying on one overhead source.']
  ].map((item, index) => ({
    id: `O${index + 1}`,
    title: item[0],
    visible_evidence: item[1],
    friction: item[1],
    behavioral_impact: item[2],
    abstract_prescription: item[3],
    concrete_prescription: item[4],
    success_test: item[5],
    confidence: 'needs_verification',
    requires_measurement: true
  }));

  return {
    schema_version: '1.0',
    mode: 'protocol_lite',
    evidence_boundary: {
      sources: ['quiz', 'system_fallback'],
      geometry_status: 'unverified',
      limitations: ['Photo-specific evidence was not evaluated in this fallback.', 'All clearances require field measurement.']
    },
    working_spatial_signature: `${persona} priorities applied to a ${room} where ${order.pain} friction must be reduced without changing the room shell.`,
    core_diagnosis: {
      statement: `The ${room} needs a clearer movement, activity, and visual hierarchy before additional objects are introduced.`,
      evidence: [`Quiz pressure: ${order.pain}.`, `Declared occupancy: ${order.occupancy}.`],
      confidence: 'needs_verification'
    },
    persona_context: { dominant: persona, variant: order.variant || null, supporting: [], percentages_used: false },
    project_rules: [
      { id: 'R1', trigger: 'Circulation is visually compressed.', abstract_prescription: 'Restore legible movement.', concrete_prescription: 'Clear one continuous route before adding objects.', success_test: 'The route works without sidestepping furniture.', confidence: 'needs_verification' },
      { id: 'R2', trigger: 'Activities overlap.', abstract_prescription: 'Create readable activity states.', concrete_prescription: 'Assign one zone or surface to each repeated activity.', success_test: 'Activities do not require clearing each other.', confidence: 'needs_verification' },
      { id: 'R3', trigger: 'Visual anchors compete.', abstract_prescription: 'Establish one hierarchy.', concrete_prescription: 'Retain one anchor and quiet its immediate background.', success_test: 'The anchor reads immediately on entry.', confidence: 'needs_verification' }
    ],
    observations,
    assumptions: [{ statement: 'Room geometry and clearances have not been field measured.', impact: 'Dimension-dependent recommendations remain provisional.', confidence: 'needs_verification' }],
    open_verifications: ['Measure the narrowest circulation point.', 'Confirm door, drawer, and equipment swing zones.', 'Confirm the primary daylight direction.'],
    seven_day_plan: [
      'Photograph and measure the current circulation path.',
      'Remove loose objects from the dominant visual field.',
      'Consolidate daily-use storage into one boundary.',
      'Build one dedicated single-activity zone.',
      'Correct movable furniture alignment and cable exposure.',
      'Separate task lighting from ambient lighting.',
      'Run the final fit-check before purchasing anything.'
    ],
    visual_prompt: `Photorealistic conservative edit of the supplied ${room}; preserve architecture, viewpoint, largest furniture anchor, and camera position; correct ${order.pain} friction for a ${persona} context using movable elements only.`
  };
}

function normalizeProtocolLite(raw, order) {
  const result = {
    schema_version: '1.0',
    mode: 'protocol_lite',
    evidence_boundary: {
      sources: ['quiz', 'photo'],
      geometry_status: 'unverified',
      limitations: Array.isArray(raw?.evidence_boundary?.limitations) ? raw.evidence_boundary.limitations.map(item => text(item)).filter(Boolean).slice(0, 6) : []
    },
    working_spatial_signature: text(raw?.working_spatial_signature),
    core_diagnosis: {
      statement: text(raw?.core_diagnosis?.statement),
      evidence: Array.isArray(raw?.core_diagnosis?.evidence) ? raw.core_diagnosis.evidence.map(item => text(item)).filter(Boolean).slice(0, 6) : [],
      confidence: confidence(raw?.core_diagnosis?.confidence)
    },
    persona_context: {
      dominant: order.persona,
      variant: order.variant || null,
      supporting: Array.isArray(raw?.persona_context?.supporting) ? raw.persona_context.supporting.filter(item => VALID_PERSONAS.includes(item) && item !== order.persona).slice(0, 2) : [],
      percentages_used: false
    },
    project_rules: Array.isArray(raw?.project_rules) ? raw.project_rules.slice(0, 5).map((item, index) => ({
      id: `R${index + 1}`,
      trigger: text(item.trigger),
      abstract_prescription: text(item.abstract_prescription),
      concrete_prescription: text(item.concrete_prescription),
      success_test: text(item.success_test),
      confidence: confidence(item.confidence)
    })) : [],
    observations: Array.isArray(raw?.observations) ? raw.observations.slice(0, 5).map((item, index) => ({
      id: `O${index + 1}`,
      title: text(item.title),
      visible_evidence: text(item.visible_evidence),
      friction: text(item.friction),
      behavioral_impact: text(item.behavioral_impact),
      abstract_prescription: text(item.abstract_prescription),
      concrete_prescription: text(item.concrete_prescription),
      success_test: text(item.success_test),
      confidence: confidence(item.confidence),
      requires_measurement: item.requires_measurement === true || confidence(item.confidence) === 'needs_verification'
    })) : [],
    assumptions: Array.isArray(raw?.assumptions) ? raw.assumptions.slice(0, 8).map(item => ({ statement: text(item.statement), impact: text(item.impact), confidence: 'needs_verification' })) : [],
    open_verifications: Array.isArray(raw?.open_verifications) ? raw.open_verifications.map(item => text(item)).filter(Boolean).slice(0, 10) : [],
    seven_day_plan: Array.isArray(raw?.seven_day_plan) ? raw.seven_day_plan.slice(0, 7).map(item => text(item)) : [],
    visual_prompt: text(raw?.visual_prompt)
  };
  validateProtocolLite(result);
  return result;
}

function validateProtocolLite(protocol) {
  if (!protocol || protocol.schema_version !== '1.0' || protocol.mode !== 'protocol_lite') throw new Error('Invalid Protocol Lite version or mode.');
  if (protocol.evidence_boundary?.geometry_status !== 'unverified') throw new Error('Protocol Lite geometry_status must remain unverified.');
  if (!text(protocol.working_spatial_signature)) throw new Error('Protocol Lite requires a working_spatial_signature.');
  if (!text(protocol.core_diagnosis?.statement) || list(protocol.core_diagnosis?.evidence, 1, 6, 'core_diagnosis.evidence').some(item => !text(item))) throw new Error('Protocol Lite core diagnosis is incomplete.');
  if (!VALID_PERSONAS.includes(protocol.persona_context?.dominant) || protocol.persona_context?.percentages_used !== false) throw new Error('Protocol Lite persona context is invalid.');
  list(protocol.project_rules, 3, 5, 'project_rules').forEach((rule, index) => {
    for (const key of ['trigger', 'abstract_prescription', 'concrete_prescription', 'success_test']) if (!text(rule[key])) throw new Error(`project_rules[${index}].${key} is required.`);
    if (!VALID_CONFIDENCE.includes(rule.confidence)) throw new Error(`project_rules[${index}].confidence is invalid.`);
  });
  list(protocol.observations, 5, 5, 'observations').forEach((item, index) => {
    for (const key of ['title', 'visible_evidence', 'friction', 'behavioral_impact', 'abstract_prescription', 'concrete_prescription', 'success_test']) if (!text(item[key])) throw new Error(`observations[${index}].${key} is required.`);
    if (!VALID_CONFIDENCE.includes(item.confidence)) throw new Error(`observations[${index}].confidence is invalid.`);
  });
  list(protocol.seven_day_plan, 7, 7, 'seven_day_plan').forEach((item, index) => { if (!text(item)) throw new Error(`seven_day_plan[${index}] is required.`); });
  if (!text(protocol.visual_prompt)) throw new Error('Protocol Lite visual_prompt is required.');
  return true;
}

function toDossierEnrichment(protocol) {
  validateProtocolLite(protocol);
  const cards = protocol.project_rules.slice(0, 4).map((rule, index) => ({ label: `Protocol ${index + 1}`, title: rule.abstract_prescription, text: `${rule.concrete_prescription} Success test: ${rule.success_test}` }));
  while (cards.length < 4) cards.push({ label: 'Verification', title: 'Measure before purchase', text: protocol.open_verifications[cards.length - protocol.project_rules.length] || 'Confirm dimensions before committing to a dimension-dependent move.' });
  const describeProblem = item => {
    const evidence = item.visible_evidence.trim();
    const friction = item.friction.trim();
    return evidence.toLocaleLowerCase('en-US') === friction.toLocaleLowerCase('en-US')
      ? evidence
      : `${evidence} ${friction}`;
  };
  return {
    headline: protocol.core_diagnosis.statement,
    cards,
    seven_day_plan: protocol.seven_day_plan,
    visual_prompt: protocol.visual_prompt,
    observations: protocol.observations.map(item => ({
      title: item.title,
      problem: describeProblem(item),
      behavioral_impact: item.behavioral_impact,
      action_plan: `${item.concrete_prescription} Success test: ${item.success_test}`,
      confidence: item.confidence,
      requires_measurement: item.requires_measurement
    })),
    protocol_lite: protocol
  };
}

function buildReviewPacket(protocol, order, mode = 'shadow') {
  validateProtocolLite(protocol);
  const safeMode = mode === 'hold' ? 'hold' : 'shadow';
  return {
    schema_version: '1.0',
    order_id: order.order_id,
    package: order.package,
    review_mode: safeMode,
    status: safeMode === 'hold' ? 'awaiting_admin_approval' : 'shadow_review_pending',
    created_at: new Date().toISOString(),
    checks: {
      evidence_is_photo_specific: null,
      no_invented_dimensions: null,
      prescriptions_trace_to_evidence: null,
      before_after_identity_preserved: null,
      customer_language_is_clear: null
    },
    open_verifications: protocol.open_verifications,
    protocol_summary: {
      working_spatial_signature: protocol.working_spatial_signature,
      diagnosis: protocol.core_diagnosis.statement,
      observation_count: protocol.observations.length,
      needs_measurement_count: protocol.observations.filter(item => item.requires_measurement).length
    }
  };
}

module.exports = {
  buildProtocolLiteFallback,
  buildProtocolLitePrompt,
  buildReviewPacket,
  normalizeProtocolLite,
  toDossierEnrichment,
  validateProtocolLite
};
