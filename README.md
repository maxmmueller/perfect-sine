# Perfect Sine

A freehand sine drawing game built with TypeScript, Canvas and Vite.

## Notebook frontend preview

The frontend uses dark graph paper and pale blue ink. Dark mode is fixed; there
is no theme switch or system-theme dependency. Handwriting is reserved
for the outlined logo. All interface text, scores and numerical metrics use a
readable native sans-serif, without waiting for a web font to load. Drawing and
scoring rules are unchanged. The sharing dialog and exported card use the same
visual style and contain only the current drawing and its result. The font license is in `public/fonts/OFL.txt`.

Run `npm install`, then `npm run dev:prod` to preview the game at
`http://localhost:3001` without the development tools. Use `npm run dev` for the
existing development tools.

Validation: `npm run test:coverage` and `npm run build`. Browser checks cover
1440px, 390px and 320px viewports, drawing, evaluation and summary controls.

## Brand assets

The full logo combines outlined Perfect Sine lettering with a tilted gradient
wave. Use the wave-only mark for small icons. Both are defined once in
[`BrandView.ts`](src/view/BrandView.ts) and
[`brandGeometry.json`](src/view/brandGeometry.json), and used by the page header,
summary and PNG exports. SVGs and browser/touch icons live in
[`public/brand`](public/brand). Run `npm run export-brand` after geometry changes
to regenerate the SVGs. The standalone SVGs need no installed font.

## Sharing

Share only the current completed drawing: the card contains that wave, its
accuracy and score. The link sits directly beside the small wave mark in the
footer. Invalid attempts retain their drawing and
validation message without an invented result. No session statistics, highscore,
example wave or demo canvas enters PNG, clipboard or native sharing.

The share button and all shortcuts stay unavailable on idle, during drawing and
after a single-point click. A finished drawing enables sharing; reset, demo mode,
a new drawing and reload disable it again until another drawing is completed.
Session history is retained internally and does not unlock or populate sharing.

## Drawing input

Only the first primary contact controls a drawing. Additional fingers cannot add
points, finish the stroke, or take over after the drawing finger is lifted.
Pointer ownership regression tests cover cancellation, capture loss, and reset.
