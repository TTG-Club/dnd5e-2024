import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'vitest';

import { loadEngineBundle, systemRoot } from '../helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

/**
 * Скрытая атака — общий механизм эффекта (этап 1): «или» в условиях, условия
 * оружия, ключ `sneakAttack.damage`, прибавка костей, зависимые строки, лимит
 * хода, вариант урона существа «с преимуществом», замена старой кнопки.
 */

/** Числа носителя: уровень в классе подставлен, остальное — по месту */
function formulaContext(level = 5) {
  return {
    abilities: {},
    prof: 3,
    level,
    classLevel: level,
    movement: { walk: 30, swim: 0, fly: 0, climb: 0, burrow: 0 },
  };
}

/** Эффект с одной или несколькими строками */
function effect(id, changes, extra = {}) {
  return { id, name: id, flags: [], changes, ...extra };
}

/** Строка эффекта */
function change(key, value, condition) {
  return {
    key,
    mode: 'add',
    value,
    priority: 20,
    ...(condition ? { condition } : {}),
  };
}

/** Скрытая атака плута с условием по правилам */
const rogueSneak = effect('class-effect:rogue:effect-rogue-phb-sneak-attack', [
  change(
    engine.SNEAK_ATTACK_DAMAGE_KEY,
    engine.SNEAK_ATTACK_DICE_FORMULA.replace('@classLevel', '5'),
    engine.SNEAK_ATTACK_CONDITION,
  ),
]);

/** Союзник рядом с целью, дееспособный */
const allyNearTarget = {
  currentHp: 10,
  maxHp: 10,
  adjacentAllies: [{ conditions: [] }],
};

/** Контекст удара оружием */
function weaponRoll({
  advantage = false,
  disadvantage = false,
  properties = [],
  rangeType = 'melee',
  target,
} = {}) {
  return {
    hasAdvantage: advantage,
    hasDisadvantage: disadvantage,
    itemId: 'weapon',
    weaponProperties: properties,
    weaponRangeType: rangeType,
    ...(target ? { target } : {}),
  };
}

describe('«или» в условиях', () => {
  it('[F07c] группы «или», внутри — «и»; «и» связывает сильнее', () => {
    assert.deepEqual(engine.splitConditionGroups('a && b || c'), [
      ['a', 'b'],
      ['c'],
    ]);

    assert.equal(
      engine.joinConditionGroups([['a', 'b'], ['c']]),
      'a && b || c',
    );
  });

  it('[F07b] бросок: выполнена хоть одна группа целиком', () => {
    const condition =
      'roll.hasAdvantage === true || target.allyAdjacent && roll.hasDisadvantage === false';

    assert.equal(
      engine.evaluateCondition(condition, weaponRoll({ advantage: true })),
      true,
    );

    assert.equal(
      engine.evaluateCondition(
        condition,
        weaponRoll({ target: allyNearTarget }),
      ),
      true,
    );

    assert.equal(
      engine.evaluateCondition(
        condition,
        weaponRoll({ disadvantage: true, target: allyNearTarget }),
      ),
      false,
      'союзник рядом, но помеха',
    );

    assert.equal(engine.evaluateCondition(condition, weaponRoll()), false);
  });

  it('[F07c] условие с «или» не считается по листу: эффект только в бросках', () => {
    assert.equal(
      engine.isRollOnlyEffect({
        rollCondition: 'self.armor === "none" || self.armor === "light"',
      }),
      true,
    );

    assert.equal(
      engine.isRollOnlyEffect({ rollCondition: 'self.armor === "none"' }),
      false,
    );
  });

  it('[F07c] бонус «при атаке Силой» с «или» остаётся условием броска', () => {
    assert.equal(
      engine.readAbilityDamageScope(
        change(
          'damage.melee',
          '2',
          'attack.ability === "strength" || attack.ability === "dexterity"',
        ),
      ),
      undefined,
    );
  });

  it('[F07c] подпись читает «или»; условие Скрытой атаки — одной подписью', () => {
    assert.equal(
      engine.describeEffectChangeCondition(
        'roll.hasAdvantage === true || roll.hasDisadvantage === true',
      ),
      'Бросок: уже идёт с преимуществом или Бросок: уже идёт с помехой',
    );

    assert.equal(
      engine.describeEffectChangeCondition(engine.SNEAK_ATTACK_CONDITION),
      'Скрытая атака возможна: подходящее оружие, преимущество или союзник рядом с целью',
    );
  });

  it('[F07c] срабатывание: «или» в условии и раскрытие скобок при дописывании', () => {
    assert.equal(
      engine.writeTriggerCondition(['a || b', 'c']),
      'a && c || b && c',
    );

    assert.deepEqual(engine.readTriggerConditionParts('a || b'), ['a || b']);
  });
});

