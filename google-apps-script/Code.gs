/**
 * SICET 2026 Registration — Google Apps Script Backend
 *
 * HOW TO DEPLOY:
 * 1. Open https://script.google.com and create a new project named "SICET2026 Registration"
 * 2. Paste this entire file into Code.gs
 * 3. Change ADMIN_KEY below to a secret key of your choice
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
const ADMIN_KEY         = 'sicet2026admin'; // Change this to something secret

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
  const key    = (e.parameter && e.parameter.key)    || '';

  if (action === 'getSubmissions') {
    if (key !== ADMIN_KEY) return jsonResponse({ error: 'Unauthorized' });
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      return jsonResponse({ success: true, submissions: getSubmissionsFromSheet(mainFolder) });
    } catch (err) {
      return jsonResponse({ error: err.toString() });
    }
  }

  if (action === 'getRegistrationByRef') {
    const ref = (e.parameter && e.parameter.ref) || '';
    if (!ref) return jsonResponse({ error: 'No reference ID provided' });
    try {
      const data = getRegistrationByRef(ref);
      return jsonResponse({ success: true, data: data });
    } catch (err) {
      return jsonResponse({ success: false, error: err.toString() });
    }
  }

  if (action === 'getSettings') {
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      const files = mainFolder.getFilesByName('sicet2026_settings.json');
      if (files.hasNext()) {
        const content = files.next().getBlob().getDataAsString();
        return jsonResponse({ success: true, settings: JSON.parse(content) });
      }
      return jsonResponse({ success: false, error: 'No settings file found' });
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

  // Server-side deduplication: if no Invoice_ID supplied, check sheet for existing row with same email
  if (!data.Invoice_ID) {
    const existingId = findInvoiceIdByEmail(data.Email, mainFolder);
    data.Invoice_ID = existingId || generateInvoiceId();
  }

  const nameParts = (data.Full_Name || 'Unknown').trim().split(/\s+/);
  const lastName  = nameParts[nameParts.length - 1].replace(/[^a-zA-Z0-9]/g, '') || 'Attendee';
  const folderName = data.Invoice_ID + '_' + lastName;

  // Find or create the registrant's sub-folder
  let userFolder;
  const existingFolders = mainFolder.getFoldersByName(folderName);
  if (existingFolders.hasNext()) {
    userFolder = existingFolders.next();
  } else {
    userFolder = mainFolder.createFolder(folderName);
  }

  const folderUrl = userFolder.getUrl();

  // Save uploaded files
  if (data.Student_ID_Base64 && data.Student_ID_Base64.data) {
    saveFileToFolder(userFolder, 'student_id_', data.Student_ID_Base64);
    data.Student_ID_Base64 = '(uploaded — see folder)';
  }
  if (data.Payment_Proof_Base64 && data.Payment_Proof_Base64.data) {
    saveFileToFolder(userFolder, 'payment_proof_', data.Payment_Proof_Base64);
    data.Payment_Proof_Base64 = '(uploaded — see folder)';
  }

  data.Drive_Folder_URL = folderUrl;

  // Overwrite registration_data.json with latest version
  deleteFilesByName(userFolder, 'registration_data.json');
  userFolder.createFile('registration_data.json', JSON.stringify(data, null, 2), MimeType.PLAIN_TEXT);

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
  const existingFolders = mainFolder.getFoldersByName(folderName);
  if (existingFolders.hasNext()) {
    userFolder = existingFolders.next();
  } else {
    userFolder = mainFolder.createFolder(folderName);
  }

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
  if (data.adminKey !== ADMIN_KEY) {
    return jsonResponse({ success: false, error: 'Unauthorized' });
  }
  if (!data.settings) {
    return jsonResponse({ success: false, error: 'No settings payload' });
  }
  try {
    const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
    deleteFilesByName(mainFolder, 'sicet2026_settings.json');
    mainFolder.createFile(
      'sicet2026_settings.json',
      JSON.stringify(data.settings, null, 2),
      MimeType.PLAIN_TEXT
    );
    return jsonResponse({ success: true });
  } catch (err) {
    Logger.log('handleSaveSettings error: ' + err.toString());
    return jsonResponse({ success: false, error: err.toString() });
  }
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
    spreadsheet.getActiveSheet().appendRow([
      'Submission_Date', 'Invoice_ID', 'Status',
      'Title', 'Full_Name', 'Email', 'Phone',
      'Organization', 'Attendee_Region', 'Country', 'Attendee_Category',
      'Registration_Type', 'Calculated_Total_Fee', 'Currency',
      'Certificate_Name', 'Designation', 'Food_Preference', 'Number_of_Papers',
      'Include_Inauguration',
      'Company_Name', 'Participant_Count', 'Award_Category',
      'Primary_Reason', 'Primary_Reason_Other',
      'Excursion_Local_Count', 'Excursion_Foreign_Count',
      'Excursion_Mobility', 'Excursion_Activity',
      'Transaction_Ref', 'Additional_Info', 'Drive_Folder_URL'
    ]);
  }

  const sheet  = spreadsheet.getActiveSheet();
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
    Award_Category:        data.Award_Category         || '',
    Primary_Reason:        data.Primary_Reason         || '',
    Primary_Reason_Other:  data.Primary_Reason_Other   || '',
    Excursion_Local_Count: data.Excursion_Local_Count  || '',
    Excursion_Foreign_Count: data.Excursion_Foreign_Count || '',
    Excursion_Mobility:    data.Excursion_Mobility     || '',
    Excursion_Activity:    data.Excursion_Activity     || '',
    Transaction_Ref:       data.Transaction_Ref        || '',
    Additional_Info:       data.Additional_Info        || '',
    Drive_Folder_URL:      folderUrl                   || ''
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
