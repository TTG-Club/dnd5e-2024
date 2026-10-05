import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { systemRoot } from './helpers/engineBundle.mjs';
import { engine } from './scenarios/_fixtures.mjs';

/**
 * Список вариантов умения без настройки выбора — справочный: из него не
 * выбирают. «Мутирующая форма» друида круга мутации перечисляет 18 мутаций, и
 * друид получает любые из них за очки, — а мастер уровня требовал выбрать одну
 * («выбрано 0 из 1») и не пускал дальше. Механика вариантов такого списка
 * достаётся владельцу умения вся: выбранных у него нет.
 */

/** Включаемый эффект варианта: кнопка на листе */
function useEffect(id, name) {
  return {
    id,
    name,
    disabled: true,
    duration: { type: 'minutes', value: 10 },
    changes: [],
    flags: [],
    activation: { mode: 'use', counter: 'devourer-portion' },
  };
}

/** «Мутирующая форма»: список без настройки выбора и без механики вариантов */
const MUTABLE_SHAPE = {
  key: 'mutable-shape',
  name: 'Мутирующая форма',
  description: '',
  level: 3,
  choices: [
    { key: 'darkvision', name: 'Тёмное зрение', description: '' },
    { key: 'enlarge', name: 'Увеличение', description: '' },
    {
      key: 'mystic_monster',
      name: 'Мистический монстр',
      description: '',
      requiredLevel: 10,
    },
  ],
};

/** «Трансмутационный метаболизм»: справочный список, у мутаций свои эффекты */
const TRANSMUTATIONAL_METABOLISM = {
  key: 'transmutational-metabolism',
  name: 'Трансмутационный метаболизм',
  description: '',
  level: 3,
  choices: [
    {
      key: 'flight',
      name: 'Полёт',
      description: 'Вы получаете скорость полёта.',
      activeEffects: [useEffect('flight', 'Полёт')],
    },
    { key: 'awareness', name: 'Чуткость', description: 'Без механики.' },
    {
      key: 'acumen',
      name: 'Проницательность',
      description: 'Преимущество на проверки.',
      featData: {
        type: 'feat',
        choices: [{ key: 'skill', type: 'skill', count: 1 }],
      },
    },
    {
      key: 'regeneration',
      name: 'Регенерация',
      description: 'С 10 уровня.',
      requiredLevel: 10,
      activeEffects: [useEffect('regeneration', 'Регенерация')],
    },
  ],
};

/** «Боевое превосходство»: выбираемый список с ростом по уровням */
const COMBAT_SUPERIORITY = {
  key: 'combat-superiority',
  name: 'Боевое превосходство',
  description: '',
  level: 3,
  choiceConfig: { count: 3, progression: { 7: 5, 10: 7 } },
  choices: [
    {
      key: 'trip',
      name: 'Подсечка',
      description: '',
      activeEffects: [useEffect('trip', 'Подсечка')],
    },
    { key: 'riposte', name: 'Ответный удар', description: '' },
  ],
};

