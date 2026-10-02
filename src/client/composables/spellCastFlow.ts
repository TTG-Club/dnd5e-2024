/**
 * Разбор каста заклинания персонажа — один на лист и горячую панель.
 *
 * Раньше лист (`ActorSpellsTab.vue`) и горячая панель (`dnd5eMacros.ts`)
 * держали по своей копии всего каста — проверки, выбор целей и снарядов,
 * сборку окна броска, обработчики подтверждения, списание ячейки, — и копии
 * разошлись: панель открывала окно броска у заклинания со спасброском без
 * урона, не тратила заряд врождённого заклинания, списывала ячейку со старой
 * копии листа, считала полные хиты цели без эффектов на максимум иначе, чем
 * лист. Здесь один путь; входы различаются только портом заклинателя
 * ({@link SpellCasterPort}): откуда читать лист, как записать ячейку и заряд,
 * как сказать «нельзя».
 *
 * Функции — верхнего уровня, а не замыкания внутри компонента: их проверяют
 * тесты с подменённым окружением.
 */

import type { MeasurementTemplate } from '@vtt/shared';
import type {
  DnDActor,
  DnDSceneEntity,
  RollContext,
  Spell,
  SpellCastPlan,
} from '@vtt/shared/system/dnd.js';

import type { SpellCasterSource } from './spellCastCompletion';
import type {
  SpellEffectTargets,
  SpellTargetEffectsSource,
} from './spellEffectTargeting';
import type {
  ProjectileAttackContext,
  RolledSpellDamagePart,
  SpellDamagePartInput,
} from './useSpellResolution';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useActionPromptStore } from '@/stores/actionPromptStore';
import { useChatStore } from '@/stores/chatStore';
import { useProjectileStore } from '@/stores/projectileStore';
import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId } from '@vtt/shared';
import {
  calculateSpellAttackModifier,
  findCastLevelBlock,
  findSpellCastBlock,
  formatConditionalDamageDisplay,
  getAvailableSpellLevels,
  getDamageTemplateColor,
  getPactSlotInfo,
  getSpellDamageParts,
  getSpellPrimaryDamageType,
  getSpellProjectileCount,
  getTotalLevel,
  hasTargetToken,
  isDndSceneEntity,
  isTargetAtFullHp,
  limitCastLevels,
  MAX_SPELL_SLOT_LEVEL,
  pickCantripTierParts,
  resolveActorStats,
  resolveDamagePartsForCast,
  resolveEntityActionBlocks,
  resolveEntityCreatureType,
  resolvePlannedDamageTotal,
  resolveSpellAreaAtLevel,
  resolveSpellCastCost,
  resolveSpellcastingAbility,
  resolveSpellCastPlan,
  resolveSpellDamageFormula,
  resolveSpellSaveDC,
  retypeCasterSpellDamage,
  spellIsHealing,
  withFlatDamageBonus,
  withFlatFormulaBonus,
} from '@vtt/shared/system/dnd.js';

import {
  ACTOR_SPELLS_TAB_LABELS,
  PROJECTILE_MODAL_KEY_PREFIX,
  SPELL_CAST_MODAL_KEY_PREFIX,
  SPELL_MENU_LABELS,
  SPELL_ROLL_BUTTON_LABELS,
} from '../ui/actor/constants';
import { recordEntityActionSpend } from './actionSpend';
import { chooseAreaCastLevel } from './areaCastLevelChoice';
import { resolveTargetedAttackRoll } from './attackRollMode';
import { runWithCastFailureAndPay } from './castFailure';
import {
  requestDamageTypeChoiceFor,
  runWithDamageTypeChoices,
} from './damageTypeChoice';
import { runWithEffectVariants } from './effectVariantChoice';
import {
  buildRollBonusEvaluator,
  collectProjectileRollBonuses,
} from './rollBonusEvaluator';
import {
  afterSpellCast,
  completeSpellCast,
  SPELL_CAST_KEY_PREFIX,
} from './spellCastCompletion';
import { beginSpellCast, setSpellCastLevel } from './spellCasts';
import {
  applySpellTargetEffects,
  createProjectileCastValidator,
  needsSpellEffectTargets,
  requestSpellEffectTargets,
  settleNoRollSpellTargets,
} from './spellEffectTargeting';
import {
  useBonusDamageParts,
  withFlatDamageBonusPart,
} from './useBonusDamageParts';
import {
  collectEffectsWithAuras,
  listAmbientEffects,
} from './useResolvedStats';
import {
  getSpellMaxRangeOnScene,
  isSpellCastBlockedByRange,
  isSpellTargetBlockedByRange,
} from './useSceneRangeCheck';
import { useSpellResolution } from './useSpellResolution';
import { useWorldEntities } from './useWorldEntities';

/** Почему каст не начался: заголовок и пояснение */
export interface SpellCastRefusal {
  title: string;
  description: string;
}

/**
 * Всё, чем входы каста различаются. Лист пишет ресурсы своим сохранением
 * (черновик листа иначе затёр бы запись), горячая панель — помощником записи
 * листа; лист отказывает уведомлением, панель — строкой в чат.
 */
