import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { createActor, engine } from './scenarios/_fixtures.mjs';

/**
 * Тип урона на выбор: `@dmg.choice(…)` — тип выбирает бросающий,
 * `@dmg.random(…)` — выпадает случайно. В отличие от нескольких `@dmg.<тип>`
 * на одной кости (урон всеми типами сразу), бросок получает ровно один тип.
 */

const CHROMATIC = 'acid,cold,fire,lightning,poison,thunder';

/** Сегменты без пустых полей — для сравнения */
function split(formula, defaultType) {
  return engine
    .splitFormulaByDamageType(formula, defaultType)
    .map((segment) => ({
      formula: segment.formula,
      ...(segment.type ? { type: segment.type } : {}),
      ...(segment.types ? { types: segment.types } : {}),
      ...(segment.typeChoice ? { typeChoice: segment.typeChoice } : {}),
    }));
}

/** Развёртка частей без подстановки переменных */
function expand(parts, targetIsFull) {
  return engine
    .expandDamageParts(parts, targetIsFull, (segment) => segment)
    .map((part) => ({
      formula: part.formula,
      type: part.type,
      ...(part.typeChoice ? { typeChoice: part.typeChoice } : {}),
      ...(part.targetStatusGate
        ? { targetStatusGate: part.targetStatusGate }
        : {}),
    }));
}

/** Тип на выбор человеком */
function choose(...options) {
  return { mode: 'choose', options };
}

describe('токен «тип урона на выбор»', () => {
  it('разбирается в способ и варианты; повторы и регистр не важны', () => {
    assert.deepEqual(
      engine.readDamageTypeChoiceToken('3к8@dmg.choice(Acid, cold,acid ,fire)'),
      choose('acid', 'cold', 'fire'),
    );

    assert.deepEqual(
      engine.readDamageTypeChoiceToken('1к8@dmg.random(fire,cold)'),
      { mode: 'random', options: ['fire', 'cold'] },
    );

    assert.equal(engine.readDamageTypeChoiceToken('1к8@dmg.choice()'), null);
    assert.equal(engine.readDamageTypeChoiceToken('1к8@dmg.fire'), null);
  });

  it('не считается простым типом `choice` и снимается целиком', () => {
    assert.equal(
      engine.detectFormulaDamageType('3к8@dmg.choice(fire,cold)'),
      null,
    );

    assert.equal(
      engine.stripDamageTypeTokens('3к8@dmg.choice(fire,cold) + 2'),
      '3к8 + 2',
    );

    // Старый служебный тип без скобок остаётся типом
    assert.equal(engine.detectFormulaDamageType('1к6@dmg.choice'), 'choice');
  });

  it('собирается обратно и заменяется выбранным типом', () => {
    const token = engine.buildDamageTypeChoiceToken(choose('fire', 'cold'));

    assert.equal(token, '@dmg.choice(fire,cold)');

    assert.equal(
      engine.applyDamageTypeChoicePicks(
        `2к6${token} + 1к6@dmg.random(acid,poison)`,
        new Map([['choose:fire,cold', 'cold']]),
      ),
      '2к6@dmg.cold + 1к6@dmg.random(acid,poison)',
    );
  });

  it('выбор типа в форме заменяет тип на выбор', () => {
    assert.equal(
      engine.setFormulaDamageType('3к8@dmg.choice(fire,cold) + 2', 'acid'),
      '3к8@dmg.acid + 2',
    );
  });
});

