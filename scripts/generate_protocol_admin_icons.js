const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..', 'protocol-admin');

function svg(size) {
  const inset = Math.round(size * 0.08);
  const fontSize = Math.round(size * 0.25);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="#20231f"/>
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" fill="#285649"/>
      <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
        fill="#ffffff" font-family="Georgia,serif" font-size="${fontSize}" font-weight="700">PL</text>
      <rect x="${inset}" y="${size - inset * 1.55}" width="${size - inset * 2}" height="${Math.max(3, Math.round(size * 0.018))}" fill="#b98532"/>
    </svg>`);
}

async function run() {
  for (const size of [192, 512]) {
    await sharp(svg(size)).png().toFile(path.join(root, `icon-${size}.png`));
  }
  console.log('Protocol Admin PWA icons generated.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
