
const { pdfToPng } = require("pdf-to-png-converter");
const path = require("path");
const fs = require("fs");

async function test() {
  const pdfPath = "documents/CIRCULAR 11 03 2026.pdf";
  try {
    console.log("Starting conversion...");
    const pngPages = await pdfToPng(pdfPath, {
      pagesToProcess: [1],
      viewportScale: 1.0,
      returnPageContent: true
    });
    console.log("Success! Generated", pngPages.length, "pages");
    if (pngPages[0] && pngPages[0].content) {
       console.log("Base64 length:", pngPages[0].content.toString("base64").length);
    }
  } catch (err) {
    console.error("Conversion failed:", err);
  }
}

test();