describe('разбор формулы с типом на выбор', () => {
  it('кость с выбором — один сегмент служебного типа с вариантами', () => {
    assert.deepEqual(split(`3к8@dmg.choice(${CHROMATIC})`), [
      {
        formula: '3к8',
        type: 'choice',
        typeChoice: choose(...CHROMATIC.split(',')),
      },
    ]);
  });

  it('несколько `@dmg` на одной кости по-прежнему — урон всеми сразу', () => {
    assert.deepEqual(split('2к6@dmg.slashing@dmg.fire'), [
      { formula: '2к6', type: 'slashing', types: ['slashing', 'fire'] },
    ]);
  });

  it('сочетается с другими слагаемыми: выбор течёт вправо до нового типа', () => {
    assert.deepEqual(
      split('2к6@dmg.choice(fire,cold) + @mod.spell + 1к6@dmg.fire'),
      [
        {
          formula: '2к6 + @mod.spell',
          type: 'choice',
          typeChoice: choose('fire', 'cold'),
        },
        { formula: '1к6', type: 'fire' },
      ],
    );
  });

  it('на числе в конце закрывает свой блок', () => {
    assert.deepEqual(split('1к8+3@dmg.choice(fire,cold)'), [
      {
        formula: '1к8 + 3',
        type: 'choice',
        typeChoice: choose('fire', 'cold'),
      },
    ]);

    assert.deepEqual(
      split('1к8+3@dmg.piercing + 2к6+1@dmg.choice(fire,cold)'),
      [
        { formula: '1к8 + 3', type: 'piercing' },
        {
          formula: '2к6 + 1',
          type: 'choice',
          typeChoice: choose('fire', 'cold'),
        },
      ],
    );
  });

  it('скобки с выбором — одно слагаемое', () => {
    assert.deepEqual(split('(1к8+3)@dmg.choice(radiant,necrotic)'), [
      {
        formula: '(1к8+3)',
        type: 'choice',
        typeChoice: choose('radiant', 'necrotic'),
      },
    ]);
  });

  it('разные списки — разные сегменты, одинаковые — один', () => {
    assert.deepEqual(
      split(
        '1к6@dmg.choice(fire,cold) + 1к4@dmg.choice(acid,poison) + 2@dmg.choice(fire,cold)',
      ),
      [
        {
          formula: '1к6 + 2',
          type: 'choice',
          typeChoice: choose('fire', 'cold'),
        },
        {
          formula: '1к4',
          type: 'choice',
          typeChoice: choose('acid', 'poison'),
        },
      ],
    );
  });

  it('условие по состоянию цели сохраняет выбор у ветки', () => {
    assert.deepEqual(
      expand([
        {
          formula:
            '1к8+3@dmg.piercing + 2к6@dmg.choice(fire,cold)@target.status.prone',
        },
      ]),
      [
        { formula: '1к8 + 3', type: 'piercing' },
        {
          formula: '2к6',
          type: 'choice',
          typeChoice: choose('fire', 'cold'),
          targetStatusGate: 'prone',
        },
      ],
    );
  });

  it('описание части перечисляет выбор отдельно от типов', () => {
    const info = engine.describeDamagePart({
      formula: '2к6@dmg.choice(fire,cold) + 1к6@dmg.fire',
    });

    assert.equal(info.formula, '2к6 + 1к6');
    assert.deepEqual(info.types, ['fire']);
    assert.deepEqual(info.typeChoices, [choose('fire', 'cold')]);
  });

  it('итог в редакторе показывает варианты у слагаемого', () => {
    const preview = engine.previewDamagePart({
      formula: '1к8+3@dmg.choice(fire,cold)',
    });

    assert.deepEqual(
      preview.branches[0].segments[0].typeChoice,
      choose('fire', 'cold'),
    );

    assert.deepEqual(preview.unknownTokens, []);
  });
});

