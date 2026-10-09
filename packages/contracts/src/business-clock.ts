import type { Calendar } from './work-control';
// Work in civil dates for the configured timezone. Translate each daily interval
// separately so weekends, holidays and daylight-saving changes are respected.
const DAY=86400000;
const parts=(date:Date,timezone:string)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
function civilDate(at:Date,tz:string){const p=parts(at,tz);return Date.UTC(p.year,p.month-1,p.day);}
function utcForCivil(day:number,minute:number,tz:string) {
 const civil=day+minute*60000;let at=civil;
 for(let i=0;i<4;i++){const p=parts(new Date(at),tz),local=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);const delta=civil-local;if(!delta)return at;at+=delta;}
 throw new Error('Working interval intersects a nonexistent or ambiguous local time; adjust calendar hours.');
}
function interval(day:number,c:Calendar):[number,number]|null{
 const d=new Date(day),weekday=d.getUTCDay()||7;if(!c.weekdays.includes(weekday)||c.holidays.includes(d.toISOString().slice(0,10)))return null;
 return [utcForCivil(day,c.startMinute,c.timezone),utcForCivil(day,c.endMinute,c.timezone)];
}
export function addBusinessSeconds(start:Date,seconds:number,c:Calendar):Date {
 if(!Number.isFinite(start.getTime())||seconds<0||!Number.isFinite(seconds))throw new Error('Invalid business clock input');
 if(seconds===0)return new Date(start);
 let left=seconds*1000,day=civilDate(start,c.timezone);
 for(let n=0;n<730;n++,day+=DAY){const w=interval(day,c);if(!w)continue;const from=Math.max(start.getTime(),w[0]);const available=Math.max(0,w[1]-from);if(left<=available)return new Date(from+left);left-=available;}
 throw new Error('Calendar cannot satisfy the SLA within two years.');
}
export function businessSecondsBetween(start:Date,end:Date,c:Calendar):number {
 if(end<=start)return 0;let total=0,day=civilDate(start,c.timezone);const last=civilDate(end,c.timezone);
 if(last-day>730*DAY)throw new Error('Business clock range exceeds two years.');
 for(;day<=last;day+=DAY){const w=interval(day,c);if(w)total+=Math.max(0,Math.min(end.getTime(),w[1])-Math.max(start.getTime(),w[0]));}
 return total/1000;
}
