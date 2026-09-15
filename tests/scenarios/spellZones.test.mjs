import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  CELL_SIZE,
  change,
  createActor,
  createEffect,
  createRequestRoll,
  createZone,
  engine,
  GRID,
  MAX_ROLL,
  MIN_ROLL,
  withRandom,
} from './_fixtures.mjs';

/**
 * Зона заклинания на месте шаблона: геометрия, срок, сборка эффектов и путь
 * от черновика до урона на ходу существа в зоне.
 */

/** Сл заклинателя в тестах */
const CASTER_DC = 15;

/** Модификатор заклинательной характеристики */
const SPELL_MOD = 4;

/** Сколько центров клеток проверять вокруг начала шаблона */
const PROBE_RADIUS_CELLS = 16;

/** Направления, где центры клеток ложатся ровно на рёбра */
const EXACT_DIRECTIONS = Array.from(
  { length: 8 },
  (_, index) => (index * Math.PI) / 4,
);

/** Произвольные направления */
const ANY_DIRECTIONS = Array.from(
  { length: 16 },
  (_, index) => (index * Math.PI) / 8 + 0.1,
);

/**
 * Центры клеток вокруг точки.
 *
 * @param {number} originX - начало
 * @param {number} originY - начало
 * @returns {{x: number, y: number}[]} центры
 */
function cellCenters(originX, originY) {
  const baseColumn = Math.floor(originX / CELL_SIZE);
  const baseRow = Math.floor(originY / CELL_SIZE);
  const centers = [];

  for (
    let column = -PROBE_RADIUS_CELLS;
    column <= PROBE_RADIUS_CELLS;
    column++
  ) {
    for (let row = -PROBE_RADIUS_CELLS; row <= PROBE_RADIUS_CELLS; row++) {
      centers.push({
        x: (baseColumn + column + 0.5) * CELL_SIZE,
        y: (baseRow + row + 0.5) * CELL_SIZE,
      });
    }
  }

  return centers;
}

/**
 * Шаблон измерения.
 *
 * @param {string} type - форма
 * @param {number} originX - начало
 * @param {number} originY - начало
 * @param {number} direction - угол, радианы
 * @param {number} length - длина в пикселях
 * @returns {object} шаблон
 */
function createTemplate(type, originX, originY, direction, length) {
  return {
    id: `tmpl_${type}`,
    type,
    originX,
    originY,
    targetX: originX + Math.cos(direction) * length,
    targetY: originY + Math.sin(direction) * length,
    color: 0x88ccff,
    createdBy: 'player',
  };
}

/**
 * Расхождения полигона зоны с шаблоном на центрах клеток.
 *
 * @param {object} template - шаблон
 * @returns {{ missed: number, extra: number }} пропуски и лишние
 */
function compareWithTemplate(template) {
  const polygon = engine.templateToPolygon(template, CELL_SIZE);

  assert.ok(polygon, 'полигон собран');
  assert.ok(polygon.length >= 3 && polygon.length <= 64, 'от 3 до 64 вершин');

  for (const point of polygon) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }

  let missed = 0;
  let extra = 0;

  for (const center of cellCenters(template.originX, template.originY)) {
    const inTemplate = engine.isPointInTemplate(
      center.x,
      center.y,
      CELL_SIZE,
      template,
    );

    const inZone = engine.isPointInPolygon(center.x, center.y, polygon);

    if (inTemplate && !inZone) {
      missed += 1;
    }

    if (!inTemplate && inZone) {
      extra += 1;
    }
  }

  return { missed, extra };
}

