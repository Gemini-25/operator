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
import '../rules/air';      // (R1) 상공의 헬기 — 마지막에 돈다
import '../rules/methods';      // (R2) 대응 방법 — 상공의 헬기 다음, 맨 끝 (단계 0: 물 현장의 물살·안벽 표시만. 설계서 §3.5·§9)
import '../orders/methods';      // (R2) 단계 0 에는 아무것도 등록하지 않는다
