export default function GraphLegend() {
  return (
    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-3 text-xs text-slate-200 shadow-lg">
      <div className="text-[0.7rem] uppercase tracking-[0.2em] text-slate-400">Legend</div>
      <div className="mt-2 grid gap-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-violet-400" />
          <span>Module</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span>Class</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span>Function</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-6 rounded-full bg-sky-400" />
          <span>Import</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-6 rounded-full bg-emerald-400" />
          <span>Call</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-6 rounded-full bg-rose-400" />
          <span>Inheritance</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-[2px] w-6 rounded-full bg-slate-500" />
          <span>Containment</span>
        </div>
      </div>
    </div>
  );
}
