// Сумма корзины со скидкой в процентах
export function total(items, discountPercent = 0) {
  const sum = items.reduce((acc, item) => acc + item.price, 0);
  return sum - discountPercent;
}