export interface SpellCasterPort {
  /** Заклинатель */
  casterId: string;
  /** Лист заклинателя сейчас; нет — заклинатель ушёл из мира */
  readCaster: () => DnDActor | undefined;
  /** Списывает ячейку выбранного круга (зовётся только при `consumeSlot`) */
  spendSlot: (castLevel: number, isPactSlot: boolean) => void;
  /** Списывает заряд заклинания с зарядами (врождённого) */
  spendUse: (spell: Spell) => void;
  /**
   * Записывает лист после оплаты цены каста. Нет — оплата пишется обычной
   * записью листа сущности мира
   */
  commitPaid?: (paidCaster: DnDSceneEntity) => void;
  /** Каст не начался: говорит почему */
  refuse: (spell: Spell, refusal: SpellCastRefusal) => void;
}

/** Где шаблон области каста */
export interface SpellCastTemplate {
  /** Размещённый шаблон: читается и снимается в момент применения */
  id: string;
}

/** Что известно о касте, когда открывается окно */
export interface SpellCastWindowOptions {
  /** Шаблон области */
  template?: SpellCastTemplate;
  /** Круг, выбранный до окна */
  lockedLevel?: number;
  /** Цели эффекта, выбранные до окна */
  effectTargets?: SpellEffectTargets;
}

/**
 * Каст, окно которого открыто: числа заклинателя, план, собранные формулы и
 * изменяемое состояние (заклинание после выбора типа урона, попадание,
 * применён ли). Его получают обработчики окна.
 */
export interface SpellCastSession {
  port: SpellCasterPort;
  /** Ключ каста: применение окна доводит каст один раз */
  castKey: string;
  plan: SpellCastPlan;
  /** Каст идёт снарядами */
  hasProjectiles: boolean;
  /** Формула одной части с подставленными числами (одиночный путь, снаряды) */
  resolvedDamageFormula: string;
  /** Плоский бонус эффектов к урону заклинаниями */
  flatSpellDamageBonus: number;
  /** Сборщик бонус-частей урона на момент броска */
  evaluateSpellBonusParts?: (rollContext: {
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
  }) => SpellDamagePartInput[];
  template?: SpellCastTemplate;
  effectTargets?: SpellEffectTargets;
  /** Изменяемое по ходу каста */
  state: {
    /** Заклинание — после выбора типа урона окном */
    spell: Spell;
    /** Атака заклинанием-эффектом попала: эффекты на цель ложатся после каста */
    attackLanded: boolean;
    /** Окно применило каст — закрытие уже ничего не убирает */
    applied: boolean;
  };
}

/**
 * Круги, которыми заклинатель может наложить заклинание: у заклинания с
 * зарядами — его круг (ячейка не тратится), у уровневого — круги, на которые
 * остались ячейки, без запрещённых эффектами, у заговора — 0.
 *
 * @param caster - заклинатель
 * @param spell - заклинание
 * @returns доступные круги; пусто — наложить нечем
 */
export function resolveCastableSpellLevels(
  caster: DnDActor,
  spell: Spell,
): number[] {
  if (spell.uses) {
    return [spell.level];
  }

  if (spell.level <= 0) {
    return [0];
  }

  // «Не может использовать ячейки 7-го круга и выше» сужает выбор круга
  return limitCastLevels(
    resolveEntityActionBlocks(caster, listAmbientEffects(caster.id)),
    spell,
    listSlotSpellLevels(caster, spell),
  );
}

/**
 * Круги, на которые у заклинателя остались ячейки, — до запретов эффектов.
 * Свои бонусы к ячейкам считаются от итоговых чисел листа — как на вкладке.
 *
 * @param caster - заклинатель
 * @param spell - заклинание
 * @returns круги не ниже круга заклинания
 */
function listSlotSpellLevels(caster: DnDActor, spell: Spell): number[] {
  const stats = resolveActorStats(caster);

  return getAvailableSpellLevels(caster, spell.level, MAX_SPELL_SLOT_LEVEL, {
    abilityMods: stats.abilityMods,
    proficiencyBonus: stats.proficiencyBonus,
  });
}

/**
 * Почему каст не начнётся: запрет трат хода, нет зарядов, все круги под
 * запретом, нет ячеек.
 *
 * @param caster - заклинатель
 * @param spell - заклинание (после выбора варианта)
 * @param availableLevels - доступные круги
 * @returns причина либо `null`
 */
export function findSpellCastRefusal(
  caster: DnDActor,
  spell: Spell,
  availableLevels: readonly number[],
): SpellCastRefusal | null {
  // Заклинания с зарядами не тратят ячейки: проверяются только заряды
  if (
    spell.uses
    && spell.uses.recovery !== 'atWill'
    && spell.uses.current <= 0
  ) {
    return {
      title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
      description: `${ACTOR_SPELLS_TAB_LABELS.noUsesTextPrefix}${spell.name}${ACTOR_SPELLS_TAB_LABELS.noUsesTextSuffix}`,
    };
  }

  if (spell.uses || spell.level <= 0 || availableLevels.length > 0) {
    return null;
  }

  // Ячейки есть, но все под запретом круга — причина словами
  const levelBlock = findCastLevelBlock(
    resolveEntityActionBlocks(caster, listAmbientEffects(caster.id)),
    spell,
    listSlotSpellLevels(caster, spell),
  );

  return levelBlock
    ? {
        title: ACTOR_SPELLS_TAB_LABELS.castBlockedTitle,
        description: levelBlock,
      }
    : {
        title: ACTOR_SPELLS_TAB_LABELS.noSlotsTitle,
        description: `${ACTOR_SPELLS_TAB_LABELS.noSlotsTextPrefix}${spell.level}${ACTOR_SPELLS_TAB_LABELS.noSlotsTextSuffix}`,
      };
}

