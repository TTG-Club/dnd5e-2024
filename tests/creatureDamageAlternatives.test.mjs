import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/** Укус химеры: 2к6+4 колющего */
const BITE = [{ formula: '2к6+4', type: 'piercing' }];

/** Укус химеры с преимуществом: 4к6+4 колющего */
const ADVANTAGE_BITE = [{ formula: '4к6+4', type: 'piercing' }];

/** Другой луч: 2к6 огнём */
const FIRE_RAY = [{ formula: '2к6', type: 'fire' }];

/** Случайность на самый край списка */
const LAST_ROLL = 0.99;

/** Укусы роя 2024: основной урон и вариант окровавленного роя */
const SWARM = {
  name: 'Рой хватающих рук',
  damageParts: [{ formula: '4к8@dmg.necrotic + 2' }],
  damageAlternatives: [
    {
      condition: 'ask',
      damageParts: [{ formula: '2к8@dmg.necrotic@self.status.bloodied + 2' }],
    },
  ],
};

/**
 * Действие химеры с вариантами урона.
 *
 * @param {object[]} alternatives - варианты урона
 * @returns {object} действие существа
 */
function bite(alternatives) {
  return {
    name: 'Укус',
    description: [],
    attackBonus: 7,
    damageParts: BITE,
    damageAlternatives: alternatives,
  };
}

