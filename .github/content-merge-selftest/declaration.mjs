// The declaration the self-test of content-merge.yml checks against. The
// self-test treats this repository as a site: see
// .github/workflows/content-merge-selftest.yml.
import { defineContent } from '../../dist/index.js';

export const content = defineContent({
  texts: [{ key: 'home.title', default: 'Hello', max: 30, label: 'Title' }],
});
