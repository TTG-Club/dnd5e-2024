/**
 * Применение эффектов на столе: предмет пунктом «Использовать», эффект листа
 * кнопкой «Применить», боеприпас — выстрелом.
 *
 * Применение идёт путём заклинания: псевдо-заклинание источника несёт эффекты
 * применения, эффекты «на носителе» ложатся на применившего боевым каналом (там
 * же сервер будит срабатывания «при наложении» — зелье лечит), эффекты «на
 * цели» — на того, кого выбрали щелчком по фишке (себя или другого; дальше
 * касания — с разрешения ведущего), тем же разбором, что и у заклинаний.
 */

import type { MeasurementTemplate, SkillType } from '@vtt/shared';
import type {
  CreatureAction,
  DnDGameItem,
  DnDSceneEntity,
  EffectActivationCost,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useChatStore } from '@/stores/chatStore';
import { generateId } from '@vtt/shared';
import {
  buildEffectGroupUseSpell,
  buildItemUseSpell,
  buildUseSpell,
  canPayActivation,
  canUseItem,
  collectEffectUseGroup,
  collectSourcePay,
  findWeaponAmmunition,
  getCasterSpellEffects,
  hasItemUsesPrice,
  isItemDepleted,
  isUseActivatedEffect,
  listSaveDcSkills,
  resolveActorStats,
  resolveEffectUseCost,
  settleUseSpellArea,
  SKILLS_LABELS,
  spendAmmunition,
  spendItemUse,
  stampSkillCheckDc,
  tracksWeaponAmmunition,
  UNRESOLVED_SAVE_DC_LABELS,
  withAmmunition,
  withSheetResources,
} from '@vtt/shared/system/dnd.js';

import { EFFECT_USE_LABELS } from '../ui/effect/constants';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import { placeAreaTemplate } from './areaTemplateTargets';
import { runWithDamageTypeChoices } from './damageTypeChoice';
import { runWithSourcePay } from './effectPayChoice';
import {
  payEntityActivation,
  readEntityCounters,
  warnNoCounter,
} from './effectToggle';
import { chooseUseTarget } from './effectUseTargetChoice';
import { runWithEffectVariants } from './effectVariantChoice';
import { changeEntitySheet } from './entitySheetWrite';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { openSkillCheckModal } from './skillCheckRoll';
import {
  afterSpellCast,
  applyCasterSpellEffectsToEntity,
  completeSpellCast,
  SPELL_CAST_KEY_PREFIX,
} from './spellCastCompletion';
import { beginSpellCast } from './spellCasts';
import {
  applySpellTargetEffects,
  createChosenEffectTargets,
} from './spellEffectTargeting';
import { getTargetSpellEffects } from './spellResolutionShared';
import {
  findUnresolvedTargetSaveDc,
  warnUnresolvedSaveDc,
} from './unresolvedSaveDc';
import { listAmbientEffects } from './useResolvedStats';
import { getSpellMaxRangeOnScene } from './useSceneRangeCheck';
import { useWorldEntities } from './useWorldEntities';

/** Приставка ключа окна проверки навыка, итог которой служит Сл */
const SKILL_DC_MODAL_KEY_PREFIX = 'effect-skill-dc:';

/** Выстрел с учётом боеприпаса */
export interface AmmunitionShot {
  /** Оружие выстрела: бонус и эффекты боеприпаса уже учтены */
  weapon: DnDGameItem;
  /** Боеприпас выстрела; нет — лист боеприпасы этого оружия не ведёт */
  ammunition?: DnDGameItem;
}

/** Расход источника вместе с ценой ресурсом — одним сохранением */
export interface EffectSourceSpend {
  /** Предмет, с которого пришёл эффект: с него берётся цена «заряды предмета» */
  itemId?: string;
  /**
   * Прежний расход источника (счётчик применения, заряд или единица
   * количества) поверх уже оплаченной сущности. Оплата цены и расход уходят
   * одним сохранением: два подряд затёрли бы друг друга — стор обновляется
   * только ответом сервера.
   *
   * @param paidUser - применивший после оплаты цены
   * @param itemUsesPaid - цена сама списала заряды предмета: обычный расход
   *   зарядов она заменяет
   * @returns применивший после расхода
   */
  spendOn?: (paidUser: DnDSceneEntity, itemUsesPaid: boolean) => DnDSceneEntity;
  /**
   * Трата хода на применение: запрещённая («нет бонусных действий») применение
   * не пускает, сделанная — пишется в счёт хода
   */
  cost?: EffectActivationCost;
}

