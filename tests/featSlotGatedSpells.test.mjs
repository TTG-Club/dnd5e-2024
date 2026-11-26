import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Заклинания черты «при ячейке круга» (`grantedSpells[].fromSlots`): черты 2024
 * «Адепт <школы>» дают заклинание, только когда у персонажа есть ячейка его круга
 * или выше — общая таблица мультикласса либо ячейки договора колдуна. Заговор —
 * всегда. Сайт сверяет то же правило, поэтому поведение должно совпадать.
 */

const engine = await loadEngineBundle(`
  export * from './src/engine/index.ts';
`);

const featEditor = await loadEngineBundle(`
  export { buildFeatData, featDataToGrants } from './src/client/ui/actor/feat/featEditorTypes.ts';
`);

/** Заклинания компендиума: заговор, 1-й и 3-й круг. */
const spells = [
  { id: 'minor-illusion', name: 'Малая иллюзия', level: 0 },
  { id: 'disguise-self', name: 'Маскировка', level: 1 },
  { id: 'hypnotic-pattern', name: 'Гипнотический узор', level: 3 },
];

const packs = [{ packId: 'phb', packName: 'PHB', spells }];

/**
 * Черта: заговор и заклинание 3 круга «при ячейке круга», плюс 1-й круг без отметки.
 *
 * @param {boolean} gated - ставить ли отметку `fromSlots`
 */
function adeptFeat(gated = true) {
  const flag = gated ? { fromSlots: true } : {};

  return {
    name: 'Адепт иллюзии',
    featData: {
      type: 'feat',
      grantedSpells: [
        { name: 'Малая иллюзия', spellId: 'minor-illusion', ...flag },
        { name: 'Маскировка', spellId: 'disguise-self' },
        { name: 'Гипнотический узор', spellId: 'hypnotic-pattern', ...flag },
      ],
    },
  };
}

/**
 * Лист персонажа с классами.
 *
 * @param {object[]} classes - классы листа
 */
function actorWith(classes) {
  return { id: 'actor', system: { classes }, spells: [] };
}

/**
 * Какие заклинания черты достанутся листу — разбор по пакам, как у клиента.
 *
 * @param {object} feat - черта
 * @param {object | undefined} actor - лист; нет — без проверок листа
 */
function grantedIds(feat, actor) {
  const sources = engine.collectFeatGrantedSpellSources(feat, actor);

  const { resolved } = engine.resolveGrantedSpellSourcesInPacks(packs, sources);

  return resolved.map((granted) => granted.spell.id);
}

const paladin5 = { classKey: 'paladin', level: 5, casterType: 'half' };
const wizard5 = { classKey: 'wizard', level: 5, casterType: 'full' };
const cleric3 = { classKey: 'cleric', level: 3, casterType: 'full' };
const wizard3 = { classKey: 'wizard', level: 3, casterType: 'full' };
const warlock5 = { classKey: 'warlock', level: 5, casterType: 'pact' };

describe('выдача черты «при ячейке круга»', () => {
  it('паладин 5 уровня не получает заклинание 3 круга', () => {
    assert.deepEqual(grantedIds(adeptFeat(), actorWith([paladin5])), [
      'minor-illusion',
      'disguise-self',
    ]);
  });

  it('волшебник 5 уровня получает заклинание 3 круга', () => {
    assert.deepEqual(grantedIds(adeptFeat(), actorWith([wizard5])), [
      'minor-illusion',
      'disguise-self',
      'hypnotic-pattern',
    ]);
  });

  it('жрец 3 / волшебник 3 получает его по общей таблице мультикласса', () => {
    assert.deepEqual(grantedIds(adeptFeat(), actorWith([cleric3, wizard3])), [
      'minor-illusion',
      'disguise-self',
      'hypnotic-pattern',
    ]);
  });

  it('колдун 5 уровня получает его ячейкой договора 3 круга', () => {
    assert.deepEqual(grantedIds(adeptFeat(), actorWith([warlock5])), [
      'minor-illusion',
      'disguise-self',
      'hypnotic-pattern',
    ]);
  });

  it('заговор с отметкой приходит и без ячеек', () => {
    const fighter5 = { classKey: 'fighter', level: 5 };

    assert.deepEqual(grantedIds(adeptFeat(), actorWith([fighter5])), [
      'minor-illusion',
      'disguise-self',
    ]);
  });

  it('заклинание появляется, когда уровень даёт ячейку нужного круга', () => {
    const wizard4 = { classKey: 'wizard', level: 4, casterType: 'full' };

    assert.ok(
      !grantedIds(adeptFeat(), actorWith([wizard4])).includes(
        'hypnotic-pattern',
      ),
    );

    assert.ok(
      grantedIds(adeptFeat(), actorWith([wizard5])).includes(
        'hypnotic-pattern',
      ),
    );
  });

  it('проверка складывается с уровнем открытия', () => {
    const feat = adeptFeat();

    feat.featData.grantedSpells[2].requiredLevel = 8;

    assert.ok(
      !grantedIds(feat, actorWith([wizard5])).includes('hypnotic-pattern'),
    );
  });

  it('без отметки и в старых данных без поля всё выдаётся как прежде', () => {
    assert.deepEqual(grantedIds(adeptFeat(false), actorWith([paladin5])), [
      'minor-illusion',
      'disguise-self',
      'hypnotic-pattern',
    ]);

    const sources = engine.collectFeatGrantedSpellSources(
      adeptFeat(false),
      actorWith([paladin5]),
    );

    assert.ok(sources.every((source) => source.maxLevel === undefined));
  });

  it('без листа граница не ставится', () => {
    assert.deepEqual(grantedIds(adeptFeat(), undefined), [
      'minor-illusion',
      'disguise-self',
      'hypnotic-pattern',
    ]);
  });

  it('копии из нескольких паков спрашиваются, только если проходят границу', () => {
    const otherPack = { packId: 'other', packName: 'Чужой', spells };

    const sources = engine.collectFeatGrantedSpellSources(
      adeptFeat(),
      actorWith([paladin5]),
    );

    const result = engine.resolveGrantedSpellSourcesInPacks(
      [packs[0], otherPack],
      sources.map((source) => ({ ...source, packId: 'homebrew' })),
    );

    assert.deepEqual(
      result.ambiguous.map((entry) => entry.source.spellId),
      ['minor-illusion', 'disguise-self'],
    );

    assert.equal(result.missing.length, 0);
  });
});

