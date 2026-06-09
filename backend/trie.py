class TrieNode:
    def __init__(self):
        self.children = {}
        self.is_word = False
        self.freq = 0

        self.best_word = None
        self.best_freq = 0


class Trie:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, word: str, freq: int):
        node = self.root

        for i, ch in enumerate(word):

            if ch not in node.children:
                node.children[ch] = TrieNode()

            node = node.children[ch]

            # Skip terminal node
            if i != len(word) - 1:
                if freq > node.best_freq:
                    node.best_freq = freq
                    node.best_word = word

        node.is_word = True
        node.freq = freq

    def predict(self, prefix: str):
        node = self.root

        for ch in prefix:
            if ch not in node.children:
                return None

            node = node.children[ch]

        return node.best_word