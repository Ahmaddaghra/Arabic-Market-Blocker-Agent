import OpenAI from 'openai';
import type {Field,PlanAction} from './types.js';
import market from '../data/markets/saudi-arabia.json' with {type:'json'};

const planSchema={type:'object',additionalProperties:false,required:['supported','reason','actions'],properties:{supported:{type:'boolean'},reason:{type:'string'},actions:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['action','fieldPurpose','valueKey','locator','reason'],properties:{action:{type:'string',enum:['fill','click','observe']},fieldPurpose:{type:['string','null']},valueKey:{type:['string','null']},reason:{type:'string'},locator:{type:'object',additionalProperties:false,required:['strategy','value'],properties:{strategy:{type:'string',enum:['label','role','name','id','css']},value:{type:'string'}}}}}}}} as const;

export async function createPlan(fields:Field[],buttons:string[]):Promise<{supported:boolean;reason:string;actions:PlanAction[];source:'gpt-5.6'|'deterministic-fallback'}>{
  if(process.env.OPENAI_API_KEY){
    const client=new OpenAI();
    const response=await client.responses.create({model:process.env.OPENAI_MODEL||'gpt-5.6',reasoning:{effort:'medium'},input:[{role:'system',content:'You plan a bounded, non-destructive audit of a public standard signup form. Use only supplied DOM-grounded locators. Never bypass CAPTCHA, authentication, or submit a real account. Compare an English baseline with Saudi Arabic persona input. Return the smallest useful plan.'},{role:'user',content:JSON.stringify({market,fields,buttons})}],text:{format:{type:'json_schema',name:'signup_audit_plan',strict:true,schema:planSchema}}});
    const parsed=JSON.parse(response.output_text) as {supported:boolean;reason:string;actions:PlanAction[]};
    return {...parsed,source:'gpt-5.6'};
  }
  const actions:PlanAction[]=fields.filter(f=>['text','email','tel','password'].includes(f.type)).map(f=>({action:'fill',fieldPurpose:f.type,locator:f.locator,valueKey:f.type==='email'?'email':f.type==='tel'?'phoneLocal':f.type==='password'?'password':'fullName',reason:`Test ${f.label||f.name||f.type} with the Saudi persona`}));
  return {supported:fields.length>=2,reason:fields.length>=2?'Standard form fields detected.':'No standard signup form fields were detected.',actions,source:'deterministic-fallback'};
}
