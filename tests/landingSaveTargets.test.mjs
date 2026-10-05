import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadHandler } from './helpers/sourceHandler.mjs';
import { loadTargetEffectResolution } from './helpers/targetEffectResolution.mjs';
import {
  createCreature,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Спасбросок самого действия спрашивают только у цели, которой он что-то
 * решает: «Ужасающий облик» привидения не заставляет бросать нежить и тех,
 * кто к нему уже невосприимчив, — урона у действия нет, а эффекты на них не
 * лягут.
 */

const partsPath = 'src/client/composables/useSpellDamageWithParts.ts';
const singlePath = 'src/client/composables/useSpellResolution.ts';

const GHOST_ID = 'creature_ghost';

/** Сл «Ужасающего облика» */
const VISAGE_DC = 13;

/** Условие наложения: не нежить */
const NOT_UNDEAD = 'self.creatureType !== "undead"';

/** Испуг «Ужасающего облика» с уроном эффекта, как в компендиуме */
const VISAGE_FRIGHT = createEffect('Испуганный', {
  effectTarget: 'target',
  conditionKey: 'frightened',
  landingCondition: NOT_UNDEAD,
  damageParts: [{ formula: '2d6+3@dmg.psychic', target: 'selected' }],
});

/** Испуг без урона: решает только состояние */
const PLAIN_FRIGHT = createEffect('Испуг', {
  effectTarget: 'target',
  conditionKey: 'frightened',
  landingCondition: NOT_UNDEAD,
});

/**
 * Действие существа со спасброском Мудрости и без своего урона.
 *
 * @param {object[]} effects - эффекты действия
 * @returns {object} псевдо-заклинание действия
 */
function visageOf(effects) {
  return {
    ...engine.buildUseSpell({
      id: 'action_visage',
      name: 'Ужасающий облик',
      effects,
      rollSource: 'creatureAction',
    }),
    saveType: 'wisdom',
  };
}

/**
 * Существо заданного типа.
 *
 * @param {string} name - имя
 * @param {string} type - тип существа
 * @param {object[]} activeEffects - эффекты на существе
 * @returns {object} существо
 */
function creatureOf(name, type, activeEffects = []) {
  const creature = createCreature({ id: `creature_${name}`, name });

  creature.system.type = type;
  creature.activeEffects = activeEffects;

  return creature;
}

const goblin = creatureOf('Гоблин', 'humanoid');
const zombie = creatureOf('Зомби', 'undead');

const fearless = creatureOf('Бесстрашный', 'humanoid', [
  createEffect('Отвага', { conditionImmunities: ['frightened'] }),
]);

/**
 * Настоящая проверка «ляжет ли на цель хоть один эффект».
 *
 * @returns {Promise<Function>} проверка
 */
async function loadCanLand() {
  const { targetEffectsCanLand } = await loadTargetEffectResolution(engine);

  return targetEffectsCanLand;
}

/**
 * Вход проверки для цели.
 *
 * @param {object} spell - действие
 * @param {object} entity - цель
 * @returns {object} вход разбора эффектов
 */
function inputOf(spell, entity) {
  return { spell, entity, spellSaveDC: VISAGE_DC, casterId: GHOST_ID };
}

describe('ляжет ли на цель хоть один эффект действия', () => {
  it('условие наложения цель не пропускает — не ляжет', async () => {
    const canLand = await loadCanLand();
    const visage = visageOf([VISAGE_FRIGHT]);

    assert.equal(canLand(inputOf(visage, goblin)), true);
    assert.equal(canLand(inputOf(visage, zombie)), false);
  });

  it('иммунитет к состоянию: без урона эффекта — не ляжет, с уроном — бьёт', async () => {
    const canLand = await loadCanLand();

    assert.equal(canLand(inputOf(visageOf([PLAIN_FRIGHT]), fearless)), false);
    assert.equal(canLand(inputOf(visageOf([VISAGE_FRIGHT]), fearless)), true);
  });
});

describe('спасбросок действия: кого спрашивают', () => {
  it('многочастный путь: без урона — только тех, на кого эффект ляжет', async () => {
    const targetEffectsCanLand = await loadCanLand();
    const visage = visageOf([VISAGE_FRIGHT]);

    /**
     * Настоящий сбор целей спасброска многочастного разбора.
     *
     * @param {object[]} selectedParts - части урона действия
     * @returns {Promise<string[]>} имена тех, кого спросят
     */
    async function askedWith(selectedParts) {
      const collect = await loadHandler(
        partsPath,
        'collectLandingSaveTargets',
        {
          targetEntities: [goblin, zombie],
          selectedParts,
          chooseParts: [],
          chooseEntity: null,
          hasTargetEffects: true,
          spell: visage,
          spellSaveDC: VISAGE_DC,
          context: { casterId: GHOST_ID },
          partPassesTargetGate: () => true,
          targetEffectsCanLand,
        },
      );

      return collect()
        .map((entity) => entity.name)
        .join();
    }

    assert.equal(await askedWith([]), 'Гоблин', 'нежить не спрашивают');

    assert.equal(
      await askedWith([{ amount: 7, isHealing: false, target: 'selected' }]),
      'Гоблин,Зомби',
      'свой урон действия — спасбросок бросают все',
    );
  });

  it('одноформульный путь: урон, эффекты и заклинание без эффектов', async () => {
    const needsSave = await loadHandler(singlePath, 'targetNeedsSpellSave', {
      getTargetSpellEffects: engine.getTargetSpellEffects,
      targetEffectsCanLand: await loadCanLand(),
    });

    /**
     * Контекст каста.
     *
     * @param {object[]} effects - эффекты заклинания
     * @param {number} damageTotal - брошенный урон
     * @returns {object} контекст разбора
     */
    const contextOf = (effects, damageTotal) => ({
      spell: visageOf(effects),
      damageTotal,
      spellSaveDC: VISAGE_DC,
      casterId: GHOST_ID,
    });

    assert.equal(needsSave(zombie, contextOf([VISAGE_FRIGHT], 0)), false);
    assert.equal(needsSave(goblin, contextOf([VISAGE_FRIGHT], 0)), true);

    assert.equal(
      needsSave(zombie, contextOf([VISAGE_FRIGHT], 9)),
      true,
      'урон самого заклинания спасбросок решает',
    );

    assert.equal(
      needsSave(zombie, contextOf([], 0)),
      true,
      'заклинание без эффектов: исход спасброска нужен ведущему',
    );
  });
});
