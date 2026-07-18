# SICET Invoice Pricing Reconciliation

Test date: 18 July 2026

## Method

Each scenario was checked using two independent ledgers:

1. Manual ledger: arithmetic performed directly from the active Google Drive settings and the scenario's applicable rules.
2. Application ledger: on-screen fee breakdown, generated PDF line items, PDF currency, and PDF grand total.

The actual generated PDFs were extracted and rendered for a basic local case and a complex international case. Both were one-page A4 documents with readable, non-overlapping line items.

## Active fee rules used

- Currency: Local = LKR; SAARC and Non-SAARC = USD.
- Exchange rate: USD 1 = LKR 320.
- Extra-paper discount: 10% on papers 2–4; papers after the third discounted extra paper are full price.
- Author: LKR 15,000 / SAARC USD 150 / Non-SAARC USD 250.
- Non-Author: LKR 12,000 / SAARC USD 120 / Non-SAARC USD 200; no papers.
- Student: LKR 10,000 / SAARC USD 100 / Non-SAARC USD 150.
- Award: LKR 10,000 per person.
- Excursion: Local LKR 15,000; international USD 50.
- Inauguration: Local LKR 10,000; international USD 30.
- Integrated Design workshop: Local LKR 12,500 / SAARC USD 40 / Non-SAARC USD 60; academic discount 50%, student discount 100%.
- APC collection was disabled, so APC fees were correctly excluded from all invoices.

## Reconciled scenarios

| Case | Manual ledger | Expected | Screen | PDF | Result |
|---|---|---:|---:|---:|---|
| Local Author, Main, 1 paper | 15,000 | LKR 15,000.00 | LKR 15,000.00 | LKR 15,000.00 | Pass |
| SAARC Author, Main, 2 papers | 150 + 135 | USD 285.00 | USD 285.00 | USD 285.00 | Pass |
| SAARC Author, Main, 5 papers | 150 + 3 x 135 + 150 | USD 705.00 | USD 705.00 | USD 705.00 | Pass |
| Non-SAARC Student, Main, 2 papers, inauguration, academic workshop, award x2, excursion x2 | 150 + 135 + 30 + 30 + (2 x 10,000 / 320) + (2 x 50) | USD 507.50 | USD 507.50 | USD 507.50 | Pass |
| Non-SAARC Workshop Attendee, 100% student workshop discount | 0 conference + (60 x 0%) | USD 0.00 | USD 0.00 | USD 0.00 | Pass |
| Local Non-Author, Main, academic workshop, award x1, excursion x3 | 12,000 + 6,250 + 10,000 + 45,000 | LKR 73,250.00 | LKR 73,250.00 | LKR 73,250.00 | Pass |

## Defects found and corrected

1. Invoice generation could bypass the normal required-field validation because it is triggered by a button rather than form submission. Core attendee profile fields are now validated before invoice construction.
2. Workshop discounts used whole-number rounding for both currencies. USD discounted fees now preserve two decimal places; LKR remains rounded to a whole rupee.
3. The screen calculator and PDF builder had no enforced reconciliation. Invoice generation now stops if screen currency or total differs from the PDF line-item model by more than 0.009.
4. The frontend asset version was increased so browsers do not continue using the previous invoice logic.

## Verified invoice contents

- Invoice number and date
- Issuer and bill-to identity
- Attendee category and region
- Paper count, discount description, and paper titles
- Inauguration inclusion only when selected with Main Conference
- Workshop name, tier, and discount
- Award category and participant count
- Excursion ticket type, count, and unit price
- One consistent invoice currency
- Grand total matching the displayed quotation
- Bank account, SWIFT code, payment reference instruction, gateway, and refund deadline

## Remaining control recommendation

The browser now prevents quotation/PDF divergence, but long-term financial integrity should use one shared fee engine on the backend. The backend should recalculate and store the authoritative total from product IDs and settings rather than accepting the browser's quoted amount.

## Additional 20-combination matrix

One test identity (`R. Fernando`) was used for all cases. These cases do not duplicate the original six scenarios. Every invoice was generated in an isolated localhost audit mode that disables draft persistence and live backend writes.

| # | New combination | Manual expected | Screen | Invoice | Result |
|---:|---|---:|---:|---:|---|
| 1 | Local Student, Main, 1 paper, inauguration | LKR 20,000.00 | LKR 20,000.00 | LKR 20,000.00 | Pass |
| 2 | Local Student, Main, 3 papers | LKR 28,000.00 | LKR 28,000.00 | LKR 28,000.00 | Pass |
| 3 | Local Author, Main, 4 papers | LKR 55,500.00 | LKR 55,500.00 | LKR 55,500.00 | Pass |
| 4 | Local Non-Author, Main only | LKR 12,000.00 | LKR 12,000.00 | LKR 12,000.00 | Pass |
| 5 | SAARC Non-Author, Main only | USD 120.00 | USD 120.00 | USD 120.00 | Pass |
| 6 | Non-SAARC Author, Main, 1 paper | USD 250.00 | USD 250.00 | USD 250.00 | Pass |
| 7 | Non-SAARC Author, Main, 4 papers | USD 925.00 | USD 925.00 | USD 925.00 | Pass |
| 8 | SAARC Student, Main, 3 papers, inauguration | USD 310.00 | USD 310.00 | USD 310.00 | Pass |
| 9 | Local Award only, 3 participants | LKR 30,000.00 | LKR 30,000.00 | LKR 30,000.00 | Pass |
| 10 | Non-SAARC Award only, 1 participant | USD 31.25 | USD 31.25 | USD 31.25 | Pass |
| 11 | SAARC Excursion only, 4 tickets | USD 200.00 | USD 200.00 | USD 200.00 | Pass |
| 12 | Local Excursion only, 2 tickets | LKR 30,000.00 | LKR 30,000.00 | LKR 30,000.00 | Pass |
| 13 | Local Workshop Attendee, QS Digitalisation regular rate | LKR 10,000.00 | LKR 10,000.00 | LKR 10,000.00 | Pass |
| 14 | SAARC Workshop Attendee, Decarbonization + 6G | USD 35.00 | USD 35.00 | USD 35.00 | Pass |
| 15 | Non-SAARC Workshop Attendee, QS Digitalisation + GIS | USD 90.00 | USD 90.00 | USD 90.00 | Pass |
| 16 | Local Workshop Attendee, Integrated Design academic rate | LKR 6,250.00 | LKR 6,250.00 | LKR 6,250.00 | Pass |
| 17 | SAARC Workshop Attendee, Integrated Design student rate | USD 0.00 | USD 0.00 | USD 0.00 | Pass |
| 18 | Non-SAARC Author, Main 1 paper + Award 1 | USD 281.25 | USD 281.25 | USD 281.25 | Pass |
| 19 | Local Student, Main 2 papers + inauguration + Excursion 1 | LKR 44,000.00 | LKR 44,000.00 | LKR 44,000.00 | Pass |
| 20 | SAARC Author, Main 1 + QS Digitalisation + Decarbonization + Excursion 1 | USD 255.00 | USD 255.00 | USD 255.00 | Pass |

### Additional issues found during matrix review

- The payment instructions displayed a hard-coded `1 USD = 325 LKR`, while the authoritative Drive setting and invoice conversion used 320. The notice now reads the dynamic setting.
- Frontend fallback settings contained an outdated category/workshop schedule, exchange rate, excursion price, and refund year. They now mirror the current Drive configuration, preventing incorrect quotations on a first-run fallback.
- Local audit runs previously followed the normal draft-save path. Explicit localhost audit mode now disables draft storage and backend writes so pricing regression tests cannot pollute live registrations.
