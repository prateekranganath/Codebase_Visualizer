import type { ReactNode } from 'react';

type DashboardLayoutProps = {
  sidebar: ReactNode;
  graph: ReactNode;
  panel: ReactNode;
  consolePane: ReactNode;
};

export default function DashboardLayout({ sidebar, graph, panel, consolePane }: DashboardLayoutProps) {
  return (
    <div className="dashboard-shell">
      <div className="dashboard-shell__top">{sidebar}</div>
      <div className="dashboard-shell__main">
        <div className="dashboard-shell__graph">{graph}</div>
        <div className="dashboard-shell__panel">{panel}</div>
      </div>
      <div className="dashboard-shell__console">{consolePane}</div>
    </div>
  );
}
