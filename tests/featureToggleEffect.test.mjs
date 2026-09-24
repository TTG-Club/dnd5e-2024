import assert from 'node:assert/strict';

import { describe, it } from 'vitest';
import { z } from 'zod';

import { loadEngineBundle } from './helpers/engineBundle.mjs';
import { loadHandler } from './helpers/sourceHandler.mjs';

/**
 * Строка особенности находит свой эффект с переключателем — его включает
 * кнопка панели быстрого доступа («Ярость»).
 */

// Движок собирается один раз на файл, до тестов
const engine = await loadEngineBundle(
  "export * from './src/engine/classEffectScope.ts'; export * from './src/engine/activeEffectTypes.ts';",
);

const resolverPath = 'src/client/ui/actor/featureEffects.ts';
const classEffectsPath = 'src/client/ui/actor/class/classEffects.ts';

/** Разделители строки особенности — как в `ui/actor/constants.ts` */
const SEPARATORS = {
  FEATURE_OPTION_SEPARATOR: ': ',
  FEATURE_SOURCE_SEPARATOR: ' — ',
};

/**
 * Настоящее чтение ссылки особенности вместе с её схемой.
 *
 * @returns {Promise<Function>} чтение ссылки
 */
async function loadLinkReader() {
  const ports = { z };

  ports.FeatureEffectIdsSchema = await loadHandler(
    resolverPath,
    'FeatureEffectIdsSchema',
    ports,
  );

  return loadHandler(resolverPath, 'readFeatureEffectIds', ports);
}

/**
 * Настоящий поиск эффекта строки особенности вместе с его помощниками.
 *
 * @returns {Promise<Function>} поиск эффекта
 */
async function loadResolver() {
  const ports = {
    ...SEPARATORS,
    isClassEffect: engine.isClassEffect,
    isToggleActivatedEffect: engine.isToggleActivatedEffect,
    readFeatureEffectIds: await loadLinkReader(),
  };

  ports.resolveFeatureClassKey = await loadHandler(
    resolverPath,
    'resolveFeatureClassKey',
    ports,
  );

  ports.isNamedAfterFeature = await loadHandler(
    resolverPath,
    'isNamedAfterFeature',
    ports,
  );

  ports.listFeatureEffects = await loadHandler(
    resolverPath,
    'listFeatureEffects',
    ports,
  );

  return loadHandler(resolverPath, 'findFeatureToggleEffect', ports);
}

/**
 * Эффект класса на листе.
 *
 * @param {string} classKey - класс
 * @param {string} id - id записи компендиума
 * @param {string} name - название
 * @param {boolean} [isToggle] - включается переключателем
 * @returns {object} эффект
 */
function classEffect(classKey, id, name, isToggle = true) {
  return {
    id: engine.buildClassEffectId(classKey, id),
    name,
    disabled: true,
    ...(isToggle ? { activation: { mode: 'toggle' } } : {}),
  };
}

/**
 * Варвар (и воин по мультиклассу) с эффектами.
 *
 * @param {object[]} activeEffects - эффекты листа
 * @returns {object} персонаж
 */
function barbarian(activeEffects) {
  return {
    activeEffects,
    system: {
      classes: [
        { classKey: 'barbarian', className: 'Варвар' },
        { classKey: 'fighter', className: 'Воин' },
      ],
    },
  };
}

describe('эффект строки особенности', () => {
  it('по ссылке: находит эффект с другим названием, пропускает постоянный', async () => {
    const find = await loadResolver();
    const surge = classEffect('barbarian', 'surge', 'Всплеск жизненной силы');
    const permanent = classEffect('barbarian', 'tree', 'Древо', false);
    const actor = barbarian([permanent, surge]);

    const feature = {
      name: 'Жизненная сила древа',
      grantedBy: 'Варвар — Путь Мирового древа',
      featureType: 'subclass',
      effectIds: [permanent.id, surge.id],
    };

    assert.equal(find(actor, feature)?.id, surge.id);

    assert.equal(
      find(actor, { ...feature, effectIds: [permanent.id] }),
      undefined,
      'у постоянного эффекта переключателя нет — на панель нечего выносить',
    );
  });

  it('вкладка «Эффекты» описания: все эффекты особенности, не только включаемые', async () => {
    const ports = {
      ...SEPARATORS,
      isClassEffect: engine.isClassEffect,
      readFeatureEffectIds: await loadLinkReader(),
    };

    ports.resolveFeatureClassKey = await loadHandler(
      resolverPath,
      'resolveFeatureClassKey',
      ports,
    );

    ports.isNamedAfterFeature = await loadHandler(
      resolverPath,
      'isNamedAfterFeature',
      ports,
    );

    const list = await loadHandler(resolverPath, 'listFeatureEffects', ports);

    const defense = classEffect(
      'barbarian',
      'ud',
      'Защита без доспехов',
      false,
    );

    const rage = classEffect('barbarian', 'rage', 'Ярость');
    const actor = barbarian([defense, rage]);

    assert.deepEqual(
      Array.from(
        list(actor, {
          name: 'Защита без доспехов',
          grantedBy: 'Варвар',
          featureType: 'class',
        }),
        (effect) => effect.id,
      ),
      [defense.id],
    );
  });

  it('без ссылки (старый лист): класс и название, вариант через двоеточие', async () => {
    const find = await loadResolver();
    const rage = classEffect('barbarian', 'rage', 'Ярость');

    const bear = classEffect(
      'barbarian',
      'bear',
      'Ярость диких земель: Медведь',
    );

    const actor = barbarian([rage, bear]);

    assert.equal(
      find(actor, { name: 'Ярость', grantedBy: 'Варвар', featureType: 'class' })
        ?.id,
      rage.id,
      '«Ярость» не цепляет «Ярость диких земель»',
    );

    assert.equal(
      find(actor, {
        name: 'Ярость диких земель',
        grantedBy: 'Варвар — Путь Дикого сердца',
        featureType: 'subclass',
      })?.id,
      bear.id,
    );
  });

  it('без ссылки: чужой класс, неоднозначность и не классовая строка — ничего', async () => {
    const find = await loadResolver();

    const actor = barbarian([
      classEffect('fighter', 'surge', 'Всплеск действий'),
      classEffect('barbarian', 'a', 'Двойник: Первый'),
      classEffect('barbarian', 'b', 'Двойник: Второй'),
    ]);

    assert.equal(
      find(actor, {
        name: 'Всплеск действий',
        grantedBy: 'Варвар',
        featureType: 'class',
      }),
      undefined,
      'одноимённый эффект другого класса не подходит',
    );

    assert.equal(
      find(actor, {
        name: 'Двойник',
        grantedBy: 'Варвар',
        featureType: 'class',
      }),
      undefined,
      'два кандидата — не угадываем',
    );

    assert.equal(
      find(actor, {
        name: 'Всплеск действий',
        grantedBy: 'Воин',
        featureType: 'species',
      }),
      undefined,
      'строка вида классовые эффекты не ищет',
    );
  });
});

