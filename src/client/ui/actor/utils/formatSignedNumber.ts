/**
 * Число со знаком для листа: «+3», «−1», «+0».
 *
 * Минус — типографский (U+2212), а не дефис: в подписях бонусов он стоит рядом
 * с цифрами того же кегля и на дефисе строка выглядит рваной.
 *
 * @param value - число бонуса
 * @returns подпись со знаком
 */
export function formatSignedNumber(value: number): string {
  return value < 0 ? `−${Math.abs(value)}` : `+${value}`;
}
