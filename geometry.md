# Visual geometry

Captured against the local production server at 1280×800 and 390×844. Rectangles are `x, y, width × height` CSS pixels from `getBoundingClientRect()` after each page reached `networkidle`. `overflow` means `document.documentElement.scrollWidth <= window.innerWidth` (all captures were `true`, so no horizontal overflow was observed).

| Screen | Viewport | `.site-nav` | `.page-header h1` | `.page-header` | `.page-shell` | No horizontal overflow |
| --- | ---: | --- | --- | --- | --- | --- |
| overview | 1280×800 | 938,16.5,166×40 | 176,105.70,732×28.59 | 176,98,928×44 | 176,98,928×600.17 | yes |
| transactions | 1280×800 | 938,16.5,166×40 | 176,105.70,732×28.59 | 176,98,928×44 | 176,98,928×684.02 | yes |
| balances (data) | 1280×800 | 938,16.5,166×40 | 176,105.70,928×28.59 | 176,98,928×44 | 176,98,928×401.78 | yes |
| balances (empty) | 1280×800 | 938,16.5,166×40 | 176,105.70,928×28.59 | 176,98,928×44 | 176,98,928×343.17 | yes |
| overview | 390×844 | 222,16.5,148×40 | 20,105.70,154×28.59 | 20,98,350×44 | 20,98,350×668.97 | yes |
| transactions | 390×844 | 222,16.5,148×40 | 20,105.70,154×28.59 | 20,98,350×44 | 20,98,350×806.23 | yes |
| balances (data) | 390×844 | 222,16.5,148×40 | 20,105.70,350×28.59 | 20,98,350×44 | 20,98,350×451.56 | yes |
| balances (empty) | 390×844 | 222,16.5,148×40 | 20,105.70,350×28.59 | 20,98,350×44 | 20,98,350×392.77 | yes |

The raw measurements and the font proof (`document.fonts.check('16px "Noto Sans CJK JP"', '残高') === true`) are in `visual-geometry.json` beside this file.
