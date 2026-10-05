import { describe, expect, it } from 'vitest';
import { LOCALES, messages, t, dir } from './index';
describe('localization', () => {
  it('every English key exists in every locale', () => { for (const l of LOCALES) expect(Object.keys(messages[l]).sort()).toEqual(Object.keys(messages.en).sort()); });
  it('arabic is rtl', () => { expect(dir('ar')).toBe('rtl'); expect(t('ar', 'nav.today')).toBe('اليوم'); });
});
