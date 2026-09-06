import { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Files,
  Folder,
  File,
} from 'lucide-react';
import { FileListSkeleton } from '../Skeleton';

export type FileSummary = {
  name: string;
  kind: string;
  detail?: string;
  active?: boolean;
};

type TreeNode = {
  name: string;
  path: string;
  file?: FileSummary;
  children: Map<string, TreeNode>;
};

type SidebarProps = {
  files: FileSummary[];
  onFileSelect: (fileName: string) => void;
  selectedPath: string | null;
  loading?: boolean;
};

function buildTree(files: FileSummary[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };

  files.forEach((file) => {
    const segments = file.name.split('/').filter(Boolean);
    let node = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join('/');
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map() };
        node.children.set(segment, child);
      }
      if (isLeaf) {
        child.file = file;
      }
      node = child;
    });
  });

  return root;
}

function collectAncestorFolders(path: string | null): Set<string> {
  const ancestors = new Set<string>();
  if (!path) {
    return ancestors;
  }
  const segments = path.split('/').filter(Boolean);
  for (let i = 1; i < segments.length; i += 1) {
    ancestors.add(segments.slice(0, i).join('/'));
  }
  return ancestors;
}

function sortChildren(children: Map<string, TreeNode>): TreeNode[] {
  return Array.from(children.values()).sort((a, b) => {
    const aIsFolder = a.children.size > 0 && !a.file;
    const bIsFolder = b.children.size > 0 && !b.file;
    if (aIsFolder !== bIsFolder) {
      return aIsFolder ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function FolderNode({
  node,
  depth,
  selectedPath,
  onFileSelect,
  expanded,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onFileSelect: (fileName: string) => void;
  expanded: Record<string, boolean>;
  onToggle: (path: string, isOpen: boolean) => void;
}) {
  const children = sortChildren(node.children);
  const isFile = Boolean(node.file) && node.children.size === 0;

  if (isFile && node.file) {
    const file = node.file;
    return (
      <button
        type="button"
        className={`sidebar__file ${selectedPath === file.name || file.active ? 'sidebar__file--active' : ''}`}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onFileSelect(file.name)}
        title={file.name}
      >
        <File size={14} />
        <span>{node.name}</span>
      </button>
    );
  }

  // Root-level folders (depth 0) default open; nested folders default closed
  // unless `expanded` (which already has selected-file ancestors merged in)
  // says otherwise.
  const isOpen = expanded[node.path] ?? depth === 0;

  return (
    <div className="sidebar__branch">
      <button
        type="button"
        className="sidebar__folder-title sidebar__folder-title--toggle"
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => onToggle(node.path, isOpen)}
        aria-expanded={isOpen}
      >
        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={14} />
        <span>{node.name || 'Project Root'}</span>
      </button>
      {isOpen && (
        <div className="sidebar__branch-children">
          {children.map((child) => (
            <FolderNode
              key={child.path || child.name}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({
  files,
  onFileSelect,
  selectedPath,
  loading = false,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => window.innerWidth <= 1024
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => buildTree(files), [files]);
  // Folders on the path to the selected file are always shown open, even before
  // the user has manually toggled anything, so selecting a nested file (e.g. from
  // the graph) doesn't leave it hidden inside a collapsed folder.
  const ancestorFolders = useMemo(() => collectAncestorFolders(selectedPath), [selectedPath]);
  const effectiveExpanded = useMemo(() => {
    const merged = { ...expanded };
    ancestorFolders.forEach((path) => {
      merged[path] = true;
    });
    return merged;
  }, [expanded, ancestorFolders]);

  const handleToggle = (path: string, isOpen: boolean) => {
    setExpanded((prev) => ({ ...prev, [path]: !isOpen }));
  };

  const rootChildren = sortChildren(tree.children);

  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
      aria-label="Project Explorer"
    >
      {/* Header */}
      <div className="sidebar__header">
        {!collapsed && (
          <div>
            <div className="sidebar__header-label">
              Explorer
            </div>

            <div className="sidebar__header-subtitle">
              Project Files
            </div>
          </div>
        )}

        <button
          type="button"
          className="sidebar__toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={
            collapsed
              ? 'Expand sidebar'
              : 'Collapse sidebar'
          }
        >
          {collapsed ? (
            <ChevronRight size={13} />
          ) : (
            <ChevronLeft size={13} />
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="sidebar__body">
          {loading ? (
            <FileListSkeleton />
          ) : files.length === 0 ? (
            <div className="sidebar__empty">
              No project loaded.
            </div>
          ) : (
            <div className="sidebar__tree">
              {rootChildren.map((child) => (
                <FolderNode
                  key={child.path || child.name}
                  node={child}
                  depth={0}
                  selectedPath={selectedPath}
                  onFileSelect={onFileSelect}
                  expanded={effectiveExpanded}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {collapsed && (
        <div className="sidebar__icon-rail">
          <button
            type="button"
            className="sidebar__rail-btn"
            onClick={() => setCollapsed(false)}
            title="Project Explorer"
            aria-label="Project Explorer"
          >
            <Files size={16} />
          </button>

          <button
            type="button"
            className="sidebar__rail-btn"
            title="Architecture View"
            aria-label="Architecture View"
          >
            <Folder size={16} />
          </button>
        </div>
      )}
    </aside>
  );
}
