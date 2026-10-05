import type { AttackRollSnapshot } from '../../composables/attackRollSnapshot';
import type { DamageTypeChoiceRequest } from '../../composables/damageTypeChoice';
import type {
  RolledSpellDamagePart,
  SpellDamagePartInput,
} from '../../composables/useSpellResolution';

/**
 * Результат чистой d20-проверки из окна броска — в разбивке.
 *
 * Итога мало тому, кто хранит бросок по частям: трекер инициативы держит кость
 * и модификатор порознь и показывает их отдельно. Поэтому окно отдаёт не только
 * сумму, но и оставленную кость с фактическим модификатором — вместе с бонусом,
 * который игрок добавил прямо в окне.
 */
export interface CheckRollResult {
  /** Итог броска: кость с модификатором */
  total: number;
  /** Натуральное значение оставленной кости (без модификатора) */
  natural: number;
  /** Модификатор проверки вместе с добавленным в окне бонусом */
  modifier: number;
  /**
   * Цель не сопротивлялась: броска не было, спасбросок провален при любой Сл.
   * Числа выше тогда условные — по ним исход не считают
   */
  willing?: true;
}

/**
 * Набор урона, который выбирают в окне броска (урон «или» у действия
 * существа). Всё, что зависит от урона, у набора своё: формула, части, бонус,
 * вопрос о типе урона и применение.
 */
export interface RollDamageVariant {
  /** Подпись в поле «Урон» */
  label: string;
  /** Формула для показа и одночастного пути */
  formula: string;
  /** Основной тип урона набора */
  damageType?: string;
  /** Части урона набора */
  damageParts: SpellDamagePartInput[];
  /** Бонус-части эффектов в момент броска */
  evaluateBonusDamageParts?: (context: {
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
  }) => SpellDamagePartInput[];
  /** Тип урона на выбор в наборе */
  damageTypeChoice?: DamageTypeChoiceRequest;
  /**
   * Применение брошенных частей; снимок броска атаки — если бросок
   * попадания был: по нему разбор считает удар
   */
  onRollParts: (
    parts: RolledSpellDamagePart[],
    attack?: AttackRollSnapshot,
  ) => void;
  /** Набор выбран — зовётся в начале броска (строка чата) */
  onSelect: () => void;
}
