import { gateway } from '@/lib/gateway';
export const GET = (req: Request) => gateway().callback(req);