describe('справочный список вариантов не спрашивается', () => {
  it('без настройки выбора список справочный, с настройкой — выбираемый', () => {
    assert.equal(engine.isReferenceClassFeatureChoices(MUTABLE_SHAPE), true);

    assert.equal(
      engine.isReferenceClassFeatureChoices(COMBAT_SUPERIORITY),
      false,
    );

    assert.equal(
      engine.isReferenceClassFeatureChoices({ choices: [] }),
      false,
      'умение без вариантов — не список вовсе',
    );
  });

  it('мастер не спрашивает ни одного варианта ни на уровне умения, ни позже', () => {
    for (const level of [1, 3, 4, 10, 20]) {
      assert.equal(engine.classFeatureChoiceTotalAt(MUTABLE_SHAPE, level), 0);
      assert.equal(engine.newClassFeatureChoicesAt(MUTABLE_SHAPE, level), 0);
    }
  });

  it('список с настройкой спрашивается как раньше', () => {
    assert.equal(engine.newClassFeatureChoicesAt(COMBAT_SUPERIORITY, 2), 0);
    assert.equal(engine.newClassFeatureChoicesAt(COMBAT_SUPERIORITY, 3), 3);
    assert.equal(engine.newClassFeatureChoicesAt(COMBAT_SUPERIORITY, 4), 0);
    assert.equal(engine.newClassFeatureChoicesAt(COMBAT_SUPERIORITY, 7), 2);
    assert.equal(engine.classFeatureChoiceTotalAt(COMBAT_SUPERIORITY, 10), 7);

    // Настройка без числа — один вариант: так читался выбор по умолчанию
    assert.equal(
      engine.newClassFeatureChoicesAt(
        { ...COMBAT_SUPERIORITY, choiceConfig: {} },
        3,
      ),
      1,
    );
  });

  it('шаг мастера блокируют только выборы с числом: у справочного их нет', () => {
    const wizard = readFileSync(
      join(systemRoot, 'src/client/ui/actor/class/wizard/useClassWizard.ts'),
      'utf8',
    );

    // Выбор вариантов заводится только при ненулевом числе новых вариантов —
    // а его считает движок; готовность шага смотрит на те же выборы
    assert.match(
      wizard,
      /const count = Math\.min\(\s*newClassFeatureChoicesAt\(feature, level\),\s*options\.length,\s*\);\s*if \(!count\) \{\s*continue;/u,
    );

    assert.match(
      wizard,
      /featureChoicePicks\.value\.every\(\s*\(pick\) => selectedChoicesFor\(pick\.featureKey\)\.length === pick\.count/u,
    );
  });
});

describe('механика вариантов справочного списка', () => {
  it('достаётся владельцу умения вся — без выбора', () => {
    const grants = engine.collectReferenceOptionGrants(
      TRANSMUTATIONAL_METABOLISM,
      3,
    );

    assert.deepEqual(
      grants.map((grant) => grant.optionKey),
      ['flight', 'acumen'],
      'вариант без механики записи не получает, вариант 10 уровня ждёт',
    );

    const [flight, acumen] = grants;

    assert.equal(flight.featureKey, 'transmutational-metabolism');
    assert.equal(flight.name, 'Полёт');
    assert.equal(flight.description, 'Вы получаете скорость полёта.');
    assert.deepEqual(flight.activeEffects, [useEffect('flight', 'Полёт')]);

    // Вопросы варианта сужены до его области — как у выбранного варианта
    assert.equal(
      acumen.featData.choices[0].key,
      'classOption:transmutational-metabolism:acumen:skill',
    );
  });

  it('вариант со своим уровнем доступа приходит на этом уровне', () => {
    assert.deepEqual(
      engine
        .collectReferenceOptionGrants(TRANSMUTATIONAL_METABOLISM, 10)
        .map((grant) => grant.optionKey),
      ['flight', 'acumen', 'regeneration'],
    );
  });

  it('пока умения нет, у информационного умения и у выбираемого списка — пусто', () => {
    assert.deepEqual(
      engine.collectReferenceOptionGrants(TRANSMUTATIONAL_METABOLISM, 2),
      [],
    );

    assert.deepEqual(
      engine.collectReferenceOptionGrants(
        { ...TRANSMUTATIONAL_METABOLISM, isInformationalOnly: true },
        3,
      ),
      [],
    );

    assert.deepEqual(
      engine.collectReferenceOptionGrants(COMBAT_SUPERIORITY, 3),
      [],
      'у выбираемого списка механику несёт только выбранный вариант',
    );

    assert.deepEqual(
      engine.collectReferenceOptionGrants(MUTABLE_SHAPE, 10),
      [],
      'справочный список без механики листу ничего не кладёт',
    );
  });

  it('выбранный вариант выбираемого списка несёт то же, что и раньше', () => {
    const [trip] = engine.collectClassOptionGrants(COMBAT_SUPERIORITY, [
      'trip',
      'riposte',
    ]);

    assert.equal(trip.optionKey, 'trip');
    assert.equal(trip.scope, 'classOption:combat-superiority:trip:');
    assert.deepEqual(trip.activeEffects, [useEffect('trip', 'Подсечка')]);
  });

  it('мастер кладёт справочные варианты тем же путём, что и выбранные', () => {
    const wizard = readFileSync(
      join(systemRoot, 'src/client/ui/actor/class/wizard/useClassWizard.ts'),
      'utf8',
    );

    assert.match(wizard, /collectReferenceOptionGrants\(feature, level\)/u);

    // Эффекты, дары, вопросы и выданные черты читают общий список вариантов
    // уровня; мимо него — только сам сбор выбранных вариантов
    assert.match(
      wizard,
      /collectClassOptionEffects\(classDef, levelOptionGrants\.value\)/u,
    );

    assert.equal(
      wizard.match(/selectedOptionGrants\.value/gu).length,
      2,
      'выбранные варианты читают только ключи записей и общий список',
    );

    assert.equal(
      wizard.match(/of levelOptionGrants\.value/gu).length,
      4,
      'дары, источники эффектов даров, вопросы и выданные черты',
    );
  });
});
