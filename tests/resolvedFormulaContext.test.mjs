import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listSystemSources, toSystemPath } from './helpers/clientSources.mjs';
import {
  change,
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Формулы эффектов считаются от итоговых чисел листа (Н4).
 *
 * Черта «+1 к Харизме» поднимала Харизму 15 до 16 на листе, а Сл умения
 * «8 + @prof + @mod.<х>» и КД паладина «10 + Лов + Хар» читали сырое
 * значение записи: Сл 12 вместо 13, КД на единицу ниже листа. Порядок
 * расчёта: изменения самих характеристик — от сырых чисел, всё остальное —
 * от итоговых.
 */

/** Формула Сл умения от поднятой характеристики */
const SAVE_DC_FORMULA = '8 + @prof + @mod.cha';

/**
 * Персонаж 1-го уровня (бонус мастерства 2) с Харизмой 15, поднятой до 16.
 *
 * @param way - как поднята: эффектом черты или своим бонусом листа
 * @param overrides - прочие поля
 * @returns персонаж
 */
function raisedCharisma(way, overrides = {}) {
  const actor = createActor(overrides);

  actor.system.abilities = {
    ...actor.system.abilities,
    dexterity: 16,
    charisma: 15,
  };

  if (way === 'effect') {
    // Так черта поднимает характеристику (`featGrants`: `ability.<х> add`)
    actor.activeEffects = [
      ...(actor.activeEffects ?? []),
      createEffect('feat_charisma', {
        changes: [change('ability.charisma', '1')],
      }),
    ];
  } else {
    actor.system.abilityBonuses = {
      charisma: [
        {
          id: 'bonus_feat',
          kind: 'flat',
          ability: 'charisma',
          value: 1,
          label: 'Черта',
        },
      ],
    };
  }

  return actor;
}

for (const way of ['effect', 'abilityBonuses']) {
  describe(`характеристика поднята: ${way}`, () => {
    it('сл умения считается от итогового модификатора', () => {
      const actor = raisedCharisma(way);

      assert.equal(engine.resolveActorStats(actor).abilities.charisma, 16);

      const context = engine.buildOwnerSaveDcContext(actor, [SAVE_DC_FORMULA]);

      assert.equal(engine.evaluateFormula(SAVE_DC_FORMULA, context), 13);
    });

    it('кД формулой «10 + Лов + Хар» — как на листе', () => {
      const actor = raisedCharisma(way);

      actor.activeEffects = [
        ...actor.activeEffects,
        createEffect('paladin_ac', {
          changes: [
            change('armorClass', '10 + @mod.dex + @mod.cha', {
              mode: 'override',
            }),
          ],
        }),
      ];

      assert.equal(engine.resolveActorStats(actor).armorClass, 16);
    });

    it('максимум счётчика, урон заклинания и прибавка события — от итогового модификатора', () => {
      const actor = raisedCharisma(way);
      const context = engine.buildCounterFormulaContext(actor);

      assert.equal(
        engine.resolveCounterMaxIn(context, {
          counterKey: 'channel',
          current: 0,
          max: 0,
          maxFormula: '@mod.cha',
        }),
        3,
      );

      assert.equal(
        engine.resolveSpellDamageFormula(
          { id: 'smite', name: 'Кара', level: 1, damageParts: [] },
          actor,
          '1к8 + @mod.cha',
        ),
        '1к8 + 3',
      );

      actor.activeEffects = [
        ...actor.activeEffects,
        createEffect('gain', {
          changes: [change(engine.TEMP_HP_GAIN_KEY, '@mod.cha')],
        }),
      ];

      assert.equal(engine.sumOffSheetChange(actor, engine.TEMP_HP_GAIN_KEY), 3);
    });
  });
}

describe('порядок расчёта', () => {
  it('взаимные прибавки характеристик считаются от сырых чисел и завершаются', () => {
    const actor = createActor();

    actor.system.abilities = {
      ...actor.system.abilities,
      strength: 14,
      wisdom: 12,
    };

    actor.activeEffects = [
      createEffect('mutual', {
        changes: [
          change('ability.strength', '@mod.wis'),
          change('ability.wisdom', '@mod.str'),
        ],
      }),
    ];

    const stats = engine.resolveActorStats(actor);

    assert.equal(stats.abilities.strength, 15);
    assert.equal(stats.abilities.wisdom, 14);
  });

  it('прочие строки листа читают характеристики уже с изменениями', () => {
    const actor = raisedCharisma('effect');
    const before = engine.resolveActorStats(actor).movement.walk;

    actor.activeEffects = [
      ...actor.activeEffects,
      createEffect('stride', {
        changes: [change('movement.walk', '@mod.cha')],
      }),
    ];

    assert.equal(engine.resolveActorStats(actor).movement.walk, before + 3);
  });

  it('существо: бонус мастерства и модификаторы — как раньше', () => {
    const creature = createCreature();
    const raw = engine.buildFormulaContext(creature);
    const resolved = engine.buildResolvedFormulaContext(creature);

    assert.equal(resolved.prof, raw.prof);
    assert.deepEqual(resolved.abilities, raw.abilities);
  });
});

/** Где сырой контекст формул разрешён */
const RAW_CONTEXT_FILES = [
  'src/engine/formulaParser.ts',
  // Конвейер сам считает итоговые числа — итоговый контекст здесь замкнул бы
  // расчёт на себя
  'src/engine/effectPipeline.ts',
  'src/engine/resolvedFormulaContext.ts',
  // Числа получателя урона — отметки, временные хиты, кости хитов:
  // характеристик среди них нет
  'src/engine/turnEffects.ts',
];

/**
 * Строки исходника без строк-комментариев.
 *
 * @param {string} path - файл
 * @returns {string} текст
 */
function readCode(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

describe('вызовы контекста формул', () => {
  it('сырой контекст формул — только в перечисленных местах', () => {
    const callers = listSystemSources()
      .filter((path) => /\bbuildFormulaContext\(/u.test(readCode(path)))
      .map(toSystemPath)
      .sort();

    assert.deepEqual(callers, [...RAW_CONTEXT_FILES].sort());
  });

  it('конвейер не зовёт итоговый контекст', () => {
    const pipeline = listSystemSources().find(
      (path) => toSystemPath(path) === 'src/engine/effectPipeline.ts',
    );

    assert.doesNotMatch(readCode(pipeline), /buildResolvedFormulaContext/u);
  });
});
