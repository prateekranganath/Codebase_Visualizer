from pathlib import Path
from typing import List, Dict, Any


_HIDE_NAMES = {
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".git",
    "node_modules",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    "dist",
    "build",
}


def resolve_safe_path(root_dir: str, relative_path: str) -> Path:
    """
    Resolve a target path within the project root and prevent path traversal attacks.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root.
        
    Returns:
        A resolved Path object under root_dir.
        
    Raises:
        ValueError: If the target path escapes the project root.
    """

    root_path = Path(root_dir).resolve()
    target_path = (root_path / relative_path).resolve()

    if not target_path.is_relative_to(root_path):
        raise ValueError("Path must stay within the project root.")

    return target_path


def list_files(root_dir: str, relative_path: str = "") -> List[str]:
    """
    List all files and directories in the target path.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root (default: empty string for root).
        
    Returns:
        A list of file and directory names.
        
    Raises:
        ValueError: If the path is not a directory.
    """
    target_path = resolve_safe_path(root_dir, relative_path)

    if not target_path.is_dir():
        raise ValueError("Path is not a directory")

    names: List[str] = []
    for entry in target_path.iterdir():
        name = entry.name
        if name in _HIDE_NAMES:
            continue
        if entry.is_file() and name == ".env":
            continue
        if entry.is_file() and name.lower().endswith(".zip"):
            continue
        names.append(name)

    return sorted(names, key=str.lower)


def read_file(root_dir: str, relative_path: str) -> str:
    """
    Read the contents of a file as text.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root.
        
    Returns:
        The file contents as a string.
        
    Raises:
        ValueError: If the file does not exist.
    """
    target_path = resolve_safe_path(root_dir, relative_path)

    if not target_path.is_file():
        raise ValueError("File does not exist")

    encodings = ("utf-8", "utf-8-sig", "cp1252", "latin-1")
    for encoding in encodings:
        try:
            return target_path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue

    # Last resort: preserve as much content as possible so parsers can skip or report issues.
    return target_path.read_text(encoding='utf-8', errors='replace')


def write_file(root_dir: str, relative_path: str, content: str) -> None:
    """
    Write content to a file, creating parent directories if needed.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root.
        content: The text content to write.
        
    Raises:
        ValueError: If the target path escapes the project root.
    """
    target_path = resolve_safe_path(root_dir, relative_path)

    # create parent dirs if needed
    target_path.parent.mkdir(parents=True, exist_ok=True)

    target_path.write_text(content, encoding='utf-8')


def delete_file(root_dir: str, relative_path: str) -> None:
    """
    Delete a file.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root.
        
    Raises:
        ValueError: If the file does not exist or path is not a file.
    """
    target_path = resolve_safe_path(root_dir, relative_path)

    if not target_path.exists():
        raise ValueError("File does not exist")

    if target_path.is_file():
        target_path.unlink()
    else:
        raise ValueError("Path is not a file")


def get_file_metadata(root_dir: str, relative_path: str) -> Dict[str, Any]:
    """
    Get metadata about a file or directory.
    
    Args:
        root_dir: The project root directory.
        relative_path: The relative path from root.
        
    Returns:
        A dictionary with keys: name, size, created, modified, is_file, is_dir.
        
    Raises:
        ValueError: If the path does not exist.
    """
    target_path = resolve_safe_path(root_dir, relative_path)

    if not target_path.exists():
        raise ValueError("Path does not exist")

    stat = target_path.stat()

    return {
        "name": target_path.name,
        "size": stat.st_size,
        "created": stat.st_ctime,
        "modified": stat.st_mtime,
        "is_file": target_path.is_file(),
        "is_dir": target_path.is_dir(),
    }