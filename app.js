// Default Settings
const defaultSettings = {
    conf_fees: {
        local: { author: 15000, nonauthor: 12000, student: 10000 },
        saarc: { author: 150, nonauthor: 120, student: 100 },
        nonsaarc: { author: 250, nonauthor: 200, student: 150 }
    },
    discounts: {
        student_from_2nd: 10 // percentage
    },
    award_fee: 10000,
    excursion_fees: {
        local: 15000,
        foreigner: 17000
    },
    journals: [
        { id: 'j1', name: 'Scopus Q1', fee: 300 },
        { id: 'j2', name: 'Scopus Q2', fee: 200 },
        { id: 'j3', name: 'Other', fee: 100 }
    ],
    chair_name: 'Prof. [Name]',   // Configurable from Settings
    refund_deadline: 'August 23, 2025', // Configurable from Settings
    usd_to_lkr: 320 // Indicative rate shown on invoice; update before going live
};

// ---- GOOGLE DRIVE CONFIGURATION ----
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbznBk7c_1ncTXnZLXlnXAkF2v0SNzKS_Ha34RDLNfST8nU60l0akTBnBU2bVwojeodb/exec';
const ADMIN_KEY = 'sicet2026admin';

// ---- SUPER ADMIN CREDENTIALS ----
const ADMIN_USERNAME = 'p.cooma@gmail.com';
const ADMIN_PASSWORD = 'www.123@lk';

// DOM Elements - General
const registrationForm = document.getElementById('registration-form');

// Sections
const sections = {
    'Main Conference': document.getElementById('section-main'),
    'Excellence Award': document.getElementById('section-award'),
    'Excursion': document.getElementById('section-excursion')
};

// Navigation
const navFormBtn = document.getElementById('nav-form');
const navAdminBtn = document.getElementById('nav-admin');
const navSettingsBtn = document.getElementById('nav-settings');
const formSection = document.getElementById('form-section');
const adminSection = document.getElementById('admin-section');
const settingsSection = document.getElementById('settings-section');

// Admin Elements
const tableBody = document.getElementById('table-body');
const statTotal = document.getElementById('stat-total');
const statMain = document.getElementById('stat-main');
const statAward = document.getElementById('stat-award');
const btnClear = document.getElementById('btn-clear');
const btnExport = document.getElementById('btn-export');

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
let appSettings = JSON.parse(localStorage.getItem('sicet2026_settings')) || defaultSettings;
let formDraft = JSON.parse(localStorage.getItem('sicet2026_draft')) || null;

// Initialize
function init() {
    updateAdminDashboard();
    populateSettingsForm();
    populateJournalsDropdown();
    generatePaperBlocks(1); // Pre-generate 1 block
    setupEventListeners();
    updateSubmitButtonState();
    updateExcursionTicketVisibility();

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

        if (val > 1 && cat === 'Student') {
            hint.classList.remove('hidden');
        } else {
            hint.classList.add('hidden');
        }
        calculateTotalFee();
    });

    // Category-based field visibility (Author / Non-Author / Student)
    document.getElementById('attendeeCategory').addEventListener('change', (e) => {
        const category = e.target.value;
        const papersSection = document.getElementById('papers-section');
        const papersContainer = document.getElementById('dynamic-papers-container');
        const numberOfPapersInput = document.getElementById('numberOfPapers');
        const studentIdField = document.getElementById('studentId');
        const studentIdSection = document.getElementById('studentIdSection');
        const studentRequired = document.querySelector('.student-required');

        if (category === 'Non-Author') {
            // --- Non-Author: hide all paper submission fields ---
            if (papersSection) papersSection.classList.add('hidden');
            if (papersContainer) papersContainer.classList.add('hidden');
            if (numberOfPapersInput) {
                numberOfPapersInput.required = false;
                numberOfPapersInput.value = 0; // zero papers for pricing
            }
            // Also hide student ID
            if (studentIdSection) studentIdSection.classList.add('hidden');
            if (studentIdField) studentIdField.required = false;
            if (studentRequired) studentRequired.classList.add('hidden');

        } else if (category === 'Student') {
            // --- Student: show papers + require student ID ---
            if (papersSection) papersSection.classList.remove('hidden');
            if (papersContainer) papersContainer.classList.remove('hidden');
            if (numberOfPapersInput) {
                numberOfPapersInput.required = true;
                if (!numberOfPapersInput.value || numberOfPapersInput.value === '0') {
                    numberOfPapersInput.value = 1;
                }
            }
            if (studentIdSection) studentIdSection.classList.remove('hidden');
            if (studentIdField) studentIdField.required = true;
            if (studentRequired) studentRequired.classList.remove('hidden');

        } else {
            // --- Author: show papers, hide student ID ---
            if (papersSection) papersSection.classList.remove('hidden');
            if (papersContainer) papersContainer.classList.remove('hidden');
            if (numberOfPapersInput) {
                numberOfPapersInput.required = true;
                if (!numberOfPapersInput.value || numberOfPapersInput.value === '0') {
                    numberOfPapersInput.value = 1;
                }
            }
            if (studentIdSection) studentIdSection.classList.add('hidden');
            if (studentIdField) studentIdField.required = false;
            if (studentRequired) studentRequired.classList.add('hidden');
        }

        // Re-generate paper blocks for the current count (or clear them)
        const count = parseInt(document.getElementById('numberOfPapers').value) || 0;
        if (category === 'Non-Author') {
            document.getElementById('dynamic-papers-container').innerHTML = '';
        } else {
            generatePaperBlocks(count || 1);
        }
        calculateTotalFee();
    });

    // Excursion ticket visibility based on attendee region
    document.getElementById('attendeeRegion').addEventListener('change', updateExcursionTicketVisibility);

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

    // Form Submission
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
    btnClear.addEventListener('click', clearData);
    btnExport.addEventListener('click', exportToExcel);

    // Settings Actions
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
    document.getElementById('btn-add-journal').addEventListener('click', addJournalField);
}

