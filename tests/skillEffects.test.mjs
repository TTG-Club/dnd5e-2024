import assert from 'node:assert/strict';

import { it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

const normalContext = { hasAdvantage: false, hasDisadvantage: false };

/** Строка модификатора в форме редактора. */
function change(key, value, mode = 'add', condition = '') {
  return { key, mode, value, priority: 20, condition };
}

/** Эффект с заданными строками и флагами. */
function effect(name, changes, flags = [], extra = {}) {
  return {
    id: name,
    name,
    disabled: false,
    origin: 'spell',
    transfer: false,
    duration: { type: 'minutes', value: 1 },
    changes,
    flags,
    ...extra,
  };
}

const guidance = effect('Наставление', [change('skill.perception', '1к4')]);

it('кость «Наставления» катается в проверке навыка и не входит в число листа', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);
  const baseline = engine.resolveActorStats(actor);

  actor.activeEffects = [guidance];

  const resolved = engine.resolveActorStats(actor);

  assert.deepEqual(resolved.skills, baseline.skills);

  const effects = engine.collectActiveEffects(actor);

  const formulas = engine
    .getSkillCheckBonusKeys('perception')
    .flatMap((key) =>
      engine.collectBonusRollFormulas(effects, key, normalContext),
    );

  // Движок приводит русскую кость к записи роллера
  assert.deepEqual(formulas, ['1d4']);

  // Кость одного навыка не достаётся другому
  assert.deepEqual(
    engine
      .getSkillCheckBonusKeys('stealth')
      .flatMap((key) =>
        engine.collectBonusRollFormulas(effects, key, normalContext),
      ),
    [],
  );
});

it('число к навыку по-прежнему входит в лист, а не в бросок', () => {
  const actor = structuredClone(engine.DEFAULT_ACTOR);
  const baseline = engine.resolveActorStats(actor);

  actor.activeEffects = [effect('Перчатки', [change('skill.stealth', '2')])];

  const resolved = engine.resolveActorStats(actor);

  assert.equal(resolved.skills.stealth, baseline.skills.stealth + 2);

  assert.deepEqual(
    engine.collectBonusRollFormulas(
      engine.collectActiveEffects(actor),
      'skill.stealth',
      normalContext,
    ),
    [],
  );
});

it('ключи броска навыка: все проверки и сам навык; у своего навыка — только все проверки', () => {
  assert.deepEqual(engine.getSkillCheckBonusKeys('arcana'), [
    'abilityCheck',
    'skill.arcana',
  ]);

  assert.deepEqual(engine.getSkillCheckBonusKeys(undefined), ['abilityCheck']);
});

it('кость бросается у атак, спасбросков, проверок, навыков и урона, но не у КД', () => {
  for (const key of [
    'skill.perception',
    'abilityCheck',
    'save.wisdom',
    'attack.melee',
    'damage.all',
    'attacksAgainst',
  ]) {
    assert.equal(engine.isRollTimeDiceKey(key), true, key);
  }

  for (const key of ['armorClass', 'initiative', 'movement.walk']) {
    assert.equal(engine.isRollTimeDiceKey(key), false, key);
  }
});

it('меню «Готовые»: у навыка подменю из числа, кости и бонуса мастерства', () => {
  const checks = engine.EFFECT_MODIFIER_MENU.find(
    (group) => group.group === 'skills',
  );

  assert.ok(checks);
  assert.ok(checks.items.every(engine.isEffectModifierSubmenu));
  assert.equal(checks.items[0].key, 'abilityCheck');

  // Навыки — по алфавиту русских названий
  const skillLabels = checks.items.slice(1).map((item) => item.label);

  assert.deepEqual(
    skillLabels,
    [...skillLabels].sort((left, right) => left.localeCompare(right, 'ru')),
  );

  assert.equal(skillLabels.length, 18);

  const perception = checks.items.find(
    (item) => item.key === 'skill.perception',
  );

  // Кость — одним пунктом: вычитание — та же строка со знаком минус.
  // Преимущество и помеха — в меню особых правил, здесь их нет
  assert.deepEqual(
    perception.options.map((option) => [option.label, option.value]),
    [
      ['Число', '1'],
      ['Кость к броску', '1к4'],
      ['Бонус мастерства', '@prof'],
    ],
  );

  assert.ok(
    perception.options.every(
      (option) => option.key === 'skill.perception' && option.mode === 'add',
    ),
  );
});

it('влияния на навык: кость, общие помехи, доспех и спящие эффекты', () => {
  const poisoned = effect('Отравлен', [], ['abilityCheck.disadvantage']);

  const sleeping = effect('Спит', [change('skill.perception', '5')], [], {
    disabled: true,
  });

  const influences = engine.listSkillEffectInfluences({
    effects: [guidance, poisoned, sleeping],
    skill: 'perception',
    ability: 'wisdom',
    activeFlags: new Set(['abilityCheck.disadvantage']),
  });

  assert.deepEqual(
    influences.map(({ source, text, tone }) => ({ source, text, tone })),
    [
      { source: 'Наставление', text: '+1к4 к броску', tone: 'positive' },
      {
        source: 'Отравлен',
        text: 'помеха (все проверки)',
        tone: 'negative',
      },
    ],
  );

  assert.equal(engine.summarizeSkillInfluenceTone(influences), 'neutral');

  // Помеху Скрытности ставит доспех, а не эффект
  const armor = engine.listSkillEffectInfluences({
    effects: [],
    skill: 'stealth',
    ability: 'dexterity',
    activeFlags: new Set(['skill.stealth.disadvantage']),
  });

  assert.deepEqual(
    armor.map(({ source, text }) => ({ source, text })),
    [{ source: 'Доспех', text: 'помеха' }],
  );

  assert.equal(engine.summarizeSkillInfluenceTone(armor), 'negative');

  // Своему навыку кость Внимательности не достаётся
  assert.deepEqual(
    engine.listSkillEffectInfluences({
      effects: [guidance],
      ability: 'wisdom',
      activeFlags: new Set(),
    }),
    [],
  );
});

it('вычитаемая кость подписывается минусом', () => {
  assert.equal(
    engine.describeChangeValue(change('skill.stealth', '-1к4')),
    '−1к4',
  );

  assert.equal(
    engine.describeChangeValue(change('skill.stealth', '1к4')),
    '+1к4',
  );
});
