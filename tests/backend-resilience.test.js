const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'google-apps-script', 'Code.gs'), 'utf8');
const sandbox = {
  console,
  Logger: { log() {} },
  SpreadsheetApp: { flush() {} },
  MimeType: { PLAIN_TEXT: 'text/plain' },
  Utilities: {
    getUuid: () => 'test-version',
    base64Decode: value => Array.from(Buffer.from(value, 'base64')),
    formatDate: () => '2026-08-14'
  },
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
assert.ok(appended.includes('Conference_Workshops'), 'conference workshop names must use an append-only column');
assert.ok(appended.includes('Conference_Workshop_IDs'), 'conference workshop IDs must use an append-only column');
assert.ok(appended.includes('Paper_Details'), 'paper ID/title summary must use an append-only column');
assert.ok(appended.includes('CMT_Changes'), 'CMT differences must use an append-only column');
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
  CMT_Changes: 'Stale author-only note',
  Include_Inauguration: 'on',
  Attendee_Region: 'SAARC',
  Excursion_Local_Count: '5',
  Excursion_Foreign_Count: '2'
}, { no_papers: true, is_student: false, is_workshop_only: false });
assert.equal(normalizedNoPapers.Number_of_Papers, '0', 'no-papers category must discard hidden paper count');
assert.equal(normalizedNoPapers.CMT_Changes, '', 'non-author categories must discard author-only CMT changes');
assert.equal(normalizedNoPapers.Include_Inauguration, '', 'non-student category must discard inauguration opt-in');
assert.equal(normalizedNoPapers.Excursion_Local_Count, '0', 'foreign region must discard hidden local excursion count');
assert.equal(normalizedNoPapers.Excursion_Foreign_Count, '2');

const normalizedForeignTransport = sandbox.normalizeConditionalRegistration({
  Registration_Type: 'Main', Attendee_Region: 'SAARC', Transport_Mode: 'Ride-hailing / Taxi',
  Vehicle_Number: 'STALE-1234'
}, { no_papers: true, is_student: false, is_workshop_only: false });
assert.equal(normalizedForeignTransport.Transport_Mode, 'Ride-hailing / Taxi', 'international travel mode must be preserved');
assert.equal(normalizedForeignTransport.Vehicle_Number, '', 'non-parking transport must not retain vehicle numbers');

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
assert.equal(normalizedInactiveSections.CMT_Changes, '', 'inactive main conference must discard CMT changes');
assert.equal(normalizedInactiveSections.Include_Inauguration, '', 'inactive main conference must discard inauguration opt-in');
assert.equal(normalizedInactiveSections.Participant_Count, '0', 'inactive award must discard participant count');
assert.equal(normalizedInactiveSections.Participant_Names, '', 'inactive award must discard participant details');
assert.equal(normalizedInactiveSections.Excursion_Local_Count, '0', 'inactive excursion must discard ticket count');
assert.equal(normalizedInactiveSections.Mobility_Requirements, '', 'inactive excursion must discard preferences');
assert.equal(normalizedInactiveSections.PreConf_Session_IDs, 'pcs1', 'active workshop selections must be preserved');
assert.equal(normalizedInactiveSections.Workshop_Discount_Tier, 'student', 'active workshop tier must be preserved');

const expiredErrors = [];
sandbox.validateEventSelections('expired', [
  { id: 'active', name: 'Active', event_date: '2026-08-20', active: true },
  { id: 'expired', name: 'Expired', event_date: '2026-08-01', active: true }
], '', '2026-08-13', 'workshop', expiredErrors);
assert.equal(expiredErrors.length, 1, 'new registrations must reject expired workshop IDs');
const historicalExpiredErrors = [];
sandbox.validateEventSelections('expired', [], 'expired', '2026-08-13', 'workshop', historicalExpiredErrors);
assert.equal(historicalExpiredErrors.length, 0, 'returning records may preserve their historical workshop selection');
const disabledErrors = [];
sandbox.validateEventSelections('disabled', [{ id: 'disabled', active: false }], '', '2026-08-13', 'workshop', disabledErrors);
assert.equal(disabledErrors.length, 1, 'new registrations must reject disabled workshop IDs');
assert.equal(sandbox.hasRegistrationType('Pre-Conference Workshops', 'Conference Workshops'), false, 'pre-conference must not be misclassified as conference-day workshops');
assert.equal(sandbox.hasRegistrationType('Main + Conference Workshops', 'Conference Workshops'), true, 'exact combined product tokens must be recognized');

