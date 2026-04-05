import sys
import json
import argparse
import logging
import numpy as np

# Suppress debug logs
logging.getLogger("ppocr").setLevel(logging.ERROR)

def process_pdf(file_path):
    try:
        import pdfplumber
        import easyocr
    except ImportError:
        print(json.dumps({"error": "Missing dependencies. Run: pip install pdfplumber easyocr numpy opencv-python"}))
        sys.exit(1)

    # Initialize EasyOCR (CPU mode, English)
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)

    full_text = []

    try:
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page_num, page in enumerate(pdf.pages):
                page_text = []
                
                # Method 1: Try Native PDF Text Extraction (Fastest)
                text = page.extract_text()
                
                if text and len(text.strip()) > 50:
                    # It's a digital PDF!
                    page_text.append(text)
                    
                    # Also try to extract native tables to Markdown format
                    tables = page.extract_tables()
                    for table in tables:
                        if table:
                            page_text.append("\n[Detected Table]")
                            for row in table:
                                # Clean cells
                                clean_row = [str(cell).replace('\n', ' ') if cell is not None else "" for cell in row]
                                page_text.append(" | ".join(clean_row))
                            page_text.append("[End Table]\n")
                else:
                    # Method 2: Scanned PDF -> Fallback to EasyOCR
                    # Convert pdfplumber page to image
                    img = page.to_image(resolution=200).original
                    # Convert PIL image to numpy array for EasyOCR
                    img_np = np.array(img)
                    
                    # Run OCR
                    result = reader.readtext(img_np)
                    
                    if result:
                        page_text.append("\n[Scanned Page OCR]")
                        for (bbox, text, prob) in result:
                            if text:
                                page_text.append(text)
                
                full_text.append(f"--- PAGE {page_num + 1} ---\n" + "\n".join(page_text))
                
        output = {
            "pageCount": page_count,
            "rawText": "\n\n".join(full_text)
        }
        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to the PDF file")
    args = parser.parse_args()
    process_pdf(args.file)
