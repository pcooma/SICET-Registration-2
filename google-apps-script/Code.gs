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
 * 5. Authorise the script (it needs Drive + Sheets access)
 * 6. Copy the Web App URL
 * 7. Paste the URL into APPS_SCRIPT_URL in app.js
 * 8. Also paste your ADMIN_KEY into ADMIN_KEY in app.js
 *
 * Google Drive folder structure created automatically:
 *   SICET 2026 Registrations/  (the shared folder you created)
 *   ├── SICET2026 Master Registrations  (Google Sheet — all entries)
 *   ├── SICET2026-XXXXXXX_LastName/     (one folder per registrant)
 *   │   ├── registration_data.json
 *   │   ├── student_id_<filename>       (if uploaded)
 *   │   └── payment_proof_<filename>    (if uploaded)
 *   └── ...
 */

const MAIN_FOLDER_ID = '1REXNutSF3mzO7tRkg0tD0GjLqjUlhI-n';
const MASTER_SHEET_NAME = 'SICET2026 Master Registrations';
const ADMIN_KEY = 'sicet2026admin'; // Change this to something secret

// ---------------------------------------------------------------------------
// POST — receives form submission from the frontend
// ---------------------------------------------------------------------------
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);

    // Ensure Invoice ID exists
    if (!data.Invoice_ID) {
      data.Invoice_ID = generateInvoiceId();
    }

    // Build user folder name: InvoiceID_LastName
    const nameParts = (data.Full_Name || 'Unknown').trim().split(/\s+/);
    const lastName = nameParts[nameParts.length - 1].replace(/[^a-zA-Z0-9]/g, '') || 'Attendee';
    const folderName = data.Invoice_ID + '_' + lastName;

    const userFolder = mainFolder.createFolder(folderName);
    const folderUrl = userFolder.getUrl();

    // Save uploaded files from base64
    if (data.Student_ID_Base64 && data.Student_ID_Base64.data) {
      const f = data.Student_ID_Base64;
      const blob = Utilities.newBlob(
        Utilities.base64Decode(f.data),
        f.mimeType || 'application/octet-stream',
        'student_id_' + (f.name || 'file')
      );
      userFolder.createFile(blob);
      data.Student_ID_Base64 = '(uploaded — see folder)';
    }

    if (data.Payment_Proof_Base64 && data.Payment_Proof_Base64.data) {
      const f = data.Payment_Proof_Base64;
      const blob = Utilities.newBlob(
        Utilities.base64Decode(f.data),
        f.mimeType || 'application/octet-stream',
        'payment_proof_' + (f.name || 'file')
      );
      userFolder.createFile(blob);
      data.Payment_Proof_Base64 = '(uploaded — see folder)';
    }

    // Attach folder URL to data record
    data.Drive_Folder_URL = folderUrl;

    // Save full JSON snapshot to user folder
    userFolder.createFile(
      'registration_data.json',
      JSON.stringify(data, null, 2),
      MimeType.PLAIN_TEXT
    );

    // Append summary row to master sheet
    appendToMasterSheet(data, mainFolder, folderUrl);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        invoiceId: data.Invoice_ID,
        folderUrl: folderUrl
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    Logger.log('doPost error: ' + err.toString());
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ---------------------------------------------------------------------------
// GET — admin reads all submissions (requires key param)
// ---------------------------------------------------------------------------
function doGet(e) {
  const action = (e.parameter && e.parameter.action) || '';
  const key    = (e.parameter && e.parameter.key)    || '';

  if (action === 'getSubmissions') {
    if (key !== ADMIN_KEY) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    try {
      const mainFolder = DriveApp.getFolderById(MAIN_FOLDER_ID);
      const rows = getSubmissionsFromSheet(mainFolder);
      return ContentService
        .createTextOutput(JSON.stringify({ success: true, submissions: rows }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Health check
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'SICET 2026 Registration API running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function appendToMasterSheet(data, mainFolder, folderUrl) {
  let spreadsheet;

  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.openById(files.next().getId());
  } else {
    spreadsheet = SpreadsheetApp.create(MASTER_SHEET_NAME);
    const ssFile = DriveApp.getFileById(spreadsheet.getId());
    mainFolder.addFile(ssFile);
    DriveApp.getRootFolder().removeFile(ssFile);

    // Header row
    spreadsheet.getActiveSheet().appendRow([
      'Submission_Date', 'Invoice_ID', 'Title', 'Full_Name', 'Email', 'Phone',
      'Organization', 'Attendee_Region', 'Country', 'Attendee_Category',
      'Registration_Type', 'Calculated_Total_Fee', 'Currency',
      'Certificate_Name', 'Designation', 'Food_Preference', 'Number_of_Papers',
      'Company_Name', 'Participant_Count', 'Award_Category',
      'Excursion_Local_Count', 'Excursion_Foreign_Count',
      'Transaction_Ref', 'Additional_Info', 'Drive_Folder_URL'
    ]);
  }

  spreadsheet.getActiveSheet().appendRow([
    data.Submission_Date        || '',
    data.Invoice_ID             || '',
    data.Title                  || '',
    data.Full_Name              || '',
    data.Email                  || '',
    data.Phone                  || '',
    data.Organization           || '',
    data.Attendee_Region        || '',
    data.Country                || '',
    data.Attendee_Category      || '',
    data.Registration_Type      || '',
    data.Calculated_Total_Fee   || '',
    data.Currency               || '',
    data.Certificate_Name       || '',
    data.Designation            || '',
    data.Food_Preference        || '',
    data.Number_of_Papers       || '',
    data.Company_Name           || '',
    data.Participant_Count      || '',
    data.Award_Category         || '',
    data.Excursion_Local_Count  || '',
    data.Excursion_Foreign_Count|| '',
    data.Transaction_Ref        || '',
    data.Additional_Info        || '',
    folderUrl                   || ''
  ]);
}

function getSubmissionsFromSheet(mainFolder) {
  const files = mainFolder.getFilesByName(MASTER_SHEET_NAME);
  if (!files.hasNext()) return [];

  const sheet = SpreadsheetApp.openById(files.next().getId()).getActiveSheet();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
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