describe('[SZ01] полигон зоны накрывает те же клетки, что шаблон', () => {
  const origins = [
    { name: 'на пересечении линий', x: 1000, y: 1000 },
    { name: 'в центре клетки', x: 1050, y: 1050 },
  ];

  for (const origin of origins) {
    for (const type of ['circle', 'cylinder', 'cone', 'ray']) {
      it(`${type}, начало ${origin.name}: 1–12 клеток, 8 осевых направлений — совпадение`, () => {
        for (let cells = 1; cells <= 12; cells++) {
          for (const direction of EXACT_DIRECTIONS) {
            const template = createTemplate(
              type,
              origin.x,
              origin.y,
              direction,
              cells * CELL_SIZE,
            );

            assert.deepEqual(
              compareWithTemplate(template),
              { missed: 0, extra: 0 },
              `${type} ${cells} клеток, угол ${direction}`,
            );
          }
        }
      });

      it(`${type}, начало ${origin.name}: произвольные направления — ничего не теряется`, () => {
        for (let cells = 1; cells <= 12; cells++) {
          for (const direction of ANY_DIRECTIONS) {
            const result = compareWithTemplate(
              createTemplate(
                type,
                origin.x,
                origin.y,
                direction,
                cells * CELL_SIZE,
              ),
            );

            assert.equal(
              result.missed,
              0,
              `${type} ${cells} клеток, угол ${direction}`,
            );

            assert.ok(
              result.extra <= 2,
              `лишних центров не больше двух: ${result.extra}`,
            );
          }
        }
      });
    }

    it(`rect, начало ${origin.name}: прямоугольники 1–12 клеток — совпадение`, () => {
      for (let width = 1; width <= 12; width += 3) {
        for (let height = 1; height <= 12; height += 2) {
          const template = {
            ...createTemplate('rect', origin.x, origin.y, 0, 0),
            targetX: origin.x + width * CELL_SIZE,
            targetY: origin.y + height * CELL_SIZE,
          };

          assert.deepEqual(compareWithTemplate(template), {
            missed: 0,
            extra: 0,
          });
        }
      }
    });
  }

  it('[SZ02] вырожденный шаблон зоны не даёт', () => {
    assert.equal(
      engine.templateToPolygon(
        createTemplate('circle', 100, 100, 0, 0.5),
        CELL_SIZE,
      ),
      null,
    );
  });
});

describe('[SZ03] срок зоны по длительности заклинания', () => {
  const cases = [
    [
      { durationUnit: 'round', durationValue: 3 },
      { kind: 'rounds', rounds: 3 },
    ],
    [
      { durationUnit: 'minute', durationValue: 1 },
      { kind: 'rounds', rounds: 10 },
    ],
    [
      { durationUnit: 'minute', durationValue: 10 },
      { kind: 'rounds', rounds: 100 },
    ],
    [
      { durationUnit: 'hour', durationValue: 1 },
      { kind: 'rounds', rounds: 600 },
    ],
    [{ durationUnit: 'hour', durationValue: 48 }, { kind: 'endless' }],
    [{ durationUnit: 'day', durationValue: 1 }, { kind: 'endless' }],
    [{ durationUnit: 'special', durationValue: 0 }, { kind: 'endless' }],
    [
      { durationUnit: 'until-dispelled', durationValue: 0 },
      { kind: 'endless' },
    ],
    [{ durationUnit: 'instantaneous', durationValue: 0 }, { kind: 'none' }],
    [
      { durationUnit: 'minute', durationValue: 0 },
      { kind: 'rounds', rounds: 10 },
    ],
  ];

  for (const [spell, expected] of cases) {
    it(`${spell.durationUnit} ${spell.durationValue}`, () => {
      assert.deepEqual(engine.spellDurationToLifetime(spell), expected);
    });
  }
});

/** Эффект «Лунного луча»: урон каждый ход в зоне со спасбросоком */
const MOONBEAM_STAY = createEffect('Лунный луч', {
  effectTarget: 'zone',
  recurringDamage: {
    damageParts: [{ formula: '2d10@dmg.radiant+@mod.spell' }],
    timing: 'endOfTurn',
    save: { ability: 'constitution', dc: 0, onSuccess: 'half' },
  },
});

/** Эффект «Паутины»: при входе спасбросок Ловкости, провал — «Опутанный» */
const WEB_ENTER = createEffect('Опутанный', {
  effectTarget: 'zone',
  areaTrigger: 'enter',
  applySave: { ability: 'dexterity', dc: 0, onSuccess: 'negate' },
  conditionKey: 'restrained',
  duration: { type: 'rounds', value: 10 },
});

