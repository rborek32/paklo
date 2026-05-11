import { describe, expect, it } from 'vitest';

import type { DependabotDependency, DependabotExistingGroupPr } from './job';
import { extractPullRequestMetadata, getDependencyType, getUpdateType } from './metadata';
import { getPullRequestCommitMessage } from './utils';

describe('extractPullRequestMetadata', () => {
  it('builds fetch-metadata-shaped values from persisted pull request metadata', async () => {
    const scoreCalls: string[] = [];
    const parsed: DependabotExistingGroupPr = {
      'pr-number': 123,
      'dependency-group-name': 'frontend',
      'dependencies': [
        {
          'dependency-name': 'lodash',
          'previous-version': '3.10.1',
          'dependency-version': '4.17.21',
          'directory': '/web',
        },
        {
          'dependency-name': 'express',
          'previous-version': '4.17.1',
          'dependency-version': '4.18.2',
          'directory': '/api',
        },
      ],
    };

    const metadata = await extractPullRequestMetadata(
      'Bumps lodash.\n\nMaintainer changes',
      parsed,
      ['npm_and_yarn'],
      'main',
      async (dependencyName, packageEcosystem, previousVersion, newVersion) => {
        scoreCalls.push(`${dependencyName}:${packageEcosystem}:${previousVersion}:${newVersion}`);
        return dependencyName === 'lodash' ? 89 : 76;
      },
      `Bump frontend dependencies

---
updated-dependencies:
- dependency-name: lodash
  dependency-type: direct:production
  dependency-version: 4.17.21
  ghsa-id: GHSA-1111-2222-3333
  cvss: 7.5
- dependency-name: express
  dependency-type: direct:development
  dependency-version: 4.18.2
...
`,
    );

    expect(metadata).toMatchObject({
      'dependency-names': 'lodash, express',
      'dependency-type': 'direct:production',
      'update-type': 'version-update:semver-major',
      'directory': '/web',
      'package-ecosystem': 'npm',
      'target-branch': 'main',
      'previous-version': '3.10.1',
      'new-version': '4.17.21',
      'compatibility-score': 89,
      'maintainer-changes': true,
      'dependency-group': 'frontend',
      'ghsa-id': 'GHSA-1111-2222-3333',
      'cvss': 7.5,
    });
    expect(metadata['updated-dependencies-json']).toEqual([
      {
        'dependency-name': 'lodash',
        'dependency-type': 'direct:production',
        'update-type': 'version-update:semver-major',
        'directory': '/web',
        'package-ecosystem': 'npm',
        'target-branch': 'main',
        'previous-version': '3.10.1',
        'new-version': '4.17.21',
        'compatibility-score': 89,
        'maintainer-changes': true,
        'dependency-group': 'frontend',
        'ghsa-id': 'GHSA-1111-2222-3333',
        'cvss': 7.5,
      },
      {
        'dependency-name': 'express',
        'dependency-type': 'direct:development',
        'update-type': 'version-update:semver-minor',
        'directory': '/api',
        'package-ecosystem': 'npm',
        'target-branch': 'main',
        'previous-version': '4.17.1',
        'new-version': '4.18.2',
        'compatibility-score': 76,
        'maintainer-changes': true,
        'dependency-group': 'frontend',
        'ghsa-id': '',
        'cvss': 0,
      },
    ]);
    expect(scoreCalls).toEqual(['lodash:npm:3.10.1:4.17.21', 'express:npm:4.17.1:4.18.2']);
  });

  it('maps stored package managers back to Dependabot config ecosystem names', async () => {
    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependencies': [{ 'dependency-name': 'golang.org/x/text', 'dependency-version': '0.31.0' }],
      },
      ['go_modules'],
      '',
      async () => 0,
    );

    expect(metadata['package-ecosystem']).toBe('gomod');
  });

  it('returns null update type when versions are missing or not semver-like', async () => {
    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependencies': [
          {
            'dependency-name': 'ubuntu',
            'previous-version': 'jammy',
            'dependency-version': 'noble',
          },
        ],
      },
      ['docker'],
      '',
      async () => 0,
    );

    expect(metadata['update-type']).toBeNull();
    expect(metadata['updated-dependencies-json'][0]!['update-type']).toBeNull();
  });

  it('returns unknown dependency type when commit metadata is missing', async () => {
    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependencies': [{ 'dependency-name': 'lodash', 'dependency-version': '4.17.21' }],
      },
      ['npm_and_yarn'],
      '',
      async () => 0,
    );

    expect(metadata['dependency-type']).toBe('unknown');
    expect(metadata['updated-dependencies-json'][0]!['dependency-type']).toBe('unknown');
  });

  it('prefers commit metadata and falls back to persisted pull request values', async () => {
    const scoreCalls: string[] = [];
    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependency-group-name': 'persisted-group',
        'dependencies': [
          {
            'dependency-name': 'lodash',
            'previous-version': '4.17.20',
            'dependency-version': '4.17.20',
            'directory': '/web',
          },
          {
            'dependency-name': 'express',
            'previous-version': '4.17.1',
            'dependency-version': '4.18.2',
            'directory': '/api',
          },
        ],
      },
      ['npm_and_yarn'],
      'main',
      async (dependencyName, packageEcosystem, previousVersion, newVersion) => {
        scoreCalls.push(`${dependencyName}:${packageEcosystem}:${previousVersion}:${newVersion}`);
        return 0;
      },
      `Bump frontend dependencies

---
updated-dependencies:
- dependency-name: lodash
  dependency-version: 4.17.21
  dependency-type: direct:production
  update-type: version-update:semver-patch
  dependency-group: footer-group
...
`,
    );

    expect(metadata['dependency-group']).toBe('footer-group');
    expect(metadata['new-version']).toBe('4.17.21');
    expect(metadata['update-type']).toBe('version-update:semver-minor');
    expect(metadata['updated-dependencies-json']).toMatchObject([
      {
        'dependency-name': 'lodash',
        'dependency-type': 'direct:production',
        'update-type': 'version-update:semver-patch',
        'dependency-group': 'footer-group',
        'previous-version': '4.17.20',
        'new-version': '4.17.21',
        'directory': '/web',
      },
      {
        'dependency-name': 'express',
        'dependency-type': 'unknown',
        'update-type': 'version-update:semver-minor',
        'dependency-group': 'persisted-group',
        'previous-version': '4.17.1',
        'new-version': '4.18.2',
        'directory': '/api',
      },
    ]);
    expect(scoreCalls).toEqual(['lodash:npm:4.17.20:4.17.21', 'express:npm:4.17.1:4.18.2']);
  });

  it('extracts commit metadata from a GitHub-style commit body', async () => {
    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependencies': [
          {
            'dependency-name': 'oxfmt',
            'previous-version': '0.47.0',
            'dependency-version': '0.47.0',
          },
          {
            'dependency-name': 'oxlint',
            'previous-version': '1.62.0',
            'dependency-version': '1.62.0',
          },
        ],
      },
      ['npm_and_yarn'],
      'main',
      async () => 0,
      `Bumps the oxc group with 2 updates: [oxfmt](https://github.com/oxc-project/oxc/tree/HEAD/npm/oxfmt) and [oxlint](https://github.com/oxc-project/oxc/tree/HEAD/npm/oxlint).


Updates \`oxfmt\` from 0.47.0 to 0.48.0
- [Release notes](https://github.com/oxc-project/oxc/releases)
- [Changelog](https://github.com/oxc-project/oxc/blob/main/npm/oxfmt/CHANGELOG.md)
- [Commits](https://github.com/oxc-project/oxc/commits/oxfmt_v0.48.0/npm/oxfmt)

Updates \`oxlint\` from 1.62.0 to 1.63.0
- [Release notes](https://github.com/oxc-project/oxc/releases)
- [Changelog](https://github.com/oxc-project/oxc/blob/main/npm/oxlint/CHANGELOG.md)
- [Commits](https://github.com/oxc-project/oxc/commits/oxlint_v1.63.0/npm/oxlint)

---
updated-dependencies:
- dependency-name: oxfmt
  dependency-version: 0.48.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: oxc
- dependency-name: oxlint
  dependency-version: 1.63.0
  dependency-type: direct:development
  update-type: version-update:semver-minor
  dependency-group: oxc
...

Signed-off-by: dependabot[bot] <support@github.com>
Co-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>
`,
    );

    expect(metadata).toMatchObject({
      'dependency-names': 'oxfmt, oxlint',
      'dependency-type': 'direct:development',
      'update-type': 'version-update:semver-minor',
      'dependency-group': 'oxc',
      'new-version': '0.48.0',
    });
    expect(metadata['updated-dependencies-json']).toMatchObject([
      {
        'dependency-name': 'oxfmt',
        'dependency-type': 'direct:development',
        'update-type': 'version-update:semver-minor',
        'dependency-group': 'oxc',
        'previous-version': '0.47.0',
        'new-version': '0.48.0',
      },
      {
        'dependency-name': 'oxlint',
        'dependency-type': 'direct:development',
        'update-type': 'version-update:semver-minor',
        'dependency-group': 'oxc',
        'previous-version': '1.62.0',
        'new-version': '1.63.0',
      },
    ]);
  });

  it('extracts commit metadata generated by Paklo', async () => {
    const dependencies: DependabotDependency[] = [
      {
        'name': 'turbo',
        'previous-version': '2.9.8',
        'version': '2.9.9',
        'requirements': [{ file: 'package.json', groups: ['devDependencies'], requirement: '^2.9.9' }],
        'directory': '/web',
      },
      {
        'name': 'hono',
        'previous-version': '4.12.16',
        'version': '4.12.17',
        'requirements': [{ file: 'package.json', groups: ['dependencies'], requirement: '^4.12.17' }],
        'directory': '/api',
      },
    ];
    const commitMessage = getPullRequestCommitMessage({
      message: 'Bump dependencies',
      dependencies,
      dependencyGroupName: 'all-npm-minor-updates',
      securityVulnerabilities: [
        {
          package: { name: 'hono', version: '4.12.16' },
          vulnerableVersionRange: '< 4.12.17',
          advisory: {
            identifiers: [{ type: 'GHSA', value: 'GHSA-1111-2222-3333' }],
            cvss: { score: 7.5 },
          },
        },
      ],
    });

    const metadata = await extractPullRequestMetadata(
      null,
      {
        'pr-number': 123,
        'dependency-group-name': 'persisted-group',
        'dependencies': [
          {
            'dependency-name': 'turbo',
            'previous-version': '2.9.8',
            'dependency-version': '2.9.8',
            'directory': '/web',
          },
          {
            'dependency-name': 'hono',
            'previous-version': '4.12.16',
            'dependency-version': '4.12.16',
            'directory': '/api',
          },
        ],
      },
      ['npm_and_yarn'],
      'main',
      async () => 0,
      commitMessage,
    );

    expect(metadata).toMatchObject({
      'dependency-names': 'turbo, hono',
      'dependency-type': 'direct:production',
      'update-type': 'version-update:semver-patch',
      'dependency-group': 'all-npm-minor-updates',
      'new-version': '2.9.9',
    });
    expect(metadata['updated-dependencies-json']).toMatchObject([
      {
        'dependency-name': 'turbo',
        'dependency-type': 'direct:development',
        'update-type': 'version-update:semver-patch',
        'dependency-group': 'all-npm-minor-updates',
        'previous-version': '2.9.8',
        'new-version': '2.9.9',
        'ghsa-id': '',
        'cvss': 0,
      },
      {
        'dependency-name': 'hono',
        'dependency-type': 'direct:production',
        'update-type': 'version-update:semver-patch',
        'dependency-group': 'all-npm-minor-updates',
        'previous-version': '4.12.16',
        'new-version': '4.12.17',
        'ghsa-id': 'GHSA-1111-2222-3333',
        'cvss': 7.5,
      },
    ]);
  });
});

