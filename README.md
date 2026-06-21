# Wordflow — Inline Next-Word Prediction

> A distraction-free writing editor with AI-powered, real-time next-word prediction inspired by the ghost-text UX of modern code editors — brought to prose writing.

Wordflow is a minimal writing tool that predicts your next word as you type, surfacing suggestions as inline "ghost text" directly inside a clean editor. It combines a deep-learning LSTM model for sentence-level next-word prediction with a lightning-fast frequency-based prefix map for live word-completion — all served through a FastAPI backend and a zero-framework Vite frontend.

---

## Key Features

- **Dual-mode prediction** — switches automatically between *word completion* (mid-word prefix lookup) and *next-word prediction* (post-sentence LSTM inference)
- **Ghost-text UX** — suggestions appear inline as styled ghost text; press `Tab ⇥` to accept, `Esc` to dismiss — zero UI chrome
- **First-use `Tab` hint pill** — a subtle onboarding pill floats alongside the first ghost suggestion and self-dismisses after one acceptance
- **Debounced & cancellable requests** — uses `AbortController` to cancel in-flight fetches on each keystroke, preventing stale suggestions
- **Live connection status** — animated pulsing dot in the header reflects backend health (`/health` endpoint polled on load)
- **Word counter** — fixed-position, non-intrusive word count updates in real time
- **Rich-text paste guard** — strips HTML formatting on paste, keeping the editor plain-text only
- **Responsive design** — editor column constrained to a comfortable 700 px reading width with mobile breakpoints
- **Production-ready serving** — FastAPI mounts the Vite `dist/` build as a static site, making the entire app a single `uvicorn` process

---

## Tech Stack

| Layer | Technology |
|---|---|
| **ML Model** | TensorFlow / Keras 2.10 — LSTM-based sequence model (`.keras`) |
| **Tokenization** | Keras `Tokenizer` (serialized as `tokenizer.pkl`) |
| **Prefix Completion** | Frequency-ranked prefix map built from `unigram_freq.csv` (serialized as `prefix_map.pkl`) |
| **Backend** | Python · FastAPI 0.115 · Uvicorn 0.30 · Pydantic v1 |
| **Numerics** | NumPy 1.23 |
| **Frontend** | Vanilla JavaScript (ES Modules) · Vite 8 |
| **Styling** | Vanilla CSS · CSS custom properties · Google Fonts (Merriweather + Inter) |
| **Dev Proxy** | Vite dev server proxying `/predict*` routes to `localhost:8000` |

---

## Architecture & Project Structure

```
NextWordPrediction/
├── backend/
│   ├── main.py            # FastAPI app — /health, /predictCurrentWord, /predictNextWord
│   ├── prefix_map.py      # One-off script: builds prefix_map.pkl from unigram_freq.csv
│   ├── model.keras        # Trained LSTM model (~51 MB)
│   ├── tokenizer.pkl      # Keras Tokenizer (~870 KB)
│   ├── prefix_map.pkl     # Prefix → most-frequent-word lookup (~9.5 MB)
│   ├── dataset.txt        # Raw training corpus (~3.3 MB)
│   ├── unigram_freq.csv   # Word frequency list used to build prefix_map
│   ├── next_word.ipynb    # Training notebook (EDA → model training → export)
│   └── requirements.txt
└── frontend/
    ├── index.html         # Entry point — loads Google Fonts, sets meta/title
    ├── vite.config.js     # Vite config with /predict* → :8000 dev proxy
    ├── package.json
    └── src/
        ├── main.js        # All editor logic: ghost text, API calls, keybindings
        └── style.css      # Design system — CSS variables, ghost span, tab-hint pill
```

### Request Flow

