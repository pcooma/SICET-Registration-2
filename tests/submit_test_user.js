const ENDPOINT = 'https://script.google.com/macros/s/AKfycbwCfXzpVmHaW5PoFD5eVU-sD_xewMvczVoHZAURx2DjVpBxY255rzFxsjf4czJbvpC8/exec';

async function main() {
    const randomPart = Math.random().toString(36).slice(2, 10).toUpperCase();
    const invoiceId = 'SICET2026-' + Date.now().toString().slice(-7) + randomPart;
    
    const payload = {
        action: "submitRegistration",
        Full_Name: "Test Automaton QA",
        Email: `sicet.qa.${Date.now()}@example.com`,
        Phone: "+94771234567",
        Organization: "SICET QA Laboratories",
        Attendee_Region: "Local",
        Country: "Sri Lanka",
        Attendee_Category: "Student",
        Attendee_Category_ID: "student",
        Registration_Type: "Main",
        Number_of_Papers: "1",
        Paper_1_ID: "CMT-999",
        Paper_1_Title: "Automated Regression Testing of Pricing Matrices",
        Include_Inauguration: "on",
        Calculated_Total_Fee: "20000",
        Invoice_ID: invoiceId,
        Currency: "LKR"
    };

    console.log(`Submitting test registration with Invoice ID: ${invoiceId}...`);
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            redirect: 'follow'
        });
        
        const result = await response.json();
        console.log("Response:", JSON.stringify(result, null, 2));
    } catch (error) {
        console.error("Submission failed:", error);
    }
}

main();
