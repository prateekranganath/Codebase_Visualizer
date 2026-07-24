import type { ReactNode } from 'react';

type DashboardLayoutProps = {
  navbar: ReactNode;
  sidebar: ReactNode;
  graphWorkspace: ReactNode;
  statusBar: ReactNode;
};

/**
 * Full-viewport flex shell:
 *   Navbar (fixed height)
 *   ├─ Sidebar (collapsible)
 *   └─ GraphWorkspace (fills remaining space)
 *   StatusBar (fixed height)
 */
export default function DashboardLayout({ navbar, sidebar, graphWorkspace, statusBar }: DashboardLayoutProps) {
  return (
    <div className="app-shell">
      {navbar}
      <div className="workspace-area">
        {sidebar}
        {graphWorkspace}
      </div>
      {statusBar}
    </div>
  );
}