/**
 * Начинает каст: запрет трат хода, замена типа урона заклинания, заряды и
 * ячейки, трата хода, затем выбор целей эффекта, снарядов, круга области или
 * подтверждение — и дальше оплата и окно.
 *
 * @param sourceSpell - заклинание; варианты эффектов ещё не выбраны
 * @param port - заклинатель
 */
export function startSpellCast(
  sourceSpell: Spell,
  port: SpellCasterPort,
): void {
  const caster = port.readCaster();

  if (!caster) {
    return;
  }

  // Запрет трат хода («Электрошок» — нет реакций) — до выбора варианта
  const blocked = findSpellCastBlock(
    resolveEntityActionBlocks(caster, listAmbientEffects(caster.id)),
    sourceSpell,
  );

  if (blocked) {
    port.refuse(sourceSpell, {
      title: ACTOR_SPELLS_TAB_LABELS.castBlockedTitle,
      description: blocked,
    });

    return;
  }

  // «Можете изменить тип урона заклинания» — тип становится выбором
  runWithEffectVariants(
    retypeCasterSpellDamage(sourceSpell, caster),
    (spell) => {
      const availableLevels = resolveCastableSpellLevels(caster, spell);
      const refusal = findSpellCastRefusal(caster, spell, availableLevels);

      if (refusal) {
        port.refuse(spell, refusal);

        return;
      }

      // «Замедление»: каст точно идёт — после действия бонусное в этот ход
      // недоступно; отказ по зарядам и ячейкам трату не тратит
      recordEntityActionSpend(caster.id, resolveSpellCastCost(spell));

      chooseSpellCastTargets(spell, caster, port, availableLevels);
    },
  );
}

/**
 * Выбор, который каст делает до оплаты: цели эффекта, снаряды, круг области
 * либо подтверждение «Применить заклинание?».
 *
 * @param spell - заклинание
 * @param caster - заклинатель
 * @param port - заклинатель-порт
 * @param availableLevels - доступные круги
 */
function chooseSpellCastTargets(
  spell: Spell,
  caster: DnDActor,
  port: SpellCasterPort,
  availableLevels: number[],
): void {
  if (needsSpellEffectTargets(spell)) {
    requestSpellEffectTargets(
      spell,
      caster.id,
      availableLevels,
      (level, targets) => {
        proceedWithSpellCast(spell, port, level, targets);
      },
    );

    return;
  }

  // Снарядный режим: число снарядов зависит от контекста каста
  // (заговоры — от уровня персонажа, уровневые — от круга ячейки)
  const casterLevel = getTotalLevel(caster.system?.classes);

  const baseProjectileCount = getSpellProjectileCount(spell, {
    slotLevel: availableLevels[0] ?? spell.level,
    casterLevel,
  });

  const hasProjectiles = baseProjectileCount > 1 && !spell.areaOfEffect;

  // Проверка дистанции каста до выбранной цели (только одиночная цель:
  // у области и снарядов собственные механики выбора)
  if (
    !spell.areaOfEffect
    && !hasProjectiles
    && isSpellCastBlockedByRange(spell, caster.id)
  ) {
    return;
  }

  // Область: круг до шаблона (область растёт от круга), затем шаблон
  if (spell.areaOfEffect) {
    chooseAreaCastLevel(spell, availableLevels, (castLevel) => {
      proceedWithSpellCast(spell, port, castLevel);
    });

    return;
  }

  if (hasProjectiles) {
    const projectileStore = useProjectileStore();

    projectileStore.startTargeting(
      spell.projectiles?.targetDistribution ?? null,
      baseProjectileCount,
      (tokenId) => !isSpellTargetBlockedByRange(spell, caster.id, tokenId),
    );

    useModalManager().openModal('ProjectilePromptModal', {
      _modalKey: `${PROJECTILE_MODAL_KEY_PREFIX}-${projectileStore.sessionId}`,
      targetingSessionId: projectileStore.sessionId,
      spell,
      casterLevel,
      availableSpellLevels: availableLevels,
      onConfirm: (selectedLevel: number) => {
        proceedWithSpellCast(spell, port, selectedLevel);
      },
    });

    return;
  }

  // Обычное заклинание — подтверждение плашкой
  const promptStore = useActionPromptStore();
  const promptId = `spell-cast-${spell.id}`;

  promptStore.addPrompt({
    id: promptId,
    icon: 'tabler:wand',
    title: `${ACTOR_SPELLS_TAB_LABELS.castConfirmPrefix}${spell.name}${ACTOR_SPELLS_TAB_LABELS.castConfirmSuffix}`,
    color: 'neutral',
    actions: [
      {
        icon: 'tabler:check',
        color: 'primary',
        onClick: () => {
          promptStore.removePrompt(promptId);
          proceedWithSpellCast(spell, port);
        },
      },
      {
        icon: 'tabler:x',
        color: 'neutral',
        variant: 'ghost',
        onClick: () => {
          promptStore.removePrompt(promptId);
        },
      },
    ],
  });
}

