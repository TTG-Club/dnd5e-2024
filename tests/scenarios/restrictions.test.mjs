import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  createActor,
  createCreature,
  createEffect,
  engine,
} from './_fixtures.mjs';

/**
 * Каталог: ограничения действий и колдовства (`docs/EFFECT_SCENARIOS.md`,
 * раздел «Ограничения действий и колдовства»). Тексты правил — из сверки мест
 * этапа 2A (`wave2-plan/stage2A/places.json`).
 */

/** Волшебник 13 уровня: ячейки до 7 круга */
const WIZARD = { classKey: 'wizard', level: 13, hitDie: 6, casterType: 'full' };

/**
 * Носитель с записанной тратой хода.
 *
 * @param {object} entity - носитель
 * @param {string} cost - трата
 * @param {object} options - атака ли это
 * @returns {object} носитель после траты
 */
function spent(entity, cost, options = {}) {
  const ledger = engine.recordActionSpend(entity, cost, options);

  assert.ok(ledger, `трата «${cost}» записана`);

  return { ...entity, system: { ...entity.system, effectUsage: ledger } };
}

/**
 * Строки карточки эффекта одним текстом.
 *
 * @param {object} effect - эффект
 * @returns {string} строки через перевод строки
 */
function detailsOf(effect) {
  return engine
    .buildActiveEffectDetails(effect)
    .flatMap((section) => section.lines)
    .join('\n');
}

/**
 * Перемещение фишки на столько футов.
 *
 * @param {number} distance - длина пути
 * @param {boolean} forced - фишку переставили правила
 * @returns {object} перемещение для хука системы
 */
function moveOf(distance, forced = false) {
  return {
    from: { id: 'token', actorId: 'x', x: 0, y: 0, scale: 1, rotation: 0 },
    to: { id: 'token', actorId: 'x', x: 50, y: 0, scale: 1, rotation: 0 },
    distance,
    steps: [],
    forced,
    stopped: false,
  };
}

/**
 * Возможности ядра в бою на ходу сущности.
 *
 * @param {string | null} turnActorId - чей ход
 * @returns {object} контекст срабатываний
 */
function combatContext(turnActorId) {
  return {
    isInCombat: () => true,
    getActiveTurnActorId: () => turnActorId,
  };
}

