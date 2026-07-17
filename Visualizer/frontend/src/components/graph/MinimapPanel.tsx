import { MiniMap } from 'reactflow';

export default function MinimapPanel() {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-2 shadow-lg">
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => {
          const kind = String(node.data?.kind ?? 'unknown');
          if (kind === 'module' || kind === 'file') {
            return '#7c5cff';
          }
          if (kind === 'class') {
            return '#ffb84d';
          }
          return '#18d69b';
        }}
        maskColor="rgba(6, 8, 13, 0.7)"
      />
    </div>
  );
}
