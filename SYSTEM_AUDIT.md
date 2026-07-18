# SICET 2026 Registration System Audit and Process Map

## 1. System boundary and source of truth

The system has four runtime layers:

1. `index.html` — registration, returning-registration lookup, payment, WhatsApp support, dashboard, and settings views.
2. `app.js` — UI state, validation, fee preview, invoice generation, draft recovery, registration submission, dashboard reporting, and settings administration.
3. `google-apps-script/Code.gs` — public web API, authentication, registration persistence, file storage, settings persistence, and spreadsheet upsert.
4. Google Drive — authoritative settings JSON, per-registration folders, uploaded evidence, invoice versions, registration JSON, and the master Google Sheet.

The browser fee is a quotation aid. The Drive record and master sheet are operational records. Payment is not verified merely because a receipt was uploaded; finance review is still required.

## 2. User and data classifications

### Actors

- New registrant
- Returning registrant
- Registration administrator
- Finance/payment reviewer
- Workshop coordinator
- Award coordinator
- Excursion/logistics coordinator
- Conference support contact

### Registration classifications

- Region: Local, SAARC, Non-SAARC
- Category: settings-driven; defaults include Student Author, General Author, Student Participant, General Participant, Workshop Attendee
- Product: Main Conference, Excellence Award, Excursion, Pre-Conference Workshops; combinations are allowed
- Paper: presenting or no-papers category; optional APC journal per paper when APC collection is enabled
- Workshop discount: regular, academic, student
- Payment: zero-fee or payment-required
- Record status: Pending Payment, Payment Proof Submitted, or Submitted (zero-fee); finance decision states remain to be added

### Data sensitivity

- Public: conference fees, categories, workshops, public contacts
- Personal: name, email, phone, address, organization, dietary and mobility requirements
- Financial: invoice, transaction reference, payment proof
- Verification evidence: student/academic ID
- Restricted administration: all registrations, Drive folder URLs, dashboard/export, settings writes

## 3. End-to-end process maps

### New paid registration

1. Load public settings from Drive; use cached settings only when Drive is unavailable.
2. Enter identity, contact, organization, region, country, and category.
3. Select one or more products.
4. Complete conditional product details: papers/APC, award, excursion, or workshops.
5. Browser calculates a fee preview in LKR for Local and USD for non-local attendees.
6. Enter billing details.
7. Generate/download the proforma invoice and obtain a reference ID.
8. Pay externally and enter the transaction reference.
9. Upload one or more payment proofs and any required eligibility ID.
10. Submit. Backend validates identity, ownership, allowed upload type/size, and assigns Payment Proof Submitted plus a server-owned date.
11. Backend finds or creates one reference folder, versions files, writes the latest JSON, and upserts the master sheet.
12. Browser reports completion only after a confirmed success response.

### Zero-fee registration

Steps 1–6 are unchanged. Step 7 generates a confirmation/reference. Payment fields and proof are skipped. Submission persists as Submitted.

### Returning registrant

1. Enter reference ID and the registration email.
2. Backend verifies the pair before returning personal data.
3. Browser restores product toggles before dependent fields, rebuilds paper blocks, then restores paper values and upload-presence indicators.
4. Registrant changes details, regenerates an invoice if required, and resubmits.
5. Backend verifies that the reference still belongs to the same email and updates the same folder/sheet row.

### Administration

1. Admin enters email and password.
2. Backend compares credentials stored in Apps Script properties and returns an eight-hour signed session token.
3. Dashboard reads, payment-proof reads, and settings writes require that token.
4. Dashboard provides summary, records, logistics, revenue, filtering, detail view, and Excel export.
5. Settings alter categories, regional fees, discounts, workshops, APC journals, award/excursion options, invoice name, refund date, and exchange rate.

### Support routing

1. Registrant can load a registration using reference ID plus email.
2. They choose workshop, award, payment, general, or other.
3. The UI chooses the responsible contact, adds relevant workshop/paper context, previews the message, and opens WhatsApp.

## 4. Function inventory

### Browser orchestration

