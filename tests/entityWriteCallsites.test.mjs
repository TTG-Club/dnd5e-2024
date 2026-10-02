import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { it } from 'vitest';

import { listSystemSources, toSystemPath } from './helpers/clientSources.mjs';
import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Запись сущности на сервер — только через помощники записи.
 *
 * Клиент, который сам собирает копию и шлёт её целиком, затирает то, что
 * сервер изменил после копии: конец прежнего каста, метку концентрации.
 * Помощник боевой записи берёт сущность свежей и шлёт разницу эффектов.
 */

/** Единственное место, откуда система зовёт боевой канал ядра */
const COMBAT_WRITE_FILE = 'src/client/composables/entityCombatWrite.ts';

/** Вызов боевого канала ядра */
const COMBAT_CHANNEL_CALL = /\bemitEntityCombatState\(/u;

/** Единственное место полной записи сущности во время игры */
const SHEET_WRITE_FILE = 'src/client/composables/entitySheetWrite.ts';

/**
 * Листы и окна настройки: их сохранение — правка владельцем, полная запись
 * черновика листа. Остаются своим сохранением.
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

it('полная запись сущности — только помощник записи листа и сохранения листов', () => {
  assert.deepEqual(
    listCallers(FULL_WRITE_CALL),
    [SHEET_WRITE_FILE, ...SHEET_SAVE_FILES].sort(),
  );
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
  const emitted = [];
  const errors = [];

  /**
   * Правка стора хоста: раздел заменяется в живой записи.
   *
   * @param {string} _worldId - мир
   * @param {string} entityId - сущность
   * @param {object} patch - разделы
   */
  function updateEntity(_worldId, entityId, patch) {
    world.set(entityId, { ...world.get(entityId), ...patch });
  }

  const changeEntitySheet = await loadHandler(
    SHEET_WRITE_FILE,
    'changeEntitySheet',
    {
      useWorldStore: () => ({
        connectionState: { currentWorldId: 'world' },
        updateActor: updateEntity,
        updateCreature: updateEntity,
      }),
      useChatStore: () => ({ getSocket: () => ({}) }),
      useWorldEntities: () => ({
        findCurrentDndEntity: (entityId) => world.get(entityId),
      }),
      isActorEntity: (entity) => entity.entityType === 'actor',
      isCreatureEntity: (entity) => entity.entityType === 'creature',
      keepsCombatState: await loadHandler(
        SHEET_WRITE_FILE,
        'keepsCombatState',
        {
          resolveEntityCurrentHp: (entity) => entity.system.hitPoints.current,
          resolveEntityTempHp: (entity) => entity.system.hitPoints.temp,
          JSON,
        },
      ),
      emitEntityUpdate: (_socket, entity) => emitted.push(entity),
      console: { error: (message) => errors.push(message) },
    },
  );

  return { changeEntitySheet, emitted, errors };
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
  const { changeEntitySheet, emitted } = await loadSheetWrite(world);

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
  assert.equal(emitted[0].system.hitPoints.current, 12, 'хиты — свежие');
  assert.deepEqual([...emitted[1].system.spellSlotsUsed], [2, 0]);
  assert.deepEqual([...world.get('hero').system.spellSlotsUsed], [2, 0]);
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
