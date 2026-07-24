import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
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

type SidebarProps = {
  files: FileSummary[];

  // Keeping these temporarily so Dashboard doesn't break.
  // They can be removed later.
  searchValue: string;
  onSearchChange: (value: string) => void;
  activeFilter: string;
  filters: string[];
  onFilterChange: (filter: string) => void;

  onFileSelect: (fileName: string) => void;
  selectedPath: string | null;
  loading?: boolean;
};

export default function Sidebar({
  files,
  onFileSelect,
  selectedPath,
  loading = false,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(
    () => window.innerWidth <= 1024
  );

  const groupedFiles = files.reduce((acc, file) => {
    const folder = file.name.includes('/')
      ? file.name.substring(0, file.name.lastIndexOf('/'))
      : 'Project Root';

    if (!acc[folder]) {
      acc[folder] = [];
    }

    acc[folder].push(file);

    return acc;
  }, {} as Record<string, FileSummary[]>);

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
              {Object.entries(groupedFiles)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([folder, items]) => (
                  <div
                    key={folder}
                    className="sidebar__folder"
                  >
                    <div className="sidebar__folder-title">
                      <Folder size={15} />

                      <span>
                        {folder.split('/').pop()}
                      </span>
                    </div>

                    {items
                      .sort((a, b) =>
                        a.name.localeCompare(b.name)
                      )
                      .map((file) => (
                        <button
                          key={file.name}
                          type="button"
                          className={`sidebar__file ${
                            selectedPath === file.name ||
                            file.active
                              ? 'sidebar__file--active'
                              : ''
                          }`}
                          onClick={() =>
                            onFileSelect(file.name)
                          }
                          title={file.name}
                        >
                          <File size={14} />

                          <span>
                            {file.name.split('/').pop()}
                          </span>
                        </button>
                      ))}
                  </div>
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