# Balances redesign browser verification

- Build: production `pnpm build` from `feat/balances-page`.
- Browser: Chromium from `mcr.microsoft.com/playwright:v1.63.0-noble`, headless, `deviceScaleFactor=1`.
- Viewports: desktop `1280×800`; mobile `390×844`; screenshots use `fullPage: true`.
- Database: fictional seed data and a separate empty database in the dedicated throwaway PostgreSQL container `kobako-balances-capturedb` (removed after capture).
- Coordinates are CSS pixels from `getBoundingClientRect()`.

## Shared geometry

| Capture | Viewport | `.site-nav` (x, y, w, h) | `.page-header h1` (x, y, w, h) | `.page-header` (x, y, w, h) | `.page-shell` (x, y, w, h) | Horizontal overflow |
| --- | --- | --- | --- | --- | --- | --- |
| `overview-desktop.png` | 1280×800 | 938, 16.5, 166, 40 | 176, 105.70, 732, 28.59 | 176, 98, 928, 44 | 176, 98, 928, 657.02 | none (`1280 ≤ 1280`) |
| `overview-mobile.png` | 390×844 | 222, 16.5, 148, 40 | 20, 105.70, 154, 28.59 | 20, 98, 350, 44 | 20, 98, 350, 725.81 | none (`390 ≤ 390`) |
| `transactions-desktop.png` | 1280×800 | 938, 16.5, 166, 40 | 176, 105.70, 732, 28.59 | 176, 98, 928, 44 | 176, 98, 928, 1718.14 | none (`1280 ≤ 1280`) |
| `transactions-mobile.png` | 390×844 | 222, 16.5, 148, 40 | 20, 105.70, 154, 28.59 | 20, 98, 350, 44 | 20, 98, 350, 1718.14 | none (`390 ≤ 390`) |
| `balances-data-desktop.png` | 1280×800 | 938, 16.5, 166, 40 | 176, 105.70, 928, 28.59 | 176, 98, 928, 44 | 176, 98, 928, 523.42 | none (`1280 ≤ 1280`) |
| `balances-data-mobile.png` | 390×844 | 222, 16.5, 148, 40 | 20, 105.70, 350, 28.59 | 20, 98, 350, 44 | 20, 98, 350, 687.88 | none (`390 ≤ 390`) |
| `balances-empty-desktop.png` | 1280×800 | 938, 16.5, 166, 40 | 176, 105.70, 928, 28.59 | 176, 98, 928, 44 | 176, 98, 928, 482.41 | none (`1280 ≤ 1280`) |
| `balances-empty-mobile.png` | 390×844 | 222, 16.5, 148, 40 | 20, 105.70, 350, 28.59 | 20, 98, 350, 44 | 20, 98, 350, 572.89 | none (`390 ≤ 390`) |

## Balance-specific checks

| Capture | Account amount right edges | Summary value right-edge offsets within each cell | Read-only row interaction |
| --- | --- | --- | --- |
| `balances-data-desktop.png` | 6 rows, all `x=1104`, range `0px` | `[0, 0, 0]px` | every row `cursor:auto`; no computed color/background/box-shadow change on hover |
| `balances-data-mobile.png` | 6 rows, all `x=370`, range `0px` | `[0, 0, 0]px` | every row `cursor:auto`; no computed color/background/box-shadow change on hover |
| `balances-empty-desktop.png` | no account rows | `[0, 0, 0]px` | no account rows |
| `balances-empty-mobile.png` | no account rows | `[0, 0, 0]px` | no account rows |

The large `12,345,678,901円` account balance and long Japanese account name remain readable in the mobile capture; summary values stay on one line after the mobile summary column adjustment. No horizontal overflow was observed in any capture.
