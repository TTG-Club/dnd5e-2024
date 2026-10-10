import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { engine } from './scenarios/_fixtures.mjs';

/**
 * Значки категорий снаряжения. Справочник категорий — данные, а значки — код
 * движка: новая категория в `equipment-categories.json` без значка молча
 * получает запасную рубашку, и предмет в инвентаре не узнать.
 */

/** Справочник категорий снаряжения, который мир-сервер отдаёт форме */
const categories = JSON.parse(
  readFileSync(
    new URL('../src/engine/equipment-categories.json', import.meta.url),
    'utf8',
  ),
);

describe('список категорий снаряжения', () => {
  it('ключи в коде и в справочнике совпадают', () => {
    // Список ведётся в двух местах: тип предмета выводится из кода, а форма
    // и мир-сервер читают справочник. Разойдись они — категория либо не
    // выбирается в форме, либо не проходит проверку типов
    assert.deepEqual(
      [...engine.DND_EQUIPMENT_CATEGORIES].sort(),
      categories.map((category) => category.key).sort(),
    );
  });
});

describe('значки категорий снаряжения', () => {
  it('у каждой небронной категории справочника есть свой значок', () => {
    // Лёгкая, средняя и тяжёлая броня берут значок по базовому типу доспеха,
    // поэтому своего у категории нет намеренно
    // «Снаряжение транспорта» скрыто из формы и значка пока не получило —
    // известный пробел, а не новая категория
    const knownWithoutIcon = new Set(['vehicle-equipment']);

    const missing = categories
      .filter((category) => !category.isArmor)
      .filter((category) => !knownWithoutIcon.has(category.key))
      .map((category) => category.key)
      .filter((key) => !engine.EQUIPMENT_CATEGORY_ICONS[key]);

    assert.deepEqual(missing, []);
  });

  it('у зелья — круглая колба, а не значок применения предмета', () => {
    assert.equal(
      engine.getEquipmentCategoryIcon(engine.POTION_EQUIPMENT_CATEGORY),
      'tabler:flask-2',
    );
  });
});
