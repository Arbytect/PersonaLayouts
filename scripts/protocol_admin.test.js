const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateProtocolAdminContract } = require('./protocol_admin_contract');
const { evaluateProtocolAdminQuality } = require('./protocol_admin_quality_gate');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixture() {
  return {
    schema_version: '1.0',
    mode: 'admin_full_protocol',
    project: { id: 'project-1', code: 'PL-2026-001', name: 'Sample Audit', space_type: 'apartment', output_language: 'tr' },
    revision: { number: 1, state: 'draft', change_reason: null },
    report_configuration: { include_open_verifications: true, include_evidence_appendix: true },
    source_files: [
      { id: 'file-plan', source_type: 'measured_plan', filename: 'plan.pdf', revision: 1, sha256: 'a'.repeat(64), ai_review_status: 'completed' }
    ],
    evidence: [
      {
        id: 'e-dimension',
        source_type: 'measured_plan',
        source_file_id: 'file-plan',
        source_page: 1,
        source_image_index: null,
        statement: 'The living room clear width is recorded on the measured plan.',
        category: 'dimension',
        confidence: 'confirmed',
        verification_status: 'verified',
        created_by_type: 'admin'
      },
      {
        id: 'e-routine',
        source_type: 'client_statement',
        source_file_id: null,
        source_page: null,
        source_image_index: null,
        statement: 'The client works from home three days each week.',
        category: 'routine',
        confidence: 'confirmed',
        verification_status: 'not_required',
        created_by_type: 'admin'
      }
    ],
    rooms: [
      { id: 'room-living', name: 'Living Room', room_type: 'living_room', geometry_status: 'measured', dimensions: { width_cm: 430, length_cm: 520 }, fixed_elements: [] }
    ],
    frictions: [
      {
        id: 'friction-1',
        room_id: 'room-living',
        title: 'Work and circulation overlap',
        statement: 'The work zone competes with the primary route.',
        behavioral_impact: 'Repeated interruption reduces focus.',
        priority: 'high',
        evidence_ids: ['e-routine', 'e-dimension'],
        abstract_prescription: 'Separate focused work from transit.',
        concrete_prescription: 'Keep the desk outside the primary circulation lane.'
      }
    ],
    persona_allocations: [
      { id: 'persona-s', scope: 'project', room_id: null, persona: 'sovereign', variant: 'precision', percentage: 60, rationale: 'Control and legibility are repeated needs.', deviation_rationale: null, evidence_ids: ['e-routine'] },
      { id: 'persona-sa', scope: 'project', room_id: null, persona: 'sage', variant: 'scholar', percentage: 40, rationale: 'Focused work requires protected attention.', deviation_rationale: null, evidence_ids: ['e-routine'] }
    ],
    spatial_signature: {
      statement: 'A legible home that protects focused work without sacrificing movement.',
      evidence_ids: ['e-routine', 'e-dimension']
    },
    identity_anchors: [
      { id: 'anchor-1', label: 'Focused work', description: 'A stable weekday work state.', evidence_ids: ['e-routine'] },
      { id: 'anchor-2', label: 'Clear arrival', description: 'Movement remains immediately legible.', evidence_ids: ['e-dimension'] }
    ],
    project_protocols: [
      { id: 'rule-1', trigger: 'Work overlaps circulation.', abstract_prescription: 'Protect focus.', concrete_prescription: 'Separate the desk from transit.', success_test: 'Transit does not pass behind the active chair.', confidence: 'confirmed', verification_status: 'verified', evidence_ids: ['e-routine', 'e-dimension'] },
      { id: 'rule-2', trigger: 'Daily objects spread across work surfaces.', abstract_prescription: 'Close daily inventory.', concrete_prescription: 'Assign one closed storage address.', success_test: 'The desk resets without moving objects to another room.', confidence: 'strong_inference', verification_status: 'not_required', evidence_ids: ['e-routine'] },
      { id: 'rule-3', trigger: 'The route must remain legible.', abstract_prescription: 'Preserve a movement hierarchy.', concrete_prescription: 'Keep the principal route unobstructed.', success_test: 'A person crosses without sidestepping furniture.', confidence: 'confirmed', verification_status: 'verified', evidence_ids: ['e-dimension'] }
    ],
    room_protocols: [
      { id: 'room-rule-1', room_id: 'room-living', personal_moment: 'Weekday work', target: 'Protected focus', abstract_prescription: 'Separate work and movement.', concrete_prescription: 'Place the desk outside transit.', success_test: 'Meetings occur without circulation behind the chair.', confidence: 'confirmed', verification_status: 'verified', evidence_ids: ['e-routine', 'e-dimension'] }
    ],
    decisions: [
      {
        id: 'decision-1',
        room_id: 'room-living',
        status: 'recommendation',
        decision_type: 'layout',
        title: 'Protected desk position',
        abstract_need: 'Protect focused work.',
        concrete_decision: 'Position the desk outside the principal route.',
        success_test: 'The chair operates without blocking circulation.',
        tradeoff: 'Reduces one secondary display surface.',
        confidence: 'confirmed',
        verification_status: 'verified',
        dimension_dependent: true,
        required_measurements: ['Clear wall width', 'Chair clearance'],
        structural_or_service_change: false,
        cost: { min: 0, max: 0, currency: 'TRY' },
        material_reference_file_ids: [],
        evidence_ids: ['e-routine', 'e-dimension'],
        friction_ids: ['friction-1']
      },
      {
        id: 'decision-2',
        room_id: 'room-living',
        status: 'rejected',
        decision_type: 'layout',
        title: 'Desk in circulation axis',
        abstract_need: 'Test the obvious alternative.',
        concrete_decision: 'Reject placing the desk in the principal route.',
        success_test: 'The rejected option remains absent from the approved layout.',
        tradeoff: 'The desk loses the most central position.',
        confidence: 'confirmed',
        verification_status: 'verified',
        dimension_dependent: false,
        required_measurements: [],
        structural_or_service_change: false,
        cost: null,
        material_reference_file_ids: [],
        evidence_ids: ['e-routine', 'e-dimension'],
        friction_ids: ['friction-1']
      }
    ],
    open_verifications: [
      { id: 'verify-1', room_id: 'room-living', statement: 'Confirm the final socket position before installation.', blocking: false, status: 'verified', resolution: 'Confirmed on plan.', decision_ids: ['decision-1'] }
    ],
    implementation_order: [
      { id: 'phase-1', sequence: 1, title: 'Confirm and place the work zone', decision_ids: ['decision-1'] }
    ],
    warning_overrides: []
  };
}

