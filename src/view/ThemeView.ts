/** One fixed dark palette shared by the DOM, game canvas and all share exports. */
const colors = {
  ink: '#a4c4ef', text: '#e3e9eb', muted: '#adbcc4',
  green: '#88bf97', red: '#ed9390', amber: '#e1be7c',
  grid: 'rgba(139, 172, 193, 0.14)', axis: 'rgba(173, 188, 196, 0.5)',
  inkRgb: '164, 196, 239',
  paper: '#1c252c', surface: '#232f38', border: '#52636f', rule: '#3c4b54',
};
const notebookPalette = Object.freeze(colors);

export function getNotebookPalette(): typeof notebookPalette {
  return notebookPalette;
}
