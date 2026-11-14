import fs from 'fs';
import path from 'path';

function loadEnvFile(envFilePath) {
  const env = {};
  if (!fs.existsSync(envFilePath)) return env;
  const content = fs.readFileSync(envFilePath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

const localEnv = loadEnvFile(path.join(process.cwd(), '.env'));
const dynamicPatterns = [];

if (localEnv.GA_MEASUREMENT_ID && localEnv.GA_MEASUREMENT_ID.length >= 8) {
  dynamicPatterns.push(new RegExp(localEnv.GA_MEASUREMENT_ID.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
}
if (localEnv.GA_API_SECRET && localEnv.GA_API_SECRET.length >= 8) {
  dynamicPatterns.push(new RegExp(localEnv.GA_API_SECRET.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
}

const SUSPICIOUS_PATTERNS = [
  /cookie_token(_v2)?\s*[:=]\s*['"][a-zA-Z0-9_-]{20,}['"]/i,
  /account_id(_v2)?\s*[:=]\s*['"]\d{5,}['"]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /ghp_[a-zA-Z0-9]{36}/,
  ...dynamicPatterns
];

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  let hasLeak = false;

  for (const file of files) {
    if (file === 'node_modules' || file === '.git' || file === 'assets' || file === 'scratch' || file === 'dist') continue;
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      if (scanDir(fullPath)) hasLeak = true;
    } else if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.html') || file.endsWith('.ps1') || file.endsWith('.md')) {
      if (file === '.env' || file === '.env.example') continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
          console.error(`[SECRET LEAK DETECTED] File: ${fullPath} matches suspicious pattern`);
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
