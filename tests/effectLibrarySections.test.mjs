import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Контекст формулы с уровнем в классе */
function classLevelContext(classLevel) {
  return {
    abilities: {},
    prof: 2,
    level: classLevel,
    classLevel,
    movement: { walk: 30, swim: 0, fly: 0, climb: 0, burrow: 0 },
  };
}

/** Готовый пункт меню модификаторов по подписи */
function findPreset(label) {
  return engine.EFFECT_MODIFIER_MENU.flatMap((group) => group.items).find(
    (item) => item.label === label,
  );
}

describe('библиотека значений', () => {
  it('каждый пример проходит проверку поля: кость или читаемая формула', () => {
    for (const suggestion of engine.EFFECT_VALUE_SUGGESTIONS) {
      const valid =
        engine.isDiceFormulaValue(suggestion.value)
        || engine.validateFormula(suggestion.value).valid;

      assert.ok(valid, `${suggestion.label}: ${suggestion.value}`);
    }
  });

  it('разложена по разделам, и каждый раздел не пуст', () => {
    const sections = new Set(
      engine.EFFECT_VALUE_SUGGESTIONS.map((suggestion) => suggestion.section),
    );

    assert.deepEqual(
      [...sections],
      Object.values(engine.EFFECT_VALUE_SECTIONS),
    );
  });

  it('показывает функции формулы: ступени, округление, минимум', () => {
    const values = engine.EFFECT_VALUE_SUGGESTIONS.map(
      (suggestion) => suggestion.value,
    );

    for (const name of ['steps(', 'floor(', 'ceil(', 'max(', 'min(']) {
      assert.ok(
        values.some((value) => value.includes(name)),
        `нет примера ${name}`,
      );
    }
  });
});

describe('библиотеки условий, ключей и правил', () => {
  it('у каждой строки есть раздел', () => {
    for (const list of [
      engine.EFFECT_CONDITION_SUGGESTIONS,
      engine.EFFECT_TARGET_LIBRARY,
      engine.EFFECT_FLAG_LIBRARY,
    ]) {
      assert.ok(list.every((suggestion) => suggestion.section));
    }
  });

  it('ключей и правил столько же, сколько знает движок', () => {
    assert.equal(
      engine.EFFECT_TARGET_LIBRARY.length,
      engine.EFFECT_TARGET_SUGGESTIONS.length,
    );

    assert.equal(
      engine.EFFECT_FLAG_LIBRARY.length,
      Object.keys(engine.EFFECT_FLAG_LABELS).length,
    );
  });

  it('составное условие без доспеха и щита читается подписью', () => {
    const composite = engine.EFFECT_CONDITION_SUGGESTIONS.find((suggestion) =>
      suggestion.value.includes(engine.CONDITION_AND_SEPARATOR),
    );

    assert.ok(composite);
    assert.equal(engine.splitConditionParts(composite.value).length, 2);
  });
});

describe('меню «Готовые»', () => {
  it('урон Ярости растёт +2 → +3 → +4 по уровню класса', () => {
    const preset = findPreset(
      'Урон Ярости: +2 → +4 по уровню класса, удары Силой',
    );

    assert.ok(preset);
    assert.equal(preset.key, 'damage.melee');
    assert.equal(preset.condition, 'attack.ability === "strength"');

    const bonusAt = (classLevel) =>
      engine.evaluateFormula(preset.value, classLevelContext(classLevel));

    assert.deepEqual([1, 8, 9, 15, 16, 20].map(bonusAt), [2, 2, 3, 3, 4, 4]);
  });

  it('раздел условий броска ставит только условие', () => {
    const group = engine.EFFECT_MODIFIER_MENU.find(
      (menuGroup) => menuGroup.group === 'rollCondition',
    );

    assert.ok(group);
    assert.ok(group.items.length > 0);
    assert.ok(group.items.every((item) => item.key === '' && item.condition));
  });
});