describe('повтор и снятие заклинаний «при ячейке круга»', () => {
  it('повтор того же заклинания без отметки не теряет выдачу', () => {
    const feat = {
      name: 'Адепт иллюзии',
      featData: {
        type: 'feat',
        grantedSpells: [
          {
            name: 'Гипнотический узор',
            spellId: 'hypnotic-pattern',
            fromSlots: true,
          },
          { name: 'Гипнотический узор', spellId: 'hypnotic-pattern' },
        ],
      },
    };

    assert.deepEqual(grantedIds(feat, actorWith([paladin5])), [
      'hypnotic-pattern',
    ]);
  });

  /**
   * Лист с выданными чертой заклинаниями.
   *
   * @param {object[]} classes - классы листа
   * @param {object} feat - черта на листе
   */
  function sheetWith(classes, feat) {
    return {
      id: 'actor',
      system: { classes },
      features: [{ id: 'feat-1', ...feat }],
      spells: [
        {
          id: 's0',
          name: 'Малая иллюзия',
          level: 0,
          grantedByFeature: feat.name,
        },
        { id: 's1', name: 'Маскировка', level: 1, grantedByFeature: feat.name },
        {
          id: 's3',
          name: 'Гипнотический узор',
          level: 3,
          grantedByFeature: feat.name,
        },
        { id: 'own', name: 'Огненный шар', level: 3 },
      ],
    };
  }

  it('без ячеек 3 круга снимается только закрытое заклинание черты', () => {
    const sheet = sheetWith([paladin5], adeptFeat());

    assert.deepEqual(
      engine.withdrawLockedFeatSpells(sheet).map((spell) => spell.id),
      ['s0', 's1', 'own'],
    );
  });

  it('с ячейкой 3 круга ничего не снимается — тот же массив', () => {
    const sheet = sheetWith([wizard5], adeptFeat());

    assert.equal(engine.withdrawLockedFeatSpells(sheet), sheet.spells);
  });

  it('уровень ниже уровня открытия снимает заклинание', () => {
    const feat = {
      name: 'Метка',
      featData: {
        type: 'feat',
        grantedSpells: [
          { name: 'Маскировка', spellId: 'disguise-self', requiredLevel: 3 },
        ],
      },
    };

    const sheet = sheetWith([{ ...wizard3, level: 2 }], feat);

    assert.deepEqual(
      engine.withdrawLockedFeatSpells(sheet).map((spell) => spell.id),
      ['s0', 's3', 'own'],
    );
  });

  it('то же заклинание, выданное чертой и без условия, остаётся', () => {
    const feat = {
      name: 'Адепт иллюзии',
      featData: {
        type: 'feat',
        grantedSpells: [
          {
            name: 'Гипнотический узор',
            spellId: 'hypnotic-pattern',
            fromSlots: true,
          },
          { name: 'Гипнотический узор', spellId: 'hypnotic-pattern' },
        ],
      },
    };

    const sheet = sheetWith([paladin5], feat);

    assert.equal(engine.withdrawLockedFeatSpells(sheet), sheet.spells);
  });
});

describe('редактор и сводка черты', () => {
  it('отметка переживает разбор и сборку формы и не сливает группы', () => {
    const grants = featEditor.featDataToGrants(adeptFeat().featData);

    // Отмеченные и без отметки — разные группы, хоть уровень и один
    assert.deepEqual(
      grants.grantedSpellGroups.map((group) => [
        group.fromSlots,
        group.spells.map((spell) => spell.spellId),
      ]),
      [
        [true, ['minor-illusion', 'hypnotic-pattern']],
        [false, ['disguise-self']],
      ],
    );

    const saved = featEditor.buildFeatData(grants);

    assert.deepEqual(
      saved.grantedSpells.map((ref) => [ref.spellId, ref.fromSlots]),
      [
        ['minor-illusion', true],
        ['hypnotic-pattern', true],
        ['disguise-self', undefined],
      ],
    );
  });

  it('сводка подписывает отметку', () => {
    const summary = engine.buildFeatGrantsSummary(adeptFeat());

    assert.match(summary, /Гипнотический узор \(при ячейке его круга\)/);
    assert.match(summary, /Маскировка,/);
  });
});
