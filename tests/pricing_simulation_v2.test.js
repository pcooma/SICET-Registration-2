const fs = require('fs');
const path = require('path');

// Mock settings mirroring app.js defaultSettings
const appSettings = {
    conf_fees: {
        local: { author: 15000, nonauthor: 12000, student: 10000 },
        saarc: { author: 150, nonauthor: 120, student: 100 },
        nonsaarc: { author: 250, nonauthor: 200, student: 150 }
    },
    discounts: {
        student_from_2nd: 10,
        discount_max_papers: 3
    },
    award_fee: 10000,
    excursion_fees: {
        local: 15000,
        foreigner: 50
    },
    inauguration_fee: 10000,
    inauguration_fee_usd: 30,
    journals: [
        { id: 'j1', name: 'Scopus Q1', fee: 300, apc_not_applicable: false },
        { id: 'j2', name: 'Scopus Q2', fee: 200, apc_not_applicable: false },
        { id: 'j3', name: 'Other', fee: 100, apc_not_applicable: false }
    ],
    pre_conference_sessions: [
        { id: 'pcs1', name: 'Quantity Surveying in the era of Digitalisation', fee_local: 10000, fee_saarc: 35, fee_nonsaarc: 50, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs2', name: 'Integrated Design of High-Rise Buildings: From Concept to Construction', fee_local: 12500, fee_saarc: 40, fee_nonsaarc: 60, academic_discount_pct: 50, student_discount_pct: 100 },
        { id: 'pcs3', name: 'Industry Sector Decarbonization Pathways', fee_local: 5000, fee_saarc: 20, fee_nonsaarc: 30, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs4', name: '6 G wireless Communication (on-line)', fee_local: 1500, fee_saarc: 15, fee_nonsaarc: 25, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs5', name: 'GIS for Civil Engineers', fee_local: 8000, fee_saarc: 30, fee_nonsaarc: 40, academic_discount_pct: 0, student_discount_pct: 0 }
    ],
    categories: [
        { id: 'author',           label: 'Author',                fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250, is_student: false, no_papers: false, paper_discount: true,  is_workshop_only: false },
        { id: 'nonauthor',        label: 'Non-Author',            fee_local: 12000, fee_saarc: 120, fee_nonsaarc: 200, is_student: false, no_papers: true,  paper_discount: false, is_workshop_only: false },
        { id: 'student',          label: 'Student',               fee_local: 10000, fee_saarc: 100, fee_nonsaarc: 150, is_student: true,  no_papers: false, paper_discount: true,  is_workshop_only: false },
        { id: 'workshopattendee', label: 'Workshop Attendee',     fee_local: 0,     fee_saarc: 0,   fee_nonsaarc: 0,   is_student: false, no_papers: true,  paper_discount: false, is_workshop_only: true  }
    ],
    usd_to_lkr: 320
};

// Simulation engine for on-screen calculator
function simulateOnScreenCalculator(profile) {
    const isMain = !!profile.isMain;
    const isAward = !!profile.isAward;
    const isExcursion = !!profile.isExcursion;
    const isPreConf = !!profile.isPreConf;

    if (!isMain && !isAward && !isExcursion && !isPreConf) {
        return { currency: 'LKR', total: 0, breakdown: [] };
    }

    const region = profile.region;
    const isLocalRegion = region === 'Local';
    const effectivelyLocal = !region || isLocalRegion;
    const fxRate = appSettings.usd_to_lkr || 320;
    const displayCur = effectivelyLocal ? 'LKR' : 'USD';

    const toDisplay = (amount, fromCur) => {
        if (fromCur === displayCur) return amount;
        return displayCur === 'LKR' ? Math.round(amount * fxRate) : +((amount / fxRate).toFixed(2));
    };

    let displayTotal = 0;
    const breakdown = [];

    // 1. Main Conference
    if (isMain) {
        const category = profile.category;
        const papers = parseInt(profile.papers) || 1;

        if (region && category) {
            const catDef = (appSettings.categories || []).find(c => c.label === category);
            let baseFee = 0;
            let nativeCur = isLocalRegion ? 'LKR' : 'USD';
            if (catDef) {
                baseFee = isLocalRegion ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
            } else {
                // Fallback legacy lookup
                const regionKey = region.toLowerCase().replace(/[^a-z]/g, '');
                const catKey = category.toLowerCase().includes('student') ? 'student' : (category.toLowerCase().includes('non') ? 'nonauthor' : 'author');
                baseFee = (appSettings.conf_fees?.[regionKey]?.[catKey]) || 0;
            }

            if (catDef?.is_workshop_only) {
                breakdown.push({ item: 'Conference Attendance (Workshop Attendee)', fee: 0, currency: displayCur });
            } else {
                const hasPaperDiscount = catDef ? catDef.paper_discount : true;
                const maxP = appSettings.discounts.discount_max_papers || 0;
                const discPapers = papers > 1 ? (maxP > 0 ? Math.min(papers - 1, maxP) : papers - 1) : 0;
                const fullExtra  = papers > 1 ? (papers - 1 - discPapers) : 0;
                const disc       = (appSettings.discounts.student_from_2nd || 0) / 100;

                let confTotal;
                if (papers === 1) {
                    confTotal = baseFee;
                } else if (hasPaperDiscount && disc > 0) {
                    const discFee = baseFee * (1 - disc);
                    confTotal = baseFee + (discFee * discPapers) + (baseFee * fullExtra);
                } else {
                    confTotal = baseFee * papers;
                }
                const displayConfFee = toDisplay(confTotal, nativeCur);
                displayTotal += displayConfFee;
                breakdown.push({ item: `Conference Registration (${papers} papers)`, fee: displayConfFee, currency: displayCur });
            }
        }

        // APC
        if (profile.apcSelected && Array.isArray(profile.apcSelected)) {
            profile.apcSelected.forEach((apc, idx) => {
                if (apc.checked && apc.journalId) {
                    const j = appSettings.journals.find(x => x.id === apc.journalId);
                    if (j) {
                        const notApplicable = j.apc_not_applicable;
                        const fee = notApplicable ? 0 : (j.fee || 0);
                        const disp = toDisplay(fee, 'USD');
                        displayTotal += disp;
                        breakdown.push({ item: `+ P${idx + 1} APC (${j.name})`, fee: disp, currency: displayCur });
                    }
                }
            });
        }
    }

    // Inauguration (Note: UI has showInauguration/hideInauguration but let's check if it computes it anyway if checked)
    if (isMain && profile.includeInauguration) {
        const inaugFee = effectivelyLocal ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = effectivelyLocal ? 'LKR' : 'USD';
        if (inaugFee > 0) {
            const disp = toDisplay(inaugFee, inaugCur);
            displayTotal += disp;
            breakdown.push({ item: 'Inauguration Ceremony', fee: disp, currency: displayCur });
        }
    }

    // Pre-Conference Workshops
    if (isPreConf) {
        const wkTier = profile.workshopDiscountTier || 'regular';
        if (profile.workshops && Array.isArray(profile.workshops)) {
            profile.workshops.forEach(wkId => {
                const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === wkId);
                if (sess) {
                    const rawFee = effectivelyLocal ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                    const nativeCur2 = effectivelyLocal ? 'LKR' : 'USD';
                    const discPct = wkTier === 'academic' ? (sess.academic_discount_pct || 0)
                                  : wkTier === 'student'  ? (sess.student_discount_pct  || 0) : 0;
                    const discounted = discPct > 0 ? rawFee * (1 - discPct / 100) : rawFee;
                    const effFee = nativeCur2 === 'LKR' ? Math.round(discounted) : +(discounted.toFixed(2));
                    const disp = toDisplay(effFee, nativeCur2);
                    displayTotal += disp;
                    breakdown.push({ item: `Workshop: ${sess.name} (Tier: ${wkTier})`, fee: disp, currency: displayCur });
                }
            });
        }
    }

    // Excellence Award
    if (isAward) {
        const pax = parseInt(profile.participantCount) || 1;
        const awardTotal = appSettings.award_fee * pax;
        const disp = toDisplay(awardTotal, 'LKR');
        displayTotal += disp;
        breakdown.push({ item: `Excellence Award (${pax} pax)`, fee: disp, currency: displayCur });
    }

    // Excursion
    if (isExcursion) {
        const locCount = parseInt(profile.excursionLocalCount) || 0;
        const forCount = parseInt(profile.excursionForeignCount) || 0;
        const countLocal = !region || isLocalRegion;
        const countForeign = !region || !isLocalRegion;

        if (locCount > 0 && countLocal) {
            const fee = locCount * appSettings.excursion_fees.local;
            const disp = toDisplay(fee, 'LKR');
            displayTotal += disp;
            breakdown.push({ item: `Excursion Local (${locCount})`, fee: disp, currency: displayCur });
        }
        if (forCount > 0 && countForeign) {
            const fee = forCount * appSettings.excursion_fees.foreigner;
            const disp = toDisplay(fee, 'USD');
            displayTotal += disp;
            breakdown.push({ item: `Excursion Foreign (${forCount})`, fee: disp, currency: displayCur });
        }
    }

    return { currency: displayCur, total: displayTotal, breakdown };
}

