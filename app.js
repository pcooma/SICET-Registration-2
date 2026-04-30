// Default Settings
const defaultSettings = {
    conf_fees: {
        local: { author: 15000, nonauthor: 12000, student: 10000 },
        saarc: { author: 150, nonauthor: 120, student: 100 },
        nonsaarc: { author: 250, nonauthor: 200, student: 150 }
    },
    discounts: {
        student_from_2nd: 10,       // percentage
        discount_max_papers: 0      // 0 = unlimited; N = cap at N papers receiving discount
    },
    award_fee: 10000,
    excursion_fees: {
        local: 15000,
        foreigner: 17000
    },
    inauguration_fee: 10000,         // LKR; Student opt-in only (Local)
    inauguration_fee_usd: 30,       // USD; Student opt-in only (Non-local)
    journals: [
        { id: 'j1', name: 'Scopus Q1', fee: 300 },
        { id: 'j2', name: 'Scopus Q2', fee: 200 },
        { id: 'j3', name: 'Other', fee: 100 }
    ],
    pre_conference_sessions: [
        { id: 'pcs1', name: 'AI & Machine Learning Workshop',          fee_local: 3500, fee_saarc: 35, fee_nonsaarc: 50 },
        { id: 'pcs2', name: 'Cybersecurity Essentials Bootcamp',       fee_local: 4000, fee_saarc: 40, fee_nonsaarc: 60 },
        { id: 'pcs3', name: 'IoT & Embedded Systems Lab',              fee_local: 3000, fee_saarc: 30, fee_nonsaarc: 45 },
        { id: 'pcs4', name: 'Research Methodology & Academic Writing', fee_local: 2500, fee_saarc: 25, fee_nonsaarc: 35 }
    ],
    categories: [
        { id: 'author',    label: 'Author',     fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250, is_student: false, no_papers: false, paper_discount: false },
        { id: 'nonauthor', label: 'Non-Author', fee_local: 12000, fee_saarc: 120, fee_nonsaarc: 200, is_student: false, no_papers: true,  paper_discount: false },
        { id: 'student',   label: 'Student',    fee_local: 10000, fee_saarc: 100, fee_nonsaarc: 150, is_student: true,  no_papers: false, paper_discount: true  }
    ],
    chair_name: 'Dr. Gayashika Fernando',
    refund_deadline: 'August 23, 2025',
    usd_to_lkr: 320,
    apc_collection_active: false,
    award_categories: ['Innovation', 'Sustainability', 'Leadership'],
    award_purposes: ['Networking', 'To Receive Award', 'Other'],
    excursion_mobility_options: ['None', 'Wheelchair Access Needed', 'Limited Walking preferred'],
    excursion_activity_options: ['Sightseeing mostly', 'Shopping & Local Crafts', 'Historical Sites']
};

// ---- GOOGLE DRIVE CONFIGURATION ----
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzstd5s2cjkTq0mMptPHdUGbLzmgSROZ_rB8EYq7PlS24b_JOdU1NappJBgYQQiuvDu/exec';
const ADMIN_KEY = 'sicet2026admin';

// ---- SUPER ADMIN CREDENTIALS ----
const ADMIN_USERNAME = 'p.cooma@gmail.com';
const ADMIN_PASSWORD = 'www.123@lk';

// DOM Elements - General
const registrationForm = document.getElementById('registration-form');

// Sections
const sections = {
    'Main Conference':  document.getElementById('section-main'),
    'Excellence Award': document.getElementById('section-award'),
    'Excursion':        document.getElementById('section-excursion')
};

// Navigation
const navFormBtn = document.getElementById('nav-form');
const navAdminBtn = document.getElementById('nav-admin');
const navSettingsBtn = document.getElementById('nav-settings');
const formSection = document.getElementById('form-section');
const adminSection = document.getElementById('admin-section');
const settingsSection = document.getElementById('settings-section');

// Admin Elements
const tableBody   = document.getElementById('table-body');
const statTotal   = document.getElementById('stat-total');
const statMain    = document.getElementById('stat-main');
const statAward   = document.getElementById('stat-award');
const btnClear    = document.getElementById('btn-clear');
const btnExport   = document.getElementById('btn-export');

// Dashboard state
let dashFilteredRows = [];

// Form Price Calculation Elements
const remainingForm = document.getElementById('remaining-form');
const priceBox = document.getElementById('price-calculator-box');
const priceBreakdown = document.getElementById('price-breakdown');
const priceTotalAmount = document.getElementById('totalPriceAmount');
const priceCurrency = document.querySelector('.price-value .currency');
const priceTriggers = document.querySelectorAll('.price-trigger');

// State
let submissions = []; // Loaded from Google Drive on demand (see loadFromGoogleDrive)
let adminLoggedIn = false;
let pendingAdminView = 'settings';
let appSettings = JSON.parse(JSON.stringify(defaultSettings)); // resolved properly in resolveSettings()
let formDraft = JSON.parse(localStorage.getItem('sicet2026_draft')) || null;

// Initialize
async function init() {
    // Resolve settings from Drive (single source of truth) before rendering anything
    await resolveSettings();

    updateAdminDashboard();
    populateSettingsForm();
    populateJournalsDropdown();
    rebuildCategoryDropdown();
    rebuildSessionCheckboxes();
    rebuildAwardCategoryDropdown();
    rebuildAwardPurposeDropdown();
    rebuildExcursionMobilityDropdown();
    rebuildExcursionActivityDropdown();
    generatePaperBlocks(1);
    setupEventListeners();
    updateSubmitButtonState();
    updateExcursionTicketVisibility();
    updateCostPreviews();

    // Check for draft
    if (formDraft && Object.keys(formDraft).length > 0) {
        if (confirm("You have an unsaved registration draft. Would you like to restore it?")) {
            restoreDraft();
        } else {
            clearDraft();
        }
    }
}

// Event Listeners
function setupEventListeners() {
    // Dynamic Registration Sections from Toggles
    const toggles = document.querySelectorAll('.section-toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const sectionName = e.target.value;
            if (sections[sectionName]) {
                if (e.target.checked) {
                    sections[sectionName].classList.remove('hidden');
                } else {
                    sections[sectionName].classList.add('hidden');
                }
            }

            // Pre-conference sessions block: visible when Main or Pre-Conf toggle is on AND sessions are configured
            const sharedSess = document.getElementById('section-preconf-sessions');
            if (sharedSess) {
                const mainOn    = document.getElementById('toggleMain').checked;
                const preconfOn = document.getElementById('togglePreConf').checked;
                const hasSessions = (appSettings.pre_conference_sessions || []).length > 0;
                if ((mainOn || preconfOn) && hasSessions) sharedSess.classList.remove('hidden');
                else sharedSess.classList.add('hidden');
            }

            // Paper blocks: only visible when Main Conference is selected and category has papers
            const mainChecked    = document.getElementById('toggleMain').checked;
            const papersContainer = document.getElementById('dynamic-papers-container');
            if (papersContainer) {
                if (!mainChecked) {
                    papersContainer.classList.add('hidden');
                } else {
                    const cat    = document.getElementById('attendeeCategory').value;
                    const catDef = (appSettings.categories || []).find(c => c.label === cat);
                    if (!catDef?.no_papers) papersContainer.classList.remove('hidden');
                }
            }

            // Check if any section is active to show the remaining form
            const anyChecked = Array.from(toggles).some(t => t.checked);
            if (anyChecked) {
                remainingForm.classList.remove('hidden');
            } else {
                remainingForm.classList.add('hidden');
            }
            calculateTotalFee();
        });
    });

    // Price Trigger fields
    priceTriggers.forEach(el => {
        el.addEventListener('change', calculateTotalFee);
        el.addEventListener('input', calculateTotalFee);
    });

    // Special trigger for Number of papers hint and block generation
    document.getElementById('numberOfPapers').addEventListener('input', (e) => {
        let val = parseInt(e.target.value) || 1;
        if (val < 1) val = 1;
        if (val > 10) val = 10; // Maximum 10 papers

        generatePaperBlocks(val); // Generate dynamic blocks

        const hint = document.querySelector('.discount-hint');
        const cat = document.getElementById('attendeeCategory').value;
        const catDef = (appSettings.categories || []).find(c => c.label === cat);

        if (val > 1 && catDef?.paper_discount) {
            hint.classList.remove('hidden');
        } else {
            hint.classList.add('hidden');
        }
        calculateTotalFee();
    });

    // Category-based field visibility — driven by is_student / no_papers flags on the category definition
    document.getElementById('attendeeCategory').addEventListener('change', (e) => {
        const category      = e.target.value;
        const catDef        = (appSettings.categories || []).find(c => c.label === category);
        const isStudentType = catDef?.is_student || false;
        const isNoPapers    = catDef?.no_papers   || false;

        const papersSection       = document.getElementById('papers-section');
        const papersContainer     = document.getElementById('dynamic-papers-container');
        const numberOfPapersInput = document.getElementById('numberOfPapers');
        const studentIdField      = document.getElementById('studentId');
        const studentIdSection    = document.getElementById('studentIdSection');
        const studentRequired     = document.querySelector('.student-required');
        const designationGroup    = document.getElementById('designation-group');

        if (isNoPapers) {
            // No-papers category (e.g. Non-Author): hide papers and student ID
            if (papersSection) papersSection.classList.add('hidden');
            if (papersContainer) papersContainer.classList.add('hidden');
            if (numberOfPapersInput) { numberOfPapersInput.required = false; numberOfPapersInput.value = 0; }
            if (studentIdSection) studentIdSection.classList.add('hidden');
            if (studentIdField) studentIdField.required = false;
            if (studentRequired) studentRequired.classList.add('hidden');
            if (designationGroup) designationGroup.classList.remove('hidden');
            hideInauguration();
        } else if (isStudentType) {
            // Student-type: show papers + require student ID + show inauguration opt-in + hide designation
            if (papersSection) papersSection.classList.remove('hidden');
            if (papersContainer) papersContainer.classList.remove('hidden');
            if (numberOfPapersInput) {
                numberOfPapersInput.required = true;
                if (!numberOfPapersInput.value || numberOfPapersInput.value === '0') numberOfPapersInput.value = 1;
            }
            if (studentIdSection) studentIdSection.classList.remove('hidden');
            if (studentIdField) studentIdField.required = true;
            if (studentRequired) studentRequired.classList.remove('hidden');
            if (designationGroup) designationGroup.classList.add('hidden');
            showInauguration();
        } else {
            // Author/default: show papers, hide student ID, show designation
            if (papersSection) papersSection.classList.remove('hidden');
            if (papersContainer) papersContainer.classList.remove('hidden');
            if (numberOfPapersInput) {
                numberOfPapersInput.required = true;
                if (!numberOfPapersInput.value || numberOfPapersInput.value === '0') numberOfPapersInput.value = 1;
            }
            if (studentIdSection) studentIdSection.classList.add('hidden');
            if (studentIdField) studentIdField.required = false;
            if (studentRequired) studentRequired.classList.add('hidden');
            if (designationGroup) designationGroup.classList.remove('hidden');
            hideInauguration();
        }

        const count = parseInt(document.getElementById('numberOfPapers').value) || 0;
        if (isNoPapers) {
            document.getElementById('dynamic-papers-container').innerHTML = '';
        } else {
            generatePaperBlocks(count || 1);
        }

        // Update discount hint visibility when category changes
        const hint = document.querySelector('.discount-hint');
        if (hint) {
            if (count > 1 && catDef?.paper_discount) hint.classList.remove('hidden');
            else hint.classList.add('hidden');
        }

        calculateTotalFee();
    });

    // Excursion ticket visibility based on attendee region
    document.getElementById('attendeeRegion').addEventListener('change', updateExcursionTicketVisibility);

    // "Other" purpose text field visibility
    document.getElementById('primaryReason')?.addEventListener('change', (e) => {
        const otherGroup = document.getElementById('primary-reason-other-group');
        if (otherGroup) {
            if (e.target.value === 'Other') otherGroup.classList.remove('hidden');
            else otherGroup.classList.add('hidden');
        }
    });

    // File size validation
    document.getElementById('studentId').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.size > 5 * 1024 * 1024) { // 5MB
            showToast('File size must not exceed 5MB', 'error');
            e.target.value = '';
        }
    });

    document.getElementById('paymentProof').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.size > 5 * 1024 * 1024) {
            showToast('File size must not exceed 5MB', 'error');
            e.target.value = '';
        }
        updateSubmitButtonState();
    });

    // Auto-populate certificate name from full name
    document.getElementById('fullName').addEventListener('blur', (e) => {
        const certNameField = document.getElementById('nameCertificate');
        if (certNameField && !certNameField.value) {
            certNameField.value = e.target.value.toUpperCase();
        }
    });

    // Phone number validation
    document.getElementById('phone').addEventListener('blur', (e) => {
        const phone = e.target.value.trim();
        // Basic international phone format validation (must start with +)
        if (phone && !phone.startsWith('+')) {
            showToast('Phone number must include country code (e.g., +94 77 123 4567)', 'error');
            e.target.focus();
        }
    });

    // Main Registration Optional Excursion (only if element exists)
    const inclExcMain = document.getElementById('includeExcursionMain');
    if (inclExcMain) {
        inclExcMain.addEventListener('change', (e) => {
            const details = document.getElementById('main-excursion-details');
            if (e.target.checked) {
                details.classList.remove('hidden');
            } else {
                details.classList.add('hidden');
            }
            calculateTotalFee();
        });
    }

    // Billing details toggle
    document.querySelectorAll('.billing-toggle').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const orgDetails = document.getElementById('org-billing-details');
            if (e.target.value === 'Organization') {
                orgDetails.classList.remove('hidden');
                document.getElementById('orgLegalName').required = true;
                document.getElementById('orgBillingAddress').required = true;
            } else {
                orgDetails.classList.add('hidden');
                document.getElementById('orgLegalName').required = false;
                document.getElementById('orgBillingAddress').required = false;
            }
        });
    });

    // Invoice download
    document.getElementById('btn-download-invoice').addEventListener('click', generateInvoice);

    // Returning registrant — lookup by ref ID
    document.getElementById('btn-lookup-ref')?.addEventListener('click', handleRefLookup);

    // Form Submission (Step 2)
    registrationForm.addEventListener('submit', handleFormSubmit);

    // Navigation Toggle
    navFormBtn.addEventListener('click', () => switchView('form'));
    navAdminBtn.addEventListener('click', () => {
        if (adminLoggedIn) {
            switchView('admin');
        } else {
            pendingAdminView = 'admin';
            document.getElementById('admin-login-modal').classList.remove('hidden');
            document.getElementById('admin-username').focus();
        }
    });
    navSettingsBtn.addEventListener('click', () => {
        if (adminLoggedIn) {
            switchView('settings');
        } else {
            pendingAdminView = 'settings';
            document.getElementById('admin-login-modal').classList.remove('hidden');
            document.getElementById('admin-username').focus();
        }
    });

    // Admin Login Modal
    document.getElementById('modal-close-btn').addEventListener('click', closeLoginModal);
    document.getElementById('admin-login-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeLoginModal();
    });
    document.getElementById('btn-login-submit').addEventListener('click', handleAdminLogin);
    document.getElementById('admin-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') handleAdminLogin();
    });

    // Auto-Save: Listen to all form inputs
    registrationForm.addEventListener('input', debounce(saveDraft, 500));
    registrationForm.addEventListener('change', debounce(saveDraft, 500));

    // Admin Actions
    btnClear.addEventListener('click', loadFromGoogleDrive);
    btnExport.addEventListener('click', exportToExcel);

    // Dashboard tabs
    document.querySelectorAll('.dash-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.dash-tab-content').forEach(c => c.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById('dash-tab-' + tab.dataset.tab).classList.remove('hidden');
        });
    });

    // Search & filter
    ['dash-search', 'dash-filter-cat', 'dash-filter-region', 'dash-filter-status'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', applyDashFilters);
        document.getElementById(id)?.addEventListener('change', applyDashFilters);
    });

    // Record detail modal close
    document.getElementById('record-modal-close').addEventListener('click', () => {
        document.getElementById('record-detail-modal').classList.add('hidden');
    });
    document.getElementById('record-detail-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) document.getElementById('record-detail-modal').classList.add('hidden');
    });

    // Settings Actions
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-journal').addEventListener('click', addJournalField);
    document.getElementById('btn-add-category')?.addEventListener('click', addCategoryField);
    document.getElementById('btn-add-session')?.addEventListener('click', addSessionField);
}

