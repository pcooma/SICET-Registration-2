const assert = require('node:assert/strict');

const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwCfXzpVmHaW5PoFD5eVU-sD_xewMvczVoHZAURx2DjVpBxY255rzFxsjf4czJbvpC8/exec';

function total(p, s) {
  const local = p.region === 'Local';
  const currency = local ? 'LKR' : 'USD';
  const convert = (amount, from) => from === currency ? amount : (local ? Math.round(amount * s.usd_to_lkr) : +(amount / s.usd_to_lkr).toFixed(2));
  const category = s.categories.find(c => c.id === p.category);
  let value = 0;
  if (p.main && !category.is_workshop_only) {
    const base = +(local ? category.fee_local : p.region === 'SAARC' ? category.fee_saarc : category.fee_nonsaarc);
    const papers = category.no_papers ? 1 : Math.max(1, p.papers || 1);
    const eligible = category.paper_discount && papers > 1;
    const discounted = eligible ? Math.min(papers - 1, s.discounts.discount_max_papers || papers - 1) : 0;
    value += base + discounted * base * (1 - s.discounts.student_from_2nd / 100) + (papers - 1 - discounted) * base;
    for (const journalId of p.apcs || []) {
      const journal = s.journals.find(j => j.id === journalId);
      if (journal && !journal.apc_not_applicable) value += convert(+journal.fee, 'USD');
    }
    if (p.inauguration) value += +(local ? s.inauguration_fee : s.inauguration_fee_usd);
  }
  for (const workshopId of p.workshops || []) {
    const workshop = s.pre_conference_sessions.find(w => w.id === workshopId);
    const raw = +(local ? workshop.fee_local : p.region === 'SAARC' ? workshop.fee_saarc : workshop.fee_nonsaarc);
    const pct = p.tier === 'student' ? +(workshop.student_discount_pct || 0) : p.tier === 'academic' ? +(workshop.academic_discount_pct || 0) : 0;
    value += local ? Math.round(raw * (1 - pct / 100)) : +(raw * (1 - pct / 100)).toFixed(2);
  }
  if (p.award) value += convert(s.award_fee * p.awardPax, 'LKR');
  if (p.excursion) value += local ? s.excursion_fees.local * p.excursionPax : s.excursion_fees.foreigner * p.excursionPax;
  return { total: +value.toFixed(2), currency };
}

const profiles = [
  ['Local general author 1 paper', {region:'Local',category:'author',main:true,papers:1}],
  ['Local general author 2 papers', {region:'Local',category:'author',main:true,papers:2}],
  ['Local general author 5 papers cap', {region:'Local',category:'author',main:true,papers:5}],
  ['SAARC general author 1 paper', {region:'SAARC',category:'author',main:true,papers:1}],
  ['Non-SAARC general author 3 papers', {region:'Non-SAARC',category:'author',main:true,papers:3}],
  ['Local student author 1 paper', {region:'Local',category:'student',main:true,papers:1}],
  ['SAARC student author 2 papers', {region:'SAARC',category:'student',main:true,papers:2}],
  ['Non-SAARC student author 4 papers', {region:'Non-SAARC',category:'student',main:true,papers:4}],
  ['Local student non-author flat', {region:'Local',category:'nonauthor',main:true,papers:8}],
  ['SAARC general non-author flat', {region:'SAARC',category:'cat_1785389812169',main:true,papers:9}],
  ['Local author paid APC', {region:'Local',category:'author',main:true,papers:1,apcs:['jc1rfbxfn4']}],
  ['SAARC author paid APC', {region:'SAARC',category:'author',main:true,papers:1,apcs:['jc1rfbxfn4']}],
  ['Non-SAARC author APC not applicable', {region:'Non-SAARC',category:'author',main:true,papers:1,apcs:['j0dwcyvfbb']}],
  ['Local student inauguration', {region:'Local',category:'student',main:true,papers:1,inauguration:true}],
  ['SAARC student inauguration', {region:'SAARC',category:'student',main:true,papers:1,inauguration:true}],
  ['Local award 1', {region:'Local',category:'author',award:true,awardPax:1}],
  ['SAARC award 2 conversion', {region:'SAARC',category:'author',award:true,awardPax:2}],
  ['Local excursion 3', {region:'Local',category:'author',excursion:true,excursionPax:3}],
  ['Non-SAARC excursion 2', {region:'Non-SAARC',category:'author',excursion:true,excursionPax:2}],
  ['Local main plus award', {region:'Local',category:'author',main:true,papers:1,award:true,awardPax:2}],
  ['SAARC main plus excursion', {region:'SAARC',category:'student',main:true,papers:2,excursion:true,excursionPax:1}],
  ['Non-SAARC full combination', {region:'Non-SAARC',category:'author',main:true,papers:2,apcs:['jc1rfbxfn4'],award:true,awardPax:1,excursion:true,excursionPax:1}],
  ['Local workshop regular', {region:'Local',category:'author',workshops:['pcs2'],tier:'regular'}],
  ['SAARC workshop academic', {region:'SAARC',category:'author',workshops:['pcs2'],tier:'academic'}],
  ['Non-SAARC workshop student free', {region:'Non-SAARC',category:'student',workshops:['pcs2'],tier:'student'}]
];

async function main() {
  const settingsResponse = await fetch(ENDPOINT + '?action=getSettings', {redirect:'follow'}).then(r => r.json());
  assert.equal(settingsResponse.success, true);
  const settings = settingsResponse.settings;
  const results = profiles.map(([name, profile], index) => ({id:index + 1,name,...total(profile, settings)}));
  results.forEach(result => assert.ok(Number.isFinite(result.total) && result.total >= 0));
  assert.equal(results.length, 25);
  console.log(JSON.stringify({settingsVersion:settings._meta?.version, results}, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
