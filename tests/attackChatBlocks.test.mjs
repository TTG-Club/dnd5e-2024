import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Блоки карточки боя в чате: бросок атаки — значком, названием, целью и
 * плашкой исхода (без слова «Атака» и без эмодзи), урон — строкой с видом
 * урона и снятыми хитами. Единственную цель называет шапка, несколько —
 * строки, без цели имени нет нигде.
 */

/** Исход броска атаки: попадание без крита */
const HIT = { isHit: true, isCriticalHit: false, isCriticalMiss: false };

/** Исход броска атаки: промах */
const MISS = { isHit: false, isCriticalHit: false, isCriticalMiss: false };

describe('buildAttackChatBlock', () => {
  it('называет удар, цель и попадание плашкой', () => {
    assert.deepEqual(
      engine.buildAttackChatBlock({
        name: 'Раздирание',
        targetName: '2А: Бард',
        result: HIT,
      }),
      {
        icon: 'tabler:sword',
        title: 'Раздирание',
        target: '2А: Бард',
        badge: { label: 'Попадание', accent: 'success' },
      },
    );
  });

  it('отмечает промах, крит и критический промах', () => {
    const badgeOf = (result) =>
      engine.buildAttackChatBlock({
        name: 'Удар',
        targetName: 'Гоблин',
        result,
      }).badge;

    assert.deepEqual(badgeOf(MISS), { label: 'Промах', accent: 'error' });

    assert.deepEqual(badgeOf({ ...HIT, isCriticalHit: true }), {
      label: 'Крит',
      accent: 'primary',
    });

    assert.deepEqual(badgeOf({ ...MISS, isCriticalMiss: true }), {
      label: 'Крит. промах',
      accent: 'error',
    });
  });

  it('ставит значок по виду атаки и пометку о помехе', () => {
    const block = engine.buildAttackChatBlock({
      name: 'Огненный снаряд',
      targetName: 'Гоблин',
      result: HIT,
      attackKind: 'spell',
      isDisadvantage: true,
    });

    assert.equal(block.icon, engine.SPELL_CHAT_ICON);
    assert.equal(block.note, 'Помеха (дальняя дистанция)');
  });
});

describe('buildDamageChatBlock', () => {
  it('показывает вид урона и снятые хиты — без шапки и без имени цели', () => {
    assert.deepEqual(
      engine.buildDamageChatBlock(
        { actorName: '2А: Бард', hpBefore: 20, hpAfter: 14 },
        'force',
      ),
      {
        rows: [
          {
            icon: 'tabler:sparkles',
            name: 'Силовой урон',
            value: '−6 HP',
            accent: 'error',
          },
        ],
      },
    );
  });

  it('пишет в подробностях временные хиты и защиту цели', () => {
    const [row] = engine.buildDamageChatBlock(
      {
        actorName: 'Гоблин',
        hpBefore: 10,
        hpAfter: 8,
        tempAbsorbed: 3,
        defenseOutcome: 'resistance',
      },
      'fire',
    ).rows;

    assert.equal(row.value, '−5 HP');
    assert.equal(row.detail, 'врем. −3 · сопротивление');
  });

  it('без цели и без броска оставляет строку с видом урона', () => {
    assert.deepEqual(engine.buildDamageChatBlock(null, undefined), {
      rows: [{ icon: 'tabler:swords', name: 'Урон' }],
    });
  });

  it('без цели ставит брошенный урон итогом строки — без строки «Без цели»', () => {
    assert.deepEqual(engine.buildDamageChatBlock(null, 'force', 9), {
      rows: [{ icon: 'tabler:sparkles', name: 'Силовой урон', value: '9' }],
    });
  });

  it('с целью итог строки — снятые хиты, а не брошенное число', () => {
    const block = engine.buildDamageChatBlock(
      { actorName: '2А: Бард', hpBefore: 20, hpAfter: 15 },
      'force',
      5,
    );

    assert.equal(block.title, undefined);
    assert.equal(block.rows[0].value, '−5 HP');
  });
});

