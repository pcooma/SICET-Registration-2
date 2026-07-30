const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
const sandbox = {
  console,
  Logger: { log() {} },
  SpreadsheetApp: { flush() {} },
  MimeType: { PLAIN_TEXT: 'text/plain' },
  Utilities: { getUuid: () => 'test-version' },
  DriveApp: {
    getFileById(id) {
      return replacementFiles.find(file => file.id === id);
    }
  }
};
const replacementFiles = [];
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const validSettings = {
  categories: [
    { id: 'author', label: 'Author', fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250 },
    { id: 'student', label: 'Student', fee_local: 10000, fee_saarc: 100, fee_nonsaarc: 150 }
  ],
  pre_conference_sessions: [
    { id: 'pcs1', name: 'Workshop A', fee_local: 10000, fee_saarc: 35, fee_nonsaarc: 50 }
  ],
  journals: [{ id: 'j1', name: 'Scopus Q1', fee: 300, apc_not_applicable: false }],
  usd_to_lkr: 320
};

assert.equal(sandbox.validateSettings(validSettings).valid, true, 'valid settings should pass');

const noApcSettings = JSON.parse(JSON.stringify(validSettings));
noApcSettings.journals[0].apc_not_applicable = true;
noApcSettings.journals[0].fee = 300;
const noApcResult = sandbox.validateSettings(noApcSettings);
assert.equal(noApcResult.valid, true, 'APC-not-applicable journal should be accepted');
assert.equal(noApcResult.settings.journals[0].fee, 0, 'backend must force inapplicable APC fee to zero');

const afterDeletion = JSON.parse(JSON.stringify(validSettings));
afterDeletion.categories.splice(0, 1);
assert.equal(sandbox.validateSettings(afterDeletion).valid, true, 'deleting one category should remain valid');
assert.equal(afterDeletion.categories[0].id, 'student', 'remaining category ID must not change');

const duplicates = JSON.parse(JSON.stringify(validSettings));
duplicates.categories.push({ id: 'student', label: 'Student', fee_local: 0 });
assert.equal(sandbox.validateSettings(duplicates).valid, false, 'duplicate IDs and labels must be rejected');

const originalHeaders = ['Submission_Date', 'Invoice_ID', 'Full_Name'];
let appended = [];
const mockSheet = {
  getLastColumn: () => originalHeaders.length,
  getRange(row, column, rows, columns) {
    if (row === 1 && column === 1) return { getValues: () => [originalHeaders.slice()] };
    return { setValues(values) { appended = values[0].slice(0, columns); } };
  }
};
const migration = sandbox.ensureMasterSheetSchema(mockSheet);
assert.deepEqual(originalHeaders, ['Submission_Date', 'Invoice_ID', 'Full_Name'], 'existing columns must remain untouched');
assert.ok(appended.includes('Settings_Version'), 'new audit columns must be appended');
assert.equal(migration.finalColumnCount, originalHeaders.length + appended.length);

const historicalSnapshot = JSON.stringify({ category: validSettings.categories[0], settings_version: 'v1' });
const row = sandbox.buildRow(
  ['Invoice_ID', 'Attendee_Category', 'Attendee_Category_ID', 'Settings_Version', 'Pricing_Snapshot'],
  {
    Invoice_ID: 'SICET2026-TEST01',
    Attendee_Category: 'Author',
    Attendee_Category_ID: 'author',
    Settings_Version: 'v1',
    Pricing_Snapshot: historicalSnapshot
  },
  ''
);
assert.deepEqual(
  Array.from(row),
  ['SICET2026-TEST01', 'Author', 'author', 'v1', historicalSnapshot],
  'historical pricing identity and snapshot must survive sheet serialization'
);

// Model a live Drive iterator: after rename it would include the new file if
// the implementation retained the iterator instead of materialising old IDs.
const oldFile = { id: 'old', name: 'settings.json', trashed: false, getId() { return this.id; }, setTrashed(v) { this.trashed = v; } };
replacementFiles.push(oldFile);
const replacementFolder = {
  getFilesByName(name) {
    let cursor = 0;
    return {
      hasNext: () => replacementFiles.filter(file => file.name === name && !file.trashed).length > cursor,
      next: () => replacementFiles.filter(file => file.name === name && !file.trashed)[cursor++]
    };
  },
  createFile(name) {
    const file = {
      id: 'new', name, trashed: false,
      getId() { return this.id; },
      setName(nextName) { this.name = nextName; },
      setTrashed(v) { this.trashed = v; }
    };
    replacementFiles.push(file);
    return file;
  }
};
sandbox.replaceJsonFileSafely(replacementFolder, 'settings.json', { version: 2 });
assert.equal(oldFile.trashed, true, 'old canonical file should be retired');
assert.equal(replacementFiles.find(file => file.id === 'new').trashed, false, 'new canonical file must never be trashed');
assert.equal(replacementFiles.find(file => file.id === 'new').name, 'settings.json');

console.log('backend resilience tests passed');
