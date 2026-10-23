export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** The only localStorage key for the theme; absent or unknown values mean `system`. */
export const THEME_STORAGE_KEY = 'kobako-theme';

/** Set on `<html>` by the inline script: the chosen preference and the theme it resolves to. */
export const THEME_PREFERENCE_ATTRIBUTE = 'data-theme-preference';
export const THEME_ATTRIBUTE = 'data-theme';

/** Browser UI colors; each matches `--paper` of the theme in `globals.css`. */
export const THEME_COLORS: Readonly<Record<ResolvedTheme, string>> = {
  light: '#fcfcf8',
  dark: '#1a1f1c',
};

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

type ThemeScriptConfig = {
  storageKey: string;
  preferenceAttribute: string;
  themeAttribute: string;
  colors: Readonly<Record<ResolvedTheme, string>>;
  /** Window property that marks the document as initialized, so a second run is a no-op. */
  initializedKey: string;
};

export const THEME_SCRIPT_CONFIG: ThemeScriptConfig = {
  storageKey: THEME_STORAGE_KEY,
  preferenceAttribute: THEME_PREFERENCE_ATTRIBUTE,
  themeAttribute: THEME_ATTRIBUTE,
  colors: THEME_COLORS,
  initializedKey: '__kobakoTheme',
};

/**
 * Serialized into an inline `<head>` script, so it must stay self-contained (no imports or
 * closures). It runs before the first paint and lives for the whole document. Documents whose
 * head React renders on the client (the error shell of unmatched routes) never run the inline
 * script, so `ThemeScript` calls it after hydration as well; the second call is a no-op.
 *
 * `<html data-theme-preference>` is the in-session source of truth: the settings UI writes it after
 * trying to persist, so a failed localStorage write still keeps the chosen theme. The script
 * resolves it into `data-theme`, `color-scheme`, and its own `theme-color` meta, kept ahead of
 * the viewport metas (whose `media` defaults serve no-JS loads; editing them makes React re-insert
 * them, and client navigations re-render the head without this meta). It follows
 * `prefers-color-scheme` while the preference is `system`, mirrors other tabs through the
 * `storage` event, and re-applies when React drops the attributes (development remounts).
 */
export function initTheme(config: ThemeScriptConfig): void {
  if (config.initializedKey in window) return;
  Object.defineProperty(window, config.initializedKey, { value: true });
  const root = document.documentElement;
  const themeColor = document.createElement('meta');
  themeColor.name = 'theme-color';
  let media: MediaQueryList | null = null;
  try {
    media = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    media = null;
  }

  function storedPreference(): ThemePreference {
    try {
      const value = window.localStorage.getItem(config.storageKey);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
      return 'system';
    }
  }

  function apply(): void {
    const attribute = root.getAttribute(config.preferenceAttribute);
    const preference: ThemePreference =
      attribute === 'light' || attribute === 'dark' || attribute === 'system'
        ? attribute
        : storedPreference();
    if (attribute !== preference) root.setAttribute(config.preferenceAttribute, preference);
    const theme: ResolvedTheme =
      preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
    if (root.getAttribute(config.themeAttribute) !== theme) {
      root.setAttribute(config.themeAttribute, theme);
    }
    if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
    if (themeColor.content !== config.colors[theme]) themeColor.content = config.colors[theme];
    if (document.head.querySelector('meta[name="theme-color"]') !== themeColor) {
      document.head.insertBefore(themeColor, document.head.firstChild);
    }
  }

  apply();
  media?.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key === config.storageKey || event.key === null) {
      root.setAttribute(config.preferenceAttribute, storedPreference());
    }
  });
  new MutationObserver(apply).observe(root, {
    attributes: true,
    attributeFilter: [config.themeAttribute, config.preferenceAttribute],
  });
  new MutationObserver(apply).observe(document.head, { childList: true });
}

export const THEME_INIT_SCRIPT = `(${initTheme.toString()})(${JSON.stringify(THEME_SCRIPT_CONFIG)});`;
