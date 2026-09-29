/**
 * Выделяет весь текст поля при входе в него. Нужен полям, где число чаще
 * сдвигают, чем правят: «+15» должно заменить старое значение, а не
 * дописаться к нему.
 *
 * @param event - событие фокуса поля
 */
export function selectInputOnFocus(event: FocusEvent): void {
  if (event.target instanceof HTMLInputElement) {
    event.target.select();
  }
}
