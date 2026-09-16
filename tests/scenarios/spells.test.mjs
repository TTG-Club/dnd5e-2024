import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  BLESS,
  BLESS_CAST_ID,
  castEndingContext,
  CELL_SIZE,
  change,
  concentratingCaster,
  createActor,
  createCreature,
  createEffect,
  createSpellTemplate,
  createToken,
  createZone,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: заклинания (`docs/EFFECT_SCENARIOS.md`, раздел «Заклинания»).
 * Эффект собирается так, как его соберёт автор в окне заклинания, и проверяется
 * тем, что делает движок.
 */

/** Сл заклинателя */
const CASTER_DC = 15;

/** Контекст броска без преимущества и помехи */
const PLAIN_ROLL = { hasAdvantage: false, hasDisadvantage: false };

/**
 * Итоговые статы с эффектами.
 *
 * @param {object[]} effects - активные эффекты сущности
 * @param {object} overrides - поля сущности
 * @returns {object} статы
 */
function statsWith(effects, overrides = {}) {
  return engine.resolveActorStats(
    createActor({ activeEffects: effects, ...overrides }),
  );
}

/**
 * Сущность после наложения эффектов тем же путём, что каст.
 *
 * @param {object} entity - цель
 * @param {object[]} effects - эффекты заклинания
 * @returns {object} цель с эффектами
 */
function applied(entity, effects) {
  return {
    ...entity,
    activeEffects: engine.applyEffectsToEntity(entity, effects, 'spell'),
  };
}