const valid = fixture();
assert.strictEqual(validateProtocolAdminContract(valid), valid);
const ready = evaluateProtocolAdminQuality(valid);
assert.strictEqual(ready.status, 'ready_for_approval');
assert.strictEqual(ready.can_approve, true);

const personaTotal = clone(valid);
personaTotal.persona_allocations[0].percentage = 50;
assert(evaluateProtocolAdminQuality(personaTotal).blockers.some(item => item.code === 'PERSONA_TOTAL_NOT_100'));

const personaEvidence = clone(valid);
personaEvidence.persona_allocations[0].evidence_ids = [];
assert(evaluateProtocolAdminQuality(personaEvidence).blockers.some(item => item.code === 'PERSONA_WITHOUT_EVIDENCE'));

const dimension = clone(valid);
dimension.decisions[0].required_measurements = [];
assert(evaluateProtocolAdminQuality(dimension).blockers.some(item => item.code === 'DIMENSION_REQUIREMENT_UNNAMED'));

const structural = clone(valid);
structural.decisions[0].structural_or_service_change = true;
structural.decisions[0].verification_status = 'pending';
assert(evaluateProtocolAdminQuality(structural).blockers.some(item => item.code === 'STRUCTURAL_VERIFICATION_MISSING'));

const hiddenVerifications = clone(valid);
hiddenVerifications.report_configuration.include_open_verifications = false;
assert(evaluateProtocolAdminQuality(hiddenVerifications).blockers.some(item => item.code === 'OPEN_VERIFICATIONS_HIDDEN'));

const blockingVerification = clone(valid);
blockingVerification.open_verifications[0].blocking = true;
blockingVerification.open_verifications[0].status = 'open';
assert(evaluateProtocolAdminQuality(blockingVerification).blockers.some(item => item.code === 'BLOCKING_VERIFICATION_OPEN'));

const warnings = clone(valid);
warnings.decisions = warnings.decisions.filter(item => item.id !== 'decision-2');
warnings.decisions[0].cost = null;
let warningResult = evaluateProtocolAdminQuality(warnings);
assert.strictEqual(warningResult.status, 'warning_override_required');
assert(warningResult.warnings.some(item => item.code === 'DECISION_COST_MISSING'));
assert(warningResult.warnings.some(item => item.code === 'ALTERNATIVE_LAYOUT_MISSING'));
warnings.warning_overrides = [
  { code: 'DECISION_COST_MISSING', reason: 'Costing is intentionally excluded from this diagnostic stage.' },
  { code: 'ALTERNATIVE_LAYOUT_MISSING', reason: 'The measured geometry supports only one viable work-zone location.' }
];
warningResult = evaluateProtocolAdminQuality(warnings);
assert.strictEqual(warningResult.status, 'ready_for_approval');
assert.strictEqual(warningResult.overridden_warnings.length, 2);

const invalid = clone(valid);
invalid.frictions[0].concrete_prescription = '';
assert.throws(() => validateProtocolAdminContract(invalid), /concrete_prescription is required/);

const schemaPath = path.join(__dirname, '..', 'data', 'protocol_admin.schema.json');
assert.doesNotThrow(() => JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
const migrationPath = path.join(__dirname, '..', 'db', 'migrations', '001_protocol_admin_core.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');
assert(migration.includes('prevent_approval_snapshot_mutation'));
assert(migration.includes('CREATE TABLE audit_log'));
assert(migration.includes('CREATE TABLE integration_jobs'));

console.log('Protocol Admin contract and quality gate tests passed.');