// Simulation engine for invoice builder
function simulateInvoiceCalculator(profile) {
    const isMain = !!profile.isMain;
    const isAward = !!profile.isAward;
    const isExcursion = !!profile.isExcursion;
    const isPreConf = !!profile.isPreConf;

    if (!isMain && !isAward && !isExcursion && !isPreConf) {
        return { error: 'No items selected' };
    }

    const region = profile.region;
    const isLocalInv = region === 'Local';
    const invoiceCur = isLocalInv ? 'LKR' : 'USD';
    const fxRateInv = appSettings.usd_to_lkr || 320;

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
        const category = profile.category;
        const papers = parseInt(profile.papers) || 1;
        const nativeCur = isLocalInv ? 'LKR' : 'USD';

        const catDef = (appSettings.categories || []).find(c => c.label === category);
        const isStudentInv = catDef ? catDef.is_student : category.toLowerCase().includes('student');
        const isNoPapersInv = catDef ? catDef.no_papers : category.toLowerCase().includes('non');
        const isWorkshopOnlyInv = catDef ? catDef.is_workshop_only : false;

        let baseFee = 0;
        if (catDef) {
            baseFee = isLocalInv ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
        } else {
            const rKey = region.toLowerCase().replace(/[^a-z]/g, '');
            const cKey = isStudentInv ? 'student' : (isNoPapersInv ? 'nonauthor' : 'author');
            baseFee = appSettings.conf_fees?.[rKey]?.[cKey] || 0;
        }

        if (isWorkshopOnlyInv) {
            // Workshop Attendee
        } else if (!isNoPapersInv && papers > 0) {
            const hasPaperDiscountInv = catDef ? catDef.paper_discount : true;
            const maxP = appSettings.discounts.discount_max_papers || 0;
            const discPapers = papers > 1 ? (maxP > 0 ? Math.min(papers - 1, maxP) : papers - 1) : 0;
            const fullExtra  = papers > 1 ? (papers - 1 - discPapers) : 0;
            const disc       = (appSettings.discounts.student_from_2nd || 0) / 100;

            let confTotal, confLabel;
            if (papers === 1) {
                confTotal = baseFee;
                confLabel = `Conference Registration — (${category}, ${region})`;
            } else if (hasPaperDiscountInv && disc > 0) {
                const discFee = baseFee * (1 - disc);
                confTotal = baseFee + (discFee * discPapers) + (baseFee * fullExtra);
                confLabel = `Conference (${papers} papers)`;
            } else {
                confTotal = baseFee * papers;
                confLabel = `Conference Registration — ${papers} Papers`;
            }
            addItem(confLabel, confTotal, nativeCur);

            // APC
            if (profile.apcSelected && Array.isArray(profile.apcSelected)) {
                profile.apcSelected.forEach((apc, idx) => {
                    if (apc.checked && apc.journalId) {
                        const j = appSettings.journals.find(x => x.id === apc.journalId);
                        if (j) {
                            const notApplicable = j.apc_not_applicable;
                            const apcFee = notApplicable ? 0 : (j.fee || 0);
                            addItem(`  APC — P${idx + 1}: ${j.name}`, notApplicable ? null : apcFee, 'USD');
                        }
                    }
                });
            }
        } else if (isNoPapersInv) {
            addItem(`Conference Registration — (${category}, ${region})`, baseFee, nativeCur);
        }
    }

    // Inauguration
    if (isMain && profile.includeInauguration) {
        const inaugFee = isLocalInv ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = isLocalInv ? 'LKR' : 'USD';
        if (inaugFee > 0) addItem('Inauguration Ceremony (opt-in)', inaugFee, inaugCur);
    }

    // Pre-Conference Workshops
    if (isPreConf) {
        const invWkTier = profile.workshopDiscountTier || 'regular';
        if (profile.workshops && Array.isArray(profile.workshops)) {
            profile.workshops.forEach(wkId => {
                const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === wkId);
                if (sess) {
                    const rawFee = isLocalInv ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                    const dPct = invWkTier === 'academic' ? (sess.academic_discount_pct || 0)
                               : invWkTier === 'student'  ? (sess.student_discount_pct  || 0) : 0;
                    const discounted = rawFee * (1 - dPct / 100);
                    const effFee = isLocalInv ? Math.round(discounted) : +(discounted.toFixed(2));
                    addItem(`Pre-Conference Workshop — ${sess.name}`, effFee, isLocalInv ? 'LKR' : 'USD');
                }
            });
        }
    }

    // Excellence Award
    if (isAward) {
        const pax = parseInt(profile.participantCount) || 1;
        addItem(`Excellence Award (${pax} pax)`, appSettings.award_fee * pax, 'LKR');
    }

    // Excursion
    if (isExcursion) {
        const locCount = parseInt(profile.excursionLocalCount) || 0;
        const forCount = parseInt(profile.excursionForeignCount) || 0;
        const countLocalInv = !region || isLocalInv;
        const countForeignInv = !region || !isLocalInv;

        if (locCount > 0 && countLocalInv) {
            addItem(`Excursion Local × ${locCount}`, locCount * appSettings.excursion_fees.local, 'LKR');
        }
        if (forCount > 0 && countForeignInv) {
            addItem(`Excursion Foreign × ${forCount}`, forCount * appSettings.excursion_fees.foreigner, 'USD');
        }
    }

    return { currency: invoiceCur, total: grandTotal, lineItems };
}

