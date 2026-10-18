import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectHostRequirements,
  collectServerHostImports,
  inspectHostRequirements,
  readHostContract,
} from '../scripts/lib/hostContract.mjs';

/**
 * Контракт модулей хоста: что бандлы системы просят у приложения.
 *
 * По этому списку приложение отказывает несовместимой сборке ещё до запуска
 * нашего кода, а сборка — роняет себя, если бандл просит модуль, которого
 * приложение не отдаёт. Ошибка здесь означает либо ложный отказ у игроков, либо
 * молча уехавшую негодную сборку.
 */

/** Контракт приложения в объёме, нужном проверкам. */
const CONTRACT = {
  contractVersion: '1.0.0',
  clientGlobals: [{ id: 'vue', global: 'Vue', since: '0.9.264' }],
  client: [
    { id: '@/core/registries', since: '0.9.264' },
    {
      id: '@/stores/oldStore',
      since: '0.9.264',
      deprecated: { since: '0.9.700', replacement: '@/stores/newStore' },
    },
    { id: '@vtt/shared', since: '0.9.264' },
  ],
  clientTypes: [],
  server: [
    { id: '@vtt/shared', since: '0.9.503' },
    { id: '@vtt/shared/wsEvents.js', since: '0.9.503' },
  ],
};

/** Клиентский бандл: два модуля реестра и `vue` глобалом. */
const CLIENT_BUNDLE =
  '(function(a,b,c){globalThis.VTTSystems.register("x",()=>{})})'
  + '(globalThis.__VTTHost["@vtt/shared"],globalThis.Vue,globalThis.__VTTHost["@/core/registries"]);';

/** Серверный бандл: ядро из корня и из подпути, плюс встроенный модуль Node. */
const SERVER_BUNDLE =
  'import{isRecord}from"@vtt/shared";import{x}from"@vtt/shared/wsEvents.js";import path from"node:path";';

describe('collectServerHostImports', () => {
  it('находит ядро и его подпути, остальное не трогает', () => {
    expect(collectServerHostImports(SERVER_BUNDLE)).toEqual([
      '@vtt/shared',
      '@vtt/shared/wsEvents.js',
    ]);
  });

  it('чужой пакет с похожим именем — не ядро', () => {
    expect(
      collectServerHostImports('import x from "@vtt/shared-extra";'),
    ).toEqual([]);
  });
});

describe('collectHostRequirements', () => {
  it('клиенту добавляет vue: он берётся глобалом, а не из реестра', () => {
    expect(collectHostRequirements(CLIENT_BUNDLE, SERVER_BUNDLE)).toEqual({
      client: ['@/core/registries', '@vtt/shared', 'vue'],
      server: ['@vtt/shared', '@vtt/shared/wsEvents.js'],
    });
  });
});

describe('inspectHostRequirements', () => {
  it('сборка в пределах контракта проходит без замечаний', () => {
    expect(
      inspectHostRequirements(
        collectHostRequirements(CLIENT_BUNDLE, SERVER_BUNDLE),
        CONTRACT,
      ),
    ).toEqual({ problems: [], warnings: [] });
  });

  it('модуль клиента вне контракта роняет сборку', () => {
    const { problems } = inspectHostRequirements(
      { client: ['@/core/registries', '@/stores/futureStore'], server: [] },
      CONTRACT,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('клиент');
    expect(problems[0]).toContain('@/stores/futureStore');
    expect(problems[0]).not.toContain('@/core/registries');
  });

  it('подпуть ядра вне контракта роняет сборку на стороне сервера', () => {
    const { problems } = inspectHostRequirements(
      { client: [], server: ['@vtt/shared/utils/grid.js'] },
      CONTRACT,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('сервер');
    expect(problems[0]).toContain('@vtt/shared/utils/grid.js');
  });

  it('клиент и сервер сверяются раздельно: клиентский модуль серверу не положен', () => {
    const { problems } = inspectHostRequirements(
      { client: [], server: ['@/core/registries'] },
      CONTRACT,
    );

    expect(problems).toHaveLength(1);
  });

  it('устаревший модуль — замечание с заменой, а не отказ', () => {
    const report = inspectHostRequirements(
      { client: ['@/stores/oldStore'], server: [] },
      CONTRACT,
    );

    expect(report.problems).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('@/stores/newStore');
  });
});

describe('readHostContract', () => {
  /**
   * Готовит временную пару «система + чекаут приложения рядом».
   *
   * @param {string | null} manifestText - содержимое манифеста контракта;
   *   `null` — чекаута приложения рядом нет
   * @returns {string} корень системы
   */
  function createSystemRoot(manifestText) {
    const workspace = mkdtempSync(path.join(tmpdir(), 'dnd5e-host-contract-'));
    const systemRoot = path.join(workspace, 'system');

    mkdirSync(systemRoot, { recursive: true });

    if (manifestText !== null) {
      const sharedDir = path.join(workspace, 'vttg', 'packages', 'shared');

      mkdirSync(sharedDir, { recursive: true });
      writeFileSync(path.join(sharedDir, 'host-contract.json'), manifestText);
    }

    return systemRoot;
  }

  it('без чекаута приложения сверять не с чем', () => {
    expect(readHostContract(createSystemRoot(null))).toBeNull();
  });

  it('читает манифест приложения', () => {
    const contract = readHostContract(
      createSystemRoot(JSON.stringify(CONTRACT)),
    );

    expect(contract.contractVersion).toBe('1.0.0');
    expect(contract.client).toHaveLength(CONTRACT.client.length);
  });

  it('манифест незнакомого вида — понятная ошибка, а не падение сверки', () => {
    expect(() =>
      readHostContract(createSystemRoot(JSON.stringify({ modules: [] }))),
    ).toThrow('не разбирается');
  });
});
