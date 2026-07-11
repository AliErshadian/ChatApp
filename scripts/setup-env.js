const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

const copies = [
  ['.env.example', '.env'],
  ['backend/.env.example', 'backend/.env'],
  ['desktop/.env.example', 'desktop/.env'],
  ['admin/.env.example', 'admin/.env'],
];

function randomSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function seedBackendSecrets(content) {
  const access = randomSecret();
  const refresh = randomSecret();

  return content
    .replace(
      /^JWT_ACCESS_SECRET=.*$/m,
      `JWT_ACCESS_SECRET=${access}`,
    )
    .replace(
      /^JWT_REFRESH_SECRET=.*$/m,
      `JWT_REFRESH_SECRET=${refresh}`,
    );
}

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

  let content = fs.readFileSync(from, 'utf8');
  if (toRel === 'backend/.env') {
    content = seedBackendSecrets(content);
  }

  fs.writeFileSync(to, content, 'utf8');
  console.log(`created: ${toRel}${toRel === 'backend/.env' ? ' (random JWT secrets)' : ''}`);
}
