const NODE_KEYS = [
  { label: 'Folder', className: 'glegend__swatch glegend__swatch--folder' },
  { label: 'Module', className: 'glegend__swatch glegend__swatch--module' },
  { label: 'Class', className: 'glegend__swatch glegend__swatch--class' },
  { label: 'Function', className: 'glegend__swatch glegend__swatch--function' },
];

const EDGE_KEYS = [
  { label: 'Import', className: 'glegend__line glegend__line--import' },
  { label: 'Call', className: 'glegend__line glegend__line--call' },
  { label: 'Inheritance', className: 'glegend__line glegend__line--inherits' },
];

/**
 * Containment is intentionally absent: nesting shows it, so the canvas draws no
 * containment edges and a legend entry for one would be a lie.
 */
export default function GraphLegend() {
  return (
    <div className="glegend">
      <div className="glegend__title">Legend</div>
      <div className="glegend__grid">
        {NODE_KEYS.map((item) => (
          <div key={item.label} className="glegend__row">
            <span className={item.className} />
            <span>{item.label}</span>
          </div>
        ))}
        <div className="glegend__divider" />
        {EDGE_KEYS.map((item) => (
          <div key={item.label} className="glegend__row">
            <span className={item.className} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="glegend__hint">Click to expand · double-click to zoom in</div>
    </div>
  );
}
