import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle(
  `
      export * from './src/engine/grantedSpells.ts';
      export * from './src/engine/preparedSpells.ts';
    `,
);

/** Запись листа с полями, от которых зависит подготовка. */
function createSpell(name, level, fields = {}) {
  return { id: name, name, level, ...fields };
}

/** «Заклинания Домена Жизни» так, как их отдаёт выгрузка компендиума. */
const lifeDomainSpells = {
  key: 'zaklinania-domena-zizni',
  name: 'Заклинания Домена Жизни',
  level: 3,
  grantedSpells: ['aid-phb', 'bless-phb'],
  grantedSpellsByLevel: { 5: ['revivify-phb'] },
  featData: {
    grantedSpellsAlwaysPrepared: true,
    spellcastingAbility: 'wisdom',
    grantedSpells: [
      { name: 'Подмога', spellId: 'aid-phb', requiredLevel: 3 },
      { name: 'Благословение', spellId: 'bless-phb', requiredLevel: 3 },
      { name: 'Низшее воскрешение', spellId: 'revivify-phb', requiredLevel: 5 },
    ],
  },
};

it('domain spells open by class level and arrive always prepared as class grants', () => {
  const atThird = engine.collectGrantedSpellSourcesForClassLevel(
    [lifeDomainSpells],
    3,
  );

  assert.deepEqual(
    atThird.map((source) => source.spellId),
    ['aid-phb', 'bless-phb'],
  );

  assert.ok(atThird.every((source) => source.alwaysPrepared === true));
  assert.ok(atThird.every((source) => source.grantKind === 'class'));
  assert.equal(atThird[0].castingAbility, 'wisdom');

  assert.deepEqual(
    engine
      .collectGrantedSpellSourcesForClassLevel([lifeDomainSpells], 5)
      .map((source) => source.spellId),
    ['revivify-phb'],
  );

  const sheet = engine.appendGrantedSpells(
    [],
    atThird.map((source) => ({
      spell: createSpell(source.spellId, 1),
      featureName: source.featureName,
      alwaysPrepared: source.alwaysPrepared,
      grantKind: source.grantKind,
    })),
  );

  assert.ok(sheet.every((spell) => spell.prepared && spell.alwaysPrepared));
  assert.ok(sheet.every((spell) => spell.grantKind === 'class'));
  assert.ok(sheet.every((spell) => engine.isSpellReady(spell)));
  assert.ok(sheet.every((spell) => !engine.canTogglePrepared(spell)));
  assert.ok(sheet.every((spell) => !engine.countsTowardPreparedSpells(spell)));
});

it('an old sheet gets the lost domain mark back and keeps what the player prepared', () => {
  const spells = [
    createSpell('Благословение', 1, {
      grantedByFeature: 'Заклинания Домена Жизни',
      prepared: false,
      alwaysPrepared: false,
    }),
    createSpell('Усиление', 1, { prepared: true }),
  ];

  const synced = engine.syncClassGrantedSpells(spells, [lifeDomainSpells]);

  assert.equal(synced[0].alwaysPrepared, true);
  assert.equal(synced[0].prepared, true);
  assert.equal(synced[0].grantKind, 'class');
  assert.equal(synced[1], spells[1]);

  // Второй проход ничего не меняет — лист не отправляется повторно
  assert.equal(
    engine.syncClassGrantedSpells(synced, [lifeDomainSpells]),
    synced,
  );
});

it('the sync never takes the mark away and ignores grants of species or feats', () => {
  const necromancer = {
    name: 'Книга заклинаний некроманта',
    level: 3,
    featData: { grantedSpellsAlwaysPrepared: false },
  };

  const spells = [
    createSpell('Смерть', 1, {
      grantedByFeature: 'Книга заклинаний некроманта',
      alwaysPrepared: true,
      prepared: true,
      grantKind: 'class',
    }),
    createSpell('Свет', 0, {
      grantedByFeature: 'Заклинания Домена Жизни',
      grantKind: 'species',
    }),
  ];

  assert.equal(
    engine.syncClassGrantedSpells(spells, [necromancer, lifeDomainSpells]),
    spells,
  );
});

