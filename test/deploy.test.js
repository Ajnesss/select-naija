'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Oracle's console encodes the cloud-init script in the browser; any non-ASCII character
// (e.g. an arrow in a comment) made it reject the request as "incorrectly formatted" (11 Nov 2026).
test('setup script is plain ASCII, Unix line endings, and under the 32 KB cloud-init limit', () => {
  const file = path.join(__dirname, '..', 'deploy', 'setup-micro.sh');
  const buf = fs.readFileSync(file);
  const bad = [...buf.toString('utf8')].findIndex((c) => c.charCodeAt(0) > 127);
  assert.equal(bad, -1, `non-ASCII character at offset ${bad}`);
  assert.ok(!buf.includes('\r'), 'Windows line endings found');
  assert.ok(buf.length < 32 * 1024);
  assert.ok(buf.toString('utf8').startsWith('#!/bin/bash\n'));
});
