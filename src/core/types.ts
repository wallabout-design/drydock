// What a site declares, and what checking a value gives back. No framework,
// Worker or DOM types: this folder is plain TypeScript.

/** What a field holds. The limits are in `limits.ts`. */
export type FieldType = 'text' | 'longtext' | 'link' | 'number' | 'date' | 'checkbox' | 'choice' | 'image';

interface FieldBase {
  /** The name in the item's JSON: lowercase letters, digits and `-`, starting with a letter. */
  name: string;
  /** What staff see. */
  label: string;
  /** An empty required field is a problem. Tick boxes are never empty. */
  required?: boolean;
}

export interface TextField extends FieldBase {
  type: 'text';
  /** Characters, at most 1,000. Default 200. */
  maxLength?: number;
}
export interface LongTextField extends FieldBase {
  type: 'longtext';
  /** Characters, at most 10,000. Default 2,000. */
  maxLength?: number;
}
export interface LinkField extends FieldBase {
  type: 'link';
  /** Allowed schemes, without the colon. Default `['https']`. */
  schemes?: string[];
}
export interface NumberField extends FieldBase {
  type: 'number';
  min?: number;
  max?: number;
}
export interface DateField extends FieldBase {
  type: 'date';
}
export interface CheckboxField extends FieldBase {
  type: 'checkbox';
}
export interface ChoiceField extends FieldBase {
  type: 'choice';
  options: { value: string; label: string }[];
}
export interface ImageField extends FieldBase {
  type: 'image';
  /** The image is decoration: no alt text is asked for or kept. */
  decorative?: boolean;
  /** The shape the page shows, as `'1:1'` or `'16:10'`. Left out, the image keeps its own shape. */
  aspect?: string;
  /** The widths, in pixels, to make for the page: 1 to 4 whole numbers from 16 to 2,400, ascending. Default `[480, 960, 1600]`. */
  widths?: number[];
  /** The `sizes` attribute for the page's `<img>`, at most 200 characters. */
  sizes?: string;
  /** One larger width, up to 2,400, for a lightbox. Must be more than the widest of `widths`. */
  full?: number;
  /** The narrowest original that looks sharp, in pixels. The form warns below it; nothing is refused. */
  minWidth?: number;
}

export type Field = TextField | LongTextField | LinkField | NumberField | DateField | CheckboxField | ChoiceField | ImageField;

/** An image that is already online: an `https` address or a path on the site starting `/`, and alt text. */
export interface ImageAddress {
  src: string;
  alt: string;
}
/** The part of an original that is shown, in whole pixels of the original. */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** An uploaded image: where it is kept, alt text, the original's size and the part to show. */
export interface ImageUpload {
  /** `<yyyy>/<mm>/<22 to 32 letters, digits, - or _>`. */
  key: string;
  alt: string;
  /** The original's size in pixels. */
  width: number;
  height: number;
  /** Needed when the field has an `aspect`. */
  crop?: ImageCrop;
}
/** An image value is an address or an upload, never both. */
export type ImageValue = ImageAddress | ImageUpload;
export type FieldValue = string | number | boolean | ImageValue;
/** An item's fields, as stored. */
export type ItemValues = Record<string, FieldValue>;

export interface TextDeclaration {
  /** `<page>.<name>`, such as `home.hero.title`. Never changes once in use. */
  key: string;
  /** The words the site starts with. */
  default: string;
  /** The most characters, sized so the layout holds. At most 5,000. */
  max: number;
  /** What staff call it. */
  label: string;
}

export type Sort = 'hand' | { by: string; order?: 'asc' | 'desc' };

export interface ListDeclaration {
  /** In URLs: lowercase letters, digits and `-`. */
  name: string;
  /** What staff see for the list ("rooms"). */
  label: string;
  /** What staff see for one item ("room"). */
  singular: string;
  /** A required `text` field that names each item. */
  titleField: string;
  fields: Field[];
  /** `'hand'` (staff move items) or a field to sort by. */
  sort: Sort;
  /** Default 500, at most 5,000. */
  maxItems?: number;
}

/** Where a value being checked sits, so a rule can treat places differently. */
export interface RuleContext {
  /** A text's key, for a keyed text. */
  key?: string;
  /** The list and field, for an item's field. */
  list?: string;
  field?: string;
  /** What staff call the place. */
  label: string;
}

/** A site's own text rule. `test` is true when the text is fine. */
export interface Rule {
  name: string;
  test(text: string, context: RuleContext): boolean;
  /** What staff see when the text fails, in plain words. */
  message: string;
}

export interface ContentDeclaration {
  texts?: readonly TextDeclaration[];
  lists?: readonly ListDeclaration[];
  rules?: readonly Rule[];
}

export type ProblemKind =
  | 'unknown'
  | 'type'
  | 'empty'
  | 'too-long'
  | 'markup'
  | 'stacked-marks'
  | 'format'
  | 'range'
  | 'rule'
  | 'too-big';

/** Why a value was refused, in words staff can act on. */
export interface Problem {
  /** The field's name, the text's key, or `_item` for the whole item. */
  field: string;
  kind: ProblemKind;
  message: string;
  /** For `rule`: the rule's name. */
  rule?: string;
}

export interface TextCheck {
  ok: boolean;
  problems: Problem[];
  /** The text cleaned, or `''` when it could not be read as text. */
  text: string;
}
export interface ItemCheck {
  ok: boolean;
  problems: Problem[];
  /** The declared fields that have a value, cleaned. Tick boxes are always there. */
  values: ItemValues;
}
