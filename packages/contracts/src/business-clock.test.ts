import {describe,it,expect} from 'vitest';
import {addBusinessSeconds,businessSecondsBetween} from './business-clock';
const dubai={timezone:'Asia/Dubai',weekdays:[1,2,3,4,5],startMinute:540,endMinute:1020,holidays:['2026-10-12']};
describe('business calendar clock',()=>{
 it('skips weekends and holidays instead of silently measuring elapsed hours',()=>{const start=new Date('2026-10-09T12:00:00Z');const end=addBusinessSeconds(start,7200,dubai);expect(end.toISOString()).toBe('2026-10-13T06:00:00.000Z');expect(businessSecondsBetween(start,end,dubai)).toBe(7200);});
 it('starts outside-hours work at the next interval and handles fractional remaining seconds',()=>{expect(addBusinessSeconds(new Date('2026-10-13T01:00:00Z'),60.5,dubai).toISOString()).toBe('2026-10-13T05:01:00.500Z');});
 it('respects daylight-saving offset changes across a weekend',()=>{const c={...dubai,timezone:'America/New_York',holidays:[]};const start=new Date('2026-10-30T20:00:00Z');const end=addBusinessSeconds(start,7200,c);expect(end.toISOString()).toBe('2026-11-02T15:00:00.000Z');expect(businessSecondsBetween(start,end,c)).toBe(7200);});
 it('refuses invalid inputs and returns zero for a reversed interval',()=>{expect(()=>addBusinessSeconds(new Date(),-1,dubai)).toThrow();expect(businessSecondsBetween(new Date('2026-10-13'),new Date('2026-10-12'),dubai)).toBe(0);});
});