// ---- DYNAMIC UI LOGIC ----

function generatePaperBlocks(count) {
    const container = document.getElementById('dynamic-papers-container');
    container.innerHTML = '';

    const apcActive = appSettings.apc_collection_active;

    // Create journal options string
    let journalOptions = '<option value="" disabled selected>Select Journal</option>';
    appSettings.journals.forEach(j => {
        journalOptions += `<option value="${j.name}" data-fee="${j.fee}">${j.name} ($${j.fee})</option>`;
    });

    for (let i = 1; i <= count; i++) {
        const block = document.createElement('div');
        block.className = 'form-group highlight-box mt-3';
        block.style.borderRadius = 'var(--card-radius)';
        block.innerHTML = `
            <h4 class="mb-3" style="font-size: 1.1rem; color: var(--accent);">Paper ${i} Details</h4>
            <div class="form-group row">
                <div class="input-field col${apcActive ? '' : ' hidden'}">
                    <label for="paperId_${i}">Paper ID <span class="required">*</span></label>
                    <input type="text" id="paperId_${i}" name="Paper_${i}_ID" placeholder="E.g. 195" ${apcActive ? 'required' : ''} oninput="calculateTotalFee()">
                </div>
                <div class="input-field col">
                    <label for="paperTitle_${i}">Title of the Paper <span class="required">*</span></label>
                    <input type="text" id="paperTitle_${i}" name="Paper_${i}_Title" placeholder="Enter paper title" required>
                </div>
            </div>
            <div class="form-checkbox mb-2${apcActive ? '' : ' hidden'}" style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
                <input type="checkbox" id="includeApc_${i}" name="Paper_${i}_Include_APC" class="apc-toggle price-trigger" data-target="apc-details-${i}">
                <label for="includeApc_${i}" style="margin-left: 8px;">Include APC (Article Processing Charge) for this paper?</label>
            </div>
            <div id="apc-details-${i}" class="hidden form-group mt-2">
                <div class="input-field">
                    <label for="journal_${i}">Select Journal <span class="required">*</span></label>
                    <select id="journal_${i}" name="Paper_${i}_Journal" class="journal-select price-trigger">
                        ${journalOptions}
                    </select>
                </div>
            </div>
        `;
        container.appendChild(block);
    }

    // Add event listeners to the new dynamic elements
    container.querySelectorAll('.apc-toggle').forEach(toggle => {
        toggle.addEventListener('change', (e) => {
            const target = document.getElementById(e.target.dataset.target);
            const select = target.querySelector('select');
            if (e.target.checked) {
                target.classList.remove('hidden');
                select.required = true;
            } else {
                target.classList.add('hidden');
                select.required = false;
                select.value = ''; // reset
            }
            calculateTotalFee();
        });
    });

    container.querySelectorAll('.journal-select').forEach(select => {
        select.addEventListener('change', calculateTotalFee);
    });
}

// ---- DYNAMIC PRICING LOGIC ----

function updateExcursionTicketVisibility() {
    const region = document.getElementById('attendeeRegion').value;
    const isLocal = region === 'Local';

    // Excursion ticket groups
    const localGroup   = document.getElementById('excursion-local-ticket-group');
    const foreignGroup = document.getElementById('excursion-foreign-ticket-group');
    if (localGroup && foreignGroup) {
        if (isLocal) {
            localGroup.classList.remove('hidden');
            foreignGroup.classList.add('hidden');
            document.getElementById('excursionForeignCount').value = 0;
        } else {
            foreignGroup.classList.remove('hidden');
            localGroup.classList.add('hidden');
            document.getElementById('excursionLocalCount').value = 0;
        }
    }

    // Country field — hidden for local (Sri Lanka), required for all others
    const countryGroup = document.getElementById('country-field-group');
    const countryInput = document.getElementById('country');
    if (countryGroup && countryInput) {
        if (isLocal) {
            countryGroup.classList.add('hidden');
            countryInput.required = false;
            countryInput.value = 'Sri Lanka';
        } else {
            countryGroup.classList.remove('hidden');
            countryInput.required = true;
            if (countryInput.value === 'Sri Lanka') countryInput.value = '';
        }
    }

    calculateTotalFee();
}

// ---- COST PREVIEW TABLES ----

function updateCostPreviews() {
    const region   = document.getElementById('attendeeRegion')?.value  || '';
    const category = document.getElementById('attendeeCategory')?.value || '';
    const isLocal  = region === 'Local';
    const isSAARC  = region === 'SAARC';
    const hasRgn   = !!region;
    const fxRate   = appSettings.usd_to_lkr || 320;
    const dispCur  = hasRgn ? (isLocal ? 'LKR' : 'USD') : null;

    const toDisp = (amount, fromCur) => {
        if (!hasRgn) return null;
        if (fromCur === dispCur) return amount;
        return dispCur === 'LKR' ? Math.round(amount * fxRate) : Math.round(amount / fxRate);
    };

    _previewRegTypes(category, isLocal, isSAARC, hasRgn, fxRate, dispCur, toDisp);
    _previewApcJournals(hasRgn, dispCur, toDisp);
    _previewPreconf(isLocal, isSAARC, hasRgn, fxRate, dispCur);
    updateInaugurationLabel(isLocal, hasRgn);
}

