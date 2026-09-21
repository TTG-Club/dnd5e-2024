import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  change,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  withHp,
} from './_fixtures.mjs';

/**
 * Каталог: ключи изменений и флаги (`docs/EFFECT_SCENARIOS.md`, раздел
 * «Ключи и флаги»).
 *
 * У каждого флага ровно одна точка применения — её и проверяет строка.
 */

/**
 * Эффект с одними флагами.
 *
 * @param {string} name - название
 * @param {string[]} flags - флаги
 * @returns {object} эффект
 */
function flagEffect(name, flags) {
  return createEffect(name, { flags });
}

/**
 * Действующие флаги сущности.
 *
 * @param {object} entity - персонаж или существо
 * @returns {Set<string>} флаги
 */
function flagsOf(entity) {
  return engine.resolveActorStats(entity).activeFlags;
}

/**
 * Срабатывание эффекта как источник для движка.
 *
 * @param {object} effect - эффект с единственным срабатыванием
 * @returns {object} источник
 */
function sourceOf(effect) {
  return {
    effect,
    trigger: effect.triggers[0],
    ambient: false,
    instance: true,
    scope: effect.id,
  };
}

describe('каталог: ключи и флаги', () => {
  it('[K01] Аура жизни: максимум хитов нельзя уменьшать', () => {
    const drain = createEffect('Иссушение', {
      triggers: [
        {
          id: 'trigger_drain',
          event: 'turnStart',
          actions: [{ type: 'reduceMaxHp', amount: '5' }],
        },
      ],
    });

    const bare = withHp(createActor, 30, { activeEffects: [drain] });

    engine.applyTriggerEffectActions(bare, sourceOf(drain), false);

    assert.equal(
      engine.resolveEntityMaxHp(bare),
      25,
      'без оберега уменьшение проходит',
    );

    const warded = withHp(createActor, 30, {
      activeEffects: [
        flagEffect('Аура жизни', ['hitPoints.maxReductionBlocked']),
        drain,
      ],
    });

    engine.applyTriggerEffectActions(warded, sourceOf(drain), false);

    assert.equal(
      warded.activeEffects.some(
        (effect) => effect.tag === engine.MAX_HP_REDUCTION_TAG,
      ),
      false,
      'метка уменьшения не легла вовсе',
    );

    assert.equal(engine.resolveEntityMaxHp(warded), 30);
  });

  it('[K02] Парализованный: попадание по нему — критическое', () => {
    const paralyzed = flagEffect('Парализованный', [
      'attacksAgainst.forceCritical',
    ]);

    const target = withHp(createActor, 30, { activeEffects: [paralyzed] });
    const flags = flagsOf(target);

    const hit = engine.resolveAttackRoll({
      total: 15,
      attackModifier: 5,
      naturalRoll: 10,
      targetAc: 12,
      targetFlags: flags,
    });

    assert.equal(hit.isCriticalHit, true, 'обычное попадание стало критом');

    const miss = engine.resolveAttackRoll({
      total: 3,
      attackModifier: 5,
      naturalRoll: 1,
      targetAc: 12,
      targetFlags: flags,
    });

    assert.equal(miss.isCriticalHit, false, 'единица по-прежнему промах');

    const belowAc = engine.resolveAttackRoll({
      total: 11,
      attackModifier: 5,
      naturalRoll: 6,
      targetAc: 12,
      targetFlags: flags,
    });

    assert.equal(belowAc.isHit, false, 'бросок ниже КД — промах');
    assert.equal(belowAc.isCriticalHit, false, 'промах критом не становится');

    const immune = withHp(createActor, 30, {
      activeEffects: [
        paralyzed,
        flagEffect('Адамантиновая броня', ['defense.critImmunity']),
      ],
    });

    const blocked = engine.resolveAttackRoll({
      total: 15,
      attackModifier: 5,
      naturalRoll: 10,
      targetAc: 12,
      targetFlags: flagsOf(immune),
    });

    assert.equal(
      blocked.isCriticalHit,
      false,
      'иммунитет к критам сильнее принуждения',
    );
  });

  it('[K03] Изгоняющая кара: защиты цели не действуют', () => {
    const creature = createCreature();

    creature.system.defenses = {
      ...creature.system.defenses,
      resistances: ['fire'],
      immunities: ['poison'],
    };

    assert.ok(
      engine
        .resolveTargetDamageDefenses(creature, undefined)
        .resistances.has('fire'),
      'сопротивление на месте',
    );

    creature.activeEffects = [
      flagEffect('Изгоняющая кара', ['defense.suppressAll']),
    ];

    const defenses = engine.resolveTargetDamageDefenses(creature, undefined);

    assert.equal(defenses.resistances.size, 0, 'сопротивлений не осталось');
    assert.equal(defenses.immunities.size, 0, 'иммунитетов тоже');

    const hp = engine.resolveEntityCurrentHp(creature);

    assert.equal(
      engine.applyTargetDamage(creature, 4, false, 'fire').hpAfter,
      hp - 4,
      'огонь проходит полностью',
    );
  });

  it('[K04] Цепи Белета: перенос не проходит, толчок проходит', () => {
    const chained = flagEffect('Цепи Белета', ['movement.teleportBlocked']);
    const victim = withHp(createActor, 20, { activeEffects: [chained] });

    const scene = {
      target: createToken(victim.id, 2, 0),
      origin: createToken('actor_caster', 0, 0),
      gridSettings: GRID,
      targetFlags: flagsOf(victim),
    };

    assert.equal(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'teleport', distance: 10 },
        scene,
      ),
      null,
      'перенос под запретом',
    );

    assert.ok(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'push', distance: 10 },
        scene,
      ),
      'толчок — обычное перемещение, запрет его не касается',
    );

    assert.ok(
      engine.resolveForcedMovePosition(
        { type: 'move', kind: 'teleport', distance: 10 },
        { ...scene, targetFlags: new Set() },
      ),
      'без запрета переносит как прежде',
    );
  });

  it('[K05] Проклятие бессонницы: отдых не приносит пользы', () => {
    const curse = flagEffect('Проклятие бессонницы', ['rest.noBenefit.long']);
    const cursed = withHp(createActor, 5, { activeEffects: [curse] }, 40);

    assert.equal(
      engine.applyActorRest(cursed, 'long').system,
      undefined,
      'ни ячеек, ни хитов отдых не вернул',
    );

    const healthy = withHp(createActor, 5, {}, 40);

    assert.equal(
      engine.applyActorRest(healthy, 'long').system.hitPoints.current,
      40,
      'без проклятия отдых работает как прежде',
    );

    assert.ok(
      engine.applyActorRest(cursed, 'short').system,
      'проклятие названо продолжительным — короткий отдых идёт',
    );
  });

  it('[K06] Метка охотника: «весь наносимый урон» бьёт любым видом', () => {
    const mark = createEffect('Метка охотника', {
      changes: [change('damage.all', '1d6')],
    });

    const roll = { hasAdvantage: false, hasDisadvantage: false };

    for (const key of ['damage.melee', 'damage.ranged', 'damage.spell']) {
      assert.equal(
        engine.hasBonusDamageFormulas([mark], key),
        true,
        `${key}: строка «весь урон» подходит`,
      );

      assert.deepEqual(
        engine
          .collectBonusDamageFormulas([mark], key, roll)
          .map((entry) => entry.formula),
        ['1d6'],
      );
    }

    const melee = createEffect('Только рукопашный', {
      changes: [change('damage.melee', '1d4')],
    });

    assert.equal(
      engine.hasBonusDamageFormulas([melee], 'damage.ranged'),
      false,
      'обычный ключ по-прежнему про один вид урона',
    );
  });

  it('[K07] Обращение в зверя: эффект меняет тип существа', () => {
    const hero = createActor();

    assert.equal(engine.resolveEntityCreatureType(hero), 'humanoid');

    hero.activeEffects = [
      createEffect('Обращение в зверя', {
        changes: [change('creatureType', 'beast')],
      }),
    ];

    assert.equal(
      engine.resolveEntityCreatureType(hero),
      'beast',
      'пока эффект действует, существо другое',
    );

    hero.activeEffects = [];

    assert.equal(
      engine.resolveEntityCreatureType(hero),
      'humanoid',
      'эффект кончился — тип вернулся',
    );
  });

  // Пробелы каталога: этим ключам нужны либо чувства и свет в расчёте сцены,
  // либо размер фишки — это хозяйство ядра, системе их не посчитать
  it.todo('[K08] Смена размера меняет фишку и грузоподъёмность');
  it.todo('[K09] Свет от носителя эффекта');
  it.todo('[K10] Выданные чувства участвуют в расчёте видимости');
  it.todo('[K11] Запрет колдовать');
  it.todo('[K12] Выданная атака в списке действий');
  it.todo('[K13] Временное владение навыком');
});
