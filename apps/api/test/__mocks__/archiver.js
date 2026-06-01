/**
 * archiver v8 ESM mock for Jest.
 * Replaces the ESM-only archiver package with a CJS-compatible mock.
 */
const { EventEmitter } = require('events');

class ZipArchive extends EventEmitter {
  constructor() { super(); }
  pipe() { return this; }
  append() { return this; }
  finalize() {
    process.nextTick(() => this.emit('close'));
    return this;
  }
}

module.exports = { ZipArchive };
