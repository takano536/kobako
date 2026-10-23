import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './theme';

type Listener = () => void;

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly style: { colorScheme: string } = { colorScheme: '' };
  readonly children: FakeElement[] = [];
  name = '';
  content = '';

  constructor(
    readonly tagName: string,
    private readonly onMutation: Listener = () => {},
  ) {}

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    this.onMutation();
  }

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  insertBefore(child: FakeElement, reference: FakeElement | null): void {
    const existing = this.children.indexOf(child);
    if (existing !== -1) this.children.splice(existing, 1);
    const index = reference ? this.children.indexOf(reference) : -1;
    this.children.splice(index === -1 ? this.children.length : index, 0, child);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector !== 'meta[name="theme-color"]') throw new Error(`unexpected ${selector}`);
    return (
      this.children.find((child) => child.tagName === 'meta' && child.name === 'theme-color') ??
      null
    );
  }
}

/** A minimal browser surface: only what the theme script touches, so any other global is undefined. */
function createPage({
  stored,
  storageThrows = false,
  prefersDark = false,
}: {
  stored?: string;
  storageThrows?: boolean;
  prefersDark?: boolean;
}) {
  const observers: Listener[] = [];
  const notify = () => observers.forEach((callback) => callback());
  const root = new FakeElement('html', notify);
  const head = new FakeElement('head');
  head.insertBefore(new FakeElement('meta'), null);
  const mediaListeners: Listener[] = [];
  const media = {
    matches: prefersDark,
    addEventListener: (_type: string, listener: Listener) => mediaListeners.push(listener),
  };
  const storage = new Map<string, string>(
    stored === undefined ? [] : [[THEME_STORAGE_KEY, stored]],
  );
  const window: Record<string, unknown> = {
    matchMedia: () => media,
    addEventListener: () => {},
  };
  Object.defineProperty(window, 'localStorage', {
    get() {
      if (storageThrows) throw new Error('SecurityError');
      return { getItem: (key: string) => storage.get(key) ?? null };
    },
  });
  const context = {
    window,
    document: {
      documentElement: root,
      head,
      createElement: (tagName: string) => new FakeElement(tagName),
    },
    MutationObserver: class {
      constructor(private readonly callback: Listener) {}
      observe() {
        observers.push(this.callback);
      }
    },
    Object,
  };
  return {
    run: () => runInNewContext(THEME_INIT_SCRIPT, context),
    root,
    head,
    setPrefersDark(value: boolean) {
      media.matches = value;
      mediaListeners.forEach((listener) => listener());
    },
  };
}

function themeOf(page: { root: FakeElement; head: FakeElement }) {
  return {
    preference: page.root.getAttribute('data-theme-preference'),
    theme: page.root.getAttribute('data-theme'),
    colorScheme: page.root.style.colorScheme,
    themeColor: page.head.querySelector('meta[name="theme-color"]')?.content,
  };
}

describe('THEME_INIT_SCRIPT', () => {
  it('runs without bundler helpers such as __name in scope', () => {
    expect(THEME_INIT_SCRIPT).not.toContain('__name');
    const page = createPage({ stored: 'dark' });
    expect(() => page.run()).not.toThrow();
  });

  it('applies a stored explicit theme regardless of the OS setting', () => {
    const page = createPage({ stored: 'dark', prefersDark: false });
    page.run();
    expect(themeOf(page)).toEqual({
      preference: 'dark',
      theme: 'dark',
      colorScheme: 'dark',
      themeColor: '#1a1f1c',
    });
    page.setPrefersDark(true);
    page.setPrefersDark(false);
    expect(themeOf(page).theme).toBe('dark');
  });

  it('treats unknown values and unavailable storage as system and follows the OS', () => {
    for (const page of [
      createPage({ stored: 'sepia', prefersDark: true }),
      createPage({ storageThrows: true, prefersDark: true }),
    ]) {
      page.run();
      expect(themeOf(page)).toEqual({
        preference: 'system',
        theme: 'dark',
        colorScheme: 'dark',
        themeColor: '#1a1f1c',
      });
      page.setPrefersDark(false);
      expect(themeOf(page)).toEqual({
        preference: 'system',
        theme: 'light',
        colorScheme: 'light',
        themeColor: '#fcfcf8',
      });
    }
  });

  it('resolves a preference written by the settings UI and ignores a second run', () => {
    const page = createPage({ prefersDark: false });
    page.run();
    page.root.setAttribute('data-theme-preference', 'dark');
    expect(themeOf(page).theme).toBe('dark');
    page.run();
    expect(page.head.children.filter((child) => child.name === 'theme-color')).toHaveLength(1);
    expect(themeOf(page).theme).toBe('dark');
  });
});
