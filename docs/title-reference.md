# Title reference

The GRAIN wordmark in `src/grain-wordmark.svg` is traced from the alphabet image supplied by the user. It is a vector reproduction of that chosen lettering, not a new typeface or a derivative of the earlier font studies. The body font remains IBM Plex Mono.

Reference: `1-Pasted-Image-1.jpg`, 1200 × 800 pixels.

SHA-256: `90f6f0aded8d3050d4031dbbcc9d3c45c8e4250739cf47712d256d95bf1ea8eb`.

## Glyph extraction

Coordinates are pixel crop bounds `(left, top, right, bottom)` in the supplied image. The user's alphabet ordering determines each letter.

| Letter | Source position | Crop bounds             |
| ------ | --------------- | ----------------------- |
| G      | Row 1, column 7 | `(964, 145, 1115, 255)` |
| R      | Row 3, column 5 | `(750, 392, 896, 501)`  |
| A      | Row 1, column 1 | `(88, 146, 238, 254)`   |
| I      | Row 2, column 2 | `(308, 268, 392, 378)`  |
| N      | Row 3, column 1 | `(160, 393, 310, 501)`  |

The light foreground was isolated at RGB minimum > 170, then traced with Potrace 1.16, curve tolerance 0.1 and coordinate precision 0.01 source pixels. G and I use smooth curve fitting (`alphamax 1.334`) to retain the rounded corners and shoulders visible in the reference; the remaining glyphs use the default corner threshold. Glyph proportions are preserved, aligned to a common baseline and separated by 16 source pixels. The viewBox is 662 × 100.

The only intentional letter-design change is the small rounded inward spur at the G's mouth. Its outer contour and sloping counter remain intact. R, A, I and N retain their traced silhouettes.

The SVG uses `currentColor`, five Bézier paths and native SVG effects. It contains no bitmap, embedded font or remote resource. The existing animation classes are retained. Displacement is limited to 0.7 source pixels per axis, less than one display pixel at the intended header sizes. A 0.6-source-pixel vertical drift keeps the motion visible without changing letter shapes. Reduced motion renders the undisplaced, stationary paths.
