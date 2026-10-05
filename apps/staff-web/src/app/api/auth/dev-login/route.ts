import { gateway } from '@/lib/gateway';
export const POST = (req: Request) => gateway().devLogin(req);