/**
 * Бросает проверки навыка применившего, итог которых служит Сл спасброска
 * эффектов «на цели» (`applySave.dcSkill`), и продолжает применение с этой Сл.
 * Без таких эффектов и без цели продолжение идёт сразу.
 *
 * @param source - псевдо-заклинание применения
 * @param user - кто применяет
 * @param hasTarget - есть ли получатель эффектов «на цели»
 * @param proceed - продолжение с источником, у которого Сл уже число
 */
function runWithSkillCheckDc(
  source: Spell,
  user: DnDSceneEntity,
  hasTarget: boolean,
  proceed: (source: Spell) => void,
): void {
  const skills = hasTarget
    ? listSaveDcSkills(getTargetSpellEffects(source))
    : [];

  /**
   * Проверки по очереди: у каждой своё окно.
   *
   * @param current - источник с уже записанными Сл
   * @param rest - навыки, которые ещё не бросали
   */
  const rollNext = (current: Spell, rest: readonly SkillType[]): void => {
    const [skill, ...others] = rest;

    if (skill === undefined) {
      proceed(current);

      return;
    }

    openSkillCheckModal(user, skill, {
      modalKey: `${SKILL_DC_MODAL_KEY_PREFIX}${source.id}:${skill}`,
      title: `${source.name}${EFFECT_USE_LABELS.skillDcTitleSeparator}${SKILLS_LABELS[skill]}`,
      rollButtonText: EFFECT_USE_LABELS.skillDcRollButton,
      onRoll: (result) => {
        rollNext(
          {
            ...current,
            activeEffects: (current.activeEffects ?? []).map((effect) =>
              stampSkillCheckDc(effect, skill, result.total),
            ),
          },
          others,
        );
      },
    });
  };

  rollNext(source, skills);
}

/**
 * Применяет эффекты псевдо-заклинания применения: сначала выбор варианта и
 * типа урона на выбор (окна броска здесь нет — спрашивает плашка), затем
 * проверка цели, цена ресурсом, расход и наложение.
 *
 * @param spell - псевдо-заклинание применения
 * @param user - кто применяет
 * @param saveDc - Сл применившего: ею заменяется Сл 0 эффекта
 * @param spend - расход источника без цены ресурсом; зовётся до наложения,
 *   чтобы сохранение листа не затёрло наложенные эффекты
 * @param withPay - расход источника вместе с ценой ресурсом
 */
