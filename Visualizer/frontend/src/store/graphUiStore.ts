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
  expandedModules: Record<string, boolean>;
  expandedClasses: Record<string, boolean>;
  focusedNodeId: string | null;
  setGraphLevel: (level: 1 | 2 | 3) => void;
  toggleModule: (nodeId: string) => void;
  toggleClass: (nodeId: string) => void;
  setSearchQuery: (query: string) => void;
  setShowFunctions: (value: boolean) => void;
  setShowImports: (value: boolean) => void;
  setShowCalls: (value: boolean) => void;
  setShowInheritance: (value: boolean) => void;
  setHighComplexityOnly: (value: boolean) => void;
  setRiskFilter: (value: 'all' | 'low' | 'medium' | 'high') => void;
  setShowExternal: (value: boolean) => void;
  setFocusedNodeId: (nodeId: string | null) => void;
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
  expandedModules: {} as Record<string, boolean>,
  expandedClasses: {} as Record<string, boolean>,
  focusedNodeId: null as string | null,
};

export const useGraphUiStore = create<GraphFilterState>((set) => ({
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
  setSearchQuery: (query) => set({ searchQuery: query }),
  setShowFunctions: (value) => set({ showFunctions: value }),
  setShowImports: (value) => set({ showImports: value }),
  setShowCalls: (value) => set({ showCalls: value }),
  setShowInheritance: (value) => set({ showInheritance: value }),
  setHighComplexityOnly: (value) => set({ highComplexityOnly: value }),
  setRiskFilter: (value) => set({ riskFilter: value }),
  setShowExternal: (value) => set({ showExternal: value }),
  setFocusedNodeId: (nodeId) => set({ focusedNodeId: nodeId }),
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
      const classes = nodes.filter((node) => String(node.kind ?? node.type ?? '').toLowerCase() === 'class');

      const modulesToExpand = modules.length <= 20 ? modules : modules.slice(0, 10);
      const classesToExpand = state.graphLevel >= 3 && classes.length <= 16 ? classes : [];

      return {
        expandedModules: Object.fromEntries(modulesToExpand.map((node) => [node.id, true])),
        expandedClasses: Object.fromEntries(classesToExpand.map((node) => [node.id, true])),
      };
    }),
  resetFocus: () => set({ focusedNodeId: null }),
}));
