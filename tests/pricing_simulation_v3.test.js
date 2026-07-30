const fs = require('fs');

// Pricing engine with custom settings parameter to allow dynamic exchange rates
function runSimulation(p, customSettings) {
    const appSettings = customSettings;
    const isMain = !!p.isMain;
    const isAward = !!p.isAward;
    const isExcursion = !!p.isExcursion;
    const isPreConf = !!p.isPreConf;

    if (!isMain && !isAward && !isExcursion && !isPreConf) {
        return { screenTotal: 0, invoiceTotal: 0, mismatch: false };
    }

    const region = p.region;
    const isLocalRegion = region === 'Local';
    const effectivelyLocal = !region || isLocalRegion;
    const fxRate = appSettings.usd_to_lkr || 320;
    const displayCur = effectivelyLocal ? 'LKR' : 'USD';

    // On-Screen Converter
    const toDisplay = (amount, fromCur) => {
        if (fromCur === displayCur) return amount;
        return displayCur === 'LKR' ? Math.round(amount * fxRate) : +((amount / fxRate).toFixed(2));
    };

    let screenTotal = 0;

    // Screen Calculation: Main Conf
    if (isMain && region && p.category) {
        const catDef = (appSettings.categories || []).find(c => c.label === p.category);
        let baseFee = 0;
        let nativeCur = isLocalRegion ? 'LKR' : 'USD';
        if (catDef) {
            baseFee = isLocalRegion ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
        } else {
            const regionKey = region.toLowerCase().replace(/[^a-z]/g, '');
            const catKey = p.category.toLowerCase().includes('student') ? 'student' : (p.category.toLowerCase().includes('non') ? 'nonauthor' : 'author');
            baseFee = (appSettings.conf_fees?.[regionKey]?.[catKey]) || 0;
        }

        if (!catDef?.is_workshop_only) {
            const papers = parseInt(p.papers) || 1;
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
            screenTotal += toDisplay(confTotal, nativeCur);
        }

        // Screen APC
        if (p.apcSelected && Array.isArray(p.apcSelected)) {
            p.apcSelected.forEach(apc => {
                if (apc.checked && apc.journalId) {
                    const j = appSettings.journals.find(x => x.id === apc.journalId);
                    if (j) {
                        const fee = j.apc_not_applicable ? 0 : (j.fee || 0);
                        screenTotal += toDisplay(fee, 'USD');
                    }
                }
            });
        }
    }

    // Screen Inauguration
    if (isMain && p.includeInauguration) {
        const inaugFee = effectivelyLocal ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = effectivelyLocal ? 'LKR' : 'USD';
        if (inaugFee > 0) screenTotal += toDisplay(inaugFee, inaugCur);
    }

    // Screen Pre-Conference Workshops
    if (isPreConf) {
        const wkTier = p.workshopDiscountTier || 'regular';
        if (p.workshops && Array.isArray(p.workshops)) {
            p.workshops.forEach(wkId => {
                const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === wkId);
                if (sess) {
                    const rawFee = effectivelyLocal ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                    const nativeCur2 = effectivelyLocal ? 'LKR' : 'USD';
                    const discPct = wkTier === 'academic' ? (sess.academic_discount_pct || 0)
                                  : wkTier === 'student'  ? (sess.student_discount_pct  || 0) : 0;
                    const discounted = discPct > 0 ? rawFee * (1 - discPct / 100) : rawFee;
                    const effFee = nativeCur2 === 'LKR' ? Math.round(discounted) : +(discounted.toFixed(2));
                    screenTotal += toDisplay(effFee, nativeCur2);
                }
            });
        }
    }

    // Screen Excellence Award
    if (isAward) {
        const pax = parseInt(p.participantCount) || 1;
        const awardTotal = appSettings.award_fee * pax;
        screenTotal += toDisplay(awardTotal, 'LKR');
    }

    // Screen Excursion
    if (isExcursion) {
        const locCount = parseInt(p.excursionLocalCount) || 0;
        const forCount = parseInt(p.excursionForeignCount) || 0;
        const countLocal = !region || isLocalRegion;
        const countForeign = !region || !isLocalRegion;

        if (locCount > 0 && countLocal) {
            screenTotal += toDisplay(locCount * appSettings.excursion_fees.local, 'LKR');
        }
        if (forCount > 0 && countForeign) {
            screenTotal += toDisplay(forCount * appSettings.excursion_fees.foreigner, 'USD');
        }
    }

    // --- INVOICE GENERATOR CALCULATION ---
    const invoiceCur = isLocalRegion ? 'LKR' : 'USD';
    const toIC = (amount, fromCur) => {
        if (amount === null || amount === undefined) return null;
        if (fromCur === invoiceCur) return amount;
        return invoiceCur === 'LKR' ? Math.round(amount * fxRate) : +((amount / fxRate).toFixed(2));
    };

    let invoiceTotal = 0;
    const addInvItem = (amount, fromCur) => {
        const converted = toIC(amount, fromCur);
        if (converted !== null) invoiceTotal += converted;
    };

    if (isMain && region && p.category) {
        const papers = parseInt(p.papers) || 1;
        const nativeCur = isLocalRegion ? 'LKR' : 'USD';
        const catDef = (appSettings.categories || []).find(c => c.label === p.category);
        const isStudentInv = catDef ? catDef.is_student : p.category.toLowerCase().includes('student');
        const isNoPapersInv = catDef ? catDef.no_papers : p.category.toLowerCase().includes('non');
        const isWorkshopOnlyInv = catDef ? catDef.is_workshop_only : false;

        let baseFee = 0;
        if (catDef) {
            baseFee = isLocalRegion ? catDef.fee_local : (region === 'SAARC' ? catDef.fee_saarc : catDef.fee_nonsaarc);
        } else {
            const rKey = region.toLowerCase().replace(/[^a-z]/g, '');
            const cKey = isStudentInv ? 'student' : (isNoPapersInv ? 'nonauthor' : 'author');
            baseFee = appSettings.conf_fees?.[rKey]?.[cKey] || 0;
        }

        if (isWorkshopOnlyInv) {
            // No conf fee
        } else if (!isNoPapersInv && papers > 0) {
            const hasPaperDiscountInv = catDef ? catDef.paper_discount : true;
            const maxP = appSettings.discounts.discount_max_papers || 0;
            const discPapers = papers > 1 ? (maxP > 0 ? Math.min(papers - 1, maxP) : papers - 1) : 0;
            const fullExtra  = papers > 1 ? (papers - 1 - discPapers) : 0;
            const disc       = (appSettings.discounts.student_from_2nd || 0) / 100;

            let confTotal;
            if (papers === 1) {
                confTotal = baseFee;
            } else if (hasPaperDiscountInv && disc > 0) {
                const discFee = baseFee * (1 - disc);
                confTotal = baseFee + (discFee * discPapers) + (baseFee * fullExtra);
            } else {
                confTotal = baseFee * papers;
            }
            addInvItem(confTotal, nativeCur);

            // Invoice APC
            if (p.apcSelected && Array.isArray(p.apcSelected)) {
                p.apcSelected.forEach(apc => {
                    if (apc.checked && apc.journalId) {
                        const j = appSettings.journals.find(x => x.id === apc.journalId);
                        if (j) {
                            const apcFee = j.apc_not_applicable ? 0 : (j.fee || 0);
                            addInvItem(j.apc_not_applicable ? null : apcFee, 'USD');
                        }
                    }
                });
            }
        } else if (isNoPapersInv) {
            addInvItem(baseFee, nativeCur);
        }
    }

    // Invoice Inauguration
    if (isMain && p.includeInauguration) {
        const inaugFee = isLocalRegion ? (appSettings.inauguration_fee || 0) : (appSettings.inauguration_fee_usd || 0);
        const inaugCur = isLocalRegion ? 'LKR' : 'USD';
        if (inaugFee > 0) addInvItem(inaugFee, inaugCur);
    }

    // Invoice Pre-Conference
    if (isPreConf) {
        const invWkTier = p.workshopDiscountTier || 'regular';
        if (p.workshops && Array.isArray(p.workshops)) {
            p.workshops.forEach(wkId => {
                const sess = (appSettings.pre_conference_sessions || []).find(s => s.id === wkId);
                if (sess) {
                    const rawFee = isLocalRegion ? sess.fee_local : (region === 'SAARC' ? sess.fee_saarc : sess.fee_nonsaarc);
                    const dPct = invWkTier === 'academic' ? (sess.academic_discount_pct || 0)
                               : invWkTier === 'student'  ? (sess.student_discount_pct  || 0) : 0;
                    const discounted = rawFee * (1 - dPct / 100);
                    const effFee = isLocalRegion ? Math.round(discounted) : +(discounted.toFixed(2));
                    addInvItem(effFee, isLocalRegion ? 'LKR' : 'USD');
                }
            });
        }
    }

    // Invoice Award
    if (isAward) {
        const pax = parseInt(p.participantCount) || 1;
        addInvItem(appSettings.award_fee * pax, 'LKR');
    }

    // Invoice Excursion
    if (isExcursion) {
        const locCount = parseInt(p.excursionLocalCount) || 0;
        const forCount = parseInt(p.excursionForeignCount) || 0;
        const countLocalInv = !region || isLocalRegion;
        const countForeignInv = !region || !isLocalRegion;

        if (locCount > 0 && countLocalInv) {
            addInvItem(locCount * appSettings.excursion_fees.local, 'LKR');
        }
        if (forCount > 0 && countForeignInv) {
            addInvItem(forCount * appSettings.excursion_fees.foreigner, 'USD');
        }
    }

    const mismatch = Math.abs(screenTotal - invoiceTotal) > 0.009;

    return {
        screenTotal,
        invoiceTotal,
        mismatch,
        currency: displayCur
    };
}

