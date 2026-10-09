import {Body,Controller,Inject,Module,Param,ParseUUIDPipe} from '@nestjs/common';
import {Ctx,Op,Qry,type RequestContext} from '../platform';
import {GovernanceService} from './governance.service';
@Controller()
class GovernanceController {
 constructor(@Inject(GovernanceService)private s:GovernanceService){}
 @Op('listKnowledge') knowledge(@Ctx() c:RequestContext,@Qry() q:any){return this.s.knowledge(c,q);}
 @Op('createKnowledge') draft(@Ctx() c:RequestContext,@Body() b:any){return this.s.createKnowledge(c,b);}
 @Op('publishKnowledge') publish(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.publish(c,id,b);}
 @Op('acknowledgeKnowledge') ack(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string){return this.s.acknowledge(c,id);}
 @Op('listRisks') risks(@Ctx() c:RequestContext){return this.s.risks(c);}
 @Op('createRisk') create(@Ctx() c:RequestContext,@Body() b:any){return this.s.createRisk(c,b);}
 @Op('getRisk') risk(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string){return this.s.risk(c,id);}
 @Op('reviewRisk') review(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.review(c,id,b);}
}
@Module({providers:[GovernanceService],controllers:[GovernanceController]})export class GovernanceModule{}