describe('выбор урона «или» у действия существа', () => {
  it('без вариантов атака идёт основным уроном', () => {
    const choice = engine.chooseCreatureActionDamage({ damageParts: BITE });

    assert.equal(choice.kind, 'resolved');
    assert.equal(choice.option.damageParts, BITE);
    assert.equal(choice.rolled, undefined, 'выбирать было не из чего');
  });

  it('вариант с состоянием в формуле берётся сам, когда состояние есть', () => {
    const bloodied = engine.chooseCreatureActionDamage(SWARM, {
      selfHasStatus: (status) => status === 'bloodied',
    });

    assert.equal(bloodied.kind, 'resolved');
    assert.equal(bloodied.matched, true);

    assert.equal(
      bloodied.option.damageParts[0].formula,
      '2к8@dmg.necrotic@self.status.bloodied + 2',
    );
  });

  it('состояния нет — вариант выпадает, вопроса нет, идёт основной урон', () => {
    const healthy = engine.chooseCreatureActionDamage(SWARM, {
      selfHasStatus: () => false,
    });

    assert.equal(healthy.kind, 'resolved');
    assert.equal(healthy.matched, undefined);
    assert.equal(healthy.option.damageParts[0].formula, '4к8@dmg.necrotic + 2');
  });

  it('состояние цели без цели не выполнено', () => {
    const mimic = bite([
      {
        condition: 'ask',
        damageParts: [{ formula: '2к8@target.status.grappled + 3' }],
      },
    ]);

    assert.equal(
      engine.chooseCreatureActionDamage(mimic, {}).option.damageParts,
      BITE,
      'область или цель не выбрана',
    );

    assert.equal(
      engine.chooseCreatureActionDamage(mimic, {
        targetHasStatus: (status) => status === 'grappled',
      }).matched,
      true,
    );
  });

  it('нужны все состояния варианта', () => {
    const action = bite([
      {
        condition: 'ask',
        damageParts: [
          { formula: '1к8@self.status.bloodied' },
          { formula: '1к6@target.status.prone' },
        ],
      },
    ]);

    assert.equal(
      engine.chooseCreatureActionDamage(action, {
        selfHasStatus: () => true,
      }).option.damageParts,
      BITE,
      'цель не лежит',
    );
  });

  it('из сработавших по состоянию берётся верхний', () => {
    const choice = engine.chooseCreatureActionDamage(
      bite([
        { condition: 'ask', damageParts: FIRE_RAY },
        {
          condition: 'ask',
          damageParts: [{ formula: '4к6+4@self.status.prone' }],
        },
        {
          condition: 'random',
          damageParts: [{ formula: '2к6@self.status.bloodied' }],
        },
      ]),
      { selfHasStatus: () => true },
    );

    assert.equal(choice.kind, 'resolved');

    assert.equal(
      choice.option.damageParts[0].formula,
      '4к6+4@self.status.prone',
    );
  });

  it('варианты без состояний: «на выбор» — вопрос, основной урон первым', () => {
    const choice = engine.chooseCreatureActionDamage(
      bite([
        {
          condition: 'ask',
          label: 'С преимуществом',
          damageParts: ADVANTAGE_BITE,
        },
        // С состоянием, которого нет, — в вопрос не попадает
        {
          condition: 'ask',
          damageParts: [{ formula: '1к4@self.status.bloodied' }],
        },
      ]),
      { selfHasStatus: () => false },
    );

    assert.equal(choice.kind, 'ask');
    assert.equal(choice.options.length, 2);
    assert.equal(choice.options[0].damageParts, BITE);
    assert.equal(choice.options[1].alternative.label, 'С преимуществом');
  });

  it('«случайно» выпадает само: основной и варианты равны', () => {
    const action = bite([{ condition: 'random', damageParts: FIRE_RAY }]);

    const first = engine.chooseCreatureActionDamage(action, {}, () => 0);
    const last = engine.chooseCreatureActionDamage(action, {}, () => LAST_ROLL);

    assert.equal(first.rolled, true);
    assert.equal(first.option.damageParts, BITE);
    assert.deepEqual(last.option.damageParts, FIRE_RAY);
  });

  it('случайность вне [0, 1) не выводит за список', () => {
    const action = bite([{ condition: 'random', damageParts: FIRE_RAY }]);

    assert.deepEqual(
      engine.chooseCreatureActionDamage(action, {}, () => 1).option.damageParts,
      FIRE_RAY,
    );

    assert.equal(
      engine.chooseCreatureActionDamage(action, {}, () => -1).option
        .damageParts,
      BITE,
    );
  });

  it('фраза условия: состояния из формулы либо способ выбора', () => {
    assert.equal(
      engine.describeCreatureDamageCondition(SWARM.damageAlternatives[0]),
      'если у атакующего: Окровавленный',
    );

    assert.equal(
      engine.describeCreatureDamageCondition({
        condition: 'ask',
        damageParts: [{ formula: '2к8@target.status.grappled' }],
      }),
      'если у цели: Схваченный',
    );

    assert.equal(
      engine.describeCreatureDamageCondition({ condition: 'random' }),
      'случайно',
    );
  });

  it('битые варианты выпадают, соседние остаются', () => {
    const action = bite([
      // Способ прежней версии
      { condition: 'selfStatus', status: 'bloodied', damageParts: FIRE_RAY },
      { condition: 'ask', damageParts: [{ formula: '  ' }] },
      { condition: 'ask' },
      'мусор',
      { condition: 'random', label: '  ', damageParts: FIRE_RAY },
    ]);

    const alternatives = engine.listCreatureDamageAlternatives(action);

    assert.equal(alternatives.length, 1);
    assert.equal(alternatives[0].condition, 'random');
    assert.equal('label' in alternatives[0], false, 'пустая подпись не нужна');

    assert.deepEqual(
      engine.listCreatureDamageAlternatives({ damageAlternatives: 'нет' }),
      [],
    );
  });

  it('вариантов не больше предела', () => {
    const many = Array.from({ length: 9 }, () => ({
      condition: 'ask',
      damageParts: FIRE_RAY,
    }));

    assert.equal(
      engine.listCreatureDamageAlternatives(bite(many)).length,
      engine.MAX_CREATURE_DAMAGE_ALTERNATIVES,
    );
  });

  it('действие для броска несёт выбранный урон и без вариантов', () => {
    const action = bite([{ condition: 'ask', damageParts: ADVANTAGE_BITE }]);

    const chosen = engine.applyCreatureDamageOption(action, {
      damageParts: ADVANTAGE_BITE,
    });

    assert.equal(chosen.damageParts, ADVANTAGE_BITE);
    assert.equal(chosen.damageAlternatives, undefined);
    assert.equal(chosen.attackBonus, 7, 'остальное действие не трогается');
    assert.equal(action.damageParts, BITE, 'исходник не меняется');
  });
});

/**
 * Настоящий выбор урона при атаке с портами: плашка и чат записываются.
 *
 * @param {number} roll - что выпадет у случайного выбора
 * @param {object} context - проверки состояний сторон
 * @returns {Promise<object>} выбор и записи
 */
