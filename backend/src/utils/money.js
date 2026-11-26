/**
 * Exact fixed-point decimal helpers using BigInt (no JS floating-point math for money).
 */

const expandScientific = (rawStr) => {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(rawStr);
  if (!match) return rawStr;
  const sign = match[1];
  const intPart = match[2];
  const fracPart = match[3] || '';
  const exp = Number(match[4]);
  const digits = intPart + fracPart;
  const decimalPos = intPart.length + exp;

  if (decimalPos <= 0) {
    return `${sign}0.${'0'.repeat(-decimalPos)}${digits}`;
  }
  if (decimalPos >= digits.length) {
    return `${sign}${digits}${'0'.repeat(decimalPos - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalPos)}.${digits.slice(decimalPos)}`;
};

const roundDiv = (numerator, divisor) => {
  if (numerator >= 0n) {
    return (numerator + divisor / 2n) / divisor;
  }
  return -((-numerator + divisor / 2n) / divisor);
};

/**
 * Parses a numeric/string decimal value into a BigInt scaled by 10^scaleDigits,
 * rounding half-up if more than scaleDigits fractional digits are present.
 */
const parseScaledInt = (value, scaleDigits = 4) => {
  if (value === null || value === undefined) {
    return 0n;
  }
  let str = String(value).trim();
  if (!str) {
    return 0n;
  }
  if (/[eE]/.test(str)) {
    str = expandScientific(str);
  }

  let sign = 1n;
  if (str.startsWith('-')) {
    sign = -1n;
    str = str.slice(1);
  } else if (str.startsWith('+')) {
    str = str.slice(1);
  }

  const parts = str.split('.');
  if (parts.length > 2) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const intStr = parts[0] || '0';
  const fracStr = parts[1] || '';
  if (!/^\d+$/.test(intStr) || (fracStr && !/^\d+$/.test(fracStr))) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const scaleFactor = 10n ** BigInt(scaleDigits);
  const intVal = BigInt(intStr) * scaleFactor;

  if (fracStr.length <= scaleDigits) {
    const paddedFrac = fracStr.padEnd(scaleDigits, '0');
    return sign * (intVal + BigInt(paddedFrac || '0'));
  }

  const keptFrac = fracStr.slice(0, scaleDigits);
  const nextDigit = Number(fracStr[scaleDigits]);
  let fracVal = BigInt(keptFrac || '0');
  if (nextDigit >= 5) {
    fracVal += 1n;
  }
  return sign * (intVal + fracVal);
};

const formatScaled = (scaledValue, scaleDigits) => {
  const sign = scaledValue < 0n ? '-' : '';
  const abs = scaledValue < 0n ? -scaledValue : scaledValue;
  const scaleFactor = 10n ** BigInt(scaleDigits);
  const whole = abs / scaleFactor;
  const frac = (abs % scaleFactor).toString().padStart(scaleDigits, '0');
  return `${sign}${whole}.${frac}`;
};

const computeLineCostCents = (quantity, unitPrice) => {
  const qty = BigInt(quantity);
  const unitPriceTenThousandths = parseScaledInt(unitPrice, 4);
  const rawTenThousandths = qty * unitPriceTenThousandths;
  return roundDiv(rawTenThousandths, 100n);
};

const formatCents = (centsBigInt) => formatScaled(centsBigInt, 2);

const formatUnitPrice = (unitPrice) => formatScaled(parseScaledInt(unitPrice, 4), 4);

const roundMoneyToNumber = (value) => {
  const cents = roundDiv(parseScaledInt(value, 4), 100n);
  return Number(formatCents(cents));
};

const computeAverageCostNumber = (totalCostValue, quantity) => {
  if (!quantity || quantity <= 0) {
    return 0;
  }
  const totalTenThousandths = parseScaledInt(totalCostValue, 4);
  const avgCents = roundDiv(totalTenThousandths, BigInt(quantity) * 100n);
  return Number(formatCents(avgCents));
};

module.exports = {
  parseScaledInt,
  formatScaled,
  computeLineCostCents,
  formatCents,
  formatUnitPrice,
  roundMoneyToNumber,
  computeAverageCostNumber,
};
