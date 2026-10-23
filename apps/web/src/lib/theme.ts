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

const THEME_SCRIPT_CONFIG: ThemeScriptConfig = {
  storageKey: THEME_STORAGE_KEY,
  preferenceAttribute: THEME_PREFERENCE_ATTRIBUTE,
  themeAttribute: THEME_ATTRIBUTE,
  colors: THEME_COLORS,
  initializedKey: '__kobakoTheme',
};

/**
 * Body of `function (c) { … }` with `c: ThemeScriptConfig`. It is a hand-written string, not a
 * stringified compiled function: bundlers inject helpers into compiled functions (wrangler's
 * `keepNames` adds `__name(...)` calls), and those helpers do not exist in the page.
 *
 * It runs before the first paint and lives for the whole document. Documents whose head React
 * renders on the client (the error shell of unmatched routes) never run the inline script, so
 * `ThemeScript` executes the same script after hydration; the second run is a no-op.
 *
 * `<html data-theme-preference>` is the in-session source of truth: the settings UI writes it after
 * trying to persist, so a failed localStorage write still keeps the chosen theme. The script
 * resolves it into `data-theme`, `color-scheme`, and its own `theme-color` meta, kept ahead of
 * the viewport metas (whose `media` defaults serve no-JS loads; editing them makes React re-insert
 * them, and client navigations re-render the head without this meta). It follows
 * `prefers-color-scheme` while the preference is `system`, mirrors other tabs through the
 * `storage` event, and re-applies when React drops the attributes (development remounts).
 */
const THEME_INIT_BODY = `
if (c.initializedKey in window) return;
Object.defineProperty(window, c.initializedKey, { value: true });
var root = document.documentElement;
var themeColor = document.createElement('meta');
themeColor.name = 'theme-color';
var media = null;
try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch (error) { media = null; }
function storedPreference() {
  try {
    var value = window.localStorage.getItem(c.storageKey);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch (error) {
    return 'system';
  }
}
function apply() {
  var attribute = root.getAttribute(c.preferenceAttribute);
  var preference = attribute === 'light' || attribute === 'dark' || attribute === 'system'
    ? attribute
    : storedPreference();
  if (attribute !== preference) root.setAttribute(c.preferenceAttribute, preference);
  var theme = preference === 'system' ? (media && media.matches ? 'dark' : 'light') : preference;
  if (root.getAttribute(c.themeAttribute) !== theme) root.setAttribute(c.themeAttribute, theme);
  if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
  if (themeColor.content !== c.colors[theme]) themeColor.content = c.colors[theme];
  if (document.head.querySelector('meta[name="theme-color"]') !== themeColor) {
    document.head.insertBefore(themeColor, document.head.firstChild);
  }
}
apply();
if (media) media.addEventListener('change', apply);
window.addEventListener('storage', function (event) {
  if (event.key === c.storageKey || event.key === null) {
    root.setAttribute(c.preferenceAttribute, storedPreference());
  }
});
new MutationObserver(apply).observe(root, {
  attributes: true,
  attributeFilter: [c.themeAttribute, c.preferenceAttribute]
});
new MutationObserver(apply).observe(document.head, { childList: true });
`;

export const THEME_INIT_SCRIPT = `(function (c) {${THEME_INIT_BODY}})(${JSON.stringify(
  THEME_SCRIPT_CONFIG,
)});`;
