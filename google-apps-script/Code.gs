/**
 * SICET 2026 Registration — Google Apps Script Backend
 *
 * HOW TO DEPLOY:
 * 1. Open https://script.google.com and create a new project named "SICET2026 Registration"
 * 2. Paste this entire file into Code.gs
 * 3. In Project Settings > Script properties set ADMIN_PASSWORD and, optionally, ADMIN_EMAIL
 * 4. Click Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Authorise the script (Drive + Sheets access required)
 * 6. Copy the Web App URL and paste into APPS_SCRIPT_URL in app.js
 *
 * Drive folder structure:
 *   SICET 2026 Registrations/
 *   ├── SICET2026 Master Registrations  (Google Sheet)
 *   ├── SICET2026-XXXXXXX_LastName/
 *   │   ├── registration_data.json
 *   │   ├── invoice_v1.pdf, invoice_v2.pdf …  (versioned proforma invoices)
 *   │   ├── student_id_<filename>
 *   │   └── payment_proof_<filename>
 *   └── …
 */

const MAIN_FOLDER_ID    = '1REXNutSF3mzO7tRkg0tD0GjLqjUlhI-n';
const MASTER_SHEET_NAME = 'SICET2026 Master Registrations';
// Secrets must be stored in Apps Script > Project Settings > Script properties.
// Required: ADMIN_PASSWORD. Optional: ADMIN_EMAIL (defaults to the conference admin).
const ADMIN_EMAIL_DEFAULT = 'p.cooma@gmail.com';
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const SETTINGS_FILE_NAME = 'sicet2026_settings.json';
const SETTINGS_HISTORY_FOLDER_NAME = 'Settings History';
const RECORD_SCHEMA_VERSION = 2;
const MASTER_HEADERS = [
  'Submission_Date', 'Invoice_ID', 'Status',
  'Title', 'Full_Name', 'Email', 'Phone',
  'Organization', 'Attendee_Region', 'Country', 'Attendee_Category',
  'Registration_Type', 'Calculated_Total_Fee', 'Currency',
  'Certificate_Name', 'Designation', 'Food_Preference', 'Number_of_Papers',
  'Include_Inauguration',
  'Company_Name', 'Participant_Count', 'Participant_Names', 'Award_Category',
  'Primary_Reason', 'Primary_Reason_Other',
  'Excursion_Local_Count', 'Excursion_Foreign_Count',
  'Excursion_Mobility', 'Excursion_Activity',
  'PreConf_Sessions', 'Workshop_Discount_Tier', 'Workshop_ID_File',
  'Address', 'Bill_To', 'Billing_Org_Name', 'Billing_Tax_ID',
  'Billing_Address', 'Billing_Finance_Email',
  'Transaction_Ref', 'Additional_Info', 'Drive_Folder_URL',
  // Append-only evolution fields. Never rename/remove older columns.
  'Record_Schema_Version', 'Settings_Version', 'Attendee_Category_ID',
  'PreConf_Session_IDs', 'Pricing_Snapshot'
];

/**
 * ONE-TIME MANUAL MIGRATION
 * Run this function once from the Apps Script editor before deploying the new
 * web-app version. It only appends missing headers to the existing master sheet;
 * it never deletes, reorders, or overwrites existing columns or registration rows.
 */
function migrateMasterSheetSchema() {
  const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (!files.hasNext()) {
    return { success: true, message: 'No master sheet exists yet; the full schema will be created on first submission.', added: [] };
  }

  const sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
  const result = ensureMasterSheetSchema(sheet);
  Logger.log(JSON.stringify(result));
  return result;
}

function ensureMasterSheetSchema(sheet) {
  const lastColumn = sheet.getLastColumn();
  const existing = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String)
    : [];
  const duplicates = existing.filter(function(header, index) {
    return header && existing.indexOf(header) !== index;
  });
  if (duplicates.length) {
    throw new Error('Master sheet has duplicate headers: ' + duplicates.join(', ') + '. Resolve these manually before writing.');
  }
  const missing = MASTER_HEADERS.filter(function(header) { return existing.indexOf(header) < 0; });
  if (missing.length) {
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    SpreadsheetApp.flush();
  }
  return {
    success: true,
    existingColumnCount: existing.length,
    addedColumnCount: missing.length,
    finalColumnCount: existing.length + missing.length,
    added: missing
  };
}

