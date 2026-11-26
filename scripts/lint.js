import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const BINARY_EXT_RE = /\.(png|jpg|jpeg|gif|ico|webp|zip|pdf|woff2?|ttf|eot)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.entire', '.agents', '.gemini', 'scratch']);

function collectFallbackFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFallbackFiles(fullPath, results);
    } else if (entry.isFile()) {
      results.push(path.relative(process.cwd(), fullPath).replace(/\\/g, '/'));
    }
  }
  return results;
}

function getTargetFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(file => {
        try {
          return fs.existsSync(file) && fs.statSync(file).isFile();
        } catch {
          return false;
        }
      });
  } catch {
    return collectFallbackFiles(process.cwd());
  }
}

function main() {
  const files = getTargetFiles();
  let jsCount = 0;
  let textCount = 0;
  let errorCount = 0;

  for (const file of files) {
    if (file.endsWith('.js')) {
      jsCount++;
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch (err) {
        errorCount++;
        const stderr = err?.stderr ? String(err.stderr).trim() : err?.message;
        console.error(`[SYNTAX ERROR] ${file}\n${stderr}`);
      }
    }

    if (!BINARY_EXT_RE.test(file)) {
      textCount++;
      const content = fs.readFileSync(file, 'utf8');
      const crlfCount = (content.match(/\r\n/g) || []).length;
      const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
      if (crlfCount > 0 && lfCount > 0) {
        errorCount++;
        console.error(`[MIXED EOL] ${file} (CRLF: ${crlfCount}, LF: ${lfCount})`);
      }
    }
  }

  if (errorCount > 0) {
    console.error(`Lint failed with ${errorCount} issue(s).`);
    process.exit(1);
  }

  console.log(`Lint passed: ${jsCount} JS files syntax-checked, ${textCount} text files EOL-checked.`);
}

main();
