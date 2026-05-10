import { describe, expect, it } from 'vitest';

import type { DependabotExistingGroupPr } from './job';
import { extractPullRequestMetadata, getDependencyType, getUpdateType } from './metadata';

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
