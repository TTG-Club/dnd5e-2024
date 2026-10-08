import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  strikeEntity,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: мелочи этапа 2A — токены, ключи, условия
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Мелочи: токены, ключи, условия»).
 * Тексты правил — из сверки мест этапа 2A (`wave2-plan/stage2A/places.json`).
 */

/** Кто наложил эффект */
const SOURCE_ID = 'actor_source';

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
 * Отметка на сущности.
 *
 * @param {string} tag - ключ отметки
 * @param {object} overrides - ступени, наложивший
 * @returns {object} эффект-отметка
 */
function tagEffect(tag, overrides = {}) {
  return createEffect(`tag_${tag}_${overrides.sourceActorId ?? ''}`, {
    name: tag,
    tag,
    origin: 'condition',
    ...overrides,
  });
}

describe('каталог: мелочи этапа 2A', () => {
  it('[MX01] Психические заклинания: тип урона заклинания на выбор при касте', () => {
    // «Когда вы накладываете заклинание колдуна, наносящее урон, вы можете
    // изменить тип урона на психическую энергию»
    const psychicSpells = createEffect('Психические заклинания', {
      changes: [change('spell.damageType', 'psychic', { mode: 'override' })],
    });

    authoredScenario(psychicSpells, 'feature');
    assert.match(detailsOf(psychicSpells), /Психическ/);

    const warlock = createActor({ activeEffects: [psychicSpells] });

    const fireball = {
      id: 'spell_fireball',
      name: 'Огненный шар',
      damageParts: [{ formula: '8к6', type: 'fire' }],
      activeEffects: [
        createEffect('Ожог', {
          effectTarget: 'target',
          recurringDamage: {
            timing: 'startOfTurn',
            damageParts: [{ formula: '1к6@dmg.fire' }],
          },
        }),
      ],
    };

    const retyped = engine.retypeCasterSpellDamage(fireball, warlock);

    assert.equal(
      retyped.damageParts[0].formula,
      '8к6@dmg.choice(fire,psychic)',
      'тип части стал выбором: свой первым',
    );

    assert.equal(
      retyped.activeEffects[0].recurringDamage.damageParts[0].formula,
      '1к6@dmg.choice(fire,psychic)',
      'урон эффектов заклинания меняется тем же выбором',
    );

    const choices = engine.listSourceDamageTypeChoices(retyped);

    assert.deepEqual(
      choices.map((choice) => choice.options),
      [['fire', 'psychic']],
      'один вопрос на всё заклинание',
    );

    const picked = engine.applySourceDamageTypeChoices(
      retyped,
      new Map([[engine.damageTypeChoiceKey(choices[0]), 'psychic']]),
    );

    assert.equal(picked.damageParts[0].formula, '8к6@dmg.psychic');

    // Слагаемые с числом и лечение: тип берут все слагаемые урона
    assert.equal(
      engine.addDamageTypeAlternatives('1к10 + 3', 'fire', ['necrotic']),
      '1к10@dmg.choice(fire,necrotic) + 3@dmg.choice(fire,necrotic)',
    );

    assert.equal(
      engine.addDamageTypeAlternatives('2к8@heal', undefined, ['necrotic']),
      '2к8@heal',
      'лечение не трогается',
    );

    // Без такого эффекта заклинание остаётся собой
    assert.equal(
      engine.retypeCasterSpellDamage(fireball, createActor()),
      fireball,
    );
  });

  it('[MX02] Перенаправление энергии: урон того же типа, что получен', () => {
    // «Когда вы получаете урон одного из выбранных типов, реакцией направить
    // урон того же типа… 2к12 + мод. Тел»
    const redirect = createEffect('Перенаправление энергии', {
      triggers: [
        {
          id: 'trigger_redirect',
          event: 'damageTaken',
          recipient: 'other',
          actions: [{ type: 'damage', parts: [{ formula: '2к12@dmg.event' }] }],
        },
      ],
    });

    authoredScenario(redirect, 'feature');

    const system = new engine.Dnd5eVttSystem();
    const hero = withHp(createActor, 40, { activeEffects: [redirect] });

    // Ледяной маг невосприимчив к холоду: по нему и видно тип ответа
    const mage = withHp(createCreature, 60, {
      id: SOURCE_ID,
      activeEffects: [createEffect('Лёд', { flags: ['immunity.cold'] })],
    });

    /**
     * Удар мага по герою уроном типа.
     *
     * @param {string} damageType - тип урона удара
     */
    const strikeWith = (damageType) => {
      withRandom([MAX_ROLL, MAX_ROLL], () =>
        strikeEntity(system, hero, 6, damageType, {
          details: { critical: false, sourceId: SOURCE_ID },
          context: {
            getEntity: (id) => (id === SOURCE_ID ? mage : undefined),
          },
        }),
      );
    };

    strikeWith('cold');

    assert.equal(
      engine.resolveEntityCurrentHp(mage),
      60,
      'ответ холодом — иммунитет мага его гасит',
    );

    strikeWith('fire');

    assert.equal(
      engine.resolveEntityCurrentHp(mage),
      36,
      'ответ огнём — 2к12 на максимум',
    );
  });

  it('[MX03] Психическое сокрушение: кость за каждую отметку на цели', () => {
    // «Каждый раз, когда вы попадаете безоружным ударом, оно получает Точку
    // давления… 1к8 урона силовым полем за каждую Точку»
    const victim = withHp(createCreature, 60, {
      activeEffects: [tagEffect('pressure', { tagStacks: 3 })],
    });

    assert.equal(
      engine.evaluateFormula(
        '@tag.pressure',
        engine.buildFormulaContext(victim),
      ),
      3,
    );

    assert.equal(
      engine.evaluateFormula('@tag.other', engine.buildFormulaContext(victim)),
      0,
      'отметки нет — ноль, а не ошибка',
    );

    const rolled = withRandom([MAX_ROLL, MAX_ROLL, MAX_ROLL], () =>
      engine.rollEffectDamageParts(
        [{ formula: '(@tag.pressure)к8', type: 'force' }],
        engine.resolveActorStats(victim),
        victim,
      ),
    );

    assert.equal(rolled.total, 24, 'три кости к8 — по числу Точек на цели');
  });

  it('[MX04] Живая каменная кожа: половина оставшихся Костей хитов', () => {
    // «…отдать доспехам половину оставшихся Костей хитов (вверх)»
    const fighter = createActor();

    fighter.system.classes = [
      { ...fighter.system.classes?.[0], level: 7, hitDiceUsed: 2 },
    ];

    assert.equal(
      engine.evaluateFormula(
        'ceil(@hitDice.left / 2)',
        engine.buildFormulaContext(fighter),
      ),
      3,
    );
  });

  it('[MX05] Кровная связь: урон, равный оставшимся временным хитам', () => {
    // «…теряет оставшиеся временные хиты и получает столько же
    // некротического урона»
    const bonded = withHp(createActor, 30);

    bonded.system.hitPoints = { ...bonded.system.hitPoints, temp: 7 };

    // Урон сперва съедает временные хиты, поэтому «потерять их и получить
    // столько же» — это удвоенное число
    const rolled = engine.rollEffectDamageParts(
      [{ formula: '@hp.temp * 2', type: 'necrotic' }],
      engine.resolveActorStats(bonded),
      bonded,
    );

    assert.equal(rolled.total, 14);
  });

  it('[MX06] Аберрантный всплеск: развилка по чётности выпавшего', () => {
    // «Чётное — временные хиты, равные значению. Нечётное — существо в 30 фт
    // получает столько же урона силовым полем»
    const context = engine.buildFormulaContext(createActor());

    assert.equal(engine.evaluateFormula('6 * even(6)', context), 6);
    assert.equal(engine.evaluateFormula('6 * odd(6)', context), 0);
    assert.equal(engine.evaluateFormula('5 * even(5)', context), 0);
    assert.equal(engine.evaluateFormula('5 * odd(5)', context), 5);
  });

  it('[MX07] Увядающая кара: сняты только сопротивления', () => {
    // «Существо теряет все сопротивления урону до начала вашего следующего
    // хода»
    const wilting = createEffect('Увядание', {
      effectTarget: 'target',
      flags: ['defense.suppressResistances'],
    });

    authoredScenario(wilting, 'spell');

    const resistant = createEffect('Стойкость', {
      flags: ['resistance.fire', 'immunity.poison'],
    });

    const plain = withHp(createCreature, 40, { activeEffects: [resistant] });

    const wilted = withHp(createCreature, 40, {
      activeEffects: [resistant, wilting],
    });

    engine.applyTargetDamage(plain, 10, false, 'fire');
    engine.applyTargetDamage(wilted, 10, false, 'fire');

    assert.equal(engine.resolveEntityCurrentHp(plain), 35, 'сопротивление');
    assert.equal(engine.resolveEntityCurrentHp(wilted), 30, 'снято');

    engine.applyTargetDamage(wilted, 10, false, 'poison');

    assert.equal(
      engine.resolveEntityCurrentHp(wilted),
      30,
      'иммунитет остаётся',
    );
  });

  it('[MX08] Дар изобильной жизни: +5 к получаемым временным хитам', () => {
    const boon = createEffect('Дар изобильной жизни', {
      changes: [change('tempHp.gain', '5')],
    });

    authoredScenario(boon, 'feature');

    const hero = createActor({ activeEffects: [boon] });

    assert.deepEqual(
      engine.limitEntityHealing(hero, { hitPoints: 4, temporary: 6 }),
      { hitPoints: 4, temporary: 11 },
    );

    assert.deepEqual(
      engine.limitEntityHealing(hero, { hitPoints: 4, temporary: 0 }),
      { hitPoints: 4, temporary: 0 },
      'к нулю прибавка ничего не добавляет',
    );

    // На листе у ключа числа нет: статы считаются как раньше
    assert.doesNotThrow(() => engine.resolveActorStats(hero));
  });

  it('[MX09] Заклинание фаэрзресса: помеха на спасброски от школы', () => {
    // «…совершает с помехой спасброски от заклинаний школы Прорицания»
    const faerzress = createEffect('Заклинание фаэрзресса', {
      rollCondition: 'source.spellSchool === "divination"',
      flags: ['save.disadvantage'],
    });

    assert.match(
      engine.describeEffectChangeCondition(faerzress.rollCondition),
      /школы: прорицание/,
    );

    const divination = engine.describeSpellSaveSource({
      school: 'divination',
      damageParts: [{ formula: '3к8', type: 'psychic' }],
    });

    assert.deepEqual(divination, {
      sourceSpellSchool: 'divination',
      sourceDamageTypes: ['psychic'],
    });

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments([faerzress], 'wisdom', divination)
        .flags,
      ['save.disadvantage'],
    );

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments([faerzress], 'wisdom', {
        sourceSpellSchool: 'evocation',
      }).flags,
      [],
    );

    // Удар оружием школы не имеет, хотя у псевдо-заклинания она записана
    assert.deepEqual(
      engine.describeSpellSaveSource({
        school: 'evocation',
        rollSource: 'weapon',
      }),
      {},
    );
  });

  it('[MX10] Корона света: помеха против заклинаний с уроном огнём и излучением', () => {
    // «Ваши враги в ярком свете имеют помеху при спасбросках против… любого
    // заклинания с уроном огнём или излучением»
    const corona = createEffect('Корона света', {
      rollCondition: 'source.damageType === "fire, radiant"',
      flags: ['save.disadvantage'],
    });

    const guardians = engine.describeSpellSaveSource({
      school: 'conjuration',
      activeEffects: [
        createEffect('Стражи', {
          damageParts: [{ formula: '3к8@dmg.radiant' }],
        }),
      ],
    });

    assert.deepEqual(guardians.sourceDamageTypes, ['radiant']);

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments([corona], 'wisdom', guardians).flags,
      ['save.disadvantage'],
    );

    assert.deepEqual(
      engine.resolveSaveSourceAdjustments([corona], 'wisdom', {
        sourceDamageTypes: ['cold'],
      }).flags,
      [],
    );
  });

  it('[MX11] Токсичное касание: урон от наложившего или его союзников', () => {
    // «…очарованный… пока вы или ваши союзники не нанесёте ей урон»
    const charm = createEffect('Токсичное очарование', {
      conditionKey: 'charmed',
      sourceActorId: SOURCE_ID,
      triggers: [
        {
          id: 'trigger_break',
          event: 'damageTaken',
          condition: 'target.isSourceSide === true',
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    authoredScenario({ ...charm, effectTarget: 'target' }, 'spell');

    assert.match(
      engine.describeEffectTrigger(charm.triggers[0], {
        formatDc: (save) => String(save.dc),
      }),
      /наложивший эффект или его союзник/,
    );

    const system = new engine.Dnd5eVttSystem();
    const monk = createActor({ id: SOURCE_ID });
    const ally = createActor({ id: 'actor_ally' });
    const stranger = createCreature({ id: 'creature_stranger' });

    /**
     * Удар по очарованному от существа со сцены.
     *
     * @param {string} attackerId - кто бьёт
     * @returns {boolean} осталось ли очарование
     */
    const strikeBy = (attackerId) => {
      const victim = withHp(createCreature, 40, {
        id: 'creature_victim',
        activeEffects: [structuredClone(charm)],
      });

      const everyone = [monk, ally, stranger];

      strikeEntity(system, victim, 3, 'slashing', {
        details: { critical: false, sourceId: attackerId },
        context: {
          getEntity: (id) => everyone.find((entity) => entity.id === id),
          getSceneSurroundings: () => ({
            token: createToken(victim.id, 0, 0, { disposition: 'hostile' }),
            gridSettings: GRID,
            neighbors: [
              {
                token: createToken(monk.id, 1, 0, { disposition: 'friendly' }),
                entity: monk,
              },
              {
                token: createToken(ally.id, 2, 0, { disposition: 'friendly' }),
                entity: ally,
              },
              {
                token: createToken(stranger.id, 3, 0, {
                  disposition: 'hostile',
                }),
                entity: stranger,
              },
            ],
          }),
        },
      });

      return victim.activeEffects.some(
        (effect) => effect.conditionKey === 'charmed',
      );
    };

    assert.equal(strikeBy(SOURCE_ID), false, 'ударил наложивший');
    assert.equal(strikeBy(ally.id), false, 'ударил его союзник');

    assert.equal(
      strikeBy(stranger.id),
      true,
      'чужой урон очарование не снимает',
    );
  });

  it('[E10] Связь с иным планом: «при наложении» у эффекта заклинателя', () => {
    // «…совершите спасбросок Интеллекта со Сл. 15… В случае провала — 6к6
    // психического урона и недееспособен»
    const contact = createEffect('Связь с иным планом', {
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_contact',
          event: 'applied',
          save: { ability: 'intelligence', dc: 15 },
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '6к6', type: 'psychic' }],
            },
            { type: 'applyCondition', conditionKey: 'incapacitated' },
          ],
        },
      ],
    });

    authoredScenario(contact, 'spell');

    const system = new engine.Dnd5eVttSystem();
    const caster = withHp(createActor, 60);
    const copy = structuredClone(caster);

    // Эффект «на себя» уходит боевым снимком самого заклинателя
    copy.activeEffects = [
      ...copy.activeEffects,
      { ...structuredClone(contact), sourceActorId: caster.id },
    ];

    withRandom([MIN_ROLL, ...Array.from({ length: 6 }, () => MAX_ROLL)], () =>
      system.settleCombatState(caster, engine.pickCombatState(copy), {}),
    );

    assert.equal(engine.resolveEntityCurrentHp(caster), 24, 'провал — 6к6');

    assert.ok(
      caster.activeEffects.some(
        (effect) => effect.conditionKey === 'incapacitated',
      ),
    );
  });

  it('[MX12] Дар медузы: применение с концентрацией', () => {
    // «…опутанный на 1 минуту… необходимо концентрироваться»
    const gaze = createEffect('Дар медузы', {
      activation: { mode: 'use', concentration: true, range: 30 },
      effectTarget: 'target',
      conditionKey: 'restrained',
      duration: { type: 'minutes', value: 1 },
    });

    authoredScenario(gaze, 'feature');
    assert.match(detailsOf(gaze), /требует концентрации/i);

    const spell = engine.buildEffectGroupUseSpell([gaze]);

    assert.equal(
      spell.concentration,
      true,
      'применение — каст с концентрацией',
    );

    assert.equal(
      engine.buildEffectGroupUseSpell([
        { ...gaze, activation: { mode: 'use' } },
      ]).concentration,
      false,
    );

    // Чужое значение выбрасывается одно, применение остаётся
    const parsed = engine.ActiveEffectSchema.parse({
      ...gaze,
      activation: { mode: 'use', concentration: 'yes' },
    });

    assert.equal(parsed.activation.mode, 'use');
    assert.equal(parsed.activation.concentration, undefined);
  });

  it('[MX13] Живая тень: досягаемость +10 футов', () => {
    // «…вы можете увеличить свою досягаемость для этой атаки на 10 футов»
    const shadow = createEffect('Живая тень', {
      changes: [change('attack.reach', '10')],
    });

    authoredScenario(shadow, 'feature');

    const rogue = createActor({ activeEffects: [shadow] });
    const dagger = { name: 'Кинжал', rangeType: 'melee' };
    const reached = engine.withMeleeReachBonus(dagger, rogue);

    assert.equal(reached.reach, 15);
    assert.equal(engine.checkRange(dagger, 15).allowed, false);
    assert.equal(engine.checkRange(reached, 15).allowed, true);

    assert.equal(
      engine.withMeleeReachBonus(dagger, createActor()),
      dagger,
      'без эффекта оружие остаётся собой',
    );
  });

  it('[MX14] Охотник на магов: спасбросок концентрации с помехой', () => {
    // «Когда вы наносите урон существу из Гримуара, поддерживающему
    // концентрацию, оно совершает спасбросок концентрации с помехой»
    const hunter = createEffect('Охотник на магов', {
      rollCondition: 'target.creatureType === "fiend"',
      flags: ['damage.concentrationDisadvantage'],
    });

    const occultist = createActor({ id: SOURCE_ID, activeEffects: [hunter] });

    /**
     * Режим спасброска концентрации цели после урона от оккультиста.
     *
     * @param {string} creatureType - тип цели
     * @returns {string|undefined} режим спасброска
     */
    const concentrationMode = (creatureType) => {
      const mage = withHp(createCreature, 40);

      mage.system.type = creatureType;

      const mark = engine.buildConcentrationEffect({
        spell: { id: 'spell_hold', name: 'Удержание' },
        casterId: mage.id,
        castId: 'cast_hold',
      });

      return engine.buildTriggerSaveSpec(mark, mark.triggers[0], {
        entity: mage,
        eventData: { other: occultist, damage: { total: 8, types: [] } },
      })?.mode;
    };

    assert.equal(concentrationMode('fiend'), 'disadvantage');
    assert.equal(concentrationMode('beast'), undefined);
  });

  it('[MX15] Ужасающий облик: отметка от каждого наложившего своя', () => {
    // «…невосприимчив к Ужасающему облику ЭТОГО привидения на 24 часа»
    const fromFirst = tagEffect('horrified', { sourceActorId: 'ghost_a' });
    const fromSecond = tagEffect('horrified', { sourceActorId: 'ghost_b' });

    const marked = engine.mergeAppliedEffects([fromFirst], [fromSecond]);

    assert.deepEqual(
      marked.map((effect) => effect.sourceActorId),
      ['ghost_a', 'ghost_b'],
      'отметка второго привидения не стирает отметку первого',
    );

    // То же привидение повторно — отметка обновляется, а не множится
    assert.equal(
      engine.mergeAppliedEffects(marked, [
        { ...structuredClone(fromSecond), id: 'tag_again' },
      ]).length,
      2,
    );

    // Счётчик ступеней общий: кто бы ни ставил, отметка одна
    assert.equal(
      engine.mergeAppliedEffects(
        [tagEffect('petrify', { sourceActorId: 'ghost_a', tagStacks: 1 })],
        [tagEffect('petrify', { sourceActorId: 'ghost_b', tagStacks: 2 })],
      ).length,
      1,
    );
  });

  it('[MX16] Ужас дракона: состояние кончилось по сроку — срабатывание', () => {
    // «…после окончания испуга существо невосприимчиво к Ужасу дракона»
    const aftermath = createEffect('После испуга', {
      triggers: [
        {
          id: 'trigger_aftermath',
          event: 'conditionLost',
          conditionKey: 'frightened',
          actions: [
            {
              type: 'applyTag',
              tag: 'fearless',
              duration: { type: 'hours', value: 24 },
            },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    const system = new engine.Dnd5eVttSystem();

    const frightened = {
      ...engine.buildConditionActiveEffect('frightened'),
      duration: { type: 'rounds', value: 1, remaining: 1 },
    };

    const hero = withHp(createActor, 30, {
      activeEffects: [aftermath, frightened],
    });

    assert.equal(system.decrementEffectDurations(hero, {}).changed, true);

    assert.equal(
      hero.activeEffects.some((effect) => effect.conditionKey === 'frightened'),
      false,
      'испуг кончился по сроку',
    );

    assert.ok(
      hero.activeEffects.some((effect) => effect.tag === 'fearless'),
      'событие «состояние снялось» пришло и без боевого снимка',
    );
  });

  it('[MX17] Кумулятивный урон: одноимённые эффекты складываются', () => {
    // «…урон кумулятивный»: каждое наложение ложится рядом с прежним
    const rot = createEffect('Гниль', {
      stackable: true,
      changes: [change('hitPoints.max', '-5')],
    });

    assert.match(detailsOf(rot), /складывается с одноимёнными/i);

    const twice = engine.mergeAppliedEffects(
      [{ ...rot, id: 'rot_1' }],
      [{ ...rot, id: 'rot_2' }],
    );

    assert.equal(twice.length, 2);

    assert.equal(
      engine.mergeAppliedEffects(
        [{ ...rot, id: 'rot_1', stackable: undefined }],
        [{ ...rot, id: 'rot_2', stackable: undefined }],
      ).length,
      1,
      'без отметки одноимённый эффект обновляется',
    );
  });

  it('[MX18] Ослабляющий выстрел: минус кость к урону атак носителя', () => {
    // «Каждый раз, когда отравленная таким образом цель попадает броском
    // атаки, она вычитает из общего урона… один бросок кости»
    const weakened = createEffect('Ослабляющий выстрел', {
      effectTarget: 'target',
      conditionKey: 'poisoned',
      changes: [change('damage.all', '-1к6')],
    });

    authoredScenario(weakened, 'spell');
    assert.match(detailsOf(weakened), /1к6/);
  });
});
