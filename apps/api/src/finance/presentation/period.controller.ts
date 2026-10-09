import {Body,Controller,Inject,Param,ParseUUIDPipe} from '@nestjs/common';
import {Ctx,Op,type RequestContext} from '../../platform';
import {PeriodService} from '../application/period.service';
@Controller()
export class PeriodController{
 constructor(@Inject(PeriodService)private s:PeriodService){}
 @Op('listAccountingPeriods') list(@Ctx() c:RequestContext){return this.s.list(c);}
 @Op('getAccountingPeriod') get(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string){return this.s.detail(c,id);}
 @Op('requestPeriodChange') request(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.request(c,id,b);}
 @Op('decidePeriodChange') decide(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.decide(c,id,b);}
}
