const ALLOWED_FIELDS = ['commandId', 'tool', 'origin', 'outcome', 'approval'];

function assertEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError('Audit event must be an object');
  }
  for (const key of Object.keys(event)) {
    if (!ALLOWED_FIELDS.includes(key)) throw new TypeError(`Audit field is not allowed: ${key}`);
  }
  for (const field of ['commandId', 'tool', 'origin', 'outcome']) {
    if (typeof event[field] !== 'string' || event[field].length === 0 || event[field].length > 512) {
      throw new TypeError(`Invalid audit ${field}`);
    }
  }
  if (event.approval !== undefined && !['none', 'single', 'session', 'denied'].includes(event.approval)) {
    throw new TypeError('Invalid audit approval');
  }
}

export class AuditLog {
  #entries = [];
  #capacity;
  #now;

  constructor({ capacity = 200, now = Date.now } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new TypeError('Invalid audit capacity');
    if (typeof now !== 'function') throw new TypeError('Invalid audit clock');
    this.#capacity = capacity;
    this.#now = now;
  }

  record(event) {
    assertEvent(event);
    const entry = Object.freeze({
      timestamp: this.#now(),
      commandId: event.commandId,
      tool: event.tool,
      origin: event.origin,
      outcome: event.outcome,
      ...(event.approval === undefined ? {} : { approval: event.approval }),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.#capacity) this.#entries.splice(0, this.#entries.length - this.#capacity);
    return entry;
  }

  list() {
    return [...this.#entries];
  }
}
