"""Reusable filesystem helpers used by backend services and routes."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import List


def resolve_path(root_dir: str, relative_path: str = "") -> Path:
	root_path = Path(root_dir).resolve()
	target_path = (root_path / relative_path).resolve()
	if not target_path.is_relative_to(root_path):
		raise ValueError("Path must stay within the project root")
	return target_path


def read_text(root_dir: str, relative_path: str) -> str:
	return resolve_path(root_dir, relative_path).read_text(encoding="utf-8")


def write_text(root_dir: str, relative_path: str, content: str) -> None:
	target = resolve_path(root_dir, relative_path)
	target.parent.mkdir(parents=True, exist_ok=True)
	target.write_text(content, encoding="utf-8")


def list_entries(root_dir: str, relative_path: str = "") -> List[str]:
	target = resolve_path(root_dir, relative_path)
	if not target.is_dir():
		raise ValueError("Path is not a directory")
	return [entry.name for entry in target.iterdir()]


def delete_path(root_dir: str, relative_path: str) -> None:
	target = resolve_path(root_dir, relative_path)
	if target.is_dir():
		shutil.rmtree(target)
	elif target.exists():
		target.unlink()
	else:
		raise ValueError("Path does not exist")


def checksum_text(text: str) -> str:
	return hashlib.sha256(text.encode("utf-8")).hexdigest()


def copy_file(root_dir: str, source_relative_path: str, destination_relative_path: str) -> None:
	source = resolve_path(root_dir, source_relative_path)
	destination = resolve_path(root_dir, destination_relative_path)
	destination.parent.mkdir(parents=True, exist_ok=True)
	shutil.copy2(source, destination)