describe('getDependencyType', () => {
  it('returns direct:development for development requirement groups', () => {
    expect(
      getDependencyType({
        name: 'turbo',
        requirements: [{ file: 'package.json', groups: ['devDependencies'], requirement: '^2.9.9' }],
      }),
    ).toBe('direct:development');
  });

  it('returns direct:production for direct non-development requirement groups', () => {
    expect(
      getDependencyType({
        name: 'hono',
        requirements: [{ file: 'package.json', groups: ['dependencies'], requirement: '^4.12.17' }],
      }),
    ).toBe('direct:production');
  });

  it('returns indirect when there are no requirements', () => {
    expect(
      getDependencyType({
        name: 'transitive-only',
        requirements: [],
      }),
    ).toBe('indirect');
  });

  it('falls back to previous requirements', () => {
    expect(
      getDependencyType({
        'name': 'vitest',
        'previous-requirements': [{ file: 'package.json', groups: ['dev-dependencies'], requirement: '^4.1.5' }],
      }),
    ).toBe('direct:development');
  });
});

describe('getUpdateType', () => {
  it('returns semver-major, semver-minor, and semver-patch update types', () => {
    expect(getUpdateType('1.2.3', '2.0.0')).toBe('version-update:semver-major');
    expect(getUpdateType('1.2.3', '1.3.0')).toBe('version-update:semver-minor');
    expect(getUpdateType('1.2.3', '1.2.4')).toBe('version-update:semver-patch');
  });

  it('returns null for equal, missing, or non-semver-like versions', () => {
    expect(getUpdateType('1.2.3', '1.2.3')).toBeNull();
    expect(getUpdateType(undefined, '1.2.3')).toBeNull();
    expect(getUpdateType('jammy', 'noble')).toBeNull();
  });
});
