import { gateway } from '@/lib/gateway';
type Ctx = { params: Promise<{ path: string[] }> };
const h = async (req: Request, ctx: Ctx) => gateway().proxy(req, (await ctx.params).path);
export { h as GET, h as POST };
