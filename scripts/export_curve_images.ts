import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CurveImageExporter } from '../src/view/CurveImageExporter.ts';
import { RecordedCurve } from '../src/model/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const curvesPath = path.resolve(rootDir, 'recorded_curves', 'example_curves.json');
const outputDir = path.resolve(rootDir, 'recorded_curves', 'images');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

if (!fs.existsSync(curvesPath)) {
  console.log(`[export-curves] Creating initial sample dataset at: ${curvesPath}`);
  // If file doesn't exist yet, we will generate initial samples
}

try {
  const content = fs.readFileSync(curvesPath, 'utf-8');
  const data = JSON.parse(content);
  const curves: RecordedCurve[] = Array.isArray(data) ? data : data.curves || [];

  console.log(`[export-curves] Found ${curves.length} curves in ${curvesPath}`);

  for (const curve of curves) {
    const filename = `${curve.id || curve.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.svg`;
    const outputPath = path.join(outputDir, filename);

    const svg = CurveImageExporter.renderToSvg(curve, {
      width: 900,
      height: 560,
      includeHud: true,
      includeGrid: true,
      includeReference: true,
    });

    fs.writeFileSync(outputPath, svg, 'utf-8');
    console.log(`  ✓ Generated image: ${outputPath}`);
  }

  console.log(`[export-curves] Successfully exported ${curves.length} example images to: ${outputDir}`);
} catch (err) {
  console.error('[export-curves] Error:', err);
  process.exit(1);
}
