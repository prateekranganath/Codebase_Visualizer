import { FileListSkeleton } from '../Skeleton';

export type FileSummary = {
  name: string;
  kind: string;
  detail?: string;
  active?: boolean;
};

type SelectedFileMetadata = {
  path?: string;
  kind?: string;
  language?: string;
  size?: number;
  modified_at?: string;
  checksum?: string;
};

type SidebarProps = {
  files: FileSummary[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  activeFilter: string;
  filters: string[];
  onFilterChange: (filter: string) => void;
  onFileSelect: (fileName: string) => void;
  onUploadArchive: (file: File) => void;
  onUploadFolder: (files: FileList) => void;
  uploadMessage: string;
  uploading?: boolean;
  selectedPath: string | null;
  selectedMetadata: SelectedFileMetadata | null;
  selectedPreview: string;
  workspaceMessage: string;
  loading?: boolean;
};

export default function Sidebar({
  files,
  searchValue,
  onSearchChange,
  activeFilter,
  filters,
  onFilterChange,
  onFileSelect,
  onUploadArchive,
  onUploadFolder,
  uploadMessage,
  uploading,
  selectedPath,
  selectedMetadata,
  selectedPreview,
  workspaceMessage,
  loading,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="sidebar__section">
        <div className="sidebar__heading">Files</div>
        <input
          className="sidebar__search"
          type="search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search modules, classes, or functions"
        />
      </section>

      <section className="sidebar__section">
        <div className="sidebar__heading">Filters</div>
        <div className="sidebar__filters">
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`sidebar__filter ${activeFilter === filter ? 'sidebar__filter--active' : ''}`}
              onClick={() => onFilterChange(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar__section">
        <div className="sidebar__heading">Upload workspace</div>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', color: '#9aa2b1' }}>Zip archive</span>
            <input
              type="file"
              accept=".zip"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onUploadArchive(file);
                  event.currentTarget.value = '';
                }
              }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: '0.85rem', color: '#9aa2b1' }}>Folder (Chrome/Edge)</span>
            <input
              type="file"
              multiple
              disabled={uploading}
              // @ts-expect-error - webkitdirectory is supported in Chromium-based browsers
              webkitdirectory="true"
              onChange={(event) => {
                const files = event.target.files;
                if (files && files.length > 0) {
                  onUploadFolder(files);
                  event.currentTarget.value = '';
                }
              }}
            />
          </label>
          <div style={{ fontSize: '0.85rem', color: '#9aa2b1' }}>{uploadMessage}</div>
        </div>
      </section>

      <section className="sidebar__section sidebar__section--selected">
        <div className="sidebar__heading">Selected file</div>
        <div className="sidebar__selected">
          <div className="sidebar__selected-path">{selectedPath}</div>
          <div className="sidebar__selected-meta">
            <span>{selectedMetadata?.kind ?? 'unknown type'}</span>
            <span>{selectedMetadata?.language ?? 'unknown language'}</span>
            <span>{selectedMetadata?.size != null ? `${selectedMetadata.size} bytes` : 'size unavailable'}</span>
          </div>
          <div className="sidebar__selected-note">{workspaceMessage}</div>
          <pre className="sidebar__preview">{selectedPreview || 'File preview will appear here after selection.'}</pre>
        </div>
      </section>

      <section className="sidebar__section sidebar__section--grow">
        {loading ? (
          <FileListSkeleton />
        ) : files.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: '#888', fontSize: '0.9rem' }}>
            No files found. Check your project root configuration.
          </div>
        ) : (
          <ul className="sidebar__files">
            {files.map((file) => (
              <li key={file.name}>
                <button
                  type="button"
                  className={`sidebar__file ${file.active ? 'sidebar__file--active' : ''}`}
                  onClick={() => onFileSelect(file.name)}
                >
                  <span>
                    <strong>{file.name}</strong>
                    <small>{file.kind}</small>
                  </span>
                  <span className="sidebar__file-detail">{file.detail ?? 'Ready'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
