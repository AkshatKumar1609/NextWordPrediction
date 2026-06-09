import './style.css';

const API_BASE = '';

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
let ghostSpan        = null;   // the injected ghost <span>
let currentWord      = '';     // text of the current ghost suggestion
let ghostMode        = null;   // 'current' | 'next'  — which API produced the ghost
let debounceTimer    = null;
let abortController  = null;
let isAccepting      = false;  // guard against input re-trigger during accept
let tabHintDismissed = false;  // permanently hide hint after first accept
let tabHintPill      = null;   // DOM ref to the pill element

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
        text += node.tagName === 'BR' ? '\n' : node.textContent;
      }
    }
  }
  return text;
}

/**
 * Extract the last partial word the user is currently typing.
 * Returns '' if the text ends in whitespace (user just finished a word).
 */
function getCurrentPrefix() {
  const text = getUserText();
  // If ends in space/newline, no partial word
  if (/\s$/.test(text)) return '';
  const tokens = text.trim().split(/\s+/);
  return tokens[tokens.length - 1] || '';
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
  ghostMode = null;
  hideTabHintPill();
}

// ─── Tab-hint pill helpers ────────────────────────────────────────
function showTabHintPill() {
  if (tabHintDismissed) return;
  if (!tabHintPill) {
    tabHintPill = document.createElement('div');
    tabHintPill.className = 'tab-hint';
    tabHintPill.setAttribute('aria-label', 'Press Tab to accept prediction');
    tabHintPill.innerHTML = '<kbd class="kbd">Tab ⇥</kbd>';
    editorWrap.appendChild(tabHintPill);
  }
  if (ghostSpan) {
    const wrapRect  = editorWrap.getBoundingClientRect();
    const ghostRect = ghostSpan.getBoundingClientRect();
    const top  = ghostRect.bottom - wrapRect.top + 6;
    const left = ghostRect.left   - wrapRect.left;
    tabHintPill.style.top  = `${top}px`;
    tabHintPill.style.left = `${Math.max(0, left)}px`;
  }
  requestAnimationFrame(() => tabHintPill.classList.add('visible'));
}

function hideTabHintPill() {
  if (tabHintPill) tabHintPill.classList.remove('visible');
}

function dismissTabHintPill() {
  if (tabHintDismissed || !tabHintPill) return;
  tabHintDismissed = true;
  tabHintPill.classList.add('dismissed');
  setTimeout(() => { tabHintPill?.remove(); tabHintPill = null; }, 450);
}

// ─── Insert Ghost ─────────────────────────────────────────────────
/**
 * mode = 'current' → the ghost *replaces* the partial typed prefix visually
 *        (the prefix chars are already in the DOM; ghost shows the full completion)
 * mode = 'next'    → the ghost appends a new word after the current sentence
 */
function insertGhost(word, mode = 'next') {
  removeGhost();
  currentWord = word;
  ghostMode   = mode;

  const rawText = getUserText();

  let displayText;
  if (mode === 'current') {
    // Ghost should show the *completion* beyond what's already typed.
    // e.g. user typed "hel", prefix_map returns "hello" → display "lo"
    const prefix = getCurrentPrefix();
    const completion = word.startsWith(prefix.toLowerCase())
      ? word.slice(prefix.length)   // show only the remaining characters
      : word;                        // fallback: show full word
    displayText = completion;
    if (!displayText) { currentWord = ''; ghostMode = null; return; } // nothing to show
  } else {
    // Next-word mode: append after a space
    const needsSpace = rawText.length > 0 && !/\s$/.test(rawText);
    displayText = (needsSpace ? ' ' : '') + word;
  }

  ghostSpan = document.createElement('span');
  ghostSpan.className = 'ghost';
  ghostSpan.setAttribute('aria-hidden', 'true');
  ghostSpan.textContent = displayText;
  editorBody.appendChild(ghostSpan);

  requestAnimationFrame(showTabHintPill);
}

// ─── Caret helpers ────────────────────────────────────────────────
function setCaretToEnd() {
  const range = document.createRange();
  const sel   = window.getSelection();
  let lastNode = null, lastOffset = 0;

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

  const mode    = ghostMode;
  const rawText = getUserText();

  let insertion;
  if (mode === 'current') {
    // The prefix is already in the DOM. The ghost shows only the tail.
    // We replace the ghost with its tail text + a trailing space.
    insertion = ghostSpan.textContent + ' ';
  } else {
    // Next-word: append "<space>word<space>"
    const needsSpace = rawText.length > 0 && !/\s$/.test(rawText);
    insertion = (needsSpace ? ' ' : '') + currentWord + ' ';
  }

  const textNode = document.createTextNode(insertion);
  editorBody.replaceChild(textNode, ghostSpan);
  ghostSpan = null;

  editorBody.normalize();

  currentWord = '';
  ghostMode   = null;

  dismissTabHintPill();
  setCaretToEnd();
  updateWordCount();

  isAccepting = false;

  // After accepting, immediately ask for the next word
  schedulePredict(300);
}

// ─── Word Counter ─────────────────────────────────────────────────
function updateWordCount() {
  const text  = getUserText().trim();
  const count = text === '' ? 0 : text.split(/\s+/).length;
  wordCounter.textContent = `${count} word${count !== 1 ? 's' : ''}`;
}

// ─── API calls ────────────────────────────────────────────────────
/**
 * Cancel any previous in-flight fetch.
 */
function cancelPending() {
  if (abortController) abortController.abort();
  abortController = new AbortController();
}

/**
 * POST /predictCurrentWord — called while user is mid-word.
 * Sends the current partial prefix and shows a word-completion ghost.
 */
async function fetchCurrentWord(prefix) {
  cancelPending();
  try {
    const res = await fetch(`${API_BASE}/predictCurrentWord`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: prefix }),
      signal:  abortController.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.predicted_word && data.predicted_word !== prefix) {
      insertGhost(data.predicted_word, 'current');
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

/**
 * POST /predictNextWord — called after the user completes a word (space).
 * Sends the full sentence and shows a next-word ghost.
 */
async function fetchNextWord(text) {
  const trimmed = text.trim();
  if (!trimmed) { removeGhost(); return; }
  cancelPending();
  try {
    const res = await fetch(`${API_BASE}/predictNextWord`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: trimmed }),
      signal:  abortController.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.predicted_word) {
      insertGhost(data.predicted_word, 'next');
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

// ─── Debounced scheduler ──────────────────────────────────────────
/**
 * Decide which endpoint to call based on cursor context,
 * then debounce it.
 */
function schedulePredict(delay = 300) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const text   = getUserText();
    const prefix = getCurrentPrefix();

    if (prefix.length >= 1) {
      // User is mid-word with at least 1 char → complete current word
      fetchCurrentWord(prefix);
    } else if (/\s$/.test(text) && text.trim().length > 0) {
      // Text ends in whitespace → predict the next word
      fetchNextWord(text);
    } else {
      removeGhost();
    }
  }, delay);
}

// ─── Input Handler ────────────────────────────────────────────────
editorBody.addEventListener('input', () => {
  if (isAccepting) return;

  removeGhost();
  updateWordCount();

  const text = getUserText();
  if (!text.trim()) { clearTimeout(debounceTimer); return; }

  schedulePredict(300);
});

// ─── Keydown Handler ─────────────────────────────────────────────
editorBody.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    acceptGhost();
    return;
  }
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