/**
 * Продолжает подтверждённый каст: проверка провала каста, затем цена сверх
 * ячейки («потратьте две Кости Хитов, иначе заклинание провалится»), затем
 * сам каст — уже с потраченным в формулах заклинания и его эффектов.
 *
 * @param sourceSpell - заклинание; цена ещё не оплачена
 * @param port - заклинатель
 * @param lockedLevel - круг, выбранный до окна
 * @param effectTargets - цели эффекта, выбранные до окна
 */
export function proceedWithSpellCast(
  sourceSpell: Spell,
  port: SpellCasterPort,
  lockedLevel?: number,
  effectTargets?: SpellEffectTargets,
): void {
  const caster = port.readCaster();

  if (!caster) {
    return;
  }

  runWithCastFailureAndPay(
    sourceSpell,
    caster,
    {
      ...(lockedLevel === undefined ? {} : { lockedLevel }),
      availableLevels: resolveCastableSpellLevels(caster, sourceSpell),
      ...(port.commitPaid ? { commit: port.commitPaid } : {}),
    },
    (spell, castLevel) => {
      proceedWithPaidSpellCast(spell, port, castLevel, effectTargets);
    },
  );
}

/**
 * Оплаченный каст: заряд заклинания с зарядами, шаблон области — и окно.
 *
 * @param spell - заклинание (оплачено)
 * @param port - заклинатель
 * @param lockedLevel - круг, выбранный до окна
 * @param effectTargets - цели эффекта, выбранные до окна
 */
function proceedWithPaidSpellCast(
  spell: Spell,
  port: SpellCasterPort,
  lockedLevel?: number,
  effectTargets?: SpellEffectTargets,
): void {
  // Заряд заклинания с откатом (врождённого) — один раз на каст, до окна
  if (spell.uses && spell.uses.recovery !== 'atWill') {
    port.spendUse(spell);
  }

  if (!spell.areaOfEffect) {
    openSpellCastWindow(spell, port, { lockedLevel, effectTargets });

    return;
  }

  // Шаблон каста живёт до применения и снимается сам, поэтому размер ему
  // задаёт запись, а не игрок: без явного `false` он оставался бы
  // растягиваемым, и один и тот же конус вёл себя по-разному с листа и с
  // горячей панели
  useSpellTemplateStore().requestPlacement(
    {
      ...(resolveSpellAreaAtLevel(spell, lockedLevel) ?? spell.areaOfEffect),
      resizable: spell.areaOfEffect.resizable ?? false,
    },
    getDamageTemplateColor(getSpellPrimaryDamageType(spell)),
    port.casterId,
    (templateId) =>
      openSpellCastWindow(spell, port, {
        template: { id: templateId },
        lockedLevel,
      }),
    getSpellMaxRangeOnScene(spell),
  );
}

/**
 * Числа заклинателя для эффектов этого заклинания: Сл и модификатор его
 * заклинательной характеристики.
 *
 * @param caster - заклинатель
 * @param spell - заклинание
 * @returns Сл и модификатор
 */
export function resolveSpellCasterSource(
  caster: DnDActor,
  spell: Spell,
): SpellCasterSource {
  const stats = resolveActorStats(caster);

  return {
    saveDc: resolveSpellSaveDC(caster, spell, stats),
    spellMod: stats.abilityMods[resolveSpellcastingAbility(caster, spell)],
  };
}

/**
 * Кто накладывает эффекты на цель: Сл 0 эффекта и его спасбросок считаются от
 * заклинателя.
 *
 * @param session - каст
 * @returns заклинатель и Сл
 */
function targetEffectsSourceOf(
  session: SpellCastSession,
): SpellTargetEffectsSource {
  const caster = session.port.readCaster();

  return {
    casterId: session.port.casterId,
    spellSaveDC: caster
      ? resolveSpellCasterSource(caster, session.state.spell).saveDc
      : 0,
  };
}

/**
 * Доводит каст: конец прежней концентрации, эффекты на заклинателе, зона на
 * месте шаблона. Заклинатель читается в момент доведения; ключ отсекает
 * повторное применение того же каста.
 *
 * @param session - каст
 * @param template - размещённый шаблон
 * @returns выполняется, когда эффекты прежнего каста сняты
 */
function finishSpellCast(
  session: SpellCastSession,
  template: MeasurementTemplate | null,
): Promise<void> {
  const caster = session.port.readCaster();

  if (!caster) {
    return Promise.resolve();
  }

  return completeSpellCast({
    spell: session.state.spell,
    caster,
    source: resolveSpellCasterSource(caster, session.state.spell),
    template,
    castKey: session.castKey,
  });
}

/**
 * Забирает шаблон каста в момент применения: данные шаблона нужны целям и
 * зоне, сам он с карты убирается.
 *
 * @param session - каст
 * @returns размещённый шаблон либо `null`
 */