// Define another 20 diverse simulation profiles (11 to 30)
const simulationProfiles = [
    {
        id: 11,
        role: "Local Author - 2 Papers, APC Scopus Q1 on paper 2",
        region: "Local",
        category: "Author",
        isMain: true,
        papers: 2,
        apcSelected: [
            { checked: false },
            { checked: true, journalId: "j1" } // Scopus Q1 ($300)
        ]
    },
    {
        id: 12,
        role: "Local Student - 1 Paper, Inauguration Ceremony but Main Conference checkbox is unchecked",
        region: "Local",
        category: "Student",
        isMain: false, // Edge case: Main conference toggled off, but inauguration remains checked
        papers: 1,
        includeInauguration: true,
        isAward: true,
        participantCount: 1
    },
    {
        id: 13,
        role: "SAARC Workshop Attendee - Multiple Workshops (Academic Discount)",
        region: "SAARC",
        category: "Workshop Attendee",
        isPreConf: true,
        workshopDiscountTier: "academic",
        workshops: ["pcs2", "pcs4"] // PCS2 (50% academic off: $40 -> $20), PCS4 (no discount: $15)
    },
    {
        id: 14,
        role: "Non-SAARC Student - Excursion (No Region Selected initially, then set to Non-SAARC)",
        region: "Non-SAARC",
        category: "Student",
        isExcursion: true,
        excursionLocalCount: 5, // Local count filled in before region was selected
        excursionForeignCount: 2
    },
    {
        id: 15,
        role: "Local Non-Author - Tries to add Excellence Award with 10 participants",
        region: "Local",
        category: "Non-Author",
        isMain: true,
        papers: 0,
        isAward: true,
        participantCount: 10
    },
    {
        id: 16,
        role: "SAARC Author - 1 Paper + GIS Workshop (Regular rate) + Decarbonization Workshop",
        region: "SAARC",
        category: "Author",
        isMain: true,
        papers: 1,
        isPreConf: true,
        workshopDiscountTier: "regular",
        workshops: ["pcs3", "pcs5"] // PCS3 ($20) + PCS5 ($30)
    },
    {
        id: 17,
        role: "Non-SAARC Author - 3 Papers + Excellence Award 1 Pax + Excursion (1 Foreign ticket)",
        region: "Non-SAARC",
        category: "Author",
        isMain: true,
        papers: 3,
        isAward: true,
        participantCount: 1,
        isExcursion: true,
        excursionLocalCount: 0,
        excursionForeignCount: 1
    },
    {
        id: 18,
        role: "Legacy/Unknown Category Fallback - 'Co-Author' (Not in flexible categories, falling back to legacy rules)",
        region: "Local",
        category: "Co-Author", // Fallback test
        isMain: true,
        papers: 1
    },
    {
        id: 19,
        role: "Local Student - 3 Papers, APC Scopus Q2 on Paper 1, Scopus Q3 on Paper 3",
        region: "Local",
        category: "Student",
        isMain: true,
        papers: 3,
        apcSelected: [
            { checked: true, journalId: "j2" }, // Scopus Q2 ($200)
            { checked: false },
            { checked: true, journalId: "j3" } // Other ($100)
        ]
    },
    {
        id: 20,
        role: "SAARC Student - Workshop Only (Pre-Conference Toggle on, Main Toggle off)",
        region: "SAARC",
        category: "Student",
        isMain: false,
        isPreConf: true,
        workshopDiscountTier: "student",
        workshops: ["pcs2"] // Integrated Design (100% student off: $0)
    },
    {
        id: 21,
        role: "Non-SAARC Non-Author - 4 Excursion Tickets",
        region: "Non-SAARC",
        category: "Non-Author",
        isMain: true,
        papers: 1,
        isExcursion: true,
        excursionLocalCount: 0,
        excursionForeignCount: 4
    },
    {
        id: 22,
        role: "Local Workshop Attendee - All Workshops selected (Academic discount)",
        region: "Local",
        category: "Workshop Attendee",
        isPreConf: true,
        workshopDiscountTier: "academic",
        workshops: ["pcs1", "pcs2", "pcs3", "pcs4", "pcs5"]
    },
    {
        id: 23,
        role: "SAARC Student - 1 Paper, Inauguration checked, Excursion (2 Local, 2 Foreign tickets)",
        region: "SAARC",
        category: "Student",
        isMain: true,
        papers: 1,
        includeInauguration: true,
        isExcursion: true,
        excursionLocalCount: 2, // Should be ignored because attendee is international
        excursionForeignCount: 2
    },
    {
        id: 24,
        role: "Non-SAARC Author - 10 Papers (Limit test)",
        region: "Non-SAARC",
        category: "Author",
        isMain: true,
        papers: 10
    },
    {
        id: 25,
        role: "Local Student - Inauguration Ceremony and Excellence Award, Main Conference checked but papers = 0",
        region: "Local",
        category: "Student",
        isMain: true,
        papers: 0, // Invalid paper count test
        includeInauguration: true,
        isAward: true,
        participantCount: 1
    },
    {
        id: 26,
        role: "SAARC Non-Author - Main Conference checked, 100% Student Workshop discount on PCS2 but tier set to regular",
        region: "SAARC",
        category: "Non-Author",
        isMain: true,
        papers: 1,
        isPreConf: true,
        workshopDiscountTier: "regular",
        workshops: ["pcs2"]
    },
    {
        id: 27,
        role: "Non-SAARC Workshop Attendee - Decarbonization Workshop only",
        region: "Non-SAARC",
        category: "Workshop Attendee",
        isPreConf: true,
        workshopDiscountTier: "regular",
        workshops: ["pcs3"]
    },
    {
        id: 28,
        role: "Local Non-Author - No Main Conference, Excursion Local (1 ticket) + Award (1 pax)",
        region: "Local",
        category: "Non-Author",
        isMain: false,
        isExcursion: true,
        excursionLocalCount: 1,
        isAward: true,
        participantCount: 1
    },
    {
        id: 29,
        role: "SAARC Author - 2 Papers, APC Scopus Q1 on Paper 1, Scopus Q1 on Paper 2",
        region: "SAARC",
        category: "Author",
        isMain: true,
        papers: 2,
        apcSelected: [
            { checked: true, journalId: "j1" },
            { checked: true, journalId: "j1" }
        ]
    },
    {
        id: 30,
        role: "Non-SAARC Author - 2 Papers, Workshop (GIS - Student discount)",
        region: "Non-SAARC",
        category: "Author",
        isMain: true,
        papers: 2,
        isPreConf: true,
        workshopDiscountTier: "student",
        workshops: ["pcs5"]
    }
];

