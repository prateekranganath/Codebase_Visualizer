"""Optional MongoDB helpers for future persistence layers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


try:
	from pymongo import MongoClient
except Exception:  # pragma: no cover - optional dependency
	MongoClient = None  # type: ignore[assignment]


@dataclass(frozen=True)
class MongoConfig:
	"""Connection settings for MongoDB."""

	url: str
	db_name: str = "codebase_visualizer"


def create_mongo_client(url: str):
	"""Create a Mongo client if pymongo is installed."""
	if MongoClient is None:
		raise RuntimeError("pymongo is not installed")
	return MongoClient(url)


def get_database(config: MongoConfig):
	"""Return a database handle for the configured MongoDB instance."""
	client = create_mongo_client(config.url)
	return client[config.db_name]


class MongoRepository:
	"""Very small wrapper around a Mongo collection."""

	def __init__(self, database: Any, collection_name: str) -> None:
		self.collection = database[collection_name]

	def upsert(self, query: Dict[str, Any], document: Dict[str, Any]) -> Any:
		return self.collection.replace_one(query, document, upsert=True)

	def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
		return self.collection.find_one(query)

	def find(self, query: Optional[Dict[str, Any]] = None) -> list[Dict[str, Any]]:
		return list(self.collection.find(query or {}))

	def delete(self, query: Dict[str, Any]) -> Any:
		return self.collection.delete_many(query)

