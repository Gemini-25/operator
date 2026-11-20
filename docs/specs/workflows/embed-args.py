#!/usr/bin/env python3
"""package-run.js 에 실행 인자를 박은 대본을 만든다 (Workflow 도구에 scriptPath 로 넘길 파일).

인자(args/<묶음>.json)는 길어서 손으로 다시 치면 한 글자가 달라질 수 있다. 이 도구는
  - "scratch" 를 지금 세션의 scratchpad 로,
  - 주 브랜치 이름을 지금 세션의 브랜치로(인자 안의 모든 자리 — priorNotes · 덩어리마다의 pre),
  - "attr"(커밋 끝줄)를 지금 세션의 것으로,
  - (주면) "base" 를
바꾼 뒤 package-run.js 의 `const P = args` 한 줄을 그 인자로 바꾼 사본을 쓴다.

쓰는 법 (저장소 루트에서):
  python3 docs/specs/workflows/embed-args.py docs/specs/workflows/args/I1-b-next.json \
      --scratch <세션 scratchpad 절대 경로> \
      --branch  <지금 세션의 주 브랜치>      # 인자를 저장한 세션의 브랜치와 같으면 빼도 된다
      --attr-file <커밋 끝줄 두 줄을 적은 파일> \
      --out <scratchpad>/wf-run-<묶음>.js

그 다음 Workflow 도구에 { scriptPath: "<--out 의 경로>" } 만 넘긴다(args 없이).
멈춘 워크플로를 이을 때는 같은 사본 + resumeFromRunId (사본을 다시 만들면 글자가 같아야 이어진다).

--save <경로> 를 주면 바꾼 인자를 JSON 으로도 남긴다(attr 는 자리표시로 — 저장소에는 세션의 끝줄을 넣지 않는다).
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ATTR_PLACEHOLDER = '<커밋 끝줄 — embed-args.py --attr-file 로 넣는다>'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('args_json')
    ap.add_argument('--scratch', required=True, help='세션 scratchpad 절대 경로')
    ap.add_argument('--out', required=True, help='만들 대본 경로 (저장소 밖 — scratchpad)')
    ap.add_argument('--branch', help='지금 세션의 주 브랜치 (인자 안의 옛 주 브랜치 이름을 모두 바꾼다)')
    ap.add_argument('--old-branch', default='claude/great-ptolemy-s31sxn', help='인자를 저장한 세션의 주 브랜치')
    ap.add_argument('--attr-file', help='커밋 끝줄을 적은 파일 (없으면 인자의 attr 그대로 — 자리표시면 멈춘다)')
    ap.add_argument('--base', help='git diff 의 기준 커밋을 바꿀 때')
    ap.add_argument('--script', default=os.path.join(HERE, 'package-run.js'))
    ap.add_argument('--save', help='바꾼 인자를 JSON 으로도 저장할 경로 (attr 는 자리표시)')
    o = ap.parse_args()

    text = open(o.args_json, encoding='utf-8').read()
    if o.branch and o.branch != o.old_branch:
        n = text.count(o.old_branch)
        text = text.replace(o.old_branch, o.branch)
        print(f'주 브랜치 이름 {n}곳: {o.old_branch} → {o.branch}')
    a = json.loads(text)
    a['scratch'] = o.scratch
    if o.base:
        a['base'] = o.base
    if o.attr_file:
        a['attr'] = open(o.attr_file, encoding='utf-8').read().strip()
    if not a.get('attr') or a['attr'].startswith('<'):
        print('attr(커밋 끝줄)가 비어 있다 — --attr-file 로 지금 세션의 끝줄을 넣는다', file=sys.stderr)
        return 2

    src = open(o.script, encoding='utf-8').read()
    if src.count('const P = args') != 1:
        print('대본에 `const P = args` 가 한 번 있어야 한다', file=sys.stderr)
        return 2
    body = json.dumps(a, ensure_ascii=False).replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    os.makedirs(os.path.dirname(os.path.abspath(o.out)), exist_ok=True)
    open(o.out, 'w', encoding='utf-8').write(src.replace('const P = args', 'const P = ' + body))

    if o.save:
        b = dict(a)
        b['attr'] = ATTR_PLACEHOLDER
        open(o.save, 'w', encoding='utf-8').write(json.dumps(b, ensure_ascii=False, indent=2) + '\n')

    print(f'대본: {o.out}')
    print(f"묶음 {a.get('id')} · 가리킴 wf/{a.get('key')} · base {a.get('base')} · 포트 {a.get('port')} · only {a.get('only', '(없음 — 구현 → 검토 → 문서)')}")
    print('덩어리: ' + (' → '.join(c['id'] for c in a.get('chunks', [])) or '(없음 — 검토 → 문서만)'))
    print(f"앞 보고 {len(a.get('priorReports', []))}건")
    print(f"띄우기 전에: git branch -f wf/{a.get('key')} <시작할 커밋>   # 가리킴 브랜치가 없으면 base 에서 갈라진다")
    return 0


if __name__ == '__main__':
    sys.exit(main())
