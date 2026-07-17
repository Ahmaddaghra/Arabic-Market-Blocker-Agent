export type Locator={strategy:'label'|'role'|'name'|'id'|'css';value:string};
export type Field={tag:string;type:string;label:string;name:string;placeholder:string;required:boolean;locator:Locator};
export type PlanAction={action:'fill'|'click'|'observe';fieldPurpose?:string;locator:Locator;valueKey?:string;reason:string};
export type Finding={id:string;title:string;severity:'blocker'|'warning';checkId:string;summary:string;impact:string;actual:string;expected:string;locator:Locator;evidenceScreenshot:string;generatedTest:string};
export type AuditResult={status:'completed'|'unsupported';verdict:string;url:string;planner:'gpt-5.6'|'deterministic-fallback';supportMessage?:string;fields:Field[];plan:PlanAction[];findings:Finding[];screenshots:{baseline:string;arabic:string};comparison:{english:string;arabic:string}};
