#!/usr/bin/env python3
"""워크플로의 journal.jsonl 에서 끝난 작업자의 보고를 꺼내 인계용 마크다운으로 남긴다.

package-run.js 의 작업자(구현 덩어리·독립 검토·문서)는 구조화된 보고를 돌려주고, 워크플로는 그것을
journal.jsonl 에 `{"type":"result", "agentId":…, "result":{…}}` 한 줄로 적는다. 주 세션은 덩어리가 관문을
통과할 때마다 그 보고를 docs/handover/reports/<묶음>-<덩어리>.md 로 남기고 그 커밋을 주 브랜치에 합친다
(docs/specs/workflows/README.md "주 세션이 하는 일").

쓰는 법 (저장소 루트에서):
  python3 docs/specs/workflows/save-report.py <journal.jsonl>                     # 끝난 작업자 목록만 본다
  python3 docs/specs/workflows/save-report.py <journal.jsonl> --label impl:causality:h3 \
      --title "I1-b 단계 b3-7 (건물의 노출 + L2 옮겨붙는 불)" \
      --note "가리킴 wf/causality, 덩어리 h3, 인자 docs/specs/workflows/args/I1-b-next.json" \
      --out docs/handover/reports/I1b-h3.md

journal.jsonl 은 Workflow 도구가 띄울 때 알려 주는 "Transcript dir" 안에 있다.
"""
import argparse
import json
import sys

SECTIONS = [
    ('done', '끝낸 것'),
    ('notDone', '하지 못한 것'),
    ('deviations', '설계서와 다르게 한 곳'),
    ('sharedEdits', '설계서 밖의 공용 파일을 고친 곳'),
    ('results', '결과'),
    ('issues', '알려진 문제 · 다음 작업자가 알아야 할 것'),
]


def load(path):
    started, results = {}, {}
    order = []
    for line in open(path, encoding='utf-8'):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if d.get('type') == 'started':
            started[d.get('agentId')] = d.get('label', '')
            order.append(d.get('agentId'))
        elif d.get('type') == 'result':
            results[d.get('agentId')] = d.get('result')
    return started, results, order


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('journal')
    ap.add_argument('--label', help='작업자의 이름표 (예: impl:causality:h3 · review:causality · docs:causality)')
    ap.add_argument('--title', help='보고 문서의 제목')
    ap.add_argument('--note', default='', help='머리말에 덧붙일 한 줄 (가리킴 브랜치 · 덩어리 · 인자 파일)')
    ap.add_argument('--out', help='쓸 마크다운 경로')
    o = ap.parse_args()

    started, results, order = load(o.journal)
    if not o.label:
        for aid in order:
            r = results.get(aid)
            state = '도는 중(또는 멈춤)' if r is None else ('보고 없음' if not isinstance(r, dict) else f"끝남 · commit {str(r.get('commit'))[:40]} · 관문 {'통과' if r.get('checkPassed') else '통과하지 못함'}")
            print(f'{started[aid]:32s} {state}')
        return 0

    ids = [aid for aid in order if started[aid] == o.label and isinstance(results.get(aid), dict)]
    if not ids:
        print(f'{o.label}: 끝난 보고가 없다', file=sys.stderr)
        return 1
    r = results[ids[-1]]
    out = [f"# {o.title or o.label} — 작업자의 보고", '']
    head = f"워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`{o.label}`) 보고를 그대로 옮겼다. 끝 커밋 `{str(r.get('commit'))[:60]}`(브랜치 `{r.get('branch')}`), 관문 {'통과' if r.get('checkPassed') else '**통과하지 못함**'}(`checkPassed: {str(bool(r.get('checkPassed'))).lower()}`)."
    if o.note:
        head += ' ' + o.note
    out += [head, '', '정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.', '']
    for key, title in SECTIONS:
        v = r.get(key)
        out += ['', f'## {title}', '']
        if isinstance(v, list):
            out += [('- ' + str(x).replace('\n', '\n  ')) for x in v] or ['- (없음)']
        else:
            out.append(str(v if v is not None else '(없음)'))
    text = '\n'.join(out) + '\n'
    if o.out:
        open(o.out, 'w', encoding='utf-8').write(text)
        print(f"{o.out} ({len(text.splitlines())}줄) · commit {str(r.get('commit'))[:40]} · 관문 {'통과' if r.get('checkPassed') else '통과하지 못함'}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
