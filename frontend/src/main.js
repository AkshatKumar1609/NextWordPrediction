import './style.css';

const API_BASE = 'http://localhost:8000';

// ─── DOM ─────────────────────────────────────────────────────────
document.getElementById('app').innerHTML = `
  <header class="header">
    <a href="/" class="brand" aria-label="Wordflow home">
      <div class="brand__mark">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1.5 11 L4 4.5 L7 9 L9.5 5.5 L12.5 11"
                stroke="white" stroke-width="1.7"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <span class="brand__name">Wordflow</span>
    </a>
    <div class="status" id="statusBar" aria-live="polite">
      <div class="status__dot" id="statusDot"></div>
      <span id="statusText">Connecting</span>
    </div>
  </header>

  <div class="editor-region" id="editorRegion">
    <div class="editor-column">

      <input
        id="docTitle"
        class="doc-title"
        type="text"
        placeholder="Untitled"
        aria-label="Document title"
        autocomplete="off"
        spellcheck="false"
      />

      <div class="doc-divider" aria-hidden="true"></div>

      <div class="editor-wrap" id="editorWrap">
        <div
          id="editorBody"
          class="editor-body"
          contenteditable="true"
          role="textbox"
          aria-multiline="true"
          aria-label="Writing area — press Tab to accept prediction"
          data-placeholder="Begin writing here…"
          spellcheck="true"
        ></div>
        <!-- tab-hint pill: injected here, positioned absolutely near ghost -->
      </div>

    </div>
  </div>

  <!-- word counter: fixed bottom-right via CSS -->
  <div class="word-counter" id="wordCounter" aria-live="polite">0 words</div>
`;

// ─── Refs ─────────────────────────────────────────────────────────
const editorBody  = document.getElementById('editorBody');
const editorWrap  = document.getElementById('editorWrap');
const statusDot   = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const wordCounter = document.getElementById('wordCounter');

// ─── State ────────────────────────────────────────────────────────
let ghostSpan          = null;   // the injected ghost <span>
let currentWord        = '';     // text of the current ghost suggestion
let debounceTimer      = null;
let abortController    = null;
let isAccepting        = false;  // guard against input re-trigger during accept
let tabHintDismissed   = false;  // permanently hide hint after first accept
let tabHintPill        = null;   // DOM ref to the pill element

// ─── Status ───────────────────────────────────────────────────────
function setStatus(state, label) {
  statusDot.className = `status__dot${
    state === 'ready' ? ' ready' : state === 'error' ? ' error' : ''
  }`;
  statusText.textContent = label;
}

// ─── Health check ─────────────────────────────────────────────────
async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    setStatus(res.ok ? 'ready' : 'error', res.ok ? 'Model ready' : 'API error');
  } catch {
    setStatus('error', 'Backend offline');
  }
}

// ─── Ghost Text Helpers ───────────────────────────────────────────
/**
 * Return the raw user text (everything NOT inside a .ghost span).
 */
function getUserText() {
  let text = '';
  for (const node of editorBody.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (!node.classList.contains('ghost')) {
        // could be a <br> (enter key) or other element
        text += node.tagName === 'BR' ? '\n' : node.textContent;
      }
    }
  }
  return text;
}

/**
 * Remove existing ghost span if present.
 */
function removeGhost() {
  if (ghostSpan && ghostSpan.parentNode === editorBody) {
    editorBody.removeChild(ghostSpan);
  }
  ghostSpan = null;
  currentWord = '';
  hideTabHintPill();
}

// ─── Tab-hint pill helpers ───────────────────────────────────────
/**
 * Show the pill hint for the first ghost prediction ever shown.
 * After user has accepted once it is never shown again.
 */
function showTabHintPill() {
  if (tabHintDismissed) return;
  if (!tabHintPill) {
    tabHintPill = document.createElement('div');
    tabHintPill.className = 'tab-hint';
    tabHintPill.setAttribute('aria-label', 'Press Tab to accept prediction');
    tabHintPill.innerHTML = '<kbd class="kbd">Tab ⇥</kbd>';
    editorWrap.appendChild(tabHintPill);
  }
  // Position pill below the ghost span using getBoundingClientRect
  if (ghostSpan) {
    const wrapRect  = editorWrap.getBoundingClientRect();
    const ghostRect = ghostSpan.getBoundingClientRect();
    const top  = ghostRect.bottom - wrapRect.top + 6;
    const left = ghostRect.left   - wrapRect.left;
    tabHintPill.style.top  = `${top}px`;
    tabHintPill.style.left = `${Math.max(0, left)}px`;
  }
  // Trigger transition
  requestAnimationFrame(() => tabHintPill.classList.add('visible'));
}

function hideTabHintPill() {
  if (tabHintPill) {
    tabHintPill.classList.remove('visible');
  }
}

