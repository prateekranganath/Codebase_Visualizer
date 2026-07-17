import '../styles/skeleton.css';

export function FileSkeleton() {
  return (
    <div className="skeleton skeleton--file">
      <div className="skeleton__line" style={{ width: '70%' }} />
      <div className="skeleton__line" style={{ width: '50%' }} />
    </div>
  );
}

export function FileListSkeleton() {
  return (
    <div className="skeleton-container">
      {Array.from({ length: 5 }).map((_, i) => (
        <FileSkeleton key={i} />
      ))}
    </div>
  );
}

export function GraphSkeleton() {
  return (
    <div className="skeleton skeleton--graph">
      <div className="skeleton__circle" style={{ top: '20%', left: '30%' }} />
      <div className="skeleton__circle" style={{ top: '50%', left: '50%' }} />
      <div className="skeleton__circle" style={{ top: '70%', left: '20%' }} />
    </div>
  );
}

export function AiResponseSkeleton() {
  return (
    <div className="skeleton skeleton--response">
      <div className="skeleton__line" style={{ width: '100%' }} />
      <div className="skeleton__line" style={{ width: '95%' }} />
      <div className="skeleton__line" style={{ width: '80%' }} />
      <div className="skeleton__line" style={{ width: '90%' }} />
    </div>
  );
}
