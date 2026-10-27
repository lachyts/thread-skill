// pyFlags that run a script with every os.walk level listed in reverse order. CI's ext4 lists a directory's entries
// in hash order, seeded per file system, so a new runner image reorders them, while the Mac's order happened to
// suit the tests: a test that pins an order built from a walk must force an order other than the sorted one, or it
// proves nothing locally. The wrapper sorts `dirs` in place, so the walk still follows a caller's later
// `dirs[:] = ...`.
// Use: spawnSync('python3', [...REVERSED_WALK, SCRIPT, ...args]).
const WRAPPER = [
  'import os, runpy, sys',
  'real = os.walk',
  'def walk(top, *a, **k):',
  '    for d, dirs, files in real(top, *a, **k):',
  '        dirs.sort(reverse=True)',
  '        files.sort(reverse=True)',
  '        yield d, dirs, files',
  'os.walk = walk',
  'sys.argv = sys.argv[1:]',
  'runpy.run_path(sys.argv[0], run_name="__main__")',
].join('\n')

export const REVERSED_WALK = ['-c', WRAPPER]
