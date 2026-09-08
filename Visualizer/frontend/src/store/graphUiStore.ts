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
  /**
   * Expansion is one map keyed by node id, covering folders, modules and
   * classes alike. Separate per-kind maps could not describe a folder, and
   * every caller had to know which map a given id lived in.
   */
  expanded: Record<string, boolean>;
  /** Node whose subtree replaces the canvas, set by double-click. */
  focusRootId: string | null;
  focusedNodeId: string | null;
  focusDepth: 1 | 2 | 3;
  dimNonFocused: boolean;
  /** Bumped to force a fresh layout without changing any other input. */
  layoutNonce: number;
  setGraphLevel: (level: 1 | 2 | 3) => void;
  toggleExpanded: (nodeId: string) => void;
  setExpanded: (ids: string[]) => void;
  expandAll: (ids: string[]) => void;
  collapseAll: () => void;
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
  setFocusRootId: (nodeId: string | null) => void;
  setFocusedNodeId: (nodeId: string | null) => void;
  setFocusDepth: (depth: 1 | 2 | 3) => void;
  setDimNonFocused: (value: boolean) => void;
  requestRelayout: () => void;
  resetFocus: () => void;
  resetGraphView: () => void;
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
  expanded: {} as Record<string, boolean>,
  focusRootId: null as string | null,
  focusedNodeId: null as string | null,
  focusDepth: 2 as const,
  dimNonFocused: true,
  layoutNonce: 0,
};

export const useGraphUiStore = create<GraphFilterState>((set, get) => ({
  ...initialState,
  setGraphLevel: (graphLevel) =>
    set({
      graphLevel,
      showCalls: graphLevel >= 3,
      focusedNodeId: null,
      focusRootId: null,
      expanded: {},
    }),
  toggleExpanded: (nodeId) =>
    set((state) => ({
      expanded: { ...state.expanded, [nodeId]: !state.expanded[nodeId] },
    })),
  setExpanded: (ids) => set({ expanded: Object.fromEntries(ids.map((id) => [id, true])) }),
  expandAll: (ids) =>
    set((state) => ({
      expanded: { ...state.expanded, ...Object.fromEntries(ids.map((id) => [id, true])) },
    })),
  collapseAll: () => set({ expanded: {} }),
  setSearchQuery: (query) => set({ searchQuery: query, searchActiveIndex: -1 }),
  setSearchMatches: (ids) =>
    set((state) => ({
      searchMatchIds: ids,
      searchActiveIndex: ids.length === 0 ? -1 : Math.min(state.searchActiveIndex, ids.length - 1),
    })),
  stepSearchMatch: (direction) => {
    const { searchMatchIds, searchActiveIndex } = get();
    if (searchMatchIds.length === 0) return null;
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
  setFocusRootId: (focusRootId) => set({ focusRootId, focusedNodeId: null }),
  setFocusedNodeId: (focusedNodeId) => set({ focusedNodeId }),
  setFocusDepth: (focusDepth) => set({ focusDepth }),
  setDimNonFocused: (dimNonFocused) => set({ dimNonFocused }),
  requestRelayout: () => set((state) => ({ layoutNonce: state.layoutNonce + 1 })),
  resetFocus: () => set({ focusedNodeId: null }),
  resetGraphView: () =>
    set({
      focusedNodeId: null,
      focusRootId: null,
      searchQuery: '',
      searchMatchIds: [],
      searchActiveIndex: -1,
      expanded: {},
    }),
}));
