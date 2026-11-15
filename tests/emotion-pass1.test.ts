import {test as emotionTest} from 'node:test';
import emotionAssert from 'node:assert/strict';
import {emotionWindow,queueEmotionWindow,flushEmotionDna,emotionDnaProfiles,db as emotionDb,type EmotionTrade,type EmotionProfile} from '../src/lib/db/cortisolDb';
import {emotionPainHorizon,emotionTapeSignals} from '../src/lib/cortisol/forensicCollector';
import {emotionClusterForensics} from '../src/lib/cortisol/safetyForensics';
const emotionTrade=(emotionSignature:string,emotionBuy:boolean,emotionSol:number,emotionTime:number):EmotionTrade=>({signature:emotionSignature,mint:'emotion-mint',wallet:'emotion-wallet',buy:emotionBuy,sol:emotionSol,tokens:10,price:emotionSol/10,timestamp:emotionTime});
emotionTest('emotion rolling DNA is idempotent and excludes unmatched emotional sells',()=>{
 const emotionTrades=[emotionTrade('emotion-buy',true,10,1000),emotionTrade('emotion-sell',false,7,11000)];
 const emotionResult=emotionWindow(emotionTrades);emotionAssert.equal(emotionResult.emotionProfiles[0].emotionRealizedSol,-3);emotionAssert.equal(emotionResult.emotionProfiles[0].emotionHoldSum,10);emotionAssert.equal(emotionResult.emotionProfiles[0].emotionLossExits,1);
 emotionAssert.equal(emotionWindow([emotionTrades[1]]).emotionProfiles[0].emotionRealizedSol,0);
 queueEmotionWindow('emotion-mint',emotionTrades);flushEmotionDna();queueEmotionWindow('emotion-mint',emotionTrades);flushEmotionDna();emotionAssert.equal(emotionDnaProfiles()[0].emotionTrades,2);emotionAssert.equal(emotionDb.pragma('journal_mode',{simple:true}),'wal');
 const emotionLong=Array.from({length:1005},(_,emotionIndex)=>emotionTrade(`emotion-${emotionIndex}`,true,10,emotionIndex));emotionAssert.equal(emotionWindow(emotionLong).emotionTrades.length,1000);
});
emotionTest('emotion pain threshold uses the descending 75% holder crossing and observed cost basis',()=>{
 const emotionProfiles=Array.from({length:4},(_,emotionIndex)=>({emotionWallet:`emotion-${emotionIndex}`,emotionClass:'Emotional Retail Gamblers',emotionCapitulation:.25} as EmotionProfile));
 const emotionPositions=emotionProfiles.map((emotionProfile,emotionIndex)=>({emotionWallet:emotionProfile.emotionWallet,emotionTokens:10,emotionCostSol:10*(4-emotionIndex),emotionEntryPrice:4-emotionIndex,emotionOpenedAt:1000}));
 const emotionBalances=new Map(emotionProfiles.map(emotionProfile=>[emotionProfile.emotionWallet,10000000n]));
 const emotionPain=emotionPainHorizon(emotionPositions,emotionProfiles,emotionBalances,6,1,2000,[]);
 emotionAssert.equal(emotionPain.emotionPainPrice75,1.5);emotionAssert.equal(emotionPain.emotionVwap,2.5);
});
emotionTest('emotion clusters distinguish observed holding from round-trip wash selling',()=>{
 const emotionWallets=['emotion-a','emotion-b'].map(emotionWallet=>({emotionWallet,emotionFresh:true,emotionParent:'emotion-parent',emotionFundingSol:10,emotionEntryMs:1000,emotionBuySol:5,emotionSellSol:0,emotionObservedMs:60000}));
 emotionAssert.equal(emotionClusterForensics(emotionWallets).emotionStealthWhaleAccumulation,true);
 emotionAssert.equal(emotionClusterForensics(emotionWallets.map(emotionWallet=>({...emotionWallet,emotionSellSol:4}))).emotionWashTrading,true);
 emotionAssert.equal(emotionClusterForensics(emotionWallets.map(emotionWallet=>({...emotionWallet,emotionObservedMs:100}))).emotionStealthWhaleAccumulation,false);
});
emotionTest('emotion absorption requires real receipt timing and shrinking sell impact',()=>{
 const emotionProfile={emotionWallet:'emotion-wallet',emotionClass:'Emotional Retail Gamblers'} as EmotionProfile;
 const emotionTrades=[{...emotionTrade('emotion-0',true,12,1000),price:1.2}, {...emotionTrade('emotion-1',false,10,2000),price:1,observedAt:2000}, {...emotionTrade('emotion-2',false,10,3000),price:.9,observedAt:3000}, {...emotionTrade('emotion-3',true,10,3000),wallet:'emotion-buyer',price:1,observedAt:3300}];
 emotionAssert.equal(emotionTapeSignals(emotionTrades,[emotionProfile],4000).emotionAbsorptions[0]?.emotionDeltaMs,300);
 emotionAssert.equal(emotionTapeSignals(emotionTrades.map(emotionTrade=>({...emotionTrade,observedAt:undefined})),[emotionProfile],4000).emotionAbsorptions.length,0);
});
emotionTest('emotion percentile classes require observed losses, green buying and enough profitable peers',()=>{
 const emotionTrades:EmotionTrade[]=[];let emotionTime=100000;
 for(let emotionWalletIndex=0;emotionWalletIndex<100;emotionWalletIndex++)for(let emotionRound=0;emotionRound<5;emotionRound++){
 const emotionWallet=`emotion-peer-${String(emotionWalletIndex).padStart(3,'0')}`;
 emotionTrades.push({...emotionTrade(`emotion-peer-buy-${emotionWalletIndex}-${emotionRound}`,true,10,emotionTime++),mint:'emotion-percentiles',wallet:emotionWallet});
 emotionTrades.push({...emotionTrade(`emotion-peer-sell-${emotionWalletIndex}-${emotionRound}`,false,emotionWalletIndex<20?7:11+emotionWalletIndex/100,emotionTime++),mint:'emotion-percentiles',wallet:emotionWallet});
 }
 queueEmotionWindow('emotion-percentiles',emotionTrades);
 const emotionProfiles=emotionDnaProfiles();
 emotionAssert.equal(emotionProfiles.filter(emotionProfile=>emotionProfile.emotionClass==='Apex Sharks').length,1);
 emotionAssert.equal(emotionProfiles.filter(emotionProfile=>emotionProfile.emotionClass==='Emotional Retail Gamblers').length,20);
 flushEmotionDna();
 emotionAssert.equal((emotionDb.prepare('SELECT COUNT(*) AS emotion_count FROM wallet_dna WHERE emotion_class=?').get('Apex Sharks') as {emotion_count:number}).emotion_count,1);
});