async function loadChoice(roll = 0, context = {}) {
  const modals = [];
  const messages = [];

  const run = await loadHandler(
    'src/client/composables/creatureDamageChoice.ts',
    'runWithCreatureDamageChoice',
    {
      ...engine,
      chooseCreatureActionDamage: (action, damageContext) =>
        engine.chooseCreatureActionDamage(action, damageContext, () => roll),
      buildDamageContext: () => context,
      useSystemDataStore: () => ({ damageTypes: [] }),
      useChatStore: () => ({ sendMessage: (text) => messages.push(text) }),
      useModalManager: () => ({
        openModal: (name, props) => modals.push({ name, props }),
      }),
      isTypeOnlyChoice: () => false,
      formatOptionLabel: (option) =>
        option.alternative?.label ?? option.damageParts[0].formula,
      makeLabelsUnique: (labels) => labels,
      readChoiceReason: (choice) => {
        if (choice.matched) {
          return choice.option.alternative;
        }

        return choice.rolled ? { condition: 'random' } : undefined;
      },
      CREATURE_DAMAGE_CHOICE_LABELS: {
        chatSeparator: ': ',
        reasonOpen: ' (',
        reasonClose: ')',
      },
    },
  );

  return { run, modals, messages };
}

describe('атака действием с уроном «или»', () => {
  it('без вариантов атака идёт сразу тем же действием', async () => {
    const { run, modals, messages } = await loadChoice();
    const action = { name: 'Коготь', damageParts: BITE };

    let proceeded;

    run(action, {}, (chosen) => {
      proceeded = chosen;
    });

    assert.equal(proceeded, action);
    assert.equal(modals.length, 0);
    assert.equal(messages.length, 0);
  });

  it('сработавшее состояние называется в чате', async () => {
    const { run, messages } = await loadChoice(0, {
      selfHasStatus: (status) => status === 'bloodied',
    });

    let proceeded;

    run(SWARM, {}, (chosen) => {
      proceeded = chosen;
    });

    assert.equal(
      proceeded.damageParts[0].formula,
      '2к8@dmg.necrotic@self.status.bloodied + 2',
    );

    assert.deepEqual(messages, [
      'Рой хватающих рук: 2к8@dmg.necrotic@self.status.bloodied + 2 (если у атакующего: Окровавленный)',
    ]);
  });

  it('«случайно» бросает само и называет выпавшее в чате', async () => {
    const { run, modals, messages } = await loadChoice(LAST_ROLL);

    let proceeded;

    run(
      bite([{ condition: 'random', damageParts: FIRE_RAY }]),
      {},
      (chosen) => {
        proceeded = chosen;
      },
    );

    assert.equal(modals.length, 0);
    assert.deepEqual(proceeded.damageParts, FIRE_RAY);
    assert.deepEqual(messages, ['Укус: 2к6 (случайно)']);
  });

  it('вариант «на выбор» уходит в окно броска наборами, без плашки', async () => {
    const { run, modals, messages } = await loadChoice();

    let proceeded;
    let proceededVariants;

    run(
      bite([
        {
          condition: 'ask',
          label: 'С преимуществом',
          damageParts: ADVANTAGE_BITE,
        },
      ]),
      {},
      (chosen, variants) => {
        proceeded = chosen;
        proceededVariants = variants;
      },
    );

    assert.equal(modals.length, 0, 'плашки нет — выбирают в окне');

    assert.deepEqual(
      proceededVariants.map((variant) => variant.label),
      ['2к6+4', 'С преимуществом'],
    );

    // Окно открывается с первым набором — основным уроном
    assert.equal(proceeded, proceededVariants[0].action);
    assert.equal(proceeded.damageAlternatives, undefined);
    assert.deepEqual(proceededVariants[1].action.damageParts, ADVANTAGE_BITE);

    assert.deepEqual(
      messages,
      [],
      'чат называет набор при броске, а не сейчас',
    );
  });
});

/** Цветной плевок крылатого кобольда: один тип урона из пяти на выбор */
const SPIT = {
  name: 'Цветной плевок',
  damageParts: [{ formula: '1к6+3@dmg.acid' }],
  damageAlternatives: [
    ['Холод', 'cold'],
    ['Огонь', 'fire'],
    ['Электричество', 'lightning'],
    ['Яд', 'poison'],
  ].map(([label, type]) => ({
    condition: 'ask',
    label,
    damageParts: [{ formula: `1к6+3@dmg.${type}` }],
  })),
};

/**
 * Выбор урона при атаке с настоящими подписями наборов: сводка частей,
 * подписи наборов и уникальность — из исходника, названия типов — из
 * справочника системы.
 *
 * @param {number} roll - что выпадет у случайного выбора
 * @returns {Promise<object>} выбор и строки чата
 */
