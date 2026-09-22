#!/usr/bin/env bash
# Offline protocol-4 Stop-hook fixtures; this is not live Claude wake acceptance.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$HERE/../../../hooks/rollout-stop-driver.py" <<'PY'
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

DRIVER = Path(sys.argv.pop()).resolve()


class DriverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='rollout driver ')
        self.root = Path(self.tmp.name)
        self.record = self.root / 'private record with spaces'
        self.record.mkdir(mode=0o700)
        self.env = {**os.environ, 'ROLLOUT_DRIVER_STATE_DIR': str(self.root / 'driver')}
        self.state = {
            'protocolVersion': 4,
            'rolloutId': 'demo',
            'tasks': {'one': self.task('one')},
            'events': [],
            'execution': {
                'id': 'execution-one', 'status': 'running', 'epoch': 1,
                'scope': ['one'],
                'owner': {'harness': 'claude', 'session': 'native-session', 'account': 'test'},
                'pools': {'one': {'limit': {'calls': 10, 'verifierRuns': 10, 'recoveries': 1},
                                  'spent': {'calls': 0, 'verifierRuns': 0, 'recoveries': 0}}},
                'requests': {}, 'mergeHold': None,
            },
            'host': {'config': {'maxConcurrent': 2}, 'runs': {}, 'merges': {},
                     'release': {'host': {'path': '/not-executed/rollout-host.mjs'}}},
        }

    def tearDown(self):
        self.tmp.cleanup()

    def task(self, name):
        return {'id': name, 'status': 'open', 'member': True, 'pool': name,
                'dependsOn': [], 'conflicts': [], 'revision': {'hash': 'revision'},
                'attempts': [], 'landings': []}

    def save(self):
        path = self.record / 'state.json'
        path.write_text(json.dumps(self.state))
        path.chmod(0o600)

    def marker(self, **extra):
        return 'THREAD-EXECUTION: ' + json.dumps({
            'record': str(self.record), 'execution': self.state['execution']['id'], **extra})

    def run_driver(self, payload=None, save=True):
        if save:
            self.save()
        request = {'session_id': 'native-session', 'last_assistant_message': self.marker()}
        if payload is not None:
            request.update(payload)
        result = subprocess.run([sys.executable, str(DRIVER)], input=json.dumps(request),
                                text=True, capture_output=True, env=self.env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def assert_blocks(self, output):
        self.assertEqual(output.get('decision'), 'block', output)
        self.assertIn('execution-one', output['reason'])

    def assert_allows(self, output):
        self.assertNotIn('decision', output)

    def active(self, status='dispatched', child='native-child'):
        self.state['tasks']['one'].update(status='active', attempt={'id': 'attempt-one'})
        request = {'id': 'request-one', 'taskId': 'one', 'attemptId': 'attempt-one',
                   'status': status}
        if child is not None:
            request['childId'] = child
        self.state['host']['runs']['attempt-one'] = {
            'taskId': 'one', 'initialisation': 'ready', 'accepted': {},
            'snapshot': {'runId': 'run-one', 'status': 'waiting', 'requests': [request]},
        }
        if status != 'pending':
            self.state['execution']['requests']['request-one'] = request.copy()
        else:
            self.state['execution']['requests'].pop('request-one', None)

    def queue(self):
        self.state['tasks']['one'].update(status='waiting', approval={'digest': 'approval-one'})
        self.state['host']['merges']['approval-one'] = {
            'taskId': 'one', 'approval': 'approval-one', 'status': 'pending',
            'report': {'outcome': 'pending', 'results': [{'state': 'OPEN'}]},
        }

    def test_ready_work_continues_using_record_with_spaces(self):
        result = self.run_driver()
        self.assert_blocks(result)
        self.assertIn(str(self.record), result['reason'])
        self.assertNotIn('wave cursor', result['reason'].lower())

    def test_no_marker_and_v3_marker_are_ignored(self):
        for message in ['ordinary reply', 'WAVE-STATUS: demo cursor=1/2 state=running']:
            self.assertEqual(self.run_driver({'last_assistant_message': message}), {})

    def test_owner_and_marker_cannot_be_overridden(self):
        for field, value in [('harness', 'codex'), ('session', 'someone-else')]:
            with self.subTest(field=field):
                original = self.state['execution']['owner'][field]
                self.state['execution']['owner'][field] = value
                self.assert_allows(self.run_driver())
                self.state['execution']['owner'][field] = original
        for session in [None, '', 42]:
            self.assert_allows(self.run_driver({'session_id': session}))
        self.assert_allows(self.run_driver({'last_assistant_message': self.marker(execution='other')}))
        self.state['protocolVersion'] = 3
        self.assert_allows(self.run_driver())

    def test_terminal_record_wins_over_marker_and_never_resumes(self):
        for status in ['paused', 'stopped', 'ended']:
            with self.subTest(status=status):
                self.state['execution']['status'] = status
                self.assertEqual(self.run_driver({'last_assistant_message': self.marker(status='running')}), {})

    def test_unrecognised_execution_status_fails_closed(self):
        self.state['execution']['status'] = 'arbitrary'
        self.assert_allows(self.run_driver())

    def test_public_or_symlink_record_is_not_authority(self):
        self.save()
        self.record.chmod(0o755)
        self.assert_allows(self.run_driver(save=False))
        self.record.chmod(0o700)
        (self.record / 'state.json').chmod(0o644)
        self.assert_allows(self.run_driver(save=False))
        (self.record / 'state.json').chmod(0o600)
        alias = self.root / 'alias'
        alias.symlink_to(self.record, target_is_directory=True)
        self.assert_allows(self.run_driver({'last_assistant_message': self.marker(record=str(alias))}, save=False))
        target = self.root / 'private-state.json'
        (self.record / 'state.json').rename(target)
        (self.record / 'state.json').symlink_to(target)
        self.assert_allows(self.run_driver(save=False))

    def test_native_child_wait_allows_but_unbound_claim_needs_reconciliation(self):
        self.active()
        self.assertEqual(self.run_driver(), {})
        self.active('claimed', child=None)
        self.assert_blocks(self.run_driver())

    def test_pending_requests_and_accepted_results_continue(self):
        for status in ['pending', 'accepted']:
            with self.subTest(status=status):
                self.active(status, child=None if status == 'pending' else 'native-child')
                self.assert_blocks(self.run_driver())

    def test_native_capacity_wait_does_not_spin(self):
        self.active()
        self.state['host']['config']['maxConcurrent'] = 1
        self.state['tasks']['two'] = self.task('two')
        self.state['execution']['scope'].append('two')
        self.state['execution']['pools']['two'] = copy.deepcopy(self.state['execution']['pools']['one'])
        self.assertEqual(self.run_driver(), {})
        self.state['host']['config']['maxConcurrent'] = 2
        self.assert_blocks(self.run_driver())

    def test_pending_merge_queue_allows_and_new_review_continues(self):
        self.queue()
        self.assertEqual(self.run_driver(), {})
        self.state['tasks']['one']['status'] = 'review'
        self.state['host']['merges'] = {}
        self.assert_blocks(self.run_driver())

    def test_inactive_queue_needs_attention_is_reported_even_while_waiting(self):
        self.queue()
        self.state['host']['merges']['approval-one']['needsAttention'] = True
        output = self.run_driver()
        self.assert_allows(output)
        self.assertIn('incomplete', output.get('systemMessage', ''))
        self.assertIn('merge queue inactivity requires evidence reconciliation', output['systemMessage'])
        for status in ['paused', 'stopped', 'ended']:
            self.state['execution']['status'] = status
            self.assertEqual(self.run_driver(), {})

    def test_waiting_status_without_evidence_reports_incomplete(self):
        self.state['tasks']['one']['status'] = 'waiting'
        output = self.run_driver()
        self.assert_allows(output)
        self.assertIn('incomplete', output['systemMessage'])

    def test_pausing_drains_existing_work_and_settles_without_new_dispatch(self):
        self.state['execution']['status'] = 'pausing'
        self.active()
        self.assertEqual(self.run_driver(), {})
        self.active('pending', child=None)
        self.assert_blocks(self.run_driver())
        self.state['tasks']['one']['status'] = 'blocked'
        self.state['execution']['requests'] = {}
        self.state['host']['runs'] = {}
        self.assert_blocks(self.run_driver())

    def test_running_finished_or_blocked_work_settles_honestly(self):
        for status in ['complete', 'blocked']:
            with self.subTest(status=status):
                self.state['tasks']['one']['status'] = status
                self.assert_blocks(self.run_driver())

    def test_three_no_progress_blocks_then_explicit_incomplete_release(self):
        for count in range(3):
            self.state['events'].append({'sequence': count + 1, 'type': 'settle'})
            self.assert_blocks(self.run_driver())
        output = self.run_driver()
        self.assert_allows(output)
        self.assertIn('incomplete', output['systemMessage'].lower())
        self.assertIn('3', output['systemMessage'])
        self.assertIn('execution-one', output['systemMessage'])
        self.active('pending', child=None)
        self.assert_blocks(self.run_driver())

    def test_observed_terminal_state_clears_stall_counter_for_explicit_resume(self):
        for _ in range(3):
            self.assert_blocks(self.run_driver())
        self.assert_allows(self.run_driver())
        self.state['execution']['status'] = 'paused'
        self.assertEqual(self.run_driver(), {})
        # The hook never performs this transition: the test simulates explicit resume.
        self.state['execution']['status'] = 'running'
        self.assert_blocks(self.run_driver())

    def test_unwritable_counter_and_host_lock_report_incomplete(self):
        self.save()
        (self.record / '.host.lock').write_text('{}')
        output = self.run_driver(save=False)
        self.assert_allows(output)
        self.assertIn('incomplete', output['systemMessage'])
        (self.record / '.host.lock').unlink()
        counter = self.root / 'driver'
        counter.mkdir(mode=0o755)
        output = self.run_driver()
        self.assert_allows(output)
        self.assertIn('incomplete', output['systemMessage'])

    def test_hook_does_not_write_execution_state(self):
        self.save()
        before = (self.record / 'state.json').read_bytes()
        self.assert_blocks(self.run_driver(save=False))
        self.assertEqual((self.record / 'state.json').read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.record.iterdir()), ['state.json'])

    def test_transcript_fallback_uses_assistant_only_and_payload_marker_wins(self):
        transcript = self.root / 'transcript.jsonl'
        transcript.write_text(json.dumps({'type': 'user', 'message': {'content': self.marker()}}) + '\n')
        payload = {'last_assistant_message': 'forgot marker', 'transcript_path': str(transcript)}
        self.assertEqual(self.run_driver(payload), {})
        transcript.write_text(json.dumps({'type': 'assistant', 'message': {
            'content': [{'type': 'text', 'text': self.marker()}]}}) + '\n')
        self.assert_blocks(self.run_driver(payload))
        payload['last_assistant_message'] = self.marker(execution='stale-id')
        self.assert_allows(self.run_driver(payload))
        payload['last_assistant_message'] = 'THREAD-EXECUTION: {malformed'
        self.assert_allows(self.run_driver(payload))

    def test_stop_hook_active_does_not_skip_bounded_continuation(self):
        self.assert_blocks(self.run_driver({'stop_hook_active': True}))

    def test_newer_v3_marker_supersedes_older_v4_record(self):
        transcript = self.root / 'mixed.jsonl'
        transcript.write_text(json.dumps({'type': 'assistant', 'message': {'content': self.marker()}}) + '\n')
        payload = {'last_assistant_message': 'WAVE-STATUS: legacy cursor=0/2 state=running',
                   'transcript_path': str(transcript)}
        self.assertEqual(self.run_driver(payload), {})
        transcript.write_text(transcript.read_text() + json.dumps({'type': 'assistant', 'message': {
            'content': payload['last_assistant_message']}}) + '\n')
        payload['last_assistant_message'] = 'ordinary reply'
        self.assertEqual(self.run_driver(payload), {})


unittest.main(verbosity=2)
PY
