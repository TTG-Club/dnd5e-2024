import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { allCreaturesAura, engine } from './scenarios/_fixtures.mjs';

/** Сложность спасброска эффектов в тестах */
const SAVE_DC = 13;

/** Приоритет модификатора по умолчанию */
const DEFAULT_PRIORITY = 20;

/** Приоритет, набранный в поле строкой */
const TYPED_PRIORITY = 15;

/** Радиус ауры в тестах */
const AURA_RADIUS = 10;

/** Спасбросок Телосложения с половиной урона при успехе */
const CONSTITUTION_SAVE = {
  ability: 'constitution',
  dc: SAVE_DC,
  onSuccess: 'half',
};

/** Яд 2к6 */
const POISON_DAMAGE = [{ formula: '2d6', type: 'poison' }];

/** Модификатор скорости ходьбы */
const WALK_SPEED_CHANGE = {
  key: 'movement.walk',
  mode: 'add',
  value: '10',
  priority: DEFAULT_PRIORITY,
};

/** Аура союзникам */
const ALLIES_AURA = {
  radius: AURA_RADIUS,
  target: 'allies',
  applyToSelf: true,
  visible: true,
};

/**
 * Эффект в форме редактора.
 *
 * @param {object} overrides - поля, отличные от умолчания
 * @returns {object} эффект
 */
function createEffect(overrides = {}) {
  return {
    id: 'effect_test',
    name: 'Тест',
    description: '',
    disabled: false,
    origin: 'manual',
    transfer: false,
    duration: { type: 'permanent' },
    changes: [],
    flags: [],
    ...overrides,
  };
}

/**
 * Раскладка окна для эффекта.
 *
 * @param {string} context - место окна
 * @param {object} overrides - поля эффекта
 * @returns {object} раскладка
 */
function layoutOf(context, overrides = {}) {
  return engine.resolveEffectFormLayout(context, createEffect(overrides));
}

describe('место окна эффекта', () => {
  it('явное место важнее прежних пропов', () => {
    assert.equal(
      engine.resolveEffectFormContext('weapon', { showAreaTrigger: true }),
      'weapon',
    );
  });

  it('старое ядро: окно зоны, окно состояния, остальное — как раньше', () => {
    assert.equal(
      engine.resolveEffectFormContext(undefined, { showAreaTrigger: true }),
      'zone',
    );

    assert.equal(
      engine.resolveEffectFormContext(undefined, { hideConditionPreset: true }),
      'condition',
    );

    assert.equal(engine.resolveEffectFormContext(undefined, {}), 'generic');
    assert.equal(engine.resolveEffectFormContext('unknown', {}), 'generic');
  });
});

describe('новый эффект по месту окна', () => {
  it('у действия существа и заклинания эффект сразу на цели', () => {
    for (const context of ['creatureAction', 'spell']) {
      const effect = engine.createEffectForContext(
        context,
        'effect_new',
        'Новый',
      );

      assert.equal(effect.effectTarget, 'target', context);
      assert.equal(engine.readEffectDelivery(effect, context), 'target');
    }
  });

  it('у черты существа и оружия эффект на носителе', () => {
    for (const context of ['creatureTrait', 'weapon', 'item', 'feature']) {
      const effect = engine.createEffectForContext(
        context,
        'effect_new',
        'Новый',
      );

      assert.equal(effect.effectTarget, 'self', context);
      assert.equal(engine.readEffectDelivery(effect, context), 'carrier');
    }
  });
});

