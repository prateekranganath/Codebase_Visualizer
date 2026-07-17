"""Embedding engine for semantic code search using FAISS and sentence-transformers."""

from __future__ import annotations

import json
import os
import re
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from sentence_transformers import SentenceTransformer

try:
    import faiss
except ImportError:  # pragma: no cover - optional dependency
    faiss = None


class EmbeddingEngine:
    """
    Manages code embeddings and semantic search using FAISS and sentence-transformers.
    
    Stores chunks as vectors and retrieves similar chunks via semantic search (RAG).
    """

    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        vector_db_path: str = "vector_store",
    ):
        """
        Initialize the embedding engine.

        Args:
            model_name: Name of the sentence-transformers model.
            vector_db_path: Directory path to save/load the vector store.
        """
        self.model_name = model_name
        self.vector_db_path = Path(vector_db_path)
        self.vector_db_path.mkdir(parents=True, exist_ok=True)

        # Load embedding model lazily (and safely). Some torch/sentence-transformers
        # combos can fail on Windows (e.g., meta-tensor move errors). We keep the
        # service running by falling back to deterministic hash embeddings.
        self.model: Optional[SentenceTransformer] = None
        self._model_load_error: Optional[str] = None
        self.embedding_dim = int(os.getenv("EMBEDDING_DIM", "384"))

        # Optional FAISS index for vector search; numpy fallback is always available.
        self.index: Optional[Any] = None

        # Numpy fallback matrix used when FAISS is unavailable.
        self.vectors: Optional[np.ndarray] = None

        # Metadata store: chunk_id -> chunk dict
        self.metadata: Dict[str, Dict[str, Any]] = {}

        # Index mapping: faiss_idx -> chunk_id
        self.id_map: List[str] = []

        # Load existing store if available
        self._load_from_disk()

    def _ensure_model_loaded(self) -> None:
        if self.model is not None or self._model_load_error is not None:
            return

        try:
            # Force CPU to avoid device auto-selection surprises.
            self.model = SentenceTransformer(self.model_name, device="cpu")
            self.embedding_dim = int(self.model.get_sentence_embedding_dimension())
        except Exception as exc:
            self._model_load_error = str(exc)
            self.model = None

    def _hash_embed(self, texts: List[str]) -> np.ndarray:
        dim = int(self.embedding_dim)
        vectors = np.zeros((len(texts), dim), dtype=np.float32)

        for row_idx, text in enumerate(texts):
            for token in re.findall(r"[A-Za-z0-9_]+", (text or "").lower()):
                bucket = zlib.adler32(token.encode("utf-8")) % dim
                vectors[row_idx, int(bucket)] += 1.0

        norms = np.linalg.norm(vectors, axis=1, keepdims=True)
        vectors = vectors / np.maximum(norms, 1e-12)
        return vectors

    def _text_to_vector(self, text: str) -> np.ndarray:
        """Convert text to embedding vector."""
        self._ensure_model_loaded()
        if self.model is None:
            return self._hash_embed([text])[0]
        return self.model.encode(text, convert_to_numpy=True)

    def _batch_text_to_vectors(self, texts: List[str]) -> np.ndarray:
        """Convert multiple texts to embedding vectors."""
        self._ensure_model_loaded()
        if self.model is None:
            return self._hash_embed(texts)
        return self.model.encode(texts, convert_to_numpy=True, batch_size=32)

    def _initialize_index(self):
        """Create or reset the FAISS index."""
        if faiss is None:
            return
        if self.index is None:
            self.index = faiss.IndexFlatL2(self.embedding_dim)

    def add_chunks(self, chunks: List[Dict[str, Any]]) -> None:
        """
        Add chunks with their embeddings to the vector store.

        Args:
            chunks: List of chunk dicts (must have 'id' and 'text' keys).
        """
        if not chunks:
            return

        self._initialize_index()

        # Extract texts and prepare vectors
        texts = [chunk.get("text", "") for chunk in chunks]
        vectors = self._batch_text_to_vectors(texts)

        # Add vectors to FAISS when available, otherwise keep a numpy matrix.
        vectors = vectors.astype(np.float32)
        if self.index is not None:
            self.index.add(vectors)
        else:
            self.vectors = vectors if self.vectors is None else np.vstack([self.vectors, vectors])

        # Store metadata and ID mapping
        for chunk in chunks:
            chunk_id = chunk.get("id", "")
            if chunk_id:
                self.metadata[chunk_id] = chunk
                self.id_map.append(chunk_id)

    def update_chunks(self, chunks: List[Dict[str, Any]]) -> None:
        """
        Update chunks (remove old, add new).

        Args:
            chunks: List of updated chunk dicts.
        """
        # Remove old versions by ID
        chunk_ids_to_remove = [chunk.get("id") for chunk in chunks if chunk.get("id")]
        self.delete_chunks(chunk_ids_to_remove)

        # Add updated versions
        self.add_chunks(chunks)

    def delete_chunks(self, chunk_ids: List[str]) -> None:
        """
        Delete chunks by ID (rebuilds index to avoid FAISS limitations).

        Args:
            chunk_ids: List of chunk IDs to remove.
        """
        if not chunk_ids or not self.metadata:
            return

        # Mark chunks for removal
        ids_to_keep = [
            chunk_id for chunk_id in self.id_map if chunk_id not in chunk_ids
        ]

        if not ids_to_keep:
            # Clear everything
            self.index = None
            self.metadata.clear()
            self.id_map.clear()
            return

        # Rebuild index with remaining chunks
        remaining_chunks = [self.metadata[chunk_id] for chunk_id in ids_to_keep]
        self.metadata.clear()
        self.id_map.clear()
        self.index = None
        self.vectors = None
        self.add_chunks(remaining_chunks)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Search for semantically similar chunks (RAG retrieval).

        Args:
            query: The search query (text).
            top_k: Number of top results to return.

        Returns:
            List of chunk dicts with similarity scores.
        """
        if not self.index or not self.metadata:
            if self.vectors is None or not self.metadata:
                return []

            query_vector = self._text_to_vector(query).astype(np.float32)
            vectors = self.vectors.astype(np.float32)
            distances = np.sum((vectors - query_vector) ** 2, axis=1)
            order = np.argsort(distances)[: min(top_k, len(self.id_map))]

            results = []
            for idx in order:
                if 0 <= idx < len(self.id_map):
                    chunk_id = self.id_map[int(idx)]
                    chunk = self.metadata[chunk_id].copy()
                    distance = float(distances[int(idx)])
                    chunk["similarity_score"] = float(1.0 / (1.0 + distance))
                    results.append(chunk)

            return results

        # Embed the query
        query_vector = self._text_to_vector(query).astype(np.float32).reshape(1, -1)

        # Search FAISS index
        distances, indices = self.index.search(query_vector, min(top_k, len(self.id_map)))

        # Retrieve metadata and attach scores
        results = []
        for idx, distance in zip(indices[0], distances[0]):
            if 0 <= idx < len(self.id_map):
                chunk_id = self.id_map[int(idx)]
                chunk = self.metadata[chunk_id].copy()
                # Convert L2 distance to similarity (lower distance = higher similarity)
                chunk["similarity_score"] = float(1.0 / (1.0 + distance))
                results.append(chunk)

        return results

    def get_chunk(self, chunk_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a single chunk by ID.

        Args:
            chunk_id: The chunk ID.

        Returns:
            The chunk dict, or None if not found.
        """
        return self.metadata.get(chunk_id)

    def list_chunks(self) -> List[Dict[str, Any]]:
        """
        List all stored chunks.

        Returns:
            List of all chunk dicts.
        """
        return list(self.metadata.values())

    def clear(self) -> None:
        """Clear all embeddings and metadata."""
        self.index = None
        self.vectors = None
        self.metadata.clear()
        self.id_map.clear()

    def _save_to_disk(self) -> None:
        """Persist the vector store to disk."""
        if not self.metadata:
            return

        index_path = self.vector_db_path / "index.faiss"
        metadata_path = self.vector_db_path / "metadata.json"

        # Save FAISS index when available
        if self.index is not None:
            faiss.write_index(self.index, str(index_path))

        # Save metadata and ID mapping
        store_data = {
            "metadata": self.metadata,
            "id_map": self.id_map,
            "model_name": self.model_name,
            "embedding_dim": self.embedding_dim,
        }
        with open(metadata_path, "w") as f:
            json.dump(store_data, f, indent=2)

    def _load_from_disk(self) -> None:
        """Load the vector store from disk if it exists."""
        index_path = self.vector_db_path / "index.faiss"
        metadata_path = self.vector_db_path / "metadata.json"

        if not metadata_path.exists():
            return

        try:
            # Load metadata and ID mapping
            with open(metadata_path, "r") as f:
                store_data = json.load(f)
                self.metadata = store_data.get("metadata", {})
                self.id_map = store_data.get("id_map", [])
                stored_dim = store_data.get("embedding_dim")
                if isinstance(stored_dim, int) and stored_dim > 0:
                    self.embedding_dim = stored_dim

            # Load FAISS index if present.
            if index_path.exists() and faiss is not None:
                self.index = faiss.read_index(str(index_path))
        except Exception as exc:
            print(f"Failed to load vector store from disk: {exc}")

    def save(self) -> None:
        """Explicitly save the vector store to disk."""
        self._save_to_disk()

    def get_stats(self) -> Dict[str, Any]:
        """
        Get vector store statistics.

        Returns:
            Dict with chunk count, model name, dimension, and DB path.
        """
        return {
            "chunk_count": len(self.metadata),
            "model_name": self.model_name,
            "embedding_dimension": self.embedding_dim,
            "db_path": str(self.vector_db_path),
            "has_index": self.index is not None or self.vectors is not None,
        }