describe('решение выбора', () => {
  it('выбранный тип становится типом части, один тип на одинаковый список', () => {
    const parts = engine.expandDamageParts(
      [
        { formula: '2к6@dmg.choice(fire,cold)' },
        { formula: '1к4@dmg.choice(fire,cold)', target: 'self' },
        { formula: '1к6@dmg.fire' },
      ],
      undefined,
      (segment) => segment,
    );

    const settled = engine.settleDamageTypeChoices(
      parts,
      new Map([['choose:fire,cold', 'cold']]),
    );

    assert.deepEqual(
      settled.map((part) => [part.formula, part.type, part.typeChoice]),
      [
        ['2к6', 'cold', undefined],
        ['1к4', 'cold', undefined],
        ['1к6', 'fire', undefined],
      ],
    );
  });

  it('без выбора тип выпадает случайно — один на весь бросок', () => {
    const parts = engine.expandDamageParts(
      [
        { formula: '2к6@dmg.random(acid,cold,fire)' },
        { formula: '1к6@dmg.random(acid,cold,fire)', target: 'self' },
      ],
      undefined,
      (segment) => segment,
    );

    const settled = engine.settleDamageTypeChoices(parts, new Map(), () => 0.5);

    assert.deepEqual(
      settled.map((part) => part.type),
      ['cold', 'cold'],
    );
  });

  it('случай даёт равные шансы по списку', () => {
    const choice = {
      mode: 'random',
      options: ['acid', 'cold', 'fire', 'lightning'],
    };

    assert.equal(
      engine.rollDamageTypeChoice(choice, () => 0),
      'acid',
    );

    assert.equal(
      engine.rollDamageTypeChoice(choice, () => 0.49),
      'cold',
    );

    assert.equal(
      engine.rollDamageTypeChoice(choice, () => 0.999),
      'lightning',
    );

    assert.deepEqual(
      [
        ...engine.rollRandomDamageTypeChoices(
          [choice, choose('fire', 'cold')],
          () => 0.3,
        ),
      ],
      [['random:acid,cold,fire,lightning', 'cold']],
      'выбор человека случай не трогает',
    );
  });

  it('сопротивление применяется к выбранному типу, а не к выгоднейшему', () => {
    const hero = createActor();

    hero.system.defenses = {
      ...hero.system.defenses,
      resistances: ['fire'],
    };

    const rollFormula = (formula) => ({ total: Number(formula), values: [] });

    // Урон «всеми сразу» — цель берёт выгоднейшее сопротивление
    const both = engine.rollEffectDamageParts(
      [{ formula: '10@dmg.fire@dmg.cold' }],
      engine.resolveActorStats(hero),
      hero,
      { rollFormula },
    );

    assert.equal(both.total, 5);

    const [coldPart] = engine.applySourceDamageTypeChoices(
      { damageParts: [{ formula: '10@dmg.choice(fire,cold)' }] },
      new Map([['choose:fire,cold', 'cold']]),
    ).damageParts;

    const cold = engine.rollEffectDamageParts(
      [coldPart],
      engine.resolveActorStats(hero),
      hero,
      { rollFormula },
    );

    assert.equal(cold.total, 10, 'холод — без сопротивления');
    assert.deepEqual(cold.types, ['cold']);

    // Нерешённый выбор без спрашивающего — случай, но не урон без типа
    const unresolved = engine.rollEffectDamageParts(
      [{ formula: '10@dmg.choice(fire)' }],
      engine.resolveActorStats(hero),
      hero,
      { rollFormula },
    );

    assert.equal(unresolved.total, 5);
    assert.deepEqual(unresolved.types, ['fire']);
  });
});