describe('раскладка окна эффекта', () => {
  it('зона «пока внутри»: без спасброска, с уроном каждый ход, без длительности', () => {
    const layout = layoutOf('zone');

    assert.equal(layout.delivery, 'zone');
    assert.deepEqual(layout.deliveryOptions, ['zone']);
    assert.equal(layout.showTrigger, true);
    assert.equal(layout.showSave, false);
    assert.equal(layout.saveUnavailableReason, 'stayTrigger');
    assert.equal(layout.showTriggerDamage, false);
    assert.equal(layout.showRecurringDamage, true);
    assert.equal(layout.showDuration, false);
    assert.equal(layout.showRecurringSave, false);
    assert.equal(layout.showConsumeOn, false);
    assert.equal(layout.minSaveDc, 1);
  });

  it('зона «при входе»: спасбросок, урон срабатывания и сроки копии', () => {
    const layout = layoutOf('zone', { areaTrigger: 'enter' });

    assert.equal(layout.showSave, true);
    assert.equal(layout.saveUnavailableReason, null);
    assert.equal(layout.showTriggerDamage, true);
    assert.equal(layout.showDuration, true);
    assert.equal(layout.showRecurringSave, true);
    assert.equal(layout.showConsumeOn, true);
  });

  it('черта персонажа на носителе — пассив: только то, что меняет', () => {
    const layout = layoutOf('feature');

    assert.deepEqual(layout.deliveryOptions, ['carrier', 'aura']);
    assert.equal(layout.showTrigger, false);
    assert.equal(layout.showSave, false);
    assert.equal(layout.saveUnavailableReason, null);
    assert.equal(layout.showRecurringDamage, false);
    assert.equal(layout.showDuration, false);
    assert.equal(layout.showRecurringSave, false);
    assert.equal(layout.showConditionImmunities, true);
  });

  it('черта существа на носителе: урон и лечение каждый ход, без повторного спасброска', () => {
    const layout = layoutOf('creatureTrait');

    assert.equal(layout.showRecurringDamage, true);
    assert.equal(layout.showRecurringSave, false);
    assert.equal(layout.showDuration, false);
    assert.equal(layout.showConsumeOn, false);
    assert.equal(layoutOf('item').showRecurringDamage, false);
  });

  it('аура умения («Аура защиты»): «пока внутри» без сроков, вход — со спасброском', () => {
    const stay = layoutOf('feature', { aura: ALLIES_AURA });

    assert.equal(stay.delivery, 'aura');
    assert.equal(stay.showAuraSettings, true);
    assert.equal(stay.showSave, false);
    assert.equal(stay.saveUnavailableReason, 'stayTrigger');
    assert.equal(stay.showDuration, false);
    assert.equal(stay.showRecurringSave, false);

    const enter = layoutOf('feature', {
      aura: ALLIES_AURA,
      areaTrigger: 'enter',
    });

    assert.equal(enter.showSave, true);
    assert.equal(enter.showTriggerDamage, true);
    assert.equal(enter.showDuration, true);
    assert.equal(enter.minSaveDc, 1);
  });

  it('оружие на владельце подсказывает, где спасбросок', () => {
    const layout = layoutOf('weapon');

    assert.deepEqual(layout.deliveryOptions, ['carrier', 'target', 'aura']);
    assert.equal(layout.showSave, false);
    assert.equal(layout.saveUnavailableReason, 'onCarrier');
  });

  it('оружие «на цели при попадании»: спасбросок, Сл 0 — Сл оружия', () => {
    const effect = engine.writeEffectDelivery(createEffect(), 'target');
    const layout = engine.resolveEffectFormLayout('weapon', effect);

    assert.equal(layout.delivery, 'target');
    assert.equal(layout.showSave, true);
    assert.equal(layout.showDuration, true);
    assert.equal(layout.successOutcomeForActionSave, false);
    assert.equal(layout.minSaveDc, 0);
  });

  it('аура предмета «пока внутри»: без длительности, иммунитеты достаются накрытым', () => {
    const layout = layoutOf('item', { aura: ALLIES_AURA });

    assert.equal(layout.delivery, 'aura');
    assert.equal(layout.showAuraSettings, true);
    assert.equal(layout.showSave, false);
    assert.equal(layout.saveUnavailableReason, 'stayTrigger');
    assert.equal(layout.showDuration, false);
    assert.equal(layout.showConditionImmunities, true);
    assert.equal(layout.showRecurringDamage, true);
  });

  it('аура своих эффектов «пока внутри» тикает длительностью носителя', () => {
    const layout = layoutOf('ownEffects', { aura: ALLIES_AURA });

    assert.equal(layout.showDuration, true);
    assert.equal(layout.showRecurringSave, false);
  });

  it('свой эффект на носителе проживает свою жизнь', () => {
    const layout = layoutOf('ownEffects');

    assert.equal(layout.showSave, false);
    assert.equal(layout.showRecurringDamage, true);
    assert.equal(layout.showDuration, true);
    assert.equal(layout.showRecurringSave, true);
    assert.equal(layout.showConsumeOn, true);
  });

  it('действие существа: Сл 0 — Сл действия, «при успехе» — к спасброску действия', () => {
    const layout = layoutOf('creatureAction', {
      effectTarget: 'target',
      conditionKey: 'prone',
    });

    assert.deepEqual(layout.deliveryOptions, ['target', 'carrier']);
    assert.equal(layout.minSaveDc, 0);
    assert.equal(layout.successOutcomeForActionSave, true);

    assert.deepEqual(layout.successOutcomes, [
      'nothing',
      'effectWithoutDamage',
      'onlyOnSuccess',
    ]);
  });

  it('свой спасбросок эффекта снимает привязку «при успехе» к действию', () => {
    const layout = layoutOf('spell', {
      effectTarget: 'target',
      applySave: CONSTITUTION_SAVE,
    });

    assert.equal(layout.successOutcomeForActionSave, false);
    assert.equal(layout.minSaveDc, 0);
  });

  it('запись состояния: без шаблона состояния и спасброска', () => {
    const layout = layoutOf('condition');

    assert.equal(layout.showConditionPreset, false);
    assert.equal(layout.showSave, false);
    assert.equal(layout.showDuration, false);
  });

  it('место неизвестно: видно всё, как в старом окне', () => {
    const layout = layoutOf('generic');

    assert.equal(layout.showSave, true);
    assert.equal(layout.showTriggerDamage, true);
    assert.equal(layout.showRecurringDamage, true);
    assert.equal(layout.showDuration, true);
    assert.equal(layout.showRecurringSave, true);
    assert.equal(layout.showConsumeOn, true);
    assert.equal(layout.showConditionImmunities, true);
    assert.equal(layout.minSaveDc, 0);
  });
});

describe('доставка эффекта', () => {
  it('«на цели» снимает ауру и момент срабатывания', () => {
    const effect = engine.writeEffectDelivery(
      createEffect({ aura: ALLIES_AURA, areaTrigger: 'enter' }),
      'target',
    );

    assert.equal(effect.effectTarget, 'target');
    assert.equal(effect.aura, undefined);
    assert.equal(effect.areaTrigger, undefined);
  });

  it('аура сохраняет уже настроенный радиус', () => {
    const effect = engine.writeEffectDelivery(
      createEffect({ aura: { ...ALLIES_AURA, radius: 30 } }),
      'aura',
    );

    assert.equal(effect.effectTarget, 'self');
    assert.equal(effect.aura.radius, 30);
  });

  it('«пока внутри» не хранится полем', () => {
    const effect = engine.writeEffectTrigger(
      createEffect({ areaTrigger: 'enter' }),
      'stay',
    );

    assert.equal(effect.areaTrigger, undefined);
    assert.equal(engine.readEffectTrigger(effect), 'stay');
  });
});