function claimCastTemplate(
  session: SpellCastSession,
): MeasurementTemplate | null {
  if (!session.template) {
    return null;
  }

  const templateStore = useSpellTemplateStore();
  const placed = templateStore.getPlacedTemplate(session.template.id) ?? null;

  templateStore.removePlacedTemplate(session.template.id);
  templateStore.deleteTemplate(session.template.id);

  return placed;
}

/**
 * Помечает каст применённым: закрытие окна шаблон и снаряды уже не убирает.
 *
 * @param session - каст
 */
function markSpellCastApplied(session: SpellCastSession): void {
  session.state.applied = true;
}

/**
 * Убирает недоведённый каст: шаблон с карты и выбор снарядов. Зовётся при
 * закрытии окна и при уходе со страницы.
 *
 * @param session - каст
 * @param isCurrentProjectileCast - выбор снарядов ещё этого каста
 */
export function abandonSpellCast(
  session: SpellCastSession,
  isCurrentProjectileCast: () => boolean,
): void {
  if (session.state.applied) {
    return;
  }

  if (session.template) {
    useSpellTemplateStore().deleteTemplate(session.template.id);
  }

  if (session.hasProjectiles && isCurrentProjectileCast()) {
    useProjectileStore().stopTargeting();
  }
}

/**
 * Подтверждение окна: доводит каст и разбирает цели, когда эффекты прежнего
 * каста сняты. Итог окна идёт в разбор как урон, только если у каста есть
 * части урона: окно без формулы катит проверку.
 *
 * @param session - каст
 * @param rolledTotal - итог окна
 * @param chosenDamageType - тип урона, выбранный в окне
 */
export function settleSpellRoll(
  session: SpellCastSession,
  rolledTotal: number,
  chosenDamageType?: string,
): void {
  markSpellCastApplied(session);

  const damageTotal = resolvePlannedDamageTotal(session.plan, rolledTotal);
  const template = claimCastTemplate(session);

  afterSpellCast(finishSpellCast(session, template), () => {
    const { spell } = session.state;
    const { plan } = session;

    // Спасброски, автопопадание, снаряды — разбор оркестратором. Эффекты на
    // цель без урона тоже его требуют: спасбросок и наложение при провале
    if (
      plan.needsTargetResolution
      && (damageTotal > 0 || plan.hasTargetEffects)
    ) {
      resolveSpellTargets(session, damageTotal, template, chosenDamageType);
    }

    // Эффекты на цель без спасброска: без броска атаки — сразу (бафф союзника
    // касанием), у атаки — по попаданию
    if (
      plan.hasTargetEffects
      && !plan.needsSave
      && (!plan.attackType || session.state.attackLanded)
    ) {
      applySpellTargetEffects(
        spell,
        targetEffectsSourceOf(session),
        plan.attackType ? undefined : session.effectTargets,
      );
    }
  });
}

/**
 * Разбор целей одной суммой окна: спасброски, автопопадание, снаряды.
 *
 * @param session - каст
 * @param damageTotal - урон окна
 * @param template - шаблон области
 * @param chosenDamageType - тип урона, выбранный в окне
 */
function resolveSpellTargets(
  session: SpellCastSession,
  damageTotal: number,
  template: MeasurementTemplate | null,
  chosenDamageType: string | undefined,
): void {
  const { spell } = session.state;
  const socket = useChatStore().getSocket();

  // Цели читаются после ожидания: эффекты прежнего каста уже сняты
  const actors = useWorldEntities().getCurrentWorldEntities();

  if (actors.length === 0 || !socket) {
    return;
  }

  // Бонус-части снарядов собираются в момент подтверждения: снаряды без
  // броска атаки — преимущества и помехи нет. Плоский бонус заклинаниям едет
  // здесь же отдельной частью: она катается один раз на каст
  const projectileBonusParts = session.hasProjectiles
    ? withFlatDamageBonusPart(
        session.evaluateSpellBonusParts?.({
          hasAdvantage: false,
          hasDisadvantage: false,
        }) ?? [],
        spellIsHealing(spell) ? 0 : session.flatSpellDamageBonus,
      )
    : undefined;

  useSpellResolution().resolveSpellDamage(
    {
      spell,
      damageTotal,
      spellSaveDC: targetEffectsSourceOf(session).spellSaveDC,
      actors,
      socket,
      overrideDamageType: chosenDamageType,
      casterId: session.port.casterId,
    },
    {
      hasProjectiles: session.hasProjectiles,
      resolvedDamageFormula: session.resolvedDamageFormula,
      scene: useWorldStore().currentScene,
      cachedTemplate: template,
      bonusDamageParts: projectileBonusParts,
    },
  );
}

/**
 * Многочастный бросок: доводит каст и применяет части оркестратором.
 *
 * @param session - каст
 * @param parts - брошенные части
 */
export function settleSpellRollParts(
  session: SpellCastSession,
  parts: RolledSpellDamagePart[],
): void {
  markSpellCastApplied(session);

  const template = claimCastTemplate(session);

  // Многочастный бросок тоже доводит каст: окно зовёт только его
  afterSpellCast(finishSpellCast(session, template), () => {
    const socket = useChatStore().getSocket();
    const actors = useWorldEntities().getCurrentWorldEntities();

    if (actors.length === 0 || !socket) {
      return;
    }

    void useSpellResolution().resolveSpellDamageWithParts(
      {
        spell: session.state.spell,
        damageTotal: 0,
        spellSaveDC: targetEffectsSourceOf(session).spellSaveDC,
        actors,
        socket,
        casterId: session.port.casterId,
      },
      parts,
      { scene: useWorldStore().currentScene, cachedTemplate: template },
    );
  });
}

