import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrandSvg } from '../src/view/BrandView';

const directory = new URL('../public/brand/', import.meta.url);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL('perfect-sine-dark.svg', directory), createBrandSvg('full', '#a4c4ef'));
writeFileSync(new URL('sine-mark.svg', directory), createBrandSvg('mark'));