// ---------------------------------------------------------------------------
// POST — handles all write actions from the frontend
// ---------------------------------------------------------------------------
function doPost(e) {
  // Use LockService to prevent concurrent writes corrupting the sheet
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000); // wait up to 15 s
  } catch (_) {
    return jsonResponse({ success: false, error: 'Server busy — please retry in a moment.' });
  }

  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action || 'submitRegistration';

    if (action === 'adminLogin') return handleAdminLogin(data);

    if (action === 'saveInvoice') {
      return handleSaveInvoice(data);
    }

    if (action === 'saveSettings') {
      return handleSaveSettings(data);
    }

    return handleSubmitRegistration(data);
  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// GET — admin reads + health check
// ---------------------------------------------------------------------------
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  const token  = (e.parameter && e.parameter.token)  || '';

  if (action === 'getSubmissions') {
    if (!verifyAdminToken(token)) return jsonResponse({ error: 'Unauthorized' });
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      return jsonResponse({ success: true, submissions: getSubmissionsFromSheet(mainFolder) });
    } catch (err) {
      return jsonResponse({ error: err.toString() });
    }
  }

  if (action === 'getRegistrationByRef') {
    const ref = (e.parameter && e.parameter.ref) || '';
    const email = (e.parameter && e.parameter.email) || '';
    if (!ref || !email) return jsonResponse({ error: 'Reference ID and email are required' });
    try {
      const data = getRegistrationByRef(ref);
      if (normaliseEmail(data.Email) !== normaliseEmail(email)) {
        return jsonResponse({ success: false, error: 'Reference ID and email do not match' });
      }
      return jsonResponse({ success: true, data: data });
    } catch (err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  if (action === 'getSettings') {
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      const result = readCurrentSettingsWithRecovery(mainFolder);
      return jsonResponse({
        success: true,
        settings: result.settings,
        recoveredFromHistory: result.recovered
      });
    } catch (err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  if (action === 'getPaymentProofs') {
    if (!verifyAdminToken(token)) return jsonResponse({ error: 'Unauthorized' });
    const ref = (e.parameter && e.parameter.ref) || '';
    if (!ref) return jsonResponse({ error: 'No ref provided' });
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      const folders = mainFolder.getFolders();
      while (folders.hasNext()) {
        const folder = folders.next();
        if (folder.getName().startsWith(ref + '_')) {
          const proofFiles = [];
          const fileIter = folder.getFiles();
          while (fileIter.hasNext()) {
            const f = fileIter.next();
            if (f.getName().startsWith('payment_proof')) {
              proofFiles.push({
                name:     f.getName(),
                fileId:   f.getId(),
                mimeType: f.getMimeType(),
                url:      f.getUrl()
              });
            }
          }
          return jsonResponse({ success: true, files: proofFiles });
        }
      }
      return jsonResponse({ success: true, files: [] });
    } catch (err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  return jsonResponse({ status: 'SICET 2026 Registration API running' });
}

// ---------------------------------------------------------------------------
// handleSubmitRegistration — create or upsert a registration record
// ---------------------------------------------------------------------------
function handleSubmitRegistration(data) {
  const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);

  const validation = validateRegistration(data, mainFolder);
  if (!validation.valid) return jsonResponse({ success: false, error: validation.errors.join(' ') });
  data = validation.data;

  // Server-side deduplication: if no Invoice_ID supplied, check sheet for existing row with same email
  if (!data.Invoice_ID) {
    const existingId = findInvoiceIdByEmail(data.Email, mainFolder);
    data.Invoice_ID = existingId || generateInvoiceId();
  }

  // Freeze the pricing definition used for this record. A later category,
  // workshop, discount, or fee deletion must never reinterpret old invoices.
  data = attachPricingSnapshot(data, mainFolder);

  const nameParts = (data.Full_Name || 'Unknown').trim().split(/\s+/);
  const lastName  = nameParts[nameParts.length - 1].replace(/[^a-zA-Z0-9]/g, '') || 'Attendee';
  const folderName = data.Invoice_ID + '_' + lastName;

  // Find or create the registrant's sub-folder
  let userFolder;
  userFolder = findFolderByRef(mainFolder, data.Invoice_ID) || mainFolder.createFolder(folderName);

  const folderUrl = userFolder.getUrl();

  // Save uploaded files
  if (data.Student_ID_Base64 && data.Student_ID_Base64.data) {
    saveFileToFolder(userFolder, 'student_id_', data.Student_ID_Base64);
    data.Student_ID_Base64 = '(uploaded — see folder)';
  }
  if (data.Workshop_ID_Base64 && data.Workshop_ID_Base64.data) {
    saveFileToFolder(userFolder, 'workshop_id_', data.Workshop_ID_Base64);
    data.Workshop_ID_Base64 = '(uploaded — see folder)';
  }
  if (data.Payment_Proof_Base64) {
    const proofs = Array.isArray(data.Payment_Proof_Base64)
      ? data.Payment_Proof_Base64
      : [data.Payment_Proof_Base64];
    const validProofs = proofs.filter(p => p && p.data);
    validProofs.forEach((proof, i) => {
      const prefix = validProofs.length > 1 ? 'payment_proof_' + (i + 1) + '_' : 'payment_proof_';
      saveFileToFolder(userFolder, prefix, proof);
    });
    if (validProofs.length > 0) data.Payment_Proof_Base64 = '(uploaded — see folder)';
  }

  data.Drive_Folder_URL = folderUrl;

  // Safe replacement: create the new copy before retiring the last good copy.
  replaceJsonFileSafely(userFolder, 'registration_data.json', data);

  // Upsert row in master sheet
  upsertMasterSheet(data, mainFolder, folderUrl);

  return jsonResponse({ success: true, invoiceId: data.Invoice_ID, folderUrl: folderUrl });
}

// ---------------------------------------------------------------------------
// handleSaveInvoice — version-controlled PDF save
// ---------------------------------------------------------------------------
function handleSaveInvoice(data) {
  const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);

  const nameParts = (data.Full_Name || 'Unknown').trim().split(/\s+/);
  const lastName  = nameParts[nameParts.length - 1].replace(/[^a-zA-Z0-9]/g, '') || 'Attendee';
  const folderName = (data.Invoice_ID || 'DRAFT') + '_' + lastName;

  // Find or create folder
  let userFolder;
  if (!isValidRef(data.Invoice_ID) || !data.Email) return jsonResponse({ success: false, error: 'Valid reference ID and email required' });
  const existing = findFolderByRef(mainFolder, data.Invoice_ID);
  if (existing) {
    const saved = getRegistrationByRef(data.Invoice_ID);
    if (normaliseEmail(saved.Email) !== normaliseEmail(data.Email)) return jsonResponse({ success: false, error: 'Reference ID and email do not match' });
  }
  userFolder = existing || mainFolder.createFolder(folderName);

  if (data.invoice_pdf && data.invoice_pdf.data) {
    // Determine next version number
    let maxVer = 0;
    const files = userFolder.getFiles();
    while (files.hasNext()) {
      const fname = files.next().getName();
      const m = fname.match(/invoice_v(\d+)\.pdf/i);
      if (m) maxVer = Math.max(maxVer, parseInt(m[1]));
    }
    const nextVer = maxVer + 1;
    const blob = Utilities.newBlob(
      Utilities.base64Decode(data.invoice_pdf.data),
      'application/pdf',
      'invoice_v' + nextVer + '.pdf'
    );
    userFolder.createFile(blob);
  }

  return jsonResponse({ success: true });
}

// ---------------------------------------------------------------------------
// handleSaveSettings — persist admin settings JSON to Drive
// ---------------------------------------------------------------------------
function handleSaveSettings(data) {
  if (!verifyAdminToken(data.adminToken)) {
    return jsonResponse({ success: false, error: 'Unauthorized' });
  }
  if (!data.settings) {
    return jsonResponse({ success: false, error: 'No settings payload' });
  }
  try {
    const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
    const checked = validateSettings(data.settings);
    if (!checked.valid) return jsonResponse({ success: false, error: checked.errors.join(' ') });

    const settings = checked.settings;
    const version = Utilities.getUuid();
    settings._meta = {
      schema_version: 2,
      version: version,
      saved_at: new Date().toISOString()
    };

    // Immutable audit copy first; current file is replaced only after that succeeds.
    const historyFolder = getOrCreateChildFolder(mainFolder, SETTINGS_HISTORY_FOLDER_NAME);
    historyFolder.createFile(
      'settings_' + settings._meta.saved_at.replace(/[:.]/g, '-') + '_' + version + '.json',
      JSON.stringify(settings, null, 2),
      MimeType.PLAIN_TEXT
    );
    replaceJsonFileSafely(mainFolder, SETTINGS_FILE_NAME, settings);
    return jsonResponse({ success: true, version: version, settingsMeta: settings._meta });
  } catch (err) {
    Logger.log('handleSaveSettings error: ' + err.toString());
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function validateSettings(input) {
  const settings = JSON.parse(JSON.stringify(input || {}));
  const errors = [];
  validateSettingsCollection(settings.categories, 'category', 'label', errors);
  validateSettingsCollection(settings.pre_conference_sessions || [], 'workshop', 'name', errors);
  validateSettingsCollection(settings.journals || [], 'journal', 'name', errors);
  (settings.journals || []).forEach(function(journal) {
    journal.apc_not_applicable = journal.apc_not_applicable === true;
    if (journal.apc_not_applicable) journal.fee = 0;
  });
  if (!Array.isArray(settings.categories) || settings.categories.length === 0) {
    errors.push('At least one attendee category is required.');
  }
  const rate = Number(settings.usd_to_lkr);
  if (!isFinite(rate) || rate <= 0) errors.push('USD exchange rate must be greater than zero.');
  validateNonNegativeNumbers(settings, '', errors);
  return { valid: errors.length === 0, errors: errors, settings: settings };
}

function validateSettingsCollection(items, type, labelKey, errors) {
  if (!Array.isArray(items)) {
    errors.push('Settings ' + type + ' list is invalid.');
    return;
  }
  const ids = {};
  const labels = {};
  items.forEach(function(item, index) {
    const id = String((item && item.id) || '').trim();
    const label = String((item && item[labelKey]) || '').trim();
    if (!id) errors.push('Every ' + type + ' requires a stable ID (item ' + (index + 1) + ').');
    if (!label) errors.push('Every ' + type + ' requires a name (item ' + (index + 1) + ').');
    if (id && ids[id]) errors.push('Duplicate ' + type + ' ID: ' + id + '.');
    if (label && labels[label.toLowerCase()]) errors.push('Duplicate ' + type + ' name: ' + label + '.');
    ids[id] = true;
    labels[label.toLowerCase()] = true;
  });
}

function validateNonNegativeNumbers(value, path, errors) {
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function(key) {
    if (key === '_meta') return;
    const child = value[key];
    const childPath = path ? path + '.' + key : key;
    if (typeof child === 'number' && (!isFinite(child) || child < 0)) {
      errors.push(childPath + ' must be a non-negative number.');
    } else if (child && typeof child === 'object') {
      validateNonNegativeNumbers(child, childPath, errors);
    }
  });
}

function handleAdminLogin(data) {
  const props = PropertiesService.getScriptProperties();
  const expectedPassword = props.getProperty('ADMIN_PASSWORD');
  const expectedEmail = normaliseEmail(props.getProperty('ADMIN_EMAIL') || ADMIN_EMAIL_DEFAULT);
  if (!expectedPassword) return jsonResponse({ success: false, error: 'Admin login is not configured' });
  if (normaliseEmail(data.email) !== expectedEmail || String(data.password || '') !== expectedPassword) {
    return jsonResponse({ success: false, error: 'Invalid credentials' });
  }
  const expires = Date.now() + 8 * 60 * 60 * 1000;
  const payload = Utilities.base64EncodeWebSafe(expectedEmail + '|' + expires);
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, expectedPassword));
  return jsonResponse({ success: true, token: payload + '.' + sig, expires: expires });
}

