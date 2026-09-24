import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  change,
  createActor,
  createEffect,
  createRequestRoll,
  createToken,
  engine,
  GRID,
  PLAYER_ID,
  withHp,
} from './_fixtures.mjs';

/**
 * Каталог: канал вопросов человеку, действие «вырваться» и ступени эффекта
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Вопросы человеку»).
 */

/** Сложность проверок и спасбросков раздела */
const DC = 14;

/**
 * Сцена вокруг носителя: соседей нет, но сцена у ядра есть.
 *
 * @param {object} carrier - носитель эффекта
 * @returns {object} контекст со сценой
 */
function aloneOnScene(carrier) {
  return {
    getSceneSurroundings: (entity) =>
      entity.id === carrier.id
        ? {
            token: createToken(carrier.id, 0, 0),
            gridSettings: GRID,
            neighbors: [],
          }
        : null,
  };
}

describe('каталог: вопросы человеку', () => {
  it('[Q01] Опутывание: из эффекта вырываются проверкой Атлетики против Сл заклинателя', () => {
    const entangle = createEffect('Опутывание', {
      conditionKey: 'restrained',
      escape: {
        by: 'self',
        cost: 'action',
        check: { skill: 'athletics', dc: engine.SOURCE_SAVE_DC },
        onSuccess: 'removeSelf',
      },
    });

    authoredScenario(entangle, 'spell', { zoneAvailable: false });

    // У эффекта из компендиума источника нет: Сл осталась нулевой, и проверка
    // против неё прошла бы у кого угодно — кнопка обязана отказаться
    assert.equal(engine.resolveEffectEscapeDc(entangle.escape), null);
    assert.equal(engine.canEscapeEffect(entangle), false);

    assert.match(
      engine.describeEscapeUnavailable(entangle) ?? '',
      /Сл источника неизвестна/,
    );

    // Наложение проставляет Сл заклинателя — та же подстановка, что у
    // повторного спасброска
    const applied = engine.stampSourceSaveDcs(entangle, DC);

    assert.equal(engine.resolveEffectEscapeDc(applied.escape), DC);
    assert.equal(engine.canEscapeEffect(applied), true);

    assert.equal(
      engine.formatEffectEscapeLabel(applied),
      `Вырваться: Атлетика Сл ${DC}`,
    );

    assert.equal(engine.formatEffectActionCost('action'), 'Действие');

    const hero = createActor({ activeEffects: [applied] });

    assert.deepEqual(
      engine.listEffectEscapeRemovals(applied, hero.activeEffects),
      [applied.id],
      'успех снимает сам эффект',
    );
  });

  it('[Q09] Цена и вопрос переживают сохранение: старые поля их не выражают', () => {
    // Срабатывание «урон каждый ход» старые поля выражают — и молча съели бы
    // цену и вопрос, если бы не проверка в isPlainTrigger
    const trigger = {
      id: 'trigger_tick',
      event: 'turnStart',
      cost: 'bonus',
      ask: true,
      actions: [{ type: 'damage', parts: [{ formula: '3', type: 'fire' }] }],
    };

    const saved = engine.writeEffectTriggers(createEffect('Горение'), [
      trigger,
    ]);

    assert.equal(
      saved.recurringDamage,
      undefined,
      'в старое поле такое срабатывание не уходит',
    );

    assert.deepEqual(saved.triggers, [trigger], 'настройки не потерялись');

    const plain = engine.writeEffectTriggers(createEffect('Горение'), [
      { ...trigger, cost: undefined, ask: undefined },
    ]);

    assert.ok(
      plain.recurringDamage,
      'без цены и вопроса срабатывание по-прежнему пишется старым полем',
    );
  });

  it('[Q02] Эвардовы чёрные щупальца: срабатывание спрашивает разрешения, отказ его отменяет', async () => {
    const tentacles = createEffect('Эвардовы чёрные щупальца', {
      triggers: [
        {
          id: 'trigger_crush',
          event: 'turnStart',
          ask: true,
          actions: [
            { type: 'damage', parts: [{ formula: '3', type: 'bludgeoning' }] },
          ],
        },
      ],
    });

    assert.match(authoredScenario(tentacles, 'spell'), /в начале хода/);

    const victim = withHp(createActor, 20, { activeEffects: [tentacles] });
    const { requests, requestRoll, answer } = createRequestRoll();

    const refused = new engine.Dnd5eVttSystem().runTurnEffects(
      victim,
      'startOfTurn',
      { requestRoll, ...aloneOnScene(victim) },
    );

    assert.equal(requests.length, 1, 'спросили один раз');
    assert.equal(requests[0].entityId, victim.id, 'спросили у носителя');
    assert.equal(requests[0].payload.kind, 'effectPrompt');
    assert.equal(requests[0].payload.question, 'Пустить срабатывание в ход?');

    assert.deepEqual(
      requests[0].payload.options.map((option) => option.id),
      ['yes', 'no'],
    );

    answer({ status: 'declined' });

    const outcome = (await refused.deferred[0].resolution)(victim);

    assert.equal(outcome.changed, false, 'без согласия урона нет');
    assert.equal(engine.resolveEntityCurrentHp(victim), 20);
    assert.match(outcome.chatSummary ?? '', /согласия нет/);
  });

  it('[Q03] Вопрос человеку: ответ не из списка вариантов не принимается', async () => {
    const curse = createEffect('Проклятие', {
      triggers: [
        {
          id: 'trigger_bite',
          event: 'turnEnd',
          ask: true,
          actions: [
            { type: 'damage', parts: [{ formula: '4', type: 'necrotic' }] },
          ],
        },
      ],
    });

    const victim = withHp(createActor, 20, { activeEffects: [curse] });
    const { requestRoll, answer } = createRequestRoll();

    const result = new engine.Dnd5eVttSystem().runTurnEffects(
      victim,
      'endOfTurn',
      { requestRoll, ...aloneOnScene(victim) },
    );

    answer({
      status: 'answered',
      result: { optionId: 'может быть' },
      respondedByUserId: PLAYER_ID,
    });

    const outcome = (await result.deferred[0].resolution)(victim);

    assert.equal(
      outcome.changed,
      false,
      'чужой вариант ответа — то же, что молчание',
    );

    assert.equal(engine.resolveEntityCurrentHp(victim), 20);
  });

  it('[Q04] Реакция: цена сама спрашивает разрешения и тратится раз за раунд', async () => {
    const riposte = createEffect('Ответный удар', {
      triggers: [
        {
          id: 'trigger_riposte',
          event: 'turnEnd',
          cost: 'reaction',
          actions: [
            { type: 'damage', parts: [{ formula: '3', type: 'slashing' }] },
          ],
        },
      ],
    });

    assert.equal(
      engine.triggerAsksPermission(riposte.triggers[0]),
      true,
      'реакция — ресурс человека: за него её не тратят',
    );

    assert.deepEqual(
      engine.resolveTriggerLimit(riposte.triggers[0]),
      engine.REACTION_TRIGGER_LIMIT,
      'реакция сама по себе — не чаще раза за раунд',
    );

    const hero = withHp(createActor, 20, { activeEffects: [riposte] });
    const { requests, requestRoll, answer } = createRequestRoll();

    const result = new engine.Dnd5eVttSystem().runTurnEffects(
      hero,
      'endOfTurn',
      { requestRoll, ...aloneOnScene(hero) },
    );

    assert.equal(requests[0].payload.question, 'Потратить реакцию?');

    answer({
      status: 'answered',
      result: { optionId: 'yes' },
      respondedByUserId: PLAYER_ID,
    });

    (await result.deferred[0].resolution)(hero);

    assert.equal(
      engine.resolveEntityCurrentHp(hero),
      17,
      'по согласию срабатывание идёт',
    );
  });

  it('[Q05] Сообщить человеку: строка уходит в сводку чата', () => {
    const compulsion = createEffect('Принуждение', {
      triggers: [
        {
          id: 'trigger_remind',
          event: 'turnStart',
          actions: [
            {
              type: 'notify',
              text: 'Двигайся в указанную сторону',
              to: 'subject',
            },
          ],
        },
      ],
    });

    assert.match(authoredScenario(compulsion, 'spell'), /сообщение/);

    const victim = withHp(createActor, 20, { activeEffects: [compulsion] });
    const notes = [];

    engine.applyTriggerEffectActions(
      victim,
      {
        effect: compulsion,
        trigger: compulsion.triggers[0],
        ambient: false,
        instance: true,
        scope: compulsion.id,
      },
      false,
      { collectNote: (note) => notes.push(note) },
    );

    assert.deepEqual(notes, [
      `Принуждение — ${victim.name}: Двигайся в указанную сторону`,
    ]);

    // Настоящий ход: напоминание приходит в сводку, хотя бросков не было
    const turn = engine.processTurnEffects(victim, 'startOfTurn');

    assert.match(
      engine.formatTurnEffectsMessage(victim.name, 'startOfTurn', turn),
      /Двигайся в указанную сторону/,
    );
  });

  it('[Q06] Ступени: перевод меняет модификаторы, за последней ступени нет', () => {
    const aging = createEffect('Проклятие гибельного старения', {
      changes: [change('ability.strength', '-2')],
      stages: [
        {
          label: 'Сила −2',
          changes: [change('ability.strength', '-2')],
          flags: [],
        },
        {
          label: 'Сила −4',
          changes: [change('ability.strength', '-4')],
          flags: [],
        },
      ],
      stageIndex: 0,
    });

    assert.equal(engine.hasEffectStages(aging), true);
    assert.equal(engine.canAdvanceEffectStage(aging), true);

    assert.equal(
      engine.formatEffectStageLabel(aging),
      'Ступень 1 из 2 — Сила −2',
    );

    const advanced = engine.advanceEffectStage(aging);

    assert.equal(advanced.stageIndex, 1);
    assert.equal(advanced.changes[0].value, '-4');
    assert.equal(engine.canAdvanceEffectStage(advanced), false);
    assert.equal(engine.advanceEffectStage(advanced), null);
  });

  it('[Q07] Действие действующего заклинания: своя кнопка и своё срабатывание', () => {
    const sphere = createEffect('Пылающая сфера', {
      triggers: [
        {
          id: 'trigger_move',
          event: 'activate',
          cost: 'bonus',
          actions: [
            { type: 'damage', parts: [{ formula: '4', type: 'fire' }] },
          ],
        },
      ],
    });

    const layout = engine.resolveEffectFormLayout('spell', {
      ...sphere,
      effectTarget: 'target',
    });

    assert.ok(
      layout.triggerEvents.includes('activate'),
      'у действующего заклинания есть событие «При действии»',
    );

    const caster = withHp(createActor, 20, { activeEffects: [sphere] });

    assert.equal(engine.hasEffectActiveAction(sphere), true);

    const acted = engine.runEffectActiveAction(caster, sphere.id);

    assert.equal(
      engine.resolveEntityCurrentHp(acted),
      16,
      'действие выполнило своё срабатывание',
    );

    assert.equal(
      engine.resolveEntityCurrentHp(caster),
      20,
      'исходная сущность не тронута — меняется копия',
    );
  });

  it('[Q08] Согласная цель: разрешение едет в запрос спасброска', () => {
    const teleport = createEffect('Дверь измерений', {
      applySave: {
        ability: 'charisma',
        dc: DC,
        onSuccess: 'negate',
        allowWilling: true,
      },
    });

    const spec = engine.buildApplySaveSpec(teleport, teleport.applySave);

    assert.equal(spec.allowWilling, true);

    const ally = createActor({ id: 'actor_ally' });

    const request = engine.buildEffectSaveRollRequest(
      ally,
      spec,
      'Эффект «Дверь измерений»',
    );

    assert.equal(
      request.payload.allowWilling,
      true,
      'окно адресата покажет «Не сопротивляюсь»',
    );
  });
});
