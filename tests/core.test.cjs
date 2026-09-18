const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'appsscript', 'Core.gs'), 'utf8');
const sandbox = { module: { exports: {} }, exports: {} };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'Core.gs' });
const core = sandbox.module.exports;

function karachiToEpoch(parts, zone) {
  assert.equal(zone, 'Asia/Karachi');
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour - 5, parts.minute, parts.second || 0);
}

function headers() { return core.HEADERS.slice(); }

function row(overrides = {}) {
  const base = {
    post_id: 'DEMO-001',
    media_files: 'media/DEMO-001.jpg',
    caption: 'A valid caption.',
    publish_at: '2099-01-15 19:30',
    approval: 'DRAFT',
    facebook_status: 'PENDING',
    instagram_status: 'PENDING',
    facebook_state: '',
    instagram_state: '',
    last_error: '',
    format: 'Single image',
    reel_cover_filename: '',
    facebook_post_id: '',
    instagram_post_id: '',
    verification: 'VERIFIED',
    topic: 'Example',
    notes: ''
  };
  const merged = { ...base, ...overrides };
  return core.HEADERS.map((header) => merged[header]);
}

test('parses plain local timestamps and explicit-offset timestamps', () => {
  const local = core.parsePublishAt('2026-09-21 07:30', 'Asia/Karachi', karachiToEpoch);
  assert.equal(local.ok, true);
  assert.equal(new Date(local.epoch).toISOString(), '2026-09-21T02:30:00.000Z');

  const iso = core.parsePublishAt('2026-09-21T07:30:00+05:00', 'Asia/Karachi', karachiToEpoch);
  assert.equal(iso.ok, true);
  assert.equal(new Date(iso.epoch).toISOString(), '2026-09-21T02:30:00.000Z');
});

test('rejects locale dates, impossible dates, and invalid times', () => {
  for (const value of ['21/09/2026 07:30', '2026-02-29 07:30', '2026-01-01 24:00', '2026-01-01 07:60']) {
    assert.equal(core.parsePublishAt(value, 'Asia/Karachi', karachiToEpoch).ok, false, value);
  }
  assert.equal(core.parsePublishAt('2028-02-29 07:30', 'Asia/Karachi', karachiToEpoch).ok, true);
});

test('requires the exact A:Q headers and unique post IDs', () => {
  assert.equal(core.parseRows([headers(), row()]).length, 1);
  const bad = headers();
  bad[3] = 'date';
  assert.throws(() => core.parseRows([bad, row()]), /headers must match/i);
  assert.throws(() => core.parseRows([headers(), row(), row()]), /Duplicate post_id/);
});

test('validates media counts, extensions, traversal, and caption length', () => {
  const valid = core.rowFromValues(row(), 2);
  assert.deepEqual(Array.from(core.staticRowIssues(valid, 'Asia/Karachi', karachiToEpoch)), []);

  const carousel = core.rowFromValues(row({ format: 'Carousel', media_files: 'one.jpg|two.jpg' }), 2);
  assert.deepEqual(Array.from(core.staticRowIssues(carousel, 'Asia/Karachi', karachiToEpoch)), []);

  const duplicate = core.rowFromValues(row({ format: 'Carousel', media_files: 'one.jpg|one.jpg' }), 2);
  assert.match(core.staticRowIssues(duplicate, 'Asia/Karachi', karachiToEpoch).join(' '), /duplicate path/i);

  const traversal = core.rowFromValues(row({ media_files: '../secret.jpg' }), 2);
  assert.match(core.staticRowIssues(traversal, 'Asia/Karachi', karachiToEpoch).join(' '), /unsafe/i);

  const longCaption = core.rowFromValues(row({ caption: 'x'.repeat(2201) }), 2);
  assert.match(core.staticRowIssues(longCaption, 'Asia/Karachi', karachiToEpoch).join(' '), /2,200/);
});

test('blocks unresolved variable event dates and accepts reconfirmed dates', () => {
  const blocked = core.rowFromValues(row({ approval: 'APPROVED', verification: 'VERIFIED; VARIABLE DATES FLAGGED' }), 2);
  assert.match(core.staticRowIssues(blocked, 'Asia/Karachi', karachiToEpoch).join(' '), /still variable/i);

  const ready = core.rowFromValues(row({ approval: 'APPROVED', verification: 'VERIFIED; DATE RECONFIRMED' }), 2);
  assert.doesNotMatch(core.staticRowIssues(ready, 'Asia/Karachi', karachiToEpoch).join(' '), /still variable/i);

  for (const verification of ['', 'VERFIED', 'RESEARCHED', 'VERIFIED; SOURCE CHECKED']) {
    const invalid = core.rowFromValues(row({ approval: 'APPROVED', verification }), 2);
    assert.match(core.staticRowIssues(invalid, 'Asia/Karachi', karachiToEpoch).join(' '), /Set verification/i);
  }
});