describe('исход успешного спасброска', () => {
  /** Ожидаемые поля по исходу */
  const OUTCOME_FIELDS = {
    nothing: ['negate', undefined, undefined],
    halfDamage: ['half', undefined, undefined],
    halfDamageWithEffect: ['half', true, undefined],
    effectWithoutDamage: ['negate', true, undefined],
    onlyOnSuccess: ['negate', undefined, true],
  };

  it('запись и чтение сходятся для каждого исхода', () => {
    for (const outcome of engine.EFFECT_SUCCESS_OUTCOMES) {
      const effect = engine.writeEffectSuccessOutcome(
        createEffect({
          applySave: CONSTITUTION_SAVE,
          applyOnSuccess: true,
          applyOnSuccessOnly: true,
        }),
        outcome,
      );

      const [onSuccess, applyOnSuccess, applyOnSuccessOnly] =
        OUTCOME_FIELDS[outcome];

      assert.equal(engine.readEffectSuccessOutcome(effect), outcome);
      assert.equal(effect.applySave.onSuccess, onSuccess, outcome);
      assert.equal(effect.applyOnSuccess, applyOnSuccess, outcome);
      assert.equal(effect.applyOnSuccessOnly, applyOnSuccessOnly, outcome);
    }
  });

  it('правила записи совпадают с гейтом наложения', () => {
    const passed = { landed: true, applySaveSucceeded: true };

    const expected = {
      nothing: { applyEffect: false, damageMultiplier: 0 },
      halfDamage: { applyEffect: false, damageMultiplier: 0.5 },
      halfDamageWithEffect: { applyEffect: true, damageMultiplier: 0.5 },
      effectWithoutDamage: { applyEffect: true, damageMultiplier: 0 },
      onlyOnSuccess: { applyEffect: true, damageMultiplier: 1 },
    };

    for (const outcome of engine.EFFECT_SUCCESS_OUTCOMES) {
      const effect = engine.writeEffectSuccessOutcome(
        createEffect({ applySave: CONSTITUTION_SAVE }),
        outcome,
      );

      assert.deepEqual(
        engine.resolveEffectApplication(effect, passed),
        expected[outcome],
        outcome,
      );
    }
  });

  it('варианты — только осмысленные для настройки', () => {
    const outcomesOf = (overrides) =>
      layoutOf('zone', {
        areaTrigger: 'enter',
        applySave: CONSTITUTION_SAVE,
        ...overrides,
      }).successOutcomes;

    assert.deepEqual(
      outcomesOf({ applySave: { ...CONSTITUTION_SAVE, onSuccess: 'negate' } }),
      ['nothing'],
    );

    assert.deepEqual(outcomesOf({ damageParts: POISON_DAMAGE }), [
      'nothing',
      'halfDamage',
    ]);

    assert.deepEqual(
      outcomesOf({ damageParts: POISON_DAMAGE, conditionKey: 'poisoned' }),
      [...engine.EFFECT_SUCCESS_OUTCOMES],
    );

    assert.deepEqual(outcomesOf({ conditionKey: 'poisoned' }), [
      'nothing',
      'halfDamage',
      'effectWithoutDamage',
      'onlyOnSuccess',
    ]);
  });

  it('без спасброска выбора нет', () => {
    assert.deepEqual(
      layoutOf('zone', { areaTrigger: 'enter', conditionKey: 'poisoned' })
        .successOutcomes,
      [],
    );
  });
});

describe('неработающие поля', () => {
  it('на черте персонажа находятся и убираются', () => {
    const effect = createEffect({
      aura: ALLIES_AURA,
      applySave: CONSTITUTION_SAVE,
      recurringSave: { ability: 'wisdom', dc: SAVE_DC, timing: 'endOfTurn' },
      duration: { type: 'rounds', value: 3 },
      changes: [WALK_SPEED_CHANGE],
    });

    const layout = engine.resolveEffectFormLayout('feature', effect);
    const inert = engine.listInertEffectFields(effect, layout);

    // Аура умения работает: персонаж излучает её сам
    assert.deepEqual(inert, ['applySave', 'recurringSave', 'duration']);

    const cleared = engine.clearInertEffectFields(effect, inert, 'feature');

    assert.deepEqual(cleared.aura, ALLIES_AURA);
    assert.equal(cleared.applySave, undefined);
    assert.equal(cleared.recurringSave, undefined);
    assert.deepEqual(cleared.duration, { type: 'permanent' });
    assert.deepEqual(cleared.changes, [WALK_SPEED_CHANGE]);

    assert.deepEqual(
      engine.listInertEffectFields(
        cleared,
        engine.resolveEffectFormLayout('feature', cleared),
      ),
      [],
    );
  });

  it('эффект черты существа и умения «на цели» возвращается на носителя', () => {
    const effect = createEffect({ effectTarget: 'target' });

    for (const context of ['creatureTrait', 'feature', 'item']) {
      const layout = engine.resolveEffectFormLayout(context, effect);

      assert.deepEqual(
        engine.listInertEffectFields(effect, layout),
        ['effectTarget'],
        context,
      );

      assert.equal(
        engine.clearInertEffectFields(effect, ['effectTarget'], context)
          .effectTarget,
        'self',
        context,
      );
    }
  });

  it('эффект действия существа «на носителе» ложится на само существо', () => {
    const effect = createEffect({ effectTarget: 'self' });
    const layout = engine.resolveEffectFormLayout('creatureAction', effect);

    assert.equal(layout.delivery, 'carrier');
    assert.deepEqual(engine.listInertEffectFields(effect, layout), []);
    assert.equal(layout.showDuration, true, 'копия живёт на существе');
    assert.equal(layout.showLandingCondition, true);
  });

  it('эффект действия существа «в зоне» не работает', () => {
    const effect = createEffect({ effectTarget: 'zone' });
    const layout = engine.resolveEffectFormLayout('creatureAction', effect);

    assert.deepEqual(engine.listInertEffectFields(effect, layout), [
      'effectTarget',
    ]);

    assert.equal(
      engine.clearInertEffectFields(effect, ['effectTarget'], 'creatureAction')
        .effectTarget,
      'target',
    );
  });

  it('спасбросок и «при успехе» у зоны «пока внутри»', () => {
    const effect = createEffect({
      applySave: CONSTITUTION_SAVE,
      applyOnSuccess: true,
      damageParts: POISON_DAMAGE,
    });

    const layout = engine.resolveEffectFormLayout('zone', effect);
    const inert = engine.listInertEffectFields(effect, layout);

    assert.deepEqual(inert, ['applySave', 'successOutcome', 'damageParts']);

    const cleared = engine.clearInertEffectFields(effect, inert, 'zone');

    assert.equal(cleared.applySave, undefined);
    assert.equal(cleared.applyOnSuccess, undefined);
    assert.equal(cleared.applyOnSuccessOnly, undefined);
    assert.equal(cleared.damageParts, undefined);
  });

  it('в неизвестном месте ничего не помечается', () => {
    const effect = createEffect({
      aura: ALLIES_AURA,
      applySave: CONSTITUTION_SAVE,
      effectTarget: 'target',
    });

    assert.deepEqual(
      engine.listInertEffectFields(
        effect,
        engine.resolveEffectFormLayout('generic', effect),
      ),
      [],
    );
  });
});

