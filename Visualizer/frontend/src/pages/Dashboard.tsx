import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from '../components/layout/Navbar';
import Sidebar, { type FileSummary } from '../components/layout/Sidebar';
import DashboardLayout from '../components/layout/DashboardLayout';
import GraphCanvas from '../components/graph/GraphCanvas';
import AiContextPanel from '../components/panels/AiContextPanel';
import DiffConsole from '../components/diff/DiffConsole';
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
+
+def explain_selection(selection_id: str) -> str:
+    return f'Explain the selected node: {selection_id}'
`;

export default function Dashboard() {
  const toast = useToast();
  const projectRoot = useWorkspaceStore((state: WorkspaceStoreState) => state.projectRoot);
  const setProjectRoot = useWorkspaceStore((state: WorkspaceStoreState) => state.setProjectRoot);
  const searchValue = useWorkspaceStore((state: WorkspaceStoreState) => state.searchQuery);
  const activeFilter = useWorkspaceStore((state: WorkspaceStoreState) => state.activeFilter);
  const selectedNodeId = useWorkspaceStore((state: WorkspaceStoreState) => state.selectedNodeId);
  const selectedFile = useWorkspaceStore((state: WorkspaceStoreState) => state.selectedRelativePath);
  const backendStatus = useWorkspaceStore((state: WorkspaceStoreState) => state.backendStatus);
  const graphLevel = useGraphUiStore((state) => state.graphLevel);
  const setSearchQuery = useWorkspaceStore((state: WorkspaceStoreState) => state.setSearchQuery);
  const setActiveFilter = useWorkspaceStore((state: WorkspaceStoreState) => state.setActiveFilter);
  const setSelectedNodeId = useWorkspaceStore((state: WorkspaceStoreState) => state.setSelectedNodeId);
  const setSelectedRelativePath = useWorkspaceStore((state: WorkspaceStoreState) => state.setSelectedRelativePath);
  const setCurrentRefactorTarget = useWorkspaceStore((state: WorkspaceStoreState) => state.setCurrentRefactorTarget);
  const setLoading = useWorkspaceStore((state: WorkspaceStoreState) => state.setLoading);
  const loading = useWorkspaceStore((state: WorkspaceStoreState) => state.loading);
  const [uploadMessage, setUploadMessage] = useState('Upload a zip or folder to build the graph.');

  useEffect(() => {
    if (!projectRoot) {
      setProjectRoot(import.meta.env.VITE_PROJECT_ROOT ?? 'backend');
    }
  }, [projectRoot, setProjectRoot]);

  const { files, selectedMetadata, selectedPreview, selectedContent, rootMessage, refreshFiles } = useProjectWorkspace(
    projectRoot,
    selectedFile,
  );
  const { nodes, edges, graphMessage, selectedGraphNode, refreshGraph } = useGraphWorkspace(
    projectRoot,
    selectedNodeId,
    graphLevel,
  );

  const filteredFiles = useMemo(() => {
    const normalized = searchValue.trim().toLowerCase();
    return files.filter((file) => {
      const matchesSearch =
        !normalized || file.name.toLowerCase().includes(normalized) || file.kind.toLowerCase().includes(normalized);
      const matchesFilter = activeFilter === 'All' || file.kind.toLowerCase().includes(activeFilter.toLowerCase());
      return matchesSearch && matchesFilter;
    });
  }, [files, searchValue, activeFilter]);

  const activeNode = selectedGraphNode ?? nodes[0] ?? null;
  const workspaceMessage = [rootMessage, graphMessage].filter(Boolean).join(' • ');
  const { explanation, teaching, provider, aiMessage, selectedMode, refreshExplain, refreshTeach } = useAiWorkspace({
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
      // After refactor apply, refresh all data
      await refreshFiles();
      await refreshGraph();
    },
  });

  const handleSync = useCallback(async () => {
    try {
      await refreshFiles();
      await refreshGraph();
      toast.addToast('Project synced successfully', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync project';
      toast.addToast(message, 'error');
    }
  }, [refreshFiles, refreshGraph, toast]);

  const handleExplain = useCallback(async () => {
    try {
      await refreshExplain();
      toast.addToast('Explanation refreshed', 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh explanation';
      toast.addToast(message, 'error');
    }
  }, [refreshExplain, toast]);

  const handleTeach = useCallback(async () => {
    try {
      await refreshTeach();
      toast.addToast('Teaching response refreshed', 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh teaching';
      toast.addToast(message, 'error');
    }
  }, [refreshTeach, toast]);

  const handleUpload = useCallback(
    async (formData: FormData) => {
      setLoading('sync', true);
      setUploadMessage('Uploading workspace...');

      try {
        const response = await uploadProjectWorkspace(formData);
        setProjectRoot(response.root_path);
        setUploadMessage(`Workspace uploaded: ${response.workspace_id}`);
        toast.addToast('Workspace uploaded and graph rebuilt', 'success');
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

  useEffect(() => {
    if (selectedFile) {
      return;
    }

    const firstRealFile = files.find((file) => file.kind !== 'folder' && file.kind !== 'directory');
    if (firstRealFile) {
      setSelectedRelativePath(firstRealFile.name);
      setCurrentRefactorTarget(firstRealFile.name);
    }
  }, [files, selectedFile, setCurrentRefactorTarget, setSelectedRelativePath]);

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    'ctrl+s': handleSync,
    'e': handleExplain,
    't': handleTeach,
  });

  return (
    <div className="dashboard-page">
      <Navbar
        title="Visualizer Dashboard"
        subtitle="Local-only developer workspace for graph inspection, AI context, and safe refactors"
        actions={[
          { label: 'Sync file', shortcut: 'Ctrl+S', tone: 'primary', onClick: handleSync },
          { label: 'Explain', shortcut: 'E', onClick: handleExplain },
          { label: 'Teach', shortcut: 'T', onClick: handleTeach },
        ]}
        rightSlot={
          <span className="navbar__badge">
            {backendStatus.message}
            {loading.files || loading.graph ? ' • syncing' : ''}
          </span>
        }
      />

      <DashboardLayout
        sidebar={
          <Sidebar
            files={filteredFiles}
            searchValue={searchValue}
            onSearchChange={setSearchQuery}
            activeFilter={activeFilter}
            filters={filters}
            onFilterChange={setActiveFilter}
            onFileSelect={(fileName) => {
              setSelectedRelativePath(fileName);
              setCurrentRefactorTarget(fileName);
            }}
            onUploadArchive={handleUploadArchive}
            onUploadFolder={handleUploadFolder}
            uploadMessage={uploadMessage}
            uploading={loading.sync}
            selectedPath={selectedFile}
            selectedMetadata={selectedMetadata}
            selectedPreview={selectedPreview}
            workspaceMessage={workspaceMessage}
            loading={loading.files}
          />
        }
        graph={
          <GraphCanvas
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onNodeSelect={(nodeId, nodePath) => {
              setSelectedNodeId(nodeId);
              if (nodePath) {
                setSelectedRelativePath(nodePath);
                setCurrentRefactorTarget(nodePath);
              }
            }}
            onNodeOpen={(nodeId) => {
              setSelectedNodeId(nodeId);
              toast.addToast(`Open details for ${nodeId}`, 'info');
            }}
            loading={loading.graph}
          />
        }
        panel={
          <AiContextPanel
            activeNode={activeNode?.label ?? 'No node selected'}
            teachingPrompt={`Ready to explain ${selectedFile} from node ${activeNode?.label ?? 'unknown'}.`}
            explanation={explanation}
            teaching={teaching}
            provider={provider}
            aiMessage={aiMessage}
            selectedMode={selectedMode}
            onExplain={refreshExplain}
            onTeach={refreshTeach}
            loading={loading.ai}
          />
        }
        consolePane={
          <DiffConsole
            title="Validation output"
            targetFile={targetFile}
            goal={goal}
            onGoalChange={setGoal}
            proposalSummary={proposalSummary}
            validationSummary={validationSummary}
            applySummary={applySummary}
            diffText={proposedCode || diffSample}
            refactorMessage={refactorMessage}
            loading={loading.refactor}
            onPropose={runProposal}
            onValidate={runValidation}
            onApply={runApply}
          />
        }
      />
    </div>
  );
}