describe('выбор у источника броска', () => {
  const spell = {
    id: 'chromatic-orb',
    name: 'Цветной шарик',
    damageParts: [{ formula: `3к8@dmg.choice(${CHROMATIC})` }],
    cantripScalingTiers: [
      { level: 5, parts: [{ formula: `2к8@dmg.choice(${CHROMATIC})` }] },
    ],
    activeEffects: [
      {
        id: 'zone',
        name: 'Зона',
        changes: [
          {
            key: 'damage.spell',
            mode: 'add',
            value: '1к4@dmg.random(radiant,necrotic)',
            priority: 20,
          },
        ],
        recurringDamage: {
          damageParts: [{ formula: '3к8@dmg.choice(radiant,necrotic)' }],
        },
      },
    ],
  };

  it('собирает вопросы со всех формул без повторов', () => {
    assert.deepEqual(engine.listSourceDamageTypeChoices(spell), [
      choose(...CHROMATIC.split(',')),
      choose('radiant', 'necrotic'),
      { mode: 'random', options: ['radiant', 'necrotic'] },
    ]);
  });

  it('подставляет выбор в урон, ступени заговора и эффекты', () => {
    const picked = engine.applySourceDamageTypeChoices(
      spell,
      new Map([
        [`choose:${CHROMATIC}`, 'thunder'],
        ['choose:radiant,necrotic', 'necrotic'],
        ['random:radiant,necrotic', 'radiant'],
      ]),
    );

    assert.equal(picked.damageParts[0].formula, '3к8@dmg.thunder');

    assert.equal(
      picked.cantripScalingTiers[0].parts[0].formula,
      '2к8@dmg.thunder',
    );

    assert.equal(
      picked.activeEffects[0].recurringDamage.damageParts[0].formula,
      '3к8@dmg.necrotic',
    );

    assert.equal(picked.activeEffects[0].changes[0].value, '1к4@dmg.radiant');

    // Исходное заклинание не тронуто
    assert.equal(spell.damageParts[0].formula, `3к8@dmg.choice(${CHROMATIC})`);
  });

  it('ступень заговора после выбора разворачивается выбранным типом', () => {
    const picked = engine.applySourceDamageTypeChoices(
      { ...spell, level: 0 },
      new Map([[`choose:${CHROMATIC}`, 'acid']]),
    );

    const tierParts = engine.pickCantripTierParts(picked, 5);

    assert.deepEqual(expand(tierParts), [{ formula: '2к8', type: 'acid' }]);
  });

  it('урон «или» существа тоже получает выбор', () => {
    const action = {
      id: 'breath',
      name: 'Дыхание',
      damageParts: [{ formula: '4к6@dmg.choice(fire,cold)' }],
      damageAlternatives: [
        {
          condition: 'ask',
          damageParts: [{ formula: '2к6@dmg.choice(fire,cold)' }],
        },
      ],
    };

    const picked = engine.applySourceDamageTypeChoices(
      action,
      new Map([['choose:fire,cold', 'fire']]),
    );

    assert.equal(picked.damageParts[0].formula, '4к6@dmg.fire');

    assert.equal(
      picked.damageAlternatives[0].damageParts[0].formula,
      '2к6@dmg.fire',
    );
  });
});

describe('строка урона: кнопки типа на выбор и случайного', async () => {
  const { loadHandler } = await import('./helpers/sourceHandler.mjs');

  const buildToken = await loadHandler(
    'src/client/ui/actor/utils/damageTypeChoiceToken.ts',
    'buildPickedDamageTypeChoiceToken',
    {
      buildDamageTypeChoiceToken: engine.buildDamageTypeChoiceToken,
      DAMAGE_TYPE_CHOICE_MIN_OPTIONS: 2,
    },
  );

  const ORDER = ['acid', 'cold', 'fire', 'lightning'];

  it('токен «на выбор» — в порядке справочника, а не отметки', () => {
    assert.equal(
      buildToken('choose', ['fire', 'acid'], ORDER),
      '@dmg.choice(acid,fire)',
    );
  });

  it('токен «случайно» разбирается броском как случайный', () => {
    const token = buildToken('random', ['cold', 'lightning'], ORDER);

    assert.equal(token, '@dmg.random(cold,lightning)');

    assert.deepEqual(engine.listDamageTypeChoices([`1к6${token}`]), [
      { mode: 'random', options: ['cold', 'lightning'] },
    ]);
  });

  it('из одного типа выбирать нечего — токена нет', () => {
    assert.equal(buildToken('choose', ['fire'], ORDER), null);

    assert.equal(
      buildToken('choose', ['fire', 'unknown'], ORDER),
      null,
      'незнакомый справочнику тип не считается',
    );
  });
});