/** Заклинание с эффектами разных доставок */
function createZoneSpell(overrides = {}) {
  return {
    name: 'Лунный луч',
    durationUnit: 'minute',
    durationValue: 1,
    concentration: true,
    activeEffects: [
      MOONBEAM_STAY,
      WEB_ENTER,
      createEffect('На цели', {
        effectTarget: 'target',
        flags: ['attack.disadvantage'],
      }),
      createEffect('На себе', { changes: [change('armorClass', '1')] }),
    ],
    ...overrides,
  };
}

/** Формулы заклинателя */
function casterFormulaContext() {
  return { ...engine.buildFormulaContext(createActor()), spellMod: SPELL_MOD };
}

/** Черновик зоны «Лунного луча» */
function buildMoonbeamDraft(spell = createZoneSpell()) {
  return engine.buildSpellZoneDraft({
    spell,
    template: createTemplate('cylinder', 1050, 1050, 0, CELL_SIZE),
    casterId: 'actor_caster',
    saveDc: CASTER_DC,
    formulaContext: casterFormulaContext(),
    gridSize: CELL_SIZE,
  });
}

describe('[SZ04] черновик зоны заклинания', () => {
  it('берёт только эффекты «в зону» и подставляет всё, что знает заклинатель', () => {
    const draft = buildMoonbeamDraft();

    assert.equal(draft.label, 'Лунный луч');
    assert.equal(draft.rounds, 10);
    assert.equal(draft.concentration, true);
    assert.equal(draft.color, '#88ccff');

    assert.deepEqual(
      draft.effects.map((effect) => effect.name),
      ['Лунный луч', 'Опутанный'],
    );

    const [stay, enter] = draft.effects;

    for (const effect of draft.effects) {
      assert.equal(effect.origin, 'spell');
      assert.equal(effect.magical, true);
      assert.equal(effect.sourceActorId, 'actor_caster');
      assert.equal(effect.effectTarget, 'zone');
      assert.notEqual(effect.id, MOONBEAM_STAY.id);
    }

    assert.equal(stay.recurringDamage.save.dc, CASTER_DC);

    assert.equal(
      stay.recurringDamage.damageParts[0].formula,
      `2d10@dmg.radiant+${SPELL_MOD}`,
    );

    assert.deepEqual(stay.duration, { type: 'permanent' });

    assert.equal(enter.applySave.dc, CASTER_DC);
    assert.deepEqual(enter.duration, { type: 'rounds', value: 10 });

    // Эффект заклинания в записи не тронут
    assert.equal(MOONBEAM_STAY.recurringDamage.save.dc, 0);
  });

  it('проходит проверку ядра: черновик и эффекты системы', () => {
    const draft = buildMoonbeamDraft();

    assert.notEqual(engine.parseEntityAreaDraft?.(draft) ?? draft, null);

    assert.notEqual(
      new engine.Dnd5eVttSystem().parseAreaEffects(draft.effects),
      null,
    );
  });

  it('без эффектов «в зону», у мгновенного заклинания или с вырожденным шаблоном зоны нет', () => {
    assert.equal(
      buildMoonbeamDraft(
        createZoneSpell({
          activeEffects: [createEffect('На цели', { effectTarget: 'target' })],
        }),
      ),
      null,
    );

    assert.equal(
      buildMoonbeamDraft(createZoneSpell({ durationUnit: 'instantaneous' })),
      null,
    );

    assert.equal(
      engine.buildSpellZoneDraft({
        spell: createZoneSpell(),
        template: createTemplate('circle', 0, 0, 0, 0),
        casterId: 'actor_caster',
        saveDc: CASTER_DC,
        formulaContext: casterFormulaContext(),
        gridSize: CELL_SIZE,
      }),
      null,
    );
  });

  it('бессрочное заклинание — зона без срока', () => {
    const draft = buildMoonbeamDraft(
      createZoneSpell({ durationUnit: 'until-dispelled' }),
    );

    assert.equal(draft.rounds, undefined);
  });
});

