import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import {
  authoredScenario,
  CELL_SIZE,
  change,
  createActor,
  createCreature,
  createEffect,
  createToken,
  engine,
  GRID,
  MAX_ROLL,
  withHp,
  withRandom,
} from './_fixtures.mjs';

/**
 * Каталог: применение — цель, область, срок, выбор
 * (`docs/EFFECT_SCENARIOS.md`, раздел «Применение: область, предмет, выбор»).
 * Тексты правил — из сверки мест этапа 2A (`wave2-plan/stage2A/places.json`).
 */

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
 * Шаблон на сцене.
 *
 * @param {string} type - форма
 * @param {number} originX - начало, px
 * @param {number} originY - начало, px
 * @param {number} length - размер, px
 * @returns {object} шаблон
 */
function createTemplate(type, originX, originY, length) {
  return {
    id: `tmpl_${type}`,
    type,
    originX,
    originY,
    targetX: originX + length,
    targetY: originY,
    color: 0x8b5cf6,
    createdBy: 'player',
  };
}

describe('каталог: применение — область, предмет, выбор', () => {
  it('[UA01] Тату «Цветной дракон»: применение с областью — конус 30 футов', () => {
    // «Выдохом магической энергии в конусе 30 футов… спасбросок Ловкости…
    // два броска кости боевых искусств + мод. Мудрости»
    const breath = createEffect('Тату монстра: Цветной дракон', {
      activation: {
        mode: 'use',
        cost: 'action',
        area: { shape: 'cone', size: 30 },
      },
      effectTarget: 'target',
      applySave: {
        ability: 'dexterity',
        dc: 10,
        dcFormula: '8 + @mod.wis + @prof',
        onSuccess: 'half',
      },
      damageParts: [{ formula: '2к8 + @mod.wis', type: 'fire' }],
      duration: { type: 'special' },
    });

    authoredScenario(breath, 'feature');

    const spell = engine.buildEffectGroupUseSpell([breath]);

    assert.deepEqual(spell.areaOfEffect, {
      shape: 'cone',
      size: 30,
      unit: 'ft',
      resizable: false,
    });

    assert.equal(engine.getTargetSpellEffects(spell).length, 1);
    assert.equal(engine.resolveEffectUseCost([breath]), 'action');

    assert.match(detailsOf(breath), /трата хода: действие/i);
    assert.match(detailsOf(breath), /область: конус 30 фт/i);

    // Черновик: область — только у применения, ширина — только у линии
    const layout = engine.resolveEffectFormLayout('feature', breath);

    assert.deepEqual(
      engine.normalizeEffectDraft(
        {
          ...breath,
          activation: {
            mode: 'use',
            area: { shape: 'cone', size: 30, width: 5 },
          },
        },
        layout,
      ).activation.area,
      { shape: 'cone', size: 30 },
    );

    assert.equal(
      engine.normalizeEffectDraft(
        {
          ...breath,
          activation: { mode: 'toggle', area: { shape: 'cone', size: 30 } },
        },
        layout,
      ).activation.area,
      undefined,
    );

    // Негодная область выбрасывается, применение остаётся
    assert.equal(
      engine.ActiveEffectSchema.parse({
        ...breath,
        activation: { mode: 'use', area: { shape: 'star', size: 30 } },
      }).activation.area,
      undefined,
    );
  });

  it('[UA02] Масло, Ликоловка: зона на месте шаблона применения', () => {
    // «Покрывая квадрат со стороной 5 фт… наносить 5 урона огнём любому
    // существу, которое войдёт в эту область или завершит там ход» — 2 раунда
    const oil = createEffect('Горящее масло', {
      activation: { mode: 'use', area: { shape: 'rect', size: 5 } },
      effectTarget: 'zone',
      areaTrigger: 'enter',
      damageParts: [{ formula: '5', type: 'fire' }],
      duration: { type: 'rounds', value: 2 },
    });

    const layout = engine.resolveEffectFormLayout('item', oil);

    assert.ok(layout.deliveryOptions.includes('zone'), 'у области есть зона');
    assert.deepEqual(engine.listInertEffectFields(oil, layout), []);

    // Без области зоне взяться неоткуда
    const noArea = { ...oil, activation: { mode: 'use' } };

    assert.equal(
      engine
        .resolveEffectFormLayout('item', noArea)
        .deliveryOptions.includes('zone'),
      false,
    );

    const spell = engine.buildItemUseSpell({
      id: 'item_oil',
      name: 'Масло',
      activeEffects: [oil],
    });

    assert.equal(spell.areaOfEffect.shape, 'rect');
    assert.equal(spell.durationUnit, 'round');
    assert.equal(spell.durationValue, 2);

    const draft = engine.buildSpellZoneDraft({
      spell,
      template: createTemplate('rect', 1000, 1000, CELL_SIZE),
      casterId: 'actor_hero',
      saveDc: 10,
      formulaContext: engine.buildFormulaContext(createActor()),
      gridSize: CELL_SIZE,
    });

    assert.ok(draft, 'зона собрана');
    assert.equal(draft.rounds, 2);

    assert.deepEqual(
      draft.effects.map((effect) => effect.name),
      ['Горящее масло'],
    );

    // Ловушка умения: срок без счёта раундов — зона до снятия вручную
    const trap = createEffect('Ликоловка', {
      activation: { mode: 'use', area: { shape: 'rect', size: 5 } },
      effectTarget: 'zone',
      areaTrigger: 'enter',
      applySave: { ability: 'dexterity', dc: 14, onSuccess: 'negate' },
      damageParts: [{ formula: '3к10', type: 'bludgeoning' }],
      duration: { type: 'special' },
    });

    const trapSpell = engine.buildEffectGroupUseSpell([trap]);

    assert.equal(trapSpell.durationUnit, 'special');
  });

  it('[UA03] Дыхание дракона, Кольцо молний: кнопка «При действии» с шаблоном', () => {
    // «Цель может использовать действие Магия, чтобы выдохнуть 15-футовый
    // конус… спасбросок Ловкости, 3к6 выбранного типа»
    const breath = createEffect('Дыхание дракона', {
      effectTarget: 'target',
      duration: { type: 'minutes', value: 1 },
      triggers: [
        {
          id: 'trigger_breath',
          event: 'activate',
          cost: 'action',
          recipient: 'area',
          area: { radius: 0, template: { shape: 'cone', size: 15 } },
          save: { ability: 'dexterity', dc: 15 },
          actions: [
            {
              type: 'damage',
              parts: [{ formula: '3к6', type: 'fire' }],
              halfOnSave: true,
            },
          ],
        },
      ],
    });

    authoredScenario(breath, 'spell');

    const trigger = breath.triggers[0];

    assert.equal(engine.isServerActiveAction(trigger), true);
    assert.deepEqual(engine.listEffectSelfActions(breath), []);
    assert.equal(engine.listEffectServerActions(breath).length, 1);

    assert.deepEqual(engine.resolveEffectActionTemplate(breath), {
      shape: 'cone',
      size: 15,
    });

    // Клиент на самом носителе такие срабатывания не выполняет
    const carrier = withHp(createActor, 20, { activeEffects: [breath] });

    assert.deepEqual(
      engine.runEffectActiveAction(carrier, breath.id).system.hitPoints,
      carrier.system.hitPoints,
    );

    // Сервер раздаёт действия тем, кого накрыл шаблон нажавшего
    const goblin = withHp(createCreature, 30, { id: 'creature_goblin' });
    const orc = withHp(createCreature, 30, { id: 'creature_orc' });

    const result = withRandom([MAX_ROLL, MAX_ROLL, MAX_ROLL, 0], () =>
      engine.settleEffectActionEvents(carrier, breath.id, {
        inCombat: false,
        listEntitiesInArea: (_subject, area) =>
          area.template ? [goblin] : [goblin, orc],
      }),
    );

    assert.deepEqual(
      result.related.map((outcome) => outcome.entity.id),
      ['creature_goblin'],
      'задет только тот, кто под шаблоном',
    );

    assert.ok(
      engine.resolveEntityCurrentHp(goblin) < 30,
      'гоблин получил урон',
    );

    assert.equal(engine.resolveEntityCurrentHp(orc), 30);

    // Событие правил: сервер верит только известной форме
    assert.deepEqual(
      engine.parseSystemClientEvent(
        engine.buildEffectActionEvent('actor_hero', breath.id, [
          'creature_goblin',
        ]),
      ),
      {
        type: 'effectAction',
        entityId: 'actor_hero',
        effectId: breath.id,
        targetIds: ['creature_goblin'],
      },
    );

    assert.equal(
      engine.parseSystemClientEvent({ type: 'effectAction', entityId: '' }),
      null,
    );

    // Действие самому носителю остаётся на клиенте
    const selfHeal = {
      id: 'trigger_self',
      event: 'activate',
      actions: [{ type: 'tempHp', amount: '5' }],
    };

    assert.equal(engine.isServerActiveAction(selfHeal), false);
  });

  it('[UA04] Язык пламени: переключатель предмета — свет и 2к6 огнём, пока пылает', () => {
    // «Бонусным действием произнести командное слово… пока оружие пылает —
    // дополнительно 2к6 урона огнём»
    const flames = createEffect('Пламя', {
      activation: { mode: 'toggle', cost: 'bonus' },
      disabled: true,
      changes: [change('damage.weapon', '2к6@dmg.fire')],
      light: { bright: 40, dim: 40 },
    });

    authoredScenario(flames, 'weapon');

    const sword = {
      id: 'item_flame_tongue',
      name: 'Язык пламени',
      type: 'weapon',
      equipped: true,
      activeEffects: [flames],
    };

    assert.deepEqual(
      engine.listItemToggles(sword).map((toggle) => toggle.on),
      [false],
    );

    const hero = createActor({ equipment: [sword] });

    assert.equal(
      engine
        .collectActiveEffects(hero)
        .some((effect) => effect.id === flames.id),
      false,
      'погашенный меч ничего не даёт',
    );

    const lit = {
      ...hero,
      equipment: engine.switchItemToggle(
        hero.equipment,
        sword.id,
        flames.id,
        true,
      ),
    };

    const burning = engine
      .collectActiveEffects(lit)
      .find((effect) => effect.id === flames.id);

    assert.ok(burning, 'зажжённый меч действует');
    assert.equal(burning.carriedItemId, sword.id, 'урон — только этим мечом');

    assert.deepEqual(
      engine.listItemToggles(lit.equipment[0]).map((toggle) => toggle.on),
      [true],
    );

    // Погасили — потраченное при включении забывается
    const paid = engine.switchItemToggle(
      hero.equipment,
      sword.id,
      flames.id,
      true,
      { itemUses: 1 },
    );

    assert.deepEqual(paid[0].activeEffects[0].paid, { itemUses: 1 });

    const out = engine.switchItemToggle(paid, sword.id, flames.id, false);

    assert.equal(out[0].activeEffects[0].disabled, true);
    assert.equal(out[0].activeEffects[0].paid, undefined);

    assert.match(detailsOf(flames), /трата хода: бонусное действие/i);
  });

  it('[UA05] Трата хода у применения и включения', () => {
    const word = createEffect('Командное слово', {
      activation: { mode: 'use', cost: 'bonus' },
    });

    assert.equal(engine.resolveEffectUseCost([word]), 'bonus');

    assert.equal(
      engine.resolveEffectUseCost([createEffect('Зелье')]),
      undefined,
    );

    // Запрет трат хода закрывает и применение: «нет бонусных действий»
    const bound = createActor({
      activeEffects: [
        createEffect('Оковы', { flags: ['actions.noBonusAction'] }),
      ],
    });

    assert.equal(
      engine.formatActionCostBlock(
        engine.resolveActionCostBlock(
          bound,
          engine.resolveEffectUseCost([word]),
        ),
      ),
      'Бонусное действие недоступно: Оковы',
    );

    // Чужая трата в данных выбрасывается одна
    assert.equal(
      engine.ActiveEffectSchema.parse({
        ...word,
        activation: { mode: 'use', cost: 'minute' },
      }).activation.cost,
      undefined,
    );
  });

  it('[UA06] Ветви древа: перенос цели вплотную к наложившему', () => {
    // «Телепортируется в незанятое пространство в пределах 5 фт от вас»
    const branches = createEffect('Ветви древа', {
      effectTarget: 'target',
      sourceActorId: 'actor_barbarian',
      triggers: [
        {
          id: 'trigger_bring',
          event: 'applied',
          actions: [{ type: 'move', kind: 'bring', distance: 0 }],
        },
      ],
    });

    assert.match(
      authoredScenario(branches, 'spell'),
      /переносит вплотную к опоре/,
    );

    const victim = createActor({
      id: 'actor_victim',
      activeEffects: [branches],
    });

    const moves = [];

    engine.applyTriggerEffectActions(victim, sourceOf(branches), false, {
      surroundings: {
        token: createToken(victim.id, 6, 0),
        gridSettings: GRID,
        neighbors: [
          {
            token: createToken('actor_barbarian', 0, 0),
            entity: createActor({ id: 'actor_barbarian' }),
          },
        ],
      },
      moveToken: (tokenId, position) => moves.push({ tokenId, position }),
    });

    assert.equal(moves.length, 1);

    assert.equal(
      moves[0].position.x,
      CELL_SIZE,
      'встала в соседнюю клетку, а не на опору',
    );

    // «Не может телепортироваться» перенос не пускает
    const bound = createActor({
      id: 'actor_victim',
      activeEffects: [
        branches,
        createEffect('Цепи', { flags: ['movement.teleportBlocked'] }),
      ],
    });

    const blocked = [];

    engine.applyTriggerEffectActions(bound, sourceOf(branches), false, {
      surroundings: {
        token: createToken(bound.id, 6, 0),
        gridSettings: GRID,
        neighbors: [
          {
            token: createToken('actor_barbarian', 0, 0),
            entity: createActor({ id: 'actor_barbarian' }),
          },
        ],
      },
      moveToken: (tokenId, position) => blocked.push({ tokenId, position }),
    });

    assert.deepEqual(blocked, []);
  });

  it('[UA07] Грубый удар, Оттолкнуть: до N футов, к себе или от себя — выбирает применивший', () => {
    // «При провале вы можете переместить цель на расстояние до 10 футов к
    // себе или от себя»
    const shove = createEffect('Грубый удар', {
      activation: { mode: 'use' },
      effectTarget: 'target',
      applySave: { ability: 'strength', dc: 14, onSuccess: 'negate' },
      duration: { type: 'special' },
      triggers: [
        {
          id: 'trigger_shove',
          event: 'applied',
          actions: [
            { type: 'move', kind: 'choose', distance: 10, upTo: true },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(
      authoredScenario(shove, 'feature'),
      /отталкивает или притягивает \(на выбор применившего\) на до 10 фт/,
    );

    const [request] = engine.listMoveChoices([shove]);

    assert.deepEqual(
      request.options.map((option) => option.label),
      [
        'Не двигать',
        'От себя на 5 фт',
        'От себя на 10 фт',
        'К себе на 5 фт',
        'К себе на 10 фт',
      ],
    );

    // Выбор записывается в действие: дальше оно обычное
    const pulled = engine.stampMoveChoice(
      [shove],
      request,
      request.options.find((option) => option.id === 'pull:5'),
    );

    assert.deepEqual(pulled[0].triggers[0].actions[0], {
      type: 'move',
      kind: 'pull',
      distance: 5,
    });

    assert.deepEqual(
      engine.listMoveChoices(pulled),
      [],
      'спрашивать больше нечего',
    );

    // «Не двигать» действие убирает
    const stayed = engine.stampMoveChoice([shove], request, request.options[0]);

    assert.deepEqual(
      stayed[0].triggers[0].actions.map((action) => action.type),
      ['removeSelf'],
    );

    // «Оттолкнуть до 15 фт»: только расстояние
    const palm = createEffect('Оттолкнуть', {
      triggers: [
        {
          id: 'trigger_palm',
          event: 'applied',
          actions: [{ type: 'move', kind: 'push', distance: 15, upTo: true }],
        },
      ],
    });

    assert.deepEqual(
      engine.listMoveChoices([palm])[0].options.map((option) => option.id),
      ['stay', 'push:5', 'push:10', 'push:15'],
    );

    // Дальнее перемещение: вариантов не больше, чем вмещает плашка
    const far = createEffect('Ураган', {
      triggers: [
        {
          id: 'trigger_far',
          event: 'applied',
          actions: [
            { type: 'move', kind: 'choose', distance: 100, upTo: true },
          ],
        },
      ],
    });

    assert.ok(engine.listMoveChoices([far])[0].options.length <= 12);

    // Спросить некого (срабатывание ауры) — «на выбор» толкает от опоры
    const victim = createActor({ id: 'actor_victim' });
    const moves = [];
    const unasked = { ...shove, sourceActorId: 'actor_fighter' };

    engine.applyTriggerEffectActions(victim, sourceOf(unasked), false, {
      surroundings: {
        token: createToken(victim.id, 2, 0),
        gridSettings: GRID,
        neighbors: [
          {
            token: createToken('actor_fighter', 0, 0),
            entity: createActor({ id: 'actor_fighter' }),
          },
        ],
      },
      moveToken: (tokenId, position) => moves.push({ tokenId, position }),
    });

    assert.ok(moves[0].position.x > 2 * CELL_SIZE, 'оттолкнуло от наложившего');
  });

  it('[UA08] Срок «до конца текущего хода»', () => {
    // «Уменьшить скорость цели до 0 до конца текущего хода»
    const rooted = createEffect('Ветви древа: скорость 0', {
      effectTarget: 'target',
      flags: ['speed.zero'],
      turnCurrent: true,
      duration: { type: 'turn', value: 1, turnTiming: 'end' },
    });

    authoredScenario(rooted, 'spell');
    assert.match(detailsOf(rooted), /до конца текущего хода носителя/i);

    const context = {
      carrierId: 'actor_victim',
      sourceId: 'actor_barbarian',
      activeTurnActorId: 'actor_victim',
    };

    // Наложен в ход цели: с полем — до конца этого хода, без него — следующего
    assert.equal(
      engine.stampTurnDuration(rooted, context).duration.turnSkipFirst,
      false,
    );

    assert.equal(
      engine.stampTurnDuration({ ...rooted, turnCurrent: undefined }, context)
        .duration.turnSkipFirst,
      true,
    );

    const victim = createActor({
      id: 'actor_victim',
      activeEffects: [engine.stampTurnDuration(rooted, context)],
    });

    engine.expireTurnEffects(victim, 'actor_victim', 'end');
    assert.deepEqual(victim.activeEffects, [], 'кончился с концом этого хода');
  });

  it('[UA09] Рассеивание магии: круг — формулой от ячейки каста', () => {
    // «Автоматически прекращаете заклинание, если его уровень равен или меньше
    // уровня ячейки, которую вы используете»
    const dispel = createEffect('Рассеивание магии', {
      effectTarget: 'target',
      triggers: [
        {
          id: 'trigger_dispel',
          event: 'applied',
          actions: [
            { type: 'dispel', maxLevel: 3, maxLevelFormula: '@castLevel' },
            { type: 'removeSelf' },
          ],
        },
      ],
    });

    assert.match(authoredScenario(dispel, 'spell'), /круг/i);

    // Круг ячейки подставляется при касте — как в остальные формулы
    const cast = engine.bindEffectToken(dispel, '@castLevel', 5);

    assert.equal(cast.triggers[0].actions[0].maxLevelFormula, '5');

    const victim = createActor({
      activeEffects: [
        createEffect('Полёт', { castId: 'cast_fly', castLevel: 3 }),
        createEffect('Каменная кожа', { castId: 'cast_skin', castLevel: 4 }),
        createEffect('Облик', { castId: 'cast_shape', castLevel: 6 }),
      ],
    });

    engine.applyTriggerEffectActions(victim, sourceOf(cast), false);

    assert.deepEqual(
      victim.activeEffects.map((effect) => effect.name),
      ['Облик'],
      'сняты заклинания не выше 5 круга',
    );

    // Формула не посчиталась — действует круг числом
    const broken = {
      ...dispel,
      triggers: [
        {
          ...dispel.triggers[0],
          actions: [{ type: 'dispel', maxLevel: 3, maxLevelFormula: '@nope' }],
        },
      ],
    };

    const other = createActor({
      activeEffects: [
        createEffect('Полёт', { castId: 'cast_fly', castLevel: 3 }),
        createEffect('Каменная кожа', { castId: 'cast_skin', castLevel: 4 }),
      ],
    });

    engine.applyTriggerEffectActions(other, sourceOf(broken), false);

    assert.deepEqual(
      other.activeEffects.map((effect) => effect.name),
      ['Каменная кожа'],
    );
  });

  it('[UA10] Магический круг: один или несколько вариантов сразу', () => {
    // «Выберите 1 или несколько типов существ»
    const variants = ['celestial', 'elemental', 'fey', 'fiend', 'undead'].map(
      (type) =>
        createEffect(`Магический круг: ${type}`, {
          effectTarget: 'zone',
          variant: { group: 'Типы существ', label: type, pick: 'multi' },
          flags: ['attacksAgainst.disadvantage'],
          conditionImmunities: ['charmed', 'frightened'],
          rollCondition: `incoming.attackerCreatureType === "${type}"`,
        }),
    );

    const [group] = engine.listEffectVariantGroups(variants);

    assert.equal(group.pick, 'multi');
    assert.equal(group.labels.length, 5);

    const picked = engine.pickEffectVariants(variants, {
      'Типы существ': engine.joinVariantChoice(['fey', 'undead']),
    });

    assert.deepEqual(
      picked.map((effect) => effect.variant.label),
      ['fey', 'undead'],
    );

    // Сделанный выбор читается обратно — им сверяют свежую запись заклинания
    assert.deepEqual(
      engine.splitVariantChoice(
        engine.readEffectVariantChoices(picked)['Типы существ'],
      ),
      ['fey', 'undead'],
    );

    // Одиночный выбор работает как раньше
    assert.deepEqual(
      engine
        .pickEffectVariants(variants, { 'Типы существ': 'fiend' })
        .map((effect) => effect.variant.label),
      ['fiend'],
    );
  });
});
