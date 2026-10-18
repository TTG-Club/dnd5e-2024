import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createEntityServer,
  loadEntityWrites,
} from './helpers/combatWrite.mjs';
import {
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Запись ресурса листа сразу после доведения каста не возвращает прежние
 * эффекты.
 *
 * Полную запись сервер не сливает — заменяет сущность присланным. Стор клиента
 * до ответа сервера держит прежние эффекты: метку прежней концентрации, без
 * новой. Заряд заклинания существа «N/день» без окна броска писался после
 * доведения каста — и запись возвращала серверу прежнюю метку вместо новой
 * (живая проверка 03.10, Н1).
 *
 * Теперь запись листа — частичная: эффекты в ней не едут вовсе, и вернуть
 * прежнюю метку ей нечем. Полная запись осталась запасным путём для правки,
 * которая не легла на сущность сервера; она несёт эффекты с посланным боевым
 * каналом, а не из стора.
 */

/** Заклинатель */
const CASTER_ID = 'creature_caster';

/** Цель прежнего каста */
const TARGET_ID = 'creature_target';

/** Прежний каст с концентрацией */
const OLD_CAST_ID = 'cast_old';

/** Новый каст с концентрацией */
const NEW_CAST_ID = 'cast_new';

/** Срок памяти посланных изменений эффектов, мс — как в помощнике */
const SENT_EFFECTS_TTL_MS = 2000;

/**
 * Метка концентрации каста.
 *
 * @param {string} castId - каст
 * @param {string} spellName - заклинание
 * @returns {object} эффект-метка
 */
function concentrationMark(castId, spellName) {
  return engine.buildConcentrationEffect({
    spell: { id: spellName, name: spellName },
    casterId: CASTER_ID,
    castId,
  });
}

/** Метка прежнего каста на заклинателе */
const OLD_MARK = concentrationMark(OLD_CAST_ID, 'Подчинение чудовища');

/** Метка нового каста */
const NEW_MARK = concentrationMark(NEW_CAST_ID, 'Невидимость');

/** Эффект прежнего каста на цели */
const OLD_CHARM = createEffect('charm', {
  name: 'Очарованный',
  sourceActorId: CASTER_ID,
  castId: OLD_CAST_ID,
});

/** Свой эффект заклинателя, к кастам не относится */
const OWN_EFFECT = createEffect('own', { name: 'Свой эффект' });

/**
 * Заклинатель с прежней концентрацией и зарядом заклинания.
 *
 * @returns {object} существо
 */
function createCaster() {
  return createCreature({
    id: CASTER_ID,
    activeEffects: [OWN_EFFECT, OLD_MARK],
    spells: [
      {
        id: 'veil',
        name: 'Невидимость',
        uses: { max: 1, current: 1, recovery: 'longRest' },
      },
    ],
  });
}

/** Ответ сервера «правка не легла на сущность» — включает запасной путь */
const PATCH_CONFLICT = { ok: false, reason: 'conflict', operationIndex: 0 };

/**
 * Мир клиента с заклинателем и целью, сервер заклинателя и часы.
 *
 * @param {object} [options] - окружение
 * @param {() => object} [options.answerPatch] - ответ сервера на правку листа
 * @returns {Promise<object>} помощники записи, мир, сервер и часы
 */
async function setup({ answerPatch } = {}) {
  const caster = createCaster();

  const target = createCreature({
    id: TARGET_ID,
    activeEffects: [OLD_CHARM],
  });

  const world = new Map([
    [caster.id, structuredClone(caster)],
    [target.id, structuredClone(target)],
  ]);

  const clock = { time: 0 };

  const writes = await loadEntityWrites({
    world,
    recordCombatBaseline: engine.recordCombatBaseline,
    clock: { now: () => clock.time },
    answerPatch,
  });

  const server = createEntityServer(engine, structuredClone(caster));

  return { world, server, clock, ...writes };
}

/**
 * Доведение каста, как его делает `completeSpellCast`: конец прежнего каста —
 * серверу, новая метка — боевым снимком. Сервер получает оба, стор клиента
 * ответа ещё не видел.
 *
 * @param {object} context - окружение теста
 * @param {object} context.server - сервер заклинателя
 * @param {Function} context.rememberSentCastEnd - память конца кастов
 * @param {Function} context.changeEntityCombatState - помощник боевой записи
 * @param {object[]} context.emitted - отправленные снимки
 */
function completeCast({
  server,
  rememberSentCastEnd,
  changeEntityCombatState,
  emitted,
}) {
  rememberSentCastEnd(CASTER_ID, [OLD_CAST_ID]);

  server.receiveUpdate({
    ...server.entity,
    activeEffects: engine.withoutCastEffects(
      server.entity.activeEffects,
      CASTER_ID,
      new Set([OLD_CAST_ID]),
    ),
  });

  changeEntityCombatState(CASTER_ID, (current) => ({
    ...current,
    activeEffects: engine.mergeAppliedEffects(current.activeEffects ?? [], [
      NEW_MARK,
    ]),
  }));

  server.receiveCombatState(emitted.at(-1));
}

/**
 * Списывает заряд заклинания записью листа.
 *
 * @param {Function} changeEntitySheet - помощник записи листа
 * @param {string} entityId - сущность
 * @returns {object | null} отправленная сущность
 */
function spendCharge(changeEntitySheet, entityId = CASTER_ID) {
  return changeEntitySheet(entityId, (current) => ({
    ...current,
    spells: [{ id: 'veil', uses: { current: 0 } }],
  }));
}

/**
 * Названия эффектов сущности.
 *
 * @param {object} entity - сущность
 * @returns {string[]} названия
 */
function effectNames(entity) {
  // Копия списка: отправленную сущность помощник собирает в своём окружении
  return [...(entity.activeEffects ?? [])].map((effect) => effect.name);
}

/**
 * Мир, где сервер правку листа не принимает: запись уходит запасным путём.
 *
 * @returns {Promise<object>} окружение теста
 */
function setupRefusing() {
  return setup({ answerPatch: () => PATCH_CONFLICT });
}

/**
 * Даёт отработать ответу сервера на правку листа: запасная полная запись
 * уходит после него.
 *
 * @returns {Promise<void>}
 */
function settleAnswers() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

describe('запись листа после доведения каста', () => {
  it('эффекты в правке листа не едут', async () => {
    const { changeEntitySheet, patches, fullWrites } = await setup();

    spendCharge(changeEntitySheet);
    await settleAnswers();

    assert.equal(patches.length, 1);

    assert.deepEqual(
      patches[0].operations.filter(
        (operation) => operation.path[0] !== 'spells',
      ),
      [],
      'правка несёт только заклинания',
    );

    assert.equal(fullWrites.length, 0, 'полной записи нет');
  });

  it('запись заряда после каста не возвращает прежнюю метку и не стирает новую', async () => {
    const context = await setup();
    const { world, server, changeEntitySheet, patches } = context;

    completeCast(context);

    // Стор ответа сервера не видел: в нём прежняя метка
    assert.deepEqual(effectNames(world.get(CASTER_ID)), [
      OWN_EFFECT.name,
      OLD_MARK.name,
    ]);

    spendCharge(changeEntitySheet);
    server.receivePatch(patches[0]);

    assert.deepEqual(effectNames(server.entity), [
      OWN_EFFECT.name,
      NEW_MARK.name,
    ]);

    assert.equal(server.entity.spells[0].uses.current, 0, 'заряд списан');

    // Стор эффектов от записи листа не получает: их меняет ответ сервера
    assert.deepEqual(effectNames(world.get(CASTER_ID)), [
      OWN_EFFECT.name,
      OLD_MARK.name,
    ]);
  });
});

/**
 * Эффекты отправленной сущности обычными значениями: помощник собирает их в
 * своём окружении, и сравнивать их с эффектами мира надо по содержимому.
 *
 * @param {object} entity - отправленная сущность
 * @returns {object[]} эффекты
 */
function sentEffects(entity) {
  return structuredClone(entity.activeEffects);
}

describe('запасная полная запись несёт эффекты с посланным', () => {
  it('правка не легла — сущность уходит целиком, один раз', async () => {
    const { world, changeEntitySheet, patches, fullWrites } =
      await setupRefusing();

    spendCharge(changeEntitySheet);
    await settleAnswers();

    assert.equal(patches.length, 1);
    assert.equal(fullWrites.length, 1);
    assert.equal(fullWrites[0].spells[0].uses.current, 0);

    // Без посланного эффекты уходят как в сторе
    assert.deepEqual(
      sentEffects(fullWrites[0]),
      world.get(CASTER_ID).activeEffects,
    );
  });

  it('после каста не возвращает прежнюю метку и не стирает новую', async () => {
    const context = await setupRefusing();
    const { server, changeEntitySheet, fullWrites } = context;

    completeCast(context);
    spendCharge(changeEntitySheet);
    await settleAnswers();

    server.receiveUpdate(fullWrites[0]);

    assert.deepEqual(effectNames(server.entity), [
      OWN_EFFECT.name,
      NEW_MARK.name,
    ]);
  });

  it('запись листа цели не возвращает эффект закончившегося каста', async () => {
    const context = await setupRefusing();
    const { changeEntitySheet, fullWrites } = context;

    completeCast(context);
    spendCharge(changeEntitySheet, TARGET_ID);
    await settleAnswers();

    assert.equal(fullWrites[0].activeEffects.length, 0);
  });

  it('стор догнал посланное — запись несёт эффекты стора, память забыта', async () => {
    const context = await setupRefusing();
    const { world, server, changeEntitySheet, fullWrites } = context;

    completeCast(context);

    // Ответ сервера дошёл до стора
    world.get(CASTER_ID).activeEffects = structuredClone(
      server.entity.activeEffects,
    );

    spendCharge(changeEntitySheet);
    await settleAnswers();

    assert.deepEqual(
      sentEffects(fullWrites[0]),
      world.get(CASTER_ID).activeEffects,
    );

    // Сервер снял метку по своим правилам (провал спасброска концентрации):
    // следующая запись листа её не воскрешает
    world.get(CASTER_ID).activeEffects = [OWN_EFFECT];

    changeEntitySheet(CASTER_ID, (current) => ({
      ...current,
      spells: [{ id: 'veil', uses: { current: 1 } }],
    }));

    await settleAnswers();

    assert.deepEqual(effectNames(fullWrites[1]), [OWN_EFFECT.name]);
  });

  it('дошедший эффект берётся из стора: сервер мог его дополнить', async () => {
    const context = await setupRefusing();
    const { world, server, changeEntitySheet, fullWrites } = context;

    completeCast(context);

    world.get(CASTER_ID).activeEffects = server.entity.activeEffects.map(
      (effect) =>
        effect.id === NEW_MARK.id
          ? { ...effect, description: 'дополнено сервером' }
          : effect,
    );

    spendCharge(changeEntitySheet);
    await settleAnswers();

    assert.equal(
      fullWrites[0].activeEffects.find((effect) => effect.id === NEW_MARK.id)
        .description,
      'дополнено сервером',
    );
  });

  it('срок памяти вышел — запись несёт эффекты стора', async () => {
    const context = await setupRefusing();
    const { world, clock, changeEntitySheet, fullWrites } = context;

    completeCast(context);
    clock.time = SENT_EFFECTS_TTL_MS + 1;
    spendCharge(changeEntitySheet);
    await settleAnswers();

    assert.deepEqual(
      sentEffects(fullWrites[0]),
      world.get(CASTER_ID).activeEffects,
    );
  });
});
