/** Дистанция дальнобойной атаки: обычная и максимальная */
interface AttackRange {
  normal: number;
  long?: number;
}

/** Досягаемость и дистанция атаки, которой можно и ударить, и бросить */
interface AttackDistances {
  /** Досягаемость рукопашной атаки */
  reach: number;
  /** Дистанция дальнобойной атаки */
  range?: AttackRange;
  /** Короткая единица расстояния («фт.») */
  unitLabel: string;
}

/** Разделитель досягаемости и дистанции: «5 фт. / 30/120 фт.» */
const REACH_RANGE_SEPARATOR = ' / ';

/**
 * Дистанция атаки: «30/120 фт.» или «120 фт.».
 *
 * @param range - обычная и максимальная дистанция
 * @param unitLabel - короткая единица расстояния
 * @returns подпись дистанции
 */
export function formatAttackRange(
  range: AttackRange,
  unitLabel: string,
): string {
  const long = range.long ? `/${range.long}` : '';

  return `${range.normal}${long} ${unitLabel}`;
}

/**
 * Обе дальности атаки «рукопашная или дальнобойная»: «5 фт. / 30/120 фт.».
 * Без дистанции — только досягаемость.
 *
 * @param distances - досягаемость, дистанция и единица
 * @returns подпись дальностей
 */
export function formatMeleeOrRangedDistances(
  distances: AttackDistances,
): string {
  const reach = `${distances.reach} ${distances.unitLabel}`;

  return distances.range
    ? `${reach}${REACH_RANGE_SEPARATOR}${formatAttackRange(distances.range, distances.unitLabel)}`
    : reach;
}