describe('шаги окна', () => {
  it('черта — выбор «на персонаже / аурой» и «что меняет», состояние — только «что меняет»', () => {
    assert.deepEqual(engine.listEffectFormSteps(layoutOf('feature')), [
      'trigger',
      'modifiers',
      'triggers',
    ]);

    assert.deepEqual(engine.listEffectFormSteps(layoutOf('condition')), [
      'modifiers',
    ]);
  });

  it('зона «пока внутри» объясняет, почему нет спасброска', () => {
    assert.deepEqual(engine.listEffectFormSteps(layoutOf('zone')), [
      'trigger',
      'save',
      'modifiers',
      'triggers',
    ]);
  });

  it('зона «при входе» — все шаги', () => {
    assert.deepEqual(
      engine.listEffectFormSteps(layoutOf('zone', { areaTrigger: 'enter' })),
      [...engine.EFFECT_FORM_STEPS],
    );
  });

  it('действие существа: доставка на цель или на себя', () => {
    assert.deepEqual(
      engine.listEffectFormSteps(
        layoutOf('creatureAction', { effectTarget: 'target' }),
      ),
      ['trigger', 'save', 'damage', 'modifiers', 'duration', 'triggers'],
    );
  });

  it('условие наложения и вариант держат шаг «Когда срабатывает»', () => {
    assert.deepEqual(
      engine.listEffectFormSteps(layoutOf('condition')),
      ['modifiers'],
      'у записи состояния шага нет',
    );

    const layout = engine.resolveEffectFormLayout('spell', {
      ...createEffect({ effectTarget: 'target' }),
    });

    assert.equal(layout.showVariant, true);
    assert.ok(engine.listEffectFormSteps(layout).includes('trigger'));
  });
});

describe('применение и включение', () => {
  it('способы по месту окна: предмет применяют, умение ещё и включают', () => {
    assert.deepEqual(layoutOf('item').activationModes, ['use']);
    assert.deepEqual(layoutOf('feature').activationModes, ['use', 'toggle']);
    assert.deepEqual(layoutOf('ownEffects').activationModes, ['use', 'toggle']);
    assert.deepEqual(layoutOf('spell').activationModes, []);
    assert.deepEqual(layoutOf('creatureTrait').activationModes, []);
  });

  it('применяемый предмет: цель, копия живёт сама и слышит «при наложении»', () => {
    const potion = createEffect({ activation: { mode: 'use' } });
    const layout = engine.resolveEffectFormLayout('item', potion);

    assert.deepEqual(layout.deliveryOptions, ['carrier', 'target', 'aura']);
    assert.equal(layout.showDuration, true);
    assert.equal(layout.showVariant, true);
    assert.equal(layout.showLandingCondition, true);
    assert.equal(layout.showActivationCounter, false, 'предмет тратит заряды');
    assert.ok(layout.triggerEvents.includes('applied'));
    assert.ok(layout.triggerActions.includes('removeSelf'));

    const onTarget = { ...potion, effectTarget: 'target' };

    assert.deepEqual(
      engine.listInertEffectFields(
        onTarget,
        engine.resolveEffectFormLayout('item', onTarget),
      ),
      [],
    );

    const worn = createEffect({ effectTarget: 'target' });

    assert.deepEqual(
      engine.listInertEffectFields(
        worn,
        engine.resolveEffectFormLayout('item', worn),
      ),
      ['effectTarget'],
      'надетый предмет цели ничего не накладывает',
    );
  });

  it('переключаемое умение: ресурс и событие «При включении»', () => {
    const rage = createEffect({
      activation: { mode: 'toggle', counter: 'rage' },
    });

    const layout = engine.resolveEffectFormLayout('feature', rage);

    assert.equal(layout.showActivationCounter, true);
    assert.equal(layout.showDuration, true);
    assert.ok(layout.triggerEvents.includes('activate'));
    assert.equal(layout.minSaveDc, 1, 'у своего эффекта Сл источника нет');
  });

  it('применяемое умение на цели бросает против Сл применившего', () => {
    const turn = createEffect({
      effectTarget: 'target',
      activation: { mode: 'use', counter: 'channelDivinity' },
    });

    const layout = engine.resolveEffectFormLayout('feature', turn);

    assert.equal(layout.delivery, 'target');
    assert.equal(layout.minSaveDc, 0);
    assert.equal(layout.showSave, true);
  });

  it('применение не для этого места — неработающее поле', () => {
    const toggled = createEffect({ activation: { mode: 'toggle' } });
    const layout = engine.resolveEffectFormLayout('item', toggled);

    assert.deepEqual(engine.listInertEffectFields(toggled, layout), [
      'activation',
    ]);

    assert.equal(
      engine.clearInertEffectFields(toggled, ['activation'], 'item').activation,
      undefined,
    );
  });

  it('черновик: пустой ресурс не пишется, расход — только с ресурсом', () => {
    const layout = layoutOf('feature');

    const normalize = (activation) =>
      engine.normalizeEffectDraft(createEffect({ activation }), layout)
        .activation;

    assert.deepEqual(normalize({ mode: 'use', counter: '  ', amount: 3 }), {
      mode: 'use',
      counter: undefined,
      amount: undefined,
    });

    assert.deepEqual(
      normalize({ mode: 'toggle', counter: 'ki', amount: '2' }),
      {
        mode: 'toggle',
        counter: 'ki',
        amount: 2,
      },
    );

    assert.equal(normalize(undefined), undefined);
  });

  it('схема записи: неизвестный способ отбрасывает только применение', () => {
    const [parsed] = engine.ActiveEffectsArraySchema.parse([
      createEffect({ activation: { mode: 'charge' } }),
    ]);

    assert.equal(parsed.activation, undefined);

    const [kept] = engine.ActiveEffectsArraySchema.parse([
      createEffect({ activation: { mode: 'use', counter: 'ki', amount: 2 } }),
    ]);

    assert.deepEqual(kept.activation, {
      mode: 'use',
      counter: 'ki',
      amount: 2,
    });
  });
});