describe('каталог: ограничения действий и колдовства', () => {
  it('[AR01] Электрошок 2024: нет провоцированных атак, остальные реакции доступны', () => {
    // «Цель не может совершать провоцированные атаки до начала своего
    // следующего хода»
    const shock = createEffect('Электрошок', {
      effectTarget: 'target',
      flags: ['actions.noOpportunityAttack'],
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(shock, 'spell');

    const target = createActor({ activeEffects: [shock] });

    assert.equal(
      engine.resolveActionCostBlock(target, 'reaction'),
      null,
      'реакция доступна: «Щит» и «Контрзаклинание» накладываются',
    );

    assert.equal(
      engine.resolveOpportunityAttackWarning(target),
      'Провоцированные атаки недоступны: Электрошок',
    );

    assert.equal(engine.resolveOpportunityAttackWarning(createActor()), null);

    assert.equal(
      engine.resolveWeaponAttackBlock(target),
      null,
      'в свой ход бьёт',
    );
  });

  it('[AR02] Психическая плеть Таши: за ход одно из трёх — перемещение, действие, бонусное', () => {
    // «В свой следующий ход цель должна выбрать, что она получит: перемещение,
    // действие или бонусное действие; она получает только одно из трёх»
    const whip = createEffect('Психическая плеть Таши', {
      effectTarget: 'target',
      flags: ['actions.noOpportunityAttack', 'actions.oneOfMoveActionBonus'],
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(whip, 'spell');

    const system = new engine.Dnd5eVttSystem();
    const target = createActor({ activeEffects: [whip] });

    assert.ok(system.getTotalMovementSpeed(target) > 0);

    // Совершил действие — ни бонусного, ни перемещения
    const acted = spent(target, 'action');

    assert.equal(
      engine.formatActionCostBlock(
        engine.resolveActionCostBlock(acted, 'bonus'),
      ),
      'Бонусное действие недоступно: Психическая плеть Таши',
    );

    assert.equal(system.getTotalMovementSpeed(acted), 0);
    assert.deepEqual(system.getMovementRange(acted), { base: 0, extended: 0 });

    // Переместился в свой ход — сервер пишет трату, действие недоступно
    const walker = createActor({ activeEffects: [whip] });

    const moved = system.applyMovementEffects(
      walker,
      moveOf(15),
      combatContext(walker.id),
    );

    assert.equal(moved.changed, true, 'счётчик хода уходит в мир');

    assert.equal(
      engine.formatActionCostBlock(
        engine.resolveActionCostBlock(walker, 'action'),
      ),
      'Действие недоступно: Психическая плеть Таши',
    );

    assert.ok(
      system.getTotalMovementSpeed(walker) > 0,
      'идти дальше в тот же ход можно',
    );

    // Толчок чужими правилами и чужой ход — не своё перемещение
    const pushed = createActor({ activeEffects: [whip] });

    system.applyMovementEffects(
      pushed,
      moveOf(15, true),
      combatContext(pushed.id),
    );

    system.applyMovementEffects(pushed, moveOf(15), combatContext('other'));
    assert.equal(engine.resolveActionCostBlock(pushed, 'action'), null);

    // «Действие или бонусное» перемещение не считает — как раньше
    const slow = createEffect('Замедление', {
      flags: ['actions.oneActionOrBonus'],
    });

    const slowed = createActor({ activeEffects: [slow] });

    assert.equal(engine.recordActionSpend(slowed, 'move'), undefined);
    assert.ok(system.getTotalMovementSpeed(spent(slowed, 'action')) > 0);
  });

  it('[AR03] Ледяное копьё: перемещение или действие, без бонусного', () => {
    // «Она может перемещаться или совершать 1 действие в свой ход, но не оба
    // сразу» — и не может совершать бонусные действия и реакции
    const spear = createEffect('Ледяное копьё', {
      effectTarget: 'target',
      flags: [
        'actions.oneOfMoveActionBonus',
        'actions.noBonusAction',
        'actions.noReaction',
      ],
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(spear, 'creatureAction');

    const target = createActor({ activeEffects: [spear] });

    assert.notEqual(engine.resolveActionCostBlock(target, 'bonus'), null);
    assert.equal(engine.resolveActionCostBlock(target, 'action'), null);

    assert.equal(
      new engine.Dnd5eVttSystem().getTotalMovementSpeed(
        spent(target, 'action'),
      ),
      0,
    );
  });

  it('[AR04] Замедление, «Изувечен»: действием «Атака» — одна атака за ход', () => {
    // «Если цель совершает действие Атака, то она может совершить только одну
    // атаку» — сколько бы их ни давала «Дополнительная атака»
    const maimed = createEffect('Изувечен', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      flags: ['actions.oneAttackPerAction'],
      duration: { type: 'special' },
    });

    authoredScenario(maimed, 'feature');

    // На цели лежит наложенная копия — уже без кнопки применения
    const applied = { ...maimed, activation: undefined };
    const fighter = createActor({ activeEffects: [applied] });

    assert.equal(engine.resolveWeaponAttackBlock(fighter), null);

    const struck = spent(fighter, engine.WEAPON_ATTACK_COST, { attack: true });

    assert.equal(
      engine.resolveWeaponAttackBlock(struck),
      'Вторая атака за ход недоступна: Изувечен',
    );

    assert.equal(
      engine.resolveActionCostBlock(struck, 'bonus'),
      null,
      'бонусное действие флаг не трогает',
    );

    // Правило — про действие «Атака»: удар бонусным действием (второе лёгкое
    // оружие) и реакцией (провоцированная атака) флаг не гасит и не считает
    assert.equal(engine.resolveWeaponAttackBlock(struck, [], 'bonus'), null);
    assert.equal(engine.resolveWeaponAttackBlock(struck, [], 'reaction'), null);

    for (const cost of ['bonus', 'reaction']) {
      assert.equal(
        engine.recordActionSpend(fighter, cost, { attack: true }),
        undefined,
        `удар тратой «${cost}» в счёт атак не идёт`,
      );
    }

    // У оружия нет поля цены: в свой ход удар — действие «Атака», второй
    // бьющий может объявить бонусным действием; вне своего хода удар — реакция
    assert.deepEqual(engine.planWeaponAttack(fighter, true), {
      cost: 'action',
      blocked: null,
      canDeclareBonus: false,
    });

    assert.deepEqual(engine.planWeaponAttack(struck, true), {
      cost: 'action',
      blocked: 'Вторая атака за ход недоступна: Изувечен',
      canDeclareBonus: true,
    });

    assert.deepEqual(engine.planWeaponAttack(struck, false), {
      cost: 'reaction',
      blocked: null,
      canDeclareBonus: false,
    });

    // Не атака (заклинание действием) счётчик атак не двигает
    assert.equal(engine.recordActionSpend(fighter, 'action'), undefined);

    // Существо: вторая запись с броском попадания из «Действий» недоступна,
    // бонусные и легендарные действия — нет
    const troll = createCreature({ activeEffects: [applied] });
    const bite = { name: 'Укус', attackBonus: 7 };

    const blocks = engine.resolveEntityActionBlocks(
      spent(troll, 'action', { attack: true }),
    );

    assert.equal(
      engine.findCreatureActionBlock(blocks, 'actions', bite),
      'Вторая атака за ход недоступна: Изувечен',
    );

    assert.equal(
      engine.findCreatureActionBlock(blocks, 'bonusActions', bite),
      null,
    );

    assert.equal(
      engine.findCreatureActionBlock(blocks, 'legendary', bite),
      null,
    );

    assert.equal(
      engine.findCreatureActionBlock(blocks, 'actions', { name: 'Рёв' }),
      null,
      'действие без броска попадания — не атака',
    );

    // Провоцированная атака существа — та же запись «Действий» вне его хода:
    // это реакция, «одна атака» её не гасит
    assert.equal(
      engine.findCreatureActionBlock(blocks, 'actions', bite, false),
      null,
    );

    assert.equal(
      engine.resolveCreatureActionCost('actions', bite, false),
      'reaction',
    );

    assert.equal(
      engine.resolveCreatureActionCost('actions', { name: 'Рёв' }, false),
      'action',
      'не атака вне хода остаётся действием раздела',
    );

    // Конец хода обнуляет счёт
    const nextTurn = {
      ...struck,
      system: {
        ...struck.system,
        effectUsage: engine.pruneTriggerUsage(struck, ['turn']),
      },
    };

    assert.equal(engine.resolveWeaponAttackBlock(nextTurn), null);
  });

  it('[AR05] Цепи сдерживания магов: нет действия «Магия», бонусным и реакцией колдовать можно', () => {
    // «Пока цель опутана, она не может совершать действие Магия»
    const chains = createEffect('Цепи сдерживания магов', {
      conditionKey: 'restrained',
      effectTarget: 'target',
      flags: ['spellcasting.noMagicAction'],
      duration: { type: 'turn', value: 1 },
    });

    authoredScenario(chains, 'creatureAction');

    const mage = createActor({ activeEffects: [chains] });

    assert.equal(
      engine.resolveSpellCastBlock(mage, { castingTimeUnit: 'action' }),
      'Действие «Магия» недоступно: Цепи сдерживания магов',
    );

    assert.equal(
      engine.resolveSpellCastBlock(mage, { castingTimeUnit: 'bonus-action' }),
      null,
    );

    assert.equal(
      engine.resolveSpellCastBlock(mage, { castingTimeUnit: 'reaction' }),
      null,
    );

    assert.equal(
      engine.resolveWeaponAttackBlock(mage),
      null,
      'действие «Атака» остаётся',
    );
  });

  it('[AR06] Заклинание фаэрзресса: нельзя накладывать заклинания школы Прорицания', () => {
    const faerzress = createEffect('Заклинание фаэрзресса', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      flags: ['spellcasting.noSchool.divination'],
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(faerzress, 'feature');

    // На цели лежит наложенная копия — уже без кнопки применения
    const seer = createActor({
      activeEffects: [{ ...faerzress, activation: undefined }],
    });

    assert.equal(
      engine.resolveSpellCastBlock(seer, {
        castingTimeUnit: 'action',
        school: 'divination',
      }),
      'Заклинания школы недоступны («Прорицание»): Заклинание фаэрзресса',
    );

    assert.equal(
      engine.resolveSpellCastBlock(seer, {
        castingTimeUnit: 'action',
        school: 'evocation',
      }),
      null,
    );

    assert.ok(engine.isEffectFlagKey('spellcasting.noSchool.necromancy'));
  });

  it('[AR07] Копьё Драконьей Чешуи: ячейки 7-го круга и выше недоступны', () => {
    // «Спасбросок Интеллекта Сл. 22, или не сможет использовать ячейки
    // заклинаний 7-го уровня или выше до конца своего следующего хода»
    const spear = createEffect('Копьё Драконьей Чешуи', {
      effectTarget: 'target',
      applySave: { ability: 'intelligence', dc: 22, onSuccess: 'negate' },
      castRule: { maxSlotLevel: 6 },
      duration: { type: 'turn', value: 2 },
    });

    authoredScenario(spear, 'creatureAction');

    assert.equal(
      engine.hasLastingEffectPayload(spear),
      true,
      'правило каста — длящаяся нагрузка: эффект остаётся на цели',
    );

    const wizard = createActor({ activeEffects: [spear] });

    wizard.system = { ...wizard.system, classes: [WIZARD] };

    const blocks = engine.resolveEntityActionBlocks(wizard);

    assert.equal(
      engine.findSpellCastBlock(blocks, {
        castingTimeUnit: 'action',
        level: 7,
      }),
      'Ячейки выше круга недоступны (6): Копьё Драконьей Чешуи',
    );

    assert.equal(
      engine.findSpellCastBlock(blocks, {
        castingTimeUnit: 'action',
        level: 3,
      }),
      null,
    );

    // Выбор круга сужается: огненный шар 3 круга — ячейками 3–6
    const fireball = { level: 3 };
    const slots = engine.getAvailableSpellLevels(wizard, 3);

    assert.deepEqual(slots, [3, 4, 5, 6, 7]);

    assert.deepEqual(
      engine.limitCastLevels(blocks, fireball, slots),
      [3, 4, 5, 6],
    );

    assert.deepEqual(
      engine.limitEntityCastLevels(wizard, fireball, slots),
      [3, 4, 5, 6],
    );

    // Заговоры и заклинания с зарядами (врождённые) ячеек не тратят
    assert.deepEqual(engine.limitCastLevels(blocks, { level: 0 }, [0]), [0]);

    const innate = {
      level: 7,
      uses: { current: 1, max: 1, recovery: 'longRest' },
    };

    assert.equal(
      engine.findSpellCastBlock(blocks, {
        castingTimeUnit: 'action',
        ...innate,
      }),
      null,
    );

    // Запрет — и на плату ячейкой («Божественная кара»)
    const plan = engine.planEffectPay(wizard, [
      { kind: 'spellSlot', minLevel: 5 },
    ]);

    assert.deepEqual(
      plan.prices[0].options.map((option) => option.amount),
      [5, 6],
    );

    // «Не ниже круга»: все доступные круги ниже — причина словами
    const low = createEffect('Тяжёлая магия', {
      castRule: { minSlotLevel: 4 },
    });

    const heavy = createActor({ activeEffects: [low] });
    const heavyBlocks = engine.resolveEntityActionBlocks(heavy);

    assert.deepEqual(
      engine.limitCastLevels(heavyBlocks, { level: 1 }, [1, 2, 3]),
      [],
    );

    assert.equal(
      engine.findCastLevelBlock(heavyBlocks, { level: 1 }, [1, 2, 3]),
      'Ячейки ниже круга недоступны (4): Тяжёлая магия',
    );

    assert.match(
      detailsOf(spear),
      /Колдовство носителя — ячейки не выше круга: 6/,
    );

    // Негодное число выбрасывается одно, пустое правило — целиком
    assert.equal(
      engine.ActiveEffectSchema.parse({
        ...spear,
        castRule: { maxSlotLevel: 12 },
      }).castRule,
      undefined,
    );
  });

  it('[AR08] Замедление: шанс 25 %, что заклинание с соматическим компонентом не удастся', () => {
    // «Если существо пытается наложить заклинание с соматическим компонентом,
    // есть вероятность 25%, что заклинание не удастся»; «только одну атаку,
    // если использует действие Атака»
    const slow = createEffect('Замедление', {
      effectTarget: 'target',
      flags: [
        'actions.noReaction',
        'actions.oneActionOrBonus',
        'actions.oneAttackPerAction',
      ],
      castRule: {
        failChance: 25,
        failComponent: 'somatic',
        failLosesSlot: true,
      },
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(slow, 'spell');

    const mage = createActor({ activeEffects: [slow] });

    const gesture = {
      components: { verbal: true, somatic: true, material: false },
    };

    const word = {
      components: { verbal: true, somatic: false, material: false },
    };

    const checks = engine.listCastFailureChecks(mage, gesture);

    assert.deepEqual(checks, [
      { sourceName: 'Замедление', chance: 25, losesSlot: true },
    ]);

    assert.deepEqual(
      engine.listCastFailureChecks(mage, word),
      [],
      'без соматического компонента шанса нет',
    );

    // к100: 25 и меньше — провал
    assert.deepEqual(
      engine.rollCastFailChance(25, () => 0.24),
      {
        roll: 25,
        failed: true,
      },
    );

    assert.deepEqual(
      engine.rollCastFailChance(25, () => 0.25),
      {
        roll: 26,
        failed: false,
      },
    );

    assert.equal(
      engine.formatCastFailureMessage(
        'Гримли',
        'Огненный шар',
        { check: checks[0], roll: 17 },
        true,
      ),
      'Гримли: заклинание «Огненный шар» не удалось — Замедление (к100: 17 при шансе провала 25 %). Действие и ячейка потрачены.',
    );

    assert.match(
      detailsOf(slow),
      /каст с соматическим компонентом проваливается с шансом 25 %; ячейка при провале тратится/,
    );

    // Отбор по компоненту без самого провала в данные не уходит
    assert.equal(
      engine.normalizeEffectDraft(
        { ...slow, castRule: { failComponent: 'somatic' } },
        engine.resolveEffectFormLayout('spell', slow),
      ).castRule,
      undefined,
    );
  });

  it('[AR09] Слово силы: Боль, Зона преследования: спасбросок при попытке каста', () => {
    // «Когда цель пытается наложить заклинание, она должна сначала преуспеть в
    // спасброске Телосложения, иначе заклинание рассеивается»
    const pain = createEffect('Слово силы: Боль', {
      effectTarget: 'target',
      castRule: {
        failSave: { ability: 'constitution', dc: engine.SOURCE_SAVE_DC },
      },
      duration: { type: 'special' },
    });

    authoredScenario(pain, 'spell');

    // Сл заклинателя проставляется при наложении
    const stamped = engine.stampSourceSaveDcs(pain, 19);

    assert.equal(stamped.castRule.failSave.dc, 19);

    const victim = createActor({ activeEffects: [stamped] });

    assert.deepEqual(engine.listCastFailureChecks(victim, {}), [
      {
        sourceName: 'Слово силы: Боль',
        save: { ability: 'constitution', dc: 19 },
        losesSlot: false,
      },
    ]);

    assert.equal(
      engine.formatCastFailureMessage(
        'Гримли',
        'Щит',
        { check: engine.listCastFailureChecks(victim, {})[0], saveTotal: 11 },
        false,
      ),
      'Гримли: заклинание «Щит» не удалось — Слово силы: Боль (спасбросок 11 против Сл 19). Действие потрачено, ячейка — нет.',
    );

    // Зона преследования: аура ревенанта — спасбросок у всякого, кто колдует
    // рядом. Эффект ауры приходит заклинателю списком аур на нём
    const zone = createEffect('Зона преследования', {
      aura: { radius: 5, target: 'all', applyToSelf: false },
      castRule: {
        failSave: { ability: 'constitution', dc: 17 },
        failLosesSlot: true,
      },
    });

    authoredScenario(zone, 'creatureTrait');

    const caster = createActor();

    assert.deepEqual(engine.listCastFailureChecks(caster, {}), []);

    assert.deepEqual(engine.listCastFailureChecks(caster, {}, [zone]), [
      {
        sourceName: 'Зона преследования',
        save: { ability: 'constitution', dc: 17 },
        losesSlot: true,
      },
    ]);

    assert.match(
      detailsOf(zone),
      /каст требует спасброска Телосложения Сл 17; ячейка при провале тратится/,
    );

    // Сл формулой живёт в том же обходе Сл, что и остальные спасброски
    assert.equal(
      engine.listEffectSaveDcs(zone).some((save) => save.dc === 17),
      true,
    );
  });
});
