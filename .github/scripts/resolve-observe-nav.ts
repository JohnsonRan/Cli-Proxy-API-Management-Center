// Narrow resolver for the one known conflict of the patch/fingerprint-detector squash merge:
// patch/usage-store and patch/fingerprint-detector both add an observe nav entry right before
// /logs, so git cannot order the two insertions. Keep usage first, then fingerprint, so /logs
// stays last. Anything else (another file, another hunk, a changed entry) fails the sync.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'src/components/layout/MainLayout.tsx';
const ours = [
  "          path: '/usage',",
  "          labelKey: 'usage_stats.nav',",
  "          metaKey: 'usage_stats.nav_meta',",
  '          icon: sidebarIcons.usage,',
];
const theirs = [
  "          path: '/fingerprint',",
  "          labelKey: 'nav.fingerprint',",
  "          metaKey: 'nav_meta.fingerprint',",
  '          icon: sidebarIcons.fingerprint,',
];

const fail = (message: string): never => {
  console.error(`::error::fingerprint nav resolver: ${message}`);
  process.exit(1);
};

const conflicted = execFileSync('git', ['diff', '--name-only', '--diff-filter=U'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);
if (conflicted.length !== 1 || conflicted[0] !== FILE) {
  fail(`unexpected conflicted files: ${conflicted.join(' ') || '(none)'}`);
}

const lines = readFileSync(FILE, 'utf8').split('\n');
const starts = lines.flatMap((line, i) => (line.startsWith('<<<<<<< ') ? [i] : []));
if (starts.length !== 1) fail(`expected one conflict block, found ${starts.length}`);
const start = starts[0];
const block = lines.slice(start, start + ours.length + theirs.length + 3);
const expected = ['<<<<<<< ', ...ours, '=======', ...theirs, '>>>>>>> '];
const matches = block.every((line, i) =>
  i === 0 || i === block.length - 1 ? line.startsWith(expected[i]) : line === expected[i]
);
if (block.length !== expected.length || !matches) fail('conflict block has an unknown shape');

lines.splice(start, block.length, ...ours, '        },', '        {', ...theirs);
const text = lines.join('\n');
if (/^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(text)) fail('conflict markers remain');
writeFileSync(FILE, text);
execFileSync('git', ['add', FILE]);
console.log(`resolved ${FILE}: /usage, /fingerprint, then /logs`);
