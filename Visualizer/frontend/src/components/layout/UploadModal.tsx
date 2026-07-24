import { useRef } from 'react';
import { Upload, FolderOpen, X, HardDriveUpload } from 'lucide-react';

type UploadModalProps = {
  onClose: () => void;
  onUploadArchive: (file: File) => void;
  onUploadFolder: (files: FileList) => void;
  uploadMessage: string;
  uploading?: boolean;
};

export default function UploadModal({
  onClose,
  onUploadArchive,
  onUploadFolder,
  uploadMessage,
  uploading,
}: UploadModalProps) {
  const archiveRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Upload project"
    >
      <div className="modal">
        {/* Header */}
        <div className="modal__header">
          <div className="modal__icon">
            <HardDriveUpload size={18} />
          </div>
          <h2 className="modal__title">Upload Project</h2>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close modal"
            disabled={uploading}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal__body">
          {/* Zip upload */}
          <div className="modal__upload-zone">
            <span className="modal__upload-label">Zip Archive (.zip)</span>
            <label style={{ position: 'relative', cursor: uploading ? 'not-allowed' : 'pointer' }}>
              <div className="modal__upload-input-row">
                <Upload size={16} className="modal__upload-icon" />
                <span className="modal__upload-text">Click to select a .zip archive</span>
              </div>
              <input
                ref={archiveRef}
                type="file"
                accept=".zip"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onUploadArchive(file);
                    e.currentTarget.value = '';
                  }
                }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 1 }}
                aria-label="Upload zip archive"
              />
            </label>
          </div>

          {/* Folder upload */}
          <div className="modal__upload-zone">
            <span className="modal__upload-label">Project Folder (Chrome / Edge)</span>
            <label style={{ position: 'relative', cursor: uploading ? 'not-allowed' : 'pointer' }}>
              <div className="modal__upload-input-row">
                <FolderOpen size={16} className="modal__upload-icon" />
                <span className="modal__upload-text">Click to select a project folder</span>
              </div>
              <input
                ref={folderRef}
                type="file"
                multiple
                disabled={uploading}
                // @ts-expect-error - webkitdirectory supported in Chromium
                webkitdirectory="true"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    onUploadFolder(files);
                    e.currentTarget.value = '';
                  }
                }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 1 }}
                aria-label="Upload project folder"
              />
            </label>
          </div>

          {/* Status */}
          <div className="modal__status">
            <span
              className={`status-dot ${uploading ? 'status-dot--loading' : 'status-dot--success'}`}
            />
            <span>{uploadMessage}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="modal__footer">
          <button
            type="button"
            className="navbar__btn"
            onClick={onClose}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
