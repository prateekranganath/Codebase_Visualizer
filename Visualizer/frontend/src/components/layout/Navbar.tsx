import type { ReactNode } from "react";
import { HardDriveUpload, Search } from "lucide-react";

type NavbarProps = {
  title?: string;
  backendStatusNode?: ReactNode;
  onUploadClick: () => void;
};

export default function Navbar({
  title = "Codebase Visualizer",
  backendStatusNode,
  onUploadClick,
}: NavbarProps) {
  return (
    <header className="navbar">

      {/* Logo */}

      <div className="navbar__logo">
        <div className="navbar__logo-icon">⬡</div>

        <h1 className="navbar__title">
          {title}
        </h1>
      </div>

      {/* Global Search */}

      <div className="navbar__search">

        <Search size={15} />

        <input
          type="text"
          placeholder="Search files, classes, functions..."
        />

      </div>

      {/* Right Actions */}

      <nav className="navbar__actions">

        <button
          className="navbar__btn navbar__btn--primary"
          onClick={onUploadClick}
        >
          <HardDriveUpload size={15}/>
          Upload
        </button>

        {backendStatusNode}

      </nav>

    </header>
  );
}