describe('условие Скрытой атаки по правилам', () => {
  const holds = (context) =>
    engine.evaluateCondition(engine.SNEAK_ATTACK_CONDITION, context);

  it('[F07] фехтовальное оружие с преимуществом', () => {
    assert.equal(
      holds(weaponRoll({ advantage: true, properties: ['finesse'] })),
      true,
    );
  });

  it('[F07] фехтовальное, союзник рядом, без помехи — да; с помехой — нет', () => {
    assert.equal(
      holds(weaponRoll({ properties: ['finesse'], target: allyNearTarget })),
      true,
    );

    assert.equal(
      holds(
        weaponRoll({
          properties: ['finesse'],
          target: allyNearTarget,
          disadvantage: true,
        }),
      ),
      false,
    );
  });

  it('[F07i] погашенная помеха — помехи нет: окно шлёт обычный режим', () => {
    assert.equal(
      holds(weaponRoll({ properties: ['finesse'], target: allyNearTarget })),
      true,
    );
  });

  it('[F07] недееспособный союзник не считается', () => {
    assert.equal(
      holds(
        weaponRoll({
          properties: ['finesse'],
          target: {
            ...allyNearTarget,
            adjacentAllies: [{ conditions: ['incapacitated'] }],
          },
        }),
      ),
      false,
    );
  });

  it('[F07d] лук — дальнобойное оружие; брошенный топорик — нет', () => {
    assert.equal(
      holds(weaponRoll({ advantage: true, rangeType: 'ranged' })),
      true,
    );

    const handaxe = {
      id: 'handaxe',
      rangeType: 'melee',
      weaponProperties: ['light', 'thrown'],
    };

    const thrown = engine.withWeaponAttackKind(handaxe, 'ranged');

    assert.equal(thrown.rangeType, 'ranged');
    assert.equal(thrown.sourceRangeType, 'melee');

    assert.equal(
      holds(
        weaponRoll({
          advantage: true,
          properties: thrown.weaponProperties,
          rangeType: thrown.sourceRangeType,
        }),
      ),
      false,
    );
  });

  it('[F07d] брошенный кинжал — фехтовальный: Скрытая атака есть', () => {
    const dagger = engine.withWeaponAttackKind(
      {
        id: 'dagger',
        rangeType: 'melee',
        weaponProperties: ['finesse', 'light', 'thrown'],
      },
      'ranged',
    );

    assert.equal(
      holds(
        weaponRoll({
          advantage: true,
          properties: dagger.weaponProperties,
          rangeType: dagger.sourceRangeType,
        }),
      ),
      true,
    );
  });

  it('[F07n] у действия существа оружия нет — ветки про оружие не выполняются', () => {
    assert.equal(holds({ hasAdvantage: true, hasDisadvantage: false }), false);
  });
});