describe('buildDamageChatRow', () => {
  const applied = { actorName: '2А: Бард', hpBefore: 20, hpAfter: 15 };

  it('называет цель в строке, только когда целей несколько', () => {
    assert.equal(
      engine.buildDamageChatRow(applied, { damageType: 'force' }).target,
      undefined,
    );

    assert.deepEqual(
      engine.buildDamageChatRow(applied, {
        damageType: 'force',
        namesTarget: true,
      }),
      {
        icon: 'tabler:sparkles',
        name: 'Силовой урон',
        target: '2А: Бард',
        value: '−5 HP',
        accent: 'error',
      },
    );
  });

  it('ставит формулу в подробности перед пометками защиты', () => {
    const row = engine.buildDamageChatRow(
      { ...applied, defenseOutcome: 'resistance' },
      { detail: '1к8 + 3 [7] = 10' },
    );

    assert.equal(row.detail, '1к8 + 3 [7] = 10 · сопротивление');
  });
});

describe('имя цели: в шапке или в строках', () => {
  it('единственную цель называет шапка, строки — нет', () => {
    assert.equal(engine.pickHeaderTargetName(['Бард']), 'Бард');
    assert.equal(engine.pickRowTargetName('Бард', 1), undefined);
  });

  it('несколько целей называют строки, шапка — нет', () => {
    assert.equal(engine.pickHeaderTargetName(['Бард', 'Гоблин']), undefined);
    assert.equal(engine.pickRowTargetName('Бард', 2), 'Бард');
  });

  it('без цели имени нет нигде', () => {
    assert.equal(engine.pickHeaderTargetName([]), undefined);

    assert.deepEqual(engine.buildActionChatHeader({ name: 'Раздирание' }), {
      title: 'Раздирание',
    });
  });

  it('шапка отдельной карточки: значок, действие и единственная цель', () => {
    assert.deepEqual(
      engine.buildActionChatHeader({
        name: 'Огненный снаряд',
        targetNames: ['Гоблин'],
        icon: engine.SPELL_CHAT_ICON,
      }),
      {
        icon: engine.SPELL_CHAT_ICON,
        title: 'Огненный снаряд',
        target: 'Гоблин',
      },
    );

    assert.deepEqual(engine.buildActionChatHeader({ name: '' }), {});
  });
});

describe('headChatBlocks', () => {
  const damageBlock = {
    rows: [
      {
        icon: 'tabler:sparkles',
        name: 'Силовой урон',
        value: '−5 HP',
        accent: 'error',
      },
    ],
  };

  const header = { title: 'Раздирание', target: '2А: Бард' };

  it('отдельной карточке ставит шапку над теми же строками урона', () => {
    assert.deepEqual(
      engine.headChatBlocks(header, [damageBlock, damageBlock]),
      [{ ...damageBlock, ...header }, damageBlock],
    );
  });

  it('без блоков оставляет одну шапку', () => {
    assert.deepEqual(engine.headChatBlocks({ title: 'Раздирание' }, []), [
      { title: 'Раздирание' },
    ]);
  });
});

describe('performTwoStageAttack', () => {
  it('кладёт блоки в броски атаки и урона, сохраняя текстовые подписи', () => {
    const rolls = [
      {
        formula: '1к20',
        total: 15,
        details: '[15]',
        dice: [
          {
            sides: 20,
            values: [15],
            dropped: [],
            critSuccesses: [],
            critFailures: [],
          },
        ],
      },
      { formula: '1к8+3', total: 6, details: '[3] + 3', dice: [] },
    ];

    const output = engine.performTwoStageAttack(
      {
        attackFormula: '1к20',
        attackModifier: 0,
        targetAc: 12,
        weaponName: 'Раздирание',
        targetName: '2А: Бард',
        damageFormula: '1к8+3',
        targetActorId: 'bard',
        damageType: 'force',
      },
      () => rolls.shift(),
      () => ({ actorName: '2А: Бард', hpBefore: 20, hpAfter: 14 }),
    );

    assert.equal(output.attackRoll.block.badge.label, 'Попадание');
    assert.equal(output.attackRoll.block.target, '2А: Бард');
    assert.match(output.attackRoll.label, /Раздирание/);
    assert.equal(output.damageRoll.block.rows[0].value, '−6 HP');
    assert.match(output.damageRoll.label, /-6\xA0HP/);
  });
});

/**
 * Хиты цели до и после в подробностях строки урона. Открытые игрокам (у
 * токена полоска хитов) видят все; скрытые (текстовое состояние) уходят в
 * подробности для мастера — их сервер игрокам не присылает.
 */
