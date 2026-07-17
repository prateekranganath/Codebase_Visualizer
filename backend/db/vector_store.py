"""File-backed vector store metadata helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


@dataclass
class VectorStoreRepository:
	"""Persist and reload chunk metadata for a vector store directory."""

	store_path: str = "vector_store"
	metadata_file: str = "metadata.json"
	index_file: str = "index.faiss"
	_metadata: Dict[str, Dict[str, Any]] = field(default_factory=dict)
	_id_map: List[str] = field(default_factory=list)

	def __post_init__(self) -> None:
		self.path = Path(self.store_path)
		self.path.mkdir(parents=True, exist_ok=True)

	@property
	def metadata_path(self) -> Path:
		return self.path / self.metadata_file

	@property
	def index_path(self) -> Path:
		return self.path / self.index_file

	def load(self) -> Dict[str, Any]:
		if not self.metadata_path.exists():
			return {"metadata": {}, "id_map": []}

		data = json.loads(self.metadata_path.read_text(encoding="utf-8"))
		self._metadata = data.get("metadata", {})
		self._id_map = data.get("id_map", [])
		return data

	def save(self) -> None:
		data = {
			"metadata": self._metadata,
			"id_map": self._id_map,
		}
		self.metadata_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

	def set_chunks(self, chunks: Iterable[Dict[str, Any]]) -> None:
		self._metadata = {}
		self._id_map = []
		for chunk in chunks:
			chunk_id = chunk.get("id")
			if not chunk_id:
				continue
			self._metadata[chunk_id] = dict(chunk)
			self._id_map.append(chunk_id)

	def upsert_chunk(self, chunk: Dict[str, Any]) -> None:
		chunk_id = chunk.get("id")
		if not chunk_id:
			raise ValueError("Chunk must include an id")
		self._metadata[chunk_id] = dict(chunk)
		if chunk_id not in self._id_map:
			self._id_map.append(chunk_id)

	def delete_chunks(self, chunk_ids: Iterable[str]) -> None:
		for chunk_id in chunk_ids:
			self._metadata.pop(chunk_id, None)
		self._id_map = [chunk_id for chunk_id in self._id_map if chunk_id in self._metadata]

	def get_chunk(self, chunk_id: str) -> Optional[Dict[str, Any]]:
		return self._metadata.get(chunk_id)

	def list_chunks(self) -> List[Dict[str, Any]]:
		return [self._metadata[chunk_id] for chunk_id in self._id_map if chunk_id in self._metadata]

	def sync_from_embedding_engine(self, embedding_engine: Any) -> None:
		self.set_chunks(embedding_engine.list_chunks())
		self.save()

