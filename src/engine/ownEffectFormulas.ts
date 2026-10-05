/**
 * Числа владельца в срабатываниях его СОБСТВЕННОГО эффекта.
 *
 * Эффект, который владелец отдаёт другим, получает его числа при наложении
 * (`sourceFormulaBinding.ts`). Постоянный эффект умения, черты, предмета никто
 * не накладывает: он лежит на владельце как записан, с `@mod.con`, `@prof`,
 * `@classLevel` и `@choice.*` в формулах и условиях срабатываний. Бросок же
 * срабатывания токен не считает — часть урона или лечения с `@` он пропускает,
 * а условие с неподставленным выбором не выполняется. Поэтому, когда событие
 * собирает срабатывания носителя, его числа подставляются тем же путём, что и
 * при наложении: выборы и уровень класса (`bindOwnerTokens`), затем числа
 * листа (`bindSourceEffectFormulas`).
 *
 * У эффекта, наложенного другим, токенов наложившего уже нет — подставлять в
 * нём нечего, и он возвращается тем же объектом.
 *
 * @module system/dnd/ownEffectFormulas
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { SourceBindingOptions } from './sourceFormulaBinding.js';

import { bindOwnerTokens } from './classEffectScope.js';
import { listEffectSaveDcs } from './effectSaveDc.js';
import { buildOwnerSaveDcContext } from './effectSaveDcOwner.js';
import {
  bindSourceEffectFormulas,
  effectUsesSourceFormulas,
} from './sourceFormulaBinding.js';

/**
 * Модификаторы своего эффекта не трогаются: их и так считает конвейер листа по
 * носителю.
 */
const OWN_EFFECT_BINDING: SourceBindingOptions = { changes: false };

/**
 * Свои эффекты носителя с его числами и выборами в формулах и условиях
 * срабатываний, в уроне и лечении, в Сл формулой.
 *
 * Записи сущности не меняются: копия собирается только у эффекта, в котором
 * есть что подставить. Контекст листа строится один раз и только по нужде.
 *
 * @param effects - эффекты, собранные у носителя: свои, надетых предметов,
 *   черт существа
 * @param owner - носитель, он же владелец
 * @returns эффекты с числами владельца
 */
export function bindOwnEffectFormulas(
  effects: readonly ActiveEffect[],
  owner: DnDSceneEntity,
): readonly ActiveEffect[] {
  const bound = bindOwnerTokens(effects, owner);

  if (
    !bound.some((effect) =>
      effectUsesSourceFormulas(effect, OWN_EFFECT_BINDING),
    )
  ) {
    return bound;
  }

  const context = buildOwnerSaveDcContext(
    owner,
    bound.flatMap(listEffectSaveDcs).map((save) => save.dcFormula),
  );

  return bound.map((effect) =>
    bindSourceEffectFormulas(effect, context, OWN_EFFECT_BINDING),
  );
}
