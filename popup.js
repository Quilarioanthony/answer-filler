const NUMBERED_PATTERN_INDEX = 2;

const DEFAULT_PATTERNS = [
  String.raw`^\s*(?:correct\s+answer|answer\s+key|answer|ans|solution|key)\s*[:#=\-\u2013\u2014]?\s*(?:is\s+)?(.+?)\s*$`,
  String.raw`(?:^|[\s\.\)\]])(?:correct\s+answer|answer\s+key|answer|ans|solution|key)\s*[:#=\-\u2013\u2014]\s*(?:is\s+)?(.+?)\s*$`,
  String.raw`^\s*\d{1,3}\s*[\.\)]\s*([^\?]{1,80}?)\s*$`,
  String.raw`^\s*(?:answer\s*[:#=\-\u2013\u2014]?\s*)?(true|false|yes|no)\s*$`,
  String.raw`^\s*([A-Ea-e])\s*$`
].join('\n');

const STORE_KEY = 'answerFillerState';

const els = {
  sourceInput: document.getElementById('sourceInput'),
  pasteText: document.getElementById('pasteText'),
  usePastedBtn: document.getElementById('usePastedBtn'),
  fileBadge: document.getElementById('fileBadge'),
  reextractBtn: document.getElementById('reextractBtn'),
  patterns: document.getElementById('patterns'),
  resetPatternsBtn: document.getElementById('resetPatternsBtn'),
  addBtn: document.getElementById('addBtn'),
  clearAnswersBtn: document.getElementById('clearAnswersBtn'),
  answerCount: document.getElementById('answerCount'),
  answerList: document.getElementById('answerList'),
  previewBtn: document.getElementById('previewBtn'),
  fillBtn: document.getElementById('fillBtn'),
  clearPageBtn: document.getElementById('clearPageBtn'),
  status: document.getElementById('status')
};

let answers = [];
let lastText = '';
let fileName = '';
let nextId = 1;
let saveTimer = null;

function setStatus(message, kind = '') {
  els.status.textContent = message;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function getPatterns() {
  return els.patterns.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function normalizeAnswer(raw) {
  let text = String(raw).trim();
  text = text.replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,;:]+$/g, '');
  let type = 'text';
  let choice = '';

  const letterWithDetail = /^([A-Ja-j])\s*(?:[\.\)]|[\-\u2013\u2014]|:)\s*(.+)$/.exec(text);
  if (letterWithDetail) {
    type = 'choice';
    choice = letterWithDetail[1].toUpperCase();
  } else if (/^[A-Ja-j]$/.test(text)) {
    type = 'choice';
    choice = text.toUpperCase();
  } else if (/^(true|false|yes|no)$/i.test(text)) {
    type = 'bool';
    text = text.toLowerCase();
  }
  return { text, type, choice };
}

function looksLikeNumberedAnswer(value) {
  if (/^[A-Ea-e]$/.test(value)) return true;
  if (value.length > 60 || /\?$/.test(value) || /\.$/.test(value)) return false;
  if (/^(what|which|where|when|who|why|how|write|name|define|explain|select|choose|pick|list|state|describe|calculate|identify|complete|fill|circle|match|find|give|say|tell)\b/i.test(value)) return false;
  return true;
}

function extractFromText(text) {
  const regexes = [];
  for (const pattern of getPatterns()) {
    try {
      regexes.push(new RegExp(pattern, 'i'));
    } catch (err) {
      setStatus('Bad pattern: ' + pattern + ' — ' + err.message, 'error');
    }
  }

  const found = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/\?\s*$/.test(trimmed) && !/answer|ans|solution|key|correct/i.test(trimmed)) continue;
    for (let index = 0; index < regexes.length; index++) {
      const match = regexes[index].exec(trimmed);
      if (!match || !match[1] || !match[1].trim()) continue;
      if (index === NUMBERED_PATTERN_INDEX && !looksLikeNumberedAnswer(match[1].trim())) continue;
      const normalized = normalizeAnswer(match[1]);
      if (normalized.text) found.push(normalized);
      break;
    }
  }
  return found;
}