describe('хиты цели до и после', () => {
  const change = {
    hpBefore: 47,
    hpAfter: 42,
    tempBefore: 0,
    tempAfter: 0,
    isPublic: true,
  };

  it('пишет хиты, а временные — только когда они изменились', () => {
    assert.equal(engine.formatHpChangeDetail(change), 'HP: 47 → 42');

    assert.equal(
      engine.formatHpChangeDetail({ ...change, tempBefore: 5, tempAfter: 0 }),
      'HP: 47 → 42 · врем. HP: 5 → 0',
    );

    assert.equal(
      engine.formatHpChangeDetail({ ...change, hpAfter: 47 }),
      undefined,
    );
  });

  it('открытые хиты встают строкой в общие подробности', () => {
    assert.deepEqual(
      engine.withHpChangeDetail({ name: 'Урон', detail: '1к8 = 5' }, change),
      { name: 'Урон', detail: '1к8 = 5\nHP: 47 → 42' },
    );

    assert.deepEqual(engine.withHpChangeDetail({ name: 'Урон' }, change), {
      name: 'Урон',
      detail: 'HP: 47 → 42',
    });
  });

  it('скрытые хиты уходят в подробности для мастера', () => {
    assert.deepEqual(
      engine.withHpChangeDetail(
        { name: 'Урон', detail: '1к8 = 5' },
        { ...change, isPublic: false },
      ),
      { name: 'Урон', detail: '1к8 = 5', gmDetail: 'HP: 47 → 42' },
    );
  });

  it('строка урона берёт хиты из итога применения', () => {
    const applied = { actorName: 'Гоблин', hpBefore: 47, hpAfter: 42 };

    assert.equal(
      engine.buildDamageChatRow({
        ...applied,
        hpChange: { ...change, isPublic: false },
      }).gmDetail,
      'HP: 47 → 42',
    );

    const bare = engine.buildDamageChatRow(applied);

    assert.equal(bare.gmDetail, undefined);
    assert.equal(bare.detail, undefined);
  });

  it('в сводке хиты встают в названную строку цели', () => {
    const blocks = [
      { rows: [{ name: 'Рубящий урон' }, { name: 'Рубящий урон' }] },
      { rows: [{ name: 'Огненный урон' }] },
    ];

    const detailed = engine.attachHpChangeDetails(blocks, [
      { blockIndex: 1, rowIndex: 0, change },
      { blockIndex: 0, rowIndex: 1, change: { ...change, isPublic: false } },
    ]);

    assert.equal(detailed[0].rows[0].gmDetail, undefined);
    assert.equal(detailed[0].rows[1].gmDetail, 'HP: 47 → 42');
    assert.equal(detailed[1].rows[0].detail, 'HP: 47 → 42');
  });

  it('хиты открыты игрокам при полоске и скрыты при текстовом состоянии', () => {
    const actor = { entityType: 'actor', token: {} };
    const creature = { entityType: 'creature', token: {} };

    assert.equal(engine.isEntityHpShownToPlayers(actor), true);
    assert.equal(engine.isEntityHpShownToPlayers(creature), false);

    assert.equal(
      engine.isEntityHpShownToPlayers({
        ...creature,
        token: { hpDisplayMode: 'bar' },
      }),
      true,
    );

    assert.equal(
      engine.isEntityHpShownToPlayers({
        ...actor,
        token: { hpDisplayMode: 'text' },
      }),
      false,
    );
  });
});

describe('buildAttackLabel', () => {
  it('запасная подпись броска атаки — без эмодзи', () => {
    const labels = [
      { isHit: true, isCriticalHit: false, isCriticalMiss: false },
      { isHit: false, isCriticalHit: false, isCriticalMiss: false },
      { isHit: true, isCriticalHit: true, isCriticalMiss: false },
      { isHit: false, isCriticalHit: false, isCriticalMiss: true },
    ].map((result) =>
      engine.buildAttackLabel({
        weaponName: 'Раздирание',
        targetName: 'Бард',
        result,
        isDisadvantage: true,
      }),
    );

    for (const label of labels) {
      assert.doesNotMatch(label, /\p{Extended_Pictographic}/u);
    }

    assert.match(labels[0], /Попадание!$/);
    assert.match(labels[1], /Промах!$/);
  });
});
