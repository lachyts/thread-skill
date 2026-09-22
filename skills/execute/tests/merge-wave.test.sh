#!/usr/bin/env bash
# Offline contract tests: exercise the real merger against a stateful GitHub CLI fixture.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
python3 - "$HERE/../scripts/merge-wave.sh" <<'PY'
import json, os, pathlib, shutil, subprocess, sys, tempfile, unittest
SCRIPT = str(pathlib.Path(sys.argv[1]).resolve())
SHA = 'a' * 40
OTHER = 'b' * 40
MERGE = 'c' * 40
REAL_GIT = shutil.which('git')
GH = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['FIXTURE'])
c = json.loads(p.read_text())
a = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as f: f.write(json.dumps(a) + '\n')
def save(): p.write_text(json.dumps(c))
def option(name): return a[a.index(name)+1] if name in a else None
def output(value): print(json.dumps(value) if isinstance(value, (dict,list,bool)) else value if value is not None else '')
if a[:2] == ['repo', 'view']:
    output(c['base'] if '-q' in a else {'defaultBranchRef': {'name': c['base']}})
elif a[:2] == ['pr', 'view']:
    n = int(a[2]); scenario = c['scenario']; called = c.get('merged', {}).get(str(n), False)
    head = 'b'*40 if ((scenario in ['head-change','base-and-head-change'] and c.get('checked')) or c.get('updated') or (scenario == 'merged-wrong-head' and called)) else 'a'*40
    base = 'other' if scenario == 'wrong-base' or (scenario == 'base-change' and c.get('checked')) else c['base']
    merged = called and scenario != 'queued' or scenario in ['already-merged-wrong-head','missing-merge-evidence']
    if scenario == 'already-merged-wrong-head': head = 'b'*40
    state = 'MERGED' if merged else 'OPEN'
    mss = 'UNSTABLE' if scenario == 'optional-red' else 'BEHIND' if scenario == 'behind' and not c.get('updated') else 'BLOCKED' if scenario in ['head-change','base-change','required-red'] and not c.get('checked') else 'CLEAN'
    obj = {'number':n,'url':f'https://github.com/acme/widgets/pull/{n}','state':state,'baseRefName':base,'headRefOid':head,'headRefName':f'topic-{n}','mergeStateStatus':mss,'mergeCommit':{'oid':'c'*40} if merged and scenario != 'missing-merge-evidence' else None,'isCrossRepository':False}
    fields = option('--json').split(',')
    if '-q' in a:
        value = obj.get(option('-q').removeprefix('.'))
        output(value)
    else: output({k:obj[k] for k in fields})
elif a[:2] == ['pr', 'checks']:
    c['checked'] = True; save()
    if c['scenario'] == 'optional-red': print('no required checks reported on the branch', file=sys.stderr); sys.exit(1)
    if c['scenario'] == 'required-red': print('required tests failed', file=sys.stderr); sys.exit(1)
    output([] if '--json' in a else 'required checks passed')
elif a[:2] == ['pr', 'merge']:
    n=a[2]; c.setdefault('merged', {})[n]=True; save()
    print('Pull request added to merge queue' if c['scenario']=='queued' else 'Merged pull request')
    sys.exit(1 if c['scenario']=='merge-error-after-success' else 0)
elif a and a[0] == 'api':
    endpoint = next((v for v in a[1:] if v.startswith('repos/')), '')
    if endpoint.endswith('/update-branch'): c['updated']=True; save(); output({'message':'Updating'})
    elif '/actions/runs?' in endpoint: output(0)
    elif '/git/refs/' in endpoint: output({'object':{'sha':'a'*40}})
    else: print('unexpected API call: '+repr(a), file=sys.stderr); sys.exit(1)
