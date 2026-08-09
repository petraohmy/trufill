const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("fs");

async function main() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 500]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  page.drawText("Sample Bank Account Opening Form", {
    x: 50, y: 450, size: 16, font: bold, color: rgb(0.1, 0.1, 0.1),
  });
  page.drawText("(stand-in form for Sprint 1 — real bank forms pending audit)", {
    x: 50, y: 430, size: 9, font, color: rgb(0.4, 0.4, 0.4),
  });

  const fields = [
    ["full_name", "Full Name"],
    ["date_of_birth", "Date of Birth"],
    ["phone_number", "Phone Number"],
    ["residential_address", "Residential Address"],
    ["employer_name", "Employer's Name"],
    ["source_of_funds", "Source of Funds"],
  ];

  let y = 390;
  for (const [name, label] of fields) {
    page.drawText(label, { x: 50, y: y + 16, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
    const textField = form.createTextField(name);
    textField.addToPage(page, { x: 50, y, width: 400, height: 22, borderWidth: 1 });
    y -= 55;
  }

  const bytes = await doc.save();
  fs.writeFileSync(__dirname + "/public/sample-form.pdf", bytes);
  console.log("sample-form.pdf written with fields:", fields.map(f => f[0]).join(", "));
}

main().catch((e) => { console.error(e); process.exit(1); });
