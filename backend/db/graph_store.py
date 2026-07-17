"""File-backed graph store helpers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

import networkx as nx


@dataclass
class GraphStoreRepository:
	"""Persist and reload dependency graphs as node-link JSON."""

	store_path: str = "graph_store"
	filename: str = "graph.json"

	def __post_init__(self) -> None:
		self.path = Path(self.store_path)
		self.path.mkdir(parents=True, exist_ok=True)

	@property
	def graph_path(self) -> Path:
		return self.path / self.filename

	def save(self, graph: nx.DiGraph) -> None:
		data = nx.node_link_data(graph)
		self.graph_path.write_text(json.dumps(data, indent=2), encoding="utf-8")

	def load(self) -> nx.DiGraph:
		if not self.graph_path.exists():
			return nx.DiGraph()
		data = json.loads(self.graph_path.read_text(encoding="utf-8"))
		return nx.node_link_graph(data, directed=True)

	def export(self, graph: nx.DiGraph) -> Dict[str, Any]:
		return nx.node_link_data(graph)