```
User types
    │
    ├─► mid-word (prefix ≥ 1 char)
    │       └─► POST /predictCurrentWord  →  prefix_map.pkl  →  ghost (word-completion mode)
    │
    └─► word boundary (trailing space)
            └─► POST /predictNextWord  →  LSTM model.keras  →  ghost (next-word mode)

User presses Tab  →  ghost accepted, trailing space appended, next prediction triggered
User presses Esc  →  ghost removed, pending fetch aborted
```

---

## Getting Started

### Prerequisites

- Python 3.9+
- Node.js 18+ & npm

### 1. Clone the repository

```bash
git clone https://github.com/AkshatKumar1609/NextWordPrediction.git
cd NextWordPrediction
```

### 2. Set up the backend

```bash
cd backend
pip install -r requirements.txt
```

> **Note:** The pre-built artefacts (`model.keras`, `tokenizer.pkl`, `prefix_map.pkl`) are committed to the repository. If you need to rebuild the prefix map from `unigram_freq.csv`, run:
> ```bash
> python prefix_map.py
> ```
> To retrain the model from scratch, open and run `next_word.ipynb`.

### 3. Set up the frontend

```bash
cd ../frontend
npm install
```

### 4. Run in development mode

**Terminal 1 — Backend (from the project root):**
```bash
uvicorn backend.main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

The app is available at **http://localhost:5173**. The Vite dev server proxies `/predict*` API calls to the FastAPI backend on port 8000.

### 5. Production build (optional)

```bash
cd frontend
npm run build        # outputs to frontend/dist/
cd ..
uvicorn backend.main:app --port 8000
```

FastAPI automatically detects and serves `frontend/dist/` as a static site, so the entire application runs from a **single process** at `http://localhost:8000`.

---

## Usage

1. **Open the editor** at `http://localhost:5173` (dev) or `http://localhost:8000` (production).
2. **Start typing** in the writing area. Ghost text appears automatically:
   - *Mid-word*: the editor completes the word you're currently typing.
   - *After a space*: the editor predicts the most likely next word based on your full sentence context.
3. **Press `Tab ⇥`** to accept the suggestion — it is inserted with a trailing space and the next prediction fires immediately.
4. **Press `Esc`** to dismiss the current ghost text without accepting.
5. Give your document a title in the **"Untitled"** field at the top.
6. The **word count** is always visible in the bottom-right corner.

---

## Technical Highlights

### Dual-API Prediction Strategy

Two separate endpoints serve two fundamentally different use cases:

| Endpoint | Trigger | Method | Latency profile |
|---|---|---|---|
| `POST /predictCurrentWord` | User is mid-word | Dictionary lookup (`prefix_map.pkl`) | Sub-millisecond |
| `POST /predictNextWord` | User hit a word boundary | LSTM inference (`model.keras`, seq len 307) | ~100–500 ms |

This split avoids running the heavy LSTM model on every keystroke. The frequency-ranked prefix map handles the high-cadence completions instantly, while the neural model is only invoked at natural pause points.

### Frequency-Ranked Prefix Map

[`prefix_map.py`](./backend/prefix_map.py) builds the prefix dictionary by iterating over `unigram_freq.csv` sorted by descending frequency. For any given prefix, only the **first** (most frequent) word encountered is stored, so lookups are O(1) and always return the statistically most common completion — no ranking needed at query time.

### Ghost-Text DOM Architecture

Ghost suggestions are injected as `<span class="ghost" aria-hidden="true">` nodes appended to the `contenteditable` div. The `getUserText()` function reconstructs clean user text by walking `childNodes` and explicitly skipping any `.ghost` spans — ensuring ghost text never leaks into API payloads or word counts. On acceptance, the ghost node is atomically replaced with a plain `Text` node via `replaceChild`, followed by `normalize()` to merge adjacent text nodes cleanly.

### AbortController Request Cancellation

Every scheduled API call first calls `cancelPending()`, which aborts the previous `AbortController` and creates a new one. This means only the most recent keystroke's request can ever resolve — all prior in-flight fetches are cancelled, preventing out-of-order ghost insertions.
