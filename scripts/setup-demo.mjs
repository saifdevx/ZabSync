import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(target)) {
  const existing = readFileSync(target, 'utf8');
  if (!/^AUTH_MODE\s*=\s*demo\s*$/m.test(existing)) {
    console.error(
      'Your existing .env is not a demo configuration. Nothing was changed. Keep your configuration, or rename .env yourself before choosing demo mode.',
    );
    process.exitCode = 1;
  } else {
    console.log(
      'Demo configuration already exists. Your local data and settings were kept. Run npm run dev.',
    );
  }
} else {
  writeFileSync(
    target,
    [
      '# Local practice only. Never deploy demo mode.',
      'AUTH_MODE=demo',
      'NODE_ENV=development',
      'HOST=127.0.0.1',
      'PORT=3001',
      'DATABASE_URL=file:./data/campus.db',
      'ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3001,http://localhost:3001',
      'APP_NAME=CampusDesk',
      'UNIVERSITY_URL=https://szabist-isb.edu.pk/',
      'TIMEZONE=Asia/Karachi',
      '',
    ].join('\n'),
    { mode: 0o600, flag: 'wx' },
  );
  console.log('Local demo configured. Run npm run dev, then open http://127.0.0.1:5173.');
}