/**
 * Серия атак снарядов (Мистический заряд, Палящий луч): окно отдаёт контекст
 * броска, разбор катит попадание на каждый снаряд. Бонус-части эффектов
 * собираются с фактическим режимом и катаются на каждое попадание.
 *
 * @param session - каст
 * @param rollContext - контекст броска атаки
 */
export function settleSpellProjectileAttack(
  session: SpellCastSession,
  rollContext: Omit<ProjectileAttackContext, 'attackType'>,
): void {
  const { attackType } = session.plan;

  if (!attackType) {
    return;
  }

  markSpellCastApplied(session);

  const { spell } = session.state;

  // Каждый луч — СВОЙ бросок атаки и урона, поэтому плоский бонус получает
  // каждый. У автопопаданий (Волшебная стрела) бросок урона один на каст
  const projectileBonusParts = withFlatDamageBonusPart(
    session.evaluateSpellBonusParts?.({
      hasAdvantage: rollContext.rollMode === 'advantage',
      hasDisadvantage: rollContext.rollMode === 'disadvantage',
    }) ?? [],
    spellIsHealing(spell) ? 0 : session.flatSpellDamageBonus,
  );

  // Серия снарядов тоже доводит каст: окно зовёт только этот обработчик
  afterSpellCast(finishSpellCast(session, null), () => {
    const socket = useChatStore().getSocket();
    const actors = useWorldEntities().getCurrentWorldEntities();

    if (actors.length === 0 || !socket) {
      return;
    }

    useSpellResolution().resolveSpellDamage(
      {
        spell,
        damageTotal: 0,
        spellSaveDC: targetEffectsSourceOf(session).spellSaveDC,
        actors,
        socket,
        casterId: session.port.casterId,
      },
      {
        hasProjectiles: true,
        resolvedDamageFormula: session.resolvedDamageFormula,
        scene: useWorldStore().currentScene,
        projectileAttack: {
          attackModifier: rollContext.attackModifier,
          rollMode: rollContext.rollMode,
          bonusDiceFormulasByTarget: rollContext.bonusDiceFormulasByTarget,
          attackType,
        },
        bonusDamageParts: projectileBonusParts,
      },
    );
  });
}

/**
 * Каст без окна броска (план `effectsOnly`): доводит каст и разбирает цели —
 * спасбросок без урона бросает цель, без спасброска эффекты ложатся сразу.
 *
 * @param session - каст
 */
export function settleNoRollSpellCast(session: SpellCastSession): void {
  markSpellCastApplied(session);

  const template = claimCastTemplate(session);

  afterSpellCast(finishSpellCast(session, template), () => {
    settleNoRollSpellTargets(
      session.state.spell,
      targetEffectsSourceOf(session),
      { effectTargets: session.effectTargets, template },
    );
  });
}

/**
 * Окно каста — единственное место, где для заклинания персонажа собираются
 * свойства `DiceRollModal`: план решает, открыть ли окно броска, окно выбора
 * круга или применить каст сразу.
 *
 * @param sourceSpell - заклинание; тип урона на выбор ещё не решён
 * @param port - заклинатель
 * @param options - шаблон, круг и цели, выбранные до окна
 * @returns каст; заклинателя нет — `null`
 */