describe('переключатели спасбросков', () => {
  it('новый спасбросок: Сл по умолчанию у зоны, Сл источника у заклинания', () => {
    const zoneEffect = createEffect({ areaTrigger: 'enter' });

    const zoneSave = engine.writeEffectSaveEnabled(
      zoneEffect,
      true,
      engine.resolveEffectFormLayout('zone', zoneEffect),
    ).applySave;

    assert.deepEqual(zoneSave, {
      ability: 'wisdom',
      dc: engine.DEFAULT_EFFECT_SAVE_DC,
      onSuccess: 'negate',
    });

    const spellEffect = createEffect({ effectTarget: 'target' });

    assert.equal(
      engine.writeEffectSaveEnabled(
        spellEffect,
        true,
        engine.resolveEffectFormLayout('spell', spellEffect),
      ).applySave.dc,
      0,
    );
  });

  it('включение не сбрасывает уже настроенный спасбросок', () => {
    const effect = createEffect({
      areaTrigger: 'enter',
      applySave: CONSTITUTION_SAVE,
    });

    assert.deepEqual(
      engine.writeEffectSaveEnabled(
        effect,
        true,
        engine.resolveEffectFormLayout('zone', effect),
      ).applySave,
      CONSTITUTION_SAVE,
    );
  });

  it('без спасброска у зоны уходит и «при успехе»', () => {
    const effect = createEffect({
      areaTrigger: 'enter',
      applySave: CONSTITUTION_SAVE,
      applyOnSuccessOnly: true,
    });

    const cleared = engine.writeEffectSaveEnabled(
      effect,
      false,
      engine.resolveEffectFormLayout('zone', effect),
    );

    assert.equal(cleared.applySave, undefined);
    assert.equal(cleared.applyOnSuccessOnly, undefined);
  });

  it('у действия существа «при успехе» остаётся за спасброском действия', () => {
    const effect = createEffect({
      effectTarget: 'target',
      applySave: CONSTITUTION_SAVE,
      applyOnSuccessOnly: true,
    });

    const cleared = engine.writeEffectSaveEnabled(
      effect,
      false,
      engine.resolveEffectFormLayout('creatureAction', effect),
    );

    assert.equal(cleared.applySave, undefined);
    assert.equal(cleared.applyOnSuccessOnly, true);
  });
});

