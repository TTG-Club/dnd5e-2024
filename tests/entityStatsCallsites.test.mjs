import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import {
  change,
  createActor,
  createEffect,
  engine,
} from './scenarios/_fixtures.mjs';

/**
 * Одно правило на лист и панели: числа сущности мира клиент считает с аурами
 * карты, а применение предмета и умения идёт одним путём — через мир.
 *
 * Сл спасброска каста и применения с листа считалась без аур, с горячей
 * панели — с аурами: аура, поднявшая заклинательную характеристику, давала
 * разную Сл одному и тому же умению. А применение с листа списывало ресурс
 * `emit`-ом компонента после выбора цели — размонтированная вкладка не
 * списывала ничего.
 */

const STATS_PATH = 'src/client/composables/useResolvedStats.ts';
const FLOW_PATH = 'src/client/composables/spellCastFlow.ts';
const USE_PATH = 'src/client/composables/effectActivationUse.ts';

/** Числа сущности без аур — где и почему. Новое место без строки роняет тест */
const AURALESS_STATS = {
  [STATS_PATH]:
    'сам помощник и расчёт листа: ауры передаются вторым аргументом',
  'src/client/composables/attackRollMode.ts':
    'ауры передаются вторым аргументом',
  'src/client/composables/spellResolutionShared.ts':
    'флаги ЦЕЛИ для урона «половина при успехе»: урон цели движок и ядро считают без аур',
  'src/client/composables/useSpellResolution.ts':
    'КД ЦЕЛИ серии снарядов — как у ядра (`targetStore`), без аур',
  'src/client/composables/useSpellSavingThrows.ts':
    'модификатор спасброска ЦЕЛИ: ауры с условием об источнике добавляются отдельно',
  'src/client/composables/useTargetEffectResolution.ts':
    'урон и флаги ЦЕЛИ при наложении эффекта — как урон цели, без аур',
  'src/client/ui/actor/class/ClassSetupWizard.vue':
    'хранимые числа мастера класса не зависят от того, кто стоит рядом',
  'src/client/ui/actor/Dnd5eActorSheet.vue':
    'кости хитов отдыха: записанное в лист не зависит от аур',
};

/** Вызов расчёта чисел движка напрямую */
const RAW_STATS_CALL = /\bresolveActorStats\(/u;

/** Строки без комментариев: упоминание в комментарии — не вызов */
function withoutCommentLines(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

/**
 * Исходники клиента, где встречается вызов.
 *
 * @param {RegExp} pattern - вызов
 * @returns {string[]} пути от корня системы
 */
function listCallers(pattern) {
  return listClientSources()
    .filter((path) =>
      pattern.test(withoutCommentLines(readFileSync(path, 'utf8'))),
    )
    .map(toSystemPath)
    .sort();
}

describe('числа сущности мира — с аурами карты', () => {
  it('расчёт чисел движка клиент зовёт только через помощник, исключения названы', () => {
    assert.deepEqual(
      listCallers(RAW_STATS_CALL),
      Object.keys(AURALESS_STATS).sort(),
    );
  });

  it('сл каста и Сл применения умения — одна: аура, поднявшая характеристику, поднимает обе', async () => {
    // Аура союзника: +4 к Мудрости
    const aura = createEffect('aura_wisdom', {
      changes: [change('ability.wisdom', '4')],
    });

    const cleric = createActor();

    cleric.system = {
      ...cleric.system,
      classes: [
        {
          classKey: 'cleric',
          level: 5,
          hitDie: 8,
          casterType: 'full',
          spellcastingAbility: 'wisdom',
        },
      ],
    };

    const resolveEntityStats = await loadHandler(
      STATS_PATH,
      'resolveEntityStats',
      {
        resolveActorStats: engine.resolveActorStats,
        listAmbientEffects: () => [aura],
      },
    );

    const withAura = resolveEntityStats(cleric);
    const withoutAura = engine.resolveActorStats(cleric);

    assert.equal(
      withAura.abilityMods.wisdom,
      withoutAura.abilityMods.wisdom + 2,
      'аура дошла до чисел',
    );

    const spell = { id: 'spell', name: 'Священное пламя', level: 0 };

    const resolveSpellCasterSource = await loadHandler(
      FLOW_PATH,
      'resolveSpellCasterSource',
      {
        resolveEntityStats,
        resolveSpellSaveDC: engine.resolveSpellSaveDC,
        resolveSpellcastingAbility: engine.resolveSpellcastingAbility,
      },
    );

    const castSource = resolveSpellCasterSource(cleric, spell);

    assert.equal(
      castSource.saveDc,
      engine.resolveSpellSaveDC(cleric, spell, withAura),
      'Сл каста — от чисел с аурами',
    );

    assert.equal(
      castSource.saveDc,
      engine.resolveSpellSaveDC(cleric, spell, withoutAura) + 2,
    );

    // Применение умения и предмета берёт Сл тем же помощником
    const useSource = readFileSync(
      listClientSources().find((path) => toSystemPath(path) === USE_PATH),
      'utf8',
    );

    assert.equal(
      (useSource.match(/resolveEntityStats\(entity\)\.spellSaveDC/gu) ?? [])
        .length,
      2,
    );
  });
});

describe('применение предмета и умения с листа — путём мира', () => {
  it('разбор применения зовут только входы мира, лист его сам не собирает', () => {
    assert.deepEqual(listCallers(/\bapplyEffectSource\(/u), [USE_PATH]);
  });

  it('вкладка снаряжения отдаёт применение предмета входу мира', async () => {
    const calls = [];

    const ports = {
      props: { isReadOnly: false, entity: { id: 'hero' } },
      applyEntityItemUse: (...call) => calls.push(call),
    };

    const applyItemUse = await loadHandler(
      'src/client/ui/actor/tabs/ActorEquipmentTab.vue',
      'applyItemUse',
      ports,
    );

    applyItemUse({ id: 'potion' });
    assert.deepEqual(calls, [['hero', 'potion']]);

    // Лист в режиме просмотра ничего не применяет
    ports.props.isReadOnly = true;
    applyItemUse({ id: 'potion' });
    assert.equal(calls.length, 1);
  });

  it('панель эффектов отдаёт применение эффекта входу мира', async () => {
    const calls = [];
    const ports = { props: { owner: { id: 'hero' } } };

    const applyUseEffect = await loadHandler(
      'src/client/ui/actor/ActiveEffectsPanel.vue',
      'applyUseEffect',
      { ...ports, applyEntityEffectUse: (...call) => calls.push(call) },
    );

    applyUseEffect({ id: 'effect_turn' });
    assert.deepEqual(calls, [['hero', 'effect_turn']]);
  });
});
