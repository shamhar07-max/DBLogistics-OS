import { Controller, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Db } from './db.service';
import { Op } from './op';
@Controller()
export class HealthController {
  constructor(@Inject(Db) private db: Db) {}
  @Op('getHealth') live() {return {status:'ok',service:'api'};}
  @Op('getReadiness') async ready() {
    try {
      const probe={text:'SELECT 1',query_timeout:2000};
      await this.db.pool.query(probe);
      return {status:'ready',dependencies:{database:'ready'}};
    } catch {throw new ServiceUnavailableException('Service is not ready.');}
  }
}