describe('список «Срабатывания»', () => {
  it('события и действия по месту: ход — где эффект тикает, вход и выход — у зоны, атака и снятие — у лежащего на существе', () => {
    const own = layoutOf('ownEffects');

    assert.deepEqual(own.triggerEvents, [
      'turnStart',
      'turnEnd',
      'attackRoll',
      'damageTaken',
      'hpZero',
      'rest',
    ]);

    assert.deepEqual(own.triggerActions, [
      'damage',
      'applyCondition',
      'applyTag',
      'reduceMaxHp',
      'setHp',
      'endCast',
      'removeSelf',
    ]);

    assert.deepEqual(
      engine.listTriggerActionTypes(own, 'attackRoll'),
      [
        'damage',
        'applyCondition',
        'applyTag',
        'reduceMaxHp',
        'endCast',
        'removeSelf',
      ],
      'урон на броске атаки выполняет сервер',
    );

    assert.equal(engine.triggerEventHasOtherParty('attackRoll'), true);

    assert.deepEqual(
      engine.listTriggerActionTypes(own, 'hpZero'),
      [
        'damage',
        'applyCondition',
        'applyTag',
        'reduceMaxHp',
        'setHp',
        'endCast',
        'removeSelf',
      ],
      '«хиты становятся» — только когда хиты упали до 0',
    );

    assert.equal(engine.triggerEventAcceptsDcFormula('damageTaken'), true);
    assert.equal(engine.triggerEventAcceptsDcFormula('turnEnd'), false);
    assert.equal(engine.triggerEventHasOtherParty('damageTaken'), true);
    assert.equal(engine.triggerEventHasOtherParty('hpZero'), false);
    assert.equal(engine.triggerEventAcceptsDcFormula('applied'), true);
    assert.equal(engine.triggerEventHasOtherParty('applied'), true);

    const zone = layoutOf('zone');

    assert.deepEqual(zone.triggerEvents, [
      'turnStart',
      'turnEnd',
      'enter',
      'exit',
    ]);

    assert.deepEqual(zone.triggerActions, [
      'damage',
      'applyCondition',
      'applyTag',
      'reduceMaxHp',
    ]);

    assert.deepEqual(
      layoutOf('spell', { effectTarget: 'target' }).triggerEvents,
      [
        'applied',
        'turnStart',
        'turnEnd',
        'attackRoll',
        'damageTaken',
        'hpZero',
        'castEnd',
        'rest',
      ],
      'эффект заклинания на цели слышит урон по цели и конец каста',
    );

    assert.deepEqual(
      layoutOf('spell', {
        aura: allCreaturesAura(AURA_RADIUS),
      }).triggerEvents,
      ['turnStart', 'turnEnd', 'enter', 'exit', 'damageTaken', 'hpZero'],
      'в ауру входят и выходят так же, как в зону',
    );

    const trait = layoutOf('creatureTrait');

    assert.deepEqual(trait.triggerEvents, [
      'turnStart',
      'turnEnd',
      'damageTaken',
      'hpZero',
    ]);

    assert.deepEqual(trait.triggerActions, [
      'damage',
      'applyCondition',
      'applyTag',
      'reduceMaxHp',
      'setHp',
    ]);

    assert.deepEqual(
      own.triggerTurnOwners,
      ['subject', 'source'],
      'эффект накладывают — выбирается и ход наложившего',
    );

    assert.deepEqual(
      trait.triggerTurnOwners,
      ['subject'],
      'у черты существа наложившего нет',
    );

    for (const context of ['feature', 'item']) {
      assert.deepEqual(
        layoutOf(context).triggerEvents,
        ['damageTaken', 'hpZero'],
        `${context}: эффект слышит урон по носителю`,
      );
    }

    assert.deepEqual(layoutOf('condition').triggerEvents, []);
  });

  it('пресеты по месту; повторный спасбросок повторяет спасбросок эффекта', () => {
    assert.deepEqual(engine.listEffectTriggerPresets(layoutOf('ownEffects')), [
      'recurringDamage',
      'recurringSave',
      'consumeOn',
      'hpZeroToOne',
      'tagOnDamage',
      'custom',
    ]);

    assert.deepEqual(engine.listEffectTriggerPresets(layoutOf('zone')), [
      'recurringDamage',
      'custom',
    ]);

    const effect = createEffect({
      effectTarget: 'target',
      applySave: CONSTITUTION_SAVE,
    });

    const layout = engine.resolveEffectFormLayout('weapon', effect);

    const preset = engine.createEffectTriggerPreset(
      'recurringSave',
      effect,
      layout,
    );

    assert.deepEqual(
      engine.writeEffectTriggerRow(effect, 0, preset).recurringSave,
      { ability: 'constitution', dc: SAVE_DC, timing: 'endOfTurn' },
    );

    const spell = createEffect({ effectTarget: 'target' });

    assert.equal(
      engine.createEffectTriggerPreset(
        'recurringSave',
        spell,
        engine.resolveEffectFormLayout('spell', spell),
      ).save.dc,
      0,
      'у заклинания — Сл заклинателя',
    );
  });

  it('запись «сначала старые поля»: лимит уводит строку в triggers, удаление снимает поле', () => {
    const layout = layoutOf('ownEffects');
    const effect = createEffect();

    const burning = engine.writeEffectTriggerRow(
      effect,
      0,
      engine.createEffectTriggerPreset('recurringDamage', effect, layout),
    );

    assert.deepEqual(burning.recurringDamage, {
      damageParts: [],
      timing: 'startOfTurn',
    });

    assert.equal(burning.triggers, undefined);

    const [row] = engine.listEffectListTriggers(burning);

    const limited = engine.writeEffectTriggerRow(burning, 0, {
      ...row,
      actions: [{ type: 'damage', parts: POISON_DAMAGE }],
      limit: { max: 1, per: 'turn' },
    });

    assert.equal(limited.recurringDamage, undefined);
    assert.equal(limited.triggers.length, 1);

    assert.notEqual(
      limited.triggers[0].id,
      row.id,
      'id legacy.* не уходит в triggers',
    );

    assert.deepEqual(limited.triggers[0].limit, { max: 1, per: 'turn' });

    const consumed = engine.writeEffectTriggerRow(
      limited,
      1,
      engine.createEffectTriggerPreset('consumeOn', limited, layout),
    );

    assert.equal(consumed.consumeOn, 'carrierAttack');

    assert.deepEqual(
      engine.listEffectListTriggers(consumed).map((trigger) => trigger.event),
      ['attackRoll', 'turnStart'],
      'старые поля читаются первыми',
    );

    const removed = engine.writeEffectTriggerRow(consumed, 0, null);

    assert.equal(removed.consumeOn, undefined);
    assert.equal(removed.triggers.length, 1);
  });

  it('срабатывание не для этого места — плашкой; «Убрать» оставляет работающие', () => {
    const effect = createEffect({
      triggers: [
        {
          id: 'trigger_attack',
          event: 'attackRoll',
          actions: [{ type: 'removeSelf' }],
        },
        {
          id: 'trigger_turn',
          event: 'turnStart',
          actions: [{ type: 'damage', parts: POISON_DAMAGE }],
        },
      ],
    });

    const layout = engine.resolveEffectFormLayout('zone', effect);

    assert.deepEqual(engine.listInertEffectFields(effect, layout), [
      'triggers',
    ]);

    const cleared = engine.clearInertEffectFields(effect, ['triggers'], 'zone');

    assert.deepEqual(
      cleared.triggers.map((trigger) => trigger.id),
      ['trigger_turn'],
    );

    assert.deepEqual(
      engine.listInertEffectFields(effect, layoutOf('ownEffects')),
      [],
    );
  });

  it('сохранение: без действий не пишется, Сл и лимит — числами в границах', () => {
    const effect = createEffect({
      triggers: [
        { id: 'trigger_empty', event: 'turnStart', actions: [] },
        {
          id: 'trigger_stench',
          event: 'turnStart',
          save: { ability: 'constitution', dc: '' },
          actions: [{ type: 'applyCondition', conditionKey: 'poisoned' }],
          limit: { max: '0', per: 'round' },
        },
      ],
    });

    const zoneLayout = engine.resolveEffectFormLayout('zone', effect);
    const saved = engine.normalizeEffectDraft(effect, zoneLayout);

    assert.deepEqual(
      saved.triggers.map((trigger) => trigger.id),
      ['trigger_stench'],
    );

    assert.equal(saved.triggers[0].save.dc, engine.DEFAULT_EFFECT_SAVE_DC);
    assert.deepEqual(saved.triggers[0].limit, { max: 1, per: 'round' });

    assert.equal(
      engine.normalizeEffectDraft(
        createEffect({
          triggers: [{ id: 't', event: 'turnEnd', actions: [] }],
        }),
        zoneLayout,
      ).triggers,
      undefined,
    );
  });
});

