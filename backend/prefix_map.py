import pandas as pd
import pickle

prefix_map = {}

df = pd.read_csv("unigram_freq.csv")
df = df.sort_values(by="count", ascending=False)

df["word"] = df["word"].astype(str)
df["count"] = df["count"].astype(int)

for word, count in zip(df["word"], df["count"]):

    word = word.lower()

    # build all prefixes
    for i in range(1, len(word)):
        prefix = word[:i]

        if prefix not in prefix_map:
            prefix_map[prefix] = word

with open("prefix_map.pkl", "wb") as f:
    pickle.dump(prefix_map, f)