test('detects a saved DONE state whose visible status still needs synchronization', () => {
  const incompleteDisplay = core.rowFromValues(row({
    facebook_status: 'PUBLISHING',
    facebook_state: JSON.stringify({ step: 'DONE', published_id: '123' })
  }), 2);
  assert.equal(core.needsLocalSync(incompleteDisplay, 'facebook'), true);

  const completeDisplay = core.rowFromValues(row({
    facebook_status: 'PUBLISHED',
    facebook_state: JSON.stringify({ step: 'DONE', published_id: '123' })
  }), 2);
  assert.equal(core.needsLocalSync(completeDisplay, 'facebook'), false);
});

test('completed approved rows do not depend on archived source media or old dates', () => {
  const complete = row({
    approval: 'APPROVED',
    media_files: '../archived.jpg',
    publish_at: 'old date',
    verification: 'VERIFIED; VARIABLE DATES FLAGGED',
    facebook_status: 'PUBLISHED',
    instagram_status: 'PUBLISHED',
    facebook_state: JSON.stringify({ step: 'DONE' }),
    instagram_state: JSON.stringify({ step: 'DONE' }),
    facebook_post_id: '111',
    instagram_post_id: '222'
  });
  const result = core.validateApproved([headers(), complete], 'Asia/Karachi', karachiToEpoch);
  assert.equal(result.valid, 1);
  assert.equal(result.problems.length, 0);
});

test('approval gates new work but not uncertain publication verification', () => {
  const config = { time_zone: 'Asia/Karachi', prepare_minutes: 60 };
  const due = core.rowFromValues(row({ approval: 'APPROVED', publish_at: '2026-09-21 07:30' }), 2);
  assert.equal(core.isEligible(due, 'facebook', Date.parse('2026-09-21T02:00:00Z'), config, karachiToEpoch), true);

  const draft = core.rowFromValues(row({ approval: 'DRAFT', publish_at: '2026-09-21 07:30' }), 2);
  assert.equal(core.isEligible(draft, 'facebook', Date.parse('2026-09-21T02:00:00Z'), config, karachiToEpoch), false);

  const lowercase = core.rowFromValues(row({ approval: 'approved', publish_at: '2026-09-21 07:30' }), 2);
  assert.equal(core.isEligible(lowercase, 'facebook', Date.parse('2026-09-21T02:00:00Z'), config, karachiToEpoch), false);

  const lowercaseVerification = core.rowFromValues(row({ approval: 'APPROVED', verification: 'verified', publish_at: '2026-09-21 07:30' }), 2);
  assert.equal(core.isEligible(lowercaseVerification, 'facebook', Date.parse('2026-09-21T02:00:00Z'), config, karachiToEpoch), false);

  const uncertain = core.rowFromValues(row({
    approval: 'DRAFT',
    publish_at: '2026-09-21 07:30',
    facebook_state: JSON.stringify({ step: 'VERIFY', remote_id: '123' })
  }), 2);
  assert.equal(core.isEligible(uncertain, 'facebook', Date.parse('2026-09-21T02:00:00Z'), config, karachiToEpoch), true);

  const interruptedStage = core.rowFromValues(row({
    approval: 'DRAFT',
    facebook_state: JSON.stringify({ step: 'NEW', pending_action: 'STAGE_PHOTO' })
  }), 2);
  assert.equal(core.needsReconciliation(interruptedStage, 'facebook'), true);
});

test('state parser fails closed on malformed or unknown state', () => {
  assert.equal(core.parseState('', 'DEMO-001', 'facebook').step, 'NEW');
  assert.throws(() => core.parseState('{bad', 'DEMO-001', 'facebook'), /Invalid state JSON/);
  assert.throws(() => core.parseState('{"step":"MAGIC"}', 'DEMO-001', 'facebook'), /Unrecognized saved state/);
});

test('content signatures are deterministic and order-sensitive', () => {
  assert.equal(core.signature('same'), core.signature('same'));
  assert.notEqual(core.signature('one|two'), core.signature('two|one'));
  assert.notEqual(core.signature('Caption 😀'), core.signature('Caption 😁'));
});
