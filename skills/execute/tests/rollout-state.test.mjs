import test from 'node:test';
import assert from 'node:assert/strict';
import { createRollout, apply, eligible, summary, digest } from '../scripts/rollout-state.mjs';
const owner={harness:'codex',account:'current',session:'lead'};
const authority={outcomes:['A','B','C'],constraints:['one repo'],allowedActions:['merge'],reservedDecisions:[],gates:[],mergeEffects:[]};
const task=(id,dependsOn=[],conflicts=[])=>({id,sourcePath:`/tasks/${id}.md`,requirements:`# ${id}\nAccepted outcome`,acceptance:['verifier'],dependsOn,conflicts,allowance:{calls:8,verifierRuns:8,recoveries:2}});
const spec=(tasks=[task('a'),task('b',['a']),task('c')])=>({protocolVersion:4,rolloutId:'demo',repository:{path:'/repo',identity:'github.com/o/r',baseBranch:'master',verifier:'npm test'},authority,tasks});
const fresh=(tasks)=>createRollout(spec(tasks),owner);
const run=(s,c)=>apply(s,c,{...owner,epoch:s.execution.epoch});
function start(s,id){return run(s,{type:'start',taskId:id,baseRef:'a'.repeat(40)});}
function approve(s,id){const t=s.tasks[id];return run(s,{type:'converged',taskId:id,attemptId:t.attempt.id,revision:t.revision.hash,result:{status:'review',verified:true,prUrl:`https://github.com/o/r/pull/${id.charCodeAt(0)}`,head:'b'.repeat(40),verifiedHead:'b'.repeat(40),reviewedHead:'b'.repeat(40),reviewer:'native-review-'+id,verification:'exit 0'}});}
function land(s,id){const t=s.tasks[id];return run(s,{type:'merge-observed',taskId:id,attemptId:t.attempt.id,approval:t.approval.digest,observation:{repository:'github.com/o/r',baseBranch:'master',state:'MERGED',head:'b'.repeat(40),mergeCommit:'c'.repeat(40),prUrl:t.approval.prUrl,verification:'exit 0'}});}
function finish(s,id){return land(approve(start(s,id),id),id);}

