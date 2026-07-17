"""FastAPI application entrypoint for the codebase visualizer backend."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import iterate_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

from backend.routes.ai import router as ai_router
from backend.routes.graph import router as graph_router
from backend.routes.project import router as project_router
from backend.routes.refactor import router as refactor_router

app = FastAPI(
	title="AI-Powered Codebase Visualizer & Socratic Refactoring Assistant",
	version="0.1.0",
)

app.add_middleware(
	CORSMiddleware,
	allow_origins=["*"],
	allow_credentials=True,
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.middleware("http")
async def log_response_middleware(request: Request, call_next):
	response = await call_next(request)
	body = b""
	try:
		if hasattr(response, "body_iterator") and response.body_iterator is not None:
			async for chunk in response.body_iterator:
				body += chunk
			response.body_iterator = iterate_in_threadpool(iter([body]))
	except Exception:
		body = b""

	content_type = (response.headers.get("content-type") or "").lower()
	if "json" in content_type and body:
		try:
			payload = json.loads(body.decode("utf-8"))
		except Exception:
			payload = body.decode("utf-8", errors="replace")
		print(f"[{request.method} {request.url.path}] response:", payload)
	elif body:
		text = body.decode("utf-8", errors="replace")
		if len(text) > 2000:
			text = text[:2000] + "... [truncated]"
		print(f"[{request.method} {request.url.path}] response (non-JSON):", text)
	else:
		print(f"[{request.method} {request.url.path}] response status:", response.status_code)

	return response

app.include_router(project_router)
app.include_router(ai_router)
app.include_router(graph_router)
app.include_router(refactor_router)


@app.get("/health")
def health_check():
	return {"status": "ok"}
