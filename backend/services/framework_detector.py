from dataclasses import dataclass
from pathlib import Path
import json


@dataclass
class ProjectProfile:
    framework: str
    language: str
    project_type: str


def detect_language(root_dir: str) -> str:
    root = Path(root_dir)

    # Strong TypeScript signal
    if (root / "tsconfig.json").exists():
        return "typescript"

    py_count = 0
    ts_count = 0
    js_count = 0

    for file in root.rglob("*"):
        if not file.is_file():
            continue

        suffix = file.suffix.lower()

        if suffix == ".py":
            py_count += 1
        elif suffix in {".ts", ".tsx"}:
            ts_count += 1
        elif suffix in {".js", ".jsx", ".mjs", ".cjs"}:
            js_count += 1

    if py_count >= max(ts_count, js_count) and py_count > 0:
        return "python"

    if ts_count > 0:
        return "typescript"

    if js_count > 0:
        return "javascript"

    return "unknown"


def detect_project_profile(root_dir: str) -> ProjectProfile:
    root = Path(root_dir)
    language = detect_language(root_dir)

    package_json = root / "package.json"

    if package_json.exists():
        try:
            with open(package_json, "r", encoding="utf-8") as f:
                data = json.load(f)

            deps = {
                **data.get("dependencies", {}),
                **data.get("devDependencies", {})
            }

            # Frontend frameworks
            if "next" in deps:
                return ProjectProfile("Next.js", language, "frontend")

            if "react" in deps or "react-dom" in deps:
                return ProjectProfile("React", language, "frontend")

            if "vue" in deps:
                return ProjectProfile("Vue", language, "frontend")

            if "@angular/core" in deps:
                return ProjectProfile("Angular", language, "frontend")

            if "svelte" in deps:
                return ProjectProfile("Svelte", language, "frontend")

            if "astro" in deps:
                return ProjectProfile("Astro", language, "frontend")

            if "nuxt" in deps:
                return ProjectProfile("Nuxt", language, "frontend")

            # Backend frameworks
            if "@nestjs/core" in deps:
                return ProjectProfile("NestJS", language, "backend")

            if "express" in deps:
                return ProjectProfile("Express", language, "backend")

            if "fastify" in deps:
                return ProjectProfile("Fastify", language, "backend")

            if "koa" in deps:
                return ProjectProfile("Koa", language, "backend")

        except Exception:
            pass

    requirements_txt = root / "requirements.txt"

    if requirements_txt.exists():
        try:
            content = requirements_txt.read_text(
                encoding="utf-8",
                errors="ignore"
            ).lower()

            if "fastapi" in content:
                return ProjectProfile("FastAPI", "python", "backend")

            if "django" in content:
                return ProjectProfile("Django", "python", "backend")

            if "flask" in content:
                return ProjectProfile("Flask", "python", "backend")

        except Exception:
            pass

    pyproject_toml = root / "pyproject.toml"

    if pyproject_toml.exists():
        try:
            content = pyproject_toml.read_text(
                encoding="utf-8",
                errors="ignore"
            ).lower()

            if "fastapi" in content:
                return ProjectProfile("FastAPI", "python", "backend")

            if "django" in content:
                return ProjectProfile("Django", "python", "backend")

            if "flask" in content:
                return ProjectProfile("Flask", "python", "backend")

        except Exception:
            pass

    # Config-file fallbacks
    if (root / "manage.py").exists():
        return ProjectProfile("Django", "python", "backend")

    if (root / "angular.json").exists():
        return ProjectProfile("Angular", language, "frontend")

    if (root / "next.config.js").exists() or (root / "next.config.mjs").exists():
        return ProjectProfile("Next.js", language, "frontend")

    if (root / "vite.config.js").exists() or (root / "vite.config.ts").exists():
        return ProjectProfile("Vite", language, "frontend")

    return ProjectProfile(
        framework="Unknown",
        language=language,
        project_type="unknown"
    )

def detect_framework(root_dir: str) -> str:
    """
    Backwards-compatible helper.
    Existing code expects detect_framework().
    """
    return detect_project_profile(root_dir).framework