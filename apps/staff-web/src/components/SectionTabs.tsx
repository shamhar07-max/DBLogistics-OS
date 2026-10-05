'use client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dbl/ui';

export interface Section { id: string; label: string; content: React.ReactNode }
/** One tab style across every screen (jobs, money, people, quality, intelligence, automation, admin). */
export function SectionTabs({ sections, defaultId }: { sections: Section[]; defaultId?: string }) {
  return (
    <Tabs defaultValue={defaultId ?? sections[0].id}>
      <TabsList className="mb-4 flex flex-wrap gap-0.5 border-b border-line">
        {sections.map((s) => <TabsTrigger key={s.id} value={s.id} className="relative px-3.5 py-2.5 font-display text-[13px] font-semibold text-steel data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-[3px] data-[state=active]:after:bg-signal">{s.label}</TabsTrigger>)}
      </TabsList>
      {sections.map((s) => <TabsContent key={s.id} value={s.id}>{s.content}</TabsContent>)}
    </Tabs>
  );
}