it('cantrips count by source: book marks and class grants, never species, feats or thaumaturge', () => {
  const spells = [
    createSpell('book-marked', 0, { prepared: true }),
    createSpell('book-unmarked', 0, { prepared: false }),
    createSpell('class-choice', 0, {
      grantedByFeature: 'Использование заклинаний',
      grantKind: 'class',
      alwaysPrepared: false,
    }),
    createSpell('thaumaturge', 0, {
      grantedByFeature: 'Чудотворец',
      grantKind: 'class',
      alwaysPrepared: true,
    }),
    createSpell('species', 0, {
      grantedByFeature: 'Тифлинг',
      grantKind: 'species',
      alwaysPrepared: true,
    }),
    createSpell('magic-initiate', 0, {
      grantedByFeature: 'Посвящённый в магию',
      grantKind: 'feat',
      alwaysPrepared: false,
    }),
    // Выдано до появления вида выдачи: считается как прежде
    createSpell('legacy', 0, {
      grantedByFeature: 'Использование заклинаний',
      alwaysPrepared: false,
    }),
  ];

  assert.deepEqual(
    spells
      .filter((spell) => engine.countsTowardCantrips(spell))
      .map((spell) => spell.name),
    ['book-marked', 'class-choice', 'legacy'],
  );

  // Лист, чьи заговоры ещё не разобраны: книга считается целиком
  assert.equal(
    spells.filter((spell) => engine.countsTowardCantrips(spell, false)).length,
    4,
  );
});

it('prepared spells count book and class list grants but not feat or species grants', () => {
  const spells = [
    createSpell('book', 1, { prepared: true }),
    createSpell('class-list', 1, {
      prepared: true,
      alwaysPrepared: false,
      grantedByFeature: 'Использование заклинаний',
      grantKind: 'class',
    }),
    createSpell('feat', 1, {
      prepared: true,
      alwaysPrepared: false,
      grantedByFeature: 'Посвящённый в магию',
      grantKind: 'feat',
    }),
    createSpell('domain', 1, {
      prepared: true,
      alwaysPrepared: true,
      grantedByFeature: 'Заклинания домена',
      grantKind: 'class',
    }),
  ];

  assert.deepEqual(
    spells
      .filter((spell) => engine.countsTowardPreparedSpells(spell))
      .map((spell) => spell.name),
    ['book', 'class-list'],
  );
});

it('book cantrips without a mark take the free places of the cantrip column', () => {
  const spells = [
    createSpell('granted', 0, {
      grantedByFeature: 'Использование заклинаний',
      grantKind: 'class',
    }),
    createSpell('marked', 0, { prepared: true }),
    createSpell('first', 0, { prepared: false }),
    createSpell('second', 0, { prepared: false }),
    createSpell('bless', 1, { prepared: false }),
  ];

  const settled = engine.settleBookCantrips(
    spells,
    3,
    (spell) => spell.prepared !== true,
  );

  assert.deepEqual(
    settled.map((spell) => spell.prepared),
    [undefined, true, true, false, false],
  );

  // Предела нет — отмечаются все
  assert.ok(
    engine
      .settleBookCantrips(spells, null, (spell) => spell.prepared !== true)
      .filter((spell) => spell.level === 0 && !spell.grantedByFeature)
      .every((spell) => spell.prepared),
  );
});