// ---- DYNAMIC UI LOGIC ----

function generatePaperBlocks(count) {
    const container = document.getElementById('dynamic-papers-container');
    container.innerHTML = '';

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
                <div class="input-field col">
                    <label for="paperId_${i}">Paper ID <span class="required">*</span></label>
                    <input type="text" id="paperId_${i}" name="Paper_${i}_ID" placeholder="E.g. 195" required oninput="calculateTotalFee()">
                </div>
                <div class="input-field col">
                    <label for="paperTitle_${i}">Title of the Paper <span class="required">*</span></label>
                    <input type="text" id="paperTitle_${i}" name="Paper_${i}_Title" placeholder="Enter paper title" required>
                </div>
            </div>
            <div class="form-checkbox mb-2" style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px;">
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

function calculateTotalFee() {
    let totalUSD = 0;
    let totalLKR = 0;
    let breakdownText = '';

    const isMain = document.getElementById('toggleMain').checked;
    const isAward = document.getElementById('toggleAward').checked;
    const isExcursion = document.getElementById('toggleExcursion').checked;

    if (!isMain && !isAward && !isExcursion) {
        priceBox.classList.add('hidden');
        priceCurrency.textContent = 'LKR';
        priceTotalAmount.textContent = '0.00';
        priceBreakdown.innerHTML = '';
        return;
    }

    priceBox.classList.remove('hidden');

    // 1. Calculate Main Conference & APC
    if (isMain) {
        const region = document.getElementById('attendeeRegion').value;
        const category = document.getElementById('attendeeCategory').value;
        const papers = parseInt(document.getElementById('numberOfPapers').value) || 1;

        if (!region || !category) {
            breakdownText += `<span><i class='bx bx-info-circle'></i> Select Region & Category for Conf Fee</span> <br>`;
        } else {
            // Determine currency and branch
            let regionKey = region.toLowerCase().replace('-', '');
            let categoryKey;

            if (category.toLowerCase() === 'student') {
                categoryKey = 'student';
            } else if (category.toLowerCase() === 'non-author') {
                categoryKey = 'nonauthor';
            } else {
                categoryKey = 'author';
            }

            const isLKR = region === 'Local';
            let baseFee = appSettings.conf_fees[regionKey][categoryKey];
            let confTotal = 0;

            if (papers === 1) {
                confTotal = baseFee;
                breakdownText += `<span>Conference Fee:</span><span>${confTotal} ${isLKR ? 'LKR' : 'USD'}</span>`;
            } else {
                // Calculate with discount
                const firstPaperFee = baseFee;
                let otherPapersFee = 0;

                if (categoryKey === 'student') {
                    const discount = appSettings.discounts.student_from_2nd / 100;
                    const discountedFee = baseFee * (1 - discount);
                    otherPapersFee = discountedFee * (papers - 1);
                    confTotal = firstPaperFee + otherPapersFee;
                    breakdownText += `<span>Conf (1st Paper: ${firstPaperFee} | ${papers - 1} Added @ ${appSettings.discounts.student_from_2nd}% off):</span><span>${confTotal} ${isLKR ? 'LKR' : 'USD'}</span>`;
                } else {
                    confTotal = baseFee * papers;
                    breakdownText += `<span>Conf (${papers} Papers):</span><span>${confTotal} ${isLKR ? 'LKR' : 'USD'}</span>`;
                }
            }

            if (isLKR) {
                totalLKR += confTotal;
            } else {
                totalUSD += confTotal;
            }
        }

        // Add APC calculations
        let totalApcFees = 0;
        const container = document.getElementById('dynamic-papers-container');
        container.querySelectorAll('.apc-toggle').forEach((toggle, index) => {
            if (toggle.checked) {
                const select = document.getElementById(`journal_${index + 1}`);
                if (select && select.value) {
                    const opt = select.options[select.selectedIndex];
                    const fee = parseFloat(opt.dataset.fee);
                    totalApcFees += fee;
                    breakdownText += ` <br> <span>+ P${index + 1} APC: ${fee} USD</span>`;
                }
            }
        });

        totalUSD += totalApcFees;
    }


    // 2. Excellence Award
    if (isAward) {
        const pax = parseInt(document.getElementById('participantCount').value) || 1;
        const base = appSettings.award_fee;
        const awardTotal = base * pax;
        totalLKR += awardTotal;
        if (breakdownText) breakdownText += ` <br> `;
        breakdownText += `<span>Award (${pax} Pax):</span><span>${awardTotal} LKR</span>`;
    }

    // 3. Excursion (handles both Main Add-on and Dedicated forms now that they are unified, but we'll prioritize the dedicated inputs)
    if (isExcursion) {
        const locCount = parseInt(document.getElementById('excursionLocalCount').value) || 0;
        const forCount = parseInt(document.getElementById('excursionForeignCount').value) || 0;

        if (locCount > 0) {
            const locCost = locCount * appSettings.excursion_fees.local;
            totalLKR += locCost;
            if (breakdownText) breakdownText += ` <br> `;
            breakdownText += `<span>Local Excr (${locCount}):</span><span>${locCost} LKR</span>`;
        }
        if (forCount > 0) {
            const forCost = forCount * appSettings.excursion_fees.foreigner;
            totalLKR += forCost;
            if (breakdownText) breakdownText += ` <br> `;
            breakdownText += `<span>Foreign Excr (${forCount}):</span><span>${forCost} LKR</span>`;
        }
    }

    // Final Display output for mixed currencies
    if (totalUSD > 0 && totalLKR > 0) {
        priceCurrency.textContent = 'USD';
        priceTotalAmount.textContent = `${totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2 })} + LKR ${totalLKR.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
    } else if (totalUSD > 0) {
        priceCurrency.textContent = 'USD';
        priceTotalAmount.textContent = totalUSD.toLocaleString(undefined, { minimumFractionDigits: 2 });
    } else {
        priceCurrency.textContent = 'LKR';
        priceTotalAmount.textContent = totalLKR.toLocaleString(undefined, { minimumFractionDigits: 2 });
    }

    priceBreakdown.innerHTML = breakdownText;
}


// ---- FORM SUBMISSION LOGIC ----

async function handleFormSubmit(e) {
    e.preventDefault();

    // Validate at least one registration type is selected
    const isMain = document.getElementById('toggleMain').checked;
    const isAward = document.getElementById('toggleAward').checked;
    const isExcursion = document.getElementById('toggleExcursion').checked;

    if (!isMain && !isAward && !isExcursion) {
        showToast('Please select at least one registration type (Conference, Award, or Excursion)', 'error');
        return;
    }

    // Validate excursion ticket count if excursion is selected
    if (isExcursion) {
        const localCount = parseInt(document.getElementById('excursionLocalCount').value) || 0;
        const foreignCount = parseInt(document.getElementById('excursionForeignCount').value) || 0;
        if (localCount === 0 && foreignCount === 0) {
            showToast('Please specify at least one excursion ticket (local or foreign)', 'error');
            return;
        }
    }

    // Validate payment proof is uploaded (mandatory to complete registration)
    const paymentProofInput = document.getElementById('paymentProof');
    if (!paymentProofInput.files[0]) {
        showToast('Please upload your proof of payment before submitting.', 'error');
        paymentProofInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Create FormData object
    const formData = new FormData(registrationForm);
    const dataObj = {};

    // Add timestamp and unique invoice ID
    dataObj['Submission_Date'] = new Date().toLocaleString();
    dataObj['Invoice_ID'] = 'SICET2026-' + Date.now().toString().slice(-7);

    for (let [key, value] of formData.entries()) {
        // Store filename string; actual file bytes are handled separately below
        if (value instanceof File) {
            dataObj[key] = value.name ? value.name : '';
            continue;
        }

        if (dataObj[key]) {
            dataObj[key] = `${dataObj[key]}, ${value}`;
        } else {
            dataObj[key] = value;
        }
    }

    // Capture calculated total
    dataObj['Calculated_Total_Fee'] = document.getElementById('totalPriceAmount').textContent;
    dataObj['Currency'] = document.querySelector('.price-value .currency').textContent;

    // Determine compound registration type name for admin dashboard
    let typesArr = [];
    if (document.getElementById('toggleMain').checked) typesArr.push('Main');
    if (document.getElementById('toggleAward').checked) typesArr.push('Award');
    if (document.getElementById('toggleExcursion').checked) typesArr.push('Excursion');
    dataObj['Registration_Type'] = typesArr.join(' + ') || 'None';

    // Convert uploaded files to base64 for Drive storage
    const studentIdInput = document.getElementById('studentId');
    if (studentIdInput.files[0]) {
        dataObj['Student_ID_Base64'] = await fileToBase64(studentIdInput.files[0]);
    }
    if (paymentProofInput.files[0]) {
        dataObj['Payment_Proof_Base64'] = await fileToBase64(paymentProofInput.files[0]);
    }

    // Disable submit button while uploading
    const submitBtn = document.getElementById('btn-submit');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>Submitting…</span><i class="bx bx-loader bx-spin"></i>';

    const ok = await submitToGoogleDrive(dataObj);

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Submit Registration</span><i class="bx bx-right-arrow-alt"></i>';

    if (!ok) return;

    // Clear Draft on success
    clearDraft();

    // Reset Form
    registrationForm.reset();

    // Hide dynamic sections
    document.querySelectorAll('.section-toggle').forEach(t => {
        t.dispatchEvent(new Event('change'));
    });

    showToast(`Submitted! Reference: ${dataObj.Invoice_ID}`, 'success');
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

    const isMain = document.getElementById('toggleMain').checked;
    const isAward = document.getElementById('toggleAward').checked;
    const isExcursion = document.getElementById('toggleExcursion').checked;

    if (!isMain && !isAward && !isExcursion) {
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
    const invoiceNum = 'SICET2026-' + dateObj.getTime().toString().slice(-7);

    // ---- 2. Build Line Items ----
    let lineItemsLKR = [];
    let lineItemsUSD = [];
    let totalLKR = 0;
    let totalUSD = 0;

    if (isMain) {
        const papers = parseInt(document.getElementById('numberOfPapers').value) || 0;
        const isLocal = (region === 'Local');
        let regionKey = region.toLowerCase().replace('-', '').replace(' ', '') || 'local';
        let catKey = category === 'Student' ? 'student' : category === 'Non-Author' ? 'nonauthor' : 'author';

        if (category !== 'Non-Author' && papers > 0) {
            const baseFee = appSettings.conf_fees[regionKey]?.[catKey] || 0;
            let confTotal = 0;
            let confLabel = '';
            if (papers === 1) {
                confTotal = baseFee;
                confLabel = `Conference Registration — ${title} ${fullName} (${category}, ${region})`;
            } else if (catKey === 'student') {
                const disc = appSettings.discounts.student_from_2nd / 100;
                confTotal = baseFee + (baseFee * (1 - disc) * (papers - 1));
                confLabel = `Conference (${papers} Papers — 1st: ${baseFee}, ${papers - 1} × ${(baseFee * (1 - disc)).toFixed(0)} w/ 10% off)`;
            } else {
                confTotal = baseFee * papers;
                confLabel = `Conference Registration — ${papers} Papers × ${baseFee} (${category}, ${region})`;
            }
            if (isLocal) { lineItemsLKR.push({ description: confLabel, amount: Math.round(confTotal) }); totalLKR += confTotal; }
            else { lineItemsUSD.push({ description: confLabel, amount: confTotal }); totalUSD += confTotal; }

            // All paper details in one combined note row
            const paperNotes = [];
            for (let i = 1; i <= papers; i++) {
                const paperId = document.getElementById(`paperId_${i}`)?.value || '';
                const paperTitle = document.getElementById(`paperTitle_${i}`)?.value || '';
                const shortTitle = paperTitle.length > 32 ? paperTitle.slice(0, 32) + '…' : paperTitle;
                if (paperId || paperTitle) paperNotes.push(`P${i}${paperId ? ':' + paperId : ''}${shortTitle ? ' — ' + shortTitle : ''}`);

                const apcToggle = document.getElementById(`includeApc_${i}`);
                const journalSel = document.getElementById(`journal_${i}`);
                if (apcToggle?.checked && journalSel?.value) {
                    const opt = journalSel.options[journalSel.selectedIndex];
                    const apcFee = parseFloat(opt.dataset.fee) || 0;
                    lineItemsUSD.push({ description: `  APC — P${i}: ${journalSel.value}`, amount: apcFee });
                    totalUSD += apcFee;
                }
            }
            if (paperNotes.length > 0) {
                const noteRow = { description: '  Papers: ' + paperNotes.join(' | '), amount: null };
                isLocal ? lineItemsLKR.push(noteRow) : lineItemsUSD.push(noteRow);
            }
        } else if (category === 'Non-Author') {
            const baseFee = appSettings.conf_fees[regionKey]?.[catKey] || 0;
            const confLabel = `Conference Registration — ${title} ${fullName} (Non-Author, ${region})`;
            if (isLocal) { lineItemsLKR.push({ description: confLabel, amount: baseFee }); totalLKR += baseFee; }
            else { lineItemsUSD.push({ description: confLabel, amount: baseFee }); totalUSD += baseFee; }
        }
    }

    if (isAward) {
        const pax = parseInt(document.getElementById('participantCount').value) || 1;
        const names = document.getElementById('participantNames').value || '';
        const awardCat = document.getElementById('awardCategory').value || '';
        const awardFee = appSettings.award_fee * pax;
        lineItemsLKR.push({ description: `Excellence Award — ${awardCat || 'Category TBD'} (${pax} pax)`, amount: awardFee });
        if (names) lineItemsLKR.push({ description: `  Participants: ${names.slice(0, 80)}${names.length > 80 ? '…' : ''}`, amount: null });
        totalLKR += awardFee;
    }

    if (isExcursion) {
        const locCount = parseInt(document.getElementById('excursionLocalCount').value) || 0;
        const forCount = parseInt(document.getElementById('excursionForeignCount').value) || 0;
        if (locCount > 0) {
            const fee = locCount * appSettings.excursion_fees.local;
            lineItemsLKR.push({ description: `Excursion — Local × ${locCount} (LKR ${appSettings.excursion_fees.local.toLocaleString()} each)`, amount: fee });
            totalLKR += fee;
        }
        if (forCount > 0) {
            const fee = forCount * appSettings.excursion_fees.foreigner;
            lineItemsLKR.push({ description: `Excursion — Foreign × ${forCount} (LKR ${appSettings.excursion_fees.foreigner.toLocaleString()} each)`, amount: fee });
            totalLKR += fee;
        }
    }

    if (totalLKR === 0 && totalUSD === 0) {
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
    doc.text('Email: sicet@sliit.lk', L, issuerY); issuerY += 4;

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

    // --- LKR ITEMS ---
    if (lineItemsLKR.length > 0) {
        if (totalUSD > 0) {
            if (Y + 5 > 278) { doc.addPage(); Y = 14; }
            doc.setFillColor(220, 220, 220);
            doc.rect(L, Y, W, 5, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(40, 40, 40);
            doc.text('LKR — Sri Lankan Rupee Items', L + 3, Y + 3.5);
            Y += 5;
        }
        doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
        lineItemsLKR.forEach((item, idx) => drawRow(item.description, item.amount, 'LKR', false, idx % 2 === 0));
    }

    // --- USD ITEMS ---
    if (lineItemsUSD.length > 0) {
        if (totalLKR > 0) {
            if (Y + 5 > 278) { doc.addPage(); Y = 14; }
            doc.setFillColor(220, 220, 220);
            doc.rect(L, Y, W, 5, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(40, 40, 40);
            doc.text('USD — US Dollar Items', L + 3, Y + 3.5);
            Y += 5;
        }
        doc.setFontSize(8.5); doc.setTextColor(0, 0, 0);
        lineItemsUSD.forEach((item, idx) => drawRow(item.description, item.amount, 'USD', false, idx % 2 === 0));
    }

    // --- TOTALS ---
    Y += 3;
    const isLocalRegion = region === 'Local';
    const fxRate = appSettings.usd_to_lkr || 320;
    const hasBothCurrencies = totalLKR > 0 && totalUSD > 0;

    // Show per-currency sub-totals only when items exist in both currencies
    if (hasBothCurrencies) {
        if (Y + 9 > 278) { doc.addPage(); Y = 14; }
        doc.setFillColor(232, 232, 232); doc.setDrawColor(100, 100, 100); doc.setLineWidth(0.3);
        doc.rect(L, Y, W, 9, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
        doc.text('Sub-Total (LKR items):', L + 3, Y + 6.5);
        doc.text(`LKR ${fmt(totalLKR)}`, R - 3, Y + 6.5, { align: 'right' });
        Y += 11;

        if (Y + 9 > 278) { doc.addPage(); Y = 14; }
        doc.setFillColor(232, 232, 232); doc.setDrawColor(100, 100, 100); doc.setLineWidth(0.3);
        doc.rect(L, Y, W, 9, 'FD');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
        doc.text('Sub-Total (USD items):', L + 3, Y + 6.5);
        doc.text(`USD ${fmt(totalUSD)}`, R - 3, Y + 6.5, { align: 'right' });
        Y += 11;
    }

    // Grand Total — single currency: LKR for local attendees, USD for all others
    const grandCurrency = isLocalRegion ? 'LKR' : 'USD';
    const grandTotal = isLocalRegion
        ? totalLKR + (totalUSD * fxRate)
        : totalUSD + (totalLKR / fxRate);

    if (Y + 10 > 278) { doc.addPage(); Y = 14; }
    doc.setFillColor(20, 20, 20); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.3);
    doc.rect(L, Y, W, 10, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
    doc.text('GRAND TOTAL:', L + 3, Y + 7);
    doc.text(`${grandCurrency} ${fmt(grandTotal)}`, R - 3, Y + 7, { align: 'right' });
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
    doc.save(`SICET2026_Invoice_${invoiceNum}_${safeName}.pdf`);
    showToast('Invoice generated successfully!', 'success');
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
    const toggles = ['Registering_Main', 'Registering_Award', 'Registering_Excursion'];
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

        const el = registrationForm.querySelector(`[name="${key}"]`);
        if (el) {
            if (el.type === 'checkbox') {
                el.checked = formDraft[key];
                el.dispatchEvent(new Event('change')); // Trigger visibility
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
    statTotal.textContent = submissions.length;

    const mainCount = submissions.filter(s => s.Registration_Type && s.Registration_Type.includes('Main')).length;
    statMain.textContent = mainCount;

    const awardExcursionCount = submissions.filter(s =>
        s.Registration_Type && (s.Registration_Type.includes('Award') || s.Registration_Type.includes('Excursion'))
    ).length;
    statAward.textContent = awardExcursionCount;

    tableBody.innerHTML = '';

    if (submissions.length === 0) {
        tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">No data loaded yet — click <strong>Refresh from Drive</strong> to load registrations.</td></tr>';
        return;
    }

    const reversedData = [...submissions].reverse();

    reversedData.forEach(sub => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${sub.Submission_Date.split(',')[0]}</td>
            <td>${sub.Title || ''} ${sub.Full_Name || ''}</td>
            <td>${sub.Email || ''}</td>
            <td><span class="badge ${getCategoryBadge(sub.Registration_Type)}">${sub.Registration_Type || 'N/A'}</span></td>
            <td>${sub.Organization || ''}</td>
        `;
        tableBody.appendChild(tr);
    });
}

