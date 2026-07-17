import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { CodeNodeData } from '../../types/graph';
import { 
  Folder, 
  Box, 
  Code, 
  AlertTriangle, 
  AlertCircle, 
  ChevronDown, 
  ChevronRight 
} from 'lucide-react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for cleaner tailwind classes
function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const CodeNode = ({ data, selected }: { data: CodeNodeData; selected?: boolean }) => {
  const { display_name, type, risk, path, hasChildren, isCollapsed, onToggleCollapse } = data;

  const isHighRisk = risk === 'high';
  const isMediumRisk = risk === 'medium';

  // Base styling for different node types
  const typeStyles = {
    module: 'bg-slate-800 border-slate-600',
    class: 'bg-indigo-950 border-indigo-700',
    function: 'bg-slate-900 border-slate-700 rounded-full px-6 py-2',
  };

  const TypeIcon = type === 'module' ? Folder : type === 'class' ? Box : Code;

  return (
    <div
      className={cn(
        'relative flex items-center gap-3 border-2 shadow-lg transition-all duration-300 group',
        type === 'function' ? 'rounded-full' : 'rounded-xl p-4 min-w-[240px]',
        typeStyles[type],
        selected ? 'ring-2 ring-blue-500 shadow-blue-500/20' : '',
        isHighRisk ? 'border-red-500/80 shadow-red-500/20' : '',
        isMediumRisk && !isHighRisk ? 'border-amber-500/80 shadow-amber-500/20' : ''
      )}
      title={path} // Native tooltip as fallback, though we can use a custom tooltip if preferred
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-slate-500 border-2 border-slate-800" />
      
      {/* Icon */}
      <div className={cn(
        'flex items-center justify-center p-2 rounded-lg',
        type === 'module' ? 'bg-slate-700 text-slate-300' : 
        type === 'class' ? 'bg-indigo-800 text-indigo-300' : 'bg-slate-800 text-slate-300'
      )}>
        <TypeIcon size={18} />
      </div>

      {/* Label & Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {display_name}
          </h3>
          
          {/* Risk Badge */}
          {isHighRisk && (
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
          )}
          {isMediumRisk && (
            <AlertCircle size={16} className="text-amber-400 shrink-0" />
          )}
        </div>
        
        {type !== 'function' && (
          <p className="text-xs text-slate-400 truncate opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-6 left-0 bg-slate-800 px-2 py-1 rounded shadow-xl z-10">
            {path}
          </p>
        )}
      </div>

      {/* Expand/Collapse Button */}
      {hasChildren && (
        <button
          className="p-1 hover:bg-slate-700/50 rounded transition-colors text-slate-400 hover:text-white"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(data.id);
          }}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-slate-500 border-2 border-slate-800" />
    </div>
  );
};

export default memo(CodeNode);
