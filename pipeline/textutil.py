import hashlib
import re


def normalize(text):
    """Return a compact, whitespace-normalized version of a review string.

    Phase 2 must copy this exact rule into the Node implementation, so keep it
    consistent across languages.
    """
    if text is None:
        text = ""
    text = str(text).strip()
    text = re.sub(r"\s+", " ", text)
    return text


def text_hash(text):
    normalized = normalize(text).lower()
    return hashlib.sha1(normalized.encode("utf-8")).hexdigest()
