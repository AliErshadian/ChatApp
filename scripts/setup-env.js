const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const copies = [
  ['.env.example', '.env'],
  ['backend/.env.example', 'backend/.env'],
  ['desktop/.env.example', 'desktop/.env'],
  ['admin/.env.example', 'admin/.env'],
];

for (const [fromRel, toRel] of copies) {
  const from = path.join(root, fromRel);
  const to = path.join(root, toRel);
  if (!fs.existsSync(from)) {
    console.warn(`skip: missing ${fromRel}`);
    continue;
  }
  if (fs.existsSync(to)) {
    console.log(`keep: ${toRel} (already exists)`);
    continue;
  }
  fs.copyFileSync(from, to);
  console.log(`created: ${toRel}`);
}