async function extractPdfText(buffer) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
  const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = [];
    let current = '';
    let lastY = null;
    for (const item of content.items) {
      if (!item.str) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        if (current.trim()) lines.push(current);
        current = '';
      }
      current += item.str + (item.hasEOL ? '\n' : ' ');
      lastY = y;
    }
    if (current.trim()) lines.push(current);
    pages.push(lines.join('\n'));
  }
  await pdf.destroy();
  return pages.join('\n');
}

function textFromDocxNode(node) {
  let result = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    const name = child.localName || child.nodeName;
    if (name === 't') result += child.textContent;
    else if (name === 'tab') result += '\t';
    else if (name === 'br' || name === 'cr') result += '\n';
    else result += textFromDocxNode(child);
  }
  return result;
}

async function extractDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const documentFile = zip.file('word/document.xml');
  if (!documentFile) throw new Error('This is not a .docx file.');
  const xml = await documentFile.async('string');
  const parsed = new DOMParser().parseFromString(xml, 'application/xml');
  const paragraphs = parsed.getElementsByTagName('w:p');
  const lines = [];
  for (const paragraph of paragraphs) {
    const line = textFromDocxNode(paragraph);
    if (line.trim()) lines.push(line);
  }
  return lines.join('\n');
}

function renderAnswers() {
  els.answerList.replaceChildren();
  els.answerCount.textContent = answers.length;
  els.fillBtn.disabled = answers.length === 0;
  els.previewBtn.disabled = answers.length === 0;
  els.clearPageBtn.disabled = false;

  if (!answers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No answers yet — load a file, paste text, or add one.';
    els.answerList.appendChild(empty);
    return;
  }

  answers.forEach((answer, index) => {
    const row = document.createElement('div');
    row.className = 'answer-row';

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = index + 1;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = answer.text;
    input.placeholder = 'answer';
    input.addEventListener('input', () => {
      const next = normalizeAnswer(input.value);
      answers[index].text = next.text;
      answers[index].type = next.type;
      answers[index].choice = next.choice;
      scheduleSave();
    });

    const type = document.createElement('select');
    for (const option of ['text', 'choice', 'bool']) {
      const opt = document.createElement('option');
      opt.value = option;
      opt.textContent = option;
      type.appendChild(opt);
    }
    type.value = answer.type;
    type.addEventListener('change', () => {
      const normalized = normalizeAnswer(answers[index].text);
      answers[index].type = type.value;
      answers[index].choice = type.value === 'choice'
        ? (normalized.choice || /^([A-Ja-j])/.exec(answers[index].text)?.[1]?.toUpperCase() || '')
        : '';
      scheduleSave();
    });

    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = 'Move up';
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      [answers[index - 1], answers[index]] = [answers[index], answers[index - 1]];
      renderAnswers();
      scheduleSave();
    });

    const down = document.createElement('button');
    down.textContent = '↓';
    down.title = 'Move down';
    down.disabled = index === answers.length - 1;
    down.addEventListener('click', () => {
      [answers[index + 1], answers[index]] = [answers[index], answers[index + 1]];
      renderAnswers();
      scheduleSave();
    });

    const remove = document.createElement('button');
    remove.textContent = '×';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      answers.splice(index, 1);
      renderAnswers();
      scheduleSave();
    });

    row.append(num, input, type, up, down, remove);
    els.answerList.appendChild(row);
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

async function saveState() {
  await chrome.storage.local.set({
    [STORE_KEY]: {
      answers,
      patterns: els.patterns.value,
      lastText,
      fileName,
      pastedText: els.pasteText.value
    }
  });
}

