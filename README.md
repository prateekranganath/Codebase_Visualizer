# Codebase Visualizer

Codebase Visualizer is a FastAPI backend plus a React + Vite frontend for uploading a
workspace, visualizing its dependency graph interactively, and using AI-assisted tools
(RAG-backed explain/query, Socratic teaching, and refactor proposals) to understand and
improve it.

## What's in the repo

- `backend/` - FastAPI app: multi-language parser, dependency graph builder, embeddings/RAG,
  Socratic teaching engine, refactor pipeline, and API routes.
- `Visualizer/frontend/` - React + TypeScript UI: workspace upload, interactive graph canvas
  (React Flow), AI chat drawer, teach mode, and refactor diff viewer.
- `scripts/` - local development helpers (backend dev server launcher).
- `vector_store/` - runtime embedding metadata and FAISS index data.
- `graph_store/` - persisted dependency graph exports.

## Features

- **Workspace upload & parsing** - upload a project as a zip (or point at a local folder);
  the backend parses Python, JavaScript, JSX, TypeScript, and TSX files and auto-detects the
  project's primary language/framework.
- **Dependency graph** - builds a graph of modules, classes, functions, and folders with
  import/call/containment/inheritance edges. Query it via export, single-node lookup,
  dependencies, dependents, or an arbitrary subgraph.
- **Interactive graph canvas** - pan/zoom React Flow canvas with dagre auto-layout, distinct
  node types (folder, module, class, function), a minimap, filters, and an inspector panel
  for the selected node.
- **AI assistant (RAG-backed)** - semantic search over code chunks (sentence-transformers +
  FAISS) feeds an LLM for:
  - `explain` - structured, per-file explanation (summary, responsibilities, key components,
    dependencies, risks, insights).
  - `query` - free-form Q&A over the codebase.
  - `teach` - Socratic mentoring mode that asks guiding questions and evaluates answers,
    with adaptive session memory.
- **Refactor assistant** - propose a refactor for a file/goal, validate the diff, apply it
  (single file or batch), and estimate blast-radius/impact using the dependency graph.
- **Multi-provider LLM support** - works with OpenAI, OpenRouter, or a local Ollama server.
  Each AI task (`answer`, `explain`, `teach`, `refactor`, `evaluate`) accepts a
  comma-separated list of model candidates and automatically falls back through them (and an
  optional secondary provider) until one returns a usable response.

## Requirements

- Python 3.11+ with `pip`
- Node.js 18+ with `npm`
- Windows PowerShell for the backend launch script

## Local setup

1. Create and activate the Python environment.

```powershell
python -m venv .venv
& .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

2. Install frontend dependencies.

```powershell
Set-Location Visualizer\frontend
npm install
```

3. Configure environment variables. Copy `.env` at the repo root (see [Environment
   variables](#environment-variables) below) and fill in at least an LLM API key if you want
   the AI features (explain/teach/refactor/query) to work — the graph visualization itself
   does not need one.

## Run locally

Start the backend from the repository root:

```powershell
cd C:\Users\PRATEEK\Desktop\codebase_visualizer
powershell -ExecutionPolicy Bypass -File .\scripts\run_backend_dev.ps1
```

Start the frontend in a second terminal:

```powershell
Set-Location Visualizer\frontend
npm run dev
```

The backend runs on `http://localhost:8000` (auto-reloads on changes under `backend/`) and
the frontend on `http://localhost:5173` by default. Uploaded workspaces are stored under
`%LOCALAPPDATA%\codebase_visualizer\uploaded_workspaces` by default.

## API overview

All routes are served under `http://localhost:8000`.

- **`/project`** - `GET /files`, `GET /file`, `POST /file`, `GET /metadata`, `GET /parse`,
  `POST /sync`, `POST /upload`, `POST /parse-codebase`
- **`/graph`** - `GET /export`, `GET /node`, `GET /dependencies`, `GET /dependents`,
  `GET /subgraph`
