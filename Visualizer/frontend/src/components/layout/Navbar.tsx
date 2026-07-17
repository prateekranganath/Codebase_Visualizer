import type { ReactNode } from 'react';

export type NavbarAction = {
  label: string;
  shortcut?: string;
  tone?: 'primary' | 'neutral';
  onClick?: () => void | Promise<void>;
};

type NavbarProps = {
  title: string;
  subtitle: string;
  actions: NavbarAction[];
  rightSlot?: ReactNode;
};

export default function Navbar({ title, subtitle, actions, rightSlot }: NavbarProps) {
  const handleActionClick = async (action: NavbarAction) => {
    if (action.onClick) {
      await action.onClick();
    }
  };

  return (
    <header className="navbar">
      <div className="navbar__brand">
        <div className="navbar__eyebrow">AI-Powered Codebase Visualizer</div>
        <div>
          <h1 className="navbar__title">{title}</h1>
          <p className="navbar__subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="navbar__actions">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`navbar__action navbar__action--${action.tone ?? 'neutral'}`}
            type="button"
            onClick={() => handleActionClick(action)}
          >
            <span>{action.label}</span>
            {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
          </button>
        ))}
        {rightSlot}
      </div>
    </header>
  );
}
