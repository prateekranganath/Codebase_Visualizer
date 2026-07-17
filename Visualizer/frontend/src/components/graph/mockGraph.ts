import type { GraphEdgeData, GraphNodeData } from '../../types/backend';

export const mockGraphNodes: GraphNodeData[] = [
  { id: 'app', label: 'app', kind: 'module', metadata: { complexity: 4, coupling: 2, risk: 'low' } },
  { id: 'app.routes', label: 'app/routes.py', kind: 'module', metadata: { complexity: 7, coupling: 4, risk: 'medium' } },
  { id: 'app.routes.Router', label: 'Router', kind: 'class', metadata: { parent_id: 'app.routes', complexity: 9, coupling: 6, risk: 'medium' } },
  { id: 'app.routes.Router.resolve', label: 'resolve()', kind: 'function', metadata: { parent_id: 'app.routes.Router', complexity: 12, coupling: 8, risk: 'high' } },
  { id: 'app.services', label: 'app/services.py', kind: 'module', metadata: { complexity: 6, coupling: 3, risk: 'low' } },
  { id: 'app.services.Analytics', label: 'Analytics', kind: 'class', metadata: { parent_id: 'app.services', complexity: 8, coupling: 5, risk: 'medium' } },
  { id: 'app.services.Analytics.track', label: 'track()', kind: 'function', metadata: { parent_id: 'app.services.Analytics', complexity: 10, coupling: 7, risk: 'high' } },
  { id: 'app.utils', label: 'app/utils.py', kind: 'module', metadata: { complexity: 3, coupling: 2, risk: 'low' } },
  { id: 'app.utils.slugify', label: 'slugify()', kind: 'function', metadata: { parent_id: 'app.utils', complexity: 5, coupling: 2, risk: 'low' } },
];

export const mockGraphEdges: GraphEdgeData[] = [
  { id: '1', source: 'app', target: 'app.routes', type: 'contains' },
  { id: '2', source: 'app', target: 'app.services', type: 'contains' },
  { id: '3', source: 'app', target: 'app.utils', type: 'contains' },
  { id: '4', source: 'app.routes', target: 'app.routes.Router', type: 'contains' },
  { id: '5', source: 'app.routes.Router', target: 'app.routes.Router.resolve', type: 'contains' },
  { id: '6', source: 'app.services', target: 'app.services.Analytics', type: 'contains' },
  { id: '7', source: 'app.services.Analytics', target: 'app.services.Analytics.track', type: 'contains' },
  { id: '8', source: 'app.utils', target: 'app.utils.slugify', type: 'contains' },
  { id: '9', source: 'app.routes.Router.resolve', target: 'app.services.Analytics.track', type: 'call' },
  { id: '10', source: 'app.routes', target: 'app.utils', type: 'import' },
];