it('class lists open on their class level and again when slots give a new circle', () => {
  const spellcasting = {
    key: 'spellcasting',
    name: 'Использование заклинаний',
    level: 1,
    grantedClassSpells: [
      {
        classKeys: ['sorcerer'],
        requiredLevel: 1,
        level: 1,
        alwaysPrepared: false,
      },
      {
        classKeys: ['sorcerer'],
        requiredLevel: 3,
        level: 2,
        alwaysPrepared: false,
      },
    ],
  };

  const atFirst = engine.collectClassSpellListOffers([spellcasting], 1, {
    before: 0,
    after: 1,
  });

  assert.equal(atFirst.length, 1);

  assert.deepEqual(
    atFirst[0].requests.map((request) => request.level),
    [1],
  );

  assert.equal(atFirst[0].requests[0].grantKind, 'class');

  assert.equal(
    engine.collectClassSpellListOffers([spellcasting], 2, {
      before: 1,
      after: 1,
    }).length,
    0,
  );

  const bySlots = {
    key: 'magic',
    name: 'Магия',
    level: 1,
    featData: {
      grantedClassSpells: [{ classKeys: ['druid'], fromSlots: true }],
    },
  };

  const grown = engine.collectClassSpellListOffers([bySlots], 3, {
    before: 1,
    after: 2,
  });

  assert.equal(grown[0].requests[0].maxLevel, 2);

  assert.equal(
    engine.collectClassSpellListOffers([bySlots], 4, { before: 2, after: 2 })
      .length,
    0,
  );
});

it('a grown prepared limit reopens the class lists opened on earlier levels', () => {
  // Бард: круг открывается на 1, 3, 5 уровне, а предел подготовки растёт на каждом
  const spellcasting = {
    key: 'spellcasting',
    name: 'Использование заклинаний',
    level: 1,
    grantedClassSpells: [
      {
        classKeys: ['bard'],
        requiredLevel: 1,
        level: 1,
        alwaysPrepared: false,
      },
      {
        classKeys: ['bard'],
        requiredLevel: 3,
        level: 2,
        alwaysPrepared: false,
      },
      {
        classKeys: ['bard'],
        requiredLevel: 5,
        level: 3,
        alwaysPrepared: false,
      },
    ],
  };

  /** Круги списков, которые мастер предложит на уровне. */
  function offeredCircles(classLevel, slotLevels, preparedLimit) {
    return engine
      .collectClassSpellListOffers(
        [spellcasting],
        classLevel,
        slotLevels,
        preparedLimit,
      )
      .flatMap((offer) => offer.requests.map((request) => request.level));
  }

  // 2 уровень: нового круга нет, а готовят пять вместо четырёх — добор из 1 круга
  assert.deepEqual(
    offeredCircles(2, { before: 1, after: 1 }, { before: 4, after: 5 }),
    [1],
  );

  // 3 уровень: новый круг и добор из всех открытых
  assert.deepEqual(
    offeredCircles(3, { before: 1, after: 2 }, { before: 5, after: 6 }),
    [1, 2],
  );

  // Предел не вырос и круга нет — спрашивать нечего
  assert.deepEqual(
    offeredCircles(4, { before: 2, after: 2 }, { before: 7, after: 7 }),
    [],
  );

  // Таблица предела не даёт — как прежде, только новая группа уровня
  assert.deepEqual(
    offeredCircles(3, { before: 1, after: 2 }, { before: null, after: null }),
    [2],
  );

  // Класс берётся впервые (мультикласс): предела «до» нет вовсе
  assert.deepEqual(
    offeredCircles(1, { before: 0, after: 1 }, { before: null, after: 4 }),
    [1],
  );

  // Группа «не выше доступного круга» открывается ростом предела с нынешним кругом
  const bySlots = {
    key: 'magic',
    name: 'Магия',
    level: 1,
    grantedClassSpells: [{ classKeys: ['druid'], fromSlots: true }],
  };

  const [reopened] = engine.collectClassSpellListOffers(
    [bySlots],
    4,
    { before: 2, after: 2 },
    { before: 6, after: 7 },
  );

  assert.equal(reopened.requests[0].maxLevel, 2);

  // Список с отметкой «не готовить» в предел не входит и его ростом не открывается
  const alwaysPrepared = {
    key: 'domain',
    name: 'Домен',
    level: 1,
    grantedClassSpells: [
      {
        classKeys: ['cleric'],
        requiredLevel: 1,
        level: 1,
        alwaysPrepared: true,
      },
    ],
  };

  assert.equal(
    engine.collectClassSpellListOffers(
      [alwaysPrepared],
      2,
      { before: 1, after: 1 },
      { before: 4, after: 5 },
    ).length,
    0,
  );
});

