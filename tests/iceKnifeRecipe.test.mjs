import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MIN_ROLL,
  withHp,
  withRandom,
} from './scenarios/_fixtures.mjs';

/**
 * Рецепт записи «Ледяного кинжала» из того, что система умеет сейчас.
 *
 * Заклинание — дальнобойная атака (1к10 колющего по цели) и взрыв: цель и все
 * в 5 футах от неё спасаются Ловкостью или получают 2к6 холодом. Частей урона
 * с разной доставкой («эта — по попаданию, та — по спасброску») у системы нет,
 * поэтому запись с атакой и спасброском сразу ведёт себя неверно: существо не
 * бросало атаку вовсе, а у персонажа спасбросок ложился на обе части (живая
 * проверка 03.10, А/З6).
 *
 * Рабочая запись: в «Бое» — только атака и колющий урон, а взрыв — эффект «на
 * цели» со срабатыванием «при наложении» на всех в 5 футах вместе с носителем.
 * Тест держит рецепт: срабатывание выполняет сервер по снимку, которым эффект
 * лёг на цель.
 */

/** Сл спасброска заклинателя: клиент подставляет её вместо Сл 0 при наложении */
const CASTER_SAVE_DC = 13;

/** Хиты участников */
const HIT_POINTS = 30;

/** Круг ячейки каста */
const CAST_LEVEL = 3;

/** Урон (круг + 1)к6 при наименьших костях: ячейкой 3-го круга — 4к6 */
const MIN_BURST_DAMAGE = CAST_LEVEL + 1;

/** Эффект-взрыв, каким он записан в заклинании: Сл 0 — Сл заклинателя */
const ICE_BURST = createEffect('Ледяной кинжал: взрыв', {
  effectTarget: 'target',
  duration: { type: 'special' },
  triggers: [
    {
      id: 'trigger_ice_burst',
      event: 'applied',
      recipient: 'area',
      area: { radius: 5, target: 'allWithSelf' },
      save: { ability: 'dexterity', dc: 0 },
      actions: [
        {
          type: 'damage',
          parts: [{ formula: '(@castLevel + 1)к6', type: 'cold' }],
        },
        { type: 'removeSelf', on: 'always' },
      ],
    },
  ],
});

describe('рецепт «Ледяного кинжала»', () => {
  it('взрыв при наложении: цель и соседи в 5 футах спасаются, дальний не задет, эффект снят', () => {
    const system = new engine.Dnd5eVttSystem();

    const target = withHp(createCreature, HIT_POINTS, {
      id: 'creature_target',
      name: 'Цель',
      autoSaves: true,
    });

    const near = withHp(createCreature, HIT_POINTS, {
      id: 'creature_near',
      name: 'Рядом',
      autoSaves: true,
    });

    const far = withHp(createActor, HIT_POINTS, {
      id: 'actor_far',
      name: 'Далеко',
    });

    // Эффект лёг на цель попаданием: клиент подставил круг ячейки и Сл
    // заклинателя
    const caster = createActor({ id: 'actor_caster' });

    const bound = engine.bindSourceEffectFormulas(ICE_BURST, {
      ...engine.buildResolvedFormulaContext(caster, { ambientEffects: [] }),
      castLevel: CAST_LEVEL,
    });

    const landing = structuredClone(target);

    landing.activeEffects = [
      {
        ...engine.stampSourceSaveDcs(bound, CASTER_SAVE_DC),
        sourceActorId: caster.id,
      },
    ];

    engine.recordCombatBaseline(landing, target);

    withRandom([MIN_ROLL], () =>
      system.settleCombatState(target, engine.pickCombatState(landing), {
        getSceneSurroundings: (entity) =>
          entity.id === target.id
            ? {
                token: createToken(target.id, 0, 0),
                gridSettings: GRID,
                neighbors: [
                  { token: createToken(near.id, 1, 0), entity: near },
                  { token: createToken(far.id, 6, 0), entity: far },
                ],
              }
            : null,
      }),
    );

    assert.equal(
      engine.resolveEntityCurrentHp(target),
      HIT_POINTS - MIN_BURST_DAMAGE,
      'цель провалила спасбросок — урон холодом',
    );

    assert.equal(
      engine.resolveEntityCurrentHp(near),
      HIT_POINTS - MIN_BURST_DAMAGE,
      'сосед в 5 футах — тоже',
    );

    assert.equal(engine.resolveEntityCurrentHp(far), HIT_POINTS);

    assert.deepEqual(
      target.activeEffects.map((effect) => effect.name),
      [],
      'эффект-носитель взрыва снят',
    );
  });
});
