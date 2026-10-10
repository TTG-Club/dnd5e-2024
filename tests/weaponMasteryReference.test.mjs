import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Приём вида оружия записан в справочнике видов (`weapon-base-types.json`,
 * поле `mastery`), а не в коде движка: ядро довозит поле до клиента как есть
 * (VTTG 0.9.636). Справочник и восемь приёмов движка обязаны сходиться —
 * незнакомый ключ молча оставил бы оружие без подписи приёма.
 */

/** Виды оружия из справочника системы */
const WEAPON_BASE_TYPES = JSON.parse(
  readFileSync('src/engine/weapon-base-types.json', 'utf8'),
);

/** Ключи приёмов, которые знает движок */
const MASTERY_KEYS = new Set(
  engine.WEAPON_MASTERIES.map((mastery) => mastery.key),
);

describe('приём оружия в справочнике видов', () => {
  it('у каждого вида оружия PHB 2024 записан известный движку приём', () => {
    for (const baseType of WEAPON_BASE_TYPES) {
      assert.ok(
        MASTERY_KEYS.has(baseType.mastery),
        `${baseType.key}: приём «${baseType.mastery}» движку незнаком`,
      );
    }
  });

  it('название приёма берётся по ключу приёма, без приёма — пусто', () => {
    assert.equal(engine.weaponMasteryName('topple'), 'Опрокидывание');
    assert.equal(engine.weaponMasteryName(undefined), null);
    assert.equal(engine.weaponMasteryName('нет-такого'), null);
  });

  it('вариант «оружие с приёмом» подписан приёмом из справочника', () => {
    const weapons = [
      { value: 'greataxe', name: 'Секира', mastery: 'cleave' },
      { value: 'stick', name: 'Палка' },
    ];

    const pool = engine.getFeatChoiceDefaultPool('weaponMastery', weapons);

    assert.equal(pool.length, 1, 'оружие без приёма в выбор приёма не идёт');
    assert.equal(pool[0].value, 'greataxe');
    assert.match(pool[0].name, /^Секира — /u);

    assert.deepEqual(engine.getFeatChoiceDefaultPool('weapon', weapons), [
      { value: 'greataxe', name: 'Секира' },
      { value: 'stick', name: 'Палка' },
    ]);
  });
});