it('the wizard reopens lists by the class table and counts picks against the free prepared places', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { systemRoot } = await import('./helpers/engineBundle.mjs');

  const wizard = readFileSync(
    join(systemRoot, 'src/client/ui/actor/class/wizard/useClassWizard.ts'),
    'utf8',
  );

  // Предел класса до уровня и после — из одной и той же таблицы записи класса
  assert.match(
    wizard,
    /\{\s*before: classPreparedValue\(actor\.value, classDef\),\s*after: classPreparedValue\(pendingActor\.value, classDef\),\s*\},\s*\);/u,
  );

  // Свободные места — предел листа без уже подготовленного
  const roomStart = wizard.indexOf('const preparedSpellsRoom = computed');

  const roomBody = wizard.slice(
    roomStart,
    wizard.indexOf('\n  });', roomStart),
  );

  assert.ok(roomBody.includes('preparedSpellsLimit.value'));
  assert.ok(roomBody.includes('countsTowardPreparedSpells'));
  assert.ok(roomBody.includes('Math.max(0, limit - prepared)'));

  const step = readFileSync(
    join(
      systemRoot,
      'src/client/ui/actor/class/wizard/WizardStepClassSpellList.vue',
    ),
    'utf8',
  );

  // Счётчик окна берёт свободные места, а не всю норму таблицы
  assert.match(
    step,
    /props\.preparedRoom !== null && props\.preparedRoom > 0\s*\? props\.preparedRoom\s*: props\.preparedValue/u,
  );

  assert.ok(step.includes('CLASS_SPELL_LIST_LABELS.preparedRoomPrefix'));

  const setup = readFileSync(
    join(systemRoot, 'src/client/ui/actor/class/ClassSetupWizard.vue'),
    'utf8',
  );

  assert.ok(setup.includes(':prepared-room="preparedSpellsRoom"'));
});

it('the sync does not guess between features or references with the same name', () => {
  const spells = [
    createSpell('Благословение', 1, {
      grantedByFeature: 'Заклинания Домена Жизни',
      alwaysPrepared: false,
    }),
  ];

  // Два умения с одним названием — какое выдало заклинание, не угадать
  const twin = { ...lifeDomainSpells, key: 'twin' };

  assert.equal(
    engine.syncClassGrantedSpells(spells, [lifeDomainSpells, twin]),
    spells,
  );

  // Две ссылки с одним названием и разными отметками — решает отметка выдачи
  const mixed = {
    ...lifeDomainSpells,
    featData: {
      grantedSpellsAlwaysPrepared: false,
      grantedSpells: [
        { name: 'Благословение', spellId: 'bless-a', alwaysPrepared: true },
        { name: 'Благословение', spellId: 'bless-b', alwaysPrepared: true },
      ],
    },
  };

  const synced = engine.syncClassGrantedSpells(spells, [mixed]);

  assert.equal(synced[0].alwaysPrepared, false);
  assert.equal(synced[0].grantKind, 'class');
});

it('class list offers keep the feature key so two features with one name stay apart', () => {
  const [offer] = engine.collectClassSpellListOffers(
    [
      {
        key: 'sorcerer-spellcasting',
        name: 'Использование заклинаний',
        level: 1,
        grantedClassSpells: [{ classKeys: ['sorcerer'], level: 1 }],
      },
    ],
    1,
    { before: 0, after: 1 },
  );

  assert.equal(offer.requests[0].featureKey, 'sorcerer-spellcasting');

  const [source] = engine.expandClassSpellRequests(offer.requests, [
    {
      packId: 'phb',
      spells: [createSpell('chromatic-orb', 1, { classKeys: ['sorcerer'] })],
    },
  ]);

  assert.equal(source.featureKey, 'sorcerer-spellcasting');
});
