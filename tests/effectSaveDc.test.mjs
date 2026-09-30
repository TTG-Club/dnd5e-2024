import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createActor, createEffect, engine } from './scenarios/_fixtures.mjs';

/**
 * Сл спасброска формулой по владельцу эффекта (`effectSaveDc.ts`,
 * `effectSaveDcOwner.ts`): подстановка чисел владельца при наложении, расчёт
 * в момент броска, запасное число, запись и сводка.
 */

/**
 * Варвар 5-го уровня с Силой 18: бонус мастерства 3, модификатор Силы 4.
 *
 * @param {object} overrides - поля персонажа
 * @returns {object} персонаж
 */
function barbarian(overrides = {}) {
  const system = structuredClone(engine.DEFAULT_ACTOR.system);

  return createActor({
    id: 'actor_barbarian',
    system: {
      ...system,
      classes: [{ classKey: 'barbarian', level: 5 }],
      abilities: { ...system.abilities, strength: 18, wisdom: 8 },
    },
    ...overrides,
  });
}

/**
 * Волшебник 5-го уровня с Интеллектом 16: Сл заклинаний 8 + 3 + 3.
 *
 * @param {object} overrides - поля персонажа
 * @returns {object} персонаж
 */
function wizard(overrides = {}) {
  const system = structuredClone(engine.DEFAULT_ACTOR.system);

  return createActor({
    id: 'actor_wizard',
    system: {
      ...system,
      classes: [
        { classKey: 'wizard', level: 5, spellcastingAbility: 'intelligence' },
      ],
      abilities: { ...system.abilities, intelligence: 16 },
    },
    ...overrides,
  });
}

/** Сл заклинаний волшебника */
const WIZARD_SPELL_DC = 14;

/** 8 + 3 + 4 */
const BARBARIAN_DC = 15;

/** Формула Сл умения варвара */
const STRENGTH_DC_FORMULA = '8 + @prof + @mod.str';

describe('сл формулой: расчёт в момент броска', () => {
  it('считается по владельцу; без формулы — число', () => {
    const owner = barbarian();

    assert.equal(
      engine.resolveSaveDc({ dc: 10, dcFormula: STRENGTH_DC_FORMULA }, owner),
      BARBARIAN_DC,
    );

    assert.equal(engine.resolveSaveDc({ dc: 12 }, owner), 12);
  });

  it('без владельца токены владельца не превращаются в нули — берётся число', () => {
    assert.equal(
      engine.resolveSaveDc({ dc: 13, dcFormula: STRENGTH_DC_FORMULA }),
      13,
    );

    assert.equal(engine.resolveSaveDc({ dc: 13, dcFormula: '14' }), 14);
  });

  it('@damage — урон события, @spellDc — Сл заклинаний владельца', () => {
    const owner = barbarian();

    assert.equal(
      engine.resolveSaveDc(
        { dc: 10, dcFormula: 'max(10, floor(@damage / 2))' },
        undefined,
        30,
      ),
      15,
    );

    assert.equal(
      engine.resolveSaveDc({ dc: 1, dcFormula: '@spellDc' }, wizard()),
      WIZARD_SPELL_DC,
    );

    assert.equal(
      engine.resolveSaveDc({ dc: 12, dcFormula: '@damage' }, owner),
      12,
      'без события урона — запасное число',
    );
  });

  it('ошибка в формуле — спасбросок против запасного числа, Сл не ниже 1', () => {
    const owner = barbarian();

    assert.equal(
      engine.resolveSaveDc({ dc: 11, dcFormula: '8 + @nope' }, owner),
      11,
    );

    assert.equal(engine.resolveSaveDc({ dc: 11, dcFormula: '-5' }, owner), 1);
  });

  it('спасбросок срабатывания своего эффекта считается по носителю', () => {
    const owner = barbarian();

    assert.equal(
      engine.resolveTriggerSaveDc(
        { ability: 'wisdom', dc: 10, dcFormula: STRENGTH_DC_FORMULA },
        { entity: owner, eventData: {} },
      ),
      BARBARIAN_DC,
    );
  });
});

