import { createGateway } from '@dbl/gateway';
import { loadGatewayEnv } from '@dbl/configuration';
let g: ReturnType<typeof createGateway> | undefined;
export const gateway = () => (g ??= createGateway(loadGatewayEnv()));