function getCategoryBadge(type) {
    if (!type) return '';
    if (type.includes('Main')) return 'badge-main';
    if (type.includes('Award')) return 'badge-award';
    if (type.includes('Excursion')) return 'badge-excursion';
    return '';
}

function exportToExcel() {
    if (submissions.length === 0) {
        showToast('No data to export!', 'error');
        return;
    }

    try {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(submissions);
        const wscols = [
            { wch: 20 }, // Submission_Date
            { wch: 10 }, // Title
            { wch: 25 }, // Full_Name
            { wch: 30 }, // Email
            { wch: 20 }, // Phone
            { wch: 25 }, // Organization
            { wch: 20 }, // Registration_Type
            { wch: 15 }, // Paper_ID
            { wch: 40 }, // Paper_Title
        ];
        ws['!cols'] = wscols;

        XLSX.utils.book_append_sheet(wb, ws, "Registrations");
        XLSX.writeFile(wb, "SICET_2026_Registrations.xlsx");

        showToast('Data exported to Excel successfully!', 'success');
    } catch (error) {
        console.error("Export Error: ", error);
        showToast('Error exporting data. Please try again.', 'error');
    }
}

function clearData() {
    submissions = [];
    updateAdminDashboard();
    showToast('Local view cleared. Click Refresh from Drive to reload.', 'success');
}


