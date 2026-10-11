import assert from 'node:assert/strict';

import { describe, it } from 'vitest';

import { loadEngineBundle } from './helpers/engineBundle.mjs';

/**
 * Запрос проверки от мастера: нагрузка едет по сети с чужого клиента, поэтому
 * слот адресата обязан узнать свою форму и отбросить чужую, а подпись в
 * плашках ядра собирается одинаково для характеристики и навыка.
 */

const engine = await loadEngineBundle("export * from './src/engine/index.ts';");

describe('нагрузка запроса проверки', () => {
  it('узнаёт проверку характеристики и навыка', () => {
    assert.deepEqual(
      engine.parseAbilityCheckRequestPayload({
        kind: 'abilityCheck',
        check: 'ability',
        ability: 'dexterity',
        dc: 15,
      }),
      { kind: 'abilityCheck', check: 'ability', ability: 'dexterity', dc: 15 },
    );

    assert.deepEqual(
      engine.parseAbilityCheckRequestPayload({
        kind: 'abilityCheck',
        check: 'skill',
        skill: 'stealth',
        dc: 12,
      }),
      { kind: 'abilityCheck', check: 'skill', skill: 'stealth', dc: 12 },
    );
  });

  it('отбрасывает спасбросок, чужой навык и запрос без Сл', () => {
    assert.equal(
      engine.parseAbilityCheckRequestPayload({
        kind: 'savingThrow',
        ability: 'dexterity',
        dc: 15,
        againstMagic: false,
      }),
      null,
    );

    assert.equal(
      engine.parseAbilityCheckRequestPayload({
        kind: 'abilityCheck',
        check: 'skill',
        skill: 'flying',
        dc: 10,
      }),
      null,
    );

    assert.equal(
      engine.parseAbilityCheckRequestPayload({
        kind: 'abilityCheck',
        check: 'ability',
        ability: 'wisdom',
      }),
      null,
    );
  });

  it('спасбросок свою нагрузку проверкой не принимает', () => {
    assert.equal(
      engine.parseSavingThrowRequestPayload({
        kind: 'abilityCheck',
        check: 'ability',
        ability: 'dexterity',
        dc: 15,
      }),
      null,
    );
  });
});

describe('подпись запроса проверки', () => {
  it('характеристика — в родительном падеже, навык — названием', () => {
    assert.equal(
      engine.formatAbilityCheckRequestTitle(
        { check: 'ability', ability: 'dexterity' },
        15,
      ),
      'Проверка Ловкости (DC 15)',
    );

    assert.equal(
      engine.formatAbilityCheckRequestTitle(
        { check: 'skill', skill: 'stealth' },
        12,
      ),
      'Проверка навыка Скрытность (DC 12)',
    );
  });
});
