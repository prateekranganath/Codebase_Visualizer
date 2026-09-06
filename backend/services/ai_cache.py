"""Server-side result cache for explain/refactor, scoped per workspace.

Sits next to graph_store/ and vector_store/ under the workspace root so the
per-workspace directory convention stays uniform -- deleting the workspace
folder remains the whole cleanup story.

Deliberately NOT used for /ai/teach or /ai/teach/evaluate: those are
interactive-by-design, and returning a stale cached question or score would
defeat the point of the Socratic loop.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Optional

from backend.utils.chunking_utils import compute_chunk_checksum


class AICache:
    """Keys on task + file_path + a checksum of the file's current contents, so any
    edit to the file invalidates the cache automatically -- no manual invalidation.
    `extra` distinguishes calls that share a file but not a request (e.g. two
    different refactor goals on the same file must not collide).
    """

    def __init__(self, root_dir: Optional[str], *, dir_name: str = "ai_cache") -> None:
        self.enabled = bool(root_dir)
        self.base_dir = Path(root_dir) / dir_name if root_dir else None

    def _cache_path(self, task: str, file_path: str, file_contents: str, extra: str) -> Optional[Path]:
        if not self.enabled or self.base_dir is None:
            return None
        content_hash = compute_chunk_checksum(file_contents or "")
        raw_key = f"{task}:{file_path}:{content_hash}:{extra}"
        key = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
        return self.base_dir / task / f"{key}.json"

    def get(self, task: str, file_path: str, file_contents: str, extra: str = "") -> Optional[Dict[str, Any]]:
        cache_path = self._cache_path(task, file_path, file_contents, extra)
        if cache_path is None or not cache_path.exists():
            return None
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def set(self, task: str, file_path: str, file_contents: str, result: Dict[str, Any], extra: str = "") -> None:
        cache_path = self._cache_path(task, file_path, file_contents, extra)
        if cache_path is None:
            return
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False)
        except Exception:
            pass
