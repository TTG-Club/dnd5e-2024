import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadChangeEntityCombatState } from './helpers/combatWrite.mjs';
import {
  BLESS,
  BLESS_CAST_ID,
  CLERIC_ID,
  createActor,
  createCreature,
  createEffect,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * Боевой снимок несёт разницу эффектов, сервер сливает её со своим списком.
 *
 * Клиент считал новый список от копии из стора. Сервер мог изменить сущность
 * после этой копии: конец прежнего каста снял эффекты с цели (Н2), метка
 * концентрации легла заклинателю (Н3). Полный список из копии вернул бы снятое
 * и стёр легшее.
 */

/** Каст, который заканчивается */
const OLD_CAST_ID = 'cast_protection';

/** Хиты цели */
const TARGET_HP = 30;

/**
 * Эффект старого каста на цели.
 *
 * @param {string} id - id эффекта
 * @returns {object} эффект с меткой каста
 */
function oldCastEffect(id) {
  return createEffect(id, {
    name: 'Защита от зла и добра',
    castId: OLD_CAST_ID,
    sourceActorId: CLERIC_ID,
  });
}

/**
 * Копия, которую клиент снял до ответа сервера, с основой.
 *
 * @param {object} entity - сущность в момент копии
 * @returns {object} копия с записанной основой
 */
function clientCopy(entity) {
  const copy = structuredClone(entity);

  engine.recordEffectsBaseline(copy, copy.activeEffects ?? []);

  return copy;
}

describe('разница эффектов: сервер сливает со своим списком', () => {
  it('н2: эффекты прежнего каста, снятые сервером, не возвращаются снимком нового', () => {
    const system = new engine.Dnd5eVttSystem();

    const target = withHp(createCreature, TARGET_HP, {
      activeEffects: [oldCastEffect('effect_old')],
    });

    // Клиент снял копию цели из стора — ответ сервера ещё не пришёл
    const copy = clientCopy(target);

    // Сервер выполнил конец прежнего каста
    system.removeCastEffects(target, CLERIC_ID, new Set([OLD_CAST_ID]));
    assert.equal(target.activeEffects.length, 0);

    // Клиент дописал новый эффект к своей копии и прислал снимок
    const enhance = createEffect('effect_new', {
      name: 'Улучшение характеристики',
      castId: 'cast_enhance',
      sourceActorId: CLERIC_ID,
    });

    copy.activeEffects = engine.mergeAppliedEffects(copy.activeEffects, [
      enhance,
    ]);

    const result = system.settleCombatState(
      target,
      engine.pickCombatState(copy),
    );

    assert.equal(result.accepted, true);

    assert.deepEqual(
      target.activeEffects.map((effect) => effect.id),
      ['effect_new'],
    );
  });

  it('н3: метка концентрации, легшая на сервере, не стирается снимком от копии без неё', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = withHp(createActor, TARGET_HP, { id: CLERIC_ID });
    const copy = clientCopy(caster);

    // Сервер записал метку концентрации (сохранением листа)
    const mark = engine.buildConcentrationEffect({
      spell: BLESS,
      casterId: CLERIC_ID,
      castId: BLESS_CAST_ID,
    });

    caster.activeEffects = [mark];

    copy.activeEffects = [createEffect('effect_buff', { name: 'Бафф' })];

    system.settleCombatState(caster, engine.pickCombatState(copy));

    assert.deepEqual(
      caster.activeEffects.map((effect) => effect.id).toSorted(),
      [mark.id, 'effect_buff'].toSorted(),
    );
  });

  it('изменение эффекта, которого на сервере уже нет, его не возвращает', () => {
    const base = [oldCastEffect('effect_old')];
    const next = [{ ...base[0], description: 'изменён клиентом' }];
    const changes = engine.diffEffects(base, next);

    assert.equal(changes.update.length, 1);
    assert.deepEqual(engine.applyEffectChanges([], changes), []);
  });

  it('снятие несуществующего id проходит без ошибки', () => {
    const kept = createEffect('effect_kept');

    assert.deepEqual(
      engine.applyEffectChanges([kept], {
        add: [],
        update: [],
        removeIds: ['effect_missing'],
      }),
      [kept],
    );
  });

  it('одноимённый эффект в добавленных заменяет прежний', () => {
    const older = createEffect('effect_older', { name: 'Благословение' });
    const newer = createEffect('effect_newer', { name: 'Благословение' });

    assert.deepEqual(
      engine
        .applyEffectChanges([older], {
          add: [newer],
          update: [],
          removeIds: [],
        })
        .map((effect) => effect.id),
      ['effect_newer'],
    );
  });

  it('снимок без разницы заменяет список целиком, как раньше', () => {
    const system = new engine.Dnd5eVttSystem();

    const target = withHp(createCreature, TARGET_HP, {
      activeEffects: [oldCastEffect('effect_old')],
    });

    // Копия без основы — старый клиент
    const copy = structuredClone(target);

    copy.activeEffects = [createEffect('effect_only')];

    const state = engine.pickCombatState(copy);

    assert.equal(state.effectChanges, undefined);
    system.settleCombatState(target, state);

    assert.deepEqual(
      target.activeEffects.map((effect) => effect.id),
      ['effect_only'],
    );
  });

  it('негодная разница отвергает снимок целиком', () => {
    const system = new engine.Dnd5eVttSystem();

    const target = withHp(createCreature, TARGET_HP, {
      activeEffects: [oldCastEffect('effect_old')],
    });

    const state = {
      ...engine.pickCombatState(structuredClone(target)),
      hpCurrent: 1,
      effectChanges: { add: 'не список', update: [], removeIds: [] },
    };

    assert.equal(system.settleCombatState(target, state).accepted, false);
    assert.equal(engine.resolveEntityCurrentHp(target), TARGET_HP);
    assert.equal(target.activeEffects.length, 1);
  });

  it('копия после хуков системы для ядра уходит разницей', () => {
    const system = new engine.Dnd5eVttSystem();

    const target = withHp(createCreature, TARGET_HP, {
      activeEffects: [oldCastEffect('effect_old')],
    });

    // Так делает targetStore ядра: глубокая копия, хук системы, снимок
    const damaged = structuredClone(target);

    system.applyDamageToEntity(damaged, 5, false, 'fire');

    const damagedState = engine.pickCombatState(damaged);

    assert.deepEqual(damagedState.effectChanges, {
      add: [],
      update: [],
      removeIds: [],
    });

    const affected = structuredClone(target);
    const web = createEffect('effect_web', { name: 'Паутина' });

    affected.activeEffects = system.applyEffectsToEntity(
      affected,
      [web],
      'manual',
    );

    const affectedState = engine.pickCombatState(affected);

    assert.deepEqual(
      affectedState.effectChanges.add.map((effect) => effect.name),
      ['Паутина'],
    );

    assert.deepEqual(affectedState.effectChanges.removeIds, []);

    // Сервер тем временем закончил каст: урон с копии его не откатывает
    system.removeCastEffects(target, CLERIC_ID, new Set([OLD_CAST_ID]));
    system.settleCombatState(target, damagedState);

    assert.equal(target.activeEffects.length, 0);
    assert.equal(engine.resolveEntityCurrentHp(target), TARGET_HP - 5);
  });
});

