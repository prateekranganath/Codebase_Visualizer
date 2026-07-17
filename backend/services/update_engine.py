"""Update engine for keeping parsed structure, chunks, embeddings, and graph in sync."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.embedding_engine import EmbeddingEngine
from backend.services.graph_builder import CodeGraphBuilder
from backend.db.graph_store import GraphStoreRepository
from backend.config.settings import get_settings
from backend.services.parser import parse_codebase
from backend.utils.chunking_utils import chunk_code, detect_chunk_changes, rebuild_chunks_for_file
from backend.services.framework_detector import detect_project_profile



@dataclass
class UpdateReport:
	"""Structured result describing a file sync operation."""

	file_path: str
	root_dir: str
	parse_success: bool
	chunks_updated: int
	chunks_added: int
	chunks_removed: int
	embeddings_updated: bool
	graph_updated: bool
	framework: Optional[str] = None
	warnings: List[str] = field(default_factory=list)
	errors: List[str] = field(default_factory=list)
	timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

	def to_dict(self) -> Dict[str, Any]:
		return {
			"file_path": self.file_path,
			"root_dir": self.root_dir,
			"parse_success": self.parse_success,
			"chunks_updated": self.chunks_updated,
			"chunks_added": self.chunks_added,
			"chunks_removed": self.chunks_removed,
			"embeddings_updated": self.embeddings_updated,
			"graph_updated": self.graph_updated,
			"framework": self.framework,
			"warnings": self.warnings,
			"errors": self.errors,
			"timestamp": self.timestamp,
		}


class UpdateEngine:
	"""Orchestrates re-parsing, re-chunking, embedding refresh, and graph rebuilds."""

	def __init__(
		self,
		*,
		embedding_engine: Optional[EmbeddingEngine] = None,
		graph_builder: Optional[CodeGraphBuilder] = None,
		vector_db_path: str = "vector_store",
		embedding_model_name: str = "all-MiniLM-L6-v2",
		graph_store_repo: Optional[GraphStoreRepository] = None,
	) -> None:
		self.embedding_engine = embedding_engine or EmbeddingEngine(
			model_name=embedding_model_name,
			vector_db_path=vector_db_path,
		)
		self.graph_builder = graph_builder or CodeGraphBuilder()
		# Graph persistence repository: create from settings if not provided
		if graph_store_repo is None:
			settings = get_settings()
			self.graph_store_repo = GraphStoreRepository(store_path=settings.graph_store_path)
		else:
			self.graph_store_repo = graph_store_repo

		# Try to preload a saved graph if present
		try:
			loaded = self.graph_store_repo.load()
			if loaded is not None:
				self.graph_builder.graph = loaded
		except Exception:
			# non-fatal: continue with an empty in-memory graph
			pass
		self.last_report: Optional[UpdateReport] = None

	def sync_file(
		self,
		root_dir: str,
		relative_path: str,
		*,
		rebuild_graph: bool = True,
		save_embeddings: bool = True,
	) -> Dict[str, Any]:
		"""
		Rebuild the analysis pipeline for a single file.

		The update flow is:
		1. Parse the changed file.
		2. Rebuild semantic chunks for that file.
		3. Replace the file's embeddings in the vector store.
		4. Rebuild the dependency graph from the current codebase snapshot.
		"""
		warnings: List[str] = []
		errors: List[str] = []

		try:
			parsed_file = parse_codebase(root_dir, relative_path)
			parsed_module = parsed_file.get(relative_path)
			if parsed_module is None:
				raise ValueError(f"Could not parse module: {relative_path}")
			parse_success = True
		except Exception as exc:
			report = UpdateReport(
				file_path=relative_path,
				root_dir=root_dir,
				parse_success=False,
				chunks_updated=0,
				chunks_added=0,
				chunks_removed=0,
				embeddings_updated=False,
				graph_updated=False,
				warnings=warnings,
				errors=[str(exc)],
			)
			self.last_report = report
			return report.to_dict()

		new_chunks = rebuild_chunks_for_file(root_dir, relative_path)
		existing_chunks = [
			chunk
			for chunk in self.embedding_engine.list_chunks()
			if chunk.get("source") == relative_path
		]
		chunk_changes = detect_chunk_changes(existing_chunks, new_chunks)

		embeddings_updated = False
		try:
			old_chunk_ids = [chunk.get("id") for chunk in existing_chunks if chunk.get("id")]
			if old_chunk_ids:
				self.embedding_engine.delete_chunks(old_chunk_ids)
			if new_chunks:
				self.embedding_engine.add_chunks(new_chunks)
			if save_embeddings:
				self.embedding_engine.save()
			embeddings_updated = True
		except Exception as exc:
			errors.append(f"Embedding refresh failed: {exc}")

		graph_updated = False
		if rebuild_graph:
			try:
				settings = get_settings()
				codebase = parse_codebase(root_dir)
				if not codebase:
					warnings.append("No supported source files found; skipping graph rebuild.")
				else:
					self.graph_builder.build_from_codebase(codebase, graph_level=settings.graph_level)
					graph_updated = True
			except Exception as exc:
				errors.append(f"Graph rebuild failed: {exc}")
			else:
				# Persist graph after successful rebuild
				try:
					self.graph_store_repo.save(self.graph_builder.graph)
				except Exception:
					# don't fail the whole flow on save errors; log if needed
					pass
		else:
			warnings.append("Graph rebuild skipped by caller request.")

		report = UpdateReport(
			file_path=relative_path,
			root_dir=root_dir,
			parse_success=parse_success,
			chunks_updated=len(chunk_changes["modified"]),
			chunks_added=len(chunk_changes["added"]),
			chunks_removed=len(chunk_changes["removed"]),
			embeddings_updated=embeddings_updated,
			graph_updated=graph_updated,
			warnings=warnings,
			errors=errors,
		)
		self.last_report = report
		return report.to_dict()

	def rebuild_codebase(
		self,
		root_dir: str,
		*,
		save_embeddings: bool = True,
		save_graph: bool = True,
	) -> Dict[str, Any]:
		"""Rebuild embeddings and graph for an entire workspace."""
		warnings: List[str] = []
		errors: List[str] = []

		try:
			codebase = parse_codebase(root_dir)
			parse_success = True
			print("=" * 60)
			print("PARSED FILES:", len(codebase))
			print("FIRST FILES:")
			for f in list(codebase.keys())[:10]:
				print("  ", f)
			print("=" * 60)
		except Exception as exc:
				codebase = {}
				parse_success = False
				errors.append(str(exc))

		all_chunks: List[Dict[str, Any]] = []
		indexed_files = 0
		for relative_path in sorted(codebase.keys()):
			try:
				file_chunks = chunk_code(root_dir, relative_path)
				all_chunks.extend(file_chunks)
				indexed_files += 1
			except Exception as exc:
				warnings.append(f"Chunking skipped for {relative_path}: {exc}")

		embeddings_updated = False
		try:
			self.embedding_engine.clear()
			if all_chunks:
				self.embedding_engine.add_chunks(all_chunks)
			if save_embeddings:
				self.embedding_engine.save()
			embeddings_updated = True
		except Exception as exc:
			errors.append(f"Embedding rebuild failed: {exc}")

		graph_updated = False
		if save_graph:
			try:
				settings = get_settings()
				if not codebase:
					warnings.append("No supported source files found; skipping graph rebuild.")
				else:
					self.graph_builder.build_from_codebase(codebase, graph_level=settings.graph_level)
					graph_updated = True
					print("=" * 60)
					print("GRAPH NODES:", len(self.graph_builder.graph.nodes))
					print("GRAPH EDGES:", len(self.graph_builder.graph.edges))
					print("=" * 60)
					try:
						self.graph_store_repo.save(self.graph_builder.graph)
					except Exception as exc:
						warnings.append(f"Graph save skipped: {exc}")
			except Exception as exc:
				errors.append(f"Graph rebuild failed: {exc}")

		from backend.services.framework_detector import detect_framework
		framework = detect_framework(root_dir)

		report = {
			"root_dir": root_dir,
			"parse_success": parse_success,
			"parsed_files": len(codebase),
			"indexed_files": indexed_files,
			"chunks_indexed": len(all_chunks),
			"embeddings_updated": embeddings_updated,
			"graph_updated": graph_updated,
			"warnings": warnings,
			"errors": errors,
			"timestamp": datetime.utcnow().isoformat(),
			"framework": framework,
		}
		return report

	def update_file(
		self,
		root_dir: str,
		relative_path: str,
		**kwargs: Any,
	) -> Dict[str, Any]:
		"""Alias for sync_file to match common update-engine naming."""
		return self.sync_file(root_dir, relative_path, **kwargs)

	def get_update_report(self) -> Optional[Dict[str, Any]]:
		"""Return the most recent update report, if any."""
		if self.last_report is None:
			return None
		return self.last_report.to_dict()


def codebase_update_engine(
	root_dir: str,
	relative_path: str,
	*,
	embedding_engine: Optional[EmbeddingEngine] = None,
	graph_builder: Optional[CodeGraphBuilder] = None,
	rebuild_graph: bool = True,
	save_embeddings: bool = True,
) -> Dict[str, Any]:
	"""
	Backwards-compatible convenience wrapper for one-off file updates.

	This keeps the user's original function shape, but now performs the full
	update pipeline instead of only parsing and graph rebuilding.
	"""
	engine = UpdateEngine(
		embedding_engine=embedding_engine,
		graph_builder=graph_builder,
	)
	return engine.sync_file(
		root_dir,
		relative_path,
		rebuild_graph=rebuild_graph,
		save_embeddings=save_embeddings,
	)