function verifyAdminToken(token) {
  const password = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!password || !token || token.indexOf('.') < 0) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], password));
  if (expected !== parts[1]) return false;
  try {
    const decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    const expires = Number(decoded.split('|').pop());
    return isFinite(expires) && Date.now() < expires;
  } catch (_) { return false; }
}

function normaliseEmail(value) { return String(value || '').trim().toLowerCase(); }
function isValidRef(value) { return /^SICET2026-[A-Za-z0-9-]{6,30}$/.test(String(value || '')); }

function findFolderByRef(mainFolder, refId) {
  const folders = mainFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().indexOf(refId + '_') === 0) return folder;
  }
  return null;
}

function validateUpload(fileObj, label, errors) {
  if (!fileObj || !fileObj.data) return;
  const estimatedBytes = Math.floor(String(fileObj.data).length * 0.75);
  if (estimatedBytes > MAX_UPLOAD_BYTES) errors.push(label + ' exceeds 5 MB.');
  if (ALLOWED_UPLOAD_MIME.indexOf(String(fileObj.mimeType || '').toLowerCase()) < 0) errors.push(label + ' has an unsupported file type.');
}

function validateRegistration(input, mainFolder) {
  const data = Object.assign({}, input || {});
  const errors = [];
  ['Full_Name','Email','Phone','Organization','Attendee_Region','Country','Attendee_Category','Registration_Type'].forEach(function(k) {
    if (!String(data[k] || '').trim()) errors.push(k.replace(/_/g, ' ') + ' is required.');
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.Email || ''))) errors.push('A valid email is required.');
  if (['Local','SAARC','Non-SAARC'].indexOf(data.Attendee_Region) < 0) errors.push('Invalid attendee region.');
  if (!isValidRef(data.Invoice_ID)) errors.push('Invalid reference ID.');
  const registrationTypes = String(data.Registration_Type || '');
  if (registrationTypes.indexOf('Pre-Conference Workshops') >= 0 &&
      !String(data.PreConf_Session_IDs || data.PreConf_Sessions || '').trim()) {
    errors.push('Select at least one pre-conference workshop.');
  }
  if (registrationTypes.indexOf('Excursion') >= 0) {
    const excursionCount = data.Attendee_Region === 'Local'
      ? Number(data.Excursion_Local_Count || 0)
      : Number(data.Excursion_Foreign_Count || 0);
    if (!isFinite(excursionCount) || excursionCount < 1) {
      errors.push('Excursion registration requires at least one participant.');
    }
  }
  const existing = data.Invoice_ID ? findFolderByRef(mainFolder, data.Invoice_ID) : null;
  if (existing) {
    try {
      const saved = getRegistrationByRef(data.Invoice_ID);
      if (normaliseEmail(saved.Email) !== normaliseEmail(data.Email)) errors.push('Reference ID and email do not match.');
    } catch (_) { errors.push('Existing registration could not be verified.'); }
  }
  validateUpload(data.Student_ID_Base64, 'Student ID', errors);
  validateUpload(data.Workshop_ID_Base64, 'Workshop ID', errors);
  const proofs = Array.isArray(data.Payment_Proof_Base64) ? data.Payment_Proof_Base64 : [data.Payment_Proof_Base64];
  proofs.forEach(function(p, i) { validateUpload(p, 'Payment proof ' + (i + 1), errors); });
  const quotedTotal = Number(String(data.Calculated_Total_Fee || '0').replace(/,/g, ''));
  const hasPaymentProof = proofs.some(function(p) { return p && p.data; }) || data.Payment_Proof_Base64 === '(uploaded — see folder)';
  data.Status = quotedTotal > 0 ? (hasPaymentProof ? 'Payment Proof Submitted' : 'Pending Payment') : 'Submitted';
  data.Submission_Date = new Date().toISOString();
  return { valid: errors.length === 0, errors: errors, data: data };
}