const missingPaperErrors = [];
sandbox.validateAuthorPaperDetails({ Number_of_Papers: '2', Paper_1_ID: '101', Paper_1_Title: 'First' }, { no_papers: false, is_workshop_only: false }, missingPaperErrors);
assert.deepEqual(Array.from(missingPaperErrors), ['Paper 2 ID is required.', 'Paper 2 title is required.'], 'every author paper must include both ID and title');
const completePaperErrors = [];
sandbox.validateAuthorPaperDetails({ Number_of_Papers: '1', Paper_1_ID: '101', Paper_1_Title: 'Complete paper' }, { no_papers: false, is_workshop_only: false }, completePaperErrors);
assert.equal(completePaperErrors.length, 0, 'complete author paper details must pass validation');
const participantPaperErrors = [];
sandbox.validateAuthorPaperDetails({ Number_of_Papers: '0' }, { no_papers: true, is_workshop_only: false }, participantPaperErrors);
assert.equal(participantPaperErrors.length, 0, 'non-author participant categories must not require paper details');
assert.equal(sandbox.uploadExtension('application/pdf'), '.pdf', 'canonical payment proof names must retain a safe extension');
assert.equal(sandbox.uploadExtension('image/jpeg'), '.jpg', 'JPEG proofs must receive the canonical extension');
assert.equal(
  sandbox.buildPaymentProofName({
    Invoice_ID: 'SICET2026-ABC123',
    Attendee_Category_ID: 'author',
    Attendee_Category: 'General Author',
    Registration_Type: 'Main + Award + Pre-Conference Workshops',
    Number_of_Papers: '2',
    Paper_1_ID: 'CMT 195',
    Paper_2_ID: 'CMT/220'
  }, 0, 'application/pdf', new Date('2026-08-14T00:00:00Z')),
  'payment-proof_General-Author_Main-Conference_Excellence-Award_PreConf-Workshops_Papers-CMT-195-CMT-220_2026-08-14_SICET2026-ABC123_01.pdf',
  'author proof names must trace category, every product, paper IDs, date, reference, and sequence'
);
assert.equal(
  sandbox.buildPaymentProofName({
    Invoice_ID: 'SICET2026-NONA01',
    Attendee_Category: 'Student Participant (Non-Author)',
    Registration_Type: 'Excursion',
    Number_of_Papers: '0'
  }, 1, 'image/png', new Date('2026-08-14T00:00:00Z')),
  'payment-proof_Student-Participant-Non-Author_Excursion_2026-08-14_SICET2026-NONA01_02.png',
  'non-author proof names must omit misleading paper identifiers'
);
const authorWithoutPaperName = sandbox.buildPaymentProofName({
  Invoice_ID: 'SICET2026-AWARD01', Attendee_Category_ID: 'author', Attendee_Category: 'General Author',
  Registration_Type: 'Award', Number_of_Papers: '0'
}, 0, 'image/jpeg', new Date('2026-08-14T00:00:00Z'));
assert.ok(authorWithoutPaperName.includes('_Paper-ID-Unavailable_'), 'author categories without a paper-bearing product must remain visibly traceable');
const allProductsName = sandbox.buildPaymentProofName({
  Invoice_ID: 'SICET2026-ALL001', Attendee_Category: 'Student Author', Attendee_Category_ID: 'student',
  Registration_Type: 'Main + Award + Excursion + Pre-Conference Workshops + Conference Workshops',
  Number_of_Papers: '10',
  ...Object.fromEntries(Array.from({length:10}, (_, index) => ['Paper_' + (index + 1) + '_ID', 'CMT-' + (index + 1)]))
}, 2, 'application/pdf', new Date('2026-08-14T00:00:00Z'));
assert.ok(allProductsName.length < 255, 'combined-product and ten-paper filenames must stay inside Drive filename limits');
assert.ok(allProductsName.endsWith('_03.pdf'), 'split-payment sequence and safe extension must be retained');

