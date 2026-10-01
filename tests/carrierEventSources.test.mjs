import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createTrait,
  engine,
  withHp,
} from './scenarios/_fixtures.mjs';

/**
 * События о поступках носителя (`listCarrierEventSources`): бросок атаки,
 * отдых, лечение, снятое состояние слышат не только его собственные эффекты,
 * но и надетые предметы с чертами существа — как урон по носителю.
 */

/** Отметка, которую ставят срабатывания проверок */
const MARK_TAG = 'heard';

/**
 * Срабатывание, ставящее носителю отметку.
 *
 * @param {object} trigger - событие и условия
 * @returns {object} эффект
 */
function markingEffect(trigger) {
  return createEffect('Слышит', {
    triggers: [
      {
        id: 'trigger_mark',
        actions: [{ type: 'applyTag', tag: MARK_TAG }],
        ...trigger,
      },
    ],
  });
}

/**
 * Надетый предмет с эффектами.
 *
 * @param {object[]} effects - эффекты предмета
 * @param {object} overrides - надет ли, настройка
 * @returns {object} предмет
 */
function wornItem(effects, overrides = {}) {
  return {
    id: 'item_blade',
    name: 'Клинок',
    type: 'equipment',
    equipped: true,
    activeEffects: effects,
    ...overrides,
  };
}

/**
 * Стоит ли на сущности отметка проверки.
 *
 * @param {object} entity - сущность
 * @returns {boolean} `true`, если срабатывание выполнилось
 */
function isMarked(entity) {
  return (entity.activeEffects ?? []).some((effect) => effect.tag === MARK_TAG);
}

describe('события о поступках носителя: предметы и черты', () => {
  it('бросок атаки слышит надетый предмет — и на клиенте, и на сервере', () => {
    const simple = markingEffect({ event: 'attackRoll', role: 'attacker' });

    const armed = createActor({ equipment: [wornItem([simple])] });

    assert.equal(
      engine.listAttackRollSources(armed, 'attacker', 'client').length,
      1,
    );

    assert.equal(engine.runAttackRollTriggers(armed, 'attacker').changed, true);
    assert.equal(isMarked(armed), true);

    // Со спасброском или уроном — сервер: клиент узнаёт об этом и шлёт событие
    const flare = createEffect('Вспышка', {
      triggers: [
        {
          id: 'trigger_flare',
          event: 'attackRoll',
          role: 'attacker',
          recipient: 'other',
          condition: 'attack.landed === true',
          actions: [
            { type: 'damage', parts: [{ formula: '4', type: 'radiant' }] },
          ],
        },
      ],
    });

    const wielder = createActor({ equipment: [wornItem([flare])] });
    const foe = withHp(createCreature, 20);

    assert.equal(engine.hasServerAttackRollTriggers(wielder, 'attacker'), true);

    engine.settleAttackRollTriggers(wielder, 'attacker', {
      other: foe,
      roll: {},
      landed: true,
    });

    assert.equal(engine.resolveEntityCurrentHp(foe), 16);
  });

  it('снятый и ненастроенный предмет атаку не слышит', () => {
    const simple = markingEffect({ event: 'attackRoll', role: 'attacker' });

    for (const overrides of [
      { equipped: false },
      { magicAttunement: 'required', isAttuned: false },
    ]) {
      const hero = createActor({ equipment: [wornItem([simple], overrides)] });

      assert.deepEqual(
        engine.listAttackRollSources(hero, 'attacker', 'client'),
        [],
      );
    }
  });

  it('черта существа слышит его атаку', () => {
    const wolf = createCreature({
      system: {
        ...structuredClone(engine.DEFAULT_CREATURE.system),
        traits: [
          createTrait('Азарт', [
            markingEffect({ event: 'attackRoll', role: 'attacker' }),
          ]),
        ],
      },
    });

    engine.runAttackRollTriggers(wolf, 'attacker');

    assert.equal(isMarked(wolf), true);
  });

  it('отдых слышит надетый предмет: отметка остаётся на носителе', () => {
    const rested = markingEffect({ event: 'rest', restType: 'long' });
    const hero = createActor({ equipment: [wornItem([rested])] });

    assert.equal(engine.applyActorRest(hero, 'short').activeEffects, undefined);

    const effects = engine.applyActorRest(hero, 'long').activeEffects;

    assert.equal(
      effects?.some((effect) => effect.tag === MARK_TAG),
      true,
    );

    // Сущность из стора не тронута: срабатывания шли на копии
    assert.equal(isMarked(hero), false);

    assert.equal(
      engine.applyActorRest(
        createActor({ equipment: [wornItem([rested], { equipped: false })] }),
        'long',
      ).activeEffects,
      undefined,
    );
  });

  it('эффект предмета срабатывание не снимает и чужих срабатываний не дублирует', () => {
    const own = markingEffect({ event: 'attackRoll', role: 'attacker' });

    const consumed = createEffect('Разовый', {
      triggers: [
        {
          id: 'trigger_once',
          event: 'attackRoll',
          role: 'attacker',
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    const hero = createActor({
      activeEffects: [own],
      equipment: [wornItem([consumed])],
    });

    const sources = engine.listAttackRollSources(hero, 'attacker', 'client');

    assert.deepEqual(
      sources.map((source) => [source.effect.name, source.instance]),
      [
        ['Слышит', true],
        ['Разовый', false],
      ],
    );

    engine.runAttackRollTriggers(hero, 'attacker');

    assert.equal(hero.equipment[0].activeEffects.length, 1);
  });
});
