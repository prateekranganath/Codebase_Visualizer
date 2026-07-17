import { create } from 'zustand';

export type BackendConnectionState = 'unknown' | 'online' | 'offline';

export type WorkspaceLoadingState = {
  files: boolean;
  graph: boolean;
  ai: boolean;
  refactor: boolean;
  sync: boolean;
};

export type BackendStatus = {
  state: BackendConnectionState;
  message: string;
  lastCheckedAt: string | null;
};

export type WorkspaceStoreState = {
  projectRoot: string;
  selectedRelativePath: string | null;
  selectedNodeId: string | null;
  activeFilter: string;
  searchQuery: string;
  currentRefactorTarget: string | null;
  loading: WorkspaceLoadingState;
  backendStatus: BackendStatus;
  setProjectRoot: (projectRoot: string) => void;
  setSelectedRelativePath: (relativePath: string | null) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setActiveFilter: (filter: string) => void;
  setSearchQuery: (query: string) => void;
  setCurrentRefactorTarget: (target: string | null) => void;
  setLoading: (key: keyof WorkspaceLoadingState, value: boolean) => void;
  setBackendStatus: (status: BackendStatus) => void;
  markBackendOnline: (message?: string) => void;
  markBackendOffline: (message?: string) => void;
  resetWorkspace: () => void;
};

const initialLoadingState: WorkspaceLoadingState = {
  files: false,
  graph: false,
  ai: false,
  refactor: false,
  sync: false,
};

const initialBackendStatus: BackendStatus = {
  state: 'unknown',
  message: 'Backend not checked yet',
  lastCheckedAt: null,
};

const initialState = {
  projectRoot: '',
  selectedRelativePath: 'backend/main.py',
  selectedNodeId: null,
  activeFilter: 'All',
  searchQuery: '',
  currentRefactorTarget: null,
  loading: initialLoadingState,
  backendStatus: initialBackendStatus,
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  ...initialState,
  setProjectRoot: (projectRoot) => set({ projectRoot }),
  setSelectedRelativePath: (selectedRelativePath) => set({ selectedRelativePath }),
  setSelectedNodeId: (selectedNodeId) => set({ selectedNodeId }),
  setActiveFilter: (activeFilter) => set({ activeFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCurrentRefactorTarget: (currentRefactorTarget) => set({ currentRefactorTarget }),
  setLoading: (key, value) =>
    set((state) => ({
      loading: {
        ...state.loading,
        [key]: value,
      },
    })),
  setBackendStatus: (backendStatus) => set({ backendStatus }),
  markBackendOnline: (message = 'Backend connected') =>
    set({
      backendStatus: {
        state: 'online',
        message,
        lastCheckedAt: new Date().toISOString(),
      },
    }),
  markBackendOffline: (message = 'Backend unreachable') =>
    set({
      backendStatus: {
        state: 'offline',
        message,
        lastCheckedAt: new Date().toISOString(),
      },
    }),
  resetWorkspace: () =>
    set({
      ...initialState,
      loading: { ...initialLoadingState },
      backendStatus: { ...initialBackendStatus },
    }),
}));