describe('шаблон состояния', () => {
  it('берёт то, что делает состояние, и оставляет срабатывание', () => {
    const effect = createEffect({
      areaTrigger: 'enter',
      applySave: CONSTITUTION_SAVE,
      damageParts: POISON_DAMAGE,
      duration: { type: 'minutes', value: 1 },
      changes: [WALK_SPEED_CHANGE],
      exhaustionLevel: 2,
    });

    const condition = engine.buildConditionActiveEffect('poisoned');
    const applied = engine.applyConditionPresetToEffect(effect, condition);

    assert.equal(applied.id, effect.id);
    assert.equal(applied.areaTrigger, 'enter');
    assert.deepEqual(applied.applySave, CONSTITUTION_SAVE);
    assert.deepEqual(applied.damageParts, POISON_DAMAGE);
    assert.deepEqual(applied.duration, { type: 'minutes', value: 1 });

    assert.equal(applied.conditionKey, 'poisoned');
    assert.equal(applied.name, condition.name);
    assert.deepEqual(applied.changes, condition.changes);
    assert.deepEqual(applied.flags, condition.flags);
    assert.equal(applied.exhaustionLevel, undefined);
  });
});

describe('черновик перед сохранением', () => {
  it('числа из полей — числами, пустое — умолчанием', () => {
    const effect = createEffect({
      name: '  Яд  ',
      areaTrigger: 'enter',
      duration: { type: 'minutes', value: '' },
      changes: [
        { ...WALK_SPEED_CHANGE, priority: '' },
        { ...WALK_SPEED_CHANGE, priority: String(TYPED_PRIORITY) },
      ],
      applySave: { ...CONSTITUTION_SAVE, dc: '' },
      recurringSave: { ability: 'wisdom', dc: '15', timing: 'endOfTurn' },
      damageParts: [],
      conditionImmunities: [],
    });

    const normalized = engine.normalizeEffectDraft(
      effect,
      engine.resolveEffectFormLayout('zone', effect),
    );

    assert.equal(normalized.name, 'Яд');
    assert.equal(normalized.duration.type, 'minutes');
    assert.equal(normalized.duration.value, undefined);

    assert.deepEqual(
      normalized.changes.map((change) => change.priority),
      [DEFAULT_PRIORITY, TYPED_PRIORITY],
    );

    assert.equal(normalized.applySave.dc, engine.DEFAULT_EFFECT_SAVE_DC);
    assert.equal(normalized.recurringSave.dc, 15);
    assert.equal(normalized.damageParts, undefined);
    assert.equal(normalized.conditionImmunities, undefined);
  });

  it('сл спасброска против урона каждый ход: строка — числом, 0 у зоны — 1', () => {
    const effect = createEffect({
      recurringDamage: {
        damageParts: POISON_DAMAGE,
        timing: 'startOfTurn',
        save: { ...CONSTITUTION_SAVE, dc: '0' },
      },
    });

    const normalized = engine.normalizeEffectDraft(
      effect,
      engine.resolveEffectFormLayout('zone', effect),
    );

    assert.equal(normalized.recurringDamage.save.dc, 1);
    assert.deepEqual(normalized.recurringDamage.damageParts, POISON_DAMAGE);
  });

  it('отметка без годного ключа выбрасывается одна, а не со срабатыванием', () => {
    const effect = createEffect({
      triggers: [
        {
          id: 'trigger_marks',
          event: 'turnStart',
          actions: [
            { type: 'applyTag', tag: '' },
            { type: 'applyTag', tag: 'огонь' },
          ],
        },
        {
          id: 'trigger_blank',
          event: 'turnEnd',
          actions: [{ type: 'applyTag', tag: 'с пробелом' }],
        },
      ],
    });

    const normalized = engine.normalizeEffectDraft(
      effect,
      engine.resolveEffectFormLayout('ownEffects', effect),
    );

    assert.deepEqual(
      normalized.triggers.map((trigger) => [
        trigger.id,
        trigger.actions.map((action) => action.tag),
      ]),
      [['trigger_marks', ['огонь']]],
    );

    assert.deepEqual(engine.listTriggerTags(effect.triggers), ['огонь']);
  });

  it('сл 0 остаётся «Сл источника» только там, где источник есть', () => {
    const spellEffect = createEffect({
      effectTarget: 'target',
      applySave: { ...CONSTITUTION_SAVE, dc: '' },
    });

    assert.equal(
      engine.normalizeEffectDraft(
        spellEffect,
        engine.resolveEffectFormLayout('spell', spellEffect),
      ).applySave.dc,
      0,
    );

    const zoneEffect = createEffect({
      areaTrigger: 'enter',
      applySave: { ...CONSTITUTION_SAVE, dc: 0 },
    });

    assert.equal(
      engine.normalizeEffectDraft(
        zoneEffect,
        engine.resolveEffectFormLayout('zone', zoneEffect),
      ).applySave.dc,
      1,
    );
  });
});