// ---- ADMIN SETTINGS LOGIC ----

function populateSettingsForm() {
    // Conf Fees
    document.getElementById('fee_conf_local_author').value = appSettings.conf_fees.local.author;
    document.getElementById('fee_conf_local_nonauthor').value = appSettings.conf_fees.local.nonauthor;
    document.getElementById('fee_conf_local_student').value = appSettings.conf_fees.local.student;

    document.getElementById('fee_conf_saarc_author').value = appSettings.conf_fees.saarc.author;
    document.getElementById('fee_conf_saarc_nonauthor').value = appSettings.conf_fees.saarc.nonauthor;
    document.getElementById('fee_conf_saarc_student').value = appSettings.conf_fees.saarc.student;

    document.getElementById('fee_conf_nonsaarc_author').value = appSettings.conf_fees.nonsaarc.author;
    document.getElementById('fee_conf_nonsaarc_nonauthor').value = appSettings.conf_fees.nonsaarc.nonauthor;
    document.getElementById('fee_conf_nonsaarc_student').value = appSettings.conf_fees.nonsaarc.student;

    document.getElementById('fee_conf_student_discount').value = appSettings.discounts.student_from_2nd;

    // Awards & Excursion
    document.getElementById('fee_award_base').value = appSettings.award_fee;
    document.getElementById('fee_excursion_local').value = appSettings.excursion_fees.local;
    document.getElementById('fee_excursion_foreigner').value = appSettings.excursion_fees.foreigner;

    // Invoice / Chair & Refund
    document.getElementById('setting_chair_name').value = appSettings.chair_name || '';
    document.getElementById('setting_refund_deadline').value = appSettings.refund_deadline || 'August 23, 2025';
    document.getElementById('setting_usd_rate').value = appSettings.usd_to_lkr || 320;

    const refundNotice = document.getElementById('notice-refund-deadline');
    if (refundNotice) refundNotice.textContent = appSettings.refund_deadline || 'August 23, 2025';

    // Journals
    renderJournalsAdmin();
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

    // Gather values
    appSettings.conf_fees.local.author = Number(document.getElementById('fee_conf_local_author').value);
    appSettings.conf_fees.local.nonauthor = Number(document.getElementById('fee_conf_local_nonauthor').value);
    appSettings.conf_fees.local.student = Number(document.getElementById('fee_conf_local_student').value);

    appSettings.conf_fees.saarc.author = Number(document.getElementById('fee_conf_saarc_author').value);
    appSettings.conf_fees.saarc.nonauthor = Number(document.getElementById('fee_conf_saarc_nonauthor').value);
    appSettings.conf_fees.saarc.student = Number(document.getElementById('fee_conf_saarc_student').value);

    appSettings.conf_fees.nonsaarc.author = Number(document.getElementById('fee_conf_nonsaarc_author').value);
    appSettings.conf_fees.nonsaarc.nonauthor = Number(document.getElementById('fee_conf_nonsaarc_nonauthor').value);
    appSettings.conf_fees.nonsaarc.student = Number(document.getElementById('fee_conf_nonsaarc_student').value);

    appSettings.discounts.student_from_2nd = Number(document.getElementById('fee_conf_student_discount').value);

    appSettings.award_fee = Number(document.getElementById('fee_award_base').value);
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

    // Persist
    localStorage.setItem('sicet2026_settings', JSON.stringify(appSettings));

    // Re-populate globals
    populateJournalsDropdown();
    showToast('Pricing Settings saved successfully!', 'success');
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

// Run init
init();
