import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Отказ действия видит только тот, кто действовал.
 *
 * Отказ с листа шёл уведомлением, а с горячей панели — строкой «⛔ …» в общий
 * чат: игроки видели, что у чудовища кончились заряды (живая проверка 03.10,
 * З4). Теперь отказ — уведомление у нажавшего, одним помощником на лист и
 * панель, на персонажа и существо.
 */

const REFUSAL_PATH = 'src/client/composables/actionRefusal.ts';

/** Значок, которым начиналась строка отказа в общем чате */
const CHAT_REFUSAL_MARK = '⛔';

/**
 * Исходники клиента с их путями от корня системы.
 *
 * @returns {{ path: string, text: string }[]} исходники
 */
function readClientSources() {
  return listClientSources().map((path) => ({
    path: toSystemPath(path),
    text: readFileSync(path, 'utf8'),
  }));
}

describe('помощник отказа', () => {
  /**
   * Настоящие помощники отказа с журналом уведомлений.
   *
   * @returns {Promise<object>} помощники и журнал
   */
  async function loadRefusal() {
    const toasts = [];

    const ports = {
      useSystemToastStore: () => ({ add: (toast) => toasts.push(toast) }),
      ACTION_REFUSAL_LABELS: { sourceSeparator: ': ' },
      ACTOR_EQUIPMENT_TAB_LABELS: { attackBlockedTitle: 'Сейчас не ударить' },
    };

    for (const name of [
      'refuseAction',
      'refuseSpellCast',
      'refuseWeaponAttack',
    ]) {
      ports[name] = await loadHandler(REFUSAL_PATH, name, ports);
    }

    return { ...ports, toasts };
  }

  it('отказ каста — уведомление с названием заклинания и причиной', async () => {
    const { refuseSpellCast, toasts } = await loadRefusal();

    refuseSpellCast(
      { name: 'Огненный шар' },
      { title: 'Нет зарядов', description: 'Не осталось зарядов.' },
    );

    // Уведомление собрано в другом realm (VM) — сравнивается по содержимому
    assert.equal(
      JSON.stringify(toasts),
      JSON.stringify([
        {
          title: 'Нет зарядов',
          description: 'Огненный шар: Не осталось зарядов.',
          color: 'warning',
        },
      ]),
    );
  });

  it('отказ удара и действия — тем же уведомлением', async () => {
    const { refuseAction, refuseWeaponAttack, toasts } = await loadRefusal();

    refuseWeaponAttack('Действие уже потрачено');
    refuseAction('Дыхание', 'Цель вне досягаемости (30 фт)');

    assert.deepEqual(
      toasts.map(({ title, description }) => [title, description]),
      [
        ['Сейчас не ударить', 'Действие уже потрачено'],
        ['Дыхание', 'Цель вне досягаемости (30 фт)'],
      ],
    );
  });
});

describe('отказ не уходит в общий чат', () => {
  it('строк «⛔» в клиенте нет: отказ — только уведомлением', () => {
    const offenders = readClientSources()
      .filter(({ text }) => text.includes(CHAT_REFUSAL_MARK))
      .map(({ path }) => path);

    assert.deepEqual(offenders, []);
  });

  it('входы листа и панели отказывают одним помощником', () => {
    const PORTS = [
      [/createSpellCasterPort\([^,()]+,\s*(\w+)/gu, 'refuseSpellCast'],
      [/createCreatureSpellCasterPort\([^,()]+,\s*(\w+)/gu, 'refuseSpellCast'],
      [/createWeaponAttackPort\([^,()]+,\s*(\w+)/gu, 'refuseWeaponAttack'],
      [/\brefuse: (\w+)/gu, 'refuseAction'],
    ];

    const sources = readClientSources().filter(
      ({ path }) =>
        path.startsWith('src/client/ui/')
        || path.startsWith('src/client/macros/'),
    );

    for (const [pattern, helper] of PORTS) {
      const refusers = sources.flatMap(({ path, text }) =>
        [...text.matchAll(pattern)].map((match) => `${path}: ${match[1]}`),
      );

      assert.ok(refusers.length >= 2, `${helper}: входов меньше двух`);

      assert.deepEqual(
        refusers.filter((entry) => !entry.endsWith(`: ${helper}`)),
        [],
        `${helper}: вход отказывает по-своему`,
      );
    }
  });

  it('отказы по дальности, боеприпасам и выбранным целям идут помощником, а не в чат', () => {
    const REFUSING = {
      'src/client/composables/useSceneRangeCheck.ts': 2,
      'src/client/composables/effectActivationUse.ts': 2,
      'src/client/composables/spellEffectTargeting.ts': 2,
    };

    for (const [path, count] of Object.entries(REFUSING)) {
      const { text } = readClientSources().find(
        (source) => source.path === path,
      );

      assert.equal(
        [...text.matchAll(/\brefuseAction\(/gu)].length,
        count,
        `${path}: отказов помощником`,
      );
    }

    assert.doesNotMatch(
      readFileSync('src/client/composables/useSceneRangeCheck.ts', 'utf8'),
      /sendMessage\(/u,
    );
  });
});
