import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Ограничения действий носителя (`actionRestrictions.ts`): флаг запрещает вид
 * траты, срабатывания с запрещённой ценой молчат и лимит не тратят.
 */

/** «Электрошок»: нет реакций до начала следующего хода */
const SHOCKING_GRASP = createEffect('Электрошок', {
  flags: ['actions.noReaction'],
  duration: { type: 'turn', value: 1 },
});

describe('ограничения действий', () => {
  it('флаг запрещает реакцию и называет эффект', () => {
    const target = createActor({ activeEffects: [SHOCKING_GRASP] });
    const block = engine.resolveActionCostBlock(target, 'reaction');

    assert.deepEqual(block, { cost: 'reaction', sourceName: 'Электрошок' });

    assert.equal(
      engine.formatActionCostBlock(block),
      'Реакция недоступна: Электрошок',
    );

    assert.equal(engine.resolveActionCostBlock(target, 'bonus'), null);
    assert.equal(engine.resolveActionCostBlock(target, 'move'), null);

    assert.equal(
      engine.resolveActionCostBlock(createActor(), 'reaction'),
      null,
    );
  });

  it('недееспособный не совершает ни действий, ни бонусных, ни реакций', () => {
    const stunned = engine.buildConditionActiveEffect('stunned');
    const target = createActor({ activeEffects: [stunned] });

    for (const cost of ['action', 'bonus', 'reaction']) {
      assert.notEqual(engine.resolveActionCostBlock(target, cost), null, cost);
    }
  });

  it('ограничение от ауры чужого токена тоже действует', () => {
    const aura = createEffect('Тревожная аура', {
      flags: ['actions.noReaction'],
    });

    const block = engine.resolveActionCostBlock(createActor(), 'reaction', [
      aura,
    ]);

    assert.equal(block?.sourceName, 'Тревожная аура');
  });

  it('срабатывание с ценой «Реакция» под запретом не выполняется и лимит не тратит', () => {
    const riposte = {
      id: 'riposte',
      event: 'attackRoll',
      role: 'target',
      cost: 'reaction',
      actions: [{ type: 'removeSelf', on: 'always' }],
    };

    const shield = createEffect('Ответный удар', { triggers: [riposte] });

    const blocked = createActor({ activeEffects: [shield, SHOCKING_GRASP] });

    const source = {
      effect: shield,
      trigger: riposte,
      ambient: false,
      instance: false,
      scope: shield.id,
    };

    assert.equal(engine.admitTrigger(blocked, source, {}, true), false);
    assert.equal(blocked.system.effectUsage, undefined, 'реакция не потрачена');

    const free = createActor({ activeEffects: [shield] });

    assert.equal(engine.admitTrigger(free, source, {}, true), true);
  });

  it('флаги — в разделе меню «Ограничения действий»', () => {
    const group = engine.EFFECT_FLAG_MENU.find(
      (entry) => entry.group === 'restrictions',
    );

    assert.deepEqual(
      group?.items.map((item) => item.key),
      [
        'actions.noReaction',
        'actions.noBonusAction',
        'actions.oneActionOrBonus',
        'spellcasting.blocked',
        'spellcasting.noVerbal',
        'concentration.blocked',
      ],
    );
  });

  it('заклинание реакцией и реакция существа гаснут, действие — нет', () => {
    const target = createActor({ activeEffects: [SHOCKING_GRASP] });

    assert.equal(
      engine.resolveSpellCastBlock(target, { castingTimeUnit: 'reaction' }),
      'Реакция недоступна: Электрошок',
    );

    assert.equal(
      engine.resolveSpellCastBlock(target, { castingTimeUnit: 'action' }),
      null,
    );

    assert.equal(
      engine.resolveSpellCastBlock(target, { castingTimeUnit: 'minute' }),
      null,
      'ритуал минутами — не трата хода',
    );

    const creature = createCreature({ activeEffects: [SHOCKING_GRASP] });
    const parry = { name: 'Парирование', description: [] };

    creature.system.reactions = [parry];

    assert.equal(
      engine.findCreatureActionSection(creature, parry),
      'reactions',
    );

    const blocks = engine.resolveEntityActionBlocks(creature);

    assert.equal(
      engine.findCreatureSectionBlock(blocks, 'reactions'),
      'Реакция недоступна: Электрошок',
    );

    assert.equal(engine.findCreatureSectionBlock(blocks, 'actions'), null);
  });

  it('«вырваться» ценой реакции под запретом не действует', () => {
    const net = createEffect('Сеть', {
      escape: { cost: 'reaction' },
    });

    const target = createActor({ activeEffects: [net, SHOCKING_GRASP] });

    assert.equal(
      engine.describeEscapeUnavailable(net, target),
      'Реакция недоступна: Электрошок',
    );

    assert.equal(engine.describeEscapeUnavailable(net, createActor()), null);
  });

  it('колдовство: общий запрет, вербальный компонент и концентрация', () => {
    const silence = createEffect('Тишина', {
      flags: ['spellcasting.noVerbal'],
    });

    const rage = createEffect('Ярость', {
      flags: ['spellcasting.blocked', 'concentration.blocked'],
    });

    const shout = { components: { verbal: true }, castingTimeUnit: 'action' };

    const gesture = {
      components: { verbal: false },
      castingTimeUnit: 'action',
    };

    const silenced = createActor({ activeEffects: [silence] });

    assert.equal(
      engine.resolveSpellCastBlock(silenced, shout),
      'Заклинание с вербальным компонентом недоступно: Тишина',
    );

    assert.equal(engine.resolveSpellCastBlock(silenced, gesture), null);

    assert.equal(
      engine.resolveSpellCastBlock(
        createActor({ activeEffects: [rage] }),
        gesture,
      ),
      'Заклинания недоступны: Ярость',
    );

    const focused = createActor({
      activeEffects: [
        createEffect('Нельзя думать', { flags: ['concentration.blocked'] }),
      ],
    });

    assert.equal(
      engine.resolveSpellCastBlock(focused, {
        ...gesture,
        concentration: true,
      }),
      'Концентрация недоступна: Нельзя думать',
    );

    assert.equal(engine.resolveSpellCastBlock(focused, gesture), null);
  });

  it('запрет концентрации прерывает текущую концентрацию при записи снимка', () => {
    const mark = engine.buildConcentrationEffect({
      spell: {
        name: 'Благословение',
        durationUnit: 'minute',
        durationValue: 1,
      },
      casterId: 'actor_hero',
      castId: 'cast_bless',
    });

    const rage = createEffect('Ярость', { flags: ['concentration.blocked'] });
    const hero = createActor({ activeEffects: [mark] });

    assert.deepEqual(engine.listBlockedConcentrationCasts(hero), []);

    const raging = structuredClone(hero);

    raging.activeEffects = [...raging.activeEffects, rage];

    const ended = [];

    new engine.Dnd5eVttSystem().settleCombatState(
      hero,
      engine.pickCombatState(raging),
      { endCasts: (casterId, castIds) => ended.push([casterId, castIds]) },
    );

    assert.deepEqual(ended, [['actor_hero', ['cast_bless']]]);
  });

  it('«Замедление»: после действия бонусное недоступно и наоборот, ход обнуляет', () => {
    const slow = createEffect('Замедление', {
      flags: ['actions.noReaction', 'actions.oneActionOrBonus'],
    });

    const target = createActor({ activeEffects: [slow] });

    assert.equal(engine.resolveActionCostBlock(target, 'bonus'), null);

    assert.equal(
      engine.recordActionSpend(target, 'reaction'),
      undefined,
      'реакцию счёт не ведёт',
    );

    const acted = {
      ...target,
      system: {
        ...target.system,
        effectUsage: engine.recordActionSpend(target, 'action'),
      },
    };

    assert.equal(
      engine.formatActionCostBlock(
        engine.resolveActionCostBlock(acted, 'bonus'),
      ),
      'Бонусное действие недоступно: Замедление',
    );

    assert.equal(engine.resolveActionCostBlock(acted, 'action'), null);

    assert.equal(
      engine.findSpellCastBlock(engine.resolveEntityActionBlocks(acted), {
        castingTimeUnit: 'bonus-action',
      }),
      'Бонусное действие недоступно: Замедление',
    );

    // Конец хода обнуляет счётчики периода «ход»
    const nextTurn = {
      ...acted,
      system: {
        ...acted.system,
        effectUsage: engine.pruneTriggerUsage(acted, ['turn']),
      },
    };

    assert.equal(engine.resolveActionCostBlock(nextTurn, 'bonus'), null);

    assert.equal(
      engine.recordActionSpend(createActor(), 'action'),
      undefined,
      'без флага ничего не пишется',
    );
  });

  it('удар оружием — действие: после бонусного под «Замедлением» недоступен', () => {
    const slow = createEffect('Замедление', {
      flags: ['actions.oneActionOrBonus'],
    });

    const target = createActor({ activeEffects: [slow] });

    assert.equal(engine.resolveWeaponAttackBlock(target), null);

    const struck = {
      ...target,
      system: {
        ...target.system,
        effectUsage: engine.recordActionSpend(
          target,
          engine.WEAPON_ATTACK_COST,
        ),
      },
    };

    assert.equal(
      engine.formatActionCostBlock(
        engine.resolveActionCostBlock(struck, 'bonus'),
      ),
      'Бонусное действие недоступно: Замедление',
      'удар тратит действие хода',
    );

    const bonusSpent = {
      ...target,
      system: {
        ...target.system,
        effectUsage: engine.recordActionSpend(target, 'bonus'),
      },
    };

    assert.equal(
      engine.resolveWeaponAttackBlock(bonusSpent),
      'Действие недоступно: Замедление',
    );
  });
});