test('task completion releases its dependant while independent peer stays active',()=>{
 let s=start(start(fresh(),'a'),'c'); s=land(approve(s,'a'),'a');
 assert.deepEqual(eligible(s),['b']); assert.equal(s.tasks.c.status,'active');
});
test('blocked task holds only dependent closure',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'block',taskId:'a',reason:'authority missing'});
 assert.deepEqual(eligible(s),['c']);
});
test('conflicts exclude concurrency without inventing outcome dependencies',()=>{
 let s=fresh([task('a',[],['b']),task('b'),task('c')]);s=start(s,'b');assert.deepEqual(eligible(s),['c']);
});
test('revision invalidates current and dependent outcomes while retaining landing history',()=>{
 let s=finish(finish(fresh(),'a'),'b');const old=s.tasks.a.revision.hash;
 s=run(s,{type:'revise',taskId:'a',requirements:'# a\nNew details',assessment:{authorityHash:s.authorityHash,withinAuthority:true,evidence:'native assessment'}});
 assert.notEqual(s.tasks.a.revision.hash,old);assert.equal(s.tasks.a.status,'open');assert.equal(s.tasks.b.status,'open');assert.equal(s.tasks.a.landings.length,1);
});
test('revision assessment cannot enlarge authority and superseded active work must drain',()=>{
 let s=start(fresh(),'a');assert.throws(()=>run(s,{type:'revise',taskId:'a',requirements:'spend more',assessment:{authorityHash:s.authorityHash,withinAuthority:false,evidence:'outside scope'}}),/authority/i);
 s=run(s,{type:'revise',taskId:'a',requirements:'new',assessment:{authorityHash:s.authorityHash,withinAuthority:true,evidence:'covered'}});
 assert.equal(s.tasks.a.status,'draining');assert.ok(!eligible(s).includes('a'));
});
test('seven complete three blocked ends execution partial while rollout remains unfinished',()=>{
 let s=fresh(Array.from({length:10},(_,i)=>task(String.fromCharCode(97+i))));
 for(const id of 'abcdefg')s=finish(s,id);
 for(const id of 'hij')s=run(s,{type:'block',taskId:id,reason:'no remaining authority'});
 s=run(s,{type:'settle'});assert.equal(s.execution.status,'ended');assert.equal(summary(s).complete,7);assert.equal(summary(s).rolloutComplete,false);
});
test('claims spend allowance once, duplicate claims cannot replenish or double dispatch',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'claim',taskId:'a',requestId:'r1',verifierRuns:3});
 assert.equal(s.execution.pools.a.spent.calls,1);assert.throws(()=>run(s,{type:'claim',taskId:'a',requestId:'r1',verifierRuns:3}),/claimed/);
 assert.throws(()=>run(s,{type:'claim',taskId:'a',requestId:'r2',verifierRuns:6}),/allowance/);
 assert.equal(s.execution.pools.a.spent.verifierRuns,3);
});
test('pause drains active task and may merge but starts no follow-ons',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'pause'});assert.deepEqual(eligible(s),[]);
 s=land(approve(s,'a'),'a');s=run(s,{type:'settle'});assert.equal(s.execution.status,'paused');assert.deepEqual(eligible(s),[]);
 s=run(s,{type:'resume'});assert.ok(eligible(s).includes('b'));
});
test('immediate stop fences merge and claim; heartbeat cannot resume',()=>{
 let s=approve(start(fresh(),'a'),'a');s=run(s,{type:'stop'});assert.throws(()=>land(s,'a'),/stopped/);assert.deepEqual(eligible(s),[]);
 s=run(s,{type:'settle'});assert.equal(s.execution.status,'stopped');
});
test('queued merge never completes, mismatched head/PR/base rejected',()=>{
 let s=approve(start(fresh(),'a'),'a');const t=s.tasks.a;
 const c={type:'merge-observed',taskId:'a',attemptId:t.attempt.id,approval:t.approval.digest,observation:{repository:'github.com/o/r',baseBranch:'master',state:'OPEN',head:'b'.repeat(40),prUrl:t.approval.prUrl}};
 s=run(s,c);assert.equal(s.tasks.a.status,'waiting');assert.deepEqual(eligible(s),['c']);
 assert.throws(()=>run(s,{...c,observation:{...c.observation,head:'d'.repeat(40)}}),/head/);
 assert.throws(()=>run(s,{...c,observation:{...c.observation,prUrl:'https://github.com/foreign/repo/pull/7'}}),/identity/);
});
test('identical result replay idempotent, conflicting result rejected',()=>{
 let s=start(fresh(),'a');const a=s.tasks.a.attempt;
 const c={type:'converged',taskId:'a',attemptId:a.id,revision:s.tasks.a.revision.hash,result:{status:'blocked',reason:'test failure'}};
 s=run(s,c);assert.deepEqual(run(s,c),s);assert.throws(()=>run(s,{...c,result:{status:'blocked',reason:'changed'}}),/conflict/);
});
test('revert invalidates outcome and all dependent completions',()=>{
 let s=finish(finish(fresh(),'a'),'b');s=run(s,{type:'invalidate',taskId:'a',reason:'reverted',evidence:'revert commit'});
 assert.equal(s.tasks.a.status,'open');assert.equal(s.tasks.b.status,'open');assert.equal(s.tasks.a.landings.length,1);
});
test('restart/resume preserves spending; explicit relaunch renews only unfinished requested scope',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'claim',taskId:'a',requestId:'r',verifierRuns:2});s=run(s,{type:'block',taskId:'a',reason:'exhausted',resolvedRequests:['r']});
 s=finish(s,'c');s=run(s,{type:'block',taskId:'b',reason:'dependency'});s=run(s,{type:'settle'});
 assert.equal(s.execution.pools.a.spent.calls,1);
 s=run(s,{type:'relaunch',scope:['a'],instruction:'Run unfinished task a again'});
 assert.deepEqual(s.execution.scope,['a']);assert.equal(s.execution.pools.a.spent.calls,0);assert.equal(s.history[0].pools.a.spent.calls,1);assert.equal(s.tasks.c.status,'complete');
});
test('atomic prerequisite discovery rejects cycles and shares original allowance',()=>{
 let s=fresh();const p=task('prerequisite');s=run(s,{type:'prerequisite',taskId:'a',task:p,assessment:{authorityHash:s.authorityHash,withinAuthority:true,evidence:'necessary'}});
 assert.equal(s.tasks.prerequisite.pool,'a');assert.deepEqual(s.tasks.a.dependsOn,['prerequisite']);assert.deepEqual(eligible(s),['c','prerequisite']);
 assert.throws(()=>run(s,{type:'prerequisite',taskId:'prerequisite',task:{...task('bad'),dependsOn:['a']},assessment:{authorityHash:s.authorityHash,withinAuthority:true,evidence:'test'}}),/cycle/);
 assert.equal(s.tasks.bad,undefined);
});
test('ownership transfer fences stale owner and preserves allowance; ambiguous requests prevent transfer',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'claim',taskId:'a',requestId:'r',verifierRuns:1});
 const next={...owner,session:'new'};
 assert.throws(()=>apply(s,{type:'recover',previousEpoch:s.execution.epoch,previousOwnerStopped:true,evidence:'native status',resolutions:{}},next),/unresolved/);
 s=apply(s,{type:'recover',previousEpoch:s.execution.epoch,previousOwnerStopped:true,evidence:'native status',resolutions:{r:{state:'dispatched',childId:'actual'}}},next);
 assert.equal(s.execution.epoch,2);assert.equal(s.execution.pools.a.spent.calls,1);
 assert.throws(()=>apply(s,{type:'pause'},{...owner,epoch:1}),/owner/);
});
test('strict configuration fails before state creation or dispatch',()=>{
 for(const value of [0,-1,'2',1.5,NaN])assert.throws(()=>createRollout(spec([{...task('a'),allowance:{calls:value,verifierRuns:8,recoveries:2}}]),owner),/positive integer/);
 assert.throws(()=>createRollout({...spec(),protocolVersion:3},owner),/protocol/);
 assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});
