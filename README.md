# Answer Filler

A Chrome/Edge extension that extracts answers from a PDF, Word file, or pasted text and fills form fields on the current webpage.

## Features

- Load `.pdf`, `.docx`, or paste an answer key directly.
- Local extraction only (pdf.js and JSZip are bundled) — no API key, no upload.
- Editable review list: change answer text, type, order, or remove/add entries.
- Preview highlights matched fields before filling.
- Fills radio buttons, text inputs, textareas, checkboxes, and dropdowns.
- Clear page restores the fields it changed.

## Install

1. Download/clone this folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select this folder.

The extension is unpacked, so keep the folder in place.

## Usage

1. Click the Answer Filler icon.
2. Load a PDF/Word file, or expand **Paste answers as text** and click **Use pasted text**.
3. Review the extracted answers and correct anything if needed.
4. Go to the page with the form.
5. Click **Preview** to check matches, then **Fill page**.
6. Click **Clear page** to undo the filled fields.

## How answers are matched

Answers are applied in order: answer 1 fills the first field on the page, answer 2 the second, and so on. Reorder entries in the review list if the page's question order differs from your key.

Supported answer formats include `Answer: B`, `4. D - Theatre`, `B. Black`, `True`/`False`, and `A, C` for multiple checkboxes. You can add your own regular expressions under **Extraction patterns** and click **Re-extract**.

## Notes

- Mapping is sequential, so the answer order must match the order of fields on the page.
- Scanned/image PDFs need OCR first; text-based PDFs work out of the box.
- Custom canvas-based or shadow-DOM quiz widgets may not be detected.
- `test-page.html` is a local form you can use to try the extension.

## Files

- `manifest.json` — extension configuration (Manifest V3).
- `popup.html` / `popup.css` / `popup.js` — popup UI and answer extraction.
- `content.js` — form field detection and filling.
- `lib/` — bundled pdf.js and JSZip.
- `icons/` — extension icons.
