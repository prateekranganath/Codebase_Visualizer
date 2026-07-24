import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/layout/Navbar';
import Sidebar, { type FileSummary } from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import StatusBar from '../components/layout/StatusBar';
import UploadModal from '../components/layout/UploadModal';
import GraphWorkspace from '../components/graph/GraphWorkspace';
import AIChatDrawer, { type AIChatDrawerTab } from '../components/panels/AIChatDrawer';
import { useWorkspaceStore, type WorkspaceStoreState } from '../store/workspaceStore';
import { useGraphWorkspace } from '../hooks/useGraphWorkspace';
import { useProjectWorkspace } from '../hooks/useProjectWorkspace';
import { useAiWorkspace } from '../hooks/useAiWorkspace';
import { useRefactorWorkspace } from '../hooks/useRefactorWorkspace';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useToast } from '../context/ToastContext';
import { uploadProjectWorkspace } from '../api';
import { useGraphUiStore } from '../store/graphUiStore';

const filters = ['All', 'file', 'module', 'class', 'function', 'route', 'service', 'utility'];

const diffSample = `diff --git a/backend/services/ai_engine.py b/backend/services/ai_engine.py
@@ -42,8 +42,14 @@ def build_context(query: str) -> list[str]:
-    return results
+    ranked = sorted(results, key=lambda item: item.score, reverse=True)
+    context = [item.snippet for item in ranked[:top_k]]
+    return context
`;

