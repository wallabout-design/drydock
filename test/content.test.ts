import { describe, expect, it } from 'vitest';
import { DeclarationError, defineContent, LIMITS, type ContentDeclaration, type Field, type ListDeclaration } from '../src/index.js';

const title: Field = { name: 'title', label: 'Title', type: 'text', required: true };
const list = (over: Partial<ListDeclaration> = {}): ListDeclaration => ({
  name: 'rooms',
  label: 'rooms',
  singular: 'room',
  titleField: 'title',
  fields: [title],
  sort: 'hand',
  ...over,
});
const text = (key: string, over = {}) => ({ key, default: 'hello', max: 20, label: 'A text', ...over });

// A site rule, as Rutland Reserve has one: the street address shows only with
// the guest code. The street here is made up.
const noStreet = {
  name: 'no-street',
  test: (t: string) => !/maple\s+street/i.test(t),
  message: 'Please don’t name the street: the address is only for guests.',
};

const content = defineContent({
  texts: [text('home.title', { max: 30 }), text('travel.train')],
  lists: [
    list({
      fields: [
        title,
        { name: 'about', label: 'About', type: 'longtext' },
        { name: 'site', label: 'Website', type: 'link' },
        { name: 'beds', label: 'Beds', type: 'number', min: 1, max: 12 },
        { name: 'opened', label: 'Opened', type: 'date' },
        { name: 'quiet', label: 'Quiet', type: 'checkbox' },
        { name: 'floor', label: 'Floor', type: 'choice', options: [{ value: 'up', label: 'Upstairs' }, { value: 'down', label: 'Downstairs' }] },
        { name: 'photo', label: 'Photo', type: 'image' },
        { name: 'logo', label: 'Logo', type: 'image', decorative: true },
      ],
    }),
  ],
  rules: [noStreet],
});
const item = (over: Record<string, unknown> = {}) => content.validateItem('rooms', { title: 'Blue room', ...over });
const kinds = (r: { problems: { kind: string }[] }) => r.problems.map((p) => p.kind);

