'use client';
import Link from 'next/link';
export { DataTable, fmtDate, fmtDateTime, Mono, type TableQuery } from '@dbl/ui';
export const RefLink = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="font-mono font-semibold underline-offset-2 hover:underline">{children}</Link>;