test('unassessed source edit holds changed task and invalidates its dependent outcome',()=>{
 let s=finish(finish(fresh(),'a'),'b');s=run(s,{type:'assessment-needed',taskId:'a',observedHash:'changed',reason:'source edited'});
 assert.equal(s.tasks.a.status,'blocked');assert.equal(s.tasks.b.status,'open');assert.deepEqual(eligible(s),['c']);
 s=run(s,{type:'revise',taskId:'a',requirements:'changed',assessment:{authorityHash:s.authorityHash,withinAuthority:true,evidence:'reviewed'}});
 assert.deepEqual(eligible(s),['a','c']);
});
test('assessment hold survives draining and ordinary retry',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'assessment-needed',taskId:'a',observedHash:'changed',reason:'source edited'});
 assert.equal(s.tasks.a.status,'draining');s=run(s,{type:'drained',taskId:'a',evidence:'all children terminal'});
 assert.equal(s.tasks.a.status,'blocked');s=run(s,{type:'retry',taskId:'a'});assert.ok(!eligible(s).includes('a'));
});
test('recovery spends finite allowance and cannot be used repeatedly by same owner',()=>{
 let s=start(fresh(),'a');const cmd={type:'recover',previousEpoch:s.execution.epoch,previousOwnerStopped:true,evidence:'tool evidence',resolutions:{}};
 const next={...owner,session:'new'};s=apply(s,cmd,next);assert.equal(s.execution.pools.a.spent.recoveries,1);
 assert.throws(()=>apply(s,cmd,next),/already owns/);
});
test('task attempt history contains accepted results after a disk round trip',()=>{
 let s=JSON.parse(JSON.stringify(start(fresh(),'a')));s=approve(s,'a');assert.equal(s.tasks.a.attempts[0].result.status,'review');
});
test('merge approval rejects verifier/reviewer head disagreement',()=>{
 let s=start(fresh(),'a');const t=s.tasks.a;
 assert.throws(()=>run(s,{type:'converged',taskId:'a',attemptId:t.attempt.id,revision:t.revision.hash,result:{status:'review',verified:true,prUrl:'https://github.com/o/r/pull/1',head:'a'.repeat(40),verifiedHead:'a'.repeat(40),reviewedHead:'b'.repeat(40),reviewer:'judge',verification:'exit 0'}}),/head/);
});
test('integration verifier reserves from original pool before running',()=>{
 let s=fresh();s=run(s,{type:'reserve-verifier',taskId:'a',verifierRuns:2,purpose:'post-merge integration'});
 assert.equal(s.execution.pools.a.spent.verifierRuns,2);
 assert.throws(()=>run(s,{type:'reserve-verifier',taskId:'a',verifierRuns:7,purpose:'retry'}),/allowance/);
});
test('repair can merge only the attributed task during a repository hold',()=>{
 let s=finish(fresh(),'a');s=run(s,{type:'regression',taskId:'a',evidence:'integration failed'});
 s=approve(start(s,'a'),'a');s=land(s,'a');assert.equal(s.tasks.a.status,'complete');assert.equal(s.execution.mergeHold,null);
});
test('relaunch advances fencing epoch and retains repository regression hold',()=>{
 let s=fresh();s=run(s,{type:'regression',taskId:'a',evidence:'red integration'});
 for(const id of ['a','b','c'])s=run(s,{type:'block',taskId:id,reason:'blocked'});
 s=run(s,{type:'settle'});const epoch=s.execution.epoch;s=run(s,{type:'relaunch',scope:['a'],instruction:'Try again'});
 assert.ok(s.execution.epoch>epoch);assert.equal(s.execution.mergeHold.taskId,'a');
 assert.throws(()=>apply(s,{type:'pause'},{...owner,epoch}),/epoch/);
});
test('terminal native results cannot be rebound or replaced',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'claim',taskId:'a',requestId:'r'});
 s=run(s,{type:'request-state',taskId:'a',requestId:'r',status:'dispatched',childId:'native'});
 s=run(s,{type:'request-state',taskId:'a',requestId:'r',status:'accepted'});
 assert.throws(()=>run(s,{type:'request-state',taskId:'a',requestId:'r',status:'dispatched',childId:'native'}),/terminal/);
 assert.throws(()=>run(s,{type:'request-state',taskId:'a',requestId:'r',status:'interrupted'}),/terminal/);
});
test('stale queued observation cannot reopen completed task; repeated merge cannot duplicate history',()=>{
 let s=finish(fresh(),'a');const t=s.tasks.a;
 const c={type:'merge-observed',taskId:'a',attemptId:t.attempt.id,approval:t.approval.digest,observation:{repository:'github.com/o/r',baseBranch:'master',state:'OPEN',head:'b'.repeat(40),prUrl:t.approval.prUrl}};
 assert.throws(()=>run(s,c),/stale/);s=land(s,'a');assert.equal(s.tasks.a.landings.length,1);
});
test('recovery requires evidence from the current ownership tenure',()=>{
 let s=fresh();assert.throws(()=>apply(s,{type:'recover',previousOwnerStopped:true,evidence:'old',resolutions:{}},{...owner,session:'new'}),/epoch/);
});
test('proven never-started claim recovers without fabricated child or budget refund',()=>{
 let s=start(fresh(),'a');s=run(s,{type:'claim',taskId:'a',requestId:'r',verifierRuns:2});
 s=apply(s,{type:'recover',previousEpoch:s.execution.epoch,previousOwnerStopped:true,evidence:'owner terminal',resolutions:{r:{state:'not-started',evidence:'native launch history confirms spawn absent'}}},{...owner,session:'new'});
 assert.equal(s.execution.requests.r.status,'interrupted');assert.equal(s.execution.requests.r.childId,undefined);assert.equal(s.execution.pools.a.spent.verifierRuns,2);
});