describe('сл формулой: числа владельца при наложении', () => {
  /** Пугающее присутствие: спасбросок Мудрости и повторный в конце хода */
  const presence = createEffect('Пугающее присутствие', {
    effectTarget: 'target',
    conditionKey: 'frightened',
    applySave: {
      ability: 'wisdom',
      dc: 10,
      dcFormula: STRENGTH_DC_FORMULA,
      onSuccess: 'negate',
    },
    recurringSave: {
      ability: 'wisdom',
      dc: 10,
      dcFormula: STRENGTH_DC_FORMULA,
      timing: 'endOfTurn',
    },
  });

  it('формула без оставшихся токенов становится числом во всех спасбросках', () => {
    const owner = barbarian();

    const [bound] = engine.bindTargetEffectsToSource(
      [presence],
      owner,
      engine.buildOwnerSaveDcContext(owner, [STRENGTH_DC_FORMULA]),
    );

    assert.deepEqual(
      [bound.applySave.dc, bound.recurringSave.dc],
      [BARBARIAN_DC, BARBARIAN_DC],
    );

    assert.equal(bound.applySave.dcFormula, undefined);
    assert.equal(bound.recurringSave.dcFormula, undefined);
  });

  it('@damage остаётся ждать события, числа владельца подставлены', () => {
    const owner = barbarian();

    const effect = createEffect('Отдача', {
      triggers: [
        {
          id: 'recoil',
          event: 'damageTaken',
          save: {
            ability: 'constitution',
            dc: 10,
            dcFormula: '@prof + floor(@damage / 2)',
          },
          actions: [{ type: 'removeSelf', on: 'failed' }],
        },
      ],
    });

    const bound = engine.bindSourceEffectFormulas(
      effect,
      engine.buildFormulaContext(owner),
    );

    assert.equal(bound.triggers[0].save.dcFormula, '3 + floor(@damage / 2)');
  });

  it('срабатывание, отданное другому, получает Сл владельца, а не бросающего', () => {
    const monk = barbarian({ id: 'actor_monk' });

    const stunning = {
      id: 'stunning-strike',
      event: 'attackRoll',
      role: 'attacker',
      recipient: 'other',
      save: { ability: 'constitution', dc: 10, dcFormula: STRENGTH_DC_FORMULA },
      actions: [
        {
          type: 'applyCondition',
          conditionKey: 'stunned',
          recurringSave: {
            ability: 'constitution',
            dc: 10,
            dcFormula: STRENGTH_DC_FORMULA,
            timing: 'endOfTurn',
          },
          on: 'failed',
        },
      ],
    };

    const { trigger } = engine.bindTriggerSourceSaveDcs(
      { trigger: stunning },
      monk,
    );

    assert.equal(trigger.save.dc, BARBARIAN_DC);
    assert.equal(trigger.actions[0].recurringSave.dc, BARBARIAN_DC);
  });

  it('аура носителя: «@spellDc» — Сл его заклинаний', () => {
    const aura = createEffect('Аура Бездны', {
      aura: { radius: 10, target: 'enemies', visible: true },
      areaTrigger: 'enter',
      conditionKey: 'frightened',
      applySave: {
        ability: 'wisdom',
        dc: 10,
        dcFormula: '@spellDc',
        onSuccess: 'negate',
      },
    });

    const [collected] = engine.collectAllAuraEffects(
      wizard({ activeEffects: [aura] }),
    );

    assert.equal(collected.applySave.dc, WIZARD_SPELL_DC);

    assert.equal(collected.applySave.dcFormula, undefined);
  });
});

describe('сл формулой: запись, схема и сводка', () => {
  it('схема хранит формулу, пустую отбрасывает', () => {
    const [kept, dropped] = [STRENGTH_DC_FORMULA, '  '].map(
      (dcFormula) =>
        engine.ActiveEffectSchema.parse(
          createEffect('Эффект', {
            applySave: {
              ability: 'wisdom',
              dc: 10,
              dcFormula,
              onSuccess: 'negate',
            },
          }),
        ).applySave.dcFormula,
    );

    assert.equal(kept, STRENGTH_DC_FORMULA);
    assert.equal(dropped, undefined);
  });

  it('сводка называет формулу словами', () => {
    assert.equal(
      engine.formatEffectSaveDc({ dc: 10, dcFormula: STRENGTH_DC_FORMULA }),
      'Сл 8 + бонус мастерства + мод. Силы',
    );

    assert.equal(engine.formatEffectSaveDc({ dc: 0 }), 'Сл заклинателя');
  });

  it('поле окна ругается на @damage вне события урона', () => {
    assert.equal(
      engine.describeSaveDcFormulaError('@damage', { acceptsDamage: true }),
      undefined,
    );

    assert.match(
      engine.describeSaveDcFormulaError('@damage', { acceptsDamage: false }),
      /урона/,
    );
  });

  it('черновик: пустая формула не пишется ни в одном спасброске', () => {
    const draft = createEffect('Черновик', {
      effectTarget: 'target',
      applySave: {
        ability: 'wisdom',
        dc: 12,
        dcFormula: ' ',
        onSuccess: 'negate',
      },
    });

    const layout = engine.resolveEffectFormLayout('spell', draft);

    assert.equal(
      engine.normalizeEffectDraft(draft, layout).applySave.dcFormula,
      undefined,
    );
  });
});
