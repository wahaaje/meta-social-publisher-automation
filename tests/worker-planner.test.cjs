const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = {
  module: { exports: {} }, exports: {},
  Utilities: {
    getUuid: () => '00000000-0000-4000-8000-000000000000',
    formatDate(date, zone, pattern) {
      const shifted = new Date(date.getTime() + 5 * 3600000);
      if (pattern === 'Z') return '+0500';
      if (pattern === 'yyyy-MM-dd HH:mm') return shifted.toISOString().slice(0, 16).replace('T', ' ');
      return shifted.toISOString();
    }
  }
};
vm.createContext(sandbox);
for (const filename of ['Core.gs', 'Config.gs', 'Worker.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript', filename), 'utf8'), sandbox, { filename });
}

const core = sandbox.MSP_Core;
const config = {
  time_zone: 'Asia/Karachi', prepare_minutes: 60, max_late_minutes: 30,
  max_image_bytes: 8e6, max_video_bytes: 20e6
};
const now = Date.parse('2026-09-21T02:00:00Z');
sandbox.resolveRowMedia_ = () => ({
  media: [{ id: 'file', path: 'media/a.jpg', name: 'a.jpg', size: 1000, modifiedTime: '2026-01-01T00:00:00.000Z' }],
  cover: null
});
sandbox.mediaSignature_ = () => 'new-signature';

function queueRow(overrides = {}) {
  const base = {
    post_id: 'DEMO-001', media_files: 'media/a.jpg', caption: 'Caption',
    publish_at: '2026-09-21 07:30', approval: 'APPROVED',
    facebook_status: 'PENDING', instagram_status: 'PENDING',
    facebook_state: '', instagram_state: '', last_error: '',
    format: 'Single image', reel_cover_filename: '', facebook_post_id: '',
    instagram_post_id: '', verification: 'VERIFIED', topic: 'Alt text', notes: ''
  };
  const data = { ...base, ...overrides };
  return core.HEADERS.map((header) => data[header]);
}

test('uncertain staging under Facebook DISABLED is reviewed, never replayed', () => {
  const row = queueRow({
    facebook_status: 'DISABLED',
    facebook_state: JSON.stringify({
      step: 'NEW', signature: 'new-signature', pending_action: 'STAGE_PHOTO',
      pending_since: '2026-09-21T01:00:00.000Z'
    })
  });
  const plan = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, new Set());
  assert.equal(plan.action, 'LOCAL_REVIEW');
  assert.equal(plan.platform, 'facebook');
});

test('fresh pending staging waits without planning a second mutation', () => {
  const row = queueRow({
    facebook_status: 'DISABLED',
    facebook_state: JSON.stringify({
      step: 'NEW', signature: 'new-signature', pending_action: 'STAGE_PHOTO',
      pending_since: '2026-09-21T01:59:30.000Z'
    })
  });
  const plan = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, new Set());
  assert.equal(plan, null);
});

test('a terminal Facebook signature mismatch routes review to open Instagram', () => {
  const row = queueRow({
    facebook_status: 'PUBLISHED', facebook_post_id: '111',
    facebook_state: JSON.stringify({ step: 'DONE', signature: 'old-signature', photo_ids: [] })
  });
  const plan = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, new Set());
  assert.equal(plan.action, 'LOCAL_REVIEW');
  assert.equal(plan.platform, 'instagram');
});

test('the seen set prevents repeated verification polling in one trigger run', () => {
  const row = queueRow({
    approval: 'DRAFT', format: 'Reel', media_files: 'media/a.mp4',
    facebook_status: 'PUBLISHING',
    facebook_state: JSON.stringify({ step: 'VERIFY', remote_id: '123' }),
    instagram_status: 'DISABLED'
  });
  const first = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, new Set());
  assert.equal(first.action, 'FB_REEL_VERIFY');
  const seen = new Set([sandbox.planKey_(first)]);
  const second = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, seen);
  assert.equal(second, null);
});

test('a confirmed DONE state repairs a stale visible status without a remote mutation', () => {
  const row = queueRow({
    approval: 'DRAFT',
    facebook_status: 'PUBLISHING',
    facebook_state: JSON.stringify({ step: 'DONE', published_id: '123', signature: 'new-signature' }),
    instagram_status: 'DISABLED'
  });
  const plan = sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, new Set());
  assert.equal(plan.action, 'LOCAL_SYNC_DONE');
  assert.equal(plan.platform, 'facebook');
  assert.equal(sandbox.mutationAction_(plan.action), false);

  const seen = new Set([sandbox.planKey_(plan)]);
  assert.equal(sandbox.planNextAction_([core.HEADERS, row], config, {}, now, {}, seen), null);
});

test('seen reconciliation work does not starve an unrelated due row', () => {
  const recovering = queueRow({
    post_id: 'DEMO-RECOVER', approval: 'DRAFT', format: 'Reel', media_files: 'media/recover.mp4',
    facebook_status: 'PUBLISHING',
    facebook_state: JSON.stringify({ step: 'VERIFY', remote_id: '123' }),
    instagram_status: 'DISABLED'
  });
  const due = queueRow({ post_id: 'DEMO-DUE' });
  const first = sandbox.planNextAction_([core.HEADERS, recovering, due], config, {}, now, {}, new Set());
  assert.equal(first.action, 'FB_REEL_VERIFY');
  const second = sandbox.planNextAction_([core.HEADERS, recovering, due], config, {}, now, {}, new Set([sandbox.planKey_(first)]));
  assert.equal(second.post_id, undefined);
  assert.equal(second.row.post_id, 'DEMO-DUE');
  assert.equal(second.action, 'STAGE_PHOTO');
});

test('an uncertain Instagram image publish cannot fall back into ordinary image planning', () => {
  const uncertain = queueRow({
    post_id: 'DEMO-UNCERTAIN', approval: 'DRAFT',
    facebook_status: 'PUBLISHED',
    facebook_state: JSON.stringify({ step: 'DONE', published_id: '111', signature: 'new-signature' }),
    instagram_status: 'PUBLISHING',
    instagram_state: JSON.stringify({ step: 'VERIFY', remote_id: '222', signature: 'new-signature' })
  });
  const first = sandbox.planNextAction_([core.HEADERS, uncertain], config, {}, now, {}, new Set());
  assert.equal(first.action, 'IG_VERIFY');
  assert.equal(
    sandbox.planNextAction_([core.HEADERS, uncertain], config, {}, now, {}, new Set([sandbox.planKey_(first)])),
    null
  );

  const due = queueRow({ post_id: 'DEMO-OTHER' });
  const next = sandbox.planNextAction_([core.HEADERS, uncertain, due], config, {}, now, {}, new Set([sandbox.planKey_(first)]));
  assert.equal(next.row.post_id, 'DEMO-OTHER');
  assert.equal(next.action, 'STAGE_PHOTO');
});
