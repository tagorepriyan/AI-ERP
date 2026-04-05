import sys
import json
import argparse
import logging
import re
from collections import defaultdict
from pathlib import Path

# Suppress debug logs
logging.getLogger("ppocr").setLevel(logging.ERROR)

def norm(text):
    return re.sub(r'\s+', ' ', str(text) or '').strip()

def parse_date(text):
    text = norm(text)
    # Look for DD/MM/YYYY or DD.MM.YYYY
    m = re.search(r'\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b', text)
    if m:
        return m.group(0).replace('.', '/')
    return None

def process_pdf(file_path):
    try:
        import pdfplumber
        import easyocr
        import numpy as np
    except ImportError:
        print(json.dumps({"error": "Missing dependencies. Run: pip install pdfplumber easyocr numpy opencv-python"}))
        sys.exit(1)

    # Initialize EasyOCR (CPU mode, English)
    reader = easyocr.Reader(['en'], gpu=False, verbose=False)

    full_output = []
    
    try:
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages):
                # Always use OCR for structured extraction to maintain high consistency
                img = page.to_image(resolution=160).original
                img_np = np.array(img)
                result = reader.readtext(img_np)
                
                boxes = []
                for bbox, text, prob in result:
                    # EasyOCR bbox: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]
                    pts = np.array(bbox)
                    x1, y1 = float(pts[:,0].min()), float(pts[:,1].min())
                    x2, y2 = float(pts[:,0].max()), float(pts[:,1].max())
                    boxes.append({
                        'x': x1, 
                        'y': y1, 
                        'cx': (x1+x2)/2, 
                        'cy': (y1+y2)/2, 
                        'text': str(text), 
                        'prob': float(prob)
                    })

                # 1. Identify Header Row (Department names)
                # Usually located between y=350 and y=500 in this specific layout
                header_candidates = [b for b in boxes if 350 <= b['y'] <= 550 and len(norm(b['text'])) <= 10]
                header_candidates = [b for b in header_candidates if b['x'] > 150 and not parse_date(b['text'])]
                header_candidates.sort(key=lambda b: b['x'])
                
                # Consolidate overlapping header text (e.g., "MECH", "ENGG")
                col_centers = []
                if header_candidates:
                    current_group = [header_candidates[0]]
                    for next_h in header_candidates[1:]:
                        if abs(next_h['cx'] - current_group[-1]['cx']) < 50:
                            current_group.append(next_h)
                        else:
                            name = " ".join(g['text'] for g in current_group)
                            avg_cx = sum(g['cx'] for g in current_group) / len(current_group)
                            col_centers.append({"name": norm(name), "cx": avg_cx})
                            current_group = [next_h]
                    name = " ".join(g['text'] for g in current_group)
                    avg_cx = sum(g['cx'] for g in current_group) / len(current_group)
                    col_centers.append({"name": norm(name), "cx": avg_cx})

                # 2. Identify Date Anchors (left most column)
                anchors = [b for b in boxes if b['x'] < 140 and parse_date(b['text'])]
                anchors.sort(key=lambda b: b['y'])

                # 3. Build Table Rows
                extracted_rows = []
                for idx, anchor in enumerate(anchors):
                    date_val = parse_date(anchor['text'])
                    start_y = anchor['y'] - 12
                    # End Y is the next anchor or bottom of page
                    end_y = anchors[idx + 1]['y'] - 12 if idx + 1 < len(anchors) else 1200
                    
                    row_boxes = [b for b in boxes if start_y <= b['y'] < end_y and b['x'] > 140]
                    
                    cell_data = defaultdict(list)
                    for b in row_boxes:
                        if not col_centers: continue
                        # Assign to nearest column center
                        match = min(col_centers, key=lambda c: abs(b['cx'] - c['cx']))
                        cell_data[match['name']].append(b)
                    
                    row_obj = {"date": date_val, "time": "9:30 AM", "exams": []}
                    for col in col_centers:
                        parts = sorted(cell_data.get(col['name'], []), key=lambda b: (b['y'], b['x']))
                        text = " ".join(p['text'] for p in parts)
                        if text.strip() and len(text.strip()) > 3:
                            row_obj["exams"].append({
                                "department": col['name'],
                                "subject": norm(text),
                                "code": "" # Will be parsed by Node
                            })
                    
                    if row_obj["exams"]:
                        extracted_rows.append(row_obj)

                full_output.append({
                    "page": page_num + 1,
                    "rows": extracted_rows,
                    "rawText": page.extract_text() or ""
                })

        print(json.dumps({
            "structure_type": "grid_timetable",
            "pages": full_output
        }))

    except Exception as e:
        import traceback
        print(json.dumps({"error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Path to the PDF file")
    args = parser.parse_args()
    process_pdf(args.file)