function readCurrentSettings(mainFolder) {
  return readCurrentSettingsWithRecovery(mainFolder).settings;
}

function readCurrentSettingsWithRecovery(mainFolder) {
  const files = mainFolder.getFilesByName(SETTINGS_FILE_NAME);
  if (files.hasNext()) {
    return {
      settings: JSON.parse(files.next().getBlob().getDataAsString()),
      recovered: false
    };
  }

  // If a previous replacement was interrupted, recover the newest immutable
  // history version and recreate the canonical current settings file.
  const historyFolders = mainFolder.getFoldersByName(SETTINGS_HISTORY_FOLDER_NAME);
  if (historyFolders.hasNext()) {
    const historyFiles = historyFolders.next().getFiles();
    let newest = null;
    while (historyFiles.hasNext()) {
      const candidate = historyFiles.next();
      if (!newest || candidate.getDateCreated().getTime() > newest.getDateCreated().getTime()) {
        newest = candidate;
      }
    }
    if (newest) {
      const recoveredSettings = JSON.parse(newest.getBlob().getDataAsString());
      replaceJsonFileSafely(mainFolder, SETTINGS_FILE_NAME, recoveredSettings);
      return { settings: recoveredSettings, recovered: true };
    }
  }

  throw new Error('No pricing settings file or settings history found. Ask an administrator to save settings once.');
}

