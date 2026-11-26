const ISO_8601_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|([+-]\d{2}):?(\d{2}))?)?$/i;

const INTEGER_STRING_REGEX = /^[+-]?\d+$/;
const DECIMAL_STRING_REGEX = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

const isValidIso8601 = (value) => {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  const match = ISO_8601_REGEX.exec(trimmed);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = match[4] !== undefined ? Number(match[4]) : 0;
  const minute = match[5] !== undefined ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;

  if (month < 1 || month > 12) return false;
  const maxDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDays) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (match[7] !== undefined && match[8] !== undefined) {
    const offsetHour = Math.abs(Number(match[7]));
    const offsetMin = Number(match[8]);
    if (offsetHour > 23 || offsetMin > 59) return false;
  }

  return !Number.isNaN(Date.parse(trimmed));
};

const parseStrictPositiveInt = (raw) => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isSafeInteger(raw) || raw <= 0) {
      return null;
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || !INTEGER_STRING_REGEX.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }
  return null;
};

const parseStrictPositiveNumber = (raw) => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) {
      return null;
    }
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || !DECIMAL_STRING_REGEX.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }
  return null;
};

/**
 * Shared validator for inventory events used by POST /api/event,
 * POST /api/simulate, and the Kafka consumer.
 *
 * Returns:
 *   { valid: true, value: { product_id, event_type, quantity, unit_price?, timestamp } }
 * or
 *   { valid: false, message: 'Validation failed', errors: [{ field, message }] }
 */
const validateInventoryEvent = (payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      valid: false,
      message: 'Validation failed',
      errors: [{ field: 'payload', message: 'Event payload must be a JSON object' }],
    };
  }

  const errors = [];

  // product_id: required, string, trimmed, 1-50 chars
  let normalizedProductId = null;
  if (typeof payload.product_id !== 'string') {
    errors.push({
      field: 'product_id',
      message: 'product_id is required and must be a string',
    });
  } else {
    normalizedProductId = payload.product_id.trim();
    if (normalizedProductId.length < 1 || normalizedProductId.length > 50) {
      errors.push({
        field: 'product_id',
        message: 'product_id must be between 1 and 50 characters after trimming',
      });
    }
  }

  // event_type: required, exactly "purchase" or "sale" (case-insensitive, normalised to lowercase)
  let normalizedEventType = null;
  if (typeof payload.event_type !== 'string') {
    errors.push({
      field: 'event_type',
      message: 'event_type is required and must be "purchase" or "sale"',
    });
  } else {
    const lower = payload.event_type.toLowerCase();
    if (lower !== 'purchase' && lower !== 'sale') {
      errors.push({
        field: 'event_type',
        message: 'event_type must be exactly "purchase" or "sale"',
      });
    } else {
      normalizedEventType = lower;
    }
  }

  // quantity: required, integer, greater than 0
  const parsedQuantity = parseStrictPositiveInt(payload.quantity);
  if (parsedQuantity === null) {
    errors.push({
      field: 'quantity',
      message: 'quantity is required and must be an integer greater than 0',
    });
  }

  // unit_price: required for purchase (> 0), ignored for sale
  let parsedUnitPrice;
  if (normalizedEventType === 'purchase') {
    parsedUnitPrice = parseStrictPositiveNumber(payload.unit_price);
    if (parsedUnitPrice === null) {
      errors.push({
        field: 'unit_price',
        message: 'unit_price is required for purchase events and must be a number greater than 0',
      });
    }
  }

  // timestamp: optional ISO 8601 date; default to current time if missing
  let normalizedTimestamp;
  if (payload.timestamp === undefined || payload.timestamp === null) {
    normalizedTimestamp = new Date().toISOString();
  } else if (!isValidIso8601(payload.timestamp)) {
    errors.push({
      field: 'timestamp',
      message: 'timestamp must be a valid ISO 8601 date string',
    });
  } else {
    normalizedTimestamp = new Date(payload.timestamp.trim()).toISOString();
  }

  if (errors.length > 0) {
    return {
      valid: false,
      message: 'Validation failed',
      errors,
    };
  }

  const value = {
    product_id: normalizedProductId,
    event_type: normalizedEventType,
    quantity: parsedQuantity,
    timestamp: normalizedTimestamp,
  };

  if (normalizedEventType === 'purchase') {
    value.unit_price = parsedUnitPrice;
  }

  return {
    valid: true,
    value,
  };
};

module.exports = {
  validateInventoryEvent,
  isValidIso8601,
};