const serverPrice = sandbox.calculateAuthoritativeFee({
  Registration_Type: 'Main + Award', Attendee_Region: 'Local', Number_of_Papers: '2', Participant_Count: '1'
}, {
  usd_to_lkr: 320, discounts: { student_from_2nd: 10, discount_max_papers: 3 }, journals: [],
  award_fee: 10000, excursion_fees: { local: 15000, foreigner: 50 }
}, { fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250, paper_discount: true }, []);
assert.equal(serverPrice.total, 38500, 'backend must independently calculate paid totals instead of trusting the browser');
assert.equal(serverPrice.currency, 'LKR');
const tamperedFreeClaim = sandbox.calculateAuthoritativeFee({
  Registration_Type: 'Main', Attendee_Region: 'SAARC', Number_of_Papers: '1', Calculated_Total_Fee: '0'
}, { usd_to_lkr: 320, discounts: {}, journals: [], excursion_fees: {} },
{ fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250 }, []);
assert.equal(tamperedFreeClaim.total, 150, 'a client-supplied zero must not bypass payment requirements');

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
  Transport_Mode: 'Public Transport',
  Attendee_Category: 'Author',
  Invoice_ID: 'SICET2026-TEST01',
  Calculated_Total_Fee: '0'
};
const missingTransport = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
  Registration_Type: 'Award', Transport_Mode: ''
}), emptyFolder);
assert.equal(missingTransport.valid, false, 'local registration must include transportation mode');
assert.ok(Array.from(missingTransport.errors).includes('Select a transportation option.'));

const missingVehicleNumber = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
  Registration_Type: 'Award', Transport_Mode: 'Private Vehicle - Parking Required', Vehicle_Number: ''
}), emptyFolder);
assert.equal(missingVehicleNumber.valid, false, 'private vehicle registration must include vehicle number');
assert.ok(Array.from(missingVehicleNumber.errors).includes('Vehicle registration number is required when on-campus parking is requested.'));
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

['-2', '0', '1.5', 'not-a-number'].forEach(participantCount => {
  const invalidAwardRegistration = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
    Registration_Type: 'Award',
    Participant_Count: participantCount
  }), emptyFolder);
  assert.equal(invalidAwardRegistration.valid, false, `award participant count ${participantCount} must be rejected`);
  assert.ok(Array.from(invalidAwardRegistration.errors).includes(
    'Excellence Award registration requires at least one participant.'
  ));
});

const validAwardRegistration = sandbox.validateRegistration(Object.assign({}, baseRegistration, {
  Registration_Type: 'Award',
  Participant_Count: '2'
}), emptyFolder);
assert.equal(validAwardRegistration.valid, true, 'positive whole-number award participant count must be accepted');

const nonAuthorCategory = { no_papers: true, is_student: false, is_workshop_only: false,
  fee_local: 12500, fee_saarc: 40, fee_nonsaarc: 70 };
const apcSettings = {
  usd_to_lkr: 320, discounts: {}, journals: [{ name: 'Injected Journal', fee: 500 }],
  award_fee: 0, excursion_fees: {}
};
const tamperedNonAuthor = {
  Registration_Type: 'Main', Attendee_Region: 'Local', Number_of_Papers: '1',
  Paper_1_Include_APC: 'on', Paper_1_Journal: 'Injected Journal'
};
const nonAuthorFee = sandbox.calculateAuthoritativeFee(tamperedNonAuthor, apcSettings, nonAuthorCategory, []);
assert.equal(nonAuthorFee.total, 12500, 'non-author total must ignore stale or injected APC fields');
const normalizedTamperedNonAuthor = sandbox.normalizeConditionalRegistration(
  Object.assign({}, tamperedNonAuthor), nonAuthorCategory);
assert.equal(normalizedTamperedNonAuthor.Paper_1_Include_APC, undefined,
  'non-author normalization must remove stale paper and APC fields');
assert.equal(normalizedTamperedNonAuthor.Paper_1_Journal, undefined,
  'non-author normalization must remove stale journal fields');

const genericMimePdf = {
  name: 'bank-slip.pdf',
  mimeType: 'application/octet-stream',
  data: Buffer.from('%PDF-1.4\nprobe').toString('base64')
};
const genericMimeErrors = [];
sandbox.validateUpload(genericMimePdf, 'Payment proof 1', genericMimeErrors);
assert.deepEqual(genericMimeErrors, [], 'valid PDF signature must survive a generic mobile-browser MIME type');
assert.equal(genericMimePdf.mimeType, 'application/pdf', 'backend must canonicalize a valid PDF MIME type');

const spoofedPdfErrors = [];
sandbox.validateUpload({
  name: 'bank-slip.pdf',
  mimeType: 'application/pdf',
  data: Buffer.from('not really a PDF').toString('base64')
}, 'Payment proof 1', spoofedPdfErrors);
assert.ok(spoofedPdfErrors.includes('Payment proof 1 is not a valid PDF, JPEG, PNG, or WebP file.'),
  'backend must reject extension/MIME spoofing when the file signature is invalid');

console.log('backend resilience tests passed');