async function loadLabelledChoice(roll = 0) {
  const source = 'src/client/composables/creatureDamageChoice.ts';
  const messages = [];

  const { CREATURE_DAMAGE_CHOICE_LABELS, damageTypes } = await loadEngineBundle(
    `export { CREATURE_DAMAGE_CHOICE_LABELS } from './src/client/ui/creature/constants.ts';
     export { default as damageTypes } from './src/engine/damage-types.json';`,
  );

  // Тип на выбор в этих действиях не пишется — его подпись не нужна
  const summarizeDamageParts = await loadHandler(
    source,
    'summarizeDamageParts',
    { ...engine, formatDamageTypeChoiceLabel: () => '' },
  );

  const formatDamagePartsText = await loadHandler(
    source,
    'formatDamagePartsText',
    { summarizeDamageParts, CREATURE_DAMAGE_CHOICE_LABELS },
  );

  const ports = {
    ...engine,
    summarizeDamageParts,
    formatDamagePartsText,
    CREATURE_DAMAGE_CHOICE_LABELS,
  };

  const summarizeFixedTypeParts = await loadHandler(
    source,
    'summarizeFixedTypeParts',
    ports,
  );

  const labelPorts = { ...ports, summarizeFixedTypeParts };

  const isTypeOnlyChoice = await loadHandler(
    source,
    'isTypeOnlyChoice',
    labelPorts,
  );

  const formatOptionLabel = await loadHandler(
    source,
    'formatOptionLabel',
    labelPorts,
  );

  const makeLabelsUnique = await loadHandler(source, 'makeLabelsUnique', ports);

  const readChoiceReason = await loadHandler(source, 'readChoiceReason', {
    RANDOM_CONDITION: 'random',
  });

  const run = await loadHandler(source, 'runWithCreatureDamageChoice', {
    ...ports,
    chooseCreatureActionDamage: (action, damageContext) =>
      engine.chooseCreatureActionDamage(action, damageContext, () => roll),
    buildDamageContext: () => ({}),
    useSystemDataStore: () => ({ damageTypes }),
    useChatStore: () => ({ sendMessage: (text) => messages.push(text) }),
    isTypeOnlyChoice,
    formatOptionLabel,
    makeLabelsUnique,
    readChoiceReason,
  });

  return { run, messages };
}

/**
 * Подписи наборов в поле «Урон» окна броска.
 *
 * @param {Function} run - выбор урона при атаке
 * @param {object} action - действие существа
 * @returns {string[]} подписи по порядку наборов
 */
function listVariantLabels(run, action) {
  let labels = [];

  run(action, {}, (_chosen, variants) => {
    labels = variants.map((variant) => variant.label);
  });

  return labels;
}

describe('подписи наборов в поле «Урон»', () => {
  it('отличаются только типом — все названы типом из справочника', async () => {
    const { run } = await loadLabelledChoice();

    assert.deepEqual(listVariantLabels(run, SPIT), [
      'Кислотный: 1к6+3',
      'Холодный: 1к6+3',
      'Огненный: 1к6+3',
      'Электрический: 1к6+3',
      'Ядовитый: 1к6+3',
    ]);
  });

  it('тип на выбор в варианте — не «только тип», подписи свои', async () => {
    const { run } = await loadLabelledChoice();

    const labels = listVariantLabels(run, {
      ...SPIT,
      damageAlternatives: [
        {
          condition: 'ask',
          label: 'Стихия',
          damageParts: [{ formula: '1к6+3@dmg.choice(cold,fire)' }],
        },
      ],
    });

    assert.equal(labels[0], 'Основной урон: 1к6+3 кислотный');
    assert.match(labels[1], /^Стихия: 1к6\+3/);
  });

  it('варианты отличаются формулой — основной назван «Основной урон»', async () => {
    const { run } = await loadLabelledChoice();

    const labels = listVariantLabels(
      run,
      bite([
        {
          condition: 'ask',
          label: 'С преимуществом',
          damageParts: ADVANTAGE_BITE,
        },
      ]),
    );

    assert.deepEqual(labels, [
      'Основной урон: 2к6+4 колющий',
      'С преимуществом: 4к6+4 колющий',
    ]);

    // «Разбег»: тот же тип, но другие кости и лишняя часть
    const charge = listVariantLabels(
      run,
      bite([
        {
          condition: 'ask',
          label: 'Разбег',
          damageParts: [...BITE, { formula: '2к6', type: 'piercing' }],
        },
      ]),
    );

    assert.equal(charge[0], 'Основной урон: 2к6+4 колющий');
  });

  it('хоть один вариант с другой формулой — подпись общая', async () => {
    const { run } = await loadLabelledChoice();

    const labels = listVariantLabels(
      run,
      bite([
        {
          condition: 'ask',
          label: 'Огонь',
          damageParts: [{ formula: '2к6+4@dmg.fire' }],
        },
        {
          condition: 'ask',
          label: 'С преимуществом',
          damageParts: ADVANTAGE_BITE,
        },
      ]),
    );

    assert.equal(labels[0], 'Основной урон: 2к6+4 колющий');
    assert.equal(labels[1], 'Огонь: 2к6+4 огненный');
  });

  it('подписи остаются уникальными', async () => {
    const { run } = await loadLabelledChoice();

    const labels = listVariantLabels(
      run,
      bite([{ condition: 'ask', label: 'Колющий', damageParts: BITE }]),
    );

    assert.deepEqual(labels, ['Колющий: 2к6+4', 'Колющий: 2к6+4 (2)']);
  });

  it('без вариантов действие идёт как есть, подписей нет', async () => {
    const { run, messages } = await loadLabelledChoice();
    const action = { name: 'Коготь', damageParts: BITE };

    let proceeded;
    let proceededVariants;

    run(action, {}, (chosen, variants) => {
      proceeded = chosen;
      proceededVariants = variants;
    });

    assert.equal(proceeded, action);
    assert.equal(proceededVariants.length, 0);
    assert.deepEqual(messages, []);
  });

  it('основной урон выпал случаем — в чате подпись и пометка «случайно»', async () => {
    const { run, messages } = await loadLabelledChoice(0);

    const random = {
      ...SPIT,
      damageAlternatives: SPIT.damageAlternatives.map((alternative) => ({
        ...alternative,
        condition: 'random',
      })),
    };

    run(random, {}, () => {});

    run(
      bite([{ condition: 'random', damageParts: ADVANTAGE_BITE }]),
      {},
      () => {},
    );

    assert.deepEqual(messages, [
      'Цветной плевок: Кислотный: 1к6+3 (случайно)',
      'Укус: Основной урон: 2к6+4 колющий (случайно)',
    ]);
  });
});