describe('bad declarations', () => {
  const bad = (declaration: ContentDeclaration, message: RegExp) => {
    let error: unknown;
    try {
      defineContent(declaration);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DeclarationError);
    expect((error as Error).message).toMatch(message);
  };

  it('refuses a repeated text key', () => bad({ texts: [text('a.b'), text('a.b')] }, /"a\.b" is repeated/));
  it('refuses a key that is not <page>.<name>', () => {
    bad({ texts: [text('title')] }, /not a text key/);
    bad({ texts: [text('Home.Title')] }, /not a text key/);
  });
  it('refuses a text limit over the maximum, or none', () => {
    bad({ texts: [text('a.b', { max: LIMITS.keyedText + 1 })] }, /max must be/);
    bad({ texts: [text('a.b', { max: 0 })] }, /max must be/);
  });
  it('refuses default words that break the built-in checks or a site rule', () => {
    bad({ texts: [text('a.b', { default: 'x'.repeat(21) })] }, /default words/);
    bad({ texts: [text('a.b', { default: '<b>hi</b>' })] }, /default words/);
    bad({ texts: [text('a.b', { default: 'Maple Street' })], rules: [noStreet] }, /default words/);
  });
  it('refuses a list without a required text title field', () => {
    bad({ lists: [list({ titleField: 'nope' })] }, /not one of its fields/);
    bad({ lists: [list({ fields: [{ ...title, required: false }] })] }, /required text field/);
    bad({ lists: [list({ fields: [{ name: 'title', label: 'T', type: 'longtext', required: true }] })] }, /required text field/);
  });
  it('refuses repeated lists and fields', () => {
    bad({ lists: [list(), list()] }, /list "rooms" is repeated/);
    bad({ lists: [list({ fields: [title, title] })] }, /field "title" is repeated/);
  });
  it('refuses limits over the hard maximums', () => {
    bad({ lists: [list({ maxItems: 5001 })] }, /maxItems/);
    bad({ lists: [list({ fields: [{ ...title, maxLength: 1001 }] })] }, /maxLength/);
    bad({ lists: [list({ fields: [title, { name: 'n', label: 'N', type: 'longtext', maxLength: 10001 }] })] }, /maxLength/);
    const many = Array.from({ length: 40 }, (_, i): Field => ({ name: `f${i}`, label: 'F', type: 'text' }));
    bad({ lists: [list({ fields: [title, ...many] })] }, /41 fields/);
  });
  it('refuses a choice with no or repeated options, a bad sort, a bad number range', () => {
    bad({ lists: [list({ fields: [title, { name: 'c', label: 'C', type: 'choice', options: [] }] })] }, /needs options/);
    const o = { value: 'a', label: 'A' };
    bad({ lists: [list({ fields: [title, { name: 'c', label: 'C', type: 'choice', options: [o, o] }] })] }, /repeated/);
    bad({ lists: [list({ sort: { by: 'missing' } })] }, /sort must be/);
    bad({ lists: [list({ fields: [title, { name: 'q', label: 'Q', type: 'checkbox' }], sort: { by: 'q' } })] }, /can't sort/);
    bad({ lists: [list({ fields: [title, { name: 'n', label: 'N', type: 'number', min: 5, max: 1 }] })] }, /min is more than max/);
  });
  it('refuses a rule with no name, test or message, or a repeated rule', () => {
    bad({ rules: [{ ...noStreet, name: '' }] }, /needs a name/);
    bad({ rules: [{ ...noStreet, message: '' }] }, /needs a message/);
    bad({ rules: [noStreet, noStreet] }, /repeated/);
  });
  it('names every mistake at once', () => {
    try {
      defineContent({ texts: [text('x'), text('a.b'), text('a.b')] });
    } catch (e) {
      expect((e as DeclarationError).problems).toHaveLength(2);
    }
  });
  it('accepts an empty declaration', () => {
    expect(defineContent({}).texts.size).toBe(0);
  });
});

describe('keyed texts', () => {
  it('cleans and accepts a text', () => {
    expect(content.validateText('home.title', '  out of Penn\n at\t2:19pm \r\n')).toEqual({ ok: true, text: 'out of Penn at 2:19pm', problems: [] });
    expect(content.validateText('home.title', 'a\u{A0}\u{A0}b').text).toBe('a b');
    expect(content.validateText('home.title', 'a\u{0}b\u{2028}c\u{200B}d').text).toBe('a b cd');
  });
  it('refuses an unknown key and a non-string without throwing', () => {
    expect(kinds(content.validateText('nope.key', 'x'))).toEqual(['unknown']);
    expect(kinds(content.validateText('travel.train', 5))).toEqual(['type']);
  });
  it('refuses empty text and text with nothing visible', () => {
    for (const raw of ['', '  \n ', '\u{200B}', '\u{200B} \u{FEFF}']) {
      const check = content.validateText('travel.train', raw);
      expect(kinds(check), JSON.stringify(raw)).toEqual(['empty']);
      expect(check.problems[0]!.message).toMatch(/can’t be left empty/);
    }
  });
  it('refuses text over its own limit, counting characters not UTF-16 units, and not one over', () => {
    expect(content.validateText('travel.train', 'x'.repeat(20)).ok).toBe(true);
    const over = content.validateText('travel.train', 'x'.repeat(21));
    expect(kinds(over)).toEqual(['too-long']);
    expect(over.problems[0]!.message).toMatch(/21 characters.*fits 20/);
    expect(content.validateText('travel.train', '\u{1F682}'.repeat(20)).ok).toBe(true);
    expect(content.validateText('travel.train', '\u{1F682}'.repeat(21)).ok).toBe(false);
  });
  it('counts a letter and its accent as one character after joining', () => {
    expect([...content.validateText('travel.train', 'cafe\u{301}').text]).toHaveLength(4);
  });
  it('refuses markup but not a lone less-than sign', () => {
    for (const raw of ['<b>bold</b>', 'hi <script>', 'a <!-- b', '< /p>']) {
      expect(kinds(content.validateText('travel.train', raw)), raw).toEqual(['markup']);
    }
    expect(content.validateText('travel.train', '2 < 3 & 5 > 4').ok).toBe(true);
  });
  it('refuses more than four combining marks in a row, accepts four', () => {
    const marks = (n: number) => `a${'\u{301}'.repeat(n + 1)}`;
    expect(kinds(content.validateText('travel.train', marks(5)))).toEqual(['stacked-marks']);
    expect(content.validateText('travel.train', marks(4)).ok).toBe(true);
  });
  it('applies a site rule and returns its message and name', () => {
    expect(content.validateText('home.title', 'turn onto Maple Street')).toMatchObject({
      ok: false,
      problems: [{ field: 'home.title', kind: 'rule', rule: 'no-street', message: noStreet.message }],
    });
    expect(content.validateText('home.title', 'turn onto Maple\u{200B} Street').ok).toBe(false);
  });
  it('gives a rule the context', () => {
    const seen: unknown[] = [];
    const c = defineContent({
      texts: [text('a.b', { label: 'Intro' })],
      lists: [list()],
      rules: [{ name: 'spy', test: (_t, context) => (seen.push(context), true), message: 'x' }],
    });
    c.validateText('a.b', 'fine');
    c.validateItem('rooms', { title: 'Hi' });
    expect(seen.slice(-2)).toEqual([{ key: 'a.b', label: 'Intro' }, { list: 'rooms', field: 'title', label: 'Title' }]);
  });
});

// Invisible characters, as pasted from Word or Google Docs (ported from Rutland Reserve's cases).
const invisible: [string, string][] = [
  ['zero-width space', '\u{200B}'],
  ['zero-width non-joiner', '\u{200C}'],
  ['zero-width joiner', '\u{200D}'],
  ['left-to-right mark', '\u{200E}'],
  ['right-to-left mark', '\u{200F}'],
  ['left-to-right embedding', '\u{202A}'],
  ['right-to-left override', '\u{202E}'],
  ['word joiner', '\u{2060}'],
  ['invisible plus', '\u{2064}'],
  ['left-to-right isolate', '\u{2066}'],
  ['pop directional isolate', '\u{2069}'],
  ['byte order mark', '\u{FEFF}'],
  ['soft hyphen', '\u{AD}'],
  ['Mongolian vowel separator', '\u{180E}'],
  ['tag A', '\u{E0041}'],
  ['cancel tag', '\u{E007F}'],
  ['variation selector 16', '\u{FE0F}'],
  ['variation selector 256', '\u{E01EF}'],
  ['Hangul filler', '\u{3164}'],
  ['Hangul choseong filler', '\u{115F}'],
  ['Hangul jungseong filler', '\u{1160}'],
  ['halfwidth Hangul filler', '\u{FFA0}'],
  ['braille blank', '\u{2800}'],
];
const spaceLike = ['\u{3164}', '\u{115F}', '\u{1160}', '\u{FFA0}', '\u{2800}'];

describe.each(invisible)('invisible character: %s', (_name, ch) => {
  it('alone is empty, in a text and in a required field', () => {
    for (const raw of [ch, ch.repeat(3), ` ${ch} `, `${ch} ${ch}`]) {
      expect(kinds(content.validateText('travel.train', raw)), JSON.stringify(raw)).toEqual(['empty']);
      expect(kinds(item({ title: raw })), JSON.stringify(raw)).toEqual(['empty']);
    }
  });
  it('is removed inside a word, or becomes a space if it looks like one', () => {
    expect(content.validateText('travel.train', `Ho${ch}me`).text).toBe(spaceLike.includes(ch) ? 'Ho me' : 'Home');
    expect(content.validateText('travel.train', `${ch}Home${ch}`).text).toBe('Home');
    expect(item({ about: `Ho${ch}me` }).values.about).toBe(spaceLike.includes(ch) ? 'Ho me' : 'Home');
  });
});

describe('direction and emoji', () => {
  it('drops direction overrides so text shows in the order typed', () => {
    expect(content.validateText('travel.train', '\u{202E}Home sweet').text).toBe('Home sweet');
    expect(content.validateText('travel.train', '\u{2067}Home\u{2069} sweet').text).toBe('Home sweet');
  });
  it('keeps one emoji or text selector after an emoji, and joiners between emoji', () => {
    const t = (s: string) => content.validateText('travel.train', s).text;
    expect(t('\u{2764}\u{FE0F}')).toBe('\u{2764}\u{FE0F}');
    expect(t('\u{2764}\u{FE0F}\u{FE0F}\u{FE00}')).toBe('\u{2764}\u{FE0F}');
    expect(t('\u{2764}\u{E0100}')).toBe('\u{2764}');
    expect(t('caf\u{E9} \u{1F682}, 2:19pm')).toBe('caf\u{E9} \u{1F682}, 2:19pm');
    expect(t('\u{1F468}\u{200D}\u{1F469}')).toBe('\u{1F468}\u{200D}\u{1F469}');
    expect(t('a\u{200D}b')).toBe('ab');
  });
});

describe('item fields', () => {
  it('accepts a full item and returns it cleaned', () => {
    const full = item({
      about: 'Line one\r\n\r\n\r\n\r\nLine two  \n\tthree',
      site: 'https://example.com/a?b=1',
      beds: '3',
      opened: '2026-03-14',
      quiet: true,
      floor: 'up',
      photo: { src: '/media/blue.jpg', alt: 'A blue room' },
      logo: { src: 'https://example.com/l.svg', alt: 'ignored' },
    });
    expect(full).toEqual({
      ok: true,
      problems: [],
      values: {
        title: 'Blue room',
        about: 'Line one\n\nLine two\nthree',
        site: 'https://example.com/a?b=1',
        beds: 3,
        opened: '2026-03-14',
        quiet: true,
        floor: 'up',
        photo: { src: '/media/blue.jpg', alt: 'A blue room' },
        logo: { src: 'https://example.com/l.svg', alt: '' },
      },
    });
  });
  it('needs only the required fields; a tick box is false when left out', () => {
    expect(item()).toEqual({ ok: true, problems: [], values: { title: 'Blue room', quiet: false } });
  });
  it('reports a missing or blank required field in plain words', () => {
    for (const given of [{}, { title: '' }, { title: '   ' }, { title: null }]) {
      const check = content.validateItem('rooms', given);
      expect(check.problems).toEqual([{ field: 'title', kind: 'empty', message: 'Title is needed.' }]);
    }
  });
  it('drops optional fields left blank', () => {
    expect(item({ about: ' ', site: '', beds: '', opened: '', floor: '', photo: '' }).values).toEqual({ title: 'Blue room', quiet: false });
  });
  it('reports every problem at once', () => {
    const check = item({ title: '', beds: 99, site: 'http://x.com', opened: 'soon' });
    expect(check.problems.map((p) => p.field).sort()).toEqual(['beds', 'opened', 'site', 'title']);
  });
  it('refuses a field the list does not declare, and anything but an object', () => {
    expect(kinds(item({ extra: 1 }))).toEqual(['unknown']);
    expect(kinds(content.validateItem('rooms', 'x'))).toEqual(['type']);
    expect(kinds(content.validateItem('rooms', [1]))).toEqual(['type']);
    expect(kinds(content.validateItem('nope', {}))).toEqual(['unknown']);
  });
  it('refuses an item over 16 KB as a whole', () => {
    const c = defineContent({
      lists: [list({ fields: [title, ...[0, 1, 2].map((i): Field => ({ name: `t${i}`, label: 'T', type: 'longtext', maxLength: 10000 }))] })],
    });
    const big = { title: 'x', t0: 'a'.repeat(6000), t1: 'b'.repeat(6000), t2: 'c'.repeat(6000) };
    expect(c.validateItem('rooms', big).problems).toMatchObject([{ field: '_item', kind: 'too-big' }]);
  });

  describe('text and long text', () => {
    it('defaults to 200 and 2,000 characters, counting characters not bytes', () => {
      expect(item({ title: 'x'.repeat(200) }).ok).toBe(true);
      expect(kinds(item({ title: 'x'.repeat(201) }))).toEqual(['too-long']);
      expect(item({ about: '\u{1F682}'.repeat(2000) }).ok).toBe(true);
      expect(kinds(item({ about: 'x'.repeat(2001) }))).toEqual(['too-long']);
    });
    it('honours maxLength up to the hard maximum', () => {
      const c = defineContent({ lists: [list({ fields: [{ ...title, maxLength: 1000 }, { name: 'a', label: 'A', type: 'longtext', maxLength: 10000 }] })] });
      expect(c.validateItem('rooms', { title: 'x'.repeat(1000), a: 'y'.repeat(10000) }).ok).toBe(true);
      expect(c.validateItem('rooms', { title: 'x'.repeat(1001) }).ok).toBe(false);
    });
    it('puts one-line text on one line and keeps line breaks in long text', () => {
      expect(item({ title: 'a\nb\tc' }).values.title).toBe('a b c');
      expect(item({ about: 'a\r\nb' }).values.about).toBe('a\nb');
    });
    it('refuses markup, stacked marks and a site rule in both', () => {
      expect(kinds(item({ about: '<b>x</b>' }))).toEqual(['markup']);
      expect(kinds(item({ title: 'a<script>' }))).toEqual(['markup']);
      expect(kinds(item({ about: `a${'\u{301}'.repeat(6)}` }))).toEqual(['stacked-marks']);
      expect(kinds(item({ about: 'Maple Street' }))).toEqual(['rule']);
    });
    it('refuses a value that is not a string', () => {
      expect(kinds(item({ about: 3 }))).toEqual(['type']);
    });
  });

  describe('link', () => {
    it('takes https only, normalised', () => {
      expect(item({ site: 'https://example.com' }).values.site).toBe('https://example.com/');
      for (const bad of ['http://example.com', 'example.com', 'javascript:alert(1)', 'mailto:a@b.co', 'https://', 'https://a b.com']) {
        expect(item({ site: bad }).ok, bad).toBe(false);
      }
    });
    it('refuses a user name or password and hidden characters', () => {
      expect(kinds(item({ site: 'https://me:pw@example.com' }))).toEqual(['format']);
      expect(kinds(item({ site: 'https://exam\u{200B}ple.com' }))).toEqual(['format']);
    });
    it('can allow other schemes', () => {
      const c = defineContent({ lists: [list({ fields: [title, { name: 'l', label: 'L', type: 'link', schemes: ['https', 'mailto'] }] })] });
      expect(c.validateItem('rooms', { title: 'x', l: 'mailto:a@example.com' }).ok).toBe(true);
      expect(c.validateItem('rooms', { title: 'x', l: 'http://a.com' }).ok).toBe(false);
    });
    it('refuses a very long address', () => {
      expect(kinds(item({ site: `https://example.com/${'a'.repeat(2000)}` }))).toEqual(['too-long']);
    });
  });

  describe('number', () => {
    it('takes whole numbers, as numbers or text, within min and max', () => {
      expect(item({ beds: 1 }).values.beds).toBe(1);
      expect(item({ beds: ' 12 ' }).values.beds).toBe(12);
      expect(kinds(item({ beds: 0 }))).toEqual(['range']);
      expect(kinds(item({ beds: 13 }))).toEqual(['range']);
      expect(item({ beds: 13 }).problems[0]!.message).toBe('Beds must be from 1 to 12.');
    });
    it('refuses fractions, text, NaN and Infinity', () => {
      expect(kinds(item({ beds: 2.5 }))).toEqual(['format']);
      expect(kinds(item({ beds: '2.5' }))).toEqual(['format']);
      for (const bad of ['two', NaN, Infinity, true]) expect(kinds(item({ beds: bad })), String(bad)).toEqual(['type']);
    });
    it('says "or more" and "or less" for one bound', () => {
      const c = defineContent({ lists: [list({ fields: [title, { name: 'n', label: 'N', type: 'number', min: 0 }, { name: 'm', label: 'M', type: 'number', max: 5 }] })] });
      expect(c.validateItem('rooms', { title: 'x', n: -1 }).problems[0]!.message).toBe('N must be 0 or more.');
      expect(c.validateItem('rooms', { title: 'x', m: 6 }).problems[0]!.message).toBe('M must be 5 or less.');
    });
  });

  describe('date', () => {
    it('takes a real calendar date', () => {
      expect(item({ opened: '2028-02-29' }).values.opened).toBe('2028-02-29');
      for (const bad of ['2026-02-31', '2026-13-01', '2027-02-29', '14/03/2026', '2026-3-14', 'soon']) {
        expect(kinds(item({ opened: bad })), bad).toEqual(['format']);
      }
      expect(kinds(item({ opened: 20260314 }))).toEqual(['type']);
    });
  });

  describe('tick box', () => {
    it('takes true or false only', () => {
      expect(item({ quiet: false }).values.quiet).toBe(false);
      expect(kinds(item({ quiet: 'yes' }))).toEqual(['type']);
    });
  });

  describe('choice', () => {
    it('takes one of the declared values only', () => {
      expect(item({ floor: 'down' }).values.floor).toBe('down');
      expect(kinds(item({ floor: 'roof' }))).toEqual(['format']);
      expect(kinds(item({ floor: 'Upstairs' }))).toEqual(['format']);
      expect(kinds(item({ floor: 1 }))).toEqual(['format']);
    });
  });

  describe('image', () => {
    it('takes an https address or a site path, with alt text', () => {
      expect(item({ photo: { src: 'https://example.com/a.jpg', alt: 'A  room\n' } }).values.photo).toEqual({ src: 'https://example.com/a.jpg', alt: 'A room' });
      expect(item({ photo: { src: '/img/a.jpg', alt: 'x' } }).ok).toBe(true);
    });
    it('refuses other addresses', () => {
      for (const src of ['http://example.com/a.jpg', 'data:image/png;base64,AAAA', '//example.com/a.jpg', 'img/a.jpg', '/a/../b.jpg', '/a b.jpg', 'https://u:p@example.com/a.jpg', '/a\\b.jpg', 'javascript:alert(1)']) {
        expect(kinds(item({ photo: { src, alt: 'x' } })), src).toEqual(['format']);
      }
    });
    it('needs alt text unless decorative', () => {
      expect(item({ photo: { src: '/a.jpg', alt: '' } }).problems).toMatchObject([{ field: 'photo.alt', kind: 'empty' }]);
      expect(item({ photo: { src: '/a.jpg' } }).ok).toBe(false);
      expect(item({ logo: { src: '/a.svg', alt: '' } }).values.logo).toEqual({ src: '/a.svg', alt: '' });
    });
    it('checks alt text like other text', () => {
      expect(kinds(item({ photo: { src: '/a.jpg', alt: '<b>x</b>' } }))).toEqual(['markup']);
      expect(kinds(item({ photo: { src: '/a.jpg', alt: 'x'.repeat(201) } }))).toEqual(['too-long']);
      expect(kinds(item({ photo: { src: '/a.jpg', alt: 'Maple Street' } }))).toEqual(['rule']);
    });
    it('refuses a value that is not an image', () => {
      expect(kinds(item({ photo: 5 }))).toEqual(['type']);
      expect(kinds(item({ photo: { src: 5, alt: 'x' } }))).toEqual(['type']);
      expect(kinds(item({ photo: { src: '', alt: 'x' } }))).toEqual(['empty']);
    });
  });
});
