from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.sequence import pad_sequences
import numpy as np
import pickle
import uvicorn
import os
import sys
from backend import trie as trie_module

sys.modules["trie"] = trie_module

# Load model
model = load_model("backend/model.keras")

# Load tokenizer
with open("backend/tokenizer.pkl", "rb") as f:
    tokenizer = pickle.load(f)

# Load trie
with open("backend/trie.pkl", "rb") as f:
    trie = pickle.load(f)

# Max sequence length
MAX_LEN = 307

app = FastAPI(title="Next Word Prediction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request schema
class NextWord(BaseModel):
    text: str
class CurrrentWord(BaseModel):
    prefix: str


# Health route
@app.get("/health")
def health():
    return {"status": "ok"}


# Prediction route
@app.post("/predictCurrentWord")
def predict_curr_word(request: CurrrentWord):

    prefix = request.prefix.lower().strip()

    suggestion = trie.predict(prefix)

    return {
        "prefix": prefix,
        "suggestion": suggestion
    }

@app.post("/predictNextWord")
def predict_next_word(data: NextWord):

    text = data.text

    # Tokenize
    token_text = tokenizer.texts_to_sequences([text])[0]

    # Padding
    padded_token_text = pad_sequences(
        [token_text],
        maxlen=MAX_LEN - 1,
        padding='pre'
    )

    # Prediction
    predicted = model.predict(padded_token_text, verbose=0)

    pos = np.argmax(predicted)

    predicted_word = tokenizer.index_word.get(pos)
    return {
        "input_text": text,
        "predicted_word": predicted_word
    }


frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")