describe('какая Скрытая атака пойдёт', () => {
  it('[F07] кости по уровню класса: 5-й уровень плута — 3к6', () => {
    const plan = engine.resolveSneakAttack(
      [rogueSneak],
      weaponRoll({ advantage: true, properties: ['finesse'] }),
      formulaContext(),
    );

    assert.equal(plan?.formula, '3к6');
  });

  it('[F07] условия не выполнены — Скрытой атаки нет', () => {
    assert.equal(
      engine.resolveSneakAttack(
        [rogueSneak],
        weaponRoll({ properties: ['finesse'] }),
        formulaContext(),
      ),
      undefined,
    );
  });

  it('[F07g] два источника — наибольший, не сумма', () => {
    const item = effect('dagger-of-sneak', [
      change(
        engine.SNEAK_ATTACK_DAMAGE_KEY,
        '1к6',
        'roll.hasAdvantage === true',
      ),
    ]);

    const plan = engine.resolveSneakAttack(
      [item, rogueSneak],
      weaponRoll({ advantage: true, properties: ['finesse'] }),
      formulaContext(),
    );

    assert.equal(plan?.formula, '3к6');
    assert.equal(plan?.sourceName, rogueSneak.name);
  });

  it('[F07f] прибавка костей увеличивает выбранный источник', () => {
    const feat = effect('feat', [
      change(engine.SNEAK_ATTACK_DICE_KEY, '1'),
      // Прибавка со своим условием, которое не выполнено, не идёт
      change(
        engine.SNEAK_ATTACK_DICE_KEY,
        '2',
        'roll.hasDisadvantage === true',
      ),
    ]);

    const plan = engine.resolveSneakAttack(
      [rogueSneak, feat],
      weaponRoll({ advantage: true, properties: ['finesse'] }),
      formulaContext(),
    );

    assert.equal(plan?.formula, '4к6');
  });

  it('[F07k] уровень своего класса у мультиклассера: плут 3, воин 5 — 2к6', () => {
    const multiclass = {
      id: 'hero',
      type: 'actor',
      system: {
        classes: [
          { classKey: 'rogue', level: 3 },
          { classKey: 'fighter', level: 5 },
        ],
      },
    };

    const unbound = effect('class-effect:rogue:effect-rogue-phb-sneak-attack', [
      change(
        engine.SNEAK_ATTACK_DAMAGE_KEY,
        engine.SNEAK_ATTACK_DICE_FORMULA,
        engine.SNEAK_ATTACK_CONDITION,
      ),
    ]);

    const [bound] = engine.bindClassLevels([unbound], multiclass);

    const plan = engine.resolveSneakAttack(
      [bound],
      weaponRoll({ advantage: true, properties: ['finesse'] }),
      formulaContext(8),
    );

    assert.equal(plan?.formula, '2к6');
  });

  it('[F07e] зависимая строка предмета идёт только со Скрытой атакой', () => {
    const knife = effect(
      'knife',
      [change('damage.weapon', '1к6', engine.SNEAK_ATTACK_APPLIED_CONDITION)],
      { carriedItemId: 'weapon' },
    );

    const rollWith = (sneakAttack) =>
      engine.collectBonusDamageFormulas([knife], 'damage.melee', {
        ...weaponRoll({ advantage: true, properties: ['finesse'] }),
        sneakAttack,
      });

    assert.deepEqual(rollWith(true), [{ formula: '1к6' }]);
    assert.deepEqual(rollWith(false), []);
  });

  it('[F07] строка Скрытой атаки — не бонус урона: обычный сбор её не берёт', () => {
    assert.deepEqual(
      engine.collectBonusDamageFormulas([rogueSneak], 'damage.melee', {
        ...weaponRoll({ advantage: true, properties: ['finesse'] }),
      }),
      [],
    );
  });

  it('[F07] крит удваивает кости Скрытой атаки, как любую часть урона', () => {
    assert.equal(engine.doubleDiceInFormula('3к6'), '6к6');
  });

  it('[F07f] кости прибавляются и убираются, но не ниже нуля', () => {
    assert.equal(engine.addDiceToFormula('3к6', 2), '5к6');
    assert.equal(engine.addDiceToFormula('3к6', -5), '0к6');
    assert.equal(engine.addDiceToFormula('к6', 1), '2к6');
  });
});

