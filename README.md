# Codebase Visualizer

Codebase Visualizer is a FastAPI backend plus a React + Vite frontend for inspecting a workspace, visualizing its dependency graph, and using AI-assisted refactor and teaching tools.

## What’s in the repo

- `backend/` - FastAPI app, parser, graph builder, embeddings, refactor pipeline, and API routes.
- `Visualizer/frontend/` - React UI for the workspace browser and graph canvas.
- `scripts/` - local development helpers.
- `vector_store/` - runtime embedding metadata and store data.

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

The backend runs on `http://localhost:8000` and the frontend on `http://localhost:5173` by default.

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
- `backend/services/parser.py` - source parser
- `backend/services/graph_builder.py` - graph construction and export
- `Visualizer/frontend/src/pages/Dashboard.tsx` - main UI shell
- `Visualizer/frontend/src/components/graph/GraphCanvas.tsx` - graph renderer

## Notes

- Graph and metadata stores are runtime artifacts and can be regenerated from the workspace.
- Uploading a workspace rebuilds the graph and embeddings automatically.