describe('помощник записи боевого состояния', () => {
  it('читает сущность из мира в момент вызова и пишет основу на отправляемую копию', async () => {
    const emitted = [];
    const world = new Map();

    const changeEntityCombatState = await loadChangeEntityCombatState({
      findEntity: (entityId) => world.get(entityId),
      emitted,
      recordEffectsBaseline: engine.recordEffectsBaseline,
    });

    const stale = withHp(createCreature, TARGET_HP, {
      activeEffects: [oldCastEffect('effect_old')],
    });

    // В мире сущность уже без эффекта прежнего каста
    const fresh = { ...stale, activeEffects: [] };

    world.set(stale.id, fresh);

    const seen = [];

    const sent = changeEntityCombatState(stale.id, (current) => {
      seen.push(current);

      return {
        ...current,
        activeEffects: [...current.activeEffects, createEffect('effect_new')],
      };
    });

    assert.equal(seen[0], fresh, 'преобразование получает сущность мира');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0], sent);
    assert.notEqual(sent, fresh, 'запись стора не отправляется');

    assert.deepEqual(engine.readEffectsBaseline(sent), []);

    assert.deepEqual(
      engine.pickCombatState(sent).effectChanges.add.map((effect) => effect.id),
      ['effect_new'],
    );

    // Нечего менять — ничего не уходит
    assert.equal(
      changeEntityCombatState(stale.id, () => null),
      null,
    );

    assert.equal(emitted.length, 1);
  });
});
