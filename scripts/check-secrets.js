import fs from 'fs';
import path from 'path';

const SUSPICIOUS_PATTERNS = [
  /cookie_token(_v2)?\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
  /account_id(_v2)?\s*[:=]\s*['"]\d{5,}['"]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[a-zA-Z0-9]{36}/
];

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  let hasLeak = false;

  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'assets' || file === 'scratch') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (scanDir(fullPath)) hasLeak = true;
    } else if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.html') || file.endsWith('.ps1')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
          console.error(`[SECRET LEAK DETECTED] File: ${fullPath} matches ${pattern}`);
          hasLeak = true;
        }
      }
    }
  }
  return hasLeak;
}

const leakFound = scanDir(process.cwd());
if (leakFound) {
  console.error('Security scan failed: Sensitive tokens detected.');
  process.exit(1);
} else {
  console.log('Security check passed: No secret tokens found.');
}
