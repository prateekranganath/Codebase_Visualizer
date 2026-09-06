import { create } from 'zustand';

export type GraphFilterState = {
  graphLevel: 1 | 2 | 3;
  showFunctions: boolean;
  showImports: boolean;
  showCalls: boolean;
  showInheritance: boolean;
  highComplexityOnly: boolean;
  riskFilter: 'all' | 'low' | 'medium' | 'high';
  showExternal: boolean;
  searchQuery: string;
  searchMatchIds: string[];
  searchActiveIndex: number;
  expandedModules: Record<string, boolean>;
  expandedClasses: Record<string, boolean>;
  focusedNodeId: string | null;
  focusDepth: 1 | 2 | 3;
  dimNonFocused: boolean;
  setGraphLevel: (level: 1 | 2 | 3) => void;
  toggleModule: (nodeId: string) => void;
  toggleClass: (nodeId: string) => void;
  setSearchQuery: (query: string) => void;
  setSearchMatches: (ids: string[]) => void;
  stepSearchMatch: (direction: 1 | -1) => string | null;
  setShowFunctions: (value: boolean) => void;
  setShowImports: (value: boolean) => void;
  setShowCalls: (value: boolean) => void;
  setShowInheritance: (value: boolean) => void;
  setHighComplexityOnly: (value: boolean) => void;
  setRiskFilter: (value: 'all' | 'low' | 'medium' | 'high') => void;
  setShowExternal: (value: boolean) => void;
  setFocusedNodeId: (nodeId: string | null) => void;
  setFocusDepth: (depth: 1 | 2 | 3) => void;
  setDimNonFocused: (value: boolean) => void;
  initializeGraphView: (nodes: Array<{ id: string; kind?: string; type?: string; metadata?: Record<string, unknown> }>) => void;
  resetFocus: () => void;
};

const initialState = {
  graphLevel: 2 as const,
  showFunctions: true,
  showImports: true,
  showCalls: false,
  showInheritance: true,
  highComplexityOnly: false,
  riskFilter: 'all' as const,
  showExternal: false,
  searchQuery: '',
  searchMatchIds: [] as string[],
  searchActiveIndex: -1,
  expandedModules: {} as Record<string, boolean>,
  expandedClasses: {} as Record<string, boolean>,
  focusedNodeId: null as string | null,
  focusDepth: 2 as const,
  dimNonFocused: true,
};

export const useGraphUiStore = create<GraphFilterState>((set, get) => ({
  ...initialState,
  setGraphLevel: (graphLevel) =>
    set({
      graphLevel,
      showCalls: graphLevel >= 3,
      focusedNodeId: null,
      expandedModules: {},
      expandedClasses: {},
    }),
  toggleModule: (nodeId) =>
    set((state) => ({
      expandedModules: {
        ...state.expandedModules,
        [nodeId]: !state.expandedModules[nodeId],
      },
    })),
  toggleClass: (nodeId) =>
    set((state) => ({
      expandedClasses: {
        ...state.expandedClasses,
        [nodeId]: !state.expandedClasses[nodeId],
      },
    })),
  setSearchQuery: (query) => set({ searchQuery: query, searchActiveIndex: -1 }),
  setSearchMatches: (ids) =>
    set((state) => ({
      searchMatchIds: ids,
      searchActiveIndex: ids.length === 0 ? -1 : Math.min(state.searchActiveIndex, ids.length - 1),
    })),
  stepSearchMatch: (direction) => {
    const { searchMatchIds, searchActiveIndex } = get();
    if (searchMatchIds.length === 0) {
      return null;
    }
    const nextIndex = (searchActiveIndex + direction + searchMatchIds.length) % searchMatchIds.length;
    set({ searchActiveIndex: nextIndex });
    return searchMatchIds[nextIndex];
  },
  setShowFunctions: (value) => set({ showFunctions: value }),
  setShowImports: (value) => set({ showImports: value }),
  setShowCalls: (value) => set({ showCalls: value }),
  setShowInheritance: (value) => set({ showInheritance: value }),
  setHighComplexityOnly: (value) => set({ highComplexityOnly: value }),
  setRiskFilter: (value) => set({ riskFilter: value }),
  setShowExternal: (value) => set({ showExternal: value }),
  setFocusedNodeId: (nodeId) => set({ focusedNodeId: nodeId }),
  setFocusDepth: (focusDepth) => set({ focusDepth }),
  setDimNonFocused: (dimNonFocused) => set({ dimNonFocused }),
  initializeGraphView: (nodes) =>
    set((state) => {
      if (nodes.length === 0) {
        return {};
      }

      const nodeIds = new Set(nodes.map((node) => node.id));
      const expandedIds = Object.keys(state.expandedModules);
      if (expandedIds.length > 0 && expandedIds.some((id) => nodeIds.has(id))) {
        return {};
      }

      const modules = nodes.filter((node) => {
        const kind = String(node.kind ?? node.type ?? '').toLowerCase();
        return kind === 'module' || kind === 'file' || kind === 'package';
      });

      const modulesToExpand = modules.length <= 20 ? modules : modules.slice(0, 10);

      // Leaf functions stay collapsed by default at level 3 (calls) -- that level
      // already renders the most edges, so auto-expanding every class's methods on
      // top of that produced the clutter this default is meant to avoid. Users can
      // still expand a class by clicking it.
      return {
        expandedModules: Object.fromEntries(modulesToExpand.map((node) => [node.id, true])),
        expandedClasses: {},
      };
    }),
  resetFocus: () => set({ focusedNodeId: null }),
}));
