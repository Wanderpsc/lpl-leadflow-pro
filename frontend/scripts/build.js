const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
}

fs.mkdirSync(dist, { recursive: true });

const filesToCopy = ['index.html', 'app.js', 'styles.css', 'config.js'];

for (const file of filesToCopy) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

console.log('Frontend build concluído em ./dist');
