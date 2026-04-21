
const { pdfToPng } = require("pdf-to-png-converter");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

async function testOllamaVision() {
  const pdfPath = path.resolve(__dirname, "../documents/CIRCULAR 11 03 2026.pdf");
  
  try {
    console.log("1. Testing PDF to PNG conversion...");
    const pngPages = await pdfToPng(pdfPath, {
      pagesToProcess: [1],
      viewportScale: 1.0,
      returnPageContent: true
    });
    console.log("Success! Generated", pngPages.length, "pages");
    
    console.log("2. Testing PNG to JPEG conversion via Canvas...");
    const image = await loadImage(pngPages[0].content);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const jpegBuffer = canvas.toBuffer("image/jpeg");
    const base64Jpeg = jpegBuffer.toString("base64");
    console.log("JPEG Base64 created, length:", base64Jpeg.length);
    
    // Save for manual inspection
    fs.writeFileSync(path.resolve(__dirname, "test_output.jpg"), jpegBuffer);
    console.log("Saved test_output.jpg for inspection");

    console.log("3. Calling Ollama API (gemma4:e2b)...");
    const response = await fetch("http://127.0.0.1:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:e2b",
        prompt: "describe this image, return strictly json",
        format: "json",
        stream: false,
        options: { 
          temperature: 0.1,
          num_ctx: 8192,
          num_predict: 2048,
          repeat_penalty: 1.1,
          top_k: 40,
          top_p: 0.9
        },
        images: [base64Jpeg]
      })
    });

    const body = await response.text();
    console.log("Status:", response.status);
    console.log("Response Body:", body);

  } catch (err) {
    console.error("Test failed:", err);
  }
}

testOllamaVision();
