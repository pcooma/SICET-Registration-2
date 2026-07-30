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

const normalizedNoPapers = sandbox.normalizeConditionalRegistration({
  Registration_Type: 'Main + Excursion',
  Number_of_Papers: '5',
  Include_Inauguration: 'on',
  Attendee_Region: 'SAARC',
  Excursion_Local_Count: '5',
  Excursion_Foreign_Count: '2'
}, { no_papers: true, is_student: false, is_workshop_only: false });
assert.equal(normalizedNoPapers.Number_of_Papers, '0', 'no-papers category must discard hidden paper count');
assert.equal(normalizedNoPapers.Include_Inauguration, '', 'non-student category must discard inauguration opt-in');
assert.equal(normalizedNoPapers.Excursion_Local_Count, '0', 'foreign region must discard hidden local excursion count');
assert.equal(normalizedNoPapers.Excursion_Foreign_Count, '2');

const normalizedInactiveSections = sandbox.normalizeConditionalRegistration({
  Registration_Type: 'Pre-Conference Workshops',
  Number_of_Papers: '3',
  Paper_1_Title: 'Orphaned title',
  Include_Inauguration: 'on',
  Participant_Count: '5',
  Participant_Names: 'Orphaned names',
  Excursion_Local_Count: '4',
  Mobility_Requirements: 'Wheelchair Access Needed',
  PreConf_Session_IDs: 'pcs1',
  PreConf_Sessions: 'Workshop A',
  Workshop_Discount_Tier: 'student'
}, { no_papers: false, is_student: true, is_workshop_only: false });
assert.equal(normalizedInactiveSections.Number_of_Papers, '0', 'inactive main conference must discard paper count');
assert.equal('Paper_1_Title' in normalizedInactiveSections, false, 'inactive main conference must discard paper details');
assert.equal(normalizedInactiveSections.Include_Inauguration, '', 'inactive main conference must discard inauguration opt-in');
assert.equal(normalizedInactiveSections.Participant_Count, '0', 'inactive award must discard participant count');
assert.equal(normalizedInactiveSections.Participant_Names, '', 'inactive award must discard participant details');
assert.equal(normalizedInactiveSections.Excursion_Local_Count, '0', 'inactive excursion must discard ticket count');
assert.equal(normalizedInactiveSections.Mobility_Requirements, '', 'inactive excursion must discard preferences');
assert.equal(normalizedInactiveSections.PreConf_Session_IDs, 'pcs1', 'active workshop selections must be preserved');
assert.equal(normalizedInactiveSections.Workshop_Discount_Tier, 'student', 'active workshop tier must be preserved');

const emptyFolder = {
  getFolders() {
    return { hasNext: () => false };
  }
};
const baseRegistration = {
  Full_Name: 'Test User',
  Email: 'test@example.com',
  Phone: '+94 77 123 4567',
  Organization: 'SLIIT',
  Attendee_Region: 'Local',
  Country: 'Sri Lanka',
  Attendee_Category: 'Author',
  Invoice_ID: 'SICET2026-TEST01',
  Calculated_Total_Fee: '0'
};
const emptyWorkshopRegistration = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
  Registration_Type: 'Pre-Conference Workshops',
  PreConf_Session_IDs: '',
  PreConf_Sessions: ''
}), emptyFolder);
assert.equal(emptyWorkshopRegistration.valid, false, 'active workshop registration must select at least one workshop');
assert.ok(Array.from(emptyWorkshopRegistration.errors).includes('Select at least one pre-conference workshop.'));

const zeroExcursionRegistration = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
  Registration_Type: 'Excursion',
  Excursion_Local_Count: '0'
}), emptyFolder);
assert.equal(zeroExcursionRegistration.valid, false, 'active excursion must include at least one participant');
assert.ok(Array.from(zeroExcursionRegistration.errors).includes('Excursion registration requires at least one participant.'));

console.log('backend resilience tests passed');