// Default settings object
const baseSettings = {
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
        { id: 'pcs1', name: 'Quantity Surveying', fee_local: 10000, fee_saarc: 35, fee_nonsaarc: 50, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs2', name: 'Integrated Design', fee_local: 12500, fee_saarc: 40, fee_nonsaarc: 60, academic_discount_pct: 50, student_discount_pct: 100 },
        { id: 'pcs3', name: 'Decarbonization', fee_local: 5000, fee_saarc: 20, fee_nonsaarc: 30, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs4', name: '6G Communication', fee_local: 1500, fee_saarc: 15, fee_nonsaarc: 25, academic_discount_pct: 0, student_discount_pct: 0 },
        { id: 'pcs5', name: 'GIS', fee_local: 8000, fee_saarc: 30, fee_nonsaarc: 40, academic_discount_pct: 0, student_discount_pct: 0 }
    ],
    categories: [
        { id: 'author',           label: 'Author',                fee_local: 15000, fee_saarc: 150, fee_nonsaarc: 250, is_student: false, no_papers: false, paper_discount: true,  is_workshop_only: false },
        { id: 'nonauthor',        label: 'Non-Author',            fee_local: 12000, fee_saarc: 120, fee_nonsaarc: 200, is_student: false, no_papers: true,  paper_discount: false, is_workshop_only: false },
        { id: 'student',          label: 'Student',               fee_local: 10000, fee_saarc: 100, fee_nonsaarc: 150, is_student: true,  no_papers: false, paper_discount: true,  is_workshop_only: false },
        { id: 'workshopattendee', label: 'Workshop Attendee',     fee_local: 0,     fee_saarc: 0,   fee_nonsaarc: 0,   is_student: false, no_papers: true,  paper_discount: false, is_workshop_only: true  }
    ],
    usd_to_lkr: 320
};

// Generate 50 simulations (31 to 80)
const simulations = [];
for (let i = 31; i <= 80; i++) {
    const regionOpts = ["Local", "SAARC", "Non-SAARC"];
    const catOpts = ["Author", "Non-Author", "Student", "Workshop Attendee"];
    
    const region = regionOpts[i % 3];
    const category = catOpts[i % 4];
    
    // Custom configurations per case
    const p = {
        id: i,
        region,
        category,
        isMain: (i % 2 === 0),
        papers: (i % 5) + 1,
        isPreConf: (i % 3 === 0),
        workshopDiscountTier: (i % 3 === 0) ? "academic" : ((i % 3 === 1) ? "student" : "regular"),
        workshops: (i % 3 === 0) ? ["pcs2", "pcs4"] : ["pcs1"],
        isAward: (i % 4 === 0),
        participantCount: (i % 3) + 1,
        isExcursion: (i % 5 === 0),
        excursionLocalCount: (i % 2 === 0) ? 2 : 0,
        excursionForeignCount: (i % 2 === 1) ? 2 : 0,
        includeInauguration: (i % 4 === 0),
        apcSelected: [
            { checked: (i % 3 === 0), journalId: "j1" },
            { checked: (i % 4 === 0), journalId: "j2" }
        ]
    };

    // Edge cases override
    if (i === 40) {
        // Extreme Exchange Rate Test
        p.isMain = true;
        p.isAward = true;
        p.isExcursion = true;
        p.excursionLocalCount = 3;
        p.excursionForeignCount = 3;
        p.exchangeRateOverride = 1000;
    }
    if (i === 50) {
        // High Paper Count with multiple APCs
        p.isMain = true;
        p.papers = 10;
        p.apcSelected = Array(10).fill({ checked: true, journalId: "j1" });
    }
    if (i === 60) {
        // Non-Author with 5 papers mismatch simulation
        p.category = "Non-Author";
        p.isMain = true;
        p.papers = 5;
    }
    if (i === 70) {
        // Negative counts test (though ignored in total, should check if they bypass pricing correctly)
        p.isAward = true;
        p.participantCount = -2;
        p.isExcursion = true;
        p.excursionLocalCount = -5;
    }

    simulations.push(p);
}

console.log("=== RUNNING SIMULATIONS 31 TO 80 ===\n");

simulations.forEach(p => {
    const activeSettings = JSON.parse(JSON.stringify(baseSettings));
    if (p.exchangeRateOverride) {
        activeSettings.usd_to_lkr = p.exchangeRateOverride;
    }

    const res = runSimulation(p, activeSettings);
    
    console.log(`Simulation Profile #${p.id}: Category=${p.category}, Region=${p.region}, Main=${p.isMain}, Papers=${p.papers}, PreConf=${p.isPreConf}, Excursion=${p.isExcursion}, Award=${p.isAward}`);
    console.log(`- Screen Total: ${res.screenTotal.toFixed(2)} ${res.currency}`);
    console.log(`- Invoice Total: ${res.invoiceTotal.toFixed(2)} ${res.currency}`);
    
    if (res.mismatch) {
        console.log(`\x1b[31m- Result: [FAIL] Mismatch found! Difference: ${Math.abs(res.screenTotal - res.invoiceTotal).toFixed(2)} ${res.currency}\x1b[0m`);
    } else {
        console.log(`- Result: [PASS]`);
    }
    console.log("----------------------------------");
});
