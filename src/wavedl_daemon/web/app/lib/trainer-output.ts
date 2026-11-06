import type { TrainerOutputSnapshot } from '~~/types/trainer-output';

const MAX_LINES = 5000;

// UTF-16 strings use up to two bytes per code unit: keep roughly 1 MiB.
const MAX_CHARACTERS = 512 * 1024;

type EscapeState = 'text' | 'escape' | 'intermediate' | 'csi' | 'control' | 'controlEscape';

/** Streaming plain-text terminal view, not a terminal emulator or HTML renderer. */
export class TrainerOutputBuffer {
  #lines: string[] = [];
  #line = '';
  #carriageReturn = false;
  #escape: EscapeState = 'text';
  #omitted = false;

  constructor(omitted = false) {
    this.#omitted = omitted;
  }

  append(text: string): void {
    for (const character of text) {
      if (this.#stripEscape(character)) continue;

      if (character === '\n') {
        this.#lines.push(this.#line);
        this.#line = '';
        this.#carriageReturn = false;
      } else if (character === '\r') {
        // Defer the overwrite: a following LF (even in another chunk) is CRLF.
        this.#carriageReturn = true;
      } else if (character === '\t' || (character >= ' ' && character !== '\x7f')) {
        if (this.#carriageReturn) {
          this.#line = '';
          this.#carriageReturn = false;
        }

        this.#line += character;
      }
    }

    this.#trim();
  }

  snapshot(): TrainerOutputSnapshot {
    return {
      text: this.#lines.length > 0 ? `${this.#lines.join('\n')}\n${this.#line}` : this.#line,
      omitted: this.#omitted,
    };
  }

  #stripEscape(character: string): boolean {
    if (this.#escape === 'control' || this.#escape === 'controlEscape') {
      if (
        character === '\x07' ||
        character === '\x9c' ||
        (this.#escape === 'controlEscape' && character === '\\')
      )
        this.#escape = 'text';
      else this.#escape = character === '\x1b' ? 'controlEscape' : 'control';

      return true;
    }

    if (character === '\x1b') {
      this.#escape = 'escape';

      return true;
    }

    if (this.#escape === 'escape') {
      if (character === '[') this.#escape = 'csi';
      else if (']PX^_'.includes(character)) this.#escape = 'control';
      else this.#escape = character >= ' ' && character <= '/' ? 'intermediate' : 'text';

      return true;
    }

    if (this.#escape === 'csi' || this.#escape === 'intermediate') {
      const firstFinal = this.#escape === 'csi' ? '@' : '0';

      if (character >= firstFinal && character <= '~') this.#escape = 'text';

      return true;
    }

    if (character === '\x9b') this.#escape = 'csi';
    else if ('\x90\x98\x9d\x9e\x9f'.includes(character)) this.#escape = 'control';
    else return character >= '\x80' && character <= '\x9f';

    return true;
  }

  #trim(): void {
    let length = this.#lines.reduce((total, line) => total + line.length + 1, this.#line.length);
    let drop = 0;

    while (
      drop < this.#lines.length &&
      (this.#lines.length - drop + (this.#line.length > 0 ? 1 : 0) > MAX_LINES ||
        length > MAX_CHARACTERS)
    ) {
      length -= (this.#lines[drop]?.length ?? 0) + 1;
      drop++;
    }

    if (drop > 0) {
      this.#lines.splice(0, drop);
      this.#omitted = true;
    }

    if (this.#line.length > MAX_CHARACTERS) {
      this.#line = this.#line.slice(-MAX_CHARACTERS);
      // Do not leave half of a surrogate pair at the new start.
      const first = this.#line.charCodeAt(0);

      if (first >= 0xdc00 && first <= 0xdfff) this.#line = this.#line.slice(1);
      this.#omitted = true;
    }
  }
}
