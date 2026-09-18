# 동산초 가가볼 콜로세움

교실 체육 수업에서 가가볼 참가자 추첨, 개인·팀 점수, 명예의 전당과 도장판을 관리하는 웹 앱입니다.

배포 주소: <https://dongsan-gagaball.vercel.app/>

## 로컬 확인

정적 파일 서버로 프로젝트 루트를 열어 사용합니다. JavaScript 검사는 다음 명령으로 실행할 수 있습니다.

```sh
npm run check
npm test
```

## 자체 카운트다운 타이머

60초·100초 타이머는 유튜브 연결 없이 저장소의 MP3와 일러스트를 사용합니다. 영어 “Three, Two, One, Go!” 3초 신호가 끝난 순간부터 경기 시간을 재며, 마지막 10초를 영어로 읽고 종료음을 냅니다. 일시정지·재시작·전체 화면을 지원하고, 화면 숫자는 음원의 재생 위치를 기준으로 표시합니다.

완성된 음원은 `sound/countdown-60s.mp3`, `sound/countdown-100s.mp3`입니다. 배경 그림은 `images/gagaball-colosseum-timer.png`와 모바일용 `images/gagaball-colosseum-timer-mobile.png`입니다. 음원은 자체 합성한 반주·효과음과 영어 TTS 음성으로 만들었으며 기존 유튜브 음원을 복제하지 않았습니다. 다시 제작하려면 Python에 `numpy`, `edge-tts`, `imageio-ffmpeg`를 설치한 뒤 `scripts/generate-timer-voices.py`, `scripts/build-timer-audio.py` 순서로 실행합니다. 이미 저장된 완성 MP3를 재생할 때에는 이 도구들이 필요하지 않습니다.

## Firestore 보안 설정

`firebaseConfig`의 API 키는 웹 앱 식별값이며 비밀번호가 아닙니다. 학생 명단 보호는 Firestore Security Rules가 담당합니다.

저장소의 `firestore.rules`는 `authorizedTeachers/{uid}` 문서가 있는 Google 로그인 사용자만 공용 학급 문서를 읽고 수정하도록 구성한 권장 규칙입니다.

적용 전 Firebase Authentication에서 교사 UID를 확인하고, Firebase Console의 Firestore에 다음 빈 문서를 관리자 권한으로 생성합니다.

```text
authorizedTeachers/<교사 UID>
```

그다음 Firebase Console의 Rules 화면에 `firestore.rules` 내용을 붙여 넣어 게시합니다. 교사 UID 문서를 먼저 만들지 않고 규칙을 게시하면 모든 사용자가 앱 데이터에 접근할 수 없으므로 순서를 지켜야 합니다.

## 데이터 주의사항

- 학급 데이터는 현재 하나의 공용 문서에 저장됩니다.
- 여러 번 빠르게 누른 같은 브라우저의 쓰기는 순서대로 저장됩니다.
- 여러 교사가 동시에 같은 학생을 수정하는 완전한 충돌 해결이 필요하다면 향후 학급·학생별 Firestore 문서로 분리하는 것이 좋습니다.
