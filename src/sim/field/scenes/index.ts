// 묶음별 파일을 불러 등록시킨다 (sceneManager 가 이 파일을 import 한다).
import './crime';
import './major';
import './disaster';
import '../rules/crime';
import '../rules/major';
import '../rules/disaster';
import '../orders/crime';
import '../orders/major';
import '../orders/disaster';
import '../rules/injury';      // (H1) 부상과 사망
import '../orders/injury';
import '../rules/catastrophe';      // (X6) 위험의 현실화 — 부상 규칙 다음, 상공의 헬기 앞
import '../orders/catastrophe';      // (X6 단계 5) 위험 단계·진입 금지 구역·철수·외부 방어·막는 조치 — 부상의 지휘 규칙 다음 (문 registerGate 도 여기서 등록한다)
import '../rules/smoke';      // (I1-b b3-11 C5) 연기 자리의 실외 노출 — 위험(X6) 다음, 상공의 헬기 앞 (연기가 없는 교대에는 첫 줄에서 돌아간다. 대응 방법의 규칙이 세계 규칙의 맨 끝이고, 교본이 이 파일의 끝이다)
import '../rules/air';      // (R1) 상공의 헬기 — 마지막에 돈다
import '../rules/methods';      // (R2) 대응 방법 — 상공의 헬기 다음, 맨 끝 (단계 0: 물 현장의 물살·안벽 표시만. 설계서 §3.5·§9)
import '../orders/methods';      // (R2) 단계 0 에는 아무것도 등록하지 않는다
import '../doctrine/index';      // (R3) 대응 교본의 줄 (common → police → fire → ems → special). 단계 0 에는 줄이 없다
import '../orders/doctrine';      // (R3) 지휘 교본. 단계 0 에는 아무것도 등록하지 않는다
