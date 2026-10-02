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

describe('каталог: «вырваться» по правилам 2024', () => {
  /**
   * Срабатывание эффекта в форме источника.
   *
   * @param {object} effect - эффект
   * @returns {object} срабатывание с источником
   */
  function sourceOf(effect) {
    return {
      effect,
      trigger: effect.triggers[0],
      ambient: false,
      instance: true,
      scope: effect.id,
    };
  }

  /**
   * Строки карточки эффекта одним текстом.
   *
   * @param {object} effect - эффект
   * @returns {string} строки через перевод строки
   */
  function detailsOf(effect) {
    return engine
      .buildActiveEffectDetails(effect)
      .flatMap((section) => section.lines)
      .join('\n');
  }

  it('[Q10] Захват 2024: Атлетика или Акробатика на выбор вырывающегося', () => {
    // «Если цель — существо с размером средний или меньше, то она схвачена
    // (Сл. освобождения 14)» — правило захвата 2024: Атлетика или Акробатика
    const tentacle = createEffect('Щупальце', {
      conditionKey: 'grappled',
      escape: {
        cost: 'action',
        check: {
          skill: 'athletics',
          dc: DC,
          skills: [{ skill: 'athletics' }, { skill: 'acrobatics' }],
        },
      },
    });

    authoredScenario(tentacle, 'creatureAction');

    assert.equal(
      engine.formatEffectEscapeLabel(tentacle),
      `Вырваться: Атлетика или Акробатика Сл ${DC}`,
    );

    assert.deepEqual(
      engine
        .listEscapeChecks(tentacle.escape, 'self')
        .map((check) => check.skill),
      ['athletics', 'acrobatics'],
    );

    // Старая запись с одним навыком читается как раньше
    const old = createEffect('Щупальце', {
      conditionKey: 'grappled',
      escape: { cost: 'action', check: { skill: 'athletics', dc: DC } },
    });

    assert.equal(
      engine.formatEffectEscapeLabel(old),
      `Вырваться: Атлетика Сл ${DC}`,
    );

    // Список, записанный строками, разбирается так же; негодный навык
    // выбрасывается один
    const parsed = engine.ActiveEffectSchema.parse({
      ...tentacle,
      escape: {
        ...tentacle.escape,
        check: {
          ...tentacle.escape.check,
          skills: ['athletics', 'acrobatics', 'x'],
        },
      },
    });

    assert.deepEqual(parsed.escape.check.skills, [
      { skill: 'athletics' },
      { skill: 'acrobatics' },
    ]);
  });

  it('[Q11] Кандалы: у каждого навыка своя Сл', () => {
    // «Освобождение — Ловкость (Ловкость рук) Сл 20; разрыв — Сила (Атлетика)
    // Сл 25; без ключа — воровские инструменты, Ловкость рук Сл 15»
    const manacles = createEffect('Скован кандалами', {
      escape: {
        by: 'any',
        cost: 'action',
        check: {
          skill: 'sleightOfHand',
          dc: 20,
          skills: [
            { skill: 'sleightOfHand', by: 'self' },
            { skill: 'athletics', dc: 25, by: 'self' },
            {
              skill: 'sleightOfHand',
              dc: 15,
              label: 'воровскими инструментами',
            },
          ],
        },
      },
    });

    authoredScenario(manacles, 'ownEffects');

    assert.equal(
      engine.formatEffectEscapeLabel(manacles),
      'Вырваться: Ловкость рук Сл 20 или Атлетика Сл 25 или Ловкость рук (воровскими инструментами) Сл 15',
    );

    assert.deepEqual(
      engine
        .listEscapeChecks(manacles.escape, 'adjacent')
        .map((check) => check.dc),
      [15],
      'сосед может только вскрыть замок',
    );
  });

  it('[Q12] Водный элементаль: вырваться может и носитель, и сосед — разными навыками', () => {
    // «Схвачена (Сл освобождения 14). Действием существо в пределах 5 фт от
    // элементаля может вытащить существо: Сила (Атлетика) Сл 14»
    const whelm = createEffect('Погружение', {
      conditionKey: 'grappled',
      escape: {
        by: 'any',
        cost: 'action',
        check: {
          skill: 'athletics',
          dc: DC,
          skills: [{ skill: 'athletics' }, { skill: 'acrobatics', by: 'self' }],
        },
      },
    });

    authoredScenario(whelm, 'creatureAction');

    assert.equal(engine.canEscapeEffect(whelm, 'self'), true);
    assert.equal(engine.canEscapeEffect(whelm, 'adjacent'), true);

    assert.deepEqual(
      engine
        .listEscapeChecks(whelm.escape, 'adjacent')
        .map((check) => check.skill),
      ['athletics'],
      'сосед — только Атлетикой',
    );

    // Только носитель — как раньше
    const selfOnly = createEffect('Опутывание', {
      escape: { check: { skill: 'athletics', dc: DC } },
    });

    assert.equal(engine.canEscapeEffect(selfOnly, 'adjacent'), false);

    assert.match(
      detailsOf(whelm),
      /Можно вырваться: носитель или существо рядом, действие, Атлетика или Акробатика Сл 14/,
    );
  });

  it('[Q13] Режим броска: помеха из эффекта, преимущество вырывающегося, помеха от того, кто держит', () => {
    // Мимик: «Проверки характеристик для освобождения от этого состояния
    // совершаются с помехой»
    const adhesive = createEffect('Липкий', {
      conditionKey: 'grappled',
      effectTarget: 'target',
      escape: {
        cost: 'action',
        check: {
          skill: 'athletics',
          dc: 13,
          mode: 'disadvantage',
          skills: [{ skill: 'athletics' }, { skill: 'acrobatics' }],
        },
      },
    });

    authoredScenario(adhesive, 'creatureAction');

    /**
     * Режим броска «вырваться» при данных флагах.
     *
     * @param {object} effect - эффект
     * @param {string[]} flags - флаги бросающего
     * @param {string[]} holderFlags - флаги того, кто держит
     * @returns {string} режим
     */
    function modeOf(effect, flags = [], holderFlags = undefined) {
      return engine.resolveEscapeRollMode({
        checkMode: 'normal',
        effect,
        flags: new Set(flags),
        ...(holderFlags ? { holderFlags: new Set(holderFlags) } : {}),
      });
    }

    assert.equal(modeOf(adhesive), 'disadvantage');

    // Голиаф: «Преимущество на проверки характеристик, чтобы избавиться от
    // состояния схваченный» — гасит помеху мимика
    const powerfulBuild = createEffect('Мощное телосложение', {
      flags: ['escape.advantage.grappled'],
    });

    authoredScenario(powerfulBuild, 'feature');
    assert.equal(modeOf(adhesive, powerfulBuild.flags), 'normal');

    const grab = createEffect('Захват', {
      conditionKey: 'grappled',
      escape: { check: { skill: 'athletics', dc: 13 } },
    });

    assert.equal(modeOf(grab, powerfulBuild.flags), 'advantage');

    // «Железная хватка»: существо совершает с помехой проверки, чтобы
    // высвободиться из вашего захвата — флаг на том, кто держит
    const ironGrip = createEffect('Железная хватка', {
      flags: ['grapple.escapeDisadvantage'],
    });

    authoredScenario(ironGrip, 'feature');
    assert.equal(modeOf(grab, [], ironGrip.flags), 'disadvantage');

    const web = createEffect('Паутина', {
      conditionKey: 'restrained',
      escape: { check: { skill: 'athletics', dc: 13 } },
    });

    assert.equal(
      modeOf(web, [], ironGrip.flags),
      'normal',
      'флаг держащего — только про захват',
    );
  });

  it('[Q14] После освобождения — ничком; при провале — урон', () => {
    // Пленяющий стручок: «при успехе цель извлекается и получает состояние
    // лежащий ничком»
    const pod = createEffect('Пленяющий стручок', {
      conditionKey: 'paralyzed',
      effectTarget: 'target',
      escape: {
        by: 'adjacent',
        cost: 'action',
        check: { skill: 'athletics', dc: 14 },
        onSuccessApply: 'prone',
      },
    });

    authoredScenario(pod, 'creatureAction');

    assert.equal(engine.buildEscapeAftermath(pod)?.conditionKey, 'prone');

    // Охотничий капкан: «каждая неудачная проверка наносит пойманному 1
    // колющий урон»
    const trap = createEffect('Охотничий капкан', {
      flags: ['speed.zero'],
      activation: { mode: 'use' },
      effectTarget: 'target',
      escape: {
        by: 'any',
        cost: 'action',
        check: { skill: 'athletics', dc: 13 },
        onFailDamage: [{ formula: '1', type: 'piercing' }],
      },
    });

    authoredScenario(trap, 'item');

    assert.deepEqual(
      engine.ActiveEffectSchema.parse(trap).escape.onFailDamage,
      [{ formula: '1', type: 'piercing' }],
    );

    assert.match(detailsOf(trap), /при провале — /i);

    // Пустые части урона и список из одного простого навыка в данные не уходят
    const draft = engine.normalizeEffectDraft(
      {
        ...trap,
        escape: {
          ...trap.escape,
          check: { ...trap.escape.check, skills: [{ skill: 'athletics' }] },
          onFailDamage: [{ formula: '  ' }],
        },
      },
      engine.resolveEffectFormLayout('item', trap),
    );

    assert.equal(draft.escape.onFailDamage, undefined);
    assert.equal(draft.escape.check.skills, undefined);
  });

  it('[Q15] Состояние из срабатывания ауры несёт «вырваться» и свои флаги', () => {
    // Аура Бездны: «спасбросок Силы, иначе опутан… может действием совершить
    // проверку Силы (Атлетика) со Сл. ваших заклинаний». Зловонная аура: «пока
    // цель отравлена, она совершает либо действие, либо бонусное действие… и не
    // может совершать реакции»
    const web = createEffect('Аура Бездны: липкая паутина', {
      aura: { radius: 10, target: 'enemies', applyToSelf: false },
      triggers: [
        {
          id: 'trigger_web',
          event: 'turnStart',
          save: { ability: 'strength', dc: engine.SOURCE_SAVE_DC },
          actions: [
            {
              type: 'applyCondition',
              conditionKey: 'restrained',
              escape: {
                cost: 'action',
                check: { skill: 'athletics', dc: engine.SOURCE_SAVE_DC },
              },
              flags: ['actions.noReaction', 'actions.oneActionOrBonus'],
            },
          ],
        },
      ],
    });

    authoredScenario(web, 'feature');

    // Сл источника проставляется при наложении — и в «вырваться» состояния
    const stamped = engine.stampSourceSaveDcs(web, 15);

    assert.equal(stamped.triggers[0].actions[0].escape.check.dc, 15);

    const victim = createActor();

    engine.applyTriggerEffectActions(victim, sourceOf(stamped), false);

    const restrained = victim.activeEffects.find(
      (effect) => effect.conditionKey === 'restrained',
    );

    assert.equal(
      engine.formatEffectEscapeLabel(restrained),
      'Вырваться: Атлетика Сл 15',
    );

    assert.ok(restrained.flags.includes('actions.noReaction'));
    assert.ok(restrained.flags.includes('actions.oneActionOrBonus'));

    assert.ok(
      engine.resolveActorStats(victim).activeFlags.has('actions.noReaction'),
      'флаги действуют, пока состояние лежит',
    );
  });

  it('[Q16] Состояние с «вырваться»: снятие плиткой будит «когда снимается»', () => {
    // Иллитид, «Щупальца»: «схвачена (Сл освобождения 14) и ошеломлена до
    // конца захвата». Плитка листа снимает «Схваченного» боевым снимком —
    // тем же каналом, что и успех «вырваться»
    const grapple = createEffect('Схваченный', {
      conditionKey: 'grappled',
      escape: {
        cost: 'action',
        check: {
          skill: 'athletics',
          dc: DC,
          skills: [{ skill: 'athletics' }, { skill: 'acrobatics' }],
        },
      },
    });

    const stun = createEffect('Ошеломлённый', {
      conditionKey: 'stunned',
      triggers: [
        {
          id: 'trigger_grapple_end',
          event: 'conditionLost',
          conditionKey: 'grappled',
          actions: [{ type: 'removeSelf' }],
        },
      ],
    });

    authoredScenario(grapple, 'creatureAction');
    authoredScenario(stun, 'creatureAction');

    assert.equal(
      engine.formatEffectEscapeLabel(grapple),
      `Вырваться: Атлетика или Акробатика Сл ${DC}`,
      'подпись кнопки над сеткой состояний — та же, что в строке эффекта',
    );

    const hero = withHp(createActor, 30, { activeEffects: [grapple, stun] });
    const snapshot = structuredClone(hero);

    snapshot.activeEffects = snapshot.activeEffects.filter(
      (effect) => effect.conditionKey !== 'grappled',
    );

    new engine.Dnd5eVttSystem().settleCombatState(
      hero,
      engine.pickCombatState(snapshot),
    );

    assert.deepEqual(
      hero.activeEffects,
      [],
      'с захватом ушёл и «Ошеломлённый»',
    );
  });
});
