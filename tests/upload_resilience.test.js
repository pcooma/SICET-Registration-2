const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const helperMatch = source.match(/function resolveUploadMime\(file\) \{[\s\S]*?\n\}/);
assert.ok(helperMatch, 'resolveUploadMime helper must exist');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(helperMatch[0], sandbox);

assert.equal(sandbox.resolveUploadMime({ name: 'bank-slip.pdf', type: '' }), 'application/pdf',
  'WhatsApp/mobile PDF with missing MIME must be inferred from its extension');
assert.equal(sandbox.resolveUploadMime({ name: 'BANK-SLIP.PDF', type: 'application/octet-stream' }), 'application/pdf',
  'generic MIME PDF must be normalized case-insensitively');
assert.equal(sandbox.resolveUploadMime({ name: 'receipt.jpeg', type: '' }), 'image/jpeg');
assert.equal(sandbox.resolveUploadMime({ name: 'receipt.png', type: 'image/png' }), 'image/png');
assert.equal(sandbox.resolveUploadMime({ name: 'receipt.heic', type: 'image/heic' }), '',
  'formats rejected by the backend must be rejected immediately by the picker logic');
assert.equal(sandbox.resolveUploadMime({ name: 'malware.exe', type: 'application/pdf' }), 'application/pdf',
  'client MIME is only a usability hint; backend signature validation remains authoritative');

console.log('upload resilience tests passed');