describe('окно действия сохраняет урон «или» чистым', () => {
  it('пустые части и варианты не пишутся, подпись обрезается', async () => {
    const form = {
      damageAlternatives: [
        {
          condition: 'ask',
          label: '  С преимуществом ',
          damageParts: [
            { formula: '4к6+4', type: 'piercing' },
            { formula: '' },
          ],
        },
        { condition: 'random', label: ' ', damageParts: [{ formula: ' ' }] },
        { condition: 'random', label: '   ', damageParts: FIRE_RAY },
      ],
    };

    const build = await loadHandler(
      'src/client/ui/creature/CreatureActionFormModal.vue',
      'buildDamageAlternatives',
      { form },
    );

    // Обработчик собран в своей песочнице: сравниваем данные, а не прототипы
    assert.deepEqual(JSON.parse(JSON.stringify(build())), [
      {
        condition: 'ask',
        label: 'С преимуществом',
        damageParts: [{ formula: '4к6+4', type: 'piercing' }],
      },
      { condition: 'random', damageParts: FIRE_RAY },
    ]);
  });
});

describe('показ варианта', () => {
  it('состояния-условия не пишутся в формулу варианта', () => {
    const [alternative] = engine.listCreatureDamageAlternatives(SWARM);

    assert.deepEqual(
      engine
        .readAlternativeShownParts(alternative)
        .map((part) => engine.describeDamagePart(part).formula),
      ['2к8 + 2'],
    );

    // Для броска вариант не тронут: состояние в нём остаётся условием
    assert.equal(
      alternative.damageParts[0].formula,
      '2к8@dmg.necrotic@self.status.bloodied + 2',
    );
  });
});

describe('способ «по формуле»', () => {
  it('стоит у нового варианта', () => {
    assert.equal(engine.DEFAULT_CREATURE_DAMAGE_CONDITION, 'formula');
  });

  it('без состояний в формуле вариант не берётся и не предлагается', () => {
    const action = {
      damageParts: BITE,
      damageAlternatives: [{ condition: 'formula', damageParts: FIRE_RAY }],
    };

    const choice = engine.chooseCreatureActionDamage(action, {}, () => 0.99);

    assert.equal(choice.kind, 'resolved');
    assert.deepEqual(choice.option.damageParts, BITE);
    assert.equal(choice.rolled, undefined);
  });

  it('с состоянием берётся сам, когда оно есть', () => {
    const action = {
      ...SWARM,
      damageAlternatives: [
        { ...SWARM.damageAlternatives[0], condition: 'formula' },
      ],
    };

    const choice = engine.chooseCreatureActionDamage(action, {
      selfHasStatus: (status) => status === 'bloodied',
    });

    assert.equal(choice.kind, 'resolved');
    assert.equal(choice.matched, true);
  });
});
