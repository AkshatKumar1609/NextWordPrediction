from fastapi import FastAPI
from pydantic import BaseModel
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.sequence import pad_sequences
import numpy as np
import pickle
import uvicorn

# Load model
model = load_model("my_model.keras")

# Load tokenizer
with open("tokenizer.pkl", "rb") as f:
    tokenizer = pickle.load(f)

# Max sequence length
MAX_LEN = 21

app = FastAPI(title="Next Word Prediction API")


# Request schema
class TextInput(BaseModel):
    text: str


# Home route
@app.get("/")
def home():
    return {"message": "Next Word Prediction API Running"}


# Prediction route
@app.post("/predict")
def predict_next_word(data: TextInput):

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

    # Find word
    for word, index in tokenizer.word_index.items():
        if index == pos:
            return {
                "input_text": text,
                "predicted_word": word
            }

    return {"error": "Word not found"}
    

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)