describe('лимит раз в ход', () => {
  /** Сущность с журналом */
  function withLedger(ledger) {
    return { id: 'hero', system: { effectUsage: ledger } };
  }

  it('[F07h] одна копилка по метке: расход и проверка', () => {
    const spent = engine.applyTriggerUsageChanges(
      {},
      engine.buildSneakAttackSpend(),
    );

    assert.equal(engine.isSneakAttackSpent({}), false);
    assert.equal(engine.isSneakAttackSpent(spent), true);
    assert.equal(engine.SNEAK_ATTACK_USAGE_KEY, 'tag:sneakAttack|sneakAttack');
  });

  it('[F07h] конец хода сбрасывает расход', () => {
    const spent = engine.applyTriggerUsageChanges(
      {},
      engine.buildSneakAttackSpend(),
    );

    assert.equal(
      engine.pruneTriggerUsage(withLedger(spent), ['turn']),
      undefined,
    );
  });

  it('[F07h] отмена урона возвращает ровно один расход', () => {
    const twice = {
      [engine.SNEAK_ATTACK_USAGE_KEY]: { used: 2, per: 'turn' },
      other: { used: 1, per: 'round' },
    };

    assert.deepEqual(engine.releaseSneakAttackUsage(withLedger(twice)), {
      other: { used: 1, per: 'round' },
      [engine.SNEAK_ATTACK_USAGE_KEY]: { used: 1, per: 'turn' },
    });

    assert.deepEqual(
      engine.releaseSneakAttackUsage(
        withLedger({
          [engine.SNEAK_ATTACK_USAGE_KEY]: { used: 1, per: 'turn' },
        }),
      ),
      {},
    );
  });

  it('[F07] настройка листа: по умолчанию добавляется сама', () => {
    assert.equal(engine.readSneakAttackAutoAdd({ system: {} }), true);

    assert.equal(
      engine.readSneakAttackAutoAdd({ system: { sneakAttackAutoAdd: false } }),
      false,
    );
  });
});

describe('вариант урона существа «с преимуществом»', () => {
  const goblin = {
    name: 'Скимитар',
    damageParts: [{ formula: '1к6+2@dmg.slashing' }],
    damageAlternatives: [
      {
        condition: 'formula',
        label: 'С преимуществом',
        damageParts: [{ formula: '1к6+2@dmg.slashing + 1к4@roll.advantage' }],
      },
    ],
  };

  it('[F07o] решает окно: вопрос с пометкой набора', () => {
    const choice = engine.chooseCreatureActionDamage(goblin);

    assert.equal(choice.kind, 'ask');
    assert.equal(choice.options.length, 2);
    assert.equal(choice.options[0].whenAdvantage, undefined);
    assert.equal(choice.options[1].whenAdvantage, true);
  });

  it('[F07o] токен снимается с выбранного набора и с показа', () => {
    const choice = engine.chooseCreatureActionDamage(goblin);
    const chosen = engine.applyCreatureDamageOption(goblin, choice.options[1]);

    assert.equal(chosen.damageParts[0].formula, '1к6+2@dmg.slashing + 1к4');

    assert.equal(
      engine.readAlternativeShownParts(goblin.damageAlternatives[0])[0].formula,
      '1к6+2@dmg.slashing + 1к4',
    );
  });

  it('[F07o] подпись условия и признак «берётся сам»', () => {
    const [alternative] = engine.listCreatureDamageAlternatives(goblin);

    assert.equal(
      engine.describeCreatureDamageCondition(alternative),
      'если атака с преимуществом',
    );

    assert.equal(engine.isAutomaticAlternative(alternative), true);
  });
});

describe('замена старой кнопки Скрытой атаки на листе', () => {
  const legacy = effect(
    'class-effect:rogue:effect-rogue-phb-sneak-attack',
    [],
    {
      activation: { mode: 'use' },
    },
  );

  const other = effect('class-effect:rogue:effect-rogue-phb-expertise', []);

  // Кнопка Хитрого удара начинается так же — её снимает только этап 3
  const cunningMinus = effect(
    'class-effect:rogue:effect-rogue-phb-sneak-attack-minus-1',
    [],
    { activation: { mode: 'use' } },
  );

  it('[F07m] старая кнопка заменяется новой строкой; повтор ничего не меняет', () => {
    const migrated = engine.migrateLegacySneakAttackEffects(
      [other, cunningMinus, legacy],
      [rogueSneak],
    );

    assert.deepEqual(
      migrated?.map((entry) => entry.id),
      [other.id, cunningMinus.id, rogueSneak.id],
    );

    assert.ok(engine.hasSneakAttackSource(migrated ?? []));

    assert.equal(
      engine.migrateLegacySneakAttackEffects(migrated ?? [], [rogueSneak]),
      undefined,
    );
  });

  it('[F07m] в определении класса ещё старая кнопка — лист не трогается', () => {
    assert.equal(
      engine.migrateLegacySneakAttackEffects([legacy], [legacy]),
      undefined,
    );
  });
});