function attachPricingSnapshot(data, mainFolder) {
  const settings = readCurrentSettings(mainFolder);
  const categories = settings.categories || [];
  const category = categories.find(function(item) {
    return (data.Attendee_Category_ID && item.id === data.Attendee_Category_ID) ||
      item.label === data.Attendee_Category;
  });
  const existingFolder = data.Invoice_ID ? findFolderByRef(mainFolder, data.Invoice_ID) : null;

  if (!category && existingFolder) {
    // A returning registrant may legitimately reference a category that has
    // since been retired. Preserve its immutable snapshot instead of applying
    // a different live category or deleting historical meaning.
    const saved = getRegistrationByRef(data.Invoice_ID);
    if (saved.Pricing_Snapshot) {
      data.Record_Schema_Version = saved.Record_Schema_Version || RECORD_SCHEMA_VERSION;
      data.Settings_Version = saved.Settings_Version || '';
      data.Attendee_Category_ID = saved.Attendee_Category_ID || '';
      data.PreConf_Session_IDs = data.PreConf_Session_IDs || saved.PreConf_Session_IDs || '';
      data.Pricing_Snapshot = saved.Pricing_Snapshot;
      let historicalCategory = null;
      try { historicalCategory = JSON.parse(saved.Pricing_Snapshot).category || null; } catch (_) {}
      return normalizeConditionalRegistration(data, historicalCategory);
    }
  }
  if (!category) throw new Error('Selected attendee category is no longer available. Refresh and choose an active category.');

  const requestedSessionIds = String(data.PreConf_Session_IDs || '').split(',').map(function(id) {
    return id.trim();
  }).filter(Boolean);
  const requestedSessionNames = String(data.PreConf_Sessions || '').split(',').map(function(name) {
    return name.trim();
  }).filter(Boolean);
  const selectedSessions = (settings.pre_conference_sessions || []).filter(function(session) {
    return requestedSessionIds.indexOf(session.id) >= 0 || requestedSessionNames.indexOf(session.name) >= 0;
  });

  data.Record_Schema_Version = RECORD_SCHEMA_VERSION;
  data.Settings_Version = settings._meta && settings._meta.version || 'legacy-unversioned';
  data.Attendee_Category_ID = category.id;
  data.PreConf_Session_IDs = selectedSessions.map(function(session) { return session.id; }).join(', ');
  data.Pricing_Snapshot = JSON.stringify({
    settings_version: data.Settings_Version,
    captured_at: new Date().toISOString(),
    category: category,
    discounts: settings.discounts || {},
    award_fee: settings.award_fee || 0,
    inauguration_fee: settings.inauguration_fee || 0,
    inauguration_fee_usd: settings.inauguration_fee_usd || 0,
    excursion_fees: settings.excursion_fees || {},
    selected_workshops: selectedSessions,
    journals: settings.journals || [],
    usd_to_lkr: settings.usd_to_lkr || 0
  });
  return normalizeConditionalRegistration(data, category);
}

