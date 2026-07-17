import { useGraphUiStore } from '../../store/graphUiStore';

export default function GraphFilters() {
  const {
    graphLevel,
    showFunctions,
    showImports,
    showCalls,
    showInheritance,
    highComplexityOnly,
    riskFilter,
    showExternal,
    searchQuery,
    setShowFunctions,
    setShowImports,
    setShowCalls,
    setShowInheritance,
    setHighComplexityOnly,
    setRiskFilter,
    setShowExternal,
    setSearchQuery,
  } = useGraphUiStore();

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 shadow-lg">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-violet-400"
          checked={showFunctions}
          onChange={(event) => setShowFunctions(event.target.checked)}
        />
        Functions
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-sky-400"
          checked={showImports}
          onChange={(event) => setShowImports(event.target.checked)}
        />
        Imports
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-emerald-400"
          checked={showCalls}
          disabled={graphLevel < 3}
          onChange={(event) => setShowCalls(event.target.checked)}
        />
        Calls
      </label>
      <span className="rounded-full border border-slate-700/70 bg-slate-900/70 px-2 py-1 text-slate-400">
        {graphLevel === 1 ? 'Module view' : graphLevel === 2 ? 'Symbol view' : 'Call view'}
      </span>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-rose-400"
          checked={showInheritance}
          onChange={(event) => setShowInheritance(event.target.checked)}
        />
        Inheritance
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-slate-400"
          checked={showExternal}
          onChange={(event) => setShowExternal(event.target.checked)}
        />
        External
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-3 w-3 accent-amber-300"
          checked={highComplexityOnly}
          onChange={(event) => setHighComplexityOnly(event.target.checked)}
        />
        High complexity only
      </label>
      <select
        className="rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-200"
        value={riskFilter}
        onChange={(event) => setRiskFilter(event.target.value as typeof riskFilter)}
      >
        <option value="all">All risk</option>
        <option value="low">Low risk</option>
        <option value="medium">Medium risk</option>
        <option value="high">High risk</option>
      </select>
      <input
        className="rounded-full border border-slate-700/70 bg-slate-900/70 px-3 py-1 text-xs text-slate-200 placeholder:text-slate-500"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search nodes..."
      />
    </div>
  );
}
