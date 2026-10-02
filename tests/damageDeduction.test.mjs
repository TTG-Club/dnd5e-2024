import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Вычет кости из урона: строка `damage.all` со значением `-1к8`
 * («Ослабляющий выстрел» лучников). Роллер клиента читал ведущий минус перед
 * костью как «минус одна кость» и не бросал ничего — урон оставался полным.
 */

const modalPath = 'src/client/ui/actor/DiceRollModal.vue';
const resolutionPath = 'src/client/composables/useSpellResolution.ts';
const orchestratorPath = 'src/client/composables/useSpellDamageWithParts.ts';

/** «Пока отравлена, вычитает кость выстрела из урона своих атак» */
const WEAKENED = createEffect('Ослабляющий выстрел', {
  changes: [{ key: 'damage.all', mode: 'add', value: '-1d8', priority: 20 }],
});

/**
 * Роллер клиента: ведущий минус перед костью — «минус одна кость», бросков
 * нет и итог ноль; вычитание после числа бросается как положено.
 *
 * @param {number} dieValue - что выпадает на каждой кости
 * @returns {{ rolled: string[], parseAndRoll: Function }} роллер и журнал
 */
function createHostRoller(dieValue) {
  const rolled = [];

  return {
    rolled,
    parseAndRoll: (formula) => {
      rolled.push(formula);

      if (/^-\d+[dк]/u.test(formula)) {
        return { total: 0, dice: [] };
      }

      const result = engine.rollDamageFormula(formula);

      return {
        total:
          result.dice.length > 0
            ? Math.sign(result.total) * dieValue
            : result.total,
        dice: result.dice,
      };
    },
  };
}

describe('вычет кости из урона', () => {
  it('строка `damage.*` с минусом — бонус-часть и у существа, и у персонажа', () => {
    for (const entity of [
      createCreature({ activeEffects: [WEAKENED] }),
      createActor({ activeEffects: [WEAKENED] }),
    ]) {
      const effects = engine.collectActiveEffects(entity);

      for (const key of ['damage.melee', 'damage.ranged', 'damage.spell']) {
        const formulas = engine.collectBonusDamageFormulas(effects, key, {
          hasAdvantage: false,
          hasDisadvantage: false,
        });

        assert.deepEqual(formulas, [{ formula: '-1d8' }], key);

        const [part] = engine.resolveBonusDamageParts(
          formulas,
          'piercing',
          undefined,
          (formula) => formula,
        );

        assert.equal(part.formula, '-1d8');
        assert.equal(part.isHealing, false);
      }
    }
  });

  it('формула для роллера: вычет бросается вычитанием из нуля', () => {
    assert.equal(engine.isDeductionFormula('-1d8'), true);
    assert.equal(engine.isDeductionFormula(' -1к8 + 1'), true);
    assert.equal(engine.isDeductionFormula('1d8-1'), false);

    assert.equal(engine.toRollerFormula('-1d8'), '0-1d8');
    assert.equal(engine.toRollerFormula(' -2к6'), '0-2к6');
    assert.equal(engine.toRollerFormula('1d8+2'), '1d8+2');

    // Серверный бросок движка вычет понимал и раньше
    assert.ok(engine.rollDamageFormula('-1d8').total < 0);
  });

  it('окно броска: вычет доходит до применения отрицательной частью', async () => {
    const roller = createHostRoller(5);
    const applied = [];

    const ports = {
      diceRollerStore: {
        enable3dDice: false,
        isDiceBoxReady: false,
        parseAndRoll: roller.parseAndRoll,
      },
      hasSpellCast: { value: false },
      props: {},
      selectedSpellLevel: { value: 0 },
      scaleDamageFormula: engine.scaleDamageFormula,
      doubleDiceInFormula: engine.doubleDiceInFormula,
      isDeductionFormula: engine.isDeductionFormula,
      toRollerFormula: engine.toRollerFormula,
      rollOnRollParts: { value: (parts) => applied.push(...parts) },
    };

    const rollParts = await loadHandler(
      modalPath,
      'rollPartsSequentially',
      ports,
    );

    const parts = [
      {
        formula: '1d6+2',
        type: 'piercing',
        isHealing: false,
        target: 'selected',
      },
      {
        formula: '-1d8',
        type: 'piercing',
        isHealing: false,
        target: 'selected',
      },
    ];

    await rollParts(parts, false);

    assert.deepEqual(roller.rolled, ['1d6+2', '0-1d8']);
    assert.equal(applied[1].amount, -5, 'вычет — отрицательная часть урона');
    assert.equal(applied[1].formula, '-1d8', 'в чат идёт формула как записана');

    // Критическое попадание удваивает кости урона, но не вычета
    roller.rolled.length = 0;
    await rollParts(parts, true);

    assert.deepEqual(roller.rolled, ['2d6+2', '0-1d8']);
  });

  it('снаряды бросают вычет тем же способом', async () => {
    const source = await readFile(join(systemRoot, resolutionPath), 'utf8');

    assert.equal(
      source.match(/parseAndRoll\(\s*toRollerFormula\(/gu)?.length,
      2,
      'обе бонус-части снарядов идут через формулу для роллера',
    );
  });

  it('вычет виден в чате своей строкой, а не пропадает молча', async () => {
    const source = await readFile(join(systemRoot, orchestratorPath), 'utf8');

    // Часть с отрицательным итогом раньше пропускалась вместе с нулевыми:
    // в чате стоял полный урон, а хитов снималось меньше
    assert.doesNotMatch(source, /if \(part\.amount <= 0\)/u);

    assert.match(
      source,
      /messageLines\.push\(DAMAGE_DEDUCTION_LABELS\.header\)/u,
    );
  });
});
