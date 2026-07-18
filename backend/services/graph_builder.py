"""Builds a directed code dependency graph from parsed modules.

Nodes: modules, classes, functions
Edges: imports (module->module), contains (module->symbol), calls (function->function), inheritance (class->base)
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import networkx as nx
from pathlib import Path

from backend.services.graph_normalizer import GraphNormalizer, SymbolIndex, contains_noise_namespace, is_semantic_id


class CodeGraphBuilder:
	"""Create and maintain a directed graph representing code structure and dependencies."""

	def __init__(self) -> None:
		self.graph: nx.DiGraph = nx.DiGraph()
		self.graph_level: int = 2

	def clear(self) -> None:
		"""Clear the current graph."""
		self.graph.clear()

	def add_module(self, module_data: Dict[str, Any], *, normalizer: GraphNormalizer, project_modules: Set[str]) -> None:
		"""Add a parsed module (output of parser.parse_python_module) to the graph.

		Expected keys: 'path', 'module_name', 'imports', 'functions', 'classes'
		"""
		module_path = module_data.get("path")
		module_name = module_data.get("module_name") or module_path
		language = module_data.get("language")
		if not module_name or not is_semantic_id(str(module_name)):
			return

		# Build symbol indexes for call resolution.
		local_functions: Dict[str, str] = {}
		local_methods: Dict[str, str] = {}
		for fn in module_data.get("functions", []) or []:
			name = (fn.get("name") or "").strip()
			if name:
				local_functions[name] = f"{module_name}.{name}"
		for cls in module_data.get("classes", []) or []:
			cls_name = (cls.get("name") or "").strip()
			if not cls_name:
				continue
			for method in cls.get("methods", []) or []:
				m = (method.get("name") or "").strip()
				if m and m not in local_methods:
					local_methods[m] = f"{module_name}.{cls_name}.{m}"

		index = SymbolIndex(
			module_name=str(module_name),
			language=str(language) if language else None,
			project_modules=set(project_modules),
			local_functions=local_functions,
			local_methods=local_methods,
		)

		# Add module node
		self.graph.add_node(module_name, type="module", path=module_path, language=language)

		# Level 1+: imports
		for imp in module_data.get("imports", []) or []:
			if imp.get("type") in {"import", "from_import", "require", "dynamic_import"}:
				imported = imp.get("module")
			else:
				imported = None

			imported_norm = normalizer.normalize_import_target(str(imported or ""), index=index)
			if imported_norm:
				self.graph.add_node(imported_norm, type="module")
				self.graph.add_edge(module_name, imported_norm, type="imports")

		# Level 1 ends at modules + imports.
		if normalizer.graph_level <= 1:
			return

		# Level 2+: modules + classes + top-level functions.
		for fn in module_data.get("functions", []) or []:
			fn_name = f"{module_name}.{fn.get('name')}"
			self.graph.add_node(fn_name, type="function", **{
				"module": module_name,
				"docstring": fn.get("docstring"),
				"args": fn.get("args"),
				"returns": fn.get("returns"),
				"language": language,
			})
			# containment edge
			self.graph.add_edge(module_name, fn_name, type="contains")

			# Level 3 adds call edges.
			if normalizer.graph_level >= 3:
				for called in fn.get("calls", []) or []:
					called_norm = normalizer.normalize_call_target(str(called or ""), index=index)
					if not called_norm or called_norm == fn_name:
						continue
					# Only connect to semantic nodes.
					if not is_semantic_id(called_norm):
						continue
					self.graph.add_node(called_norm, type="function")
					self.graph.add_edge(fn_name, called_norm, type="calls")

		for cls in module_data.get("classes", []) or []:
			cls_name = f"{module_name}.{cls.get('name')}"
			self.graph.add_node(cls_name, type="class", **{
				"module": module_name,
				"docstring": cls.get("docstring"),
				"attributes": cls.get("attributes"),
				"language": language,
			})
			# containment edge
			self.graph.add_edge(module_name, cls_name, type="contains")

			# inheritance edges
			for base in cls.get("bases", []) or []:
				base_name = base or None
				if base_name and is_semantic_id(str(base_name)):
					# Keep inheritance edges only when base looks like a real symbol.
					self.graph.add_node(base_name, type="class")
					self.graph.add_edge(cls_name, base_name, type="inherits")

			# Level 2: do not include methods (keeps hierarchy readable).
			if normalizer.graph_level <= 2:
				continue

			for method in cls.get("methods", []) or []:
				m_name = f"{cls_name}.{method.get('name')}"
				self.graph.add_node(m_name, type="function", **{
					"module": module_name,
					"class": cls.get("name"),
					"language": language,
				})
				self.graph.add_edge(cls_name, m_name, type="contains")

				for called in method.get("calls", []) or []:
					called_norm = normalizer.normalize_call_target(str(called or ""), index=index)
					if not called_norm or called_norm == m_name:
						continue
					if not is_semantic_id(called_norm):
						continue
					self.graph.add_node(called_norm, type="function")
					self.graph.add_edge(m_name, called_norm, type="calls")

	def build_from_codebase(self, modules: Dict[str, Dict[str, Any]], *, graph_level: int = 2) -> None:
		"""Build a semantic graph from a mapping of relative_path -> parsed module data."""
		self.clear()
		self.graph_level = max(1, min(int(graph_level), 3))
		normalizer = GraphNormalizer(graph_level=self.graph_level)

		project_modules: Set[str] = set()
		for _, module_data in (modules or {}).items():
			module_name = module_data.get("module_name") or module_data.get("path")
			if module_name and is_semantic_id(str(module_name)):
				project_modules.add(str(module_name))

		for _, module_data in (modules or {}).items():
			self.add_module(module_data, normalizer=normalizer, project_modules=project_modules)

	def get_node(self, node_name: str) -> Optional[Dict[str, Any]]:
		"""Return node attributes for a node if present."""
		if node_name in self.graph.nodes:
			return dict(self.graph.nodes[node_name])
		return None

	def get_dependencies(self, node_name: str) -> List[str]:
		"""Return nodes that the given node depends on (outgoing edges).

		For example, for a function node this returns functions it calls.
		"""
		if node_name not in self.graph:
			return []
		return [n for n, _ in self.graph[node_name].items()]

	def get_dependents(self, node_name: str) -> List[str]:
		"""Return nodes that depend on the given node (incoming edges)."""
		if node_name not in self.graph:
			return []
		return [u for u, _ in self.graph.pred[node_name].items()]

	def get_subgraph(self, centers: Iterable[str], depth: int = 2) -> nx.DiGraph:
		"""Return a subgraph containing nodes within `depth` hops of the center nodes."""
		nodes: Set[str] = set()
		for center in centers:
			if center not in self.graph:
				continue
			nodes.add(center)
			# outward
			frontier = {center}
			for _ in range(depth):
				new_frontier = set()
				for n in frontier:
					new_frontier.update(self.graph.successors(n))
					new_frontier.update(self.graph.predecessors(n))
				nodes.update(new_frontier)
				frontier = new_frontier

		return self.graph.subgraph(nodes).copy()

	def _risk_for_node(self, node_id: str, *, subgraph: nx.DiGraph) -> Tuple[int, int, str]:
		"""Compute basic complexity/coupling/risk for a node."""
		out_degree = int(subgraph.out_degree(node_id))
		in_degree = int(subgraph.in_degree(node_id))
		coupling = out_degree + in_degree
		# Complexity is a simple proxy: unique neighbors.
		neighbors = set(subgraph.successors(node_id)) | set(subgraph.predecessors(node_id))
		complexity = len(neighbors)
		if coupling >= 30 or complexity >= 25:
			risk = "high"
		elif coupling >= 12 or complexity >= 10:
			risk = "medium"
		else:
			risk = "low"
		return complexity, coupling, risk

	def _risk_index(self, subgraph: nx.DiGraph) -> Dict[str, Tuple[int, int, str]]:
		"""Compute export risk metrics in one graph pass."""
		neighbors: Dict[str, Set[str]] = {str(node): set() for node in subgraph.nodes}
		for source, target in subgraph.edges:
			source_id = str(source)
			target_id = str(target)
			neighbors.setdefault(source_id, set()).add(target_id)
			neighbors.setdefault(target_id, set()).add(source_id)

		metrics: Dict[str, Tuple[int, int, str]] = {}
		for node_id in subgraph.nodes:
			node_key = str(node_id)
			out_degree = int(subgraph.out_degree(node_id))
			in_degree = int(subgraph.in_degree(node_id))
			coupling = out_degree + in_degree
			complexity = len(neighbors.get(node_key, set()))
			if coupling >= 30 or complexity >= 25:
				risk = "high"
			elif coupling >= 12 or complexity >= 10:
				risk = "medium"
			else:
				risk = "low"
			metrics[node_key] = (complexity, coupling, risk)
		return metrics

	def export_for_visualization(self, *, graph_level: Optional[int] = None) -> Dict[str, Any]:
		"""Export nodes and edges in a frontend-friendly format.

		Returns:
			{ "nodes": [{"id": id, "label": label, "type": type, ...}],
			  "edges": [{"source": a, "target": b, "type": type}, ...] }
		"""
		level = self.graph_level if graph_level is None else max(1, min(int(graph_level), 3))
		normalizer = GraphNormalizer(graph_level=level)

		# Filter nodes by abstraction level.
		def keep_node(node_id: str, attrs: Dict[str, Any]) -> bool:
			if not is_semantic_id(str(node_id)):
				return False
			if contains_noise_namespace(str(node_id)):
				return False
			ntype = attrs.get("type")
			if ntype == "module":
				# Only include modules that were parsed from actual project files.
				# External/stdlib imports (added via graph.add_node with no path) are excluded at level < 3.
				if level < 3 and not attrs.get("path"):
					return False
				return True
			if level <= 1:
				return False
			if ntype == "class":
				# Only include classes that have a known parent module.
				return bool(attrs.get("module"))
			if ntype == "function":
				# Ghost call-target nodes have no 'module' attribute — always exclude them.
				if not attrs.get("module"):
					return False
				# Level 2 keeps only top-level functions (no class attr)
				if level == 2:
					return not bool(attrs.get("class"))
				return True
			return False

		kept_nodes = {n for n, attrs in self.graph.nodes(data=True) if keep_node(n, attrs)}
		subgraph = self.graph.subgraph(kept_nodes).copy()

		# Filter edges: only between kept nodes and only allowed edge types.
		allowed_edges = {"imports"}
		if level >= 2:
			allowed_edges.add("contains")
			allowed_edges.add("inherits")
		if level >= 3:
			allowed_edges.add("calls")

		edges_out: List[Dict[str, Any]] = []
		for u, v, attrs in subgraph.edges(data=True):
			edge_type = attrs.get("type")
			if edge_type not in allowed_edges:
				continue
			edges_out.append(
				{
					"id": normalizer.edge_id(u, v, str(edge_type)),
					"source": u,
					"target": v,
					"type": edge_type,
				}
			)

		risk_index = self._risk_index(subgraph)
		nodes_out: List[Dict[str, Any]] = []
		for n, attrs in subgraph.nodes(data=True):
			complexity, coupling, risk = risk_index.get(str(n), (0, 0, "low"))
			nodes_out.append(
				{
					"id": n,
					"display_name": normalizer.node_display_name(n),
					"type": attrs.get("type"),
					"risk": risk,
					"complexity": complexity,
					"coupling": coupling,
					"language": attrs.get("language"),
					"path": attrs.get("path"),
				}
			)

		return {"graph_level": level, "nodes": nodes_out, "edges": edges_out}

	def export_subgraph_for_visualization(
		self,
		centers: Iterable[str],
		*,
		depth: int = 2,
		graph_level: Optional[int] = None,
	) -> Dict[str, Any]:
		"""Export a localized subgraph in the same frontend-safe format."""
		level = self.graph_level if graph_level is None else max(1, min(int(graph_level), 3))
		normalizer = GraphNormalizer(graph_level=level)
		subgraph = self.get_subgraph(centers, depth=depth)
		# Reuse export filtering by creating a temp builder view.
		# Filter nodes by level rules.
		def keep_node(node_id: str, attrs: Dict[str, Any]) -> bool:
			if not is_semantic_id(str(node_id)):
				return False
			if contains_noise_namespace(str(node_id)):
				return False
			ntype = attrs.get("type")
			if ntype == "module":
				if level < 3 and not attrs.get("path"):
					return False
				return True
			if level <= 1:
				return False
			if ntype == "class":
				return bool(attrs.get("module"))
			if ntype == "function":
				# Ghost call-target nodes have no 'module' attribute — always exclude them.
				if not attrs.get("module"):
					return False
				if level == 2:
					return not bool(attrs.get("class"))
				return True
			return False

		kept_nodes = {n for n, attrs in subgraph.nodes(data=True) if keep_node(n, attrs)}
		filtered = subgraph.subgraph(kept_nodes).copy()

		allowed_edges = {"imports"}
		if level >= 2:
			allowed_edges |= {"contains", "inherits"}
		if level >= 3:
			allowed_edges.add("calls")

		edges_out: List[Dict[str, Any]] = []
		for u, v, attrs in filtered.edges(data=True):
			edge_type = attrs.get("type")
			if edge_type not in allowed_edges:
				continue
			edges_out.append(
				{
					"id": normalizer.edge_id(u, v, str(edge_type)),
					"source": u,
					"target": v,
					"type": edge_type,
				}
			)

		risk_index = self._risk_index(filtered)
		nodes_out: List[Dict[str, Any]] = []
		for n, attrs in filtered.nodes(data=True):
			complexity, coupling, risk = risk_index.get(str(n), (0, 0, "low"))
			nodes_out.append(
				{
					"id": n,
					"display_name": normalizer.node_display_name(n),
					"type": attrs.get("type"),
					"risk": risk,
					"complexity": complexity,
					"coupling": coupling,
					"language": attrs.get("language"),
					"path": attrs.get("path"),
				}
			)

		return {"graph_level": level, "nodes": nodes_out, "edges": edges_out}