function normalizeConditionalRegistration(data, category) {
  const registrationTypes = String(data.Registration_Type || '');
  const hasMain = registrationTypes.indexOf('Main') >= 0;
  const hasAward = registrationTypes.indexOf('Award') >= 0;
  const hasExcursion = registrationTypes.indexOf('Excursion') >= 0;
  const hasPreConf = registrationTypes.indexOf('Pre-Conference Workshops') >= 0;

  if (!hasMain) {
    data.Number_of_Papers = '0';
    data.Include_Inauguration = '';
    Object.keys(data).forEach(function(key) {
      if (/^Paper_\d+_/.test(key)) delete data[key];
    });
  }
  if (!hasAward) {
    data.Company_Name = '';
    data.Participant_Count = '0';
    data.Participant_Names = '';
    data.Award_Category = '';
    data.Primary_Reason = '';
    data.Primary_Reason_Other = '';
  }
  if (!hasExcursion) {
    data.Excursion_Local_Count = '0';
    data.Excursion_Foreign_Count = '0';
    data.Mobility_Requirements = '';
    data.Preferred_Activity = '';
  }
  if (!hasPreConf) {
    Object.keys(data).forEach(function(key) {
      if (/^PreConf_/.test(key)) delete data[key];
    });
    data.PreConf_Sessions = '';
    data.PreConf_Session_IDs = '';
    data.Workshop_Discount_Tier = 'regular';
  }
  if (category && (category.no_papers || category.is_workshop_only)) {
    data.Number_of_Papers = '0';
  }
  if (!category || !category.is_student) {
    data.Include_Inauguration = '';
  }
  if (data.Attendee_Region === 'Local') {
    data.Excursion_Foreign_Count = '0';
  } else if (data.Attendee_Region) {
    data.Excursion_Local_Count = '0';
  }
  return data;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function upsertMasterSheet(data, mainFolder, folderUrl) {
  let spreadsheet;
  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.openById(files.next().getId());
  } else {
    spreadsheet = SpreadsheetApp.create(MASTER_SHEET_NAME);
    const ssFile = DriveApp.getFileById(spreadsheet.getId());
    mainFolder.addFile(ssFile);
    DriveApp.getRootFolder().removeFile(ssFile);
    spreadsheet.getActiveSheet().appendRow(MASTER_HEADERS);
  }

  const sheet  = spreadsheet.getActiveSheet();
  ensureMasterSheetSchema(sheet);
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol   = headers.indexOf('Invoice_ID');

  // Look for existing row with same Invoice_ID to upsert
  if (idCol >= 0) {
    for (let r = 1; r < values.length; r++) {
      if (values[r][idCol] === data.Invoice_ID) {
        // Overwrite existing row
        sheet.getRange(r + 1, 1, 1, headers.length).setValues([buildRow(headers, data, folderUrl)]);
        return;
      }
    }
  }

  // No existing row — append new
  sheet.appendRow(buildRow(headers, data, folderUrl));
}