function _previewRegTypes(category, isLocal, isSAARC, hasRgn, fxRate, dispCur, toDisp) {
    const el = document.getElementById('reg-type-cost-preview');
    if (!el) return;

    const cats        = appSettings.categories || [];
    const awdFee      = appSettings.award_fee || 0;                   // LKR native
    const exclLoc     = appSettings.excursion_fees?.local    || 0;    // LKR native
    const exclFor     = appSettings.excursion_fees?.foreigner || 0;   // LKR native
    const inaugFeeLKR = appSettings.inauguration_fee     || 0;
    const inaugFeeUSD = appSettings.inauguration_fee_usd || 0;

    const tbl = 'width:100%;border-collapse:collapse;font-size:0.82rem;';
    const thS = 'font-size:0.74rem;font-weight:500;color:var(--text-muted);padding:4px 6px 4px 0;';
    const rb  = 'border-top:1px solid rgba(255,255,255,0.07);';

    const catDef        = category ? cats.find(c => c.label === category) : null;
    const isStudentType = catDef?.is_student     || false;
    const hasPaperDisc  = catDef?.paper_discount || false;

    let rows = '';

    if (!hasRgn) {
        // No region: 4-column table showing all categories
        cats.forEach(cat => {
            rows += `<tr style="${rb}">
                <td style="padding:5px 6px 5px 0;color:var(--text-light);">Main Conf — ${cat.label}</td>
                <td style="text-align:right;padding:5px 4px;color:var(--accent);">${cat.fee_local.toLocaleString('en-US')}</td>
                <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${cat.fee_saarc}</td>
                <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${cat.fee_nonsaarc}</td>
            </tr>`;
        });
        const awUSD = Math.round(awdFee / fxRate);
        const elUSD = Math.round(exclLoc / fxRate);
        const efUSD = Math.round(exclFor / fxRate);
        rows += `<tr style="${rb}">
            <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excellence Award (per person)</td>
            <td style="text-align:right;padding:5px 4px;color:var(--accent);">${awdFee.toLocaleString('en-US')}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${awUSD}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${awUSD}</td>
        </tr>
        <tr style="${rb}">
            <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excursion – Local ticket</td>
            <td style="text-align:right;padding:5px 4px;color:var(--accent);">${exclLoc.toLocaleString('en-US')}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${elUSD}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${elUSD}</td>
        </tr>
        <tr style="${rb}">
            <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excursion – Foreign ticket</td>
            <td style="text-align:right;padding:5px 4px;color:var(--accent);">${exclFor.toLocaleString('en-US')}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${efUSD}</td>
            <td style="text-align:right;padding:5px 4px;color:var(--text-light);">${efUSD}</td>
        </tr>`;

        el.innerHTML = `<div style="margin-top:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;">
            <div style="font-size:0.74rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
                <i class='bx bx-receipt' style="margin-right:4px;vertical-align:middle;"></i>Fee Reference — select Attendee Region above for personalised pricing
            </div>
            <table style="${tbl}"><thead><tr>
                <th style="${thS}text-align:left;"></th>
                <th style="${thS}text-align:right;">Local (LKR)</th>
                <th style="${thS}text-align:right;">SAARC (USD)</th>
                <th style="${thS}text-align:right;">Non-SAARC (USD)</th>
            </tr></thead><tbody>${rows}</tbody></table>
        </div>`;

    } else {
        // Region known: single currency. When category is also known, show only that category row.
        const filteredCats = category ? cats.filter(c => c.label === category) : cats;

        filteredCats.forEach(cat => {
            const rawFee    = isLocal ? cat.fee_local : (isSAARC ? cat.fee_saarc : cat.fee_nonsaarc);
            const nativeCur = isLocal ? 'LKR' : 'USD';
            const dispFee   = toDisp(rawFee, nativeCur);
            const active    = cat.label === category;
            const hl = active ? 'background:rgba(197,215,58,0.1);' : '';
            const nC = active ? 'color:var(--accent);font-weight:600;' : 'color:var(--text-light);';
            const vC = active ? 'color:var(--accent);font-weight:700;' : 'color:var(--text-light);';
            rows += `<tr style="${rb}${hl}">
                <td style="padding:5px 6px 5px 0;${nC}">Main Conf — ${cat.label}${active ? ' ✓' : ''}</td>
                <td style="text-align:right;padding:5px 6px;${vC}">${dispFee?.toLocaleString('en-US')}</td>
            </tr>`;
        });

        // Inauguration row — only shown when a student-type category is selected and fee > 0
        if (isStudentType && category) {
            const inaugFee = isLocal ? inaugFeeLKR : inaugFeeUSD;
            const inaugCur = isLocal ? 'LKR' : 'USD';
            if (inaugFee > 0) {
                const dispFee = toDisp(inaugFee, inaugCur);
                rows += `<tr style="${rb}">
                    <td style="padding:5px 6px 5px 0;color:var(--text-muted);font-size:0.8rem;padding-left:10px;">↳ Inauguration opt-in (optional)</td>
                    <td style="text-align:right;padding:5px 6px;color:var(--text-muted);font-size:0.8rem;">+${dispFee?.toLocaleString('en-US')}</td>
                </tr>`;
            }
        }

        // Paper discount sub-row — shown when category qualifies for multi-paper discount
        if (hasPaperDisc && category) {
            const discPct  = appSettings.discounts.student_from_2nd || 0;
            const maxP     = appSettings.discounts.discount_max_papers || 0;
            const baseFeeP = isLocal ? catDef.fee_local : (isSAARC ? catDef.fee_saarc : catDef.fee_nonsaarc);
            const nativeCurP = isLocal ? 'LKR' : 'USD';
            if (discPct > 0) {
                const discFeeP = Math.round(baseFeeP * (1 - discPct / 100));
                const capNote  = maxP > 0 ? `, up to ${maxP} papers` : '';
                rows += `<tr style="${rb}">
                    <td style="padding:5px 6px 5px 0;color:var(--text-muted);font-size:0.8rem;padding-left:10px;">↳ 2nd paper onwards: ${toDisp(discFeeP, nativeCurP)?.toLocaleString('en-US')} (${discPct}% off${capNote})</td>
                    <td style="text-align:right;padding:5px 6px;color:var(--text-muted);font-size:0.8rem;">per paper</td>
                </tr>`;
            }
        }

        rows += `<tr style="${rb}">
            <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excellence Award (per person)</td>
            <td style="text-align:right;padding:5px 6px;color:var(--text-light);">${toDisp(awdFee, 'LKR')?.toLocaleString('en-US')}</td>
        </tr>`;

        // Excursion: show only the ticket type relevant to the attendee's region
        if (isLocal) {
            rows += `<tr style="${rb}">
                <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excursion ticket</td>
                <td style="text-align:right;padding:5px 6px;color:var(--text-light);">${toDisp(exclLoc, 'LKR')?.toLocaleString('en-US')}</td>
            </tr>`;
        } else {
            rows += `<tr style="${rb}">
                <td style="padding:5px 6px 5px 0;color:var(--text-light);">Excursion ticket</td>
                <td style="text-align:right;padding:5px 6px;color:var(--text-light);">${toDisp(exclFor, 'LKR')?.toLocaleString('en-US')}</td>
            </tr>`;
        }

        const hdr = category ? `Fee Reference (${dispCur}) — ${category}` : `Fee Reference (${dispCur})`;
        el.innerHTML = `<div style="margin-top:12px;padding:12px 16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;">
            <div style="font-size:0.74rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
                <i class='bx bx-receipt' style="margin-right:4px;vertical-align:middle;"></i>${hdr}
            </div>
            <table style="${tbl}"><thead><tr>
                <th style="${thS}text-align:left;">Registration Type</th>
                <th style="${thS}text-align:right;">${dispCur}</th>
            </tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    }
}

function _previewApcJournals(hasRgn, dispCur, toDisp) {
    const el = document.getElementById('apc-journal-preview');
    if (!el) return;

    if (!appSettings.apc_collection_active) { el.innerHTML = ''; return; }

    const journals = appSettings.journals || [];
    if (!journals.length) { el.innerHTML = ''; return; }

    let rows = '';
    journals.forEach(j => {
        const fee    = hasRgn ? toDisp(j.fee, 'USD') : j.fee;
        const curLbl = hasRgn ? dispCur : 'USD';
        rows += `<tr style="border-top:1px solid rgba(74,158,255,0.12);">
            <td style="padding:6px 8px 6px 0;color:var(--text-light);">${j.name}</td>
            <td style="text-align:right;padding:6px 0;color:#4a9eff;font-weight:500;">${curLbl} ${fee?.toLocaleString('en-US')}</td>
        </tr>`;
    });

    el.innerHTML = `<div style="margin-bottom:20px;padding:14px 18px;background:rgba(74,158,255,0.05);border:1px solid rgba(74,158,255,0.2);border-radius:8px;">
        <div style="font-size:0.78rem;font-weight:600;color:#4a9eff;margin-bottom:10px;">
            <i class='bx bx-book-open' style="margin-right:5px;"></i>APC Journal Options &amp; Fees${hasRgn ? ' (' + dispCur + ')' : ' (USD)'}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;"><thead><tr>
            <th style="text-align:left;font-size:0.74rem;font-weight:500;color:var(--text-muted);padding:3px 8px 3px 0;">Journal</th>
            <th style="text-align:right;font-size:0.74rem;font-weight:500;color:var(--text-muted);padding:3px 0;">Fee per Paper</th>
        </tr></thead><tbody>${rows}</tbody></table>
        <div style="font-size:0.73rem;color:var(--text-muted);margin-top:8px;">APC fee is charged per paper. Select your journal in each paper block below.</div>
    </div>`;
}

function _previewPreconf(isLocal, isSAARC, hasRgn, fxRate, dispCur) {
    const el = document.getElementById('preconf-cost-preview');
    if (!el) return;

    const sessions = appSettings.pre_conference_sessions || [];
    if (!sessions.length) { el.innerHTML = ''; return; }

    let rows = '';
    sessions.forEach(sess => {
        let feeStr;
        if (hasRgn) {
            const rawFee    = isLocal ? sess.fee_local : (isSAARC ? sess.fee_saarc : sess.fee_nonsaarc);
            const nativeCur = isLocal ? 'LKR' : 'USD';
            let dispFee = rawFee;
            if (nativeCur !== dispCur) {
                dispFee = dispCur === 'LKR' ? Math.round(rawFee * fxRate) : Math.round(rawFee / fxRate);
            }
            feeStr = `${dispCur} ${dispFee.toLocaleString('en-US')}`;
        } else {
            feeStr = `LKR ${sess.fee_local.toLocaleString('en-US')} / USD ${sess.fee_saarc}`;
        }
        rows += `<tr style="border-top:1px solid rgba(197,215,58,0.12);">
            <td style="padding:6px 8px 6px 0;color:var(--text-light);">${sess.name}</td>
            <td style="text-align:right;padding:6px 0;color:var(--accent);font-weight:500;white-space:nowrap;">${feeStr}</td>
        </tr>`;
    });

    const note = !hasRgn
        ? `<tr><td colspan="2" style="padding:5px 0 0;font-size:0.73rem;color:var(--text-muted);">Shown as Local (LKR) / SAARC &amp; Non-SAARC (USD). Select your region above for a single price.</td></tr>`
        : '';

    el.innerHTML = `<div style="margin-bottom:16px;padding:12px 16px;background:rgba(197,215,58,0.04);border:1px solid rgba(197,215,58,0.18);border-radius:8px;">
        <div style="font-size:0.74rem;font-weight:600;color:var(--accent);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">
            <i class='bx bx-tag-alt' style="margin-right:4px;vertical-align:middle;"></i>Session Fees${hasRgn ? ' (' + dispCur + ')' : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
            <tbody>${rows}${note}</tbody>
        </table>
    </div>`;
}

function updateInaugurationLabel(isLocal, hasRgn) {
    const span = document.getElementById('inauguration-fee-label');
    if (!span) return;
    const inaugFeeLKR = appSettings.inauguration_fee     || 0;
    const inaugFeeUSD = appSettings.inauguration_fee_usd || 0;
    if (!hasRgn) {
        span.textContent = (inaugFeeLKR > 0 || inaugFeeUSD > 0)
            ? `(additional fee: LKR ${inaugFeeLKR.toLocaleString('en-US')} / USD ${inaugFeeUSD})`
            : '';
    } else if (isLocal) {
        span.textContent = inaugFeeLKR > 0 ? `(additional fee: LKR ${inaugFeeLKR.toLocaleString('en-US')})` : '';
    } else {
        span.textContent = inaugFeeUSD > 0 ? `(additional fee: USD ${inaugFeeUSD})` : '';
    }
}

function calculateTotalFee() {
    updateCostPreviews();

    const isMain      = document.getElementById('toggleMain').checked;
    const isAward     = document.getElementById('toggleAward').checked;
    const isExcursion = document.getElementById('toggleExcursion').checked;
    const isPreConf   = document.getElementById('togglePreConf')?.checked || false;

    const invWrapper = document.getElementById('invoice-download-wrapper');
    if (!isMain && !isAward && !isExcursion && !isPreConf) {
        priceBox.classList.add('hidden');
        if (invWrapper) invWrapper.classList.add('hidden');
        priceCurrency.textContent = 'LKR';
        priceTotalAmount.textContent = '0.00';
        priceBreakdown.innerHTML = '';
        return;
    }
    priceBox.classList.remove('hidden');
    if (invWrapper) invWrapper.classList.remove('hidden');

    const region = document.getElementById('attendeeRegion').value;
    const isLocalRegion = region === 'Local';
    const fxRate = appSettings.usd_to_lkr || 320;
    const displayCur = isLocalRegion ? 'LKR' : 'USD';

    // Convert any amount from its native currency to the display currency
    const toDisplay = (amount, fromCur) => {
        if (fromCur === displayCur) return amount;
        return displayCur === 'LKR' ? Math.round(amount * fxRate) : +((amount / fxRate).toFixed(2));
    };

    let displayTotal = 0;
    let breakdownText = '';
    const br = () => {}; // grid layout handles row placement; no <br> needed

    // 1. Main Conference & APC
    if (isMain) {
        const category = document.getElementById('attendeeCategory').value;
        const papers   = parseInt(document.getElementById('numberOfPapers').value) || 1;

        if (!region || !category) {
            breakdownText += `<span><i class='bx bx-info-circle'></i> Select Region & Category for Conf Fee</span>`;
        } else {
            // Resolve base fee from flexible categories list
            const catDef = (appSettings.categories || []).find(c => c.label === category);
            const isStudent  = catDef?.is_student || false;
            let baseFee = 0;
            let nativeCur = isLocalRegion ? 'LKR' : 'USD';
            if (catDef) {
                baseFee = isLocalRegion ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
            } else {
                // Fallback: legacy conf_fees lookup
                const regionKey = region.toLowerCase().replace(/[^a-z]/g, '');
                const catKey = isStudent ? 'student' : (catDef?.no_papers ? 'nonauthor' : 'author');
                baseFee = (appSettings.conf_fees?.[regionKey]?.[catKey]) || 0;
            }
            const hasPaperDiscount = catDef?.paper_discount || false;
            const maxP = appSettings.discounts.discount_max_papers || 0;
            const discPapers = papers > 1 ? (maxP > 0 ? Math.min(papers - 1, maxP - 1) : papers - 1) : 0;
            const fullExtra  = papers > 1 ? (papers - 1 - discPapers) : 0;
            const disc       = (appSettings.discounts.student_from_2nd || 0) / 100;

            let confTotal;
            if (papers === 1) {
                confTotal = baseFee;
                br(); breakdownText += `<span>Conference Fee:</span><span>${confTotal} ${nativeCur}</span>`;
            } else if (hasPaperDiscount && disc > 0) {
                const discFee = baseFee * (1 - disc);
                confTotal = baseFee + (discFee * discPapers) + (baseFee * fullExtra);
                br(); breakdownText += `<span>Conf (1st: ${baseFee} | ${discPapers} × ${discFee.toFixed(0)} @ ${appSettings.discounts.student_from_2nd}% off${fullExtra > 0 ? ` | ${fullExtra} × ${baseFee} full` : ''}):</span><span>${confTotal.toFixed(2)} ${nativeCur}</span>`;
            } else {
                confTotal = baseFee * papers;
                br(); breakdownText += `<span>Conf (${papers} Papers):</span><span>${confTotal} ${nativeCur}</span>`;
            }
            displayTotal += toDisplay(confTotal, nativeCur);
        }

        // APC (always USD)
        document.getElementById('dynamic-papers-container').querySelectorAll('.apc-toggle').forEach((toggle, i) => {
            if (toggle.checked) {
                const sel = document.getElementById(`journal_${i + 1}`);
                if (sel && sel.value) {
                    const fee = parseFloat(sel.options[sel.selectedIndex].dataset.fee) || 0;
                    const disp = toDisplay(fee, 'USD');
                    displayTotal += disp;
                    br(); breakdownText += `<span>+ P${i + 1} APC (${sel.value}):</span><span>${disp} ${displayCur}</span>`;
                }
            }
        });

    }

    // Inauguration opt-in — student opt-in, available regardless of registration type
    const inaugCheck = document.getElementById('includeInauguration');
    if (inaugCheck?.checked) {
        const inaugFee = isLocalRegion ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = isLocalRegion ? 'LKR' : 'USD';
        if (inaugFee > 0) {
            const disp = toDisplay(inaugFee, inaugCur);
            displayTotal += disp;
            br(); breakdownText += `<span>Inauguration Ceremony:</span><span>${disp} ${displayCur}</span>`;
        }
    }

    // Pre-conference sessions — standalone or as add-on
    document.querySelectorAll('.preconf-session-check').forEach(chk => {
        if (chk.checked) {
            const sessId = chk.dataset.sessId;
            const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === sessId);
            if (sess) {
                const rawFee = isLocalRegion ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                const nativeCur2 = isLocalRegion ? 'LKR' : 'USD';
                const disp = toDisplay(rawFee, nativeCur2);
                displayTotal += disp;
                br(); breakdownText += `<span>Session: ${sess.name}:</span><span>${disp} ${displayCur}</span>`;
            }
        }
    });

    // 2. Excellence Award (LKR)
    if (isAward) {
        const pax = parseInt(document.getElementById('participantCount').value) || 1;
        const awardTotal = appSettings.award_fee * pax;
        const disp = toDisplay(awardTotal, 'LKR');
        displayTotal += disp;
        br(); breakdownText += `<span>Award (${pax} Pax):</span><span>${disp} ${displayCur}</span>`;
    }

    // 3. Excursion (LKR)
    if (isExcursion) {
        const locCount = parseInt(document.getElementById('excursionLocalCount').value) || 0;
        const forCount = parseInt(document.getElementById('excursionForeignCount').value) || 0;
        if (locCount > 0) {
            const fee = locCount * appSettings.excursion_fees.local;
            const disp = toDisplay(fee, 'LKR');
            displayTotal += disp;
            br(); breakdownText += `<span>Local Excr (${locCount}):</span><span>${disp} ${displayCur}</span>`;
        }
        if (forCount > 0) {
            const fee = forCount * appSettings.excursion_fees.foreigner;
            const disp = toDisplay(fee, 'LKR');
            displayTotal += disp;
            br(); breakdownText += `<span>Foreign Excr (${forCount}):</span><span>${disp} ${displayCur}</span>`;
        }
    }

    priceCurrency.textContent = displayCur;
    priceTotalAmount.textContent = displayTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    priceBreakdown.innerHTML = breakdownText;
}


// ---- FORM SUBMISSION LOGIC (2-STEP) ----

// Shared helper: collect form data object (no files)
function collectFormData(refId) {
    const formData = new FormData(registrationForm);
    const dataObj = {};
    dataObj['Submission_Date'] = new Date().toLocaleString();
    dataObj['Invoice_ID'] = refId;
    for (let [key, value] of formData.entries()) {
        if (value instanceof File) { dataObj[key] = value.name || ''; continue; }
        dataObj[key] = dataObj[key] ? `${dataObj[key]}, ${value}` : value;
    }
    dataObj['Calculated_Total_Fee'] = document.getElementById('totalPriceAmount').textContent;
    dataObj['Currency'] = document.querySelector('.price-value .currency').textContent;
    const typesArr = [];
    if (document.getElementById('toggleMain').checked)       typesArr.push('Main');
    if (document.getElementById('toggleAward').checked)      typesArr.push('Award');
    if (document.getElementById('toggleExcursion').checked)  typesArr.push('Excursion');
    if (document.getElementById('togglePreConf')?.checked)   typesArr.push('Pre-Conference Sessions');
    dataObj['Registration_Type'] = typesArr.join(' + ') || 'None';
    return dataObj;
}

// ---- RETURNING REGISTRANT LOOKUP ----

async function handleRefLookup() {
    const refId = document.getElementById('lookup-ref-id')?.value?.trim();
    if (!refId) { showToast('Please enter your Reference ID.', 'error'); return; }

    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
        showToast('Google Drive not configured.', 'error'); return;
    }

    const btn = document.getElementById('btn-lookup-ref');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Loading…'; }

    try {
        const url = APPS_SCRIPT_URL + '?action=getRegistrationByRef&ref=' + encodeURIComponent(refId);
        const res = await fetch(url);
        const result = await res.json();

        console.log('Ref lookup GAS response:', result);

        // Detect un-redeployed GAS (returns health-check object instead of lookup result)
        if (result.status === 'SICET 2026 Registration API running') {
            showToast('Server not updated — please redeploy the Google Apps Script.', 'error');
            return;
        }

        if (!result.success || !result.data) {
            showToast(result.error || 'Reference ID not found. Please check and try again.', 'error');
            return;
        }

        populateFormFromData(result.data);

        // Show ref ID
        showRefId(refId);

        // Reveal Step 2 for any saved registration
        document.getElementById('step2-section')?.classList.remove('hidden');

        showToast(`Registration loaded for ${result.data.Full_Name || refId}`, 'success');
        document.getElementById('remaining-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        showToast('Could not connect to server. Please check your connection and try again.', 'error');
        console.error('Ref lookup error:', err);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bx bx-search"></i> Load Registration'; }
    }
}

function populateFormFromData(data) {
    // 0. Reset active toggles so stale sections don't linger
    document.querySelectorAll('.section-toggle').forEach(t => {
        if (t.checked) { t.checked = false; t.dispatchEvent(new Event('change')); }
    });
    document.getElementById('dynamic-papers-container').innerHTML = '';

    // 1. Fire registration-type toggles first so all dependent sections appear
    const typeKeyMap = {
        'Main':           'Registering_Main',
        'Award':          'Registering_Award',
        'Excursion':      'Registering_Excursion',
        'Pre-Conference': 'Registering_PreConf'
    };
    const regType = data.Registration_Type || '';
    Object.entries(typeKeyMap).forEach(([key, name]) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el && regType.includes(key)) { el.checked = true; el.dispatchEvent(new Event('change')); }
    });

    // 2. Generate paper blocks before populating paper-level fields
    if (data.Number_of_Papers) {
        const numPapers = parseInt(data.Number_of_Papers) || 1;
        const numPapersEl = document.getElementById('numberOfPapers');
        if (numPapersEl) { numPapersEl.value = numPapers; generatePaperBlocks(numPapers); }
    }

    const skip = new Set([
        'Registration_Type', 'Number_of_Papers', 'Calculated_Total_Fee', 'Currency',
        'Submission_Date', 'Invoice_ID', 'Status', 'Drive_Folder_URL',
        'Student_ID_Base64', 'Payment_Proof_Base64', 'action',
        'Registering_Main', 'Registering_Award', 'Registering_Excursion', 'Registering_PreConf'
    ]);

    // 3. Populate every field by type — radio → checkbox → text/select
    Object.entries(data).forEach(([key, value]) => {
        if (skip.has(key) || value === '' || value == null) return;

        // Radio buttons (e.g. Bill_To: Personal / Organization)
        const radios = registrationForm.querySelectorAll(`[name="${key}"][type="radio"]`);
        if (radios.length > 0) {
            radios.forEach(r => {
                if (r.value === String(value)) { r.checked = true; r.dispatchEvent(new Event('change')); }
            });
            return;
        }

        // Checkboxes — APC toggles, pre-conf session checkboxes, etc.
        const boxes = registrationForm.querySelectorAll(`[name="${key}"][type="checkbox"]`);
        if (boxes.length > 0) {
            const checked = (value === true || value === 'true' || value === 'on');
            boxes.forEach(cb => { cb.checked = checked; if (checked) cb.dispatchEvent(new Event('change')); });
            return;
        }

        // Text / select / textarea / number
        const el = registrationForm.querySelector(`[name="${key}"]`);
        if (el && el.type !== 'file') el.value = value;
    });

    // 4. Trigger cascading visibility updates (region hides/shows country + excursion fields,
    //    category hides/shows designation, student ID, inauguration, paper discount hint)
    ['attendeeRegion', 'attendeeCategory'].forEach(id => {
        const el = document.getElementById(id);
        if (el && el.value) el.dispatchEvent(new Event('change'));
    });

    // 5. Restore "Other" purpose text field visibility
    const prSel = document.getElementById('primaryReason');
    if (prSel && prSel.value === 'Other') {
        document.getElementById('primary-reason-other-group')?.classList.remove('hidden');
    }

    calculateTotalFee();
}

// STEP 1 — Save draft + get Ref ID (no payment proof required)
// STEP 2 — Upload payment proof and finalize
async function handleFormSubmit(e) {
    e.preventDefault();

    const paymentProofInput = document.getElementById('paymentProof');
    if (!paymentProofInput.files[0]) {
        showToast('Please upload your proof of payment before submitting.', 'error');
        paymentProofInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    let refId = document.getElementById('reg-ref-id')?.textContent?.trim();
    if (!refId || refId === '—') {
        showToast('Please complete Step 1 first to get a Reference ID.', 'error'); return;
    }

    const dataObj = collectFormData(refId);
    dataObj['Status'] = 'Submitted';

    const studentIdInput = document.getElementById('studentId');
    if (studentIdInput?.files[0]) dataObj['Student_ID_Base64'] = await fileToBase64(studentIdInput.files[0]);
    dataObj['Payment_Proof_Base64'] = await fileToBase64(paymentProofInput.files[0]);

    const submitBtn = document.getElementById('btn-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Submitting…</span><i class="bx bx-loader bx-spin"></i>';

    const ok = await submitToGoogleDrive(dataObj);

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit Registration</span><i class="bx bx-right-arrow-alt"></i>';
    if (!ok) return;

    clearDraft();
    registrationForm.reset();
    document.querySelectorAll('.section-toggle').forEach(t => t.dispatchEvent(new Event('change')));
    const refEl = document.getElementById('reg-ref-id');
    if (refEl) refEl.textContent = '—';
    document.getElementById('step2-section')?.classList.add('hidden');

    showToast(`Registration complete! Reference: ${refId}`, 'success');
}

// ---- PROFORMA INVOICE (jsPDF) LOGIC ----

function generateInvoice() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // ---- 1. Collect Form Data ----
    const title = document.getElementById('title').value || '';
    const fullName = document.getElementById('fullName').value || '';
    const email = document.getElementById('email').value || '';
    const phone = document.getElementById('phone').value || '';
    const org = document.getElementById('organization').value || '';
    const region = document.getElementById('attendeeRegion').value || '';
    const country = document.getElementById('country').value || '';
    const category = document.getElementById('attendeeCategory').value || '';

    const isMain     = document.getElementById('toggleMain').checked;
    const isAward    = document.getElementById('toggleAward').checked;
    const isExcursion = document.getElementById('toggleExcursion').checked;
    const isPreConf  = document.getElementById('togglePreConf')?.checked || false;

    if (!isMain && !isAward && !isExcursion && !isPreConf) {
        showToast('Please select registration items to generate an invoice.', 'error');
        return;
    }

    const billToType = document.querySelector('input[name="Bill_To"]:checked')?.value || 'Personal';
    const orgLegalName = document.getElementById('orgLegalName').value || org;
    const orgBillingAddress = document.getElementById('orgBillingAddress').value || '';
    const orgTaxId = document.getElementById('orgTaxId').value || '';
    const orgFinanceEmail = document.getElementById('orgFinanceEmail').value || '';

    const dateObj = new Date();
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    // Reuse existing ref ID (if already generated) so we never create duplicate Drive folders
    let refId = document.getElementById('reg-ref-id')?.textContent?.trim();
    if (!refId || refId === '—') {
        refId = 'SICET2026-' + Date.now().toString().slice(-7);
    }
    showRefId(refId);
    const invoiceNum = refId;

    // ---- 2. Build Line Items (single target currency) ----
    const isLocalInv = region === 'Local';
    const invoiceCur = isLocalInv ? 'LKR' : 'USD';
    const fxRateInv  = appSettings.usd_to_lkr || 320;

    const toIC = (amount, fromCur) => {
        if (amount === null || amount === undefined) return null;
        if (fromCur === invoiceCur) return amount;
        return invoiceCur === 'LKR' ? Math.round(amount * fxRateInv) : +((amount / fxRateInv).toFixed(2));
    };

    let lineItems = [];
    let grandTotal = 0;
    const addItem = (desc, amount, fromCur) => {
        const converted = toIC(amount, fromCur);
        lineItems.push({ description: desc, amount: converted });
        if (converted !== null) grandTotal += converted;
    };

    if (isMain) {
        const papers = parseInt(document.getElementById('numberOfPapers').value) || 0;
        const nativeCur = isLocalInv ? 'LKR' : 'USD';

        // Resolve base fee from flexible categories
        const catDef        = (appSettings.categories || []).find(c => c.label === category);
        const isStudentInv  = catDef?.is_student || false;
        const isNoPapersInv = catDef?.no_papers   || false;
        let baseFee = 0;
        if (catDef) {
            baseFee = isLocalInv ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
        } else {
            const rKey = region.toLowerCase().replace(/[^a-z]/g, '');
            const cKey = isStudentInv ? 'student' : (isNoPapersInv ? 'nonauthor' : 'author');
            baseFee = appSettings.conf_fees?.[rKey]?.[cKey] || 0;
        }

        if (!isNoPapersInv && papers > 0) {
            const hasPaperDiscountInv = catDef?.paper_discount || false;
            const maxP = appSettings.discounts.discount_max_papers || 0;
            const discPapers = papers > 1 ? (maxP > 0 ? Math.min(papers - 1, maxP - 1) : papers - 1) : 0;
            const fullExtra  = papers > 1 ? (papers - 1 - discPapers) : 0;
            const disc       = (appSettings.discounts.student_from_2nd || 0) / 100;

            let confTotal, confLabel;
            if (papers === 1) {
                confTotal = baseFee;
                confLabel = `Conference Registration — ${title} ${fullName} (${category}, ${region})`;
            } else if (hasPaperDiscountInv && disc > 0) {
                const discFee = baseFee * (1 - disc);
                confTotal = baseFee + (discFee * discPapers) + (baseFee * fullExtra);
                confLabel = `Conference (${papers} papers — 1st: ${baseFee}, ${discPapers} × ${discFee.toFixed(0)} @ ${appSettings.discounts.student_from_2nd}% off${fullExtra > 0 ? `, ${fullExtra} × ${baseFee} full` : ''})`;
            } else {
                confTotal = baseFee * papers;
                confLabel = `Conference Registration — ${papers} Papers × ${baseFee} (${category}, ${region})`;
            }
            addItem(confLabel, confTotal, nativeCur);

            // Paper details note
            const paperNotes = [];
            for (let i = 1; i <= papers; i++) {
                const pid = document.getElementById(`paperId_${i}`)?.value || '';
                const ptitle = document.getElementById(`paperTitle_${i}`)?.value || '';
                const st = ptitle.length > 32 ? ptitle.slice(0, 32) + '…' : ptitle;
                if (pid || ptitle) paperNotes.push(`P${i}${pid ? ':' + pid : ''}${st ? ' — ' + st : ''}`);

                const apcToggle = document.getElementById(`includeApc_${i}`);
                const journalSel = document.getElementById(`journal_${i}`);
                if (apcToggle?.checked && journalSel?.value) {
                    const apcFee = parseFloat(journalSel.options[journalSel.selectedIndex].dataset.fee) || 0;
                    addItem(`  APC — P${i}: ${journalSel.value}`, apcFee, 'USD');
                }
            }
            if (paperNotes.length > 0) addItem('  Papers: ' + paperNotes.join(' | '), null, nativeCur);

        } else if (isNoPapersInv) {
            addItem(`Conference Registration — ${title} ${fullName} (${category}, ${region})`, baseFee, nativeCur);
        }

    }

    // Inauguration opt-in — student opt-in, independent of registration type
    const inaugCheck = document.getElementById('includeInauguration');
    if (inaugCheck?.checked) {
        const inaugFee = isLocalInv ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = isLocalInv ? 'LKR' : 'USD';
        if (inaugFee > 0) addItem('Inauguration Ceremony (opt-in)', inaugFee, inaugCur);
    }

    // Pre-conference sessions — standalone or as add-on
    document.querySelectorAll('.preconf-session-check').forEach(chk => {
        if (chk.checked) {
            const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === chk.dataset.sessId);
            if (sess) {
                const rawFee = isLocalInv ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                addItem(`Pre-Conference Session: ${sess.name}`, rawFee, isLocalInv ? 'LKR' : 'USD');
            }
        }
    });

    if (isAward) {
        const pax = parseInt(document.getElementById('participantCount').value) || 1;
        const names = document.getElementById('participantNames').value || '';
        const awardCat = document.getElementById('awardCategory').value || '';
        addItem(`Excellence Award — ${awardCat || 'Category TBD'} (${pax} pax)`, appSettings.award_fee * pax, 'LKR');
        if (names) addItem(`  Participants: ${names.slice(0, 80)}${names.length > 80 ? '…' : ''}`, null, 'LKR');
    }

    if (isExcursion) {
        const locCount = parseInt(document.getElementById('excursionLocalCount').value) || 0;
        const forCount = parseInt(document.getElementById('excursionForeignCount').value) || 0;
        if (locCount > 0) addItem(`Excursion — Local × ${locCount} (LKR ${appSettings.excursion_fees.local.toLocaleString()} each)`, locCount * appSettings.excursion_fees.local, 'LKR');
        if (forCount > 0) addItem(`Excursion — Foreign × ${forCount} (LKR ${appSettings.excursion_fees.foreigner.toLocaleString()} each)`, forCount * appSettings.excursion_fees.foreigner, 'LKR');
    }

    if (grandTotal === 0 && lineItems.every(i => i.amount === null)) {
        showToast('No fees calculated. Please fill in all registration details first.', 'error');
        return;
    }

    // ---- 3. PDF Drawing (B&W, professional — targets 1 A4 page) ----
    const L = 14;
    const R = 196;
    const W = R - L;
    let Y = 14;

    const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function drawRow(label, amount, currency, isBold, isShaded) {
        const splitLabel = doc.splitTextToSize(label, W - 48);
        const rowH = Math.max((splitLabel.length * 4.5) + 5, 9);
        if (Y + rowH > 278) { doc.addPage(); Y = 14; }
        if (isShaded) { doc.setFillColor(248, 248, 248); doc.rect(L, Y, W, rowH, 'F'); }
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2); doc.rect(L, Y, W, rowH, 'S');
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
        doc.text(splitLabel, L + 3, Y + 5.5);
        if (amount !== null && amount !== undefined) {
            doc.text(`${currency} ${fmt(amount)}`, R - 3, Y + 5.5, { align: 'right' });
        }
        Y += rowH;
    }

    // --- HEADER ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(0, 0, 0);
    doc.text('PROFORMA INVOICE', L, Y + 7);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(`Invoice No:  ${invoiceNum}`, R, Y + 2, { align: 'right' });
    doc.text(`Date:  ${dateStr}`, R, Y + 8, { align: 'right' });

    Y += 11;
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.line(L, Y, R, Y);
    Y += 6;

    // --- ISSUER (left) & BILL TO (right) — independent column tracking prevents overlap ---
    const colMid = 106;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 130, 130);
    doc.text('ISSUED BY', L, Y);
    doc.text('BILL TO', colMid, Y);
    Y += 4.5;

    const blockTopY = Y;
    let issuerY = blockTopY;
    let billY = blockTopY;

    // Issuer column
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    doc.text('SICET Chair — Registration', L, issuerY); issuerY += 4.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
    doc.text('Sri Lanka Institute of Information Technology', L, issuerY); issuerY += 4;
    doc.text('New Kandy Road, Malabe, Sri Lanka', L, issuerY); issuerY += 4;
    doc.text('Email: sicet@sliit.lk or info@sliit.lk', L, issuerY); issuerY += 4;
    doc.text('Tel: 011 754 4801', L, issuerY); issuerY += 4;

    // Bill To column
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
    if (billToType === 'Organization') {
        doc.text(orgLegalName || org, colMid, billY); billY += 4.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
        if (orgBillingAddress) {
            const addrLines = doc.splitTextToSize(orgBillingAddress, R - colMid - 2);
            doc.text(addrLines, colMid, billY); billY += addrLines.length * 4;
        }
        if (orgTaxId) { doc.text(`Tax ID: ${orgTaxId}`, colMid, billY); billY += 4; }
        if (orgFinanceEmail) { doc.text(orgFinanceEmail, colMid, billY); billY += 4; }
        doc.text(`Attn: ${title} ${fullName}`, colMid, billY); billY += 4;
    } else {
        doc.text(`${title} ${fullName}`, colMid, billY); billY += 4.5;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(50, 50, 50);
        doc.text(org, colMid, billY); billY += 4;
        doc.text(email, colMid, billY); billY += 4;
        doc.text(phone, colMid, billY); billY += 4;
    }

    Y = Math.max(issuerY, billY) + 3;
    doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.2);
    doc.line(L, Y, R, Y);
    Y += 5;

    // --- TABLE HEADER ---
    doc.setFillColor(25, 25, 25); doc.setTextColor(255, 255, 255);
    doc.rect(L, Y, W, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('Description', L + 3, Y + 5.5);
    doc.text('Amount', R - 3, Y + 5.5, { align: 'right' });
    Y += 8;
    doc.setTextColor(0, 0, 0);

    // --- LINE ITEMS (all in invoiceCur) ---
    doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
    lineItems.forEach((item, idx) => drawRow(item.description, item.amount, invoiceCur, false, idx % 2 === 0));

    // --- GRAND TOTAL ---
    Y += 3;
    if (Y + 10 > 278) { doc.addPage(); Y = 14; }
    doc.setFillColor(20, 20, 20); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
    doc.rect(L, Y, W, 10, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text('GRAND TOTAL:', L + 3, Y + 7);
    doc.text(`${invoiceCur} ${fmt(grandTotal)}`, R - 3, Y + 7, { align: 'right' });
    Y += 12;
    doc.setTextColor(0, 0, 0);

    // --- BANK DETAILS (de-emphasised — supporting information) ---
    Y += 4;
    const bankBoxH = 27;
    if (Y + bankBoxH > 278) { doc.addPage(); Y = 14; }
    doc.setFillColor(252, 252, 252); doc.setDrawColor(175, 175, 175); doc.setLineWidth(0.25);
    doc.rect(L, Y, W, bankBoxH, 'FD');

    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(100, 100, 100);
    doc.text('BANK TRANSFER DETAILS', L + 4, Y + 5);

    const bY = Y + 10;
    const c1 = L + 4, c2 = L + 30, c3 = L + 97, c4 = L + 121;
    const bankLeft = [['Bank:', 'Bank of Ceylon'], ['Account Name:', 'SICET 2026 — SLIIT'], ['Branch:', 'Malabe Branch']];
    const bankRight = [['Account No:', '1234567890'], ['SWIFT / BIC:', 'BCEYLKLX']];

    doc.setFontSize(7.5);
    bankLeft.forEach(([lbl, val], i) => {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(70, 70, 70); doc.text(lbl, c1, bY + i * 4.8);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30); doc.text(val, c2, bY + i * 4.8);
    });
    bankRight.forEach(([lbl, val], i) => {
        doc.setFont('helvetica', 'bold'); doc.setTextColor(70, 70, 70); doc.text(lbl, c3, bY + i * 4.8);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30); doc.text(val, c4, bY + i * 4.8);
    });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(110, 110, 110);
    doc.text(`* Use "${fullName} — ${invoiceNum}" as payment reference.`, L + 4, Y + bankBoxH - 3);

    Y += bankBoxH + 4;

    // --- FOOTER ---
    const paymentUrl = 'https://pay.sliit.lk/';
    const refundDeadline = appSettings.refund_deadline || 'August 23, 2025';

    if (Y + 50 > 278) { doc.addPage(); Y = 14; }

    // Payment gateway
    doc.setFillColor(245, 245, 245); doc.setDrawColor(150, 150, 150); doc.setLineWidth(0.3);
    doc.rect(L, Y, W, 12, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
    doc.text('Online Payment via SLIIT Gateway:', L + 4, Y + 5);
    doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
    doc.text(paymentUrl, L + 4, Y + 9.5);
    doc.link(L + 4, Y + 6, 52, 4.5, { url: paymentUrl });
    Y += 16;

    // System-generated notice (replaces signature block)
    Y += 2;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(100, 100, 100);
    doc.text('This invoice is system-generated. No signature is required.', L, Y);
    Y += 7;

    // Payment notes
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.2);
    doc.line(L, Y, R, Y);
    Y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(30, 30, 30);
    doc.text('Payment Notes', L, Y);
    Y += 4.5;

    const notes = [
        'Direct Deposit: Available for local (Sri Lanka) attendees only.',
        'Wire Transfer: Payment must be received within 30 days of registration.',
        'Debit/Credit Card: A 1.5% commission will be added to the total.',
        `Refund Policy: Requests must be sent to sicet@sliit.lk by ${refundDeadline}. Admin fee: US$20 / LKR 6,000.`
    ];

    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60, 60, 60);
    notes.forEach((note, i) => {
        const nLines = doc.splitTextToSize(`${i + 1}. ${note}`, W - 2);
        if (Y + (nLines.length * 4) > 278) { doc.addPage(); Y = 14; }
        doc.text(nLines, L, Y);
        Y += (nLines.length * 4) + 1;
    });

    Y += 2;
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(150, 150, 150);
    doc.text('This is a Proforma Invoice — not a tax invoice. Payment confirms registration.', L, Y);

    const safeName = fullName.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'attendee';
    const pdfFileName = `SICET2026_Invoice_${invoiceNum}_${safeName}.pdf`;
    doc.save(pdfFileName);

    // Save registration JSON to Drive so ref ID lookup works (single request, async non-blocking)
    if (APPS_SCRIPT_URL && APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE') {
        (async () => {
            try {
                const dataObj = collectFormData(refId);
                dataObj.Status = 'Pending Payment';
                const studentIdInput = document.getElementById('studentId');
                if (studentIdInput?.files[0]) dataObj['Student_ID_Base64'] = await fileToBase64(studentIdInput.files[0]);
                await fetch(APPS_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: JSON.stringify(dataObj) });
            } catch (_) {}
        })();
    }

    // Reveal Step 2 and scroll to ref ID box
    const step2 = document.getElementById('step2-section');
    if (step2) step2.classList.remove('hidden');
    document.querySelector('.payment-section.mt-4')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`Invoice downloaded! Reference ID: ${refId} — please save this!`, 'success');
}

// ---- DRAFT (AUTO-SAVE) LOGIC ----


function saveDraft() {
    const formData = new FormData(registrationForm);
    const draftData = {};

    for (let [key, value] of formData.entries()) {
        // Skip files
        if (value instanceof File) continue;

        // Handle array variables (like multiple apc checkboxes) properly although we used unique names
        draftData[key] = value;
    }

    // Explicitly grab checkboxes that might be unchecked (FormData omits unchecked boxes)
    const checkboxes = registrationForm.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        draftData[cb.name] = cb.checked;
    });

    localStorage.setItem('sicet2026_draft', JSON.stringify(draftData));
}

function restoreDraft() {
    if (!formDraft) return;

    // 1. Initial Type & Section Load
    const toggles = ['Registering_Main', 'Registering_Award', 'Registering_Excursion', 'Registering_PreConf'];
    toggles.forEach(t => {
        if (formDraft[t] === true) {
            const el = document.querySelector(`[name="${t}"]`);
            if (el) {
                el.checked = true;
                el.dispatchEvent(new Event('change'));
            }
        }
    });

    // 2. Specialized Generative Prep (Must happen BEFORE populating values)
    if (formDraft['Number_of_Papers']) {
        const numPapers = parseInt(formDraft['Number_of_Papers']) || 1;
        document.getElementById('numberOfPapers').value = numPapers;
        generatePaperBlocks(numPapers);
    }

    if (formDraft['Include_Excursion_Main'] === true) {
        const inclExcEl = document.getElementById('includeExcursionMain');
        if (inclExcEl) {
            inclExcEl.checked = true;
            inclExcEl.dispatchEvent(new Event('change'));
        }
    }

    // Restore all apc toggles first so the journal dropdowns appear
    for (const key in formDraft) {
        if (key.includes('Include_APC') && formDraft[key] === true) {
            const el = registrationForm.querySelector(`[name="${key}"]`);
            if (el) {
                el.checked = true;
                el.dispatchEvent(new Event('change'));
            }
        }
    }

    // 3. Populate all standard values
    for (const key in formDraft) {
        if (toggles.includes(key) || key === 'Number_of_Papers' || key.includes('Include_APC')) {
            continue; // Already handled
        }

        // Radio buttons (e.g. Bill_To) — must match by value, not set .value on the element
        const radios = registrationForm.querySelectorAll(`[name="${key}"][type="radio"]`);
        if (radios.length > 0) {
            radios.forEach(r => {
                if (r.value === String(formDraft[key])) { r.checked = true; r.dispatchEvent(new Event('change')); }
            });
            continue;
        }

        const el = registrationForm.querySelector(`[name="${key}"]`);
        if (el) {
            if (el.type === 'checkbox') {
                el.checked = formDraft[key];
                el.dispatchEvent(new Event('change'));
            } else {
                el.value = formDraft[key];
            }
        }
    }

    // 4. Final Calculation Recalc
    calculateTotalFee();
    showToast('Draft restored successfully', 'success');
}

function clearDraft() {
    formDraft = null;
    localStorage.removeItem('sicet2026_draft');
}

// ---- VIEW CONTROLLER ----

function switchView(view) {
    // Reset Navs
    navFormBtn.classList.remove('active');
    navAdminBtn.classList.remove('active');
    navSettingsBtn.classList.remove('active');

    // Reset Sections
    formSection.classList.add('hidden');
    adminSection.classList.add('hidden');
    settingsSection.classList.add('hidden');

    if (view === 'form') {
        navFormBtn.classList.add('active');
        formSection.classList.remove('hidden');
    } else if (view === 'admin') {
        navAdminBtn.classList.add('active');
        adminSection.classList.remove('hidden');
        updateAdminDashboard();
        if (submissions.length === 0) loadFromGoogleDrive();
    } else if (view === 'settings') {
        navSettingsBtn.classList.add('active');
        settingsSection.classList.remove('hidden');
    }
}

function handleAdminLogin() {
    const un = document.getElementById('admin-username').value.trim();
    const pw = document.getElementById('admin-password').value;
    const errEl = document.getElementById('login-error');

    if (un === ADMIN_USERNAME && pw === ADMIN_PASSWORD) {
        adminLoggedIn = true;
        navAdminBtn.style.display = '';
        navAdminBtn.innerHTML = "<i class='bx bx-grid-alt'></i> Dashboard";
        navSettingsBtn.innerHTML = "<i class='bx bx-cog'></i> Settings";
        closeLoginModal();
        switchView(pendingAdminView);
    } else {
        errEl.classList.remove('hidden');
        document.getElementById('admin-password').value = '';
        document.getElementById('admin-password').focus();
    }
}

function closeLoginModal() {
    document.getElementById('admin-login-modal').classList.add('hidden');
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('login-error').classList.add('hidden');
}

// ---- ADMIN DASHBOARD LOGIC ----

function updateAdminDashboard() {
    // ---- Summary Stats ----
    const total      = submissions.length;
    const localCount = submissions.filter(s => s.Attendee_Region === 'Local').length;
    const saarcCount = submissions.filter(s => s.Attendee_Region === 'SAARC').length;
    const nonSaarc   = submissions.filter(s => s.Attendee_Region === 'Non-SAARC').length;
    const mainCount  = submissions.filter(s => s.Registration_Type && s.Registration_Type.includes('Main')).length;
    const awardExc   = submissions.filter(s => s.Registration_Type && (s.Registration_Type.includes('Award') || s.Registration_Type.includes('Excursion'))).length;

    let totalPapers = 0;
    let totalExcPax = 0;
    submissions.forEach(s => {
        totalPapers  += parseInt(s.Number_of_Papers)  || 0;
        totalExcPax  += (parseInt(s.Excursion_Local_Count) || 0) + (parseInt(s.Excursion_Foreign_Count) || 0);
    });

    statTotal.textContent = total;
    statMain.textContent  = mainCount;
    statAward.textContent = awardExc;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-local',         localCount);
    set('stat-saarc',         saarcCount);
    set('stat-nonsaarc',      nonSaarc);
    set('stat-papers',        totalPapers);
    set('stat-excursion-pax', totalExcPax);

    // Last loaded timestamp
    if (total > 0) {
        const now = new Date();
        document.getElementById('dash-last-loaded').innerHTML =
            `<strong>${total}</strong> registration(s) loaded — last refreshed ${now.toLocaleTimeString()}.`;
    }

    // Populate filter dropdowns
    const cats     = [...new Set(submissions.map(s => s.Attendee_Category).filter(Boolean))].sort();
    const statuses = [...new Set(submissions.map(s => s.Status).filter(Boolean))].sort();
    const catSel   = document.getElementById('dash-filter-cat');
    const statSel  = document.getElementById('dash-filter-status');
    if (catSel) {
        const prev = catSel.value;
        catSel.innerHTML = '<option value="">All Categories</option>' +
            cats.map(c => `<option value="${c}" ${c === prev ? 'selected' : ''}>${c}</option>`).join('');
    }
    if (statSel) {
        const prev = statSel.value;
        statSel.innerHTML = '<option value="">All Statuses</option>' +
            statuses.map(s => `<option value="${s}" ${s === prev ? 'selected' : ''}>${s}</option>`).join('');
    }

    renderOverviewTab();
    renderLogisticsTab();
    applyDashFilters(); // renders records tab
}

// ---- Breakdown helper: count occurrences of field values ----
function buildBreakdown(data, keyFn, label = 'Item') {
    const counts = {};
    data.forEach(s => {
        const k = (typeof keyFn === 'function' ? keyFn(s) : s[keyFn]) || '(not set)';
        counts[k] = (counts[k] || 0) + 1;
    });
    const total = data.length || 1;
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return '<p style="color:var(--text-muted);font-size:0.85rem;">No data.</p>';
    return `<table class="dash-breakdown-table"><tbody>` +
        sorted.map(([k, n]) =>
            `<tr>
                <td class="bk-label">${escHtml(k)}</td>
                <td class="bk-count">${n}</td>
                <td class="bk-bar-cell"><div class="dash-bar"><div class="dash-bar-fill" style="width:${Math.round((n/total)*100)}%"></div></div></td>
            </tr>`
        ).join('') +
        `</tbody></table>`;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Overview Tab ----
function renderOverviewTab() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('dash-category-breakdown', buildBreakdown(submissions, 'Attendee_Category'));
    set('dash-region-breakdown',   buildBreakdown(submissions, s => `${s.Attendee_Region || '?'} — ${s.Country || '?'}`));
    set('dash-regtype-breakdown',  buildBreakdown(submissions, 'Registration_Type'));
    set('dash-status-breakdown',   buildBreakdown(submissions, 'Status'));

    // Sessions: parse comma-separated session names stored in Additional_Info or use Registration_Type
    // Sessions are stored as pre-conference inclusions — we count unique session references in any field
    const sessionCounts = {};
    (appSettings.pre_conference_sessions || []).forEach(sess => {
        submissions.forEach(sub => {
            const info = JSON.stringify(sub);
            if (info.includes(sess.name)) {
                sessionCounts[sess.name] = (sessionCounts[sess.name] || 0) + 1;
            }
        });
    });
    const sessEntries = Object.entries(sessionCounts).sort((a,b) => b[1]-a[1]);
    const sessHtml = sessEntries.length === 0
        ? '<p style="color:var(--text-muted);font-size:0.85rem;">No pre-conference session data yet.</p>'
        : `<table class="dash-breakdown-table"><tbody>` +
          sessEntries.map(([n, c]) =>
            `<tr><td class="bk-label">${escHtml(n)}</td><td class="bk-count">${c} attendees</td>
             <td class="bk-bar-cell"><div class="dash-bar"><div class="dash-bar-fill" style="width:${Math.round((c/submissions.length)*100)}%"></div></div></td></tr>`
          ).join('') + `</tbody></table>`;
    set('dash-sessions-breakdown', sessHtml);
}

// ---- Logistics Tab ----
function renderLogisticsTab() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

    // Food
    set('dash-food-breakdown', buildBreakdown(submissions, 'Food_Preference'));

    // Excursion
    let excLocal = 0, excForeign = 0;
    const mobilityMap = {}, activityMap = {};
    submissions.forEach(s => {
        excLocal   += parseInt(s.Excursion_Local_Count)   || 0;
        excForeign += parseInt(s.Excursion_Foreign_Count) || 0;
        if (s.Excursion_Mobility && s.Excursion_Mobility !== '0' && s.Excursion_Mobility !== '') {
            mobilityMap[s.Excursion_Mobility] = (mobilityMap[s.Excursion_Mobility] || 0) + 1;
        }
        if (s.Excursion_Activity && s.Excursion_Activity !== '0' && s.Excursion_Activity !== '') {
            activityMap[s.Excursion_Activity] = (activityMap[s.Excursion_Activity] || 0) + 1;
        }
    });
    const excHtml = logRow('Local Excursion Pax', excLocal) +
        logRow('Foreign Excursion Pax', excForeign) +
        logRow('Total Excursion Pax', excLocal + excForeign) +
        (Object.keys(mobilityMap).length ?
            '<div style="margin-top:10px;margin-bottom:4px;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Mobility Needs</div>' +
            Object.entries(mobilityMap).map(([k,v]) => logRow(k, v)).join('') : '') +
        (Object.keys(activityMap).length ?
            '<div style="margin-top:10px;margin-bottom:4px;font-size:0.75rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Activity Preference</div>' +
            Object.entries(activityMap).map(([k,v]) => logRow(k, v)).join('') : '');
    set('dash-excursion-breakdown', excHtml || '<p style="color:var(--text-muted);font-size:0.85rem;">No excursion registrations.</p>');

    // Inauguration
    const inaugYes = submissions.filter(s => s.Include_Inauguration === true || s.Include_Inauguration === 'true' || s.Include_Inauguration === 'Yes').length;
    const inaugNo  = submissions.length - inaugYes;
    set('dash-inauguration-breakdown',
        logRow('Opted In', inaugYes) +
        logRow('Not Included', inaugNo));

    // Countries
    set('dash-countries-breakdown', buildBreakdown(submissions, 'Country'));

    // Revenue
    let revLKR = 0, revUSD = 0;
    submissions.forEach(s => {
        const fee = parseFloat(s.Calculated_Total_Fee) || 0;
        if (s.Currency === 'LKR') revLKR += fee;
        else if (s.Currency === 'USD') revUSD += fee;
    });
    const rate = appSettings.usd_to_lkr || 320;
    const revHtml =
        logRow('Total Revenue (LKR)', 'LKR ' + revLKR.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})) +
        logRow('Total Revenue (USD)', 'USD ' + revUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})) +
        logRow('Combined Estimate (LKR)', 'LKR ' + (revLKR + revUSD * rate).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}));
    set('dash-revenue-breakdown', revHtml);
}

function logRow(label, value) {
    return `<div class="logistics-row"><span class="lr-label">${escHtml(String(label))}</span><span class="lr-value">${escHtml(String(value))}</span></div>`;
}

// ---- Records Tab with search + filter ----
function applyDashFilters() {
    const search    = (document.getElementById('dash-search')?.value || '').toLowerCase();
    const catFilter = document.getElementById('dash-filter-cat')?.value || '';
    const regFilter = document.getElementById('dash-filter-region')?.value || '';
    const statFilter= document.getElementById('dash-filter-status')?.value || '';

    dashFilteredRows = submissions.filter(s => {
        if (catFilter  && s.Attendee_Category !== catFilter)  return false;
        if (regFilter  && s.Attendee_Region   !== regFilter)  return false;
        if (statFilter && s.Status            !== statFilter) return false;
        if (search) {
            const blob = [s.Full_Name, s.Email, s.Invoice_ID, s.Organization,
                          s.Country, s.Phone, s.Transaction_Ref].join(' ').toLowerCase();
            if (!blob.includes(search)) return false;
        }
        return true;
    });

    const countEl = document.getElementById('dash-record-count');
    if (countEl) countEl.textContent = dashFilteredRows.length + ' of ' + submissions.length + ' record(s)';

    renderRecordsTable(dashFilteredRows);
}

function renderRecordsTable(rows) {
    tableBody.innerHTML = '';
    if (submissions.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="13">Click <strong>Refresh from Drive</strong> to load registrations.</td></tr>';
        return;
    }
    if (rows.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="13">No registrations match your filter.</td></tr>';
        return;
    }

    const sorted = [...rows].reverse();
    sorted.forEach((sub, i) => {
        const tr = document.createElement('tr');
        tr.className = 'clickable-row';
        const papers = parseInt(sub.Number_of_Papers) || 0;
        const fee    = parseFloat(sub.Calculated_Total_Fee) || 0;
        const dateStr = sub.Submission_Date ? String(sub.Submission_Date).split(',')[0].split('T')[0] : '—';
        tr.innerHTML = `
            <td style="color:var(--text-muted);font-size:0.8rem;">${sorted.length - i}</td>
            <td style="white-space:nowrap;font-size:0.82rem;">${escHtml(dateStr)}</td>
            <td style="font-size:0.78rem;color:var(--accent);font-family:monospace;">${escHtml(sub.Invoice_ID || '—')}</td>
            <td><strong>${escHtml((sub.Title ? sub.Title + ' ' : '') + (sub.Full_Name || ''))}</strong><br><small style="color:var(--text-muted);">${escHtml(sub.Organization || '')}</small></td>
            <td style="font-size:0.82rem;">${escHtml(sub.Email || '—')}</td>
            <td><span class="badge ${getCatBadge(sub.Attendee_Category)}">${escHtml(sub.Attendee_Category || 'N/A')}</span></td>
            <td style="font-size:0.82rem;">${escHtml(sub.Attendee_Region || '—')}</td>
            <td style="font-size:0.82rem;">${escHtml(sub.Country || '—')}</td>
            <td><span class="badge ${getRegTypeBadge(sub.Registration_Type)}" style="font-size:0.72rem;">${escHtml(sub.Registration_Type || 'N/A')}</span></td>
            <td style="text-align:center;">${papers > 0 ? papers : '—'}</td>
            <td style="white-space:nowrap;font-size:0.82rem;">${fee > 0 ? escHtml(sub.Currency || '') + ' ' + fee.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
            <td><span class="badge ${getStatusBadge(sub.Status)}">${escHtml(sub.Status || 'Submitted')}</span></td>
            <td><button class="btn-detail">View</button></td>
        `;
        tr.querySelector('.btn-detail').addEventListener('click', (e) => {
            e.stopPropagation();
            openRecordModal(sub);
        });
        tr.addEventListener('click', () => openRecordModal(sub));
        tableBody.appendChild(tr);
    });
}

function getCatBadge(cat) {
    if (!cat) return 'badge-default';
    const c = cat.toLowerCase();
    if (c.includes('author') && !c.includes('non')) return 'badge-main';
    if (c.includes('student')) return 'badge-ok';
    return 'badge-default';
}

function getRegTypeBadge(type) {
    if (!type) return 'badge-default';
    if (type.includes('Main') && type.includes('Award') || type.includes('Main') && type.includes('Excursion')) return 'badge-multi';
    if (type.includes('Main')) return 'badge-main';
    if (type.includes('Award')) return 'badge-award';
    if (type.includes('Excursion')) return 'badge-excursion';
    return 'badge-default';
}

function getStatusBadge(s) {
    if (!s) return 'badge-pending';
    const l = s.toLowerCase();
    if (l.includes('confirm') || l.includes('paid') || l.includes('approv')) return 'badge-ok';
    if (l.includes('pending') || l.includes('submit')) return 'badge-pending';
    return 'badge-default';
}

// ---- Record Detail Modal ----
function openRecordModal(sub) {
    document.getElementById('record-modal-title').textContent =
        (sub.Title ? sub.Title + ' ' : '') + (sub.Full_Name || 'Registration') + ' — ' + (sub.Invoice_ID || '');

    const sections = [
        {
            title: 'Personal Information',
            fields: [
                ['Title',             sub.Title],
                ['Full Name',         sub.Full_Name],
                ['Certificate Name',  sub.Certificate_Name],
                ['Email',             sub.Email],
                ['Phone',             sub.Phone],
                ['Designation',       sub.Designation],
                ['Organization',      sub.Organization],
            ]
        },
        {
            title: 'Registration Details',
            fields: [
                ['Reference ID',       sub.Invoice_ID],
                ['Submission Date',    sub.Submission_Date],
                ['Status',             sub.Status],
                ['Attendee Category',  sub.Attendee_Category],
                ['Region',             sub.Attendee_Region],
                ['Country',            sub.Country],
                ['Registration Type',  sub.Registration_Type],
                ['Primary Reason',     sub.Primary_Reason + (sub.Primary_Reason_Other ? ' — ' + sub.Primary_Reason_Other : '')],
            ]
        },
        {
            title: 'Financial',
            fields: [
                ['Total Fee',          sub.Calculated_Total_Fee ? (sub.Currency + ' ' + parseFloat(sub.Calculated_Total_Fee).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})) : null],
                ['Currency',           sub.Currency],
                ['Transaction Ref',    sub.Transaction_Ref],
                ['Drive Folder',       sub.Drive_Folder_URL ? `<a href="${escHtml(sub.Drive_Folder_URL)}" target="_blank" rel="noopener">Open in Drive</a>` : null],
            ]
        },
        {
            title: 'Academic / Papers',
            fields: [
                ['Number of Papers',   sub.Number_of_Papers],
                ['Food Preference',    sub.Food_Preference],
                ['Include Inauguration', sub.Include_Inauguration],
            ]
        },
        {
            title: 'Award Details',
            fields: [
                ['Company / Org Name', sub.Company_Name],
                ['Participant Count',  sub.Participant_Count],
                ['Award Category',     sub.Award_Category],
            ]
        },
        {
            title: 'Excursion Details',
            fields: [
                ['Local Pax',          sub.Excursion_Local_Count],
                ['Foreign Pax',        sub.Excursion_Foreign_Count],
                ['Mobility Needs',     sub.Excursion_Mobility],
                ['Activity Preference',sub.Excursion_Activity],
            ]
        },
        {
            title: 'Additional Info',
            fields: [
                ['Notes', sub.Additional_Info],
            ]
        },
    ];

    const html = sections.map(sec => {
        const filledFields = sec.fields.filter(([, v]) => v !== null && v !== undefined && v !== '');
        if (filledFields.length === 0) return '';
        return `<div class="record-section">
            <div class="record-section-title">${escHtml(sec.title)}</div>
            <div class="record-fields">
                ${filledFields.map(([label, val]) =>
                    `<div class="record-field">
                        <div class="rf-label">${escHtml(label)}</div>
                        <div class="rf-value">${val || '<span class="rf-empty">—</span>'}</div>
                    </div>`
                ).join('')}
            </div>
        </div>`;
    }).join('');

    document.getElementById('record-modal-body').innerHTML = html || '<p style="color:var(--text-muted);">No details available.</p>';
    document.getElementById('record-detail-modal').classList.remove('hidden');
}

function exportToExcel() {
    if (submissions.length === 0) {
        showToast('No data to export!', 'error');
        return;
    }
    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(submissions);
        // Column widths
        ws['!cols'] = [
            {wch:22},{wch:25},{wch:12},{wch:12},{wch:30},{wch:32},{wch:18},{wch:18},
            {wch:18},{wch:10},{wch:15},{wch:12},{wch:20},{wch:10},{wch:25},{wch:20},
            {wch:18},{wch:10},{wch:10},{wch:25},{wch:12},{wch:18},{wch:20},{wch:20},
            {wch:12},{wch:14},{wch:20},{wch:20},{wch:20},{wch:35},{wch:40}
        ];
        XLSX.utils.book_append_sheet(wb, ws, 'Registrations');
        XLSX.writeFile(wb, 'SICET_2026_Registrations.xlsx');
        showToast('Exported ' + submissions.length + ' records to Excel.', 'success');
    } catch (err) {
        console.error('Export error:', err);
        showToast('Error exporting data. Please try again.', 'error');
    }
}


// ---- ADMIN SETTINGS LOGIC ----

function populateSettingsForm() {
    document.getElementById('fee_conf_student_discount').value = appSettings.discounts.student_from_2nd;
    document.getElementById('fee_discount_max_papers').value = appSettings.discounts.discount_max_papers || 0;

    // Awards & Excursion
    document.getElementById('fee_award_base').value = appSettings.award_fee;
    document.getElementById('fee_inauguration').value = appSettings.inauguration_fee || 0;
    document.getElementById('fee_inauguration_usd').value = appSettings.inauguration_fee_usd || 0;
    document.getElementById('fee_excursion_local').value = appSettings.excursion_fees.local;
    document.getElementById('fee_excursion_foreigner').value = appSettings.excursion_fees.foreigner;

    // Invoice / Chair & Refund
    document.getElementById('setting_chair_name').value = appSettings.chair_name || '';
    document.getElementById('setting_refund_deadline').value = appSettings.refund_deadline || 'August 23, 2025';
    document.getElementById('setting_usd_rate').value = appSettings.usd_to_lkr || 320;

    const refundNotice = document.getElementById('notice-refund-deadline');
    if (refundNotice) refundNotice.textContent = appSettings.refund_deadline || 'August 23, 2025';

    // APC collection active
    const apcActiveEl = document.getElementById('setting_apc_active');
    if (apcActiveEl) apcActiveEl.checked = appSettings.apc_collection_active || false;

    // Journals
    renderJournalsAdmin();
    // Categories & Sessions
    renderCategoriesAdmin();
    renderSessionsAdmin();
    // Award & Excursion options
    renderAwardOptionsAdmin();
    renderExcursionOptionsAdmin();
}

function renderJournalsAdmin() {
    const list = document.getElementById('journals-list');
    list.innerHTML = '';

    appSettings.journals.forEach((j, index) => {
        const div = document.createElement('div');
        div.className = 'journal-entry form-group row';
        div.innerHTML = `
            <div class="input-field col">
                <label>Journal Name</label>
                <input type="text" class="journal-name" value="${j.name}" required>
            </div>
            <div class="input-field col">
                <label>Fee (USD)</label>
                <input type="number" class="journal-fee" value="${j.fee}" required>
            </div>
            <button type="button" class="btn-remove-journal" onclick="removeJournal(${index})"><i class='bx bx-trash'></i></button>
        `;
        list.appendChild(div);
    });
}

function addJournalField() {
    appSettings.journals.push({ id: 'j' + Date.now(), name: '', fee: 0 });
    renderJournalsAdmin();
}

// Make globally accessible for inline onclick
window.removeJournal = function (index) {
    appSettings.journals.splice(index, 1);
    renderJournalsAdmin();
};

function saveSettings(e) {
    e.preventDefault();

    appSettings.discounts.student_from_2nd  = Number(document.getElementById('fee_conf_student_discount').value);
    appSettings.discounts.discount_max_papers = Number(document.getElementById('fee_discount_max_papers').value) || 0;

    appSettings.award_fee = Number(document.getElementById('fee_award_base').value);
    appSettings.inauguration_fee = Number(document.getElementById('fee_inauguration').value) || 0;
    appSettings.inauguration_fee_usd = Number(document.getElementById('fee_inauguration_usd').value) || 0;
    const apcActiveEl = document.getElementById('setting_apc_active');
    appSettings.apc_collection_active = apcActiveEl ? apcActiveEl.checked : false;
    appSettings.excursion_fees.local = Number(document.getElementById('fee_excursion_local').value);
    appSettings.excursion_fees.foreigner = Number(document.getElementById('fee_excursion_foreigner').value);

    // Invoice / Chair & Refund
    appSettings.chair_name = document.getElementById('setting_chair_name').value.trim() || '[Name]';
    appSettings.refund_deadline = document.getElementById('setting_refund_deadline').value.trim() || 'August 23, 2025';
    appSettings.usd_to_lkr = Number(document.getElementById('setting_usd_rate').value) || 320;

    const refundNotice = document.getElementById('notice-refund-deadline');
    if (refundNotice) refundNotice.textContent = appSettings.refund_deadline;

    // Save Journals
    const jNames = document.querySelectorAll('.journal-name');
    const jFees = document.querySelectorAll('.journal-fee');
    const newJournals = [];

    for (let i = 0; i < jNames.length; i++) {
        if (jNames[i].value.trim() !== '') {
            newJournals.push({
                id: 'j' + Math.random().toString(36).substr(2, 9),
                name: jNames[i].value,
                fee: Number(jFees[i].value)
            });
        }
    }
    appSettings.journals = newJournals;

    // Categories
    saveCategoriesFromAdmin();
    // Sessions
    saveSessionsFromAdmin();
    // Award & Excursion dropdown options
    saveAwardOptionsFromAdmin();
    saveExcursionOptionsFromAdmin();

    // Persist locally
    localStorage.setItem('sicet2026_settings', JSON.stringify(appSettings));

    // Persist to Google Drive (async, non-blocking)
    pushSettingsToDrive();

    // Re-populate globals
    populateJournalsDropdown();
    rebuildAwardCategoryDropdown();
    rebuildAwardPurposeDropdown();
    rebuildExcursionMobilityDropdown();
    rebuildExcursionActivityDropdown();
    // Regenerate paper blocks so Paper ID visibility reflects the current APC collection state
    generatePaperBlocks(parseInt(document.getElementById('numberOfPapers')?.value) || 1);
    updateCostPreviews();
    showToast('Settings saved — syncing to Google Drive…', 'success');
}

function populateJournalsDropdown() {
    const journalSelect = document.getElementById('journalCategory');
    if (!journalSelect) return;

    journalSelect.innerHTML = '<option value="" disabled selected>Select Journal</option>';

    appSettings.journals.forEach(j => {
        const opt = document.createElement('option');
        opt.value = j.name;
        opt.dataset.fee = j.fee;
        opt.textContent = `${j.name} ($${j.fee})`;
        journalSelect.appendChild(opt);
    });
}

// Utilities
function showToast(message, type) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        document.body.appendChild(toast);
    }
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'bx-check-circle' : 'bx-error-circle';
    toast.innerHTML = `<i class='bx ${icon}'></i><span>${message}</span>`;

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Utility: Debounce for Auto-Save
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Badge + submit state CSS injected
const style = document.createElement('style');
style.innerHTML = `
    .badge {
        padding: 0.3rem 0.6rem;
        border-radius: 4px;
        font-size: 0.85rem;
        font-weight: 500;
        background: rgba(255,255,255,0.1);
    }
    .badge-main { color: #4a68ff; background: rgba(74, 104, 255, 0.15); }
    .badge-apc { color: #00e5ff; background: rgba(0, 229, 255, 0.15); }
    .badge-award { color: #e62e6b; background: rgba(230, 46, 107, 0.15); }
    .badge-excursion { color: #20c997; background: rgba(32, 201, 151, 0.15); }
    #btn-submit.btn-blocked {
        opacity: 0.55;
        cursor: not-allowed;
        filter: grayscale(30%);
    }
`;
document.head.appendChild(style);

// ---- GOOGLE DRIVE HELPERS ----

async function fileToBase64(file) {
    if (!file || file.size === 0) return null;
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve({
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            data: ev.target.result.split(',')[1]
        });
        reader.readAsDataURL(file);
    });
}

async function submitToGoogleDrive(dataObj) {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
        showToast('Google Drive not configured. Ask the admin to deploy the Apps Script first.', 'error');
        return false;
    }
    try {
        // Use no-cors so the browser does not block the request due to CORS preflight.
        // The data is safely received by the Apps Script even though we cannot read the response.
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(dataObj)
        });
        return true;
    } catch (err) {
        showToast('Network error — please check your connection and try again.', 'error');
        console.error('Drive submission error:', err);
        return false;
    }
}

async function loadFromGoogleDrive() {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
        showToast('Google Drive not configured.', 'error');
        return;
    }
    const btn = document.getElementById('btn-clear');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Loading…'; }

    try {
        const url = APPS_SCRIPT_URL + '?action=getSubmissions&key=' + encodeURIComponent(ADMIN_KEY);
        const res = await fetch(url);
        const result = await res.json();

        if (result.success) {
            submissions = result.submissions || [];
            updateAdminDashboard();
            showToast('Loaded ' + submissions.length + ' registration(s) from Google Drive', 'success');
        } else {
            showToast('Drive error: ' + (result.error || 'Unauthorized or not found'), 'error');
        }
    } catch (err) {
        showToast('Could not connect to Google Drive. Check Apps Script URL.', 'error');
        console.error('Drive load error:', err);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bx bx-refresh"></i> Refresh from Drive'; }
    }
}

// ---- SUBMIT BUTTON STATE ----

function updateSubmitButtonState() {
    const submitBtn = document.getElementById('btn-submit');
    const submitNote = document.getElementById('submit-payment-note');
    const hasProof = document.getElementById('paymentProof').files.length > 0;

    if (hasProof) {
        submitBtn.classList.remove('btn-blocked');
        if (submitNote) submitNote.style.display = 'none';
    } else {
        submitBtn.classList.add('btn-blocked');
        if (submitNote) submitNote.style.display = 'block';
    }
}

// ---- REFERENCE ID HELPERS ----

function showRefId(refId) {
    const el = document.getElementById('reg-ref-id');
    if (el) el.textContent = refId;
    const btn = document.getElementById('btn-copy-ref');
    if (btn) btn.style.display = '';
    const hint = document.getElementById('ref-id-hint');
    if (hint) hint.textContent = 'Save this ID — you need it to reload your registration or make payment.';
}

function copyRefId() {
    const refId = document.getElementById('reg-ref-id')?.textContent?.trim();
    if (!refId || refId === '—') return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(refId).then(() => showToast('Reference ID copied!', 'success')).catch(() => fallbackCopy(refId));
    } else {
        fallbackCopy(refId);
    }
}

function fallbackCopy(text) {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); showToast('Reference ID copied!', 'success'); } catch (_) {}
    document.body.removeChild(el);
}

// ---- INAUGURATION HELPERS ----
function showInauguration() {
    const s = document.getElementById('inauguration-section');
    const hasInaugFee = (appSettings.inauguration_fee > 0) || ((appSettings.inauguration_fee_usd || 0) > 0);
    if (s && hasInaugFee) s.classList.remove('hidden');
}
function hideInauguration() {
    const s = document.getElementById('inauguration-section');
    if (s) {
        s.classList.add('hidden');
        const chk = document.getElementById('includeInauguration');
        if (chk) chk.checked = false;
    }
}

// ---- FLEXIBLE CATEGORIES SETTINGS ----
function renderCategoriesAdmin() {
    const list = document.getElementById('categories-list');
    if (!list) return;
    list.innerHTML = '';
    (appSettings.categories || []).forEach((cat, idx) => {
        const div = document.createElement('div');
        div.className = 'category-entry form-group';
        div.style.cssText = 'display:grid;grid-template-columns:1fr 100px 100px 100px auto 36px;gap:8px;align-items:end;margin-bottom:8px;';
        div.innerHTML = `
            <div class="input-field"><label>Label</label><input type="text" class="cat-label" value="${cat.label}" required></div>
            <div class="input-field"><label>Local (LKR)</label><input type="number" class="cat-fee-local" value="${cat.fee_local}" required></div>
            <div class="input-field"><label>SAARC (USD)</label><input type="number" class="cat-fee-saarc" value="${cat.fee_saarc}" required></div>
            <div class="input-field"><label>Non-SAARC (USD)</label><input type="number" class="cat-fee-nonsaarc" value="${cat.fee_nonsaarc}" required></div>
            <div style="display:flex;flex-direction:column;gap:4px;justify-content:flex-end;padding-bottom:4px;">
                <label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;white-space:nowrap;">
                    <input type="checkbox" class="cat-is-student" ${cat.is_student ? 'checked' : ''}> Student type
                </label>
                <label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;white-space:nowrap;">
                    <input type="checkbox" class="cat-no-papers" ${cat.no_papers ? 'checked' : ''}> No papers
                </label>
                <label style="display:flex;align-items:center;gap:5px;font-size:0.8rem;cursor:pointer;white-space:nowrap;" title="Eligible for multi-paper submission discount">
                    <input type="checkbox" class="cat-paper-discount" ${cat.paper_discount ? 'checked' : ''}> Paper discount
                </label>
            </div>
            <button type="button" class="btn-remove-journal" onclick="removeCategory(${idx})" title="Remove"><i class='bx bx-trash'></i></button>
        `;
        list.appendChild(div);
    });
}

window.removeCategory = function(idx) {
    appSettings.categories.splice(idx, 1);
    renderCategoriesAdmin();
    rebuildCategoryDropdown();
};

function addCategoryField() {
    if (!appSettings.categories) appSettings.categories = [];
    appSettings.categories.push({ id: 'cat_' + Date.now(), label: '', fee_local: 0, fee_saarc: 0, fee_nonsaarc: 0 });
    renderCategoriesAdmin();
}

function saveCategoriesFromAdmin() {
    const labels        = document.querySelectorAll('#categories-list .cat-label');
    const locals        = document.querySelectorAll('#categories-list .cat-fee-local');
    const saarcs        = document.querySelectorAll('#categories-list .cat-fee-saarc');
    const nsaarcs       = document.querySelectorAll('#categories-list .cat-fee-nonsaarc');
    const isStudents    = document.querySelectorAll('#categories-list .cat-is-student');
    const nopapers      = document.querySelectorAll('#categories-list .cat-no-papers');
    const paperDiscounts = document.querySelectorAll('#categories-list .cat-paper-discount');
    const cats = [];
    for (let i = 0; i < labels.length; i++) {
        if (labels[i].value.trim()) {
            cats.push({
                id:             appSettings.categories[i]?.id || 'cat_' + Date.now() + i,
                label:          labels[i].value.trim(),
                fee_local:      Number(locals[i].value)  || 0,
                fee_saarc:      Number(saarcs[i].value)  || 0,
                fee_nonsaarc:   Number(nsaarcs[i].value) || 0,
                is_student:     isStudents[i]?.checked    || false,
                no_papers:      nopapers[i]?.checked      || false,
                paper_discount: paperDiscounts[i]?.checked || false
            });
        }
    }
    appSettings.categories = cats;
    rebuildCategoryDropdown();
}

function rebuildCategoryDropdown() {
    const sel = document.getElementById('attendeeCategory');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select Category</option>';
    (appSettings.categories || []).forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat.label;
        opt.textContent = cat.label;
        if (cat.label === cur) opt.selected = true;
        sel.appendChild(opt);
    });
}

// ---- PRE-CONFERENCE SESSIONS SETTINGS ----
function renderSessionsAdmin() {
    const list = document.getElementById('sessions-list');
    if (!list) return;
    list.innerHTML = '';
    (appSettings.pre_conference_sessions || []).forEach((sess, idx) => {
        const div = document.createElement('div');
        div.className = 'session-entry form-group';
        div.style.cssText = 'display:grid;grid-template-columns:2fr 100px 100px 100px 36px;gap:8px;align-items:end;margin-bottom:8px;';
        div.innerHTML = `
            <div class="input-field"><label>Session Name</label><input type="text" class="sess-name" value="${sess.name}" required></div>
            <div class="input-field"><label>Local (LKR)</label><input type="number" class="sess-fee-local" value="${sess.fee_local}" required></div>
            <div class="input-field"><label>SAARC (USD)</label><input type="number" class="sess-fee-saarc" value="${sess.fee_saarc}" required></div>
            <div class="input-field"><label>Non-SAARC (USD)</label><input type="number" class="sess-fee-nonsaarc" value="${sess.fee_nonsaarc}" required></div>
            <button type="button" class="btn-remove-journal" onclick="removeSession(${idx})" title="Remove"><i class='bx bx-trash'></i></button>
        `;
        list.appendChild(div);
    });
}

window.removeSession = function(idx) {
    appSettings.pre_conference_sessions.splice(idx, 1);
    renderSessionsAdmin();
    rebuildSessionCheckboxes();
};

function addSessionField() {
    if (!appSettings.pre_conference_sessions) appSettings.pre_conference_sessions = [];
    appSettings.pre_conference_sessions.push({ id: 'sess_' + Date.now(), name: '', fee_local: 0, fee_saarc: 0, fee_nonsaarc: 0 });
    renderSessionsAdmin();
}

function saveSessionsFromAdmin() {
    const names  = document.querySelectorAll('#sessions-list .sess-name');
    const locals  = document.querySelectorAll('#sessions-list .sess-fee-local');
    const saarcs  = document.querySelectorAll('#sessions-list .sess-fee-saarc');
    const nsaarcs = document.querySelectorAll('#sessions-list .sess-fee-nonsaarc');
    const sessions = [];
    for (let i = 0; i < names.length; i++) {
        if (names[i].value.trim()) {
            sessions.push({
                id: appSettings.pre_conference_sessions[i]?.id || 'sess_' + Date.now() + i,
                name: names[i].value.trim(),
                fee_local:    Number(locals[i].value)  || 0,
                fee_saarc:    Number(saarcs[i].value)  || 0,
                fee_nonsaarc: Number(nsaarcs[i].value) || 0
            });
        }
    }
    appSettings.pre_conference_sessions = sessions;
    rebuildSessionCheckboxes();
}

function rebuildSessionCheckboxes() {
    const container = document.getElementById('preconf-sessions-container');
    if (!container) return;
    const sessions = appSettings.pre_conference_sessions || [];
    if (sessions.length === 0) {
        container.innerHTML = '';
        container.closest('#preconf-sessions-section')?.classList.add('hidden');
        document.getElementById('section-preconf-sessions')?.classList.add('hidden');
        return;
    }
    container.closest('#preconf-sessions-section')?.classList.remove('hidden');
    container.innerHTML = '';
    sessions.forEach(sess => {
        const div = document.createElement('div');
        div.className = 'form-checkbox mb-2';
        div.innerHTML = `
            <input type="checkbox" id="sess_${sess.id}" name="PreConf_${sess.id}" class="preconf-session-check price-trigger" data-sess-id="${sess.id}">
            <label for="sess_${sess.id}">${sess.name}</label>
        `;
        container.appendChild(div);
    });
    // Re-attach price-trigger listeners
    container.querySelectorAll('.price-trigger').forEach(el => {
        el.addEventListener('change', calculateTotalFee);
    });
}

// ---- AWARD & EXCURSION DROPDOWN REBUILDERS ----

function rebuildAwardCategoryDropdown() {
    const sel = document.getElementById('awardCategory');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select Category</option>';
    (appSettings.award_categories || []).forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        if (cat === cur) opt.selected = true;
        sel.appendChild(opt);
    });
}

function rebuildAwardPurposeDropdown() {
    const sel = document.getElementById('primaryReason');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="" disabled selected>Select Purpose</option>';
    (appSettings.award_purposes || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        if (p === cur) opt.selected = true;
        sel.appendChild(opt);
    });
}

function rebuildExcursionMobilityDropdown() {
    const sel = document.getElementById('excrMobility');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    (appSettings.excursion_mobility_options || []).forEach((opt, i) => {
        const el = document.createElement('option');
        el.value = opt; el.textContent = opt;
        if (opt === cur || (i === 0 && !cur)) el.selected = true;
        sel.appendChild(el);
    });
}

function rebuildExcursionActivityDropdown() {
    const sel = document.getElementById('excrShopping');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '';
    (appSettings.excursion_activity_options || []).forEach((opt, i) => {
        const el = document.createElement('option');
        el.value = opt; el.textContent = opt;
        if (opt === cur || (i === 0 && !cur)) el.selected = true;
        sel.appendChild(el);
    });
}

// ---- AWARD & EXCURSION ADMIN SETTINGS ----

function _renderSimpleList(listId, items, cssClass) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = '';
    items.forEach((item, idx) => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
        div.innerHTML = `
            <input type="text" class="${cssClass}" value="${item.replace(/"/g, '&quot;')}" style="flex:1;padding:7px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-light);font-size:0.88rem;">
            <button type="button" class="btn-remove-journal" onclick="removeSimpleListItem('${listId}','${cssClass}',${idx})"><i class='bx bx-trash'></i></button>
        `;
        list.appendChild(div);
    });
}

window.removeSimpleListItem = function(listId, cssClass, idx) {
    const list = document.getElementById(listId);
    if (!list) return;
    const items = [...list.querySelectorAll('.' + cssClass)].map(i => i.value.trim()).filter(Boolean);
    items.splice(idx, 1);
    list.innerHTML = '';
    items.forEach((item, i) => {
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
        div.innerHTML = `
            <input type="text" class="${cssClass}" value="${item.replace(/"/g, '&quot;')}" style="flex:1;padding:7px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-light);font-size:0.88rem;">
            <button type="button" class="btn-remove-journal" onclick="removeSimpleListItem('${listId}','${cssClass}',${i})"><i class='bx bx-trash'></i></button>
        `;
        list.appendChild(div);
    });
};

window.addSimpleListItem = function(listId, cssClass) {
    const list = document.getElementById(listId);
    if (!list) return;
    const count = list.querySelectorAll('.' + cssClass).length;
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
    div.innerHTML = `
        <input type="text" class="${cssClass}" value="" style="flex:1;padding:7px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-light);font-size:0.88rem;" placeholder="Enter option">
        <button type="button" class="btn-remove-journal" onclick="removeSimpleListItem('${listId}','${cssClass}',${count})"><i class='bx bx-trash'></i></button>
    `;
    list.appendChild(div);
};

function renderAwardOptionsAdmin() {
    _renderSimpleList('award-categories-list', appSettings.award_categories || [], 'award-category-item');
    _renderSimpleList('award-purposes-list',   appSettings.award_purposes   || [], 'award-purpose-item');
}

function renderExcursionOptionsAdmin() {
    _renderSimpleList('excursion-mobility-list', appSettings.excursion_mobility_options || [], 'mobility-item');
    _renderSimpleList('excursion-activity-list', appSettings.excursion_activity_options || [], 'activity-item');
}

function saveAwardOptionsFromAdmin() {
    const cats  = document.querySelectorAll('#award-categories-list .award-category-item');
    const purps = document.querySelectorAll('#award-purposes-list .award-purpose-item');
    appSettings.award_categories = [...cats].map(i => i.value.trim()).filter(Boolean);
    appSettings.award_purposes   = [...purps].map(i => i.value.trim()).filter(Boolean);
}

function saveExcursionOptionsFromAdmin() {
    const mob = document.querySelectorAll('#excursion-mobility-list .mobility-item');
    const act = document.querySelectorAll('#excursion-activity-list .activity-item');
    appSettings.excursion_mobility_options = [...mob].map(i => i.value.trim()).filter(Boolean);
    appSettings.excursion_activity_options = [...act].map(i => i.value.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Settings resolution — Google Drive is the single source of truth
// ---------------------------------------------------------------------------

/**
 * Merge stored settings onto a fresh copy of defaultSettings.
 * - defaultSettings provides the complete schema; any new field added to
 *   defaultSettings will automatically appear in the merged output even if
 *   the stored version pre-dates it.
 * - Stored values win for every key that exists in both (Drive/localStorage
 *   values are never silently discarded).
 * - Arrays are taken whole from the stored version (we don't try to merge
 *   array contents), except for categories[] where per-item flags are
 *   filled-in individually for backward compatibility.
 * - Plain nested objects (discounts, conf_fees, excursion_fees …) are
 *   merged one level deep so new sub-keys get their default value.
 */
function mergeWithDefaults(stored) {
    const base = JSON.parse(JSON.stringify(defaultSettings)); // fresh schema
    if (!stored || typeof stored !== 'object') return base;

    for (const key of Object.keys(stored)) {
        if (key === 'categories') {
            // Per-item flag migration: fill missing flags without losing stored fees/labels
            base.categories = (stored.categories || []).map(cat => ({
                is_student:     false,
                no_papers:      false,
                paper_discount: false,
                ...cat,
                paper_discount: 'paper_discount' in cat ? cat.paper_discount : (cat.is_student || false)
            }));
        } else if (
            typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key]) &&
            typeof stored[key] === 'object' && stored[key] !== null && !Array.isArray(stored[key])
        ) {
            // Nested plain object — shallow merge so new sub-keys get defaults
            base[key] = { ...base[key], ...stored[key] };
        } else {
            base[key] = stored[key];
        }
    }
    return base;
}

/**
 * Resolve the authoritative settings before the UI renders.
 * Priority: Google Drive → localStorage fallback (network failure only).
 * On first run (no Drive file yet) pushes defaultSettings to Drive.
 * If the Drive file is outdated (missing new fields) the merged version
 * is pushed back automatically so Drive stays up to date.
 */
async function resolveSettings() {
    const overlay = document.getElementById('settings-loading-overlay');

    if (APPS_SCRIPT_URL && APPS_SCRIPT_URL !== 'YOUR_APPS_SCRIPT_URL_HERE') {
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), 8000);
            const resp = await fetch(APPS_SCRIPT_URL + '?action=getSettings', {
                cache: 'no-store',
                signal: controller.signal
            });
            clearTimeout(tid);

            if (resp.ok) {
                const json = await resp.json();

                if (json.success && json.settings) {
                    // Merge Drive settings with current defaultSettings schema
                    const merged    = mergeWithDefaults(json.settings);
                    const mergedStr = JSON.stringify(merged);
                    appSettings = merged;
                    localStorage.setItem('sicet2026_settings', mergedStr);
                    // If merge upgraded the schema, push the enriched version back to Drive
                    if (mergedStr !== JSON.stringify(json.settings)) {
                        pushSettingsToDrive();
                    }
                } else {
                    // No settings file in Drive yet (first run) — bootstrap from defaults
                    appSettings = mergeWithDefaults({});
                    localStorage.setItem('sicet2026_settings', JSON.stringify(appSettings));
                    pushSettingsToDrive(); // create the file for all future visitors
                }

                if (overlay) overlay.style.display = 'none';
                return;
            }
        } catch (err) {
            console.warn('Drive settings fetch failed — falling back to localStorage:', err);
            showToast('Could not reach Google Drive — using locally cached settings. Fees may differ if settings were recently changed.', 'error');
        }
    }

    // Network failure / Drive not configured: fall back to localStorage
    const stored = JSON.parse(localStorage.getItem('sicet2026_settings') || 'null');
    appSettings = mergeWithDefaults(stored || {});
    localStorage.setItem('sicet2026_settings', JSON.stringify(appSettings));
    if (overlay) overlay.style.display = 'none';
}

// Push current appSettings to Google Drive (fire-and-forget via no-cors POST)
async function pushSettingsToDrive() {
    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') return;
    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ action: 'saveSettings', adminKey: ADMIN_KEY, settings: appSettings })
        });
    } catch (err) {
        console.warn('Could not push settings to Drive:', err);
    }
}

// Run init
init();