console.log("=== STARTING NEW SIMULATIONS (11-30) ===\n");

simulationProfiles.forEach(p => {
    console.log(`--------------------------------------------------`);
    console.log(`Simulation Profile #${p.id}: ${p.role}`);
    console.log(`Inputs: Region=${p.region}, Category=${p.category}, Main=${p.isMain || false}, Papers=${p.papers !== undefined ? p.papers : 'N/A'}, PreConf=${p.isPreConf || false}, Excursion=${p.isExcursion || false}, Award=${p.isAward || false}`);
    
    const screen = simulateOnScreenCalculator(p);
    const invoice = simulateInvoiceCalculator(p);
    
    console.log(`On-Screen Currency: ${screen.currency}`);
    console.log(`On-Screen Total   : ${screen.total.toFixed(2)}`);
    console.log(`On-Screen Breakdown:`);
    screen.breakdown.forEach(item => {
        console.log(`  - ${item.item}: ${item.fee.toFixed(2)} ${item.currency}`);
    });
    
    if (invoice.error) {
        console.log(`Invoice Status    : ERROR - ${invoice.error}`);
    } else {
        console.log(`Invoice Currency  : ${invoice.currency}`);
        console.log(`Invoice Total     : ${invoice.total.toFixed(2)}`);
        console.log(`Invoice Line Items:`);
        invoice.lineItems.forEach(item => {
            console.log(`  - ${item.description}: ${item.amount !== null ? item.amount.toFixed(2) : 'NOTE'} ${item.amount !== null ? invoice.currency : ''}`);
        });
        
        // Mismatch check (mimics app.js line 1683)
        const mismatch = Math.abs(screen.total - invoice.total) > 0.009;
        if (mismatch) {
            console.log(`\x1b[31m[FAIL] INVOICE Mismatch! Screen Total (${screen.total.toFixed(2)}) !== Invoice Total (${invoice.total.toFixed(2)})\x1b[0m`);
        } else {
            console.log(`\x1b[32m[PASS] Screen and Invoice totals match.\x1b[0m`);
        }
    }
    console.log(`--------------------------------------------------\n`);
});
