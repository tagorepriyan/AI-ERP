const fs = require('fs');

const path = require('path');

async function upload() {
  try {
    const filePath = 'C:\\Users\\tagor\\Documents\\GitHub\\AI-ERP\\documents\\CIRCULAR 11 03 2026.pdf';
    const fileData = fs.readFileSync(filePath);
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="CIRCULAR 11 03 2026.pdf"\r\n`;
    body += `Content-Type: application/pdf\r\n\r\n`;
    
    const bodyBuffer = Buffer.concat([
      Buffer.from(body),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    console.log("Sending request...");
    const req = await fetch('http://localhost:4000/documents/upload', {
      method: 'POST',
      headers: {
        'x-tenant-id': 'default-campus',
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer
    });
    console.log(await req.text());
  } catch (err) {
    console.error(err);
  }
}

upload();
