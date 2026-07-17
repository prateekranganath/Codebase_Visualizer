import { useCallback, useEffect, useMemo, useState } from 'react';
import { getHealth, getProjectMetadata, listProjectFiles, readProjectFile, syncProjectFile } from '../api';
import type { ProjectFileEntry, ProjectMetadataResponse } from '../types/backend';
import type { FileSummary } from '../components/layout/Sidebar';
import { useWorkspaceStore } from '../store/workspaceStore';

function formatFileDetail(entry: ProjectFileEntry) {
  if (entry.status) {
    return entry.status;
  }

  if (entry.size != null) {
    return `${entry.size} bytes`;
  }

  return entry.language ?? 'Ready';
}

function isFileEntry(entry: ProjectFileEntry | string): entry is ProjectFileEntry {
  return typeof entry !== 'string';
}

function looksLikeFilePath(value: string) {
  return /\.[a-z0-9]+$/i.test(value);
}

function selectDefaultFile(files: Array<ProjectFileEntry | string>): string | null {
  const fileEntry = files.find((entry) => isFileEntry(entry) ? !entry.is_dir : looksLikeFilePath(entry));
  if (!fileEntry) {
    return null;
  }

  return isFileEntry(fileEntry) ? (fileEntry.path || fileEntry.name) : fileEntry;
}

function mapStringFile(name: string, selectedPath: string | null): FileSummary {
  const isDirectoryLike = !looksLikeFilePath(name);

  return {
    name,
    kind: isDirectoryLike ? 'folder' : 'file',
    detail: isDirectoryLike ? 'Folder' : 'Ready',
    active: selectedPath != null && name === selectedPath,
  };
}

function mapProjectFile(entry: ProjectFileEntry, selectedPath: string | null): FileSummary {
  return {
    name: entry.path || entry.name,
    kind: entry.kind ?? (entry.is_dir ? 'folder' : 'file'),
    detail: formatFileDetail(entry),
    active: (selectedPath != null && (entry.path === selectedPath || entry.name === selectedPath)) || entry.active,
  };
}

function inferKindFromPath(path: string) {
  return /\.[a-z0-9]+$/i.test(path) ? 'file' : 'folder';
}

function inferLanguageFromPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'py':
      return 'python';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    default:
      return undefined;
  }
}

function estimateSize(content: string) {
  if (!content) {
    return undefined;
  }

  return new TextEncoder().encode(content).length;
}

function normalizeSelectedMetadata(
  path: string,
  content: string,
  metadata: ProjectMetadataResponse | null,
): ProjectMetadataResponse {
  return {
    path,
    exists: metadata?.exists ?? true,
    size: metadata?.size ?? estimateSize(content),
    modified_at: metadata?.modified_at,
    kind: metadata?.kind ?? inferKindFromPath(path),
    language: metadata?.language ?? inferLanguageFromPath(path),
    checksum: metadata?.checksum,
  };
}