describe('каталог: заклинания', () => {
  it('[S01] Благословение: к4 к атакам и спасброскам цели, 10 раундов', () => {
    const bless = createEffect('Благословение', {
      effectTarget: 'target',
      changes: [
        change('attack.melee', '1d4'),
        change('attack.ranged', '1d4'),
        change('attack.spell', '1d4'),
        change('save.wisdom', '1d4'),
      ],
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(bless, 'spell');

    const target = applied(createActor(), [bless]);
    const effects = engine.collectActiveEffects(target);

    assert.ok(
      engine
        .collectBonusRollFormulas(effects, 'attack.melee', PLAIN_ROLL)
        .includes('1d4'),
    );

    assert.ok(
      engine
        .collectBonusRollFormulas(effects, 'save.wisdom', PLAIN_ROLL)
        .includes('1d4'),
    );

    for (let round = 0; round < 10; round++) {
      engine.decrementActorEffectDurations(target);
    }

    assert.equal(target.activeEffects.length, 0, 'спадает через 10 раундов');
  });

  it('[S02] Щит: +5 КД заклинателю до начала его следующего хода', () => {
    const caster = createActor();

    const shield = engine.stampTurnDuration(
      createEffect('Щит', {
        changes: [change('armorClass', '5')],
        duration: { type: 'turn', turnAnchor: 'source', turnTiming: 'start' },
      }),
      { carrierId: caster.id, sourceId: caster.id, activeTurnActorId: 'enemy' },
    );

    authoredScenario({ ...shield, sourceActorId: undefined }, 'spell');

    caster.activeEffects = [shield];

    assert.equal(engine.resolveActorStats(caster).armorClass, 15);

    engine.expireTurnEffects(caster, caster.id, 'start', new Set([caster.id]));
    assert.equal(caster.activeEffects.length, 0);
  });

  it('[S03] Доспехи мага: КД 13 + Ловкость без доспеха', () => {
    const mageArmor = createEffect('Доспехи мага', {
      effectTarget: 'target',
      changes: [
        change('armorClass', '13 + @mod.dex', {
          mode: 'override',
          condition: 'self.armor === "none"',
        }),
      ],
      duration: { type: 'hours', value: 8 },
    });

    authoredScenario(mageArmor, 'spell');

    const dexterous = {
      ...structuredClone(engine.DEFAULT_ACTOR.system),
      abilities: { ...engine.DEFAULT_ACTOR.system.abilities, dexterity: 18 },
    };

    assert.equal(statsWith([mageArmor], { system: dexterous }).armorClass, 17);

    const armored = statsWith([mageArmor], {
      system: dexterous,
      equipment: [
        {
          id: 'chain',
          name: 'Кольчуга',
          type: 'equipment',
          equipped: true,
          equipmentCategory: 'heavy',
          baseArmorAC: 16,
        },
      ],
    });

    assert.notEqual(armored.armorClass, 17, 'в доспехе условие не выполняется');
  });

  it('[S04] Удержание личности: «Парализованный» при провале спасброска заклинания, повторный спасбросок Сл 0', () => {
    const condition = engine.buildConditionActiveEffect('paralyzed');

    const holdPerson = engine.applyConditionPresetToEffect(
      createEffect('Удержание', {
        effectTarget: 'target',
        recurringSave: { ability: 'wisdom', dc: 0, timing: 'endOfTurn' },
        duration: { type: 'rounds', value: 10 },
      }),
      condition,
    );

    assert.equal(
      authoredScenario(holdPerson, 'spell'),
      'Когда заклинание задело цель: «Парализованный», повторный спасбросок Мудрости '
        + 'Сл заклинателя в конце хода снимает эффект, на 10 раундов.',
    );

    assert.deepEqual(
      engine.resolveEffectApplication(holdPerson, { landed: false }),
      {
        applyEffect: false,
        damageMultiplier: 0,
      },
    );

    const stamped = engine.stampSourceTurnSaveDc(holdPerson, CASTER_DC);
    const target = applied(createActor(), [stamped]);

    assert.ok(
      engine
        .resolveActorStats(target)
        .activeFlags.has('save.autoFail.dexterity'),
    );

    const result = withRandom([MAX_ROLL], () =>
      engine.processTurnEffects(target, 'endOfTurn'),
    );

    assert.equal(result.saveOutcomes[0].dc, CASTER_DC);
    assert.equal(target.activeEffects.length, 0, 'успех снимает');
  });

  it('[S05] Огонь фей [≈]: атаки по цели с преимуществом', () => {
    const faerieFire = createEffect('Огонь фей', {
      effectTarget: 'target',
      flags: ['attacksAgainst.advantage'],
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(faerieFire, 'spell');

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType: 'melee',
        targetFlags: statsWith([faerieFire]).activeFlags,
      }),
      'advantage',
    );
  });

  it('[S06] Замедление [≈]: скорость вдвое, −2 КД и спасброски Ловкости', () => {
    const slow = createEffect('Замедление', {
      effectTarget: 'target',
      changes: [
        change('movement.walk', '0.5', { mode: 'multiply' }),
        change('armorClass', '-2'),
        change('save.dexterity', '-2'),
      ],
      recurringSave: { ability: 'wisdom', dc: 0, timing: 'endOfTurn' },
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(slow, 'spell');

    const stats = statsWith([slow]);

    assert.equal(stats.movement.walk, 15);
    assert.equal(stats.armorClass, 8);
    assert.equal(stats.saves.dexterity, -2);
  });

  it('[S07] Слепота: ослеплённый атакует с помехой, по нему — с преимуществом', () => {
    const blinded = engine.applyConditionPresetToEffect(
      createEffect('Слепота', { effectTarget: 'target' }),
      engine.buildConditionActiveEffect('blinded'),
    );

    authoredScenario(blinded, 'spell');

    const flags = statsWith([blinded]).activeFlags;

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: flags,
        attackType: 'melee',
      }),
      'disadvantage',
    );

    assert.equal(
      engine.resolveAttackRollMode({
        attackerFlags: new Set(),
        attackType: 'melee',
        targetFlags: flags,
      }),
      'advantage',
    );
  });

  it('[S08] Защита от энергии: сопротивление огню', () => {
    const protection = createEffect('Защита от огня', {
      effectTarget: 'target',
      flags: ['resistance.fire'],
      duration: { type: 'hours', value: 1 },
    });

    authoredScenario(protection, 'spell');

    const target = applied(withHp(createActor, 30), [protection]);

    engine.applyTargetDamage(target, 20, false, 'fire');
    assert.equal(engine.resolveEntityCurrentHp(target), 20);
  });

  it('[S09] Героизм: иммунитет к Испугу и временные хиты каждый ход', () => {
    const heroism = createEffect('Героизм', {
      effectTarget: 'target',
      conditionImmunities: ['frightened'],
      recurringDamage: {
        damageParts: [{ formula: '@mod.spell@heal.temp' }],
        timing: 'startOfTurn',
      },
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(heroism, 'spell');

    const bound = engine.bindSourceEffectFormulas(heroism, {
      ...engine.buildFormulaContext(createActor()),
      spellMod: 4,
    });

    const target = applied(createActor(), [bound]);

    engine.processTurnEffects(target, 'startOfTurn');
    assert.equal(engine.resolveEntityTempHp(target), 4);

    const frightened = engine.buildConditionActiveEffect('frightened');

    assert.equal(
      engine
        .applyEffectsToEntity(target, [frightened], 'spell')
        .some((effect) => effect.conditionKey === 'frightened'),
      false,
    );
  });

  it('[S10] Метка охотника: +1к6 урона только по своей помеченной цели', () => {
    const hunterId = 'actor_ranger';

    const mark = createEffect('Метка охотника', {
      effectTarget: 'target',
      flags: ['mark.bySource'],
      duration: { type: 'hours', value: 1 },
    });

    const bonus = createEffect('Метка охотника: урон', {
      changes: [
        change('damage.melee', '1d6', { condition: 'target.markedBySelf' }),
      ],
      duration: { type: 'hours', value: 1 },
    });

    authoredScenario(mark, 'spell');
    authoredScenario(bonus, 'spell');

    const prey = {
      ...createCreature(),
      activeEffects: [{ ...mark, sourceActorId: hunterId }],
    };

    const markedBy = engine.listEntityMarkSources(prey);
    const self = { entityId: hunterId };

    const onMarked = engine.collectBonusDamageFormulas(
      [bonus],
      'damage.melee',
      {
        ...PLAIN_ROLL,
        target: { currentHp: 10, maxHp: 10, markedBy },
        self,
      },
    );

    const onOther = engine.collectBonusDamageFormulas([bonus], 'damage.melee', {
      ...PLAIN_ROLL,
      target: { currentHp: 10, maxHp: 10, markedBy: [] },
      self,
    });

    assert.deepEqual(
      onMarked.map((formula) => formula.formula),
      ['1d6'],
    );

    assert.deepEqual(onOther, []);
  });

  it('[S11] Сглаз [≈]: помеха на проверки выбранной характеристики у цели', () => {
    const hex = createEffect('Сглаз', {
      effectTarget: 'target',
      flags: ['mark.bySource', 'abilityCheck.disadvantage.strength'],
      duration: { type: 'hours', value: 1 },
    });

    authoredScenario(hex, 'spell');

    assert.equal(
      engine.resolveAbilityCheckRollMode({
        flags: statsWith([hex]).activeFlags,
        ability: 'strength',
      }),
      'disadvantage',
    );
  });

  it('[S12] Щит веры: +2 КД на 10 минут — в бою тикает раундами', () => {
    const shieldOfFaith = createEffect('Щит веры', {
      effectTarget: 'target',
      changes: [change('armorClass', '2')],
      duration: { type: 'minutes', value: 10 },
    });

    authoredScenario(shieldOfFaith, 'spell');

    const target = applied(createActor(), [shieldOfFaith]);

    assert.equal(target.activeEffects[0].duration.remaining, 100);
    assert.equal(engine.resolveActorStats(target).armorClass, 12);

    engine.decrementActorEffectDurations(target);
    assert.equal(target.activeEffects[0].duration.remaining, 99);
  });

  it('[S13] Духовные стражи: врагам в эманации скорость вдвое и урон в конце их хода со спасбросоком', () => {
    const cleric = createActor({
      id: 'actor_cleric',
      token: { disposition: 'friendly' },
      activeEffects: [
        engine.stampSourceSaveDcs(
          createEffect('Духовные стражи', {
            origin: 'spell',
            aura: {
              radius: 15,
              target: 'enemies',
              applyToSelf: false,
              visible: true,
            },
            changes: [change('movement.walk', '0.5', { mode: 'multiply' })],
            recurringDamage: {
              damageParts: [{ formula: '3d8@dmg.radiant' }],
              timing: 'endOfTurn',
              save: { ability: 'wisdom', dc: 0, onSuccess: 'half' },
            },
          }),
          CASTER_DC,
        ),
      ],
    });

    authoredScenario({ ...cleric.activeEffects[0], origin: 'manual' }, 'spell');

    const enemy = createCreature({ id: 'creature_orc' });
    const enemyToken = createToken(enemy.id, 1, 0, { disposition: 'hostile' });

    const clericToken = createToken(cleric.id, 0, 0, {
      disposition: 'friendly',
    });

    const ambient = engine.calculateAmbientAuras(
      enemyToken,
      [{ token: clericToken, effects: engine.collectAllAuraEffects(cleric) }],
      GRID,
    );

    assert.equal(ambient.length, 1);
    assert.equal(engine.resolveActorStats(enemy, ambient).movement.walk, 15);

    const hpBefore = engine.resolveEntityCurrentHp(enemy);

    const result = withRandom([MIN_ROLL, MIN_ROLL, MAX_ROLL], () =>
      engine.processTurnEffects(enemy, 'endOfTurn', {
        ambientEffects: ambient,
      }),
    );

    assert.equal(result.saveOutcomes[0].dc, CASTER_DC);
    assert.ok(engine.resolveEntityCurrentHp(enemy) < hpBefore, 'урон нанесён');

    // Сам жрец в своей ауре не горит
    const selfResult = engine.processTurnEffects(cleric, 'endOfTurn');

    assert.equal(selfResult.damageOutcomes.length, 0);
  });

  it('[S14] Паутина: труднопроходимая зона, вход — спасбросок Ловкости или «Опутанный»', () => {
    const web = [
      createEffect('Паутина', {
        effectTarget: 'zone',
        changes: [change('terrain.movementCost', '2', { mode: 'override' })],
      }),
      engine.applyConditionPresetToEffect(
        createEffect('Паутина: опутывание', {
          effectTarget: 'zone',
          areaTrigger: 'enter',
          applySave: { ability: 'dexterity', dc: 0, onSuccess: 'negate' },
          duration: { type: 'rounds', value: 10 },
        }),
        engine.buildConditionActiveEffect('restrained'),
      ),
    ];

    for (const effect of web) {
      authoredScenario(effect, 'spell');
    }

    const zone = createZone(
      'ca_web',
      web.map((effect) => engine.stampSourceSaveDcs(effect, CASTER_DC)),
    );

    assert.equal(engine.resolveAreaTerrainCost(zone), 2);

    const orc = createCreature({ id: 'creature_orc' });

    withRandom([MIN_ROLL], () =>
      engine.syncActorAreaEffects(orc, new Set(), new Set([zone.id]), [zone]),
    );

    assert.ok(
      orc.activeEffects.some((effect) => effect.conditionKey === 'restrained'),
    );

    assert.equal(
      engine.resolveTotalMovementSpeed(engine.resolveActorStats(orc)),
      0,
    );
  });

  it('[S15] Лунный луч: зона на месте шаблона и урон с Сл заклинателя (подробно — spellZones)', () => {
    const moonbeam = createEffect('Лунный луч', {
      effectTarget: 'zone',
      recurringDamage: {
        damageParts: [{ formula: '2d10@dmg.radiant' }],
        timing: 'endOfTurn',
        save: { ability: 'constitution', dc: 0, onSuccess: 'half' },
      },
    });

    authoredScenario(moonbeam, 'spell');

    const draft = engine.buildSpellZoneDraft({
      spell: {
        name: 'Лунный луч',
        activeEffects: [moonbeam],
        durationUnit: 'minute',
        durationValue: 1,
        concentration: true,
      },
      template: createSpellTemplate('cylinder', 1),
      casterId: 'actor_druid',
      saveDc: CASTER_DC,
      formulaContext: engine.buildFormulaContext(createActor()),
      gridSize: CELL_SIZE,
    });

    assert.equal(draft.rounds, 10);
    assert.equal(draft.effects[0].recurringDamage.save.dc, CASTER_DC);
  });

  it('[S16] Облако кинжалов: урон в начале хода стоящим в зоне', () => {
    const daggers = createEffect('Облако кинжалов', {
      effectTarget: 'zone',
      recurringDamage: {
        damageParts: [{ formula: '4d4@dmg.slashing' }],
        timing: 'startOfTurn',
      },
    });

    authoredScenario(daggers, 'spell');

    const zone = createZone('ca_daggers', [daggers]);
    const orc = createCreature({ id: 'creature_orc' });

    engine.syncActorAreaEffects(orc, new Set(), new Set([zone.id]), [zone], {
      triggerOneShots: false,
    });

    const hpBefore = engine.resolveEntityCurrentHp(orc);

    withRandom([MAX_ROLL], () => engine.processTurnEffects(orc, 'startOfTurn'));

    assert.equal(
      engine.resolveEntityCurrentHp(orc),
      Math.max(0, hpBefore - 16),
    );
  });

  it('[S17] Туманное облако [≈]: стоящие в зоне слепы (стена зрения для зоны игрока — пробел)', () => {
    const fog = createEffect('Туманное облако', {
      effectTarget: 'zone',
      flags: ['vision.blinded'],
    });

    authoredScenario(fog, 'spell');

    const zone = createZone('ca_fog', [fog]);
    const orc = createCreature({ id: 'creature_orc' });

    engine.syncActorAreaEffects(orc, new Set(), new Set([zone.id]), [zone], {
      triggerOneShots: false,
    });

    assert.ok(engine.resolveActorStats(orc).activeFlags.has('vision.blinded'));
  });

  it('[S18] Шипастая поросль [≈]: труднопроходимая зона', () => {
    const spikes = createEffect('Шипастая поросль', {
      effectTarget: 'zone',
      changes: [change('terrain.movementCost', '2', { mode: 'override' })],
    });

    authoredScenario(spikes, 'spell');

    assert.equal(
      engine.resolveAreaTerrainCost(createZone('ca_spikes', [spikes])),
      2,
    );
  });

  it.todo(
    '[S18b] Шипастая поросль: урон за каждые 5 фт пути в зоне — пробел модели',
  );

  it('[S19] Потеря концентрации от урона снимает эффекты каста со всех целей', () => {
    const system = new engine.Dnd5eVttSystem();
    const caster = concentratingCaster(40);

    const bless = (sourceActorId) =>
      createEffect(BLESS.name, { castId: BLESS_CAST_ID, sourceActorId });

    const allies = [
      createActor({ id: 'actor_fighter', activeEffects: [bless(caster.id)] }),
      createActor({ id: 'actor_rogue', activeEffects: [bless(caster.id)] }),
      createActor({ id: 'actor_bard', activeEffects: [bless('actor_other')] }),
    ];

    const { context, ended } = castEndingContext();

    withRandom([MIN_ROLL], () =>
      strikeEntity(system, caster, 10, 'slashing', { context }),
    );

    assert.deepEqual(ended, [[caster.id, [BLESS_CAST_ID]]]);

    // Ядро заканчивает каст по всем существам мира
    for (const [casterId, castIds] of ended) {
      for (const entity of [caster, ...allies]) {
        system.removeCastEffects(entity, casterId, new Set(castIds));
      }
    }

    assert.deepEqual(
      allies.map((ally) => ally.activeEffects.length),
      [0, 0, 1],
      'чужой каст с тем же id не снимается',
    );
  });

  it('[S20] Жезл паутины: своя Сл заклинания 15 — у спасброска и у зоны, от персонажа не зависит', () => {
    const entangle = engine.applyConditionPresetToEffect(
      createEffect('Паутина: опутывание', {
        effectTarget: 'zone',
        areaTrigger: 'enter',
        applySave: { ability: 'dexterity', dc: 0, onSuccess: 'negate' },
        duration: { type: 'rounds', value: 10 },
      }),
      engine.buildConditionActiveEffect('restrained'),
    );

    const wandSpell = {
      name: 'Паутина',
      saveDC: 15,
      activeEffects: [entangle],
      durationUnit: 'hour',
      durationValue: 1,
      concentration: true,
    };

    // Сильный и слабый заклинатель творят из жезла с одной Сл
    for (const wisdom of [8, 20]) {
      const caster = createActor({
        system: {
          ...structuredClone(engine.DEFAULT_ACTOR.system),
          abilities: { ...engine.DEFAULT_ACTOR.system.abilities, wisdom },
          classes: [
            { classKey: 'druid', level: 9, spellcastingAbility: 'wisdom' },
          ],
        },
      });

      const saveDc = engine.resolveSpellSaveDC(
        caster,
        wandSpell,
        engine.resolveActorStats(caster),
      );

      const draft = engine.buildSpellZoneDraft({
        spell: wandSpell,
        template: createSpellTemplate('circle', 2),
        casterId: caster.id,
        saveDc,
        formulaContext: engine.buildFormulaContext(caster),
        gridSize: CELL_SIZE,
      });

      assert.equal(saveDc, 15);
      assert.equal(draft.effects[0].applySave.dc, 15);
    }
  });
});

describe('каталог: проверки, концентрация и магия', () => {
  it('[S21] Синаптический разряд: −1к4 к проверкам и спасброскам концентрации', () => {
    const muddled = createEffect('Синаптический разряд', {
      effectTarget: 'target',
      changes: [
        change('attack.melee', '-1d4'),
        change('abilityCheck', '-1d4'),
        change('save.concentration', '-1d4'),
        change('save.concentration', '-1'),
      ],
      duration: { type: 'rounds', value: 10 },
    });

    authoredScenario(muddled, 'spell');

    const victim = createActor({ activeEffects: [muddled] });
    const stats = engine.resolveActorStats(victim);
    const roll = { hasAdvantage: false, hasDisadvantage: false };

    assert.deepEqual(
      engine.collectBonusRollFormulas([muddled], 'abilityCheck', roll),
      ['-1d4'],
    );

    const concentration = { againstConcentration: true };

    assert.deepEqual(
      engine
        .listSavingThrowBonusKeys('constitution', concentration)
        .flatMap((key) =>
          engine.collectBonusRollFormulas([muddled], key, roll),
        ),
      ['-1d4'],
    );

    assert.deepEqual(
      engine
        .listSavingThrowBonusKeys('constitution')
        .flatMap((key) =>
          engine.collectBonusRollFormulas([muddled], key, roll),
        ),
      [],
    );

    assert.equal(
      engine.resolveSavingThrowModifier(stats, 'constitution', concentration)
        - engine.resolveSavingThrowModifier(stats, 'constitution'),
      -1,
    );
  });

  it('[S22] Круг силы: успешный спасбросок против магии — без урона', () => {
    const circle = createEffect('Круг силы', {
      aura: { radius: 30, target: 'allies', applyToSelf: true, visible: true },
      flags: ['save.advantage.vsMagic', 'save.negateOnSuccess.vsMagic'],
      duration: { type: 'minutes', value: 10 },
    });

    authoredScenario(circle, 'spell');

    const flags = engine.resolveActorStats(
      createActor({ activeEffects: [circle] }),
    ).activeFlags;

    const scale = (againstMagic, passed) =>
      engine.resolveSaveEffectScale('half', passed, {
        flags,
        ability: 'dexterity',
        againstMagic,
      });

    assert.equal(scale(true, true), 0);
    assert.equal(scale(true, false), 1);
    assert.equal(scale(false, true), 0.5);
  });
});

describe('каталог: срабатывания заклинаний', () => {
  it('[S23] Слово силы: оглушение — только если хитов не больше 150', () => {
    const stun = createEffect('Слово силы: оглушение', {
      effectTarget: 'target',
      triggers: [
        {
          id: 'trigger_stun',
          event: 'applied',
          condition: 'self.hp.value <= 150',
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'stunned',
              recurringSave: {
                ability: 'constitution',
                dc: 0,
                timing: 'endOfTurn',
              },
            },
          ],
        },
        {
          id: 'trigger_done',
          event: 'applied',
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    authoredScenario(stun, 'spell');

    const system = new engine.Dnd5eVttSystem();

    const stunnedAt = (hitPoints) => {
      const target = withHp(createCreature, hitPoints);
      const landing = structuredClone(target);

      landing.activeEffects = [engine.stampSourceTurnSaveDc(stun, 17)];
      system.settleCombatState(target, engine.pickCombatState(landing));

      return target.activeEffects.map((effect) => effect.conditionKey);
    };

    assert.deepEqual(stunnedAt(120), ['stunned']);
    assert.deepEqual(stunnedAt(200), []);
  });

  it('[S24] Жуткий смех Таши: спасбросок от урона — с преимуществом', () => {
    const laughter = createEffect('Жуткий смех Таши', {
      effectTarget: 'target',
      conditionKey: 'incapacitated',
      flags: ['incapacitated'],
      duration: { type: 'rounds', value: 10 },
      recurringSave: { ability: 'wisdom', dc: 0, timing: 'endOfTurn' },
      triggers: [
        {
          id: 'trigger_hurt',
          event: 'damageTaken',
          save: { ability: 'wisdom', dc: 0, mode: 'advantage' },
          actions: [{ type: 'removeSelf', on: 'saved' }],
        },
      ],
    });

    authoredScenario(laughter, 'spell');

    const saveSpec = engine.buildTriggerSaveSpec(
      laughter,
      laughter.triggers[0],
    );

    assert.equal(saveSpec.mode, 'advantage');

    assert.equal(
      saveSpec.againstSpell,
      false,
      'эффект ещё не наложен заклинанием',
    );

    assert.equal(
      engine.resolveSavingThrowRollMode({
        flags: new Set(),
        ability: 'wisdom',
        mode: saveSpec.mode,
      }),
      'advantage',
    );

    assert.match(
      engine.describeEffectTrigger(laughter.triggers[0], {
        formatDc: () => 'Сл заклинателя',
      }),
      /спасбросок Мудрости с преимуществом/,
    );
  });

  it('[S25] Ускорение: вялость после конца заклинания', () => {
    const haste = createEffect('Ускорение', {
      effectTarget: 'target',
      castId: BLESS_CAST_ID,
      sourceActorId: 'actor_wizard',
      changes: [change('armorClass', '2')],
      duration: { type: 'rounds', value: 10 },
      triggers: [
        {
          id: 'trigger_lethargy',
          event: 'castEnd',
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'incapacitated',
              duration: { type: 'rounds', value: 1 },
            },
          ],
        },
      ],
    });

    authoredScenario(haste, 'spell');

    const system = new engine.Dnd5eVttSystem();
    const hero = createActor({ activeEffects: [haste] });

    const result = system.removeCastEffects(
      hero,
      'actor_wizard',
      new Set([BLESS_CAST_ID]),
    );

    assert.equal(result.changed, true);

    assert.deepEqual(
      hero.activeEffects.map((effect) => [effect.conditionKey, effect.castId]),
      [['incapacitated', undefined]],
      'вялость не уходит вместе с кастом',
    );
  });

  it('[S26] Окаменение: три провала — окаменение, счётчик отметок', () => {
    const failures = 'petrifyFail';

    const petrify = createEffect('Окаменение', {
      effectTarget: 'target',
      conditionKey: 'restrained',
      triggers: [
        {
          id: 'trigger_count',
          event: 'turnEnd',
          save: { ability: 'constitution', dc: 0 },
          actions: [
            {
              type: 'applyTag',
              tag: failures,
              stack: true,
              duration: { type: 'permanent' },
              on: 'failed',
            },
          ],
        },
        {
          id: 'trigger_stone',
          event: 'turnEnd',
          condition: `self.tagCount["${failures}"] >= 3`,
          actions: [
            { type: 'applyCondition', conditionKey: 'petrified' },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    authoredScenario(petrify, 'spell');

    const target = createCreature({
      activeEffects: [engine.stampSourceTurnSaveDc(petrify, 15)],
    });

    const failTurn = () =>
      withRandom([MIN_ROLL], () =>
        engine.processTurnEffects(target, 'endOfTurn'),
      );

    failTurn();
    failTurn();

    assert.equal(engine.countEffectTag(target, failures), 2);

    assert.ok(
      !target.activeEffects.some(
        (effect) => effect.conditionKey === 'petrified',
      ),
    );

    failTurn();

    assert.ok(
      target.activeEffects.some(
        (effect) => effect.conditionKey === 'petrified',
      ),
      'третий провал — окаменение',
    );
  });
});

describe('каталог: варианты заклинаний', () => {
  it('[S27] Глухота/слепота: ложится один выбранный вариант', () => {
    const blinded = createEffect('Слепота', {
      effectTarget: 'target',
      conditionKey: 'blinded',
      variant: { group: 'чувство', label: 'Слепота' },
    });

    const deafened = createEffect('Глухота', {
      effectTarget: 'target',
      conditionKey: 'deafened',
      variant: { group: 'чувство', label: 'Глухота' },
    });

    authoredScenario(blinded, 'spell');

    assert.match(
      engine.describeEffectScenario(blinded, 'spell'),
      /^Вариант «Слепота»\. /,
    );

    const effects = [blinded, deafened, createEffect('Без варианта')];

    assert.deepEqual(
      engine
        .pickEffectVariants(effects, { чувство: 'Глухота' })
        .map((effect) => effect.name),
      ['Глухота', 'Без варианта'],
    );

    assert.deepEqual(
      engine.pickEffectVariants(effects, {}).map((effect) => effect.name),
      ['Без варианта'],
      'без выбора группа не ложится вовсе',
    );
  });
});

describe('каталог: условия атаки по носителю', () => {
  it('[S28] Защита от добра и зла: помеха атакам исчадий и нежити', () => {
    const ward = createEffect('Защита от добра и зла', {
      effectTarget: 'target',
      flags: ['attacksAgainst.disadvantage'],
      rollCondition: 'incoming.attackerCreatureType === "fiend"',
    });

    authoredScenario(ward, 'spell');

    const warded = createActor({ activeEffects: [ward] });

    assert.equal(
      engine
        .resolveActorStats(warded)
        .activeFlags.has('attacksAgainst.disadvantage'),
      false,
      'помеха не всем атакующим',
    );

    const modeOf = (attackerCreatureType) =>
      engine.resolveAttackRollMode({
        attackType: 'melee',
        attackerFlags: new Set(),
        targetFlags: new Set(
          engine.collectIncomingAttackFlags([ward], {
            attackType: 'melee',
            attackerCreatureType,
          }),
        ),
      });

    assert.equal(modeOf('fiend'), 'disadvantage');
    assert.equal(modeOf('humanoid'), 'normal');
  });

  it('[S29] Защита от клинков: атакующий вычитает 1к4', () => {
    const bladeWard = createEffect('Защита от клинков', {
      changes: [change('attacksAgainst', '-1d4')],
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(bladeWard, 'spell');

    const caster = createActor({ activeEffects: [bladeWard] });
    const bare = createActor();

    assert.deepEqual(
      engine.resolveActorStats(caster).armorClass,
      engine.resolveActorStats(bare).armorClass,
      'числа листа не меняются',
    );

    assert.deepEqual(
      engine.collectIncomingAttackRollFormulas([bladeWard], {
        attackType: 'ranged',
      }),
      ['-1d4'],
    );

    const rangedOnly = createEffect('Только от стрел', {
      changes: [
        change('attacksAgainst', '-2', {
          condition: 'incoming.attackType === "ranged"',
        }),
      ],
    });

    assert.deepEqual(
      engine.collectIncomingAttackRollFormulas([rangedOnly], {
        attackType: 'melee',
      }),
      [],
    );

    assert.deepEqual(
      engine.collectIncomingAttackRollFormulas([rangedOnly], {
        attackType: 'ranged',
      }),
      ['-2'],
    );
  });
});