export function applyEffectSource(
  spell: Spell,
  user: DnDSceneEntity,
  saveDc: number,
  spend: () => void,
  withPay: EffectSourceSpend = {},
): void {
  // Лист применившего в режиме правки — применение ждёт «Сохранить» или
  // отмены. Запрет траты хода («нет бонусных действий») — до всякого выбора
  if (
    refuseWhileSheetEditing(user.id)
    || warnActionCostBlocked(
      user,
      withPay.cost,
      `${EFFECT_USE_LABELS.blockedTitle}: ${spell.name}`,
    )
  ) {
    return;
  }

  runWithEffectVariants(spell, (variant) => {
    // Область — у выбранного варианта: «луч» шаблона «вспышки» не требует
    runWithDamageTypeChoices(settleUseSpellArea(variant), (chosen) => {
      // Сл спасброска не из чего посчитать — бросок против нуля прошёл бы
      // любой. Останавливаемся до выбора цели и оплаты: ничего не потрачено
      const unresolved = findUnresolvedTargetSaveDc(chosen, user.id, saveDc);

      if (unresolved) {
        warnUnresolvedSaveDc(
          chosen.name,
          unresolved.problem,
          UNRESOLVED_SAVE_DC_LABELS.notAppliedSuffix,
        );

        return;
      }

      /**
       * Оплата, расход и наложение источника с уже известной Сл.
       *
       * @param source - источник после проверки навыка
       * @param targetIds - получатели эффектов «на цели»; пусто — их нет
       * @param template - шаблон области применения: на его месте — зона
       */
      const settleChecked = (
        source: Spell,
        targetIds: readonly string[],
        template?: MeasurementTemplate,
      ): void => {
        const itemUsesPaid = hasItemUsesPrice(
          collectSourcePay(source.activeEffects),
        );

        runWithSourcePay(
          source,
          user,
          {
            ...(withPay.itemId === undefined ? {} : { itemId: withPay.itemId }),
            commit: (paidUser) => {
              const spent =
                withPay.spendOn?.(paidUser, itemUsesPaid) ?? paidUser;

              // Оплата прошла через вопросы человеку: ресурсы переносятся на
              // свежую сущность, хиты и эффекты остаются её
              changeEntitySheet(user.id, (current) =>
                withSheetResources(current, spent),
              );
            },
          },
          (paidSource, paid) => {
            // Расход с ценой уже ушёл одним сохранением вместе с оплатой
            if (!paid || !withPay.spendOn) {
              spend();
            }

            // Применение точно идёт — трата хода в счёт («Замедление»)
            recordEntityActionSpend(user.id, withPay.cost);

            // Применение с концентрацией — свой каст: прежняя концентрация
            // кончается, новая метка ляжет вместе с эффектами применившего
            if (paidSource.concentration) {
              beginSpellCast(
                user.id,
                paidSource,
                generateId(SPELL_CAST_KEY_PREFIX),
              );
            }

            // Тот же финал, что у каста заклинания: конец прежней
            // концентрации, эффекты применившего, зона на месте шаблона
            // («Масло» горит два раунда) — затем цели, когда эффекты прежнего
            // каста сняты. Что сделало применение, пишут список наложенного,
            // разбор цели и исход срабатываний — отдельная строка «применяет»
            // их бы только повторяла
            afterSpellCast(
              completeSpellCast({
                spell: paidSource,
                caster: user,
                source: { saveDc },
                template,
              }),
              () => {
                if (targetIds.length > 0) {
                  applySpellTargetEffects(
                    paidSource,
                    { casterId: user.id, spellSaveDC: saveDc },
                    createChosenEffectTargets(paidSource, user.id, targetIds),
                  );
                }
              },
            );
          },
        );
      };

      /**
       * Оплата, расход и наложение — когда цель уже известна: отказ от выбора
       * цели ничего не тратит.
       *
       * @param targetIds - получатели эффектов «на цели»; пусто — их нет
       * @param template - шаблон области применения
       */
      const settle = (
        targetIds: readonly string[],
        template?: MeasurementTemplate,
      ): void => {
        // Сл от проверки навыка применившего — до оплаты: закрытое окно
        // проверки ничего не тратит
        runWithSkillCheckDc(chosen, user, targetIds.length > 0, (checked) => {
          settleChecked(checked, targetIds, template);
        });
      };

      // Область: шаблон на карте вместо выбора одной цели
      if (chosen.areaOfEffect) {
        placeAreaTemplate(
          chosen.areaOfEffect,
          user.id,
          getSpellMaxRangeOnScene(chosen),
          settle,
        );

        return;
      }

      if (getTargetSpellEffects(chosen).length === 0) {
        settle([]);

        return;
      }

      // Получателя выбирают на карте — себя или другого: «Зелье лечения» с
      // доставкой «На цели при применении» и пьют, и вливают одним эффектом
      chooseUseTarget(chosen, user, (targetId) => {
        settle(targetId === undefined ? [] : [targetId]);
      });
    });
  });
}

/**
 * Есть ли у действия существа эффекты «на себя».
 *
 * @param action - действие
 * @returns `true`, если действие что-то накладывает на само существо
 */
export function hasActionSelfEffects(
  action: Pick<CreatureAction, 'activeEffects'>,
): boolean {
  return getCasterSpellEffects(action).length > 0;
}

