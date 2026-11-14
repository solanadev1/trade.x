export type Seller={wallet:string;volumeSol:number;fundingParent:string|null;receivedDirectTransfer:boolean};
export type ForensicEvidence={complete:boolean;supplyRaw:bigint;creationSlot:number;snipers:{boughtSlot:number;remainingRaw:bigint}[];creatorHoldingRaw:bigint;creatorSelling:boolean;holders:{wallet:string;amountRaw:bigint;isPool:boolean}[];sellers:Seller[];peakPanicSol:number;latestSellSol:number;buyers:{wallet:string;sol:number;fresh:boolean;smartMoney:boolean}[]};
export type ForensicResult={status:'PASS'|'SYBIL'|'BUNDLE'|'CREATOR'|'CONCENTRATION'|'EXHAUSTION'|'INSUFFICIENT_DATA';reason:string;decayPct:number};
export function safetyForensics(e:ForensicEvidence,minDecay=55):ForensicResult{
 const decayPct=e.peakPanicSol>0?(1-e.latestSellSol/e.peakPanicSol)*100:0;
 const fail=(status:ForensicResult['status'],reason:string)=>({status,reason,decayPct});
 if(!e.complete||e.supplyRaw<=0n)return fail('INSUFFICIENT_DATA','Missing supply, ownership or transaction evidence');
 const total=e.sellers.reduce((s,v)=>s+v.volumeSol,0),major=e.sellers.filter(s=>s.volumeSol>=total*.1);const parents=new Set<string>();
 for(const s of major){if(s.receivedDirectTransfer)return fail('SYBIL','Major seller received direct token transfers');if(!s.fundingParent)return fail('INSUFFICIENT_DATA','Major seller funding origin unavailable');if(parents.has(s.fundingParent))return fail('SYBIL','Major sellers share a funder');parents.add(s.fundingParent);}
 const sniper=e.snipers.filter(s=>s.boughtSlot===e.creationSlot||s.boughtSlot===e.creationSlot+1).reduce((sum,s)=>sum+s.remainingRaw,0n);
 if(sniper*100n>e.supplyRaw*15n)return fail('BUNDLE','Creation-slot inventory exceeds 15%');
 if(e.creatorSelling&&e.creatorHoldingRaw*1000n>e.supplyRaw*35n)return fail('CREATOR','Creator is selling with >3.5% ownership');
 if(e.holders.some(h=>!h.isPool&&h.amountRaw*1000n>e.supplyRaw*45n))return fail('CONCENTRATION','Wallet concentration exceeds 4.5%');
 const eligible=new Map<string,number>();for(const b of e.buyers)if(b.fresh||b.smartMoney)eligible.set(b.wallet,(eligible.get(b.wallet)??0)+b.sol);
 if(decayPct<minDecay||[...eligible.values()].filter(sol=>sol>=.4).length<2)return fail('EXHAUSTION','Sell pressure or fresh buyer confirmation insufficient');
 return fail('PASS','Ownership, funding and exhaustion checks passed');
}