describe('живая сводка эффекта', () => {
  it('зона: спасбросок при входе, провал и успех', () => {
    const effect = createEffect({
      areaTrigger: 'enter',
      applySave: CONSTITUTION_SAVE,
      damageParts: POISON_DAMAGE,
      conditionKey: 'poisoned',
      duration: { type: 'minutes', value: 1 },
    });

    assert.equal(
      engine.describeEffectScenario(effect, 'zone'),
      'При входе в зону: спасбросок Телосложения, Сл 13. '
        + 'Провал — 2d6 ядом, «Отравленный», на 1 минуту. '
        + 'Успех — половина урона.',
    );
  });

  it('оружие: спасбросок при попадании', () => {
    const effect = createEffect({
      effectTarget: 'target',
      applySave: { ...CONSTITUTION_SAVE, onSuccess: 'negate' },
      conditionKey: 'poisoned',
      duration: { type: 'rounds', value: 1 },
    });

    assert.equal(
      engine.describeEffectScenario(effect, 'weapon'),
      'При попадании оружием: спасбросок Телосложения, Сл 13. '
        + 'Провал — «Отравленный», на 1 раунд. Успех — ничего.',
    );
  });

  it('«только при успехе»: провал ничего не даёт', () => {
    const effect = engine.writeEffectSuccessOutcome(
      createEffect({
        areaTrigger: 'exit',
        applySave: CONSTITUTION_SAVE,
        changes: [WALK_SPEED_CHANGE],
      }),
      'onlyOnSuccess',
    );

    assert.equal(
      engine.describeEffectScenario(effect, 'zone'),
      'При выходе из зоны: спасбросок Телосложения, Сл 13. '
        + 'Провал — ничего. Успех — Скорость (Ходьба) +10 фт.',
    );
  });

  it('пассив черты не говорит о спасброске и длительности', () => {
    const effect = createEffect({
      changes: [WALK_SPEED_CHANGE],
      applySave: CONSTITUTION_SAVE,
      duration: { type: 'rounds', value: 3 },
    });

    assert.equal(
      engine.describeEffectScenario(effect, 'feature'),
      'Постоянно у персонажа: Скорость (Ходьба) +10 фт.',
    );
  });

  it('состояние и пустой эффект', () => {
    assert.equal(
      engine.describeEffectScenario(
        createEffect({ flags: ['attack.disadvantage'] }),
        'condition',
      ),
      'Пока действует состояние: Помеха на все атаки.',
    );

    assert.equal(
      engine.describeEffectScenario(createEffect(), 'item'),
      'Пока предмет надет: эффект пока ничего не делает.',
    );
  });

  it('действие существа: Сл 0 — Сл действия', () => {
    const effect = createEffect({
      effectTarget: 'target',
      applySave: { ability: 'strength', dc: 0, onSuccess: 'negate' },
      conditionKey: 'prone',
    });

    assert.equal(
      engine.describeEffectScenario(effect, 'creatureAction'),
      'Когда действие задело цель: спасбросок Силы, Сл действия. '
        + 'Провал — «Лежащий ничком». Успех — ничего.',
    );
  });

  it('«при успехе» спасброска действия', () => {
    const effect = createEffect({
      effectTarget: 'target',
      conditionKey: 'grappled',
    });

    assert.equal(
      engine.describeEffectScenario(
        engine.writeEffectSuccessOutcome(effect, 'onlyOnSuccess'),
        'creatureAction',
      ),
      'Когда действие задело цель, если цель прошла спасбросок: «Схваченный».',
    );

    assert.equal(
      engine.describeEffectScenario(
        engine.writeEffectSuccessOutcome(effect, 'effectWithoutDamage'),
        'creatureAction',
      ),
      'Когда действие задело цель: «Схваченный». '
        + 'Эффект ложится и при успешном спасброске.',
    );
  });

  it('состояние из шаблона не перечисляет свои правила, только добавленные', () => {
    const condition = engine.buildConditionActiveEffect('poisoned');

    const effect = engine.applyConditionPresetToEffect(
      createEffect({ areaTrigger: 'enter' }),
      condition,
    );

    assert.ok(condition.flags.length > 0);

    assert.equal(
      engine.describeEffectScenario(effect, 'zone'),
      'При входе в зону: «Отравленный».',
    );

    assert.equal(
      engine.describeEffectScenario(
        { ...effect, changes: [...effect.changes, WALK_SPEED_CHANGE] },
        'zone',
      ),
      'При входе в зону: «Отравленный», Скорость (Ходьба) +10 фт.',
    );
  });

  it('зона «пока внутри»: урон каждый ход со спасброском', () => {
    for (const [onSuccess, successLabel] of [
      ['negate', 'без урона'],
      ['half', 'половина урона'],
    ]) {
      const effect = createEffect({
        recurringDamage: {
          damageParts: POISON_DAMAGE,
          timing: 'startOfTurn',
          save: { ...CONSTITUTION_SAVE, onSuccess },
        },
      });

      assert.equal(
        engine.describeEffectScenario(effect, 'zone'),
        'Пока существо в зоне: каждый ход 2d6 ядом в начале хода '
          + `(спасбросок Телосложения, Сл 13: успех — ${successLabel}).`,
      );
    }
  });

  it('аура и снятие после атаки', () => {
    assert.equal(
      engine.describeEffectScenario(
        createEffect({ aura: ALLIES_AURA, changes: [WALK_SPEED_CHANGE] }),
        'item',
      ),
      'Существам в ауре 10 фт (союзники): Скорость (Ходьба) +10 фт.',
    );

    assert.equal(
      engine.describeEffectScenario(
        createEffect({
          flags: ['attack.advantage'],
          consumeOn: 'carrierAttack',
        }),
        'ownEffects',
      ),
      `Пока эффект активен: ${engine.describeEffectFlag('attack.advantage')}, `
        + 'снимается после своей атаки.',
    );
  });
});