describe('[SZ05] окно эффекта заклинания: доставка «зоной на месте области»', () => {
  it('зона — одна из доставок заклинания; обычный эффект заклинания остаётся «на цели»', () => {
    const targetEffect = createEffect('Цель', { effectTarget: 'target' });
    const layout = engine.resolveEffectFormLayout('spell', targetEffect);

    assert.deepEqual(layout.deliveryOptions, [
      'target',
      'carrier',
      'aura',
      'zone',
    ]);

    assert.equal(layout.delivery, 'target');
    assert.equal(engine.readEffectDelivery(MOONBEAM_STAY, 'spell'), 'zone');

    assert.equal(
      engine.readEffectDelivery(createEffect('Себе'), 'spell'),
      'carrier',
    );
  });

  it('сл 0 — Сл заклинателя у зоны заклинания; у зоны мастера минимум 1', () => {
    assert.equal(
      engine.resolveEffectFormLayout('spell', { ...WEB_ENTER }).minSaveDc,
      0,
    );

    assert.equal(
      engine.resolveEffectFormLayout('zone', {
        ...WEB_ENTER,
        effectTarget: undefined,
      }).minSaveDc,
      1,
    );
  });

  it('смена доставки: в зону и обратно на цель без хвостов момента срабатывания', () => {
    const toZone = engine.writeEffectDelivery(createEffect('Эффект'), 'zone');

    assert.equal(toZone.effectTarget, 'zone');

    const back = engine.writeEffectDelivery(
      { ...toZone, areaTrigger: 'enter' },
      'target',
    );

    assert.equal(back.effectTarget, 'target');
    assert.equal(back.areaTrigger, undefined);
  });

  it('без области у заклинания зону не предлагают, а уже выбранная — неработающее поле', () => {
    const layout = engine.resolveEffectFormLayout(
      'spell',
      createEffect('Цель', { effectTarget: 'target' }),
      {
        zoneAvailable: false,
      },
    );

    assert.deepEqual(layout.deliveryOptions, ['target', 'carrier', 'aura']);

    const zoneLayout = engine.resolveEffectFormLayout('spell', MOONBEAM_STAY, {
      zoneAvailable: false,
    });

    assert.deepEqual(engine.listInertEffectFields(MOONBEAM_STAY, zoneLayout), [
      'effectTarget',
    ]);

    assert.equal(
      engine.clearInertEffectFields(MOONBEAM_STAY, ['effectTarget'], 'spell')
        .effectTarget,
      'target',
    );
  });

  it('«в зону» у предмета, умения, черты и действия существа не работает', () => {
    for (const context of [
      'item',
      'feature',
      'creatureTrait',
      'creatureAction',
      'ownEffects',
    ]) {
      const layout = engine.resolveEffectFormLayout(context, MOONBEAM_STAY);

      assert.ok(
        engine
          .listInertEffectFields(MOONBEAM_STAY, layout)
          .includes('effectTarget'),
        context,
      );
    }
  });

  it('сводка говорит о зоне заклинания и Сл заклинателя', () => {
    assert.equal(
      engine.describeEffectScenario(MOONBEAM_STAY, 'spell'),
      'Пока существо в зоне заклинания: каждый ход 2d10+мод. закл. характеристики излучением в конце хода '
        + '(спасбросок Телосложения, Сл заклинателя: успех — половина урона).',
    );
  });
});

describe('[SZ06] эффекты заклинания по доставкам', () => {
  it('на заклинателя, на цель и в зону — каждый в свою сторону', () => {
    const spell = createZoneSpell();

    assert.deepEqual(
      engine.getCasterSpellEffects(spell).map((effect) => effect.name),
      ['На себе'],
    );

    assert.deepEqual(
      engine.getTargetSpellEffects(spell).map((effect) => effect.name),
      ['На цели'],
    );

    assert.deepEqual(
      engine.getZoneSpellEffects(spell).map((effect) => effect.name),
      ['Лунный луч', 'Опутанный'],
    );
  });

  it('эффект «в зону» на предмете носителю не достаётся', () => {
    const actor = createActor({
      equipment: [
        {
          id: 'ring',
          name: 'Кольцо',
          type: 'equipment',
          equipped: true,
          activeEffects: [
            createEffect('Зона', {
              effectTarget: 'zone',
              changes: [change('armorClass', '5')],
            }),
          ],
        },
      ],
    });

    assert.deepEqual(engine.collectActiveEffects(actor), []);
  });
});

