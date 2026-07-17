import { GraphPayload } from '../types/graph';

export const samplePayload: GraphPayload = {
  "graph_level": 3,
  "nodes": [
    {
      "id": "backend.services.user_service",
      "display_name": "user_service",
      "type": "module",
      "risk": "low",
      "complexity": 5,
      "coupling": 2,
      "language": "python",
      "path": "backend/services/user_service.py"
    },
    {
      "id": "backend.services.user_service.UserService",
      "display_name": "UserService",
      "type": "class",
      "risk": "medium",
      "complexity": 12,
      "coupling": 8,
      "language": "python",
      "path": "backend/services/user_service.py"
    },
    {
      "id": "backend.services.user_service.UserService.get_user",
      "display_name": "get_user",
      "type": "function",
      "risk": "low",
      "complexity": 3,
      "coupling": 4,
      "language": "python",
      "path": "backend/services/user_service.py"
    },
    {
      "id": "backend.db.models",
      "display_name": "models",
      "type": "module",
      "risk": "low",
      "complexity": 2,
      "coupling": 6,
      "language": "python",
      "path": "backend/db/models.py"
    },
    {
      "id": "backend.db.models.UserSession",
      "display_name": "UserSession",
      "type": "class",
      "risk": "low",
      "complexity": 4,
      "coupling": 3,
      "language": "python",
      "path": "backend/db/models.py"
    }
  ],
  "edges": [
    {
      "id": "edge_imports_backend.services.user_service_backend.db.models",
      "source": "backend.services.user_service",
      "target": "backend.db.models",
      "type": "imports"
    },
    {
      "id": "edge_contains_backend.services.user_service_backend.services.user_service.UserService",
      "source": "backend.services.user_service",
      "target": "backend.services.user_service.UserService",
      "type": "contains"
    },
    {
      "id": "edge_contains_backend.services.user_service.UserService_backend.services.user_service.UserService.get_user",
      "source": "backend.services.user_service.UserService",
      "target": "backend.services.user_service.UserService.get_user",
      "type": "contains"
    },
    {
      "id": "edge_calls_backend.services.user_service.UserService.get_user_backend.db.models.UserSession",
      "source": "backend.services.user_service.UserService.get_user",
      "target": "backend.db.models.UserSession",
      "type": "calls"
    }
  ]
};
