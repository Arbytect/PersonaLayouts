const { validateProtocolAdminContract } = require('./protocol_admin_contract');

const EPSILON = 0.01;

function issue(code, message, entityType, entityId, overrideable = false) {
  return { code, message, entity_type: entityType, entity_id: entityId || null, overrideable };
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function groupAllocations(allocations) {
  const groups = new Map();
  allocations.forEach(item => {
    const key = item.scope === 'project' ? 'project' : `room:${item.room_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return groups;
}

function mapPersonaPercentages(items) {
  return new Map(items.map(item => [item.persona, Number(item.percentage)]));
}

function evaluateProtocolAdminQuality(audit) {
  validateProtocolAdminContract(audit);

  const blockers = [];
  const warnings = [];
  const evidenceIds = new Set(audit.evidence.map(item => item.id));
  const roomIds = new Set(audit.rooms.map(item => item.id));
  const frictionIds = new Set(audit.frictions.map(item => item.id));
  const decisionIds = new Set(audit.decisions.map(item => item.id));
  const sourceFiles = new Map(audit.source_files.map(item => [item.id, item]));
  const evidence = new Map(audit.evidence.map(item => [item.id, item]));

  function requireRefs(ids, known, ownerType, ownerId, field) {
    ids.forEach(id => {
      if (!known.has(id)) blockers.push(issue('UNKNOWN_REFERENCE', `${ownerType} ${ownerId} references unknown ${field} ${id}.`, ownerType, ownerId));
    });
  }

  audit.evidence.forEach(item => {
    if (['photo', 'measured_plan', 'uploaded_document'].includes(item.source_type)) {
      const file = sourceFiles.get(item.source_file_id);
      if (!file) {
        blockers.push(issue('EVIDENCE_SOURCE_FILE_MISSING', `Evidence ${item.id} has no valid source file.`, 'evidence', item.id));
      } else if (item.source_type === 'photo' && file.source_type !== 'photo') {
        blockers.push(issue('PHOTO_SOURCE_MISMATCH', `Evidence ${item.id} claims photo provenance but references ${file.source_type}.`, 'evidence', item.id));
      }
    }
    if (item.confidence === 'assumption') {
      warnings.push(issue('ASSUMPTION_PRESENT', `Evidence ${item.id} remains an assumption.`, 'evidence', item.id, true));
    }
  });

  audit.frictions.forEach(item => {
    requireRefs(item.evidence_ids, evidenceIds, 'friction', item.id, 'evidence');
    if (!item.evidence_ids.length) blockers.push(issue('FRICTION_WITHOUT_EVIDENCE', `Friction ${item.id} has no evidence.`, 'friction', item.id));
    if (!item.abstract_prescription.trim() || !item.concrete_prescription.trim()) {
      blockers.push(issue('FRICTION_PRESCRIPTION_INCOMPLETE', `Friction ${item.id} needs both abstract and concrete prescriptions.`, 'friction', item.id));
    }
  });

  const allocationGroups = groupAllocations(audit.persona_allocations);
  allocationGroups.forEach((items, key) => {
    const total = sum(items.map(item => item.percentage));
    if (Math.abs(total - 100) > EPSILON) {
      blockers.push(issue('PERSONA_TOTAL_NOT_100', `Persona allocation ${key} totals ${total}, not 100.`, 'persona_allocation', key));
    }
    items.forEach(item => {
      requireRefs(item.evidence_ids, evidenceIds, 'persona_allocation', item.id, 'evidence');
      if (!item.evidence_ids.length) blockers.push(issue('PERSONA_WITHOUT_EVIDENCE', `Persona allocation ${item.id} has no evidence.`, 'persona_allocation', item.id));
    });
  });

  const projectMix = mapPersonaPercentages(allocationGroups.get('project') || []);
  allocationGroups.forEach((items, key) => {
    if (!key.startsWith('room:') || !projectMix.size) return;
    const roomMix = mapPersonaPercentages(items);
    const differs = [...new Set([...projectMix.keys(), ...roomMix.keys()])]
      .some(persona => Math.abs((projectMix.get(persona) || 0) - (roomMix.get(persona) || 0)) > EPSILON);
    if (differs && !items.some(item => String(item.deviation_rationale || '').trim())) {
      blockers.push(issue('ROOM_PERSONA_DEVIATION_UNEXPLAINED', `${key} differs from the project persona mix without a rationale.`, 'persona_allocation', key));
    }
  });

  requireRefs(audit.spatial_signature.evidence_ids, evidenceIds, 'spatial_signature', 'spatial_signature', 'evidence');
  if (!audit.spatial_signature.evidence_ids.length) blockers.push(issue('SIGNATURE_WITHOUT_EVIDENCE', 'Spatial Signature has no evidence.', 'spatial_signature', 'spatial_signature'));

  audit.identity_anchors.forEach(item => {
    requireRefs(item.evidence_ids, evidenceIds, 'identity_anchor', item.id, 'evidence');
  });
  if (audit.identity_anchors.length < 2) {
    warnings.push(issue('IDENTITY_ANCHORS_BELOW_TWO', 'Fewer than two identity anchors are defined.', 'identity_anchor', null, true));
  }

  audit.project_protocols.forEach(item => {
    requireRefs(item.evidence_ids, evidenceIds, 'protocol_rule', item.id, 'evidence');
    if (!item.evidence_ids.length) blockers.push(issue('PROTOCOL_WITHOUT_EVIDENCE', `Protocol ${item.id} has no evidence.`, 'protocol_rule', item.id));
  });

  audit.room_protocols.forEach(item => {
    if (!roomIds.has(item.room_id)) blockers.push(issue('ROOM_PROTOCOL_UNKNOWN_ROOM', `Room protocol ${item.id} references unknown room ${item.room_id}.`, 'room_protocol', item.id));
    requireRefs(item.evidence_ids, evidenceIds, 'room_protocol', item.id, 'evidence');
  });

  audit.decisions.forEach(item => {
    if (item.room_id && !roomIds.has(item.room_id)) blockers.push(issue('DECISION_UNKNOWN_ROOM', `Decision ${item.id} references unknown room ${item.room_id}.`, 'decision', item.id));
    requireRefs(item.evidence_ids, evidenceIds, 'decision', item.id, 'evidence');
    requireRefs(item.friction_ids, frictionIds, 'decision', item.id, 'friction');
    if (!item.evidence_ids.length) blockers.push(issue('DECISION_WITHOUT_EVIDENCE', `Decision ${item.id} has no evidence.`, 'decision', item.id));
    if (!item.friction_ids.length) blockers.push(issue('DECISION_WITHOUT_FRICTION', `Decision ${item.id} is not linked to a friction.`, 'decision', item.id));

    if (item.dimension_dependent) {
      if (!item.required_measurements.length) {
        blockers.push(issue('DIMENSION_REQUIREMENT_UNNAMED', `Decision ${item.id} is dimension-dependent but names no required measurement.`, 'decision', item.id));
      }
      const hasVerifiedDimension = item.evidence_ids.some(id => {
        const entry = evidence.get(id);
        return entry && entry.category === 'dimension' && entry.confidence === 'confirmed' &&
          (entry.verification_status === 'verified' || entry.source_type === 'measured_plan');
      });
      if (!hasVerifiedDimension && item.verification_status !== 'field_verification_required') {
        blockers.push(issue('DIMENSION_NOT_VERIFIED', `Decision ${item.id} lacks verified dimensional evidence and is not marked for field verification.`, 'decision', item.id));
      }
    }

    if (item.structural_or_service_change && !['field_verification_required', 'verified'].includes(item.verification_status)) {
      blockers.push(issue('STRUCTURAL_VERIFICATION_MISSING', `Decision ${item.id} changes structure or services without mandatory verification status.`, 'decision', item.id));
    }

    if (['requirement', 'recommendation'].includes(item.status) && !item.cost) {
      warnings.push(issue('DECISION_COST_MISSING', `Decision ${item.id} has no cost range.`, 'decision', item.id, true));
    }
    if (item.decision_type === 'material' && !(item.material_reference_file_ids || []).length) {
      warnings.push(issue('MATERIAL_REFERENCE_MISSING', `Material decision ${item.id} has no reference file.`, 'decision', item.id, true));
    }
  });

  if (!audit.decisions.some(item => item.decision_type === 'layout' && ['option', 'rejected'].includes(item.status))) {
    warnings.push(issue('ALTERNATIVE_LAYOUT_MISSING', 'No alternative or rejected layout decision is recorded.', 'decision', null, true));
  }

  audit.implementation_order.forEach(item => {
    requireRefs(item.decision_ids, decisionIds, 'implementation_order', item.id, 'decision');
  });

  if (!audit.report_configuration.include_open_verifications) {
    blockers.push(issue('OPEN_VERIFICATIONS_HIDDEN', 'Customer report cannot hide the open verifications section.', 'report_configuration', null));
  }

  audit.open_verifications.forEach(item => {
    requireRefs(item.decision_ids, decisionIds, 'open_verification', item.id, 'decision');
    if (item.blocking && ['open', 'failed'].includes(item.status)) {
      blockers.push(issue('BLOCKING_VERIFICATION_OPEN', `Blocking verification ${item.id} is ${item.status}.`, 'open_verification', item.id));
    }
  });

  const overrides = new Map((audit.warning_overrides || []).map(item => [item.code, item.reason.trim()]));
  const activeWarnings = [];
  const overriddenWarnings = [];
  warnings.forEach(item => {
    const reason = overrides.get(item.code);
    if (item.overrideable && reason && reason.length >= 10) overriddenWarnings.push({ ...item, override_reason: reason });
    else activeWarnings.push(item);
  });

  const status = blockers.length
    ? 'blocked'
    : (activeWarnings.length ? 'warning_override_required' : 'ready_for_approval');

  return {
    schema_version: '1.0',
    project_id: audit.project.id,
    revision_number: audit.revision.number,
    status,
    can_approve: status === 'ready_for_approval',
    blockers,
    warnings: activeWarnings,
    overridden_warnings: overriddenWarnings,
    summary: {
      blocker_count: blockers.length,
      warning_count: activeWarnings.length,
      overridden_warning_count: overriddenWarnings.length
    }
  };
}

module.exports = { evaluateProtocolAdminQuality };
