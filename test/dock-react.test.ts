// The React component's markup (server render, no browser). Its behaviour is initDock's, covered by e2e/dock.e2e.ts.
import { test, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dock } from '../src/dock/react.js';

test('renders an empty element the dock fills after mount', () => {
  expect(renderToStaticMarkup(createElement(Dock, { siteId: 'rr', className: 'dock' }))).toBe('<div class="dock" data-dock-root=""></div>');
});
