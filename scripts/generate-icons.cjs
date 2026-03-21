#!/usr/bin/env node
// Generate PNG icons from SVG for app stores and PWA
// Run: node scripts/generate-icons.js
// Requires: none (uses built-in canvas via data URL approach)

const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#818cf8"/>
  <text x="50" y="68" text-anchor="middle" font-size="52" font-weight="bold" fill="white" font-family="system-ui, -apple-system, sans-serif">W</text>
</svg>`;

const sizes = [72, 96, 128, 144, 152, 180, 192, 384, 512, 1024];
const outDir = path.join(__dirname, '..', 'public', 'icons');

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Write SVG files at each size (browsers and tools can render these)
sizes.forEach(size => {
  const svg = SVG.replace('viewBox="0 0 100 100"', `viewBox="0 0 100 100" width="${size}" height="${size}"`);
  fs.writeFileSync(path.join(outDir, `icon-${size}.svg`), svg);
  console.log(`Created icon-${size}.svg`);
});

// Write the base SVG as favicon
fs.writeFileSync(path.join(outDir, 'favicon.svg'), SVG);

// Write apple-touch-icon (180px)
const appleSvg = SVG.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" width="180" height="180"');
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.svg'), appleSvg);

console.log('\\nDone! For PNG conversion (required for App Store):');
console.log('  brew install librsvg');
console.log('  for f in public/icons/icon-*.svg; do rsvg-convert -w $(echo $f | grep -o "[0-9]*") $f > ${f%.svg}.png; done');
console.log('\\nOr use https://svgtopng.com for manual conversion.');