- **`/ai`** - `POST /query`, `POST /explain`, `POST /teach`, `POST /teach/evaluate`,
  `GET /provider`
- **`/refactor`** - `POST /propose`, `POST /validate`, `POST /apply`, `POST /batch`,
  `POST /impact`
- **`/health`** - basic health check

## Environment variables

Set these in `.env` at the repo root (loaded automatically via `python-dotenv`).

| Variable | Purpose |
| --- | --- |
| `DEBUG` | Enable debug mode. |
| `CORS_ALLOW_ALL` | Allow all CORS origins (dev default). |
| `LLM_PROVIDER` | `openai`, `openrouter`, or `ollama`. |
| `LLM_MODEL` | Default model (used for `answer` if `LLM_MODEL_ANSWER` is unset). |
| `LLM_MODEL_ANSWER` / `LLM_MODEL_TEACH` / `LLM_MODEL_EVALUATE` / `LLM_MODEL_EXPLAIN` / `LLM_MODEL_REFACTOR` | Per-task model candidates. Comma-separate multiple models (e.g. `modelA,modelB`) to try in order until one returns a usable response. |
| `LLM_TIMEOUT` | Per-request timeout in seconds. |
| `OPENAI_API_KEY` | Required when `LLM_PROVIDER=openai`. |
| `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL` | Required when `LLM_PROVIDER=openrouter`. |
| `OLLAMA_BASE_URL`, `OLLAMA_API_KEY` | Used when `LLM_PROVIDER=ollama`. |
| `LLM_API_KEY` | Optional generic fallback key used for whichever provider is selected. |
| `LLM_FALLBACK_PROVIDER`, `LLM_FALLBACK_MODEL` (+ per-task `LLM_FALLBACK_MODEL_TEACH` / `_EXPLAIN` / `_REFACTOR`), `LLM_FALLBACK_API_KEY`, `LLM_FALLBACK_BASE_URL`, `LLM_FALLBACK_TIMEOUT` | Optional secondary provider/model tried only after every primary candidate fails. |
| `EMBEDDING_MODEL_NAME` | sentence-transformers model used for RAG embeddings. |
| `VECTOR_DB_PATH` | Path to the FAISS vector store. |
| `GRAPH_STORE_PATH` | Path to the persisted dependency graph. |
| `GRAPH_LEVEL` | Detail level (1-3) the graph is built and persisted at. |

## Repository hygiene

Generated files and local-only data are excluded from GitHub via `.gitignore`, including:

- Python bytecode and cache folders
- `node_modules/`
- frontend build output
- virtual environments
- local upload/runtime storage
- secret `.env` files

## Useful files

- `backend/main.py` - FastAPI entrypoint
- `backend/routes/` - API endpoints for project, graph, AI, and refactor flows
- `backend/services/parser.py` / `js_ts_parser.py` - source parsers (Python / JS-TS)
- `backend/services/graph_builder.py` - graph construction and export
- `backend/services/ai_engine.py` - RAG retrieval, LLM provider adapters, and per-task model fallback
- `backend/services/teaching_engine.py` - Socratic teach mode session state
- `backend/services/refactor_engine.py` - refactor proposal/validate/apply pipeline
- `Visualizer/frontend/src/pages/Dashboard.tsx` - main UI shell
- `Visualizer/frontend/src/components/graph/GraphCanvas.tsx` - graph renderer
- `Visualizer/frontend/src/components/panels/AIChatDrawer.tsx` - AI query/teach UI
- `Visualizer/frontend/src/components/diff/DiffView.tsx` - refactor diff viewer

## Notes

- Graph and metadata stores are runtime artifacts and can be regenerated from the workspace.
- Uploading a workspace rebuilds the graph and embeddings automatically.
- Per-task LLM model lists only advance to the next candidate when a model errors out *or*
  fails to return a parseable response (e.g. ignores a forced structured-output tool call) —
  so listing several free-tier models per task materially improves reliability.