describe('ссылка строки особенности на эффекты', () => {
  it('ведёт ровно на те id, что мастер ставит на лист', async () => {
    const ports = {
      buildClassEffectId: engine.buildClassEffectId,
      withActivationDefaults: engine.withActivationDefaults,
    };

    ports.buildOptionEffectId = await loadHandler(
      classEffectsPath,
      'buildOptionEffectId',
      ports,
    );

    ports.withClassProvenance = await loadHandler(
      classEffectsPath,
      'withClassProvenance',
      ports,
    );

    const listIds = await loadHandler(
      classEffectsPath,
      'listFeatureEffectIds',
      ports,
    );

    const collectFeature = await loadHandler(
      classEffectsPath,
      'collectFeatureEffects',
      ports,
    );

    const collectOption = await loadHandler(
      classEffectsPath,
      'collectClassOptionEffects',
      ports,
    );

    const definition = { key: 'barbarian' };
    const rage = { id: 'effect-rage', name: 'Ярость' };
    const feature = { key: 'rage', activeEffects: [rage] };

    // Массивы из VM — другой «мир» с другим Array: сверяются значения
    assert.deepEqual(
      Array.from(listIds('barbarian', feature.activeEffects)),
      Array.from(collectFeature(definition, [feature]), (effect) => effect.id),
    );

    const grant = {
      featureKey: 'aspect',
      optionKey: 'owl',
      activeEffects: [{ id: 'effect-owl', name: 'Сова' }],
    };

    assert.deepEqual(
      Array.from(listIds('barbarian', grant.activeEffects, grant)),
      Array.from(collectOption(definition, [grant]), (effect) => effect.id),
    );
  });
});

describe('эффекты особенности — одна сущность с эффектами листа', () => {
  it('правка на месте, убранный уходит, новый ложится выключенным с меткой', async () => {
    const save = await loadHandler(resolverPath, 'saveFeatureEffects', {
      withActivationDefaults: engine.withActivationDefaults,
      FEATURE_EFFECT_PREFIX: 'feature-effect:',
    });

    const rage = classEffect('barbarian', 'rage', 'Ярость');
    const extra = classEffect('barbarian', 'extra', 'Ярость: шум', false);
    const armor = { id: 'item-armor', name: 'Доспех', disabled: false };

    const result = save(
      [rage, armor, extra],
      [rage.id, extra.id],
      'feature-1',
      [
        { ...rage, name: 'Ярость (правка)' },
        { id: 'new', name: 'Боевой клич', activation: { mode: 'toggle' } },
      ],
    );

    assert.deepEqual(
      Array.from(result.activeEffects, (effect) => effect.name),
      ['Ярость (правка)', 'Доспех', 'Боевой клич'],
      'правка на своём месте, чужой эффект не тронут, убранный снят',
    );

    const added = result.activeEffects[2];

    assert.equal(added.id, 'feature-effect:feature-1:new');
    assert.equal(added.disabled, true, 'новый переключаемый — выключенным');

    assert.deepEqual(Array.from(result.effectIds), [
      rage.id,
      'feature-effect:feature-1:new',
    ]);

    assert.deepEqual(
      Array.from(
        save([rage, armor], [rage.id], 'feature-1', []).activeEffects,
        (effect) => effect.id,
      ),
      [armor.id],
      'удаление особенности снимает её эффекты',
    );
  });
});
