import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { describe, it } from 'vitest';

import { listClientSources, toSystemPath } from './helpers/clientSources.mjs';
import { loadEntityWrites } from './helpers/combatWrite.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';
import { createActor, engine } from './scenarios/_fixtures.mjs';

/**
 * Порты входов каста и удара не зависят от жизни компонента.
 *
 * Окно броска живёт в менеджере окон ядра и переживает вкладку (`v-if`) и
 * лист. Боеприпас, ячейку и заряд списывает бросок окна — порт, который
 * писал `emit` вкладки или читал её `props`, после переключения вкладки или
 * закрытия листа ничего не списывал. Порты собирают фабрики мира, входы
 * различаются только отказом.
 */

const WEAPON_PATH = 'src/client/composables/weaponAttackRoll.ts';
const SPELL_FLOW_PATH = 'src/client/composables/spellCastFlow.ts';
const CREATURE_SPELL_PATH = 'src/client/composables/creatureSpellCast.ts';
const USE_PATH = 'src/client/composables/effectActivationUse.ts';

/**
 * Поля портов, которые пишут или читают сущность: где они задаются, там и
 * решается, от чего зависит списание.
 */
const PORT_FIELDS = {
  'readAttacker:': [WEAPON_PATH],
  'spendAmmunition:': [WEAPON_PATH],
  'readCaster:': [SPELL_FLOW_PATH],
  'spendSlot:': [SPELL_FLOW_PATH],
  'spendUse:': [CREATURE_SPELL_PATH, SPELL_FLOW_PATH],
};

/**
 * Исходник без строк-комментариев.
 *
 * @param {string} path - файл
 * @returns {string} текст
 */
function readCode(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join('\n');
}

describe('порты входов задают только фабрики мира', () => {
  for (const [field, allowed] of Object.entries(PORT_FIELDS)) {
    it(`${field} — только в фабрике порта`, () => {
      const owners = listClientSources()
        .filter((path) => readCode(path).includes(field))
        .map(toSystemPath)
        .sort();

      assert.deepEqual(owners, [...allowed].sort());
    });
  }
});

describe('удар с листа после ухода вкладки', () => {
  it('стрела списывается с сущности мира, атакующий читается из мира', async () => {
    const quiver = {
      id: 'arrows',
      name: 'Стрелы',
      quantity: 20,
      itemType: 'ammunition',
    };

    const archer = createActor({ id: 'archer', equipment: [quiver] });
    const world = new Map([[archer.id, structuredClone(archer)]]);
    const { changeEntitySheet, updated } = await loadEntityWrites({ world });

    const updateEntityEquipment = await loadHandler(
      USE_PATH,
      'updateEntityEquipment',
      { changeEntitySheet },
    );

    const spendShotAmmunition = await loadHandler(
      USE_PATH,
      'spendShotAmmunition',
      { updateEntityEquipment, spendAmmunition: engine.spendAmmunition },
    );

    const createWeaponAttackPort = await loadHandler(
      WEAPON_PATH,
      'createWeaponAttackPort',
      {
        useWorldEntities: () => ({
          findCurrentDndEntity: (entityId) => world.get(entityId),
        }),
        spendShotAmmunition,
      },
    );

    // Вкладка собрала порт и открыла окно; затем вкладку переключили —
    // от компонента ничего не осталось, окно бросает само
    const port = createWeaponAttackPort(archer.id, () => {});

    // Пока окно было открыто, мир изменился (другой выстрел с панели)
    world.set(archer.id, {
      ...world.get(archer.id),
      equipment: [{ ...quiver, quantity: 19 }],
    });

    assert.equal(port.readAttacker().equipment[0].quantity, 19);

    port.spendAmmunition('arrows');

    assert.equal(updated.length, 1, 'запись ушла');
    assert.equal(updated[0].equipment[0].quantity, 18);
    assert.equal(world.get(archer.id).equipment[0].quantity, 18);
  });
});