function dismissTabHintPill() {
  if (tabHintDismissed || !tabHintPill) return;
  tabHintDismissed = true;
  tabHintPill.classList.add('dismissed');
  // Remove from DOM after animation completes
  setTimeout(() => {
    tabHintPill?.remove();
    tabHintPill = null;
  }, 450);
}

/**
 * Insert ghost span at the very end of editorBody.
 * Adds a leading space if the text doesn't already end in whitespace.
 */
function insertGhost(word) {
  removeGhost();
  currentWord = word;

  const rawText = getUserText();
  const needsSpace = rawText.length > 0 && !/\s$/.test(rawText);
  const displayText = (needsSpace ? ' ' : '') + word;

  ghostSpan = document.createElement('span');
  ghostSpan.className = 'ghost';
  ghostSpan.setAttribute('aria-hidden', 'true');
  ghostSpan.textContent = displayText;
  editorBody.appendChild(ghostSpan);

  // Show the one-time onboarding pill after ghost renders
  requestAnimationFrame(showTabHintPill);
}

// ─── Caret / Selection helpers ────────────────────────────────────
/**
 * Move the caret to the absolute character offset `pos` within editorBody,
 * counting only non-ghost nodes.
 */
function setCaretToEnd() {
  const range = document.createRange();
  const sel   = window.getSelection();
  // Find the last text node that is NOT inside the ghost span
  let lastNode = null;
  let lastOffset = 0;

  for (const node of editorBody.childNodes) {
    if (node === ghostSpan) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      lastNode = node;
      lastOffset = node.textContent.length;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
      const text = node.firstChild;
      if (text && text.nodeType === Node.TEXT_NODE) {
        lastNode = text;
        lastOffset = text.textContent.length;
      }
    }
  }

  if (lastNode) {
    range.setStart(lastNode, lastOffset);
  } else {
    range.setStart(editorBody, editorBody.childNodes.length - (ghostSpan ? 1 : 0));
  }
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ─── Accept Ghost Word ────────────────────────────────────────────
function acceptGhost() {
  if (!currentWord || !ghostSpan) return;

  isAccepting = true;

  const rawText    = getUserText();
  const needsSpace = rawText.length > 0 && !/\s$/.test(rawText);
  const insertion  = (needsSpace ? ' ' : '') + currentWord + ' ';

  // Replace ghost span with plain text node
  const textNode = document.createTextNode(insertion);
  editorBody.replaceChild(textNode, ghostSpan);
  ghostSpan = null;

  // Merge all adjacent text nodes to keep DOM tidy
  editorBody.normalize();

  currentWord = '';

  // Permanently dismiss the onboarding pill on first successful accept
  dismissTabHintPill();

  // Restore caret to end
  setCaretToEnd();

  updateWordCount();

  isAccepting = false;

  // Immediately request next prediction
  schedulePredict(getUserText(), 80);
}

// ─── Word Counter ─────────────────────────────────────────────────
function updateWordCount() {
  const text  = getUserText().trim();
  const count = text === '' ? 0 : text.split(/\s+/).length;
  wordCounter.textContent = `${count} word${count !== 1 ? 's' : ''}`;
}

// ─── Fetch Prediction ─────────────────────────────────────────────
async function fetchPrediction(text) {
  const trimmed = text.trim();
  if (!trimmed) { removeGhost(); return; }

  // Cancel previous in-flight request
  if (abortController) abortController.abort();
  abortController = new AbortController();

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: trimmed }),
      signal:  abortController.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();

    if (data.predicted_word) {
      insertGhost(data.predicted_word);
      setStatus('ready', 'Model ready');
    } else {
      removeGhost();
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    removeGhost();
    setStatus('error', 'Prediction failed');
  }
}

function schedulePredict(text, delay = 300) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => fetchPrediction(text), delay);
}

// ─── Input Handler ────────────────────────────────────────────────
editorBody.addEventListener('input', () => {
  if (isAccepting) return;

  // Always strip ghost on any new input
  removeGhost();
  updateWordCount();

  const text = getUserText();
  if (!text.trim()) { clearTimeout(debounceTimer); return; }

  schedulePredict(text, 300);
});

// ─── Keydown Handler ─────────────────────────────────────────────
editorBody.addEventListener('keydown', (e) => {
  // Tab → accept ghost
  if (e.key === 'Tab') {
    e.preventDefault();
    acceptGhost();
    return;
  }

  // Escape → dismiss ghost without accepting
  if (e.key === 'Escape') {
    removeGhost();
    if (abortController) abortController.abort();
    clearTimeout(debounceTimer);
    return;
  }
});

// ─── Paste: strip rich formatting ─────────────────────────────────
editorBody.addEventListener('paste', (e) => {
  e.preventDefault();
  const plain = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, plain);
});

// ─── Init ─────────────────────────────────────────────────────────
checkHealth();
editorBody.focus();
