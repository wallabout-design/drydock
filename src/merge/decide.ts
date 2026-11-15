// Decides what happens to a content-edit pull request once its tests have run:
// merge it, or leave it for a person. Pure, so the decision is tested without
// GitHub; cli.ts gathers the facts and acts.
//
// The point of the check: the editor only ever changes files under `content/`
// (content-editing.md, "the two stores"), so a pull request on a content-edit
// branch that does anything else did not come from the editor and must not
// merge itself. Values are checked against the site's own declaration again
// here, because the branch is not trusted to have been through the editor.
import type { Content } from '../core/declare.js';
import { LIMITS } from '../core/limits.js';
import { isContentPath, ITEM_ID, TEXTS_PATH } from '../stores/git/files.js';

export interface PullFacts {
  /** The branch the pull request merges from, e.g. "content-edit/ada-example-org-1a2b3c4d/2026-11-10". */
  headBranch: string;
  /** "owner/name" of the repository that branch is in. */
  headRepository: string;
  /** "owner/name" of the repository the pull request is in. */
  repository: string;
  /** The branch it merges into. */
  baseBranch: string;
  /** Every file the pull request changes, as GitHub lists them. */
  files: { filename: string; status: string }[];
  /** The text of each changed file at the tip of the branch; null when it is not there. */
  headFiles: Readonly<Record<string, string | null>>;
  /** How many item files each list has at the tip of the branch. */
  itemCounts: Readonly<Record<string, number>>;
  /** How the `test` check ended: "success", "failure", "missing"… */
  conclusion: string;
}

export interface CheckConfig {
  /** The branch the site deploys from; a pull request into any other is left for a person. */
  base: string;
  /** What an editor's branch names start with, e.g. "content-edit/". */
  branchPrefix: string;
}

export type Verdict =
  | { action: 'ignore' }
  | { action: 'merge'; changed: string[] }
  | { action: 'needs-review'; reasons: string[] };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Equal as JSON, whatever the order of an object's keys. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  }
  return a === b;
}

const name = (path: string): string => `\`${path.replace(/`/g, '')}\``;

function parse(path: string, source: string | null, reasons: string[]): Record<string, unknown> | null {
  if (source === null) {
    reasons.push(`${name(path)} could not be read at the tip of the branch`);
    return null;
  }
  try {
    const json: unknown = JSON.parse(source);
    if (isObject(json)) return json;
  } catch {
    // reported below
  }
  reasons.push(`${name(path)} is not a JSON object`);
  return null;
}

export function decide(facts: PullFacts, content: Content, config: CheckConfig): Verdict {
  if (!facts.headBranch.startsWith(config.branchPrefix)) return { action: 'ignore' };

  const reasons: string[] = [];
  if (facts.headRepository.toLowerCase() !== facts.repository.toLowerCase()) reasons.push('the branch is in another repository (a fork)');
  if (facts.baseBranch !== config.base) reasons.push(`it merges into \`${facts.baseBranch}\`, not \`${config.base}\``);
  if (facts.files.length === 0) reasons.push('it changes no files');

  const outside = facts.files.filter(({ filename }) => !isContentPath(filename)).map(({ filename }) => filename);
  if (outside.length > 0) {
    const shown = outside.slice(0, 5).map(name).join(', ');
    reasons.push(`it changes files outside \`content/\`: ${shown}${outside.length > 5 ? ` and ${outside.length - 5} more` : ''}`);
  }

  const changed: string[] = [];
  const lists = new Set<string>();
  for (const { filename, status } of facts.files) {
    if (!isContentPath(filename)) continue;
    if (status !== 'added' && status !== 'modified' && status !== 'removed') {
      reasons.push(`${name(filename)} was ${status}, not edited`);
      continue;
    }
    const item = /^content\/([^/]+)\/([^/]+)\.json$/.exec(filename);
    const isTexts = filename === TEXTS_PATH;
    if (!isTexts && !(item && content.lists.has(item[1] as string) && ITEM_ID.test(item[2] as string))) {
      reasons.push(`${name(filename)} is not a texts file or an item of a declared list`);
      continue;
    }
    if (status === 'removed') {
      // Deleting an item, or every edited text, is what the editor does for a remove or a revert.
      if (item) lists.add(item[1] as string);
      changed.push(filename);
      continue;
    }

    const json = parse(filename, facts.headFiles[filename] ?? null, reasons);
    if (json === null) continue;
    changed.push(filename);

    if (isTexts) {
      for (const [key, value] of Object.entries(json)) {
        if (!content.texts.has(key)) {
          reasons.push(`${name(TEXTS_PATH)} has the key \`${key.replace(/`/g, '')}\`, which the site does not declare`);
          continue;
        }
        const check = content.validateText(key, value);
        if (!check.ok) reasons.push(`the text \`${key}\` fails the rules: ${check.problems.map((p) => p.message).join(' ')}`);
        else if (check.text !== value) reasons.push(`the text \`${key}\` is not in its cleaned form`);
      }
      continue;
    }

    const [, list] = item as RegExpExecArray;
    lists.add(list as string);
    const { position, ...fields } = json;
    if (position !== undefined) {
      if (content.lists.get(list as string)?.sort !== 'hand') reasons.push(`${name(filename)} has a position, but the list is not sorted by hand`);
      else if (!Number.isSafeInteger(position) || (position as number) < 1) reasons.push(`${name(filename)} has a position that is not a whole number above 0`);
    }
    const check = content.validateItem(list as string, fields);
    if (!check.ok) reasons.push(`${name(filename)} fails the rules: ${check.problems.map((p) => p.message).join(' ')}`);
    else if (!same(check.values, fields)) reasons.push(`${name(filename)} is not in its cleaned form`);
    else if (new TextEncoder().encode(facts.headFiles[filename] as string).length > LIMITS.itemBytes + 1024) reasons.push(`${name(filename)} is too big`);
  }

  for (const list of lists) {
    const most = content.lists.get(list)?.maxItems ?? LIMITS.maxItems.default;
    const count = facts.itemCounts[list] ?? 0;
    if (count > most) reasons.push(`the list \`${list}\` would have ${count} items; the most is ${most}`);
  }

  // Only said when everything else is fine: then the tests are the one thing in the way.
  if (reasons.length === 0 && facts.conclusion !== 'success') reasons.push(`the tests did not pass (${facts.conclusion})`);

  return reasons.length > 0 ? { action: 'needs-review', reasons } : { action: 'merge', changed };
}
