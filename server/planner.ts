import OpenAI from 'openai';
import type {Field,PlanAction} from './types.js';
import market from '../data/markets/saudi-arabia.json' with {type:'json'};

const planSchema={type:'object',additionalProperties:false,required:['supported','reason','actions'],properties:{supported:{type:'boolean'},reason:{type:'string'},actions:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['action','fieldPurpose','valueKey','locator','reason'],properties:{action:{type:'string',enum:['fill','click','observe']},fieldPurpose:{type:['string','null']},valueKey:{type:['string','null'],enum:[null,'fullName','mixedName','email','phoneLocal','phoneInternational','city','password','arabicIndicDigits']},reason:{type:'string'},locator:{type:'object',additionalProperties:false,required:['strategy','value'],properties:{strategy:{type:'string',enum:['label','role','name','id','css']},value:{type:'string'}}}}}}}} as const;

type PlanResult={supported:boolean;reason:string;actions:PlanAction[];source:string;fallbackReason:string|null;log:string[]};

function sanitize(message:string){return message.replace(/sk-[A-Za-z0-9_-]+/g,'[REDACTED_API_KEY]').slice(0,1200)}
function classifyPlannerError(error:unknown){
  const candidate=error as {name?:string;status?:number;message?:string};
  const message=sanitize(candidate?.message||String(error));
  if(candidate?.status===401||candidate?.name==='AuthenticationError')return `auth_error: ${message}`;
  if(candidate?.name==='TimeoutError'||candidate?.name==='AbortError'||/timed?\s*out|timeout|aborted/i.test(message))return `timeout: ${message}`;
  if(candidate?.status===400&&/schema|response_format|json_schema/i.test(message))return `schema_validation_failure: ${message}`;
  return `api_error: ${message}`;
}

export async function createPlan(fields:Field[],buttons:string[],allowSubmission=false):Promise<PlanResult>{
  const model=process.env.OPENAI_MODEL||'gpt-5.6';
  const fallback=(fallbackReason:string,log:string[]):PlanResult=>{const actions:PlanAction[]=fields.flatMap(f=>{const hint=`${f.label} ${f.name} ${f.placeholder}`.toLowerCase();let valueKey:string|null=null;if(f.type==='email'||/\be-?mail\b/.test(hint))valueKey='email';else if(f.type==='password'||/\bpassword\b/.test(hint))valueKey='password';else if(f.type==='tel'||/\bphone number\b/.test(hint))valueKey='phoneLocal';else if(/\b(full|first|last)[ _-]?name\b|\bname\b/.test(hint))valueKey='fullName';else if(/\bcity\b/.test(hint))valueKey='city';return valueKey?[{action:'fill' as const,fieldPurpose:f.label||f.name||f.type,locator:f.locator,valueKey,reason:`Fallback matched an explicit conventional field hint for ${f.label||f.name||f.type}`}]:[]});const supported=actions.length>=2;const reason=supported?'At least two conventional standard-form fields were mapped deterministically.':'Deterministic fallback could not safely map at least two visible fields; adaptive planning is required.';return {supported,reason,actions,source:'deterministic-fallback',fallbackReason,log:[...log,`Fallback activated: ${fallbackReason}`,`Fallback mapping: mapped=${actions.length}/${fields.length}; supported=${supported}`,...actions.map((action,index)=>`Fallback decision ${index+1}: ${action.action} ${action.fieldPurpose} via ${action.locator.strategy}=${action.locator.value}`)]}};
  if(process.env.OPENAI_API_KEY){
    const log=[`Planner request started: model=${model}, fields=${fields.length}, buttons=${buttons.length}, allowSubmission=${allowSubmission}, timeout=90000ms`];
    try{
      const client=new OpenAI();
      const response=await client.responses.create({model,reasoning:{effort:'low'},input:[{role:'system',content:`You plan a bounded audit of a public standard signup form. Use only supplied DOM-grounded locators. Every fill valueKey must match the semantic purpose of its target field: never put email in a name/greeting field or a name in a phone field. The executor creates the English control automatically, so plan Saudi semantic test values only. For role locators, value is the accessible button name only (example: Continue), never prefix it with button:. Never bypass CAPTCHA or authentication. allowSubmission=${allowSubmission}. ${allowSubmission?'This is the owned controlled benchmark: you may click non-submit navigation controls and include one final click of the supplied submit button to verify flow completion.':'This is an external target: you may click safe non-submit navigation controls but never click a submit or create-account control.'} Return the smallest useful plan.`},{role:'user',content:JSON.stringify({market,fields,buttons,allowSubmission})}],text:{format:{type:'json_schema',name:'signup_audit_plan',strict:true,schema:planSchema}}},{signal:AbortSignal.timeout(90_000)});
      const parsed=JSON.parse(response.output_text) as {supported:boolean;reason:string;actions:PlanAction[]};
      const source=`${response.model}-adaptive`;
      const decisions=parsed.actions.map((action,index)=>`Decision ${index+1}: ${action.action} ${action.fieldPurpose??'page'}${action.valueKey?` with ${action.valueKey}`:''} via ${action.locator.strategy}=${action.locator.value}; reason=${action.reason}`);
      const completedLog=[...log,`Planner response received: id=${response.id}, model=${response.model}, supported=${parsed.supported}, actions=${parsed.actions.length}`,`Planner assessment: ${parsed.reason}`,...decisions];
      console.info('[planner-success]',JSON.stringify({responseId:response.id,model:response.model,supported:parsed.supported,actions:parsed.actions}));
      return {...parsed,source,fallbackReason:null,log:completedLog};
    }catch(error){
      const fallbackReason=classifyPlannerError(error);
      console.error('[planner-fallback]',JSON.stringify({model,reason:fallbackReason}));
      return fallback(fallbackReason,log);
    }
  }
  const fallbackReason='missing_key: OPENAI_API_KEY is not configured.';
  console.error('[planner-fallback]',JSON.stringify({model,reason:fallbackReason}));
  return fallback(fallbackReason,[`Planner request not started: model=${model}`]);
}
