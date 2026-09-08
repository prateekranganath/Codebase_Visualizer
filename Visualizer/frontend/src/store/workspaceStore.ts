import { create } from 'zustand';

export type BackendConnectionState = 'unknown' | 'online' | 'offline';

const PROJECT_ROOT_STORAGE_KEY = 'codebase-visualizer:project-root';

/**
 * The last workspace the user actually uploaded, so a reload does not drop them
 * back to an empty canvas. There is deliberately no built-in default: pointing
 * at the app's own `backend/` folder made it look like a project was loaded
 * before the user had uploaded anything.
 */
function readStoredProjectRoot(): string {
  try {
    return window.localStorage.getItem(PROJECT_ROOT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredProjectRoot(projectRoot: string): void {
  try {
    if (projectRoot) window.localStorage.setItem(PROJECT_ROOT_STORAGE_KEY, projectRoot);
    else window.localStorage.removeItem(PROJECT_ROOT_STORAGE_KEY);
  } catch {
    // Private browsing or blocked storage: remembering is a convenience only.
  }
}

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
  projectRoot: readStoredProjectRoot(),
  selectedRelativePath: null as string | null,
  selectedNodeId: null,
  activeFilter: 'All',
  searchQuery: '',
  currentRefactorTarget: null,
  loading: initialLoadingState,
  backendStatus: initialBackendStatus,
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  ...initialState,
  setProjectRoot: (projectRoot) => {
    writeStoredProjectRoot(projectRoot);
    set({ projectRoot, selectedRelativePath: null, selectedNodeId: null });
  },
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
  resetWorkspace: () => {
    writeStoredProjectRoot('');
    set({
      ...initialState,
      projectRoot: '',
      loading: { ...initialLoadingState },
      backendStatus: { ...initialBackendStatus },
    });
  },
}));