/**
 * Есть ли у действия существа без броска что накладывать: эффекты «на себя»
 * или «на цель».
 *
 * @param action - действие
 * @returns `true`, если действие накладывает эффекты
 */
export function hasActionUseEffects(
  action: Pick<CreatureAction, 'activeEffects'>,
): boolean {
  return (
    hasActionSelfEffects(action) || getTargetSpellEffects(action).length > 0
  );
}

/**
 * Применяет действие существа без броска, урона и спасброска: эффекты «на
 * себя» ложатся на существо, для эффектов «на цель» выбирается получатель на
 * карте — тем же разбором, что у применяемого умения («условие при наложении
 * + спасбросок в срабатывании»). Тип урона на выбор и варианты спрашивает сам
 * разбор.
 *
 * @param action - действие существа
 * @param creatureId - существо
 */
export function applyActionUseEffects(
  action: Pick<CreatureAction, 'name' | 'activeEffects' | 'saveDC'>,
  creatureId: string,
): void {
  const creature = useWorldEntities().findCurrentDndEntity(creatureId);

  if (!creature || !hasActionUseEffects(action)) {
    return;
  }

  applyEffectSource(
    buildUseSpell({
      id: `${creatureId}-${action.name}`,
      name: action.name,
      effects: action.activeEffects ?? [],
      rollSource: 'creatureAction',
    }),
    creature,
    action.saveDC ?? 0,
    () => {},
  );
}

/**
 * Накладывает на существо эффекты «на себя» его действия («Полтергейст»
 * становится невидимым, «Блуждающий огонёк» гасит свет) — после броска или
 * сразу, если бросать нечего. Существо берётся из мира в момент наложения:
 * урон того же действия мог уже изменить его хиты.
 *
 * @param action - действие существа
 * @param creatureId - существо
 */
export function applyActionSelfEffects(
  action: Pick<CreatureAction, 'name' | 'activeEffects' | 'saveDC'>,
  creatureId: string,
): void {
  const creature = useWorldEntities().findCurrentDndEntity(creatureId);

  if (!creature) {
    return;
  }

  if (!hasActionSelfEffects(action)) {
    return;
  }

  applyCasterSpellEffectsToEntity(
    buildUseSpell({
      id: `${creatureId}-${action.name}`,
      name: action.name,
      effects: action.activeEffects ?? [],
      rollSource: 'creatureAction',
    }),
    creature,
    { saveDc: action.saveDC ?? 0 },
  );
}

/**
 * Готовит атаку оружием: закончившимся оружием не бьют; у оружия с
 * боеприпасами, которые лист ведёт, берёт боеприпас и складывает его бонус и
 * эффекты с оружием.
 *
 * @param entity - стрелок
 * @param weapon - оружие
 * @returns выстрел либо `null`, если бить нечем (в чат ушло пояснение)
 */
export function prepareAmmunitionShot(
  entity: DnDSceneEntity,
  weapon: DnDGameItem,
): AmmunitionShot | null {
  if (isItemDepleted(weapon)) {
    useChatStore().sendMessage(
      `${EFFECT_USE_LABELS.blockedPrefix}${weapon.name}${EFFECT_USE_LABELS.depletedSuffix}`,
      'text',
    );

    return null;
  }

  const equipment = entity.equipment ?? [];

  if (!tracksWeaponAmmunition(equipment, weapon)) {
    return { weapon };
  }

  const ammunition = findWeaponAmmunition(equipment, weapon);

  if (!ammunition) {
    useChatStore().sendMessage(
      `${EFFECT_USE_LABELS.blockedPrefix}${weapon.name}${EFFECT_USE_LABELS.noAmmunitionSuffix}`,
      'text',
    );

    return null;
  }

  return { weapon: withAmmunition(weapon, ammunition), ammunition };
}

/**
 * Меняет инвентарь актуальной сущности мира — для путей без листа (панель
 * быстрого доступа).
 *
 * @param entityId - владелец
 * @param change - новый инвентарь по текущему
 */
