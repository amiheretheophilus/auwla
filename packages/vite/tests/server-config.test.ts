import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { resolveAdapterOptions } from '../src/options';
import {
  isServerConfigFile,
  serverConfigDeclarationFile,
  writeServerConfigDeclaration,
} from '../src/server-config';

let fixture: string | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await rm(fixture, { recursive: true, force: true });
    fixture = undefined;
  }
});

describe('server config type registration', () => {
  it('writes one package augmentation for the conventional server contract', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-server-config-'));
    const configDirectory = resolve(fixture, 'src/server');
    const configFile = resolve(configDirectory, 'define.ts');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(configFile, `
      import { createDefine } from '@memoized-dom/server';
      export const define = createDefine<
        { requestId: string },
        { region: string }
      >();
    `);
    const options = resolveAdapterOptions({
      clientEntry: 'src/main.ts',
      server: 'src/server',
    });

    await expect(writeServerConfigDeclaration(fixture, options))
      .resolves.toBe(configFile.replaceAll('\\', '/'));
    const declaration = await readFile(
      serverConfigDeclarationFile(fixture),
      'utf8',
    );
    expect(declaration).toContain(
      'define as __MemoizedDomDefinition',
    );
    expect(declaration).toContain(
      "declare module '@memoized-dom/server/router'",
    );
    expect(declaration).toContain(
      'application: __MemoizedDomServerTypes',
    );
    expect(declaration).toContain(
      "declare module '@memoized-dom/router'",
    );
    expect(declaration).toContain('interface RoutedTypeRegistry');
    expect(isServerConfigFile(fixture, configFile, options)).toBe(true);
  });

  it('registers the resolved type of every discovered service', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-server-config-'));
    const server = resolve(fixture, 'server');
    const definition = resolve(server, 'define.ts');
    const services = resolve(server, 'services.ts');
    await mkdir(server, { recursive: true });
    await Promise.all([
      writeFile(definition, `export const define = createDefine();`),
      writeFile(services, `export const database = define.service('database', () => ({ ready: true }));`),
    ]);
    const options = resolveAdapterOptions({ clientEntry: 'main.ts' });
    await writeServerConfigDeclaration(fixture, options, [{
      file: services.replaceAll('\\', '/'),
      exported: 'database',
      name: 'database',
    }]);
    const declaration = await readFile(serverConfigDeclarationFile(fixture), 'utf8');
    expect(declaration).toContain('database as __MemoizedDomService0');
    expect(declaration).toContain(
      '"database": import(\'@memoized-dom/server\').ServiceValue<typeof __MemoizedDomService0>;',
    );
  });

  it('removes a stale registration when the config entry is removed', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-server-config-'));
    const configDirectory = resolve(fixture, 'server');
    const configFile = resolve(configDirectory, 'define.ts');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(configFile, `
      import { createDefine } from '@memoized-dom/server';
      export const define = createDefine();
    `);
    const options = resolveAdapterOptions({ clientEntry: 'main.ts' });
    await writeServerConfigDeclaration(fixture, options);
    await rm(configFile);

    await expect(writeServerConfigDeclaration(fixture, options))
      .resolves.toBeNull();
    await expect(readFile(serverConfigDeclarationFile(fixture), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
