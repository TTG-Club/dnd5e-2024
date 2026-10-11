import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { it } from 'vitest';

import { listSystemSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEntityWrites } from './helpers/combatWrite.mjs';
import { systemRoot } from './helpers/engineBundle.mjs';

/**
 * Запись сущности на сервер — только через помощники записи.
 *
 * Клиент, который сам собирает копию и шлёт её целиком, затирает то, что
 * сервер изменил после копии: конец прежнего каста, метку концентрации.
 * Помощник боевой записи берёт сущность свежей и шлёт разницу эффектов;
 * ресурсы листа, листы и окна настройки шлют частичную запись — только то,
 * что изменили.
 */

/** Единственное место, откуда система зовёт боевой канал ядра */
const COMBAT_WRITE_FILE = 'src/client/composables/entityCombatWrite.ts';

/** Вызов боевого канала ядра */
const COMBAT_CHANNEL_CALL = /\bemitEntityCombatState\(/u;

/**
 * Запись ресурсов листа во время игры. Единственное место, где осталась
 * полная запись: запасной путь для правки, которая не легла на сущность
 * сервера
 */
const SHEET_WRITE_FILE = 'src/client/composables/entitySheetWrite.ts';

/** Общий помощник сохранения черновика частичной записью */
const DRAFT_WRITE_FILE = 'src/client/composables/useEntityDraftWrite.ts';

/**
 * Листы, быстрые панели и окна настройки: сохраняют черновик частичной
 * записью через общий помощник, сами на сервер ничего не шлют.
 */
const SHEET_SAVE_FILES = [
  'src/client/ui/actor/ActorSettingsModal.vue',
  'src/client/ui/actor/Dnd5eActorSheet.vue',
  'src/client/ui/actor/QuickEquipmentModal.vue',
  'src/client/ui/actor/QuickSpellsModal.vue',
  'src/client/ui/creature/CreatureSettingsModal.vue',
  'src/client/ui/creature/CreatureSheet.vue',
  'src/client/ui/creature/QuickCreatureActionsModal.vue',
];

/** Полная запись сущности: помощником ядра или событием напрямую */
const FULL_WRITE_CALL =
  /\bemitEntityUpdate\(|\.emit\(\s*'(?:actor|creature):updated'/u;

/** Частичная запись сущности помощниками ядра */
const PARTIAL_WRITE_CALL = /\bemitEntity(?:Patch|Change)\(/u;

/** Сохранение черновика общим помощником системы */
const DRAFT_SAVE_CALL = /\b(?:saveDraft|saveCopy|saveEntityFields)\(/u;

/** Правка стора хоста: только вместе с записью, в помощнике */
const STORE_WRITE_CALL = /\.update(?:Actor|Creature)\(/u;

/**
 * Строки исходника, не считая комментариев: упоминание в комментарии — не
 * вызов.
 *
 * @param {string} text - исходник
 * @returns {string} текст без строк-комментариев
 */
function withoutCommentLines(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

it('боевой канал ядра система зовёт только из помощника записи', () => {
  const direct = listSystemSources()
    .filter((path) => toSystemPath(path) !== COMBAT_WRITE_FILE)
    .filter((path) =>
      COMBAT_CHANNEL_CALL.test(withoutCommentLines(readFileSync(path, 'utf8'))),
    )
    .map(toSystemPath);

  assert.deepEqual(direct, []);
});

/**
 * Исходники системы, где встречается вызов (без строк-комментариев).
 *
 * @param {RegExp} pattern - вызов
 * @returns {string[]} пути от корня системы
 */
function listCallers(pattern) {
  return listSystemSources()
    .filter((path) =>
      pattern.test(withoutCommentLines(readFileSync(path, 'utf8'))),
    )
    .map(toSystemPath)
    .sort();
}

it('полная запись сущности — только запасной путь помощника записи листа', () => {
  assert.deepEqual(listCallers(FULL_WRITE_CALL), [SHEET_WRITE_FILE]);
});

it('частичную запись ядра зовут только два помощника записи', () => {
  assert.deepEqual(
    listCallers(PARTIAL_WRITE_CALL),
    [SHEET_WRITE_FILE, DRAFT_WRITE_FILE].sort(),
  );
});

it('листы, быстрые панели и окна настройки сохраняют общим помощником', () => {
  for (const path of SHEET_SAVE_FILES) {
    assert.match(
      readFileSync(join(systemRoot, path), 'utf8'),
      DRAFT_SAVE_CALL,
      `${path}: сохранение идёт мимо общего помощника`,
    );
  }
});

it('стор хоста правит только помощник записи листа', () => {
  assert.deepEqual(listCallers(STORE_WRITE_CALL), [SHEET_WRITE_FILE]);
});

it('горячая панель не шлёт копию, снятую до окна', () => {
  const macros = readFileSync(
    join(systemRoot, 'src/client/macros/dnd5eMacros.ts'),
    'utf8',
  );

  assert.doesNotMatch(macros, /JSON\.parse\(JSON\.stringify\(actor\)\)/u);
});

/**
 * Настоящий помощник записи листа с подменённым миром: стор правится так же,
 * как у хоста, — слиянием раздела в запись.
 *
 * @param {Map<string, object>} world - сущности мира
 * @returns {Promise<object>} помощник и журнал отправок
 */
async function loadSheetWrite(world) {
  const { changeEntitySheet, updated, patches, errors } =
    await loadEntityWrites({ world });

  return { changeEntitySheet, emitted: updated, patches, errors };
}

/**
 * Персонаж мира с ячейками и хитами.
 *
 * @param {object} overrides - поля
 * @returns {object} персонаж
 */
function hero(overrides = {}) {
  return {
    id: 'hero',
    name: 'Герой',
    entityType: 'actor',
    activeEffects: [],
    system: { hitPoints: { current: 30, temp: 0 }, spellSlotsUsed: [0, 0] },
    ...overrides,
  };
}

it('помощник записи листа читает сущность в момент вызова; две записи подряд не теряют первую', async () => {
  const world = new Map([['hero', hero()]]);
  const { changeEntitySheet, emitted, patches } = await loadSheetWrite(world);

  // Пока окно было открыто, сервер снял хиты
  world.set(
    'hero',
    hero({
      system: { hitPoints: { current: 12, temp: 0 }, spellSlotsUsed: [0, 0] },
    }),
  );

  const spendFirstLevel = (current) => ({
    ...current,
    system: {
      ...current.system,
      spellSlotsUsed: current.system.spellSlotsUsed.map((count, index) =>
        index === 0 ? count + 1 : count,
      ),
    },
  });

  changeEntitySheet('hero', spendFirstLevel);
  changeEntitySheet('hero', spendFirstLevel);

  assert.equal(emitted.length, 2);

  assert.deepEqual(
    patches[0].operations,
    [{ op: 'set', path: ['system', 'spellSlotsUsed'], value: [1, 0] }],
    'на сервер — только ячейки: хиты в правке не едут',
  );

  assert.deepEqual([...emitted[1].system.spellSlotsUsed], [2, 0]);
  assert.deepEqual([...world.get('hero').system.spellSlotsUsed], [2, 0]);
});

/**
 * Даёт отработать ответу сервера на правку листа.
 *
 * @returns {Promise<void>}
 */
function settleAnswers() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** Ответ сервера «правка не легла на его сущность» */
const PATCH_CONFLICT = { ok: false, reason: 'conflict', operationIndex: 0 };

/**
 * Трата первой ячейки от свежей сущности.
 *
 * @param {object} current - сущность мира
 * @returns {object} сущность с потраченной ячейкой
 */
function spendFirstSlot(current) {
  return {
    ...current,
    system: {
      ...current.system,
      spellSlotsUsed: current.system.spellSlotsUsed.map((count, index) =>
        index === 0 ? count + 1 : count,
      ),
    },
  };
}

it('правка не легла, а рассылка уже принесла сущность сервера — преобразование выполняется заново', async () => {
  const world = new Map([['hero', hero()]]);
  const answers = [PATCH_CONFLICT];

  const { changeEntitySheet, patches, fullWrites, toasts } =
    await loadEntityWrites({
      world,
      answerPatch: () => {
        // Сервер ушёл вперёд: другой клиент потратил ячейку второго уровня, и
        // рассылка заменила сущность стора раньше, чем пришёл отказ
        if (answers.length > 0) {
          world.set(
            'hero',
            hero({
              system: {
                hitPoints: { current: 30, temp: 0 },
                spellSlotsUsed: [0, 1],
              },
            }),
          );
        }

        return answers.shift() ?? { ok: true, changed: true };
      },
    });

  changeEntitySheet('hero', spendFirstSlot);
  await settleAnswers();

  assert.deepEqual(
    patches.map((patch) => patch.operations[0].value),
    [
      [1, 0],
      [1, 1],
    ],
    'повтор считает трату от сущности сервера, а не от прежней копии',
  );

  assert.equal(fullWrites.length, 0, 'полная запись не нужна');
  assert.equal(toasts.length, 0);
});

it('две записи в одном тике, первая не легла: сущность уходит целиком, трата не задваивается', async () => {
  const world = new Map([['hero', hero()]]);
  const answers = [PATCH_CONFLICT];

  const { changeEntitySheet, patches, fullWrites } = await loadEntityWrites({
    world,
    answerPatch: () => answers.shift() ?? { ok: true, changed: true },
  });

  changeEntitySheet('hero', spendFirstSlot);
  changeEntitySheet('hero', spendFirstSlot);
  await settleAnswers();

  // Стор несёт разделы наших записей — сервер отстал: повторять трату
  // поверх стора, где она уже есть, нельзя
  assert.equal(patches.length, 2, 'повторной правки нет');
  assert.equal(fullWrites.length, 1);
  assert.deepEqual([...fullWrites[0].system.spellSlotsUsed], [2, 0]);
});

it('повтор правки сам не повторяется: о втором отказе узнаёт игрок', async () => {
  const world = new Map([['hero', hero()]]);

  const { changeEntitySheet, patches, fullWrites, toasts } =
    await loadEntityWrites({
      world,
      answerPatch: () => {
        world.set('hero', hero());

        return PATCH_CONFLICT;
      },
    });

  changeEntitySheet('hero', spendFirstSlot);
  await settleAnswers();

  assert.equal(patches.length, 2, 'правка и один повтор');
  assert.equal(fullWrites.length, 0);
  assert.deepEqual(toasts, [{ title: 'Герой', description: 'conflict' }]);
});

it('помощник записи листа не шлёт правку хитов и эффектов', async () => {
  const world = new Map([['hero', hero()]]);
  const { changeEntitySheet, emitted, errors } = await loadSheetWrite(world);

  const healed = changeEntitySheet('hero', (current) => ({
    ...current,
    system: { ...current.system, hitPoints: { current: 40, temp: 0 } },
  }));

  const blessed = changeEntitySheet('hero', (current) => ({
    ...current,
    activeEffects: [{ id: 'effect_bless', name: 'Благословение' }],
  }));

  assert.equal(healed, null);
  assert.equal(blessed, null);
  assert.equal(emitted.length, 0);
  assert.equal(errors.length, 2);
});