export function openSpellCastWindow(
  sourceSpell: Spell,
  port: SpellCasterPort,
  options: SpellCastWindowOptions = {},
): SpellCastSession | null {
  const caster = port.readCaster();

  if (!caster) {
    return null;
  }

  const { template, lockedLevel, effectTargets } = options;
  const stats = resolveActorStats(caster);
  const isInnate = Boolean(sourceSpell.uses);
  const castKey = generateId(SPELL_CAST_KEY_PREFIX);

  beginSpellCast(caster.id, sourceSpell, castKey);

  // Снарядный режим: число снарядов зависит от круга ячейки (уровневые) или
  // уровня персонажа (заговоры); у области и шаблона снарядов нет
  const casterLevel = getTotalLevel(caster.system?.classes);

  const projectileCount = getSpellProjectileCount(sourceSpell, {
    slotLevel: lockedLevel ?? sourceSpell.level,
    casterLevel,
  });

  const hasProjectiles =
    projectileCount > 1 && !sourceSpell.areaOfEffect && !template;

  // Ступень заговора целиком заменяет базовые части урона
  const spellDamageParts =
    sourceSpell.level === 0
      ? (pickCantripTierParts(sourceSpell, casterLevel)
        ?? getSpellDamageParts(sourceSpell))
      : getSpellDamageParts(sourceSpell);

  // Кость-бонусы урона заклинаний с эффектов (и аур на карте) катаются
  // отдельными частями — каст идёт многочастным путём
  const { hasSpellBonusDamage, buildSpellBonusEvaluator } =
    useBonusDamageParts();

  const spellEffects = collectEffectsWithAuras(caster);
  const hasBonusDamage = hasSpellBonusDamage(spellEffects);

  const plan = resolveSpellCastPlan({
    spell: sourceSpell,
    damageParts: spellDamageParts,
    hasProjectiles,
    hasBonusDamage,
    isInnate,
    hasTemplate: template !== undefined,
  });

  // Выбранная цель — для @target-токенов одиночной цели; у области ветки
  // по хитам и типу решаются на каждой цели
  const targetEntity = sourceSpell.areaOfEffect
    ? null
    : useTargetStore().getTargetActor();

  const targetIsFull = isTargetAtFullHp(targetEntity);

  const targetType =
    targetEntity && isDndSceneEntity(targetEntity)
      ? resolveEntityCreatureType(targetEntity)
      : undefined;

  /** Плоский бонус эффектов к урону заклинаниями (`damage.spell`) */
  const flatSpellDamageBonus = stats.damageBonuses.spell;
  const firstPartFormula = spellDamageParts[0]?.formula ?? '';

  // Снарядам бонус в формулу не вливается — она катается на каждый снаряд
  const resolvedDamageFormula = withFlatFormulaBonus(
    resolveSpellDamageFormula(
      sourceSpell,
      caster,
      firstPartFormula,
      stats,
      targetIsFull,
      targetType,
    ),
    hasProjectiles || spellIsHealing(sourceSpell) ? 0 : flatSpellDamageBonus,
  );

  const useMultiPart = plan.flow === 'multiPart';

  const evaluateSpellBonusParts =
    useMultiPart || (hasProjectiles && hasBonusDamage)
      ? buildSpellBonusEvaluator({
          spell: sourceSpell,
          actor: caster,
          effects: spellEffects,
          resolvedStats: stats,
          multiTarget: plan.multiTarget,
        })
      : undefined;

  const session: SpellCastSession = {
    port,
    castKey,
    plan,
    hasProjectiles,
    resolvedDamageFormula,
    flatSpellDamageBonus,
    evaluateSpellBonusParts,
    template,
    effectTargets,
    state: { spell: sourceSpell, attackLanded: false, applied: false },
  };

  // Тип урона на выбор спрашивает окно: в начале броска заклинание
  // заменяется выбранным, и всё, что ложится после, идёт одним типом
  const damageTypeChoice = requestDamageTypeChoiceFor(
    sourceSpell,
    sourceSpell,
    (chosen) => {
      session.state.spell = chosen;
    },
  );

  const projectileStore = useProjectileStore();

  if (hasProjectiles && !projectileStore.isActive) {
    projectileStore.startTargeting(
      sourceSpell.projectiles?.targetDistribution ?? null,
      projectileCount,
      (tokenId) =>
        !isSpellTargetBlockedByRange(sourceSpell, caster.id, tokenId),
    );
  }

  const isCurrentProjectileCast = createProjectileCastValidator(hasProjectiles);

  // Каст без окна броска: заговор и врождённое — сразу, уровневое — окном
  // выбора круга
  if (plan.window === 'none') {
    runWithDamageTypeChoices(sourceSpell, (chosen) => {
      session.state.spell = chosen;
      settleNoRollSpellCast(session);
    });

    return session;
  }

  const handleUnload = (): void =>
    abandonSpellCast(session, isCurrentProjectileCast);

  window.addEventListener('beforeunload', handleUnload);

  /** Закрытие окна: недоведённый каст убирается */
  const handleModalClose = (isOpen: boolean): void => {
    if (!isOpen) {
      window.removeEventListener('beforeunload', handleUnload);
      handleUnload();
    }
  };

  /** Применение снимает слежение за уходом со страницы */
  const releaseUnload = (): void =>
    window.removeEventListener('beforeunload', handleUnload);

  const slotProps = buildSpellSlotProps(session, caster, lockedLevel);

  if (plan.window === 'confirm') {
    useModalManager().openModal('DiceRollModal', {
      '_modalKey': generateId(SPELL_CAST_MODAL_KEY_PREFIX),
      'title': `${ACTOR_SPELLS_TAB_LABELS.rollTitlePrefix}${sourceSpell.name}`,
      'rollLabel': sourceSpell.name,
      'rollButtonText': SPELL_MENU_LABELS.cast,
      'skipRoll': true,
      'beforeRoll': effectTargets?.validate ?? isCurrentProjectileCast,
      damageTypeChoice,
      ...slotProps,
      'onRoll': () => {
        releaseUnload();
        settleNoRollSpellCast(session);
      },
      'onUpdate:open': handleModalClose,
    });

    return session;
  }

  const attackType = plan.attackType;

  const evaluateAttackBonusRollFormulas = attackType
    ? buildRollBonusEvaluator(
        () =>
          useWorldEntities().findCurrentDndEntity(caster.id)
          ?? port.readCaster(),
        'attack.spell',
      )
    : undefined;

  const spellAttackRoll = attackType
    ? resolveTargetedAttackRoll(caster, 'spell')
    : undefined;

  const resolvedParts: SpellDamagePartInput[] = useMultiPart
    ? withFlatDamageBonus(
        resolveDamagePartsForCast(
          sourceSpell,
          caster,
          spellDamageParts,
          stats,
          targetIsFull,
          targetType,
        ),
        flatSpellDamageBonus,
      )
    : [];

  useModalManager().openModal('DiceRollModal', {
    '_modalKey': generateId(SPELL_CAST_MODAL_KEY_PREFIX),
    'title': `${ACTOR_SPELLS_TAB_LABELS.rollTitlePrefix}${sourceSpell.name}`,
    'rollLabel': sourceSpell.name,
    'rollButtonText': SPELL_ROLL_BUTTON_LABELS[plan.rollKind ?? 'damage'],
    'formula': resolvedDamageFormula,
    // Без известной цели ветки «полные / не полные хиты» показываются через
    // «или», а не суммой
    'formulaDisplay':
      targetIsFull === undefined && hasTargetToken(firstPartFormula)
        ? formatConditionalDamageDisplay(firstPartFormula, (subFormula) =>
            resolveSpellDamageFormula(sourceSpell, caster, subFormula, stats),
          )
        : undefined,
    'attackModifier': attackType
      ? calculateSpellAttackModifier(caster, sourceSpell, stats)
      : undefined,
    'initialRollMode': spellAttackRoll?.mode ?? 'normal',
    'rollModeReasons': spellAttackRoll?.reasons,
    // Расход одноразовых эффектов «следующей атаки» на броске атаки
    'attackerId': caster.id,
    'evaluateBonusRollFormulas': hasProjectiles
      ? undefined
      : evaluateAttackBonusRollFormulas,
    'evaluateProjectileBonusRollFormulas':
      hasProjectiles && evaluateAttackBonusRollFormulas
        ? (context: RollContext) =>
            collectProjectileRollBonuses(
              context,
              evaluateAttackBonusRollFormulas,
            )
        : undefined,
    'incomingAttackType': attackType,
    'isHealing': spellIsHealing(sourceSpell),
    'damageType': getSpellPrimaryDamageType(sourceSpell),
    'skipDamageApplication': plan.needsTargetResolution,
    'skipChatMessage': hasProjectiles,
    // Атакующие снаряды: окно отдаёт контекст, серию бросков катит разбор
    'onProjectileAttack':
      hasProjectiles && attackType
        ? (rollContext: Omit<ProjectileAttackContext, 'attackType'>) => {
            releaseUnload();
            settleSpellProjectileAttack(session, rollContext);
          }
        : undefined,
    damageTypeChoice,
    // Атакующее заклинание-эффект (без многочастного пути): попадание
    // запоминается, эффекты на цель ложатся после доведения каста.
    // Многочастные накладывают их сами
    'onHit':
      attackType && plan.hasTargetEffects && !useMultiPart
        ? () => {
            session.state.attackLanded = true;
          }
        : undefined,
    'damageParts': useMultiPart ? resolvedParts : undefined,
    'onRollParts': useMultiPart
      ? (parts: RolledSpellDamagePart[]) => {
          releaseUnload();
          settleSpellRollParts(session, parts);
        }
      : undefined,
    // Снарядам бонус-части катает разбор, а не окно
    'evaluateBonusDamageParts': useMultiPart
      ? evaluateSpellBonusParts
      : undefined,
    ...slotProps,
    'spellScalingDice': sourceSpell.scaling?.additionalDice,
    'onRoll': (rolledTotal: number, chosenDamageType?: string) => {
      releaseUnload();
      settleSpellRoll(session, rolledTotal, chosenDamageType);
    },
    'beforeRoll': isCurrentProjectileCast,
    'onUpdate:open': handleModalClose,
  });

  return session;
}

