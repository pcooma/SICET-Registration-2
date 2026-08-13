# SICET 2026 Live Simulation and What-If Test Report

Test date: 13 August 2026 (Asia/Colombo)

Live settings version: `a7cf9792-b104-4d22-96f3-a09d7d59091b`

Test identity: `Codex QA Test User`, `sicet.codex.qa.260813@example.com`

Reusable test reference: `SICET2026-CODEXQA260813`

## Four-step decision framework

Every scenario follows at least this forward chain:

1. Input branch: region, category, products, counts, papers, APC, or discount tier.
2. UI branch: visibility, required-field logic, currency, and calculated total.
3. Invoice branch: generated line items and invoice grand total.
4. Backend branch: authoritative recalculation, validation, status, and settings snapshot.
5. Recovery branch: reference/email reload, same-folder upsert, or clear rejection with no overwrite.

Failure branches extend the chain: invalid/tampered input → frontend or backend rejection → existing record preserved → participant can correct and retry.

## 25 pricing and invoice scenarios using current Drive settings

| # | Scenario | Expected UI/invoice value | Result |
|---:|---|---:|---|
| 1 | Local General Author, 1 paper | LKR 25,000.00 | Pass |
| 2 | Local General Author, 2 papers | LKR 47,500.00 | Pass; browser invoice verified |
| 3 | Local General Author, 5 papers; discount cap | LKR 117,500.00 | Pass |
| 4 | SAARC General Author, 1 paper | USD 100.00 | Pass |
| 5 | Non-SAARC General Author, 3 papers | USD 420.00 | Pass |
| 6 | Local Student Author, 1 paper | LKR 12,500.00 | Pass |
| 7 | SAARC Student Author, 2 papers | USD 171.00 | Pass |
| 8 | Non-SAARC Student Author, 4 papers | USD 462.50 | Pass |
| 9 | Local Student Participant non-author with stale 8 papers | LKR 10,000.00 | Pass; flat fee |
| 10 | SAARC General Participant non-author with stale 9 papers | USD 40.00 | Pass; flat fee |
| 11 | Local Author + USD 150 APC | LKR 77,500.00 | Pass at LKR 350/USD |
| 12 | SAARC Author + USD 150 APC | USD 250.00 | Pass |
| 13 | Non-SAARC Author + APC-not-applicable journal | USD 150.00 | Pass; no APC added |
| 14 | Local Student Author + inauguration | LKR 22,500.00 | Pass |
| 15 | SAARC Student Author + inauguration | USD 125.00 | Pass |
| 16 | Local Award, 1 participant | LKR 15,000.00 | Pass |
| 17 | SAARC Award, 2 participants | USD 85.71 | Pass; converted from LKR |
| 18 | Local Excursion, 3 participants | LKR 45,000.00 | Pass |
| 19 | Non-SAARC Excursion, 2 participants | USD 100.00 | Pass |
| 20 | Local Main + Award for 2 | LKR 55,000.00 | Pass |
| 21 | SAARC Student Main 2 papers + Excursion | USD 221.00 | Pass |
| 22 | Non-SAARC Main 2 papers + APC + Award + Excursion | USD 527.86 | Pass; browser invoice verified |
| 23 | Local PCS2 workshop, regular tier | LKR 12,500.00 | Calculation pass; currently hidden by admin setting |
| 24 | SAARC PCS2 workshop, academic 50% | USD 20.00 | Calculation pass; currently hidden by admin setting |
| 25 | Non-SAARC PCS2 workshop, student 100% | USD 0.00 | Calculation pass; live save exposed exact-token defect |

## Real live-backend evidence

- A Local General Author payload deliberately claimed total `0` and currency `USD`. The backend saved `LKR 25,000.00`, `Pending Payment`, proving server authority.
- The same reference was updated to SAARC Student Author + 2 papers + inauguration + Award ×2 + Excursion ×1. It saved `USD 341.71`, `Pending Payment`.
- Both saves used the same Drive folder, proving reference-based upsert despite name and product changes.
- Reload by correct reference/email returned schema version 3, settings version, pricing snapshot, authoritative value, and conditional data.
- Wrong-email lookup and wrong-email update were both rejected.
- Award participant count 0 and Excursion participant count 0 were rejected without overwriting the good record.

## Defect found by the what-if tree

The deployed backend used substring matching. `Pre-Conference Workshops` therefore also matched `Conference Workshops`, and the zero-fee workshop save was rejected with “Select at least one technical workshop during the conference.”

The repository fix now tokenizes `Registration_Type` on `+` and performs exact product matching. Regression tests prove:

- `Pre-Conference Workshops` is not `Conference Workshops`.
- `Main + Conference Workshops` still recognizes the conference-day product.

This fix is not live until the updated `Code.gs` is copied and redeployed again.

## Configuration limitation

Current live settings have `preconf_workshops_hidden: true`, no saved event dates, and no `conference_workshops` list. Therefore participant-facing workshop visibility/expiry and conference-day workshop save/load cannot be declared live-pass yet. Add the dates/items in Admin Settings, save, and rerun those branches after backend redeployment.

## Conclusion

Main conference, regional pricing, paper discounts, APC handling, award, excursion, authoritative backend pricing, reference ownership, same-folder update, and returning load are verified. Workshop calculations are correct, but final live workshop confirmation is conditional on the exact-token backend redeployment and saving the missing workshop configuration.
