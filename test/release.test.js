import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const BEFORE = `# Changelog

Describe each change under \`## [Unreleased]\`.

## [Unreleased]

### Added

- EnOcean support.

[Unreleased]: https://github.com/prohand/gladys-enocean/commits/main
`;

test('the Unreleased section moves under the released version', () => {
  const after = rollChangelog(BEFORE, '1.0.0', '2026-11-20');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-11-20\n\n### Added\n\n- EnOcean support\./,
  );
  assert.match(
    after,
    /\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-enocean\/compare\/v1\.0\.0\.\.\.HEAD/,
  );
  assert.match(
    after,
    /\[1\.0\.0\]: https:\/\/github\.com\/prohand\/gladys-enocean\/releases\/tag\/v1\.0\.0/,
  );
});

test('a release with nothing to move still gets its heading', () => {
  const once = rollChangelog(BEFORE, '1.0.0', '2026-11-20');
  const twice = rollChangelog(once, '1.0.1', '2026-11-21');
  assert.match(
    twice,
    /## \[1\.0\.1\] - 2026-11-21\n\n- Maintenance release, no functional change\./,
  );
  assert.match(
    twice,
    /\[1\.0\.1\]: https:\/\/github\.com\/prohand\/gladys-enocean\/compare\/v1\.0\.0\.\.\.v1\.0\.1/,
  );
});

test('rolling the same version twice changes nothing', () => {
  const once = rollChangelog(BEFORE, '1.0.0', '2026-11-20');
  assert.equal(rollChangelog(once, '1.0.0', '2026-11-20'), once);
});