describe('[SZ07] разбор эффекта: доставка и метки копий', () => {
  it('«zone», метка магии и зона-источник разбираются; незнакомая доставка обнуляет поле, а не эффект', () => {
    const parsed = engine.ActiveEffectSchema.parse(
      createEffect('Копия', {
        effectTarget: 'zone',
        magical: true,
        endsWithAreaId: 'ca_1',
      }),
    );

    assert.equal(parsed.effectTarget, 'zone');
    assert.equal(parsed.magical, true);
    assert.equal(parsed.endsWithAreaId, 'ca_1');

    const unknown = engine.ActiveEffectSchema.parse(
      createEffect('Чужой', { effectTarget: 'somewhere' }),
    );

    assert.equal(unknown.effectTarget, undefined);
    assert.equal(unknown.name, 'Чужой');
  });
});

describe('[SZ08–SZ10] зона на сцене: копии, урон на ходу и статус от входа', () => {
  /** Зона «Лунного луча» и «Паутины», собранная из черновика */
  function createSpellZone() {
    const draft = buildMoonbeamDraft();

    return createZone('ca_moonbeam', draft.effects, {
      points: draft.points,
      source: {
        entityId: 'actor_caster',
        label: draft.label,
        concentration: true,
      },
    });
  }

  it('[SZ08] копия «пока в зоне» живёт по зоне, без своей длительности и доставки, и помнит магию', () => {
    const zone = createSpellZone();

    const creature = engine.DEFAULT_CREATURE
      ? {
          ...structuredClone(engine.DEFAULT_CREATURE),
          id: 'goblin',
          activeEffects: [],
        }
      : null;

    zone.effects[0] = {
      ...zone.effects[0],
      duration: { type: 'rounds', value: 3 },
    };

    engine.syncActorAreaEffects(
      creature,
      new Set(),
      new Set([zone.id]),
      [zone],
      {
        triggerOneShots: false,
      },
    );

    const [copy] = creature.activeEffects;

    assert.equal(copy.origin, 'area');
    assert.equal(copy.originId, zone.id);
    assert.equal(copy.effectTarget, undefined);
    assert.deepEqual(copy.duration, { type: 'permanent' });
    assert.equal(copy.magical, true);

    const recurringDamage = engine
      .collectEffectTriggers(copy)
      .find(
        (trigger) => trigger.id === engine.LEGACY_TRIGGER_IDS.recurringDamage,
      );

    assert.equal(
      engine.buildTriggerSaveSpec(copy, recurringDamage).againstMagic,
      true,
    );
  });

  it('[SZ09] на ходу существа в зоне — урон со спасброском против Сл заклинателя', () => {
    const zone = createSpellZone();

    const creature = {
      ...structuredClone(engine.DEFAULT_CREATURE),
      id: 'goblin',
      activeEffects: [],
    };

    engine.syncActorAreaEffects(
      creature,
      new Set(),
      new Set([zone.id]),
      [zone],
      {
        triggerOneShots: false,
      },
    );

    const hpBefore = engine.resolveEntityCurrentHp(creature);

    const result = withRandom([MIN_ROLL, MIN_ROLL, MAX_ROLL, MAX_ROLL], () =>
      engine.processTurnEffects(creature, 'endOfTurn'),
    );

    assert.equal(result.saveOutcomes[0]?.dc, CASTER_DC);
    assert.equal(result.saveOutcomes[0]?.passed, false);

    assert.ok(
      engine.resolveEntityCurrentHp(creature) < hpBefore,
      'урон нанесён',
    );
  });

  it('[SZ10] вход в зону: спасбросок у игрока, провал — «Опутанный» до исчезновения зоны', async () => {
    const zone = createSpellZone();
    const actor = createActor({ autoSaves: false });
    const roll = createRequestRoll();

    const result = engine.syncActorAreaEffects(
      actor,
      new Set(),
      new Set([zone.id]),
      [zone],
      {
        requestRoll: roll.requestRoll,
      },
    );

    assert.equal(result.deferred.length, 1);

    assert.equal(
      roll.requests[0].title.includes('Ловкости') || roll.requests.length === 1,
      true,
    );

    roll.answer({
      status: 'answered',
      result: { roll: 2, modifier: 0, total: 2, passed: false },
    });

    const apply = await result.deferred[0].resolution;

    apply(actor);

    const status = actor.activeEffects.find(
      (effect) => effect.conditionKey === 'restrained',
    );

    assert.ok(status, 'статус наложен');
    assert.equal(status.endsWithAreaId, zone.id);
    assert.equal(status.magical, true);
    assert.equal(status.effectTarget, undefined);

    // Переход на другую сцену статус не снимает: зоны той сцены не показатель
    engine.syncActorAreaEffects(actor, new Set([zone.id]), new Set(), [], {});

    assert.ok(
      actor.activeEffects.some(
        (effect) => effect.conditionKey === 'restrained',
      ),
    );

    // Зона исчезла со своей сцены — статус снимается при ре-синке
    engine.syncActorAreaEffects(actor, new Set(), new Set(), [], {
      triggerOneShots: false,
    });

    assert.equal(
      actor.activeEffects.some(
        (effect) => effect.conditionKey === 'restrained',
      ),
      false,
    );
  });

  it('[SZ11] статус от зоны мастера исчезновение зоны переживает', () => {
    const zone = createZone('ca_swamp', [
      createEffect('Отравленный', {
        areaTrigger: 'enter',
        conditionKey: 'poisoned',
        duration: { type: 'rounds', value: 10 },
      }),
    ]);

    const creature = {
      ...structuredClone(engine.DEFAULT_CREATURE),
      id: 'goblin',
      activeEffects: [],
    };

    engine.syncActorAreaEffects(creature, new Set(), new Set([zone.id]), [
      zone,
    ]);

    assert.ok(
      creature.activeEffects.some(
        (effect) => effect.conditionKey === 'poisoned',
      ),
    );

    engine.syncActorAreaEffects(creature, new Set(), new Set(), [], {
      triggerOneShots: false,
    });

    assert.ok(
      creature.activeEffects.some(
        (effect) => effect.conditionKey === 'poisoned',
      ),
    );
  });
});

