// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input) returns exactly
// csv-reader's answer {columns, rows, errors} for every input {text, header}, read once, left to right.
//
// The reference reads one character at a time and builds every field a character at a time. This reader keeps
// the same reading, line for line and error for error, but skips ahead with indexOf: most records hold no quote
// and no stray CR, so a whole record is cut out at its line break and split on commas by the engine; only a
// record that holds a quote or a stray CR is walked field by field, and only a field that holds a stray CR is
// walked a segment at a time. Four cached cursors (the next comma, LF, CR and quote at or after the read
// position) keep every scan bounded: each cursor only ever moves forward, so all of them together scan the text
// a constant number of times. Nothing is kept from one call to the next.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const N = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The next comma, LF, CR and quote at or after pos (-1: not looked up yet, Infinity: none left). A cursor
  // stays valid while pos stays at or before it, so a lookup only ever scans forward.
  let nc = -1;
  let nl = -1;
  let nr = -1;
  let nq = -1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The unquoted reader's result, shared so no object is built per field.
  let uValue = '';
  let uEnded = END;
  let uAdded = 0;

  // The quoted reader's result, shared the same way.
  let qValue = '';
  let qEnded = END;

  // The quoted field's segments, gathered until the field is whole.
  let segParts = null;
  let segValue = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  function addSeg(s) {
    if (segParts !== null) segParts.push(s);
    else if (segValue === null) segValue = s;
    else {
      segParts = [segValue, s];
      segValue = null;
    }
  }

  function takeSegs() {
    const v = segParts !== null ? segParts.join('') : (segValue ?? '');
    segParts = null;
    segValue = null;
    return v;
  }

  // The unquoted field from `start`, with `prefix` already kept, when a stray CR stands before its end: the
  // field is walked a segment at a time, each stray CR dropped with its error.
  function unquotedSlow(start, prefix) {
    const parts = prefix === '' ? [] : [prefix];
    let added = 0;
    let p = start;
    for (;;) {
      const r = text.indexOf('\r', p);
      const c = text.indexOf(',', p);
      const l = text.indexOf('\n', p);
      const dr = r < 0 ? Infinity : r;
      const dc = c < 0 ? Infinity : c;
      const dl = l < 0 ? Infinity : l;
      if (dr < dc && dr < dl) {
        if (dr + 1 === dl) {
          // A CRLF: the field ends here.
          const seg = text.slice(p, dr);
          added += seg.length;
          parts.push(seg);
          pos = dl + 1;
          line += 1;
          uEnded = LINE_BREAK;
          break;
        }
        const seg = text.slice(p, dr);
        added += seg.length;
        parts.push(seg);
        error('stray_cr');
        p = dr + 1;
        continue;
      }
      if (dc < dl) {
        const seg = text.slice(p, dc);
        added += seg.length;
        parts.push(seg);
        pos = dc + 1;
        uEnded = COMMA;
        break;
      }
      if (dl < Infinity) {
        const seg = text.slice(p, dl);
        added += seg.length;
        parts.push(seg);
        pos = dl + 1;
        line += 1;
        uEnded = LINE_BREAK;
        break;
      }
      const seg = text.slice(p);
      added += seg.length;
      parts.push(seg);
      pos = N;
      uEnded = END;
      break;
    }
    uValue = parts.join('');
    uAdded = added;
  }

  // Reads an unquoted field from pos, starting from `prefix` ('' for a plain field, the quoted value for junk
  // after a closing quote, '"' for a quote that never closes). Sets uValue, uEnded and uAdded (the characters
  // kept). A CR not followed by LF is dropped with a stray_cr error; the field ends at a comma, a line break
  // (LF or CRLF) or the end of the text.
  function readUnquoted(prefix) {
    if (nc < pos) {
      nc = text.indexOf(',', pos);
      if (nc < 0) nc = Infinity;
    }
    if (nl < pos) {
      nl = text.indexOf('\n', pos);
      if (nl < 0) nl = Infinity;
    }
    if (nr < pos) {
      nr = text.indexOf('\r', pos);
      if (nr < 0) nr = Infinity;
    }
    const start = pos;
    if (nc < nl) {
      // The comma comes first: any CR before it is a stray one.
      if (nr < nc) {
        unquotedSlow(start, prefix);
        return;
      }
      uValue = prefix === '' ? text.slice(start, nc) : prefix + text.slice(start, nc);
      uAdded = nc - start;
      pos = nc + 1;
      uEnded = COMMA;
      return;
    }
    if (nl < Infinity) {
      if (nr === nl - 1) {
        // A CRLF: the field ends before the CR.
        uValue = prefix === '' ? text.slice(start, nr) : prefix + text.slice(start, nr);
        uAdded = nr - start;
        pos = nl + 1;
        line += 1;
        uEnded = LINE_BREAK;
        return;
      }
      if (nr < nl) {
        unquotedSlow(start, prefix);
        return;
      }
      uValue = prefix === '' ? text.slice(start, nl) : prefix + text.slice(start, nl);
      uAdded = nl - start;
      pos = nl + 1;
      line += 1;
      uEnded = LINE_BREAK;
      return;
    }
    if (nr < Infinity) {
      unquotedSlow(start, prefix);
      return;
    }
    uValue = prefix === '' ? text.slice(start) : prefix + text.slice(start);
    uAdded = N - start;
    pos = N;
    uEnded = END;
  }

  // Reads the quoted field whose opening quote is at pos. Sets qValue and qEnded. A quote that never closes is
  // a literal character and the text after it is read again as unquoted; what follows a closing quote, up to the
  // next comma or line break, is appended as it stands, with a quote_junk error when anything was kept.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let closed = false;
    while (true) {
      if (nq < pos) {
        nq = text.indexOf('"', pos);
        if (nq < 0) nq = Infinity;
      }
      if (nq === Infinity) break;
      const q = nq;
      if (nl < pos) {
        nl = text.indexOf('\n', pos);
        if (nl < 0) nl = Infinity;
      }
      if (nr < pos) {
        nr = text.indexOf('\r', pos);
        if (nr < 0) nr = Infinity;
      }
      if (nl < q || nr < q) {
        // A line break stands inside the quotes: each CRLF or lone CR in it is one LF, and the line count
        // moves with it.
        let segStart = pos;
        for (let i = pos; i < q; i++) {
          const cc = text.charCodeAt(i);
          if (cc === 13) {
            addSeg(text.slice(segStart, i));
            addSeg('\n');
            line += 1;
            if (text.charCodeAt(i + 1) === 10) i += 1;
            segStart = i + 1;
          } else if (cc === 10) {
            addSeg(text.slice(segStart, i));
            addSeg('\n');
            line += 1;
            segStart = i + 1;
          }
        }
        addSeg(text.slice(segStart, q));
        pos = q;
      } else {
        addSeg(text.slice(pos, q));
        pos = q;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote kept.
        addSeg('"');
        pos = q + 2;
        continue;
      }
      closed = true;
      pos = q + 1;
      break;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      // The read position moves back, so every cached cursor is dropped.
      pos = open + 1;
      line = openLine;
      nc = -1;
      nl = -1;
      nr = -1;
      nq = -1;
      segParts = null;
      segValue = null;
      error('unterminated_quote');
      readUnquoted('"');
      qValue = uValue;
      qEnded = uEnded;
      return;
    }
    const value = takeSegs();
    if (pos >= N) {
      qValue = value;
      qEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      qValue = value;
      qEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      qValue = value;
      qEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      qValue = value;
      qEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    readUnquoted(value);
    if (uAdded > 0) error('quote_junk');
    qValue = uValue;
    qEnded = uEnded;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < N) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= N) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    if (nl < pos) {
      nl = text.indexOf('\n', pos);
      if (nl < 0) nl = Infinity;
    }
    if (nr < pos) {
      nr = text.indexOf('\r', pos);
      if (nr < 0) nr = Infinity;
    }
    if (nq < pos) {
      nq = text.indexOf('"', pos);
      if (nq < 0) nq = Infinity;
    }

    let fields;
    let quotedLast = false;
    if (nl === Infinity) {
      // The last record, with no line break after it: it is plain when it holds no quote and no CR.
      if (nq === Infinity && nr === Infinity) {
        fields = text.slice(pos).split(',');
        pos = N;
      }
    } else if (nq >= nl && nr >= nl) {
      // No quote and no CR before the line break: the whole record at once.
      fields = text.slice(pos, nl).split(',');
      pos = nl + 1;
      line += 1;
    } else if (nr === nl - 1 && nq >= nl) {
      // A CRLF ends the record, and no quote stands before it.
      fields = text.slice(pos, nl - 1).split(',');
      pos = nl + 1;
      line += 1;
    }
    if (fields === undefined) {
      // The record holds a quote or a stray CR: walk it field by field.
      fields = [];
      let ended;
      do {
        if (text.charCodeAt(pos) === 34) {
          quotedLast = true;
          readQuoted();
          fields.push(qValue);
          ended = qEnded;
        } else {
          quotedLast = false;
          readUnquoted('');
          fields.push(uValue);
          ended = uEnded;
        }
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quotedLast) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