function buildRow(headers, data, folderUrl) {
  const map = {
    Submission_Date:       data.Submission_Date       || '',
    Invoice_ID:            data.Invoice_ID             || '',
    Status:                data.Status                 || 'Submitted',
    Title:                 data.Title                  || '',
    Full_Name:             data.Full_Name              || '',
    Email:                 data.Email                  || '',
    Phone:                 data.Phone                  || '',
    Organization:          data.Organization           || '',
    Attendee_Region:       data.Attendee_Region        || '',
    Country:               data.Country                || '',
    Attendee_Category:     data.Attendee_Category      || '',
    Registration_Type:     data.Registration_Type      || '',
    Calculated_Total_Fee:  data.Calculated_Total_Fee   || '',
    Currency:              data.Currency               || '',
    Certificate_Name:      data.Certificate_Name       || '',
    Designation:           data.Designation            || '',
    Food_Preference:       data.Food_Preference        || '',
    Number_of_Papers:      data.Number_of_Papers       || '',
    Include_Inauguration:  data.Include_Inauguration   || '',
    Company_Name:          data.Company_Name           || '',
    Participant_Count:     data.Participant_Count      || '',
    Participant_Names:     data.Participant_Names      || '',
    Award_Category:        data.Award_Category         || '',
    Primary_Reason:        data.Primary_Reason         || '',
    Primary_Reason_Other:  data.Primary_Reason_Other   || '',
    Excursion_Local_Count: data.Excursion_Local_Count  || '',
    Excursion_Foreign_Count: data.Excursion_Foreign_Count || '',
    Excursion_Mobility:    data.Excursion_Mobility     || '',
    Excursion_Activity:    data.Excursion_Activity     || '',
    PreConf_Sessions:      data.PreConf_Sessions       || '',
    Workshop_Discount_Tier: data.Workshop_Discount_Tier || 'regular',
    Workshop_ID_File:      data.Workshop_ID_Base64     || '',
    Address:               data.Address                || '',
    Bill_To:               data.Bill_To                || '',
    Billing_Org_Name:      data.Billing_Org_Name       || '',
    Billing_Tax_ID:        data.Billing_Tax_ID         || '',
    Billing_Address:       data.Billing_Address        || '',
    Billing_Finance_Email: data.Billing_Finance_Email  || '',
    Transaction_Ref:       data.Transaction_Ref        || '',
    Additional_Info:       data.Additional_Info        || '',
    Drive_Folder_URL:      folderUrl                   || '',
    Record_Schema_Version: data.Record_Schema_Version  || '',
    Settings_Version:      data.Settings_Version       || '',
    Attendee_Category_ID:  data.Attendee_Category_ID   || '',
    PreConf_Session_IDs:   data.PreConf_Session_IDs    || '',
    Pricing_Snapshot:      data.Pricing_Snapshot       || ''
  };
  return headers.map(h => map[h] !== undefined ? map[h] : (data[h] || ''));
}