export function useProjectWorkspace(projectRoot: string, selectedRelativePath: string | null) {
  const setBackendStatus = useWorkspaceStore((state) => state.setBackendStatus);
  const setLoading = useWorkspaceStore((state) => state.setLoading);
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<ProjectMetadataResponse | null>(null);
  const [selectedContent, setSelectedContent] = useState<string>('');
  const [rootMessage, setRootMessage] = useState<string>('');

  useEffect(() => {
    let active = true;

    async function loadRootData() {
      if (!projectRoot) {
        setRootMessage('Set VITE_PROJECT_ROOT to load the backend workspace.');
        setBackendStatus({
          state: 'offline',
          message: 'Project root not configured',
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }

      setLoading('files', true);

      try {
        const [health, fileList] = await Promise.all([getHealth(), listProjectFiles({ root_dir: projectRoot })]);

        if (!active) {
          return;
        }

        setBackendStatus({
          state: health.status === 'ok' ? 'online' : 'offline',
          message: health.status === 'ok' ? 'Backend connected' : `Backend status: ${health.status}`,
          lastCheckedAt: new Date().toISOString(),
        });
        const defaultSelected = selectedRelativePath ?? selectDefaultFile(fileList.files);
        setFiles(
          fileList.files.map((entry) =>
            isFileEntry(entry) ? mapProjectFile(entry, defaultSelected) : mapStringFile(entry, defaultSelected),
          ),
        );
        setRootMessage(fileList.relative_path ? `Loaded ${fileList.relative_path}` : `Loaded ${fileList.files.length} items`);
      } catch (error) {
        if (!active) {
          return;
        }

        setRootMessage(error instanceof Error ? error.message : 'Failed to load project files');
        setBackendStatus({
          state: 'offline',
          message: 'Project workspace unavailable',
          lastCheckedAt: new Date().toISOString(),
        });
        setFiles([]);
      } finally {
        if (active) {
          setLoading('files', false);
        }
      }
    }

    void loadRootData();

    return () => {
      active = false;
    };
  }, [projectRoot, selectedRelativePath, setBackendStatus, setLoading]);

  useEffect(() => {
    let active = true;

    async function loadSelectedFile() {
      if (!projectRoot || !selectedRelativePath) {
        setSelectedMetadata(null);
        setSelectedContent('');
        return;
      }

      try {
        const [fileResponse, metadataResponse] = await Promise.all([
          readProjectFile({ root_dir: projectRoot, relative_path: selectedRelativePath }),
          getProjectMetadata({ root_dir: projectRoot, relative_path: selectedRelativePath }),
        ]);

        if (!active) {
          return;
        }

        setSelectedContent(fileResponse.content);
        setSelectedMetadata(normalizeSelectedMetadata(selectedRelativePath, fileResponse.content, metadataResponse));
      } catch (error) {
        if (!active) {
          return;
        }

        setSelectedContent(error instanceof Error ? error.message : 'Failed to load file');
        setSelectedMetadata(null);
      }
    }

    void loadSelectedFile();

    return () => {
      active = false;
    };
  }, [projectRoot, selectedRelativePath]);

  const selectedPreview = useMemo(() => {
    if (!selectedContent) {
      return '';
    }

    return selectedContent.split('\n').slice(0, 14).join('\n');
  }, [selectedContent]);

  const refreshFiles = useCallback(async () => {
    if (!projectRoot) {
      setRootMessage('Cannot sync: project root not configured');
      return;
    }

    setLoading('files', true);
    setRootMessage('Syncing project...');

    try {
      await syncProjectFile({ root_dir: projectRoot });
      
      // Reload file list
      const fileList = await listProjectFiles({ root_dir: projectRoot });
      const defaultSelected = selectedRelativePath ?? selectDefaultFile(fileList.files);
      setFiles(
        fileList.files.map((entry) =>
          isFileEntry(entry) ? mapProjectFile(entry, defaultSelected) : mapStringFile(entry, defaultSelected),
        ),
      );
      setRootMessage('Sync complete - project refreshed');

      // Reload selected file if one is selected
      if (selectedRelativePath) {
        const [fileResponse, metadataResponse] = await Promise.all([
          readProjectFile({ root_dir: projectRoot, relative_path: selectedRelativePath }),
          getProjectMetadata({ root_dir: projectRoot, relative_path: selectedRelativePath }),
        ]);
        setSelectedContent(fileResponse.content);
        setSelectedMetadata(normalizeSelectedMetadata(selectedRelativePath, fileResponse.content, metadataResponse));
      }
    } catch (error) {
      setRootMessage(error instanceof Error ? error.message : 'Failed to sync project');
    } finally {
      setLoading('files', false);
    }
  }, [projectRoot, selectedRelativePath, setLoading]);

  return {
    files,
    selectedMetadata,
    selectedContent,
    selectedPreview,
    rootMessage,
    refreshFiles,
  };
}