- Startup/settings: `init`, `resolveSettings`, `mergeWithDefaults`, `pushSettingsToDrive`
- Event/state: `setupEventListeners`, `switchView`, `saveDraft`, `restoreDraft`, `clearDraft`, `debounce`
- Dynamic form: `generatePaperBlocks`, category/session/dropdown rebuilders, inauguration and excursion visibility helpers
- Pricing: `updateCostPreviews`, preview helpers, `calculateTotalFee`
- Registration: `collectFormData`, `generateInvoice`, `handleFormSubmit`, `submitToGoogleDrive`
- Recovery: `handleRefLookup`, `populateFormFromData`
- Uploads: `fileToBase64`, proof UI/removal/status helpers
- Admin: login, dashboard refresh/render/filter/detail/export functions, settings render/save functions
- Support: registration context, contact routing, message construction/preview, WhatsApp send

### Backend

- API: `doGet`, `doPost`, `jsonResponse`
- Authentication: `handleAdminLogin`, `verifyAdminToken`
- Registration: `handleSubmitRegistration`, `validateRegistration`, `getRegistrationByRef`
- Files/invoices: `handleSaveInvoice`, `saveFileToFolder`, `deleteFilesByName`, `findFolderByRef`
- Settings: `handleSaveSettings`
- Master data: `upsertMasterSheet`, `buildRow`, `getSubmissionsFromSheet`, `findInvoiceIdByEmail`, `generateInvoiceId`

## 5. Gaps found and disposition

### Corrected in code

- Critical: browser-embedded admin password and permanent API key.
- Critical: reference-only lookup disclosed full personal/financial registration data.
- Critical: `no-cors` submission treated an unreadable response, including backend failure, as success.
- High: browser-controlled Status and Submission Date were persisted.
- High: an existing reference could be submitted using a different email.
- High: backend did not enforce upload size or MIME type.
- High: changing a registrant name could create a second folder for the same reference.
- Medium: workshop discount validation referenced `submitBtn` before it was initialized.

### Operational gaps requiring an owner/process decision

- Payment workflow has no finance decision states. Add Pending Review, Payment Confirmed, Payment Rejected, Waived, Refunded, and Cancelled, with reviewer, timestamp, notes, and an audit log.
- The backend still stores a browser-calculated quoted amount. Before accepting real money at scale, implement a single server-side fee engine and store quoted, verified, paid, balance, and currency separately.
- Reference plus email is stronger than reference-only but is not strong authentication. For higher assurance, email a short-lived one-time link/code.
- There is no capacity control for workshops, awards, excursion seats, or inauguration catering. Add capacity, reservation, confirmed count, waitlist, and close date per product.
- There is no notification service. Add registration received, payment approved/rejected, change confirmation, cancellation, and event reminder emails.
- The system has no explicit retention/consent policy for IDs, receipts, dietary, and mobility data. Define access, retention, deletion, and incident-handling rules.
- Admin is single-role. Split registration, finance, logistics, settings, and read-only access before multiple staff use the system.
- Google Drive/Sheet is an appropriate small-conference operational store but has no formal backup/reconciliation job. Schedule exports and reconcile folder, JSON, sheet, and payment totals.

## 6. Deployment checklist

1. In Apps Script Project Settings, add `ADMIN_PASSWORD` and optionally `ADMIN_EMAIL`.
2. Redeploy the web app as a new version; frontend and backend changes must go live together.
3. Change the previously exposed admin password everywhere it may have been reused.
4. Test new paid, zero-fee, returning update, wrong-email lookup, wrong admin password, expired token, oversize upload, duplicate update, settings save, dashboard read, and invoice versioning.
5. Verify the master sheet headers and one folder/one row invariant for each reference.
6. Confirm the current fee schedule, refund deadline, exchange rate, contacts, bank details, and dates before public launch.

## 7. Acceptance criteria

- A registration is complete only when the backend returns success and the master row plus registration JSON exist.
- A payment is complete only after finance verification; receipt upload alone is not approval.
- A returning user sees data only after reference/email ownership verification.
- A settings change is authoritative only after authenticated Drive persistence succeeds.
- Every reference maps to one logical registration folder and one master-sheet row.
- Operational counts distinguish submitted, payment-confirmed, cancelled, refunded, and waitlisted records once status workflow is implemented.
