import {buildSwap,emotionPrepareSigned,type EmotionSignedExit} from './tradeTransport';
export type EmotionLadderState={emotionPosition:string;emotionMint:string;emotionRemaining:bigint;emotionOriginal:bigint;emotionTip:bigint};
export type EmotionLadder={emotionFingerprint:string;emotionFull:EmotionSignedExit;emotionHalf?:EmotionSignedExit};
const emotionLadders=new Map<string,EmotionLadder>();
const emotionGenerations=new Map<string,number>();
const emotionPending=new Set<string>();
export function emotionLadderFingerprint(emotionState:EmotionLadderState){return `${emotionState.emotionMint}:${emotionState.emotionRemaining}:${emotionState.emotionOriginal}:${emotionState.emotionTip}`;}
export function emotionInvalidateLadder(emotionPosition:string){emotionGenerations.set(emotionPosition,(emotionGenerations.get(emotionPosition)??0)+1);const emotionOld=emotionLadders.get(emotionPosition);emotionOld?.emotionFull.emotionRaw.fill(0);emotionOld?.emotionHalf?.emotionRaw.fill(0);emotionLadders.delete(emotionPosition);}
export function emotionLadderUsable(emotionLadder:EmotionLadder,emotionState:EmotionLadderState,emotionNow=Date.now()){return emotionLadder.emotionFingerprint===emotionLadderFingerprint(emotionState)&&emotionNow-emotionLadder.emotionFull.emotionPreparedAt<20000&&(!emotionLadder.emotionHalf||emotionNow-emotionLadder.emotionHalf.emotionPreparedAt<20000);}
export async function emotionWarmLadder(emotionState:EmotionLadderState){
 if(emotionPending.has(emotionState.emotionPosition))return;
 const emotionOld=emotionLadders.get(emotionState.emotionPosition);if(emotionOld&&emotionLadderUsable(emotionOld,emotionState)&&Date.now()-emotionOld.emotionFull.emotionPreparedAt<15000)return;
 emotionPending.add(emotionState.emotionPosition);const emotionGeneration=emotionGenerations.get(emotionState.emotionPosition)??0;
 try{const emotionFull=await emotionPrepareSigned(await buildSwap(emotionState.emotionMint,'SELL',emotionState.emotionRemaining),emotionState.emotionTip);
 const emotionHalfAmount=emotionState.emotionOriginal/2n;
 const emotionHalf=emotionHalfAmount>0n&&emotionHalfAmount<emotionState.emotionRemaining?await emotionPrepareSigned(await buildSwap(emotionState.emotionMint,'SELL',emotionHalfAmount),emotionState.emotionTip):undefined;
 if((emotionGenerations.get(emotionState.emotionPosition)??0)!==emotionGeneration){emotionFull.emotionRaw.fill(0);emotionHalf?.emotionRaw.fill(0);return;}
 emotionOld?.emotionFull.emotionRaw.fill(0);emotionOld?.emotionHalf?.emotionRaw.fill(0);emotionLadders.set(emotionState.emotionPosition,{emotionFingerprint:emotionLadderFingerprint(emotionState),emotionFull,emotionHalf});
 }finally{emotionPending.delete(emotionState.emotionPosition);}
}
export function emotionTakeLadder(emotionState:EmotionLadderState,emotionHalf:boolean){const emotionLadder=emotionLadders.get(emotionState.emotionPosition);if(!emotionLadder||!emotionLadderUsable(emotionLadder,emotionState)){emotionInvalidateLadder(emotionState.emotionPosition);return undefined;}
 const emotionSigned=emotionHalf?emotionLadder.emotionHalf:emotionLadder.emotionFull;
 const emotionCopy=emotionSigned?{...emotionSigned,emotionRaw:Buffer.from(emotionSigned.emotionRaw)}:undefined;emotionInvalidateLadder(emotionState.emotionPosition);return emotionCopy;
}
