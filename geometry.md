# After geometry evidence

Feature screenshots were captured from `http://127.0.0.1:3100` against `kobako_shots_after` with the standalone server's static assets copied into the standalone tree. Bounds come from the `*-bounds.json` files beside each after screenshot.

Coordinates are CSS pixels and use `{x, y, w, h}`. `register` is the page-header `取引を登録` link and `month` is `nav.month-switcher`.

## Shared overview/transactions chrome

| viewport | page | h1 | register | month |
| --- | --- | --- | --- | --- |
| 360x780 | overview | `{20, 106, 124, 29}` | `{244, 98, 96, 44}` | `{20, 158, 180, 44}` |
| 360x780 | transactions | `{20, 106, 124, 29}` | `{244, 98, 96, 44}` | `{20, 158, 180, 44}` |
| 390x844 | overview | `{20, 106, 154, 29}` | `{274, 98, 96, 44}` | `{20, 158, 180, 44}` |
| 390x844 | transactions | `{20, 106, 154, 29}` | `{274, 98, 96, 44}` | `{20, 158, 180, 44}` |
| 1280x900 | overview | `{176, 106, 732, 29}` | `{1008, 98, 96, 44}` | `{176, 158, 180, 44}` |
| 1280x900 | transactions | `{176, 106, 732, 29}` | `{1008, 98, 96, 44}` | `{176, 158, 180, 44}` |

## Transactions minus overview deltas

| viewport | h1 Δ `{x, y, w, h}` | register Δ `{x, y, w, h}` | month Δ `{x, y, w, h}` |
| --- | --- | --- | --- |
| 360x780 | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` |
| 390x844 | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` |
| 1280x900 | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` | `{0, 0, 0, 0}` |

## Horizontal overflow

All 27 after captures (9 pages × 3 viewports) reported `document.documentElement.scrollWidth` equal to the viewport width:

- 360px viewport: `scrollWidth = 360`
- 390px viewport: `scrollWidth = 390`
- 1280px viewport: `scrollWidth = 1280`

No mismatches were found.
