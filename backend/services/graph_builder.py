"""Builds a directed code dependency graph from parsed modules.

Nodes: modules, classes, functions
Edges: imports (module->module), contains (module->symbol), calls (function->function), inheritance (class->base)
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

import networkx as nx
from pathlib import Path

from dataclasses import replace as dataclass_replace

from backend.services.graph_normalizer import (
	GraphNormalizer,
	SymbolIndex,
	build_module_suffix_index,
	contains_noise_namespace,
	is_semantic_id,
)


# Bumped whenever graph construction changes in a way that makes an already
# persisted graph.json stale (new edge resolution, new node attributes, ...).
# Stores below this version are rebuilt from source on next read.
GRAPH_BUILDER_VERSION = 2


def _owning_module(qualified_id: str) -> str:
	"""Dotted module portion of a qualified symbol id (everything but the tail)."""
	return ".".join(str(qualified_id).split(".")[:-1])


class CodeGraphBuilder:
	"""Create and maintain a directed graph representing code structure and dependencies."""

	def __init__(self) -> None:
		self.graph: nx.DiGraph = nx.DiGraph()
		self.graph_level: int = 2

	def clear(self) -> None:
		"""Clear the current graph."""
		self.graph.clear()

	def add_module(
		self,
		module_data: Dict[str, Any],
		*,
		normalizer: GraphNormalizer,
		project_modules: Set[str],
		module_suffixes: Optional[Dict[str, Optional[str]]] = None,
	) -> None:
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
		local_classes: Dict[str, str] = {}
		for cls in module_data.get("classes", []) or []:
			cls_name = (cls.get("name") or "").strip()
			if not cls_name:
				continue
			local_classes[cls_name] = f"{module_name}.{cls_name}"
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
			local_classes=local_classes,
			module_suffixes=module_suffixes or {},
		)

		# Add module node. is_external is set explicitly because this module may
		# already exist as an attribute-less node created by someone else's import.
		self.graph.add_node(
			module_name,
			type="module",
			path=module_path,
			language=language,
			is_external=False,
		)

		# Level 1+: imports
		imported_symbols: Dict[str, str] = {}
		imported_modules: Dict[str, str] = {}

		for imp in module_data.get("imports", []) or []:
			imp_type = imp.get("type")
			if imp_type not in {"import", "from_import", "require", "dynamic_import"}:
				continue

			imported_name = (imp.get("name") or "").strip() or None
			imported_norm = normalizer.normalize_import_target(
				str(imp.get("module") or ""),
				index=index,
				level=int(imp.get("level") or 0),
				name=imported_name,
			)
			if not imported_norm or imported_norm == module_name:
				continue

			if imported_norm not in self.graph:
				self.graph.add_node(
					imported_norm,
					type="module",
					is_external=imported_norm not in project_modules,
				)
			self.graph.add_edge(module_name, imported_norm, type="imports")

			# Record what each imported name means in this module's scope, so base
			# classes can be qualified against it below.
			alias = (imp.get("alias") or "").strip()
			if imp_type == "from_import" and imported_name:
				# When the imported name *was* the module, the target already is it.
				if imported_norm.endswith(f".{imported_name}"):
					qualified = imported_norm
				else:
					qualified = f"{imported_norm}.{imported_name}"
				imported_symbols[alias or imported_name] = qualified
			else:
				segments = imported_norm.split(".")
				imported_modules[alias or segments[-1]] = imported_norm
				imported_modules.setdefault(segments[0], segments[0])

		index = dataclass_replace(
			index,
			imported_symbols=imported_symbols,
			imported_modules=imported_modules,
		)

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
				"is_external": False,
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
					self.graph.add_node(called_norm, type="function", is_external=True)
					self.graph.add_edge(fn_name, called_norm, type="calls")

		for cls in module_data.get("classes", []) or []:
			cls_name = f"{module_name}.{cls.get('name')}"
			self.graph.add_node(cls_name, type="class", **{
				"module": module_name,
				"docstring": cls.get("docstring"),
				"attributes": cls.get("attributes"),
				"language": language,
				"is_external": False,
			})
			# containment edge
			self.graph.add_edge(module_name, cls_name, type="contains")

			# Inheritance edges. Bases arrive as bare source text ("Model",
			# "models.Model"); resolve_base qualifies them against this module's
			# own classes and its import map so the edge can reach a real node.
			for base in cls.get("bases", []) or []:
				base_norm = index.resolve_base(str(base or ""))
				if not base_norm or base_norm == cls_name:
					continue
				if contains_noise_namespace(base_norm):
					continue
				if base_norm not in self.graph:
					self.graph.add_node(
						base_norm,
						type="class",
						is_external=_owning_module(base_norm) not in project_modules,
					)
				self.graph.add_edge(cls_name, base_norm, type="inherits")

			# Level 2: do not include methods (keeps hierarchy readable).
			if normalizer.graph_level <= 2:
				continue

			for method in cls.get("methods", []) or []:
				m_name = f"{cls_name}.{method.get('name')}"
				self.graph.add_node(m_name, type="function", **{
					"module": module_name,
					"class": cls.get("name"),
					"language": language,
					"is_external": False,
				})
				self.graph.add_edge(cls_name, m_name, type="contains")

				for called in method.get("calls", []) or []:
					called_norm = normalizer.normalize_call_target(str(called or ""), index=index)
					if not called_norm or called_norm == m_name:
						continue
					if not is_semantic_id(called_norm):
						continue
					self.graph.add_node(called_norm, type="function", is_external=True)
					self.graph.add_edge(m_name, called_norm, type="calls")

	def build_from_codebase(self, modules: Dict[str, Dict[str, Any]], *, graph_level: int = 2) -> None:
		"""Build a semantic graph from a mapping of relative_path -> parsed module data."""
		self.clear()
		self.graph_level = max(1, min(int(graph_level), 3))
		self.graph.graph["builder_version"] = GRAPH_BUILDER_VERSION
		self.graph.graph["graph_level"] = self.graph_level
		normalizer = GraphNormalizer(graph_level=self.graph_level)

		project_modules: Set[str] = set()
		for _, module_data in (modules or {}).items():
			module_name = module_data.get("module_name") or module_data.get("path")
			if module_name and is_semantic_id(str(module_name)):
				project_modules.add(str(module_name))

		module_suffixes = build_module_suffix_index(project_modules)

		for _, module_data in (modules or {}).items():
			self.add_module(
				module_data,
				normalizer=normalizer,
				project_modules=project_modules,
				module_suffixes=module_suffixes,
			)

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
		"""Export the whole graph in a frontend-friendly format."""
		return self._export(self.graph, graph_level=graph_level)

	def export_subgraph_for_visualization(
		self,
		centers: Iterable[str],
		*,
		depth: int = 2,
		graph_level: Optional[int] = None,
	) -> Dict[str, Any]:
		"""Export a localized subgraph in the same frontend-safe format."""
		return self._export(self.get_subgraph(centers, depth=depth), graph_level=graph_level)

	def _export(self, source: nx.DiGraph, *, graph_level: Optional[int] = None) -> Dict[str, Any]:
		"""Filter `source` to the requested level and serialize it.

		This used to be copy-pasted between the full and subgraph exports, which let
		the two drift. It is one implementation now.

		Returns:
			{ "nodes": [{"id", "display_name", "type", "parent_id", ...}],
			  "edges": [{"id", "source", "target", "type"}, ...] }
		"""
		level = self.graph_level if graph_level is None else max(1, min(int(graph_level), 3))
		normalizer = GraphNormalizer(graph_level=level)

		kept_nodes = {n for n, attrs in source.nodes(data=True) if _keep_node(str(n), attrs, level)}
		subgraph = source.subgraph(kept_nodes).copy()

		allowed_edges = {"imports"}
		if level >= 2:
			allowed_edges |= {"contains", "inherits"}
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
					# Hierarchy, previously computed on the graph and then dropped on
					# export -- which forced the client to reverse-engineer parentage
					# from `contains` edges, and made nesting impossible at level 1.
					"module": attrs.get("module"),
					"class": attrs.get("class"),
					"parent_id": _parent_id(str(n), attrs),
					"is_external": bool(attrs.get("is_external", False)),
				}
			)

		return {"graph_level": level, "nodes": nodes_out, "edges": edges_out}


def _keep_node(node_id: str, attrs: Dict[str, Any], level: int) -> bool:
	"""Decide whether a node survives export at the given abstraction level.

	External modules and base classes are kept rather than dropped. An edge dies
	with its endpoint, so dropping them was silently deleting the dependency
	edges the graph exists to show; they are tagged `is_external` instead and the
	client decides whether to draw them.
	"""
	if not is_semantic_id(node_id):
		return False
	if contains_noise_namespace(node_id):
		return False

	ntype = attrs.get("type")
	if ntype == "module":
		return True
	if level <= 1:
		return False
	if ntype == "class":
		return True
	if ntype == "function":
		# Level 2 shows only top-level functions; methods appear at level 3.
		if level == 2:
			return not bool(attrs.get("class"))
		return True
	return False


def _parent_id(node_id: str, attrs: Dict[str, Any]) -> Optional[str]:
	"""Containing node for the hierarchy: module -> class -> method."""
	ntype = attrs.get("type")
	module = attrs.get("module")
	if not module:
		return None
	if ntype == "class":
		return str(module)
	if ntype == "function":
		owning_class = attrs.get("class")
		return f"{module}.{owning_class}" if owning_class else str(module)
	return None
