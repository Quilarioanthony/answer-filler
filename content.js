(() => {
  if (window.__answerFillerLoaded) return;
  window.__answerFillerLoaded = true;

  const PANEL_ID = 'af-preview-panel';
  let previewElements = [];
  let filledFields = [];

  function groupKey(element) {
    if (element.name) return 'name:' + element.name;
    let node = element.parentElement;
    let hops = 0;
    while (node && node !== document.body && hops < 5) {
      if (node.id || node.tagName === 'FIELDSET' || node.tagName === 'FORM' || node.tagName === 'SECTION') {
        return 'node:' + node.tagName + ':' + (node.id || '');
      }
      node = node.parentElement;
      hops++;
    }
    return 'close:' + (element.parentElement ? element.parentElement.tagName + ':' + (element.parentElement.id || '') : 'root');
  }

  function collectSlots(root) {
    const controls = Array.from(root.querySelectorAll('input, textarea, select')).filter(el => {
      return !el.disabled && el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button';
    });

    const groups = new Map();
    controls.forEach(el => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        const key = groupKey(el);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(el);
      }
    });

    const seen = new Set();
    const slots = [];
    for (const el of controls) {
      if (seen.has(el)) continue;
      if (el.type === 'radio' || el.type === 'checkbox') {
        const members = groups.get(groupKey(el)) || [el];
        members.forEach(member => seen.add(member));
        slots.push({ kind: el.type, elements: members, primary: el });
      } else if (el.tagName === 'SELECT') {
        seen.add(el);
        slots.push({ kind: 'select', elements: [el], primary: el });
      } else {
        seen.add(el);
        slots.push({ kind: 'text', elements: [el], primary: el });
      }
    }
    return slots;
  }

  function labelFor(element) {
    if (element.labels && element.labels.length) {
      const text = element.labels[0].innerText.trim();
      if (text) return text;
    }
    const aria = element.getAttribute('aria-label');
    if (aria) return aria.trim();
    let node = element.parentElement;
    for (let i = 0; node && i < 3; i++) {
      const text = node.innerText.trim();
      if (text && text.length < 160) return text;
      node = node.parentElement;
    }
    return String(element.value || '');
  }

  function optionsFor(elements) {
    return elements.map(el => ({ el, label: labelFor(el), value: String(el.value || '') }));
  }

  function answerValue(answer) {
    const text = String(answer.text || '').trim();
    if (answer.type === 'choice') {
      const derived = /^([A-Ja-j])\s*(?:[\.\)]|[\-\u2013\u2014]|:)\s*(.+)$/.exec(text);
      if (derived) return derived[2].trim();
      if (answer.choice && text !== answer.choice) {
        return text.replace(/^([A-Ja-j])\s*(?:[\.\)]|[\-\u2013\u2014]|:)\s*/, '').trim() || text;
      }
    }
    return text;
  }

  function matchByText(options, text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    const exact = options.find(option => option.label.toLowerCase() === lower || option.value.toLowerCase() === lower);
    if (exact) return exact.el;
    const normalize = value => value.toLowerCase().replace(/[\.\-\u2013\u2014:]/g, ' ').replace(/\s+/g, ' ').trim();
    const wanted = normalize(text);
    const partial = options.find(option => {
      const label = normalize(option.label);
      return label.includes(wanted) || wanted.includes(label);
    });
    return partial ? partial.el : null;
  }

  function findOption(options, answer) {
    const text = String(answer.text || '').trim();
    const derived = /^([A-Ja-j])\s*(?:[\.\)]|[\-\u2013\u2014]|:)\s*/.exec(text);
    const value = String(answer.choice || (derived ? derived[1] : text)).trim();
    if (!value) return null;

    const letterMatch = /^([A-Ja-j])$/.exec(value);
    if (letterMatch) {
      const letter = letterMatch[1].toUpperCase();
      const byLabel = options.find(option => new RegExp('^\\s*' + letter + '[\\.\\)]', 'i').test(option.label));
      if (byLabel) return byLabel.el;
      const index = letter.charCodeAt(0) - 65;
      if (options[index]) return options[index].el;
      return matchByText(options, answerValue(answer));
    }

    const lower = value.toLowerCase();
    const exact = options.find(option => option.label.toLowerCase() === lower || option.value.toLowerCase() === lower);
    if (exact) return exact.el;
    const partial = options.find(option => option.label.toLowerCase().includes(lower) || lower.includes(option.label.toLowerCase()));
    return partial ? partial.el : null;
  }

  function setNativeValue(element, value) {
    let proto;
    if (element.tagName === 'TEXTAREA') proto = HTMLTextAreaElement.prototype;
    else if (element.tagName === 'SELECT') proto = HTMLSelectElement.prototype;
    else proto = HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function markEvent(element, type) {
    element.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function capture(slot) {
    return slot.elements.map(el => ({
      el,
      checked: el.checked,
      value: el.value
    }));
  }

  function applyText(slot, answer) {
    const el = slot.elements[0];
    const value = answerValue(answer);
    if (!value) return false;
    setNativeValue(el, value);
    markEvent(el, 'blur');
    return true;
  }

  function applyRadio(slot, answer) {
    const target = findOption(optionsFor(slot.elements), answer);
    if (!target) return false;
    slot.elements.forEach(el => {
      if (el.checked && el !== target) el.checked = false;
    });
    target.checked = true;
    markEvent(target, 'change');
    markEvent(target, 'click');
    return true;
  }

  function applySelect(slot, answer) {
    const el = slot.elements[0];
    const target = findOption(optionsFor(Array.from(el.options)), answer);
    if (!target) return false;
    setNativeValue(el, target.value);
    markEvent(el, 'change');
    return true;
  }

  function applyCheckbox(slot, answer) {
    const text = String(answer.text || '').trim();
    const derived = /^([A-Ja-j])\s*(?:[\.\)]|[\-\u2013\u2014]|:)\s*/.exec(text);
    const value = String(answer.choice || (derived ? derived[1] : text)).trim();
    const elements = slot.elements;
    const targets = [];

    if (answer.type === 'bool') {
      const isTrue = /^(true|yes)$/i.test(value);
      if (elements.length === 1) {
        if (isTrue) targets.push(elements[0]);
      } else {
        targets.push(elements[isTrue ? 0 : 1] || elements[0]);
      }
    } else {
      const letters = value.split(/[\s,;&]+/).filter(token => /^[A-Ja-j]$/.test(token));
      if (letters.length) {
        letters.forEach(letter => {
          const upper = letter.toUpperCase();
          const byLabel = elements.find(el => new RegExp('^\\s*' + upper + '[\\.\\)]', 'i').test(labelFor(el)));
          targets.push(byLabel || elements[upper.charCodeAt(0) - 65]);
        });
      } else {
        const target = findOption(optionsFor(elements), answer);
        if (target) targets.push(target);
      }
    }

    const unique = Array.from(new Set(targets.filter(Boolean)));
    if (!unique.length) return false;
    unique.forEach(el => {
      if (!el.checked) {
        el.checked = true;
        markEvent(el, 'change');
        markEvent(el, 'click');
      }
    });
    return true;
  }

  function apply(slot, answer) {
    switch (slot.kind) {
      case 'radio': return applyRadio(slot, answer);
      case 'checkbox': return applyCheckbox(slot, answer);
      case 'select': return applySelect(slot, answer);
      default: return applyText(slot, answer);
    }
  }

  function removePreview() {
    previewElements.forEach(el => {
      el.style.outline = '';
      el.style.outlineOffset = '';
    });
    previewElements = [];
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function restoreFills() {
    filledFields.slice().reverse().forEach(entry => {
      if (!entry.el.isConnected) return;
      if ('checked' in entry.el) entry.el.checked = entry.checked;
      entry.el.value = entry.value;
    });
    filledFields = [];
  }

  function showPreviewPanel(rows) {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      zIndex: '2147483647',
      maxWidth: '280px',
      maxHeight: '60vh',
      overflow: 'auto',
      padding: '10px 12px',
      background: '#fff',
      color: '#1f2937',
      border: '1px solid #e5e7eb',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,.15)',
      font: '12px/1.5 Arial, sans-serif'
    });

    const title = document.createElement('strong');
    title.textContent = 'Answer Filler preview';
    panel.appendChild(title);

    const list = document.createElement('div');
    rows.forEach(row => {
      const line = document.createElement('div');
      line.textContent = row;
      list.appendChild(line);
    });
    panel.appendChild(list);

    const note = document.createElement('div');
    note.textContent = 'Outlined fields are matched.';
    note.style.marginTop = '6px';
    note.style.color = '#6b7280';
    panel.appendChild(note);

    document.body.appendChild(panel);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.action) {
        case 'ping':
          sendResponse({ ok: true });
          break;

        case 'preview': {
          removePreview();
          const slots = collectSlots(document);
          const rows = [];
          (message.answers || []).forEach((answer, index) => {
            const slot = slots[index];
            if (!slot) {
              rows.push(`#${index + 1} → (no field on page)`);
              return;
            }
            slot.elements.forEach(el => {
              el.style.outline = '3px solid #2563eb';
              el.style.outlineOffset = '2px';
              previewElements.push(el);
            });
            rows.push(`#${index + 1} → ${answer.text || '(empty)'}`);
          });
          showPreviewPanel(rows);
          sendResponse({ message: `Previewing ${rows.length} assignments over ${slots.length} fields.` });
          break;
        }

        case 'fill': {
          removePreview();
          restoreFills();
          const slots = collectSlots(document);
          const unmatched = [];
          let filled = 0;
          (message.answers || []).forEach((answer, index) => {
            const slot = slots[index];
            if (!slot) {
              unmatched.push(`#${index + 1}: no field`);
              return;
            }
            try {
            const previous = capture(slot);
            if (apply(slot, answer)) {
              filledFields.push(...previous);
              filled++;
            } else {
                unmatched.push(`#${index + 1}: ${answer.text || 'empty'}`);
              }
            } catch (err) {
              unmatched.push(`#${index + 1}: ${err.message}`);
            }
          });
          sendResponse({ filled, slots: slots.length, unmatched });
          break;
        }

        case 'clear': {
          removePreview();
          restoreFills();
          sendResponse({ message: 'Cleared preview and filled fields.' });
          break;
        }

        default:
          sendResponse({ message: 'Unknown action.' });
      }
    } catch (err) {
      sendResponse({ message: 'Error: ' + err.message });
    }
  });
})();
