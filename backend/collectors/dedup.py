"""增量去重：URL 哈希 + 内容哈希（迁移自 school-knowledge-hub）。"""
import hashlib


def url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:16]


def content_hash(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()