describe('одна причина преимущества у невидимого', () => {
  it('«Невидимый» без второй строки «цель не видит атакующего»', () => {
    const invisible = {
      id: 'inv',
      name: 'Невидимый',
      changes: [],
      flags: ['attack.advantage', 'vision.invisible'],
    };

    const reasons = engine.explainAttackRollMode({
      attackType: 'melee',
      attackerFlags: new Set(['attack.advantage']),
      attackerEffects: [invisible],
      rollContext: { hasAdvantage: false, hasDisadvantage: false },
      targetFlags: new Set(),
      targetEffects: [],
      isBeyondNormalRange: false,
      isAttackerUnseen: true,
    });

    assert.deepEqual(reasons.advantage, ['Невидимый']);
  });

  it('из темноты без эффекта — причина зрения остаётся', () => {
    const reasons = engine.explainAttackRollMode({
      attackType: 'melee',
      attackerFlags: new Set(),
      attackerEffects: [],
      rollContext: { hasAdvantage: false, hasDisadvantage: false },
      targetFlags: new Set(),
      targetEffects: [],
      isBeyondNormalRange: false,
      isAttackerUnseen: true,
    });

    assert.deepEqual(reasons.advantage, ['цель не видит атакующего']);
  });
});

describe('окно атаки', () => {
  /** Исходник окна броска: проверки устройства, которое движком не проверить */
  const modal = readFileSync(
    join(systemRoot, 'src/client/ui/actor/DiceRollModal.vue'),
    'utf8',
  );

  it('[F07l] цель сменилась при открытом окне — режим считается заново', () => {
    assert.match(
      modal,
      /watch\(\s*\(\) => targetStore\.targetTokenId,[\s\S]*?props\.resolveRollMode\(\)/u,
    );
  });

  it('[F07j] без цели «союзник рядом» не проверить: работает только преимущество', () => {
    const holds = (context) =>
      engine.evaluateCondition(engine.SNEAK_ATTACK_CONDITION, context);

    assert.equal(holds(weaponRoll({ properties: ['finesse'] })), false);

    assert.equal(
      holds(weaponRoll({ advantage: true, properties: ['finesse'] })),
      true,
    );
  });

  it('[F07h] лимит тратится, только когда кости брошены в урон: после попадания', () => {
    const missReturn = modal.indexOf(
      '// На промахе урона нет — и Скрытая атака не тратится',
    );

    const spend = modal.indexOf('props.sneakAttack?.spend(');

    assert.ok(missReturn > 0 && spend > missReturn);
  });
});

describe('доработки после ревью', () => {
  /** Исходник окна броска */
  const modal = readFileSync(
    join(systemRoot, 'src/client/ui/actor/DiceRollModal.vue'),
    'utf8',
  );

  /** Запись урона удара со Скрытой атакой, потраченной в ходу «1:0» */
  const record = {
    label: 'Кинжал',
    critical: false,
    sourceId: 'rogue',
    sneakAttackTurn: '1:0',
    parts: [
      { formula: '1к4+4', types: ['piercing'] },
      {
        formula: '3к6',
        types: ['piercing'],
        label: 'Скрытая атака',
        sneakAttack: true,
      },
      { formula: '1к6', types: ['piercing'] },
    ],
    targets: [
      {
        entityId: 'goblin',
        name: 'Гоблин',
        hpLost: 10,
        tempLost: 0,
        contributions: [
          { part: 0, scale: 1 },
          { part: 1, scale: 1 },
          { part: 2, scale: 1 },
        ],
      },
    ],
  };

  it('[F07h] А → отмена → Б потратил лимит → «Нанести урон» по А идёт без Скрытой атаки', () => {
    const plan = engine.planSneakAttackReapply(record, '1:0', true);

    assert.equal(plan.spend, false);

    assert.deepEqual(
      plan.record.parts.map((part) => part.formula),
      ['1к4+4', '1к6'],
    );

    assert.deepEqual(plan.record.targets[0].contributions, [
      { part: 0, scale: 1 },
      { part: 1, scale: 1 },
    ]);

    assert.equal(plan.record.sneakAttackTurn, undefined);
  });

  it('[F07h] лимит свободен — повтор тратит его; другой ход — кости есть, расхода нет', () => {
    assert.deepEqual(engine.planSneakAttackReapply(record, '1:0', false), {
      record,
      spend: true,
    });

    assert.deepEqual(engine.planSneakAttackReapply(record, '2:0', true), {
      record,
      spend: false,
    });
  });

  it('[F07h] запись урона помнит кости Скрытой атаки', () => {
    const parsed = engine.parseAttackDamageRecord(
      engine.serializeAttackDamageRecord(record),
    );

    assert.equal(parsed?.parts[1].sneakAttack, true);
    assert.equal(parsed?.sneakAttackTurn, '1:0');
  });

  it('[F07h] два окна одного клиента: лимит перепроверяется в момент броска', () => {
    assert.match(
      modal,
      /const rollContext = buildLiveRollContext\(\);\s*const bonusParts =\s*rollEvaluateBonusDamageParts\.value\?\.\(rollContext\)/u,
    );

    assert.match(modal, /props\.sneakAttack\?\.isSpent\(\)/u);
  });

  it('[F07l] пересчёт идёт по фишке цели, ручной режим игрока остаётся', () => {
    assert.match(
      modal,
      /watch\(\s*\(\) => targetStore\.targetTokenId,[\s\S]*?attackRollMode\.value = manualRollMode\.value \?\? mode;/u,
    );

    assert.doesNotMatch(
      modal,
      /@click\.left\.exact\.prevent="attackRollMode = /u,
    );
  });

  it('[F07d] удар луком вплотную — не «дальнобойное оружие»', () => {
    const bow = { id: 'bow', rangeType: 'ranged', weaponProperties: [] };
    const melee = engine.withWeaponAttackKind(bow, 'melee');
    const shot = engine.withWeaponAttackKind(bow, 'ranged');

    assert.equal(melee.sourceRangeType ?? melee.rangeType, 'melee');
    assert.equal(shot.sourceRangeType ?? shot.rangeType, 'ranged');
  });

  it('[F07p] стая: счётчик лимита — на записи, без фишки в ключе', () => {
    assert.doesNotMatch(engine.SNEAK_ATTACK_USAGE_KEY, /token/u);
  });

  it('[F07n] готовое условие существа без оружия', () => {
    const holds = (context) =>
      engine.evaluateCondition(engine.SNEAK_ATTACK_CREATURE_CONDITION, context);

    assert.equal(holds({ hasAdvantage: true, hasDisadvantage: false }), true);

    assert.equal(
      holds({
        hasAdvantage: false,
        hasDisadvantage: false,
        target: allyNearTarget,
      }),
      true,
    );

    assert.equal(holds({ hasAdvantage: false, hasDisadvantage: false }), false);
  });

  it('[F07c] «или» у ключа листа помечается как недействующее', () => {
    const ignored = (key, condition) =>
      engine.isIgnoredAlternativesCondition({ key, condition });

    assert.equal(
      ignored(
        'armorClass',
        'self.armor === "light" || self.armor === "medium"',
      ),
      true,
    );

    assert.equal(
      ignored(
        'movement.walk',
        'self.armor === "none" || self.armor === "light"',
      ),
      true,
    );

    assert.equal(
      ignored(
        'armorClass',
        'incoming.attackType === "ranged" || incoming.attackType === "spell"',
      ),
      false,
    );

    assert.equal(
      ignored('damage.melee', 'roll.hasAdvantage === true || x'),
      false,
    );

    assert.equal(ignored('armorClass', 'self.armor === "light"'), false);
  });
});