function updateEntityEquipment(
  entityId: string,
  change: (equipment: readonly DnDGameItem[]) => DnDGameItem[],
): void {
  // Новый объект: живую запись стора меняет только ответ сервера
  changeEntitySheet(entityId, (entity) => ({
    ...entity,
    equipment: change(entity.equipment ?? []),
  }));
}

/**
 * Тратит боеприпас выстрела у актуальной сущности мира — у вкладки снаряжения
 * и горячей панели одинаково (`createWeaponAttackPort`).
 *
 * @param entityId - стрелок
 * @param ammunitionId - боеприпас
 */
export function spendShotAmmunition(
  entityId: string,
  ammunitionId: string,
): void {
  updateEntityEquipment(entityId, (equipment) =>
    spendAmmunition(equipment, ammunitionId),
  );
}

/**
 * Применяет эффект листа сущности мира без листа — кнопкой панели быстрого
 * доступа («Изгнание нежити», «Божественная искра»). Делает то же, что кнопка
 * «Применить» на вкладке «Эффекты»: варианты группы, выбор цели, расход
 * ресурса.
 *
 * Ресурс списывается с сущности, перечитанной в момент оплаты: цель выбирают
 * на карте, и за это время лист мог измениться.
 *
 * @param entityId - владелец эффекта
 * @param effectId - эффект «при применении»
 */
export function applyEntityEffectUse(entityId: string, effectId: string): void {
  const worldEntities = useWorldEntities();
  const entity = worldEntities.findCurrentDndEntity(entityId);
  const effects = entity?.activeEffects ?? [];
  const effect = effects.find((entry) => entry.id === effectId);

  if (!entity || !effect || !isUseActivatedEffect(effect)) {
    return;
  }

  const counterKey = effect.activation?.counter;

  if (
    counterKey
    && !canPayActivation(readEntityCounters(entity), effect.activation)
  ) {
    warnNoCounter(counterKey);

    return;
  }

  const group = collectEffectUseGroup(effects, effect);

  applyEffectSource(
    buildEffectGroupUseSpell(group),
    entity,
    resolveActorStats(entity, listAmbientEffects(entity.id)).spellSaveDC,
    () => {
      changeEntitySheet(entityId, (current) =>
        payEntityActivation(current, effect),
      );
    },
    {
      spendOn: (paidUser) => payEntityActivation(paidUser, effect),
      cost: resolveEffectUseCost(group),
    },
  );
}

/**
 * Применяет предмет сущности мира без листа — кнопкой панели быстрого
 * доступа: эффекты применения ложатся на владельца или цель, предмет теряет
 * заряд или единицу количества.
 *
 * @param entityId - владелец предмета
 * @param itemId - предмет
 */
export function applyEntityItemUse(entityId: string, itemId: string): void {
  const entity = useWorldEntities().findCurrentDndEntity(entityId);
  const item = entity?.equipment?.find((candidate) => candidate.id === itemId);

  if (!entity || !item || !canUseItem(item)) {
    return;
  }

  applyEffectSource(
    buildItemUseSpell(item),
    entity,
    resolveActorStats(entity, listAmbientEffects(entity.id)).spellSaveDC,
    () =>
      updateEntityEquipment(entityId, (equipment) =>
        spendItemUse(equipment, itemId),
      ),
    buildItemUseSpend(itemId, resolveEffectUseCost(item.activeEffects)),
  );
}

/**
 * Расход применения предмета вместе с ценой ресурсом: цена «заряды предмета»
 * заменяет обычный заряд, остальное (единица количества расходуемого, заряд
 * при другой цене) списывается как всегда.
 *
 * @param itemId - предмет
 * @param cost - трата хода на применение предмета
 * @returns расход для {@link applyEffectSource}
 */
export function buildItemUseSpend(
  itemId: string,
  cost?: EffectActivationCost,
): EffectSourceSpend {
  return {
    itemId,
    ...(cost ? { cost } : {}),
    spendOn: (paidUser, itemUsesPaid) =>
      itemUsesPaid
        ? paidUser
        : {
            ...paidUser,
            equipment: spendItemUse(paidUser.equipment ?? [], itemId),
          },
  };
}