export default function Dashboard() {
  const toast = useToast();

  // ── Workspace state ──────────────────────────────────────────────────────
  const projectRoot = useWorkspaceStore((s: WorkspaceStoreState) => s.projectRoot);
  const setProjectRoot = useWorkspaceStore((s: WorkspaceStoreState) => s.setProjectRoot);
  const searchValue = useWorkspaceStore((s: WorkspaceStoreState) => s.searchQuery);
  const activeFilter = useWorkspaceStore((s: WorkspaceStoreState) => s.activeFilter);
  const selectedNodeId = useWorkspaceStore((s: WorkspaceStoreState) => s.selectedNodeId);
  const selectedFile = useWorkspaceStore((s: WorkspaceStoreState) => s.selectedRelativePath);
  const backendStatus = useWorkspaceStore((s: WorkspaceStoreState) => s.backendStatus);
  const graphLevel = useGraphUiStore((s) => s.graphLevel);
  const setSearchQuery = useWorkspaceStore((s: WorkspaceStoreState) => s.setSearchQuery);
  const setActiveFilter = useWorkspaceStore((s: WorkspaceStoreState) => s.setActiveFilter);
  const setSelectedNodeId = useWorkspaceStore((s: WorkspaceStoreState) => s.setSelectedNodeId);
  const setSelectedRelativePath = useWorkspaceStore((s: WorkspaceStoreState) => s.setSelectedRelativePath);
  const setCurrentRefactorTarget = useWorkspaceStore((s: WorkspaceStoreState) => s.setCurrentRefactorTarget);
  const setLoading = useWorkspaceStore((s: WorkspaceStoreState) => s.setLoading);
  const loading = useWorkspaceStore((s: WorkspaceStoreState) => s.loading);

  // ── UI overlay state ─────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('Upload a zip or folder to build the graph.');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<AIChatDrawerTab>('explain');

  // ── Data hooks ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectRoot) {
      setProjectRoot(import.meta.env.VITE_PROJECT_ROOT ?? 'backend');
    }
  }, [projectRoot, setProjectRoot]);

  const { files, selectedContent, rootMessage, refreshFiles } = useProjectWorkspace(
    projectRoot,
    selectedFile,
  );

  const { nodes, edges, graphMessage, selectedGraphNode, refreshGraph } = useGraphWorkspace(
    projectRoot,
    selectedNodeId,
    graphLevel,
  );

  const filteredFiles = useMemo<FileSummary[]>(() => {
    const normalized = searchValue.trim().toLowerCase();
    return files.filter((file) => {
      const matchesSearch =
        !normalized || file.name.toLowerCase().includes(normalized) || file.kind.toLowerCase().includes(normalized);
      const matchesFilter = activeFilter === 'All' || file.kind.toLowerCase().includes(activeFilter.toLowerCase());
      return matchesSearch && matchesFilter;
    });
  }, [files, searchValue, activeFilter]);

  const activeNode = selectedGraphNode ?? nodes[0] ?? null;
  const _workspaceMessage = [rootMessage, graphMessage].filter(Boolean).join(' • ');

  const { explanation, teaching, provider, aiMessage, refreshExplain, refreshTeach } = useAiWorkspace({
    projectRoot,
    selectedFile,
    selectedNodeLabel: activeNode?.label ?? null,
  });

  const {
    goal,
    setGoal,
    targetFile,
    proposalSummary,
    validationSummary,
    applySummary,
    refactorMessage,
    proposedCode,
    runProposal,
    runValidation,
    runApply,
  } = useRefactorWorkspace({
    projectRoot,
    selectedFile,
    selectedContent,
    onApplySuccess: async () => {
      await refreshFiles();
      await refreshGraph();
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSync = useCallback(async () => {
    try {
      await refreshFiles();
      await refreshGraph();
      toast.addToast('Project synced successfully', 'success');
    } catch (error) {
      toast.addToast(error instanceof Error ? error.message : 'Failed to sync project', 'error');
    }
  }, [refreshFiles, refreshGraph, toast]);

  const handleExplain = useCallback(async () => {
    try {
      await refreshExplain();
    } catch (error) {
      toast.addToast(error instanceof Error ? error.message : 'Failed to refresh explanation', 'error');
    }
  }, [refreshExplain, toast]);

  const handleTeach = useCallback(async () => {
    try {
      await refreshTeach();
    } catch (error) {
      toast.addToast(error instanceof Error ? error.message : 'Failed to refresh teaching', 'error');
    }
  }, [refreshTeach, toast]);

  const handleUpload = useCallback(
    async (formData: FormData) => {
      setLoading('sync', true);
      setUploadMessage('Uploading workspace…');
      try {
        const response = await uploadProjectWorkspace(formData);
        setProjectRoot(response.root_path);
        setUploadMessage(`Workspace uploaded: ${response.workspace_id}`);
        toast.addToast('Workspace uploaded and graph rebuilt', 'success');
        setUploadOpen(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to upload workspace';
        setUploadMessage(message);
        toast.addToast(message, 'error');
      } finally {
        setLoading('sync', false);
      }
    },
    [setLoading, setProjectRoot, toast],
  );

  const handleUploadArchive = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append('archive', file, file.name);
      await handleUpload(formData);
    },
    [handleUpload],
  );

  const handleUploadFolder = useCallback(
    async (files: FileList) => {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        formData.append('files', file, relativePath);
      });
      await handleUpload(formData);
    },
    [handleUpload],
  );

  // Auto-select first real file
  useEffect(() => {
    if (selectedFile) return;
    const firstRealFile = files.find((f) => f.kind !== 'folder' && f.kind !== 'directory');
    if (firstRealFile) {
      setSelectedRelativePath(firstRealFile.name);
      setCurrentRefactorTarget(firstRealFile.name);
    }
  }, [files, selectedFile, setCurrentRefactorTarget, setSelectedRelativePath]);

  // Open AI drawer when a node is selected and switch to explain
  const handleOpenAiDrawer = useCallback((tab: AIChatDrawerTab) => {
    setDrawerTab(tab);
    setDrawerOpen(true);
    if (tab === 'explain') {
      void refreshExplain();
    }
    if (tab === 'teach') {
      void refreshTeach();
    }
  }, [refreshExplain, refreshTeach]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+s': handleSync,
    'e': handleExplain,
    't': handleTeach,
  });

  // Derive graph metadata for StatusBar
  const detectedLanguage = useMemo(() => {
    const exts = files.map((f) => f.name.split('.').pop() ?? '');
    const counts: Record<string, number> = {};
    exts.forEach((e) => { if (e) counts[e] = (counts[e] ?? 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] ?? 'unknown';
  }, [files]);

  return (
    <>
      <DashboardLayout
        navbar={
          <Navbar
            title="Codebase Visualizer"
            onUploadClick={() => setUploadOpen(true)}
            backendStatusNode={
              <span className={`navbar__badge ${loading.sync || loading.graph ? 'navbar__badge--syncing' : ''}`}>
                <span
                  className={`navbar__badge-dot ${
                    backendStatus.state === 'online'
                      ? ''
                      : backendStatus.state === 'offline'
                        ? 'navbar__badge-dot--offline'
                        : 'navbar__badge-dot--unknown'
                  }`}
                />
                {backendStatus.message}
                {(loading.files || loading.graph) ? ' · syncing' : ''}
              </span>
            }
          />
        }
        sidebar={
          <Sidebar
            files={filteredFiles}
            searchValue={searchValue}
            onSearchChange={setSearchQuery}
            activeFilter={activeFilter}
            filters={filters}
            onFilterChange={setActiveFilter}
            onFileSelect={(fileName: string) => {
              setSelectedRelativePath(fileName);
              setCurrentRefactorTarget(fileName);
            }}
            selectedPath={selectedFile}
            loading={loading.files}
          />
        }
        graphWorkspace={
          <GraphWorkspace
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onNodeSelect={(nodeId, nodePath) => {
              // Empty nodeId = deselect
              if (!nodeId) {
                setSelectedNodeId(null);
                return;
              }
              setSelectedNodeId(nodeId);
              if (nodePath) {
                setSelectedRelativePath(nodePath);
                setCurrentRefactorTarget(nodePath);
              }
            }}
            onNodeOpen={(nodeId) => {
              setSelectedNodeId(nodeId);
              toast.addToast(`Opened ${nodeId}`, 'info');
            }}
            loading={loading.graph}
            onOpenAiDrawer={handleOpenAiDrawer}
          />
        }
        statusBar={
          <StatusBar
            language={detectedLanguage}
            nodeCount={nodes.length}
            edgeCount={edges.length}
            syncState={backendStatus.state}
            syncMessage={backendStatus.message}
            syncing={loading.sync || loading.graph}
            lastSynced={backendStatus.lastCheckedAt}
          />
        }
      />

      {/* AI Chat Drawer — fixed overlay */}
      <AIChatDrawer
        open={drawerOpen}
        activeTab={drawerTab}
        onTabChange={(tab: AIChatDrawerTab) => {
          setDrawerTab(tab);
          if (tab === 'explain' && !explanation) void refreshExplain();
          if (tab === 'teach' && !teaching) void refreshTeach();
        }}
        onClose={() => setDrawerOpen(false)}
        activeNodeLabel={activeNode?.label ?? null}
        activeFilePath={selectedFile}
        explanation={explanation}
        aiMessage={aiMessage}
        provider={provider}
        loadingAi={loading.ai}
        onExplain={() => void refreshExplain()}
        teaching={teaching}
        onTeach={() => void refreshTeach()}
        goal={goal}
        onGoalChange={setGoal}
        targetFile={targetFile}
        proposalSummary={proposalSummary}
        validationSummary={validationSummary}
        applySummary={applySummary}
        diffText={proposedCode || diffSample}
        refactorMessage={refactorMessage}
        loadingRefactor={loading.refactor}
        onPropose={runProposal}
        onValidate={runValidation}
        onApply={runApply}
      />

      {/* Upload modal — fixed overlay */}
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploadArchive={handleUploadArchive}
          onUploadFolder={handleUploadFolder}
          uploadMessage={uploadMessage}
          uploading={loading.sync}
        />
      )}
    </>
  );
}
