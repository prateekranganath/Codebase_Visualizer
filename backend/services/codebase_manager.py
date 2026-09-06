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


def resolve_file_path(root_dir: str, relative_path: str) -> Path:
    """
    Flexibly resolve a file path within root_dir.
    
    Handles:
    - Standard relative or absolute paths under root_dir
    - Module dot notation (e.g. 'backend.services.ai_engine' -> 'backend/services/ai_engine.py')
    - Symbol identifiers (e.g. 'backend.services.ai_engine.AIEngine' -> 'backend/services/ai_engine.py')
    - Missing extensions (e.g. 'backend/services/ai_engine' -> 'backend/services/ai_engine.py')
    - Subfolder basenames via recursive search under root_dir
    """
    root_path = Path(root_dir).resolve()
    clean = relative_path.replace("\\", "/").strip("/")

    # 1. Direct resolve_safe_path test
    try:
        direct = resolve_safe_path(root_dir, relative_path)
        if direct.is_file():
            return direct
    except Exception:
        pass

    # 2. Build candidate string paths
    candidates_str: List[str] = [clean]
    
    # If dot notation (and not already ending with a known file extension)
    known_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css", ".md"}
    if "." in clean and not any(clean.endswith(ext) for ext in known_exts):
        # e.g., "backend.services.ai_engine" -> "backend/services/ai_engine"
        dot_as_slash = clean.replace(".", "/")
        candidates_str.append(dot_as_slash)
        
        # e.g., "backend.services.ai_engine.AIEngine" -> try progressively shorter module paths
        parts = clean.split(".")
        for i in range(len(parts) - 1, 0, -1):
            sub_path = "/".join(parts[:i])
            candidates_str.append(sub_path)

    # 3. Test candidates with standard source extensions
    extensions = ["", ".py", ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css"]
    for cand in candidates_str:
        for ext in extensions:
            cand_ext = cand + ext if not cand.endswith(ext) else cand
            try:
                p = (root_path / cand_ext).resolve()
                if p.is_relative_to(root_path) and p.is_file():
                    return p
            except Exception:
                pass

    # 4. Fallback search by basename under root_path
    base_name = Path(clean).name
    for ext in ["", ".py", ".ts", ".tsx", ".js", ".jsx"]:
        target_name = base_name + ext if not base_name.endswith(ext) else base_name
        for found in root_path.rglob(target_name):
            if found.is_file() and not any(part in _HIDE_NAMES for part in found.parts):
                return found

    # Default fallback
    return resolve_safe_path(root_dir, relative_path)


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
    target_path = resolve_file_path(root_dir, relative_path)

    if not target_path.is_file():
        raise ValueError(f"File does not exist: {relative_path}")

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
    try:
        target_path = resolve_file_path(root_dir, relative_path)
    except ValueError:
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
    target_path = resolve_file_path(root_dir, relative_path)

    if not target_path.exists():
        raise ValueError(f"File does not exist: {relative_path}")

    if target_path.is_file():
        target_path.unlink()
    else:
        raise ValueError(f"Path is not a file: {relative_path}")


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
    target_path = resolve_file_path(root_dir, relative_path)

    if not target_path.exists():
        raise ValueError(f"Path does not exist: {relative_path}")

    stat = target_path.stat()

    return {
        "name": target_path.name,
        "size": stat.st_size,
        "created": stat.st_ctime,
        "modified": stat.st_mtime,
        "is_file": target_path.is_file(),
        "is_dir": target_path.is_dir(),
    }