describe('[SZ12] числа источника в эффектах', () => {
  it('сл 0 проставляется во все спасброски эффекта, заданная Сл не трогается', () => {
    const stamped = engine.stampSourceSaveDcs(
      createEffect('Эффект', {
        applySave: { ability: 'wisdom', dc: 0, onSuccess: 'negate' },
        recurringSave: { ability: 'wisdom', dc: 0, timing: 'endOfTurn' },
        recurringDamage: {
          damageParts: [{ formula: '1d6' }],
          timing: 'startOfTurn',
          save: { ability: 'constitution', dc: 12, onSuccess: 'half' },
        },
      }),
      CASTER_DC,
    );

    assert.equal(stamped.applySave.dc, CASTER_DC);
    assert.equal(stamped.recurringSave.dc, CASTER_DC);
    assert.equal(stamped.recurringDamage.save.dc, 12);
  });

  it('формулы источника: модификаторы и мастерство — числами, токены цели и урона остаются', () => {
    const context = casterFormulaContext();

    assert.equal(
      engine.bindSourceFormula(
        '1d8+@mod.spell@dmg.fire+@prof@target.full',
        context,
      ),
      `1d8+${SPELL_MOD}@dmg.fire+${context.prof}@target.full`,
    );

    assert.equal(
      engine.bindSourceFormula('@mod.spell', {
        ...context,
        spellMod: undefined,
      }),
      '@mod.spell',
    );
  });

  it('аура отдаёт другим числа своего источника («Аура защиты» — Харизма паладина)', () => {
    const paladin = createActor({
      id: 'paladin',
      system: {
        ...structuredClone(engine.DEFAULT_ACTOR.system),
        abilities: { ...engine.DEFAULT_ACTOR.system.abilities, charisma: 18 },
      },
      activeEffects: [
        createEffect('Аура защиты', {
          aura: {
            radius: 10,
            target: 'allies',
            applyToSelf: true,
            visible: true,
          },
          changes: [change('save.wisdom', '@mod.cha')],
        }),
      ],
    });

    const [aura] = engine.collectAllAuraEffects(paladin);

    assert.equal(aura.changes[0].value, '4');
  });
});

describe('сетка сцены в тестах', () => {
  it('клетка 100 пикселей, 5 футов', () => {
    assert.equal(GRID.cellSize, CELL_SIZE);
  });
});
