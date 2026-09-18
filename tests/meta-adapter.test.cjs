const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = {
  MSP: { apiVersion: 'v26.0' },
  token_: () => 'test-token',
  DriveApp: {},
  UrlFetchApp: {}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'appsscript', 'Meta.gs'), 'utf8'), sandbox, { filename: 'Meta.gs' });

test('Graph resources are allowlisted rather than accepted as arbitrary URLs', () => {
  assert.equal(sandbox.allowedGraphResource_('me'), true);
  assert.equal(sandbox.allowedGraphResource_('123/feed'), true);
  assert.equal(sandbox.allowedGraphResource_('123/media_publish'), true);
  assert.equal(sandbox.allowedGraphResource_('https://evil.example/steal'), false);
  assert.equal(sandbox.allowedGraphResource_('123/../../me'), false);
});

test('upload URLs must use an exact Meta upload host and expected path', () => {
  assert.equal(sandbox.validUploadUrl_('https://rupload.facebook.com/video-upload/v26.0/123'), true);
  assert.equal(sandbox.validUploadUrl_('https://rupload.facebook.com/ig-api-upload/v26.0/123?offset=0'), true);
  assert.equal(sandbox.validUploadUrl_('https://rupload.facebook.com.evil.example/video-upload/v26.0/123'), false);
  assert.equal(sandbox.validUploadUrl_('http://rupload.facebook.com/video-upload/v26.0/123'), false);
});

test('indexed Facebook attachment keys survive form encoding', () => {
  const body = sandbox.formBody_({
    message: 'Hello',
    'attached_media[0]': JSON.stringify({ media_fbid: '123' }),
    'attached_media[1]': JSON.stringify({ media_fbid: '456' })
  });
  assert.match(body, /attached_media%5B0%5D=/);
  assert.match(body, /attached_media%5B1%5D=/);
});