else: print('unexpected gh call: '+repr(a), file=sys.stderr); sys.exit(1)
'''

class MergeSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='merge-wave-test-')
        self.root = pathlib.Path(self.tmp.name)
        self.repo = self.root / 'repo'; self.repo.mkdir()
        subprocess.run([REAL_GIT,'init','-q','-b','local-test',str(self.repo)],check=True)
        subprocess.run([REAL_GIT,'-C',str(self.repo),'remote','add','origin','https://github.com/acme/widgets.git'],check=True)
        self.bin = self.root/'bin'; self.bin.mkdir()
        self.fixture=self.root/'fixture.json'; self.calls=self.root/'calls.jsonl'
        self.fixture.write_text(json.dumps({'scenario':'merged','base':'main'}))
        (self.bin/'gh').write_text(GH)
        (self.bin/'sleep').write_text('#!/bin/sh\nexit 0\n')
        (self.bin/'git').write_text('#!/usr/bin/env python3\nimport json, os, sys\na=sys.argv[1:]\nif "fetch" in a or "merge" in a:\n with open(os.environ["CALLS"],"a") as f: f.write(json.dumps(["git"]+a)+"\\n")\n sys.exit(0)\nos.execv('+repr(REAL_GIT)+',['+repr(REAL_GIT)+']+a)\n')
        for p in self.bin.iterdir(): p.chmod(0o755)
        self.env={**os.environ,'PATH':str(self.bin)+os.pathsep+os.environ['PATH'],'FIXTURE':str(self.fixture),'CALLS':str(self.calls)}
    def tearDown(self): self.tmp.cleanup()
    def run_merge(self, scenario='merged', args=None, base='main', json_mode=True):
        self.fixture.write_text(json.dumps({'scenario':scenario,'base':base}))
        cmd=['bash',SCRIPT,str(self.repo)]+(args or ['1'])+(['--json'] if json_mode else [])
        self.result=subprocess.run(cmd,env=self.env,text=True,capture_output=True,timeout=15)
        self.log=[json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []
        self.merges=[a for a in self.log if a[:2]==['pr','merge']]
        self.deletes=[a for a in self.log if 'DELETE' in a]
        return self.result
    def report(self):
        path=self.repo/'.claude/merge-wave.result.json'
        self.assertTrue(path.exists(),'structured merge evidence was not written')
        data=json.loads(path.read_text())
        self.assertEqual(json.loads(self.result.stdout), data)
        return data
    def test_queued_is_pending_and_stops_serial_wave(self):
        r=self.run_merge('queued',['1','2'])
        self.assertEqual(r.returncode,3,r.stderr)
        self.assertEqual(len(self.merges),1)
        self.assertEqual(self.deletes,[])
        self.assertEqual((self.repo/'.claude/merge-wave.status').read_text(),'pending:3\n')
        d=self.report(); self.assertEqual(d['outcome'],'pending'); self.assertEqual(d['results'][0]['state'],'OPEN')
    def test_verified_merge_has_head_and_commit_evidence(self):
        r=self.run_merge(); self.assertEqual(r.returncode,0,r.stderr)
        d=self.report(); self.assertEqual(d['outcome'],'merged')
        p=d['results'][0]; self.assertEqual(p['state'],'MERGED'); self.assertEqual(p['reviewedHead'],SHA); self.assertEqual(p['head'],SHA); self.assertEqual(p['mergeCommit'],MERGE)
        self.assertEqual(self.merges[0][self.merges[0].index('--match-head-commit')+1],SHA)
    def test_merge_success_with_wrong_observed_head_blocks(self):
        r=self.run_merge('merged-wrong-head'); self.assertEqual(r.returncode,1); self.assertEqual(self.deletes,[])
        self.assertEqual(self.report()['outcome'],'blocked')
    def test_foreign_url_rejected_before_any_pr_merges(self):
        r=self.run_merge(args=['1','https://github.com/foreign/widgets/pull/2'])
        self.assertNotEqual(r.returncode,0); self.assertEqual(self.merges,[])
    def test_malformed_pr_rejected(self):
        r=self.run_merge(args=['release-123']); self.assertNotEqual(r.returncode,0); self.assertEqual(self.merges,[])
    def test_foreign_origin_rejected(self):
        subprocess.run([REAL_GIT,'-C',str(self.repo),'remote','set-url','origin','https://evil.test/acme/widgets'],check=True)
        r=self.run_merge(); self.assertNotEqual(r.returncode,0); self.assertEqual(self.merges,[])
    def test_base_mismatch_blocks(self):
        r=self.run_merge('wrong-base'); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
    def test_default_branch_is_resolved(self):
        r=self.run_merge(base='develop'); self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.report()['base'],'develop')
        self.assertTrue(any(a[0]=='git' and a[-3:]==['fetch','origin','develop'] for a in self.log))
    def test_optional_failure_without_required_checks_can_merge(self):
        r=self.run_merge('optional-red'); self.assertEqual(r.returncode,0,r.stderr); self.assertEqual(len(self.merges),1)
    def test_explicit_reviewed_head_mismatch_blocks(self):
        r=self.run_merge(args=['--expected-head','1='+OTHER,'1']); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
    def test_head_change_during_checks_requires_reapproval(self):
        r=self.run_merge('head-change'); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
        self.assertIn('reapproval',self.report()['results'][0]['reason'])
    def test_base_change_during_checks_blocks(self):
        r=self.run_merge('base-change'); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
    def test_update_branch_binds_old_head_and_requires_reapproval(self):
        r=self.run_merge('behind'); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
        updates=[a for a in self.log if any(x.endswith('/update-branch') for x in a)]
        self.assertEqual(len(updates),1); self.assertIn('expected_head_sha='+SHA,updates[0])
        p=self.report()['results'][0]; self.assertEqual(p['head'],OTHER); self.assertIn('reapproval',p['reason'])
    def test_already_merged_different_reviewed_head_blocks(self):
        r=self.run_merge('already-merged-wrong-head',['1','--expected-head',SHA]); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
    def test_missing_merge_commit_is_not_completion(self):
        r=self.run_merge('missing-merge-evidence'); self.assertEqual(r.returncode,1)
    def test_expected_head_per_pr_and_base_options(self):
        r=self.run_merge(args=['--expected-base','develop','--expected-head','1='+SHA,'--expected-head','2='+SHA,'1','2'],base='develop')
        self.assertEqual(r.returncode,0,r.stderr); self.assertEqual(len(self.merges),2)
        self.assertEqual(len(self.report()['results']),2)
    def test_malformed_expected_head_rejected_before_mutation(self):
        r=self.run_merge(args=['1','--expected-head','2=nope','2']); self.assertNotEqual(r.returncode,0); self.assertEqual(self.merges,[])
    def test_failed_cli_but_verified_merged_is_success(self):
        r=self.run_merge('merge-error-after-success'); self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual(self.report()['outcome'],'merged')
    def test_required_failure_still_blocks(self):
        r=self.run_merge('required-red'); self.assertEqual(r.returncode,1); self.assertEqual(self.merges,[])
    def test_invalid_followup_replaces_stale_success_evidence(self):
        self.assertEqual(self.run_merge().returncode,0)
        r=self.run_merge(args=['1','--unknown'])
        self.assertEqual(r.returncode,2)
        self.assertEqual((self.repo/'.claude/merge-wave.status').read_text(),'failed:2\n')
        self.assertEqual(self.report()['outcome'],'blocked')
    def test_empty_expected_base_is_invalid(self):
        r=self.run_merge(args=['1','--expected-base',''])
        self.assertEqual(r.returncode,2); self.assertEqual(self.merges,[])
    def test_legacy_positional_call_remains_supported(self):
        r=self.run_merge(json_mode=False); self.assertEqual(r.returncode,0,r.stderr)
        self.assertEqual((self.repo/'.claude/merge-wave.status').read_text(),'ok\n')

suite=unittest.defaultTestLoader.loadTestsFromTestCase(MergeSafety)
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
PY
