import { describe, expect, it } from 'vitest';
import { cleanPageUrl, cleanRecent, MAX_RECENT, rememberUrl } from './urls';

describe('cleanPageUrl', () => {
  it('drops the APEX session id and keeps the rest', () => {
    expect(cleanPageUrl('https://h.example/ords/r/ws/app/page?session=12345&p=1')).toBe('https://h.example/ords/r/ws/app/page?p=1');
    expect(cleanPageUrl('https://h.example/ords/r/ws/app/page?SESSION=9')).toBe('https://h.example/ords/r/ws/app/page');
    expect(cleanPageUrl('https://h.example/x#top')).toBe('https://h.example/x#top');
  });

  it('refuses what is not a page to reopen', () => {
    expect(cleanPageUrl('chrome://newtab/')).toBeNull();
    expect(cleanPageUrl('about:blank')).toBeNull();
    expect(cleanPageUrl('not a url')).toBeNull();
  });
});

describe('rememberUrl', () => {
  it('puts the newest first, without repeats, and keeps a few', () => {
    let l: string[] = [];
    for (const u of ['a', 'b', 'c', 'b']) l = rememberUrl(l, `https://${u}/`);
    expect(l).toEqual(['https://b/', 'https://c/', 'https://a/']);
    for (let i = 0; i < 10; i++) l = rememberUrl(l, `https://x${i}/`);
    expect(l).toHaveLength(MAX_RECENT);
  });

  it('tolerates a broken saved value', () => {
    expect(rememberUrl('junk', 'https://a/')).toEqual(['https://a/']);
    expect(cleanRecent([1, 'https://a/', null])).toEqual(['https://a/']);
  });
});
