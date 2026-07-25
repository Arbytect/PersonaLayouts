const SOURCE_TYPES = ['client_statement', 'measured_plan', 'photo', 'admin_entry', 'uploaded_document'];
const CONFIDENCE_LEVELS = ['confirmed', 'strong_inference', 'assumption', 'unknown'];
const VERIFICATION_STATUSES = ['not_required', 'pending', 'field_verification_required', 'verified', 'failed'];
const DECISION_STATUSES = ['requirement', 'recommendation', 'option', 'rejected', 'open'];
const PERSONAS = ['sovereign', 'sage', 'alchemist', 'weaver'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmpty(value, field) {
  assert(typeof value === 'string' && value.trim(), `${field} is required.`);
}

function array(value, field, min = 0, max = Infinity) {
  assert(Array.isArray(value), `${field} must be an array.`);
  assert(value.length >= min && value.length <= max, `${field} must contain ${min}-${max === Infinity ? 'many' : max} items.`);
  return value;
}

function enumValue(value, allowed, field) {
  assert(allowed.includes(value), `${field} must be one of: ${allowed.join(', ')}.`);
}

function validateIdList(value, field) {
  array(value, field);
  const seen = new Set();
  value.forEach((id, index) => {
    nonEmpty(id, `${field}[${index}]`);
    assert(!seen.has(id), `${field} contains duplicate id ${id}.`);
    seen.add(id);
  });
}

function validateUniqueIds(items, field) {
  const seen = new Set();
  items.forEach((item, index) => {
    assert(item && typeof item === 'object' && !Array.isArray(item), `${field}[${index}] must be an object.`);
    nonEmpty(item.id, `${field}[${index}].id`);
    assert(!seen.has(item.id), `${field} contains duplicate id ${item.id}.`);
    seen.add(item.id);
  });
}

function validateProtocolAdminContract(audit) {
  assert(audit && typeof audit === 'object' && !Array.isArray(audit), 'Audit must be an object.');
  assert(audit.schema_version === '1.0', 'schema_version must be 1.0.');
  assert(audit.mode === 'admin_full_protocol', 'mode must be admin_full_protocol.');

  assert(audit.project && typeof audit.project === 'object', 'project is required.');
  nonEmpty(audit.project.id, 'project.id');
  nonEmpty(audit.project.code, 'project.code');
  nonEmpty(audit.project.name, 'project.name');
  nonEmpty(audit.project.space_type, 'project.space_type');
  enumValue(audit.project.output_language, ['tr', 'en'], 'project.output_language');

  assert(audit.revision && Number.isInteger(audit.revision.number) && audit.revision.number > 0, 'revision.number must be a positive integer.');
  enumValue(audit.revision.state, ['draft', 'approved'], 'revision.state');
  assert(audit.report_configuration && typeof audit.report_configuration === 'object', 'report_configuration is required.');
  assert(typeof audit.report_configuration.include_open_verifications === 'boolean', 'report_configuration.include_open_verifications must be boolean.');
  assert(typeof audit.report_configuration.include_evidence_appendix === 'boolean', 'report_configuration.include_evidence_appendix must be boolean.');

  const collections = {
    source_files: array(audit.source_files, 'source_files'),
    evidence: array(audit.evidence, 'evidence', 1),
    rooms: array(audit.rooms, 'rooms', 1),
    frictions: array(audit.frictions, 'frictions', 1),
    persona_allocations: array(audit.persona_allocations, 'persona_allocations', 1),
    identity_anchors: array(audit.identity_anchors, 'identity_anchors'),
    project_protocols: array(audit.project_protocols, 'project_protocols', 3, 5),
    room_protocols: array(audit.room_protocols, 'room_protocols'),
    decisions: array(audit.decisions, 'decisions', 1),
    open_verifications: array(audit.open_verifications, 'open_verifications'),
    implementation_order: array(audit.implementation_order, 'implementation_order', 1)
  };
  Object.entries(collections).forEach(([field, items]) => validateUniqueIds(items, field));

  const sourceFileIds = new Set(collections.source_files.map(item => item.id));
  collections.source_files.forEach((file, index) => {
    enumValue(file.source_type, ['measured_plan', 'photo', 'uploaded_document'], `source_files[${index}].source_type`);
    nonEmpty(file.filename, `source_files[${index}].filename`);
    assert(Number.isInteger(file.revision) && file.revision > 0, `source_files[${index}].revision must be positive.`);
    assert(/^[a-f0-9]{64}$/i.test(file.sha256 || ''), `source_files[${index}].sha256 must be a SHA-256 hex string.`);
  });

  collections.evidence.forEach((item, index) => {
    enumValue(item.source_type, SOURCE_TYPES, `evidence[${index}].source_type`);
    enumValue(item.confidence, CONFIDENCE_LEVELS, `evidence[${index}].confidence`);
    enumValue(item.verification_status, VERIFICATION_STATUSES, `evidence[${index}].verification_status`);
    enumValue(item.created_by_type, ['ai', 'admin', 'import'], `evidence[${index}].created_by_type`);
    nonEmpty(item.statement, `evidence[${index}].statement`);
    if (['measured_plan', 'photo', 'uploaded_document'].includes(item.source_type)) {
      nonEmpty(item.source_file_id, `evidence[${index}].source_file_id`);
      assert(sourceFileIds.has(item.source_file_id), `evidence[${index}] references unknown source file ${item.source_file_id}.`);
    }
  });

  collections.frictions.forEach((item, index) => {
    nonEmpty(item.statement, `frictions[${index}].statement`);
    nonEmpty(item.behavioral_impact, `frictions[${index}].behavioral_impact`);
    nonEmpty(item.abstract_prescription, `frictions[${index}].abstract_prescription`);
    nonEmpty(item.concrete_prescription, `frictions[${index}].concrete_prescription`);
    validateIdList(item.evidence_ids, `frictions[${index}].evidence_ids`);
  });

  const roomIds = new Set(collections.rooms.map(item => item.id));
  collections.identity_anchors.forEach((item, index) => {
    nonEmpty(item.label, `identity_anchors[${index}].label`);
    nonEmpty(item.description, `identity_anchors[${index}].description`);
    validateIdList(item.evidence_ids, `identity_anchors[${index}].evidence_ids`);
  });

  collections.persona_allocations.forEach((item, index) => {
    enumValue(item.scope, ['project', 'room'], `persona_allocations[${index}].scope`);
    enumValue(item.persona, PERSONAS, `persona_allocations[${index}].persona`);
    assert(Number.isFinite(item.percentage) && item.percentage >= 0 && item.percentage <= 100, `persona_allocations[${index}].percentage must be 0-100.`);
    nonEmpty(item.rationale, `persona_allocations[${index}].rationale`);
    validateIdList(item.evidence_ids, `persona_allocations[${index}].evidence_ids`);
    assert((item.scope === 'project' && !item.room_id) || (item.scope === 'room' && item.room_id), `persona_allocations[${index}] has an invalid scope/room_id combination.`);
  });

  assert(audit.spatial_signature && typeof audit.spatial_signature === 'object', 'spatial_signature is required.');
  nonEmpty(audit.spatial_signature.statement, 'spatial_signature.statement');
  validateIdList(audit.spatial_signature.evidence_ids, 'spatial_signature.evidence_ids');

  collections.project_protocols.forEach((item, index) => {
    ['trigger', 'abstract_prescription', 'concrete_prescription', 'success_test'].forEach(field => nonEmpty(item[field], `project_protocols[${index}].${field}`));
    enumValue(item.confidence, CONFIDENCE_LEVELS, `project_protocols[${index}].confidence`);
    enumValue(item.verification_status, VERIFICATION_STATUSES, `project_protocols[${index}].verification_status`);
    validateIdList(item.evidence_ids, `project_protocols[${index}].evidence_ids`);
  });

  collections.room_protocols.forEach((item, index) => {
    nonEmpty(item.room_id, `room_protocols[${index}].room_id`);
    assert(roomIds.has(item.room_id), `room_protocols[${index}] references unknown room ${item.room_id}.`);
    ['target', 'abstract_prescription', 'concrete_prescription', 'success_test'].forEach(field => nonEmpty(item[field], `room_protocols[${index}].${field}`));
    enumValue(item.confidence, CONFIDENCE_LEVELS, `room_protocols[${index}].confidence`);
    enumValue(item.verification_status, VERIFICATION_STATUSES, `room_protocols[${index}].verification_status`);
    validateIdList(item.evidence_ids, `room_protocols[${index}].evidence_ids`);
  });

  collections.decisions.forEach((item, index) => {
    enumValue(item.status, DECISION_STATUSES, `decisions[${index}].status`);
    enumValue(item.confidence, CONFIDENCE_LEVELS, `decisions[${index}].confidence`);
    enumValue(item.verification_status, VERIFICATION_STATUSES, `decisions[${index}].verification_status`);
    ['title', 'abstract_need', 'concrete_decision', 'success_test'].forEach(field => nonEmpty(item[field], `decisions[${index}].${field}`));
    assert(typeof item.dimension_dependent === 'boolean', `decisions[${index}].dimension_dependent must be boolean.`);
    assert(typeof item.structural_or_service_change === 'boolean', `decisions[${index}].structural_or_service_change must be boolean.`);
    array(item.required_measurements, `decisions[${index}].required_measurements`);
    validateIdList(item.evidence_ids, `decisions[${index}].evidence_ids`);
    validateIdList(item.friction_ids, `decisions[${index}].friction_ids`);
  });

  collections.open_verifications.forEach((item, index) => {
    nonEmpty(item.statement, `open_verifications[${index}].statement`);
    assert(typeof item.blocking === 'boolean', `open_verifications[${index}].blocking must be boolean.`);
    enumValue(item.status, ['open', 'verified', 'failed', 'waived'], `open_verifications[${index}].status`);
    validateIdList(item.decision_ids, `open_verifications[${index}].decision_ids`);
  });

  collections.implementation_order.forEach((item, index) => {
    assert(Number.isInteger(item.sequence) && item.sequence > 0, `implementation_order[${index}].sequence must be positive.`);
    nonEmpty(item.title, `implementation_order[${index}].title`);
    validateIdList(item.decision_ids, `implementation_order[${index}].decision_ids`);
  });

  array(audit.warning_overrides || [], 'warning_overrides').forEach((item, index) => {
    nonEmpty(item.code, `warning_overrides[${index}].code`);
    assert(typeof item.reason === 'string' && item.reason.trim().length >= 10, `warning_overrides[${index}].reason must contain at least 10 characters.`);
  });

  return audit;
}

module.exports = {
  CONFIDENCE_LEVELS,
  DECISION_STATUSES,
  PERSONAS,
  SOURCE_TYPES,
  VERIFICATION_STATUSES,
  validateProtocolAdminContract
};
