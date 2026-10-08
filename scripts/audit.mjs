import fs from 'fs';
import path from 'path';

// Audit script for GymPulse
// Checks for common issues and validates project setup

const PROJECT_ROOT = process.cwd();

function checkFileExists(filePath) {
  return fs.existsSync(filePath);
}

function logResult(label, passed) {
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${label}`);
}

// Check essential files
logResult('package.json exists', checkFileExists(path.join(PROJECT_ROOT, 'package.json')));
logResult('next.config.ts exists', checkFileExists(path.join(PROJECT_ROOT, 'next.config.ts')));
logResult('tsconfig.json exists', checkFileExists(path.join(PROJECT_ROOT, 'tsconfig.json')));
logResult('.env exists', checkFileExists(path.join(PROJECT_ROOT, '.env')));
logResult('src/app exists', checkFileExists(path.join(PROJECT_ROOT, 'src/app')));
logResult('prisma/schema.prisma exists', checkFileExists(path.join(PROJECT_ROOT, 'prisma/schema.prisma')));
logResult('README.md exists', checkFileExists(path.join(PROJECT_ROOT, 'README.md')));

// Check for common issues
const packageJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const hasNext = packageJson.dependencies.next ? true : false;
logResult('Next.js dependency present', hasNext);

const hasPrisma = packageJson.dependencies.prisma ? true : false;
logResult('Prisma dependency present', hasPrisma);

console.log('\nAudit complete.');