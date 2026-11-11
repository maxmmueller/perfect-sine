# Perfect Sine

A freehand sine drawing game built with TypeScript, Canvas and Vite.

## Notebook frontend preview

The `feature/notebook-frontend` branch updates the presentation with warm graph
paper, blue ink and locally hosted Kalam handwriting. Game rules, scoring,
controls and UI copy are unchanged. The summary and exported share card use the
same visual style. The font license is in `public/fonts/OFL.txt`.

Run `npm install`, then `npm run dev:prod` to preview the game at
`http://localhost:3001` without the development tools. Use `npm run dev` for the
existing development tools.

Validation: `npm run test:coverage` and `npm run build`. Browser checks cover
1440px, 390px and 320px viewports, drawing, evaluation and summary controls.
