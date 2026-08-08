/**
 * Оборачивает IPv6-адрес в квадратные скобки для использования в URL.
 * IPv4-адреса и доменные имена возвращаются без изменений.
 *
 * Без скобок двоеточия IPv6 путаются с разделителем порта, и адрес вида
 * `http://2a03:f680::1:30001` не разбирается ни браузером, ни `fetch`.
 *
 * @param host IP-адрес или имя хоста
 * @returns Хост, пригодный для подстановки в URL
 * @example
 * formatHostForUrl('192.168.1.1'); // '192.168.1.1'
 * formatHostForUrl('2a03:f680:fe03::1'); // '[2a03:f680:fe03::1]'
 */
export function formatHostForUrl(host: string): string {
  if (host.includes(':')) {
    return `[${host}]`;
  }

  return host;
}
