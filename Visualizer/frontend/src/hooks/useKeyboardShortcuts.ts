import { useEffect } from 'react';

type ShortcutMap = {
  [key: string]: () => void | Promise<void>;
};

export function useKeyboardShortcuts(shortcuts: ShortcutMap) {
  useEffect(() => {
    const handleKeyDown = async (event: KeyboardEvent) => {
      // Ctrl+S for sync
      if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        await shortcuts['ctrl+s']?.();
      }

      // E for explain (when not in input field)
      if (event.key.toLowerCase() === 'e' && !isInInput(event.target)) {
        event.preventDefault();
        await shortcuts['e']?.();
      }

      // T for teach (when not in input field)
      if (event.key.toLowerCase() === 't' && !isInInput(event.target)) {
        event.preventDefault();
        await shortcuts['t']?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [shortcuts]);
}

function isInInput(target: EventTarget | null): boolean {
  if (!target) return false;
  const element = target as HTMLElement;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}