function saveFileToFolder(folder, prefix, fileObj) {
  const blob = Utilities.newBlob(
    Utilities.base64Decode(fileObj.data),
    fileObj.mimeType || 'application/octet-stream',
    prefix + (fileObj.name || 'file')
  );
  folder.createFile(blob);
}

function deleteFilesByName(folder, name) {
  const files = folder.getFilesByName(name);
  while (files.hasNext()) files.next().setTrashed(true);
}

function replaceJsonFileSafely(folder, targetName, value) {
  const tempName = targetName + '.new.' + Utilities.getUuid();
  // Materialise the old file IDs before creating/renaming the replacement.
  // Drive iterators can be live, so retaining the iterator itself is unsafe:
  // it may later include the newly renamed file and trash the replacement.
  const oldFiles = folder.getFilesByName(targetName);
  const oldFileIds = [];
  while (oldFiles.hasNext()) oldFileIds.push(oldFiles.next().getId());
  const temp = folder.createFile(tempName, JSON.stringify(value, null, 2), MimeType.PLAIN_TEXT);
  temp.setName(targetName);
  oldFileIds.forEach(function(fileId) {
    if (fileId !== temp.getId()) DriveApp.getFileById(fileId).setTrashed(true);
  });
  return temp;
}

function getOrCreateChildFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function getSubmissionsFromSheet(mainFolder) {
  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (!files.hasNext()) return [];
  const sheet  = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function getRegistrationByRef(refId) {
  const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
  const folders = mainFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().startsWith(refId + '_')) {
      const files = folder.getFilesByName('registration_data.json');
      if (files.hasNext()) {
        try {
          return JSON.parse(files.next().getBlob().getDataAsString());
        } catch (_) {
          // Corrupted JSON in this folder — keep searching other folders
        }
      }
    }
  }
  throw new Error('No registration found for Reference ID: ' + refId);
}

function findInvoiceIdByEmail(email, mainFolder) {
  if (!email) return null;
  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (!files.hasNext()) return null;
  const sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return null;
  const headers = values[0];
  const emailCol = headers.indexOf('Email');
  const idCol    = headers.indexOf('Invoice_ID');
  if (emailCol < 0 || idCol < 0) return null;
  // Search from the bottom so we return the most recent match
  for (let r = values.length - 1; r >= 1; r--) {
    if (String(values[r][emailCol]).trim().toLowerCase() === String(email).trim().toLowerCase()
        && values[r][idCol]) {
      return values[r][idCol];
    }
  }
  return null;
}

function generateInvoiceId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return 'SICET2026-' +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
