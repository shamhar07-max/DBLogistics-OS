'use client';
import { useOp } from '@/lib/hooks';

export type Workspace = 'customer' | 'agent' | 'transporter' | 'driver' | string;
export interface Me { workspace: Workspace; partyId: string | null; partyName: string | null; email?: string; permissions: string[] }
/** Who is signed in — drives the navigation and which screens are offered. */
export const useWho = () => { const q = useOp('getMe'); return { ...q, me: q.data as Me | undefined }; };
export const isTransporter = (w?: string) => w === 'transporter' || w === 'driver';

export interface NavItem { label: string; href: string }
export const navFor = (w?: string): NavItem[] =>
  w === 'customer' ? [{ label: 'Overview', href: '/' }, { label: 'Shipments', href: '/shipments' }, { label: 'Quotes', href: '/quotes' }, { label: 'Invoices', href: '/invoices' }, { label: 'Documents', href: '/documents' }, { label: 'Account', href: '/account' }]
  : w === 'agent' ? [{ label: 'Overview', href: '/' }, { label: 'Shipments', href: '/shipments' }, { label: 'Documents', href: '/documents' }, { label: 'Account', href: '/account' }]
  : isTransporter(w) ? [{ label: 'Trips', href: '/' }, { label: 'Documents', href: '/documents' }, { label: 'Account', href: '/account' }] : [{ label: 'Account', href: '/account' }];
