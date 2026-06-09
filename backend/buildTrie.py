import pandas as pd
import pickle
from trie import Trie

trie = Trie()

df = pd.read_csv("unigram_freq.csv")

df = df.sort_values(by="count", ascending=False)

for row in df.itertuples(index=False):
    word = str(row.word).lower().strip()
    count = int(row.count)

    trie.insert(word, count)

with open("trie.pkl", "wb") as f:
    pickle.dump(trie, f)

print("Saved")