async function loadState() {
  const result = await chrome.storage.local.get(STORE_KEY);
  const saved = result[STORE_KEY];
  if (!saved) {
    els.patterns.value = DEFAULT_PATTERNS;
    return;
  }
  answers = (saved.answers || []).map(a => {
    const normalized = normalizeAnswer(a.text || '');
    return {
      id: nextId++,
      text: normalized.text,
      type: a.type || normalized.type,
      choice: a.choice || normalized.choice
    };
  });
  els.patterns.value = saved.patterns || DEFAULT_PATTERNS;
  els.pasteText.value = saved.pastedText || '';
  lastText = saved.lastText || '';
  fileName = saved.fileName || '';
  if (fileName) {
    els.fileBadge.textContent = fileName;
    els.reextractBtn.disabled = !lastText;
  }
  renderAnswers();
  if (answers.length) setStatus(`Restored ${answers.length} answers.`, 'ok');
}

async function runExtraction() {
  if (!lastText) {
    setStatus('Load a file or paste text first.', 'error');
    return;
  }
  const found = extractFromText(lastText);
  answers = found.map(a => ({ id: nextId++, ...a }));
  renderAnswers();
  await saveState();
  setStatus(`Extracted ${answers.length} answers. Review them, then Fill page.`, 'ok');
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab found.');
  if (/^(chrome|edge|about|devtools):/i.test(tab.url || '')) {
    throw new Error('This browser page cannot be automated.');
  }
  return tab;
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error(message)), milliseconds);
    })
  ]);
}

async function send(action, payload = {}) {
  const tab = await getActiveTab();
  const message = { action, ...payload };
  try {
    return await withTimeout(
      chrome.tabs.sendMessage(tab.id, message),
      5000,
      'The page did not respond. Refresh it and try again.'
    );
  } catch (err) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return withTimeout(
      chrome.tabs.sendMessage(tab.id, message),
      5000,
      'The page did not respond. Refresh it and try again.'
    );
  }
}

els.sourceInput.addEventListener('change', async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  setStatus('Reading ' + file.name + '…');
  try {
    const buffer = await file.arrayBuffer();
    fileName = file.name;
    els.fileBadge.textContent = file.name;
    if (/\.docx$/i.test(file.name)) lastText = await extractDocxText(buffer);
    else if (/\.pdf$/i.test(file.name)) lastText = await extractPdfText(buffer);
    else throw new Error('Only .pdf and .docx files are supported.');
    await runExtraction();
  } catch (err) {
    setStatus('Could not read file: ' + err.message, 'error');
  }
});

els.pasteText.addEventListener('input', scheduleSave);

els.usePastedBtn.addEventListener('click', async () => {
  const text = els.pasteText.value.trim();
  if (!text) {
    setStatus('Paste some text first.', 'error');
    return;
  }
  lastText = text;
  fileName = 'Pasted text';
  els.fileBadge.textContent = fileName;
  await runExtraction();
});

els.reextractBtn.addEventListener('click', () => {
  runExtraction().catch(err => setStatus(err.message, 'error'));
});

els.patterns.addEventListener('input', scheduleSave);

els.resetPatternsBtn.addEventListener('click', () => {
  els.patterns.value = DEFAULT_PATTERNS;
  scheduleSave();
  if (lastText) runExtraction().catch(err => setStatus(err.message, 'error'));
});

els.addBtn.addEventListener('click', () => {
  answers.push({ id: nextId++, text: '', type: 'text' });
  renderAnswers();
  scheduleSave();
  const inputs = els.answerList.querySelectorAll('input');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

els.clearAnswersBtn.addEventListener('click', () => {
  answers = [];
  renderAnswers();
  scheduleSave();
  setStatus('Answer list cleared.');
});

els.previewBtn.addEventListener('click', async () => {
  try {
    const result = await send('preview', { answers });
    setStatus(result.message, 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

els.fillBtn.addEventListener('click', async () => {
  try {
    const result = await send('fill', { answers });
    let message = `Filled ${result.filled} of ${result.slots} fields.`;
    if (result.unmatched.length) message += ' Unmatched: ' + result.unmatched.join('; ');
    setStatus(message, result.filled ? 'ok' : 'error');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

els.clearPageBtn.addEventListener('click', async () => {
  try {
    const result = await send('clear');
    setStatus(result.message, 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

loadState().catch(err => setStatus(err.message, 'error'));
