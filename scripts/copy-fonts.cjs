const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'assets', 'fonts');
const destDir = path.join(__dirname, '..', 'dist', 'assets', 'fonts');

try {
  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    const files = fs.readdirSync(srcDir);
    let count = 0;
    for (const f of files) {
      if (f.endsWith('.ttf') || f.endsWith('.otf')) {
        fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
        count++;
      }
    }
    console.log(`[postbuild] Successfully copied ${count} fonts to dist/assets/fonts`);
  } else {
    console.log('[postbuild] Notice: src/assets/fonts not found, skipping font copy.');
  }
} catch (err) {
  console.warn('[postbuild] Warning copying fonts:', err.message);
}
