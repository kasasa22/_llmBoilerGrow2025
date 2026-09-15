import { describe, expect, it } from 'vitest';

import { isThinContent } from '../src/tools/content.js';

describe('isThinContent', () => {
  it('flags an empty or script-only page', () => {
    expect(isThinContent('', 300)).toBe(true);
    expect(isThinContent('Loading… Please enable JavaScript to view this app.', 300)).toBe(true);
  });
  it('flags long but wordless output such as a base64 blob', () => {
    expect(isThinContent('A'.repeat(2000), 300)).toBe(true);
  });
  it('accepts a normal article', () => {
    const article = ('Server-Sent Events let a server push updates to a browser over one HTTP connection. ').repeat(8);
    expect(isThinContent(article, 300)).toBe(false);
  });
});