/**
 * Свойства окна для выбора круга и списания ячейки. У заклинания с зарядами
 * круг закреплён и ячейка не тратится.
 *
 * @param session - каст
 * @param caster - заклинатель
 * @param lockedLevel - круг, выбранный до окна
 * @returns свойства окна
 */
function buildSpellSlotProps(
  session: SpellCastSession,
  caster: DnDActor,
  lockedLevel: number | undefined,
) {
  const spell = session.state.spell;
  const isInnate = Boolean(spell.uses);
  const pactSlotInfo = getPactSlotInfo(caster.system?.classes ?? []);

  let availableLevels = [0];

  if (lockedLevel !== undefined) {
    availableLevels = [lockedLevel];
  } else if (isInnate) {
    availableLevels = [spell.level];
  } else if (spell.level > 0) {
    availableLevels = resolveCastableSpellLevels(caster, spell);
  }

  return {
    spellLevel: lockedLevel ?? (spell.level > 0 ? spell.level : undefined),
    availableSpellLevels: availableLevels,
    spellLevelLocked: lockedLevel !== undefined,
    pactSlotLevel: pactSlotInfo.max > 0 ? pactSlotInfo.level : 0,
    onSpellSlotConsume: isInnate
      ? undefined
      : (castLevel: number, consumeSlot: boolean, isPactSlot: boolean) => {
          // Круг каста: эффекты ложатся позже, а по кругу «Рассеивание
          // магии» решает, снимается ли каст
          setSpellCastLevel(session.port.casterId, spell, castLevel);

          if (consumeSlot && castLevel > 0) {
            session.port.spendSlot(castLevel, isPactSlot);
          }
        },
  };
}
