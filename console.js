import { onSnapshot, runTransaction } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { escapeHTML as h, getCountdownState } from './app-utils.js';
import { timerPosition, roomConnectionStatus } from './state-sync.js';

export function mountConsole(api) {
    const root = document.getElementById('console-root');
    let mode = localStorage.getItem('gaga-screen-mode') || (innerWidth < 700 ? 'phone' : 'classic');
    let page = 'players', selected = new Set(), roomCode = '', role = '', unsubscribe = null, room = null;
    let sending = false, queuedState = null, publishTimer, lastApplied = -1, message = '', focusedMatch = -1;
    let pendingRestore = null, restoringConnection = false;
    let client = sessionStorage.getItem('gaga-device');
    if (!client) { client = crypto.randomUUID(); sessionStorage.setItem('gaga-device', client); }
    const button = (label, action, args = [], extra = '') => `<button type="button" data-action="${action}" data-args="${h(JSON.stringify(args))}" ${extra}>${label}</button>`;
    root.innerHTML = `<div class="console-tools"><button id="console-toggle" type="button" aria-expanded="false">진행 도구</button><span id="console-link-state" role="status"></span></div>
      <section id="console-settings" hidden aria-label="화면과 연결 설정">
        <h2>가가볼 진행 도구</h2><p id="console-settings-status" role="status"></p>
        <label>화면 <select id="console-mode"><option value="classic">기존 화면</option><option value="phone">스마트폰 단독</option><option value="remote">스마트폰 리모컨</option><option value="tv">TV 표시</option></select></label>
        <div id="console-connection"><p>같은 교사 계정으로 로그인한 기기를 연결합니다.</p>
          ${button('TV 연결 코드 만들기', 'host')}<label>연결 코드 <input id="console-code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="8자리 코드"></label>
          ${button('리모컨 연결', 'join')}${button('연결 해제', 'disconnect')}<strong id="console-code-display"></strong></div>
        <label>TV 글자 <select id="console-text"><option value="normal">기본</option><option value="large">크게</option></select></label>
        <label>순위 배치 <select id="console-columns"><option value="auto">자동</option><option value="5">TV 5열 고정</option></select></label>
        <label>순위 전환 <select id="console-interval"><option value="6000">6초</option><option value="10000">10초</option><option value="0">수동</option></select></label>
        ${button('소리 켜고 시작', 'unlock')}${button('전체 화면', 'fullscreen')}
        <div class="console-backups">${button('학급 백업 내려받기', 'backup')}${button('직전 안전 백업', 'safety')}${button('미저장 임시본 내려받기', 'draft')}${button('서버 기록 다시 불러오기', 'reloadCloud')}
        <label class="console-file">백업 복원<input id="console-import" type="file" accept="application/json,.json"></label></div>
        ${button('닫기', 'settings')}</section>
      <main id="teacher-console" hidden>
        <header><p class="console-eyebrow">DONGSAN · TEACHER</p><h1>가가볼 콜로세움</h1>
          <div class="console-topline"><label>학급 <select id="console-class"><option value="">학급 선택</option></select></label><span id="console-save" role="status"></span></div>
        </header>
        <p id="console-notice" role="status"></p>
        <div class="console-quick">${button('되돌리기', 'undo')}${button('저장 재시도', 'retry')}${button('소리 켜기', 'unlock')}</div>
        <section id="console-page"></section>
        <nav aria-label="진행 메뉴">${['players', 'teams', 'game', 'records'].map((key, i) => button(['선수', '팀', '경기', '기록'][i], 'page', [key])).join('')}</nav>
      </main>`;
    const $ = id => document.getElementById(id);
    function settings(show = true) { $('console-settings').hidden = !show; $('console-toggle').setAttribute('aria-expanded', String(show)); }
    function setMode(next) {
        mode = next; localStorage.setItem('gaga-screen-mode', mode);
        document.documentElement.dataset.console = ['phone', 'remote'].includes(mode) ? 'compact' : mode;
        window.gagaCompact = ['phone', 'remote'].includes(mode);
        api.setOutput(mode === 'remote'); $('console-mode').value = mode; render();
    }
    const rememberConnection = () => sessionStorage.setItem('gaga-connection', JSON.stringify({ uid: api.get().userId, roomCode, role }));
    function render() {
        const state = api.get();
        root.hidden = !state.userId;
        $('teacher-console').hidden = !window.gagaCompact || !state.userId;
        $('console-save').textContent = window.gagaSyncStatus || '불러오는 중';
        $('console-notice').textContent = message || state.syncError || (mode === 'remote' && !roomCode ? '진행 도구에서 TV 연결 코드를 입력해주세요.' : '');
        $('console-settings-status').textContent = message || state.syncError || '';
        const { connected, acknowledged } = roomConnectionStatus(room, role);
        $('console-link-state').textContent = roomCode ? `${roomCode} · ${connected ? '연결됨' : '상대 기기 연결 대기'}${acknowledged ? ' · TV 적용 완료' : ''}` : '';
        $('console-code-display').textContent = role === 'tv' ? `연결 코드: ${roomCode}` : '';
        const classOptions = '<option value="">학급 선택</option>' + state.classes.map(name => `<option value="${h(name)}">${h(name)}</option>`).join('');
        if ($('console-class').innerHTML !== classOptions) $('console-class').innerHTML = classOptions;
        $('console-class').value = state.currentClass;
        if (!window.gagaCompact) return;
        const students = state.students;
        selected = new Set([...selected].filter(no => students.some(s => s.no === no && s.attendance)));
        const score = s => `<div class="console-score">${button('−', 'changeGagaScore', [s.no, -1], `aria-label="${h(s.name)} 1점 빼기"`)}<b>${s.score || 0}</b>${button('+', 'changeGagaScore', [s.no, 1], `aria-label="${h(s.name)} 1점 더하기"`)}</div>`;
        const rosterRow = s => `<article class="console-student"><label><input type="checkbox" data-select="${s.no}" ${selected.has(s.no) ? 'checked' : ''} ${!s.attendance ? 'disabled' : ''}><strong>${h(s.name)}</strong></label><small>${s.isReferee ? '심판 · ' : ''}${s.gagaDrawn ? '출전 완료' : '대기'}</small>${score(s)}${button(s.attendance ? '참석' : '불참', 'toggleAttendance', [s.no], `class="attendance ${s.attendance ? '' : 'absent'}"`)}</article>`;
        let html = '';
        if (!state.currentClass) html = '<div class="console-empty">위에서 학급을 선택해주세요.<br>명단 관리는 기존 화면의 학급 설정에서 할 수 있습니다.</div>';
        else if (page === 'players') html = `<div class="console-section-heading"><h2>참가 선수</h2><span>${students.filter(s => s.attendance).length}명 참석</span></div>
          <div class="console-draw"><label>추첨 인원 <select id="console-count">${Array.from({length:10},(_,i)=>`<option ${i===7?'selected':''}>${i+1}</option>`).join('')}</select></label><div>${button('전체 추첨','draw',['all'])}${button('남학생','draw',['남'])}${button('여학생','draw',['여'])}</div></div>
          <div class="console-selection"><span>${selected.size}명 선택</span>${button('심판 지정 / 해제','referee')}${button('왕중왕전','champions')}${button('선택 해제','clear')}</div>
          ${students.map(rosterRow).join('')}${button('추첨 기록 초기화','resetGagaDraw')}`;
        else if (page === 'teams') html = `<h2>팀 편성</h2><div class="console-draw"><label>팀 수 <select id="console-team-count">${[2,4,6,8].map(n=>`<option>${n}</option>`).join('')}</select></label>${button('밸런스 편성','teams')}</div>
          ${state.match.refereeWarning ? '<p class="console-warning">2팀전 예외: 모든 심판이 출전합니다.</p>' : ''}
          ${state.match.standby.length ? `<p>대기 심판: ${state.match.standby.map(s=>h(s.name)).join(', ')}</p>` : ''}
          ${state.match.teams.map(team => `<article class="console-team"><h3>${team.id}팀 <span>${team.score}점</span></h3><div class="console-team-members">${team.members.map(s=>button(`${s.isKing?'👑 ':''}${h(s.name)}${s.isReferee?' · 심판':''}`, 'toggleTeamKing',[team.id,s.no],`aria-pressed="${!!s.isKing}"`)).join('')}</div>
          <div class="console-row">${button('− 1점','addGagaTeamScore',[team.id,-1])}${button('+ 1점','addGagaTeamScore',[team.id,1])}${team.id%2 ? button('이 경기 보기','focus',[Math.floor((team.id-1)/2)]) : ''}</div></article>`).join('')}`;
        else if (page === 'game') {
          const players = state.match.players.map(no=>students.find(s=>s.no===no)).filter(Boolean);
          const teamGame = state.match.view === 'team';
          const playingTeams = state.match.teams.slice(Math.max(0,focusedMatch)*2, Math.max(0,focusedMatch)*2+2);
          const mission = state.match.view === 'team' ? state.match.teamMissions[`team-roulette-${focusedMatch * 2}`] || state.match.teamMissions.global : state.match.individualMission;
          html = `<h2>${state.match.champions?'왕중왕전':teamGame?playingTeams.map(t=>`${t.id}팀`).join(' vs '):'개인전 진행'}</h2><div class="console-timer"><span id="console-timer-state">준비</span><strong id="console-timer-number">—</strong><div>${button('60초','openGagaTimer',[60])}${button('100초','openGagaTimer',[100])}</div><div>${button('정지 / 계속','toggleGagaTimerPause')}${button('재시작','restartGagaTimer')}${button('종료','closeGagaTimer')}</div></div>
          <label class="console-volume">음량 <input id="console-volume" type="range" min="0" max="100" value="${Math.round(state.match.volume*100)}"></label>
          ${button('미션 추첨','mission',[],state.busy?'disabled':'')}${state.busy?'<p>미션 추첨 중…</p>':''}${mission?`<aside class="console-mission"><b>${h(mission.text)}</b><p>${h(mission.desc)}</p></aside>`:''}
          ${teamGame ? playingTeams.map(t=>`<article class="console-team"><h3>${t.id}팀 <span>${t.score}점</span></h3><p>${t.members.map(s=>`${s.isKing?'👑 ':''}${h(s.name)}`).join(' · ')}</p><div class="console-row">${button('− 1점','addGagaTeamScore',[t.id,-1])}${button('+ 1점','addGagaTeamScore',[t.id,1])}</div></article>`).join('') : players.map(s=>`<article class="console-student"><strong>${h(s.name)}${state.match.wanted.includes(s.no)?' · WANTED ★':''}</strong>${score(s)}</article>`).join('')}
          <div class="console-row">${!teamGame?button('선수 결과 보기','showDraw'):''}${button(teamGame?'다음 경기':'다음 추첨','next')}${button('명예의 전당','switchGagaTab',['rank'])}</div>`;
        } else html = `<h2>점수 기록</h2><p>현재 누적 개인 점수입니다.</p>${[...students].sort((a,b)=>b.score-a.score||a.no-b.no).map(s=>`<article class="console-student"><strong>${h(s.name)}</strong>${score(s)}</article>`).join('')}${button('TV에 순위 표시','switchGagaTab',['rank'])}${button('백업 내려받기','backup')}`;
        const values = Object.fromEntries(['console-count','console-team-count'].map(id=>[id,$(id)?.value]));
        $('console-page').innerHTML = html;
        for (const [id,value] of Object.entries(values)) if ($(id) && value) $(id).value=value;
        root.querySelectorAll('nav button').forEach(btn => btn.setAttribute('aria-current', JSON.parse(btn.dataset.args)[0] === page ? 'page' : 'false'));
        root.querySelector('[data-action="undo"]').disabled = !state.undo;
        if (mode === 'remote' && (!room || role !== 'controller' || !connected)) $('console-page').querySelectorAll('button,input,select').forEach(el=>el.disabled=true);
        tick();
    }
    function tick() {
        const timer = api.get().match.timer;
        if (!$('console-timer-number')) return;
        const state = timer ? getCountdownState(timerPosition(timer),timer.duration) : null;
        $('console-timer-number').textContent = state ? state.phase==='intro'?'준비':state.number : '—';
        $('console-timer-state').textContent = !timer?'시간 선택':state.phase==='done'?'경기 종료':timer.running?'경기 중':'일시정지';
    }
    function download(value, name) {
        if (!value) { message='저장된 백업이 없습니다.'; render(); return; }
        const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
        const a=document.createElement('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    async function editRoom(fn) {
        if (!navigator.onLine) throw new Error('인터넷 연결을 확인해주세요.');
        const code=roomCode, uid=api.get().userId;
        return runTransaction(api.db,async tx=>{
            const ref=api.schoolRef(), snap=await tx.get(ref), existing=snap.data()?.gagaRooms?.[code];
            const next=fn(existing,uid);
            const rooms = Object.fromEntries(Object.entries(snap.data()?.gagaRooms || {}).filter(([key,value]) => key === code || value.expiresAt > Date.now()));
            if (!rooms[code] && Object.keys(rooms).length >= 10) throw new Error('사용 중인 TV 연결이 많습니다. 기존 연결을 종료해주세요.');
            rooms[code] = next;
            tx.update(ref, { gagaRooms: rooms });
            return next;
        });
    }
    function listen() {
        unsubscribe?.(); lastApplied=-1;
        unsubscribe=onSnapshot(api.schoolRef(),snapshot=>{
            if(snapshot.metadata.hasPendingWrites) return;
            room=snapshot.data()?.gagaRooms?.[roomCode];
            if(!room || room.owner!==api.get().userId || room.expiresAt<Date.now()) { disconnect(false); message='연결이 종료되었습니다. 다시 연결해주세요.'; render(); return; }
            if(role==='controller' && room.controller!==client) { disconnect(false); message='다른 기기로 제어권이 변경되었습니다.'; render(); return; }
            window.gagaReadOnly = role === 'tv' && !!room.controller;
            applyReceivedState();
            render();
        },error=>{message=`연결 실패: ${error.message}`;render();});
    }
    function applyReceivedState() {
        const state = role === 'tv' && room?.seq > lastApplied ? room.state : pendingRestore;
        if (!state || !api.get().classes.includes(state.className)) return;
        pendingRestore = null;
        const sequence = room?.seq;
        if (role === 'tv') lastApplied = sequence;
        api.restoreMatch(state); focusTV(room?.focus ?? -1);
        restoringConnection = false;
        if (role === 'tv') editRoom(current=>({...current,tvAlive:Date.now(),tvSeenSeq:sequence})).catch(error=>{message=error.message;render();});
    }
    async function host() {
        if(roomCode) await disconnect();
        roomCode=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[n%32]).join('');
        const now=Date.now();
        try {
            await editRoom((existing,uid)=>{if(existing&&existing.expiresAt>now)throw new Error('코드 생성 충돌입니다. 다시 눌러주세요.');return {owner:uid,tv:client,tvAlive:now,controller:'',controllerAlive:0,expiresAt:now+4*3600000,seq:0,tvSeenSeq:0,state:null};});
            role='tv';rememberConnection();setMode('tv');listen();api.unlock();
        } catch(error) {roomCode='';throw error;}
    }
    async function join() {
        const code=$('console-code').value.trim().toUpperCase();
        if(!/^[A-Z2-9]{8}$/.test(code)) throw new Error('TV의 8자리 연결 코드를 입력해주세요.');
        if(roomCode) await disconnect(); roomCode=code;
        try {
            room=await editRoom((existing,uid)=>{
                if(!existing || existing.owner!==uid || existing.expiresAt<Date.now())throw new Error('같은 교사 계정인지, TV 연결 코드가 유효한지 확인해주세요.');
                if(existing.controller && existing.controller!==client && Date.now()-existing.controllerAlive<30000)throw new Error('다른 스마트폰이 제어 중입니다. 먼저 연결을 해제해주세요.');
                return {...existing,controller:client,controllerAlive:Date.now()};
            });
            role='controller';rememberConnection();setMode('remote');
            if(room.state?.className){pendingRestore=room.state;restoringConnection=true;applyReceivedState();}
            listen(); settings(false); queuePublish();
        } catch(error){roomCode='';throw error;}
    }
    async function disconnect(update=true) {
        if(update&&roomCode) await editRoom(existing=>{
            if(!existing)return {};
            return role==='tv'?{...existing,expiresAt:0}:{...existing,controller:'',controllerAlive:0};
        });
        unsubscribe?.();unsubscribe=null;roomCode='';room=null;role='';queuedState=null;pendingRestore=null;restoringConnection=false;clearTimeout(publishTimer);window.gagaReadOnly=false;sessionStorage.removeItem('gaga-connection');render();
    }
    function queuePublish() {
        if(role!=='controller'||restoringConnection)return;
        const state=api.get().match;
        if(!state.className)return;
        queuedState=state; clearTimeout(publishTimer);publishTimer=setTimeout(publish,120);
    }
    async function publish() {
        if(sending||!queuedState||role!=='controller')return;
        sending=true; const state=queuedState, code=roomCode;queuedState=null;
        let failed=false;
        try {await editRoom(current=>{
            if(!current||current.controller!==client||current.expiresAt<Date.now())throw new Error('제어 연결이 해제되었습니다.');
            return {...current,state,focus:focusedMatch,seq:current.seq+1,controllerAlive:Date.now()};
        });message='';}catch(error){failed=true;if(roomCode===code)queuedState=queuedState||state;message=`TV 전송 대기 · 재시도 중: ${error.message}`;render();}
        finally{sending=false;if(queuedState&&roomCode===code){clearTimeout(publishTimer);publishTimer=setTimeout(publish,failed?3000:120);}}
    }
    function focusTV(index) {
        focusedMatch=index;
        document.querySelectorAll('#gaga-team-matchups > div').forEach((element,i)=>element.classList.toggle('tv-match-hidden',index>=0&&index!==i));
    }
    async function resumeConnection() {
        let saved;
        try { saved = JSON.parse(sessionStorage.getItem('gaga-connection') || 'null'); } catch { sessionStorage.removeItem('gaga-connection'); return; }
        if (!saved || saved.uid !== api.get().userId || !['tv','controller'].includes(saved.role)) return;
        roomCode=saved.roomCode; role=saved.role; restoringConnection=true;
        try {
            room=await editRoom(current=>{
                if(!current||current.owner!==saved.uid||current.expiresAt<Date.now()||current[role==='tv'?'tv':'controller']!==client)throw new Error('이전 연결이 만료되었습니다. 다시 연결해주세요.');
                return {...current,[role==='tv'?'tvAlive':'controllerAlive']:Date.now()};
            });
            setMode(role==='tv'?'tv':'remote');
            if(role==='controller'&&room.state?.className){pendingRestore=room.state;applyReceivedState();}
            else restoringConnection=false;
            listen();message='이전 TV 연결을 복원했습니다.';render();
            if(role==='controller'&&!room.state?.className)queuePublish();
        }catch(error){await disconnect(false);message=error.message;render();}
    }
    async function action(name,args) {
        message='';
        if(['page','settings','backup','safety','draft','retry','reloadCloud','unlock','host','join','disconnect','fullscreen','clear'].includes(name)) {
            if(name==='page')page=args[0];
            if(name==='settings')settings($('console-settings').hidden);
            if(name==='clear')selected.clear();
            if(name==='backup')download(api.backup(),'gagaball-backup.json');
            if(name==='safety')download(api.safetyBackup(),'gagaball-safety-backup.json');
            if(name==='draft')download(api.draft(),'gagaball-unsaved-draft.json');
            if(name==='retry')api.retry();
            if(name==='reloadCloud')await api.reloadCloud();
            if(name==='unlock')api.unlock();
            if(name==='host')await host();if(name==='join')await join();if(name==='disconnect')await disconnect();
            if(name==='fullscreen')await document.documentElement.requestFullscreen();
            render();return;
        }
        if(mode==='remote'&&(!room||role!=='controller'||Date.now()-room.tvAlive>30000))throw new Error('TV 연결을 확인해주세요. 단독 진행은 화면 모드를 변경해주세요.');
        if(api.get().busy)throw new Error('미션 결과가 나올 때까지 기다려주세요.');
        if(name==='undo')api.undo();
        else if(name==='draw'){api.act('draw',args[0],$('console-count').value);page='game';}
        else if(name==='teams'){focusTV(-1);api.act('teams',$('console-team-count').value);}
        else if(name==='referee'||name==='champions'){api.act(name,[...selected]);if(name==='champions')page='game';}
        else if(name==='mission') {const team=api.get().match.view==='team';api.act('openRouletteModal',team?'team':'individual',team&&focusedMatch>=0?`team-roulette-${focusedMatch*2}`:null);}
        else if(name==='next'&&api.get().match.view!=='team'){api.act('closeGagaTimer');api.act('closeGagaDrawModal');api.act('switchGagaTab','score');page='players';}
        else if(name==='focus'||name==='next') {const count=Math.ceil(api.get().match.teams.length/2);if(!count)throw new Error('팀을 먼저 편성해주세요.');api.act('closeGagaTimer');api.act('closeGagaDrawModal');focusTV(name==='focus'?args[0]:(focusedMatch+1)%count);api.act('switchGagaTab','team');page='game';}
        else if(name==='showDraw'){const state=api.get().match;api.restoreMatch({...state,drawOpen:true});}
        else api.act(name,...args);
        queuePublish();render();
    }
    root.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target)return;action(target.dataset.action,JSON.parse(target.dataset.args||'[]')).catch(error=>{message=error.message;render();});});
    root.addEventListener('change',async event=>{
        const el=event.target;
        if(el.dataset.select){const no=Number(el.dataset.select);el.checked?selected.add(no):selected.delete(no);render();}
        if(el.id==='console-class'){selected.clear();await action('selectClass',[el.value]).catch(error=>{message=error.message;render();});}
        if(el.id==='console-mode'){if(roomCode)await disconnect().catch(()=>disconnect(false));setMode(el.value);}
        if(el.id==='console-text'){document.documentElement.dataset.tvText=el.value;localStorage.setItem('gaga-tv-text',el.value);}
        if(el.id==='console-columns'){window.gagaRankingColumns=el.value;window.renderGagaRanking();}
        if(el.id==='console-interval'){window.gagaRankInterval=Number(el.value);window.syncRankingAutoplay();}
        if(el.id==='console-import'&&el.files[0]){try{api.importBackup(JSON.parse(await el.files[0].text()));}catch(error){message=error.message;}el.value='';render();}
    });
    root.addEventListener('input',event=>{if(event.target.id==='console-volume'){api.act('setGlobalVolume',event.target.value);queuePublish();}});
    $('console-toggle').onclick=()=>settings($('console-settings').hidden);
    window.addEventListener('gaga-state',()=>{applyReceivedState();render();focusTV(focusedMatch);if(role==='controller'&&!room?.state?.className)queuePublish();});window.addEventListener('gaga-sync',()=>{$('console-save').textContent=window.gagaSyncStatus;});
    window.addEventListener('gaga-match',()=>{if(document.activeElement?.id!=='console-volume')render();queuePublish();});
    window.addEventListener('gaga-auth',()=>{if(!api.get().userId)disconnect(false);else resumeConnection();render();});
    window.addEventListener('offline',()=>{message='인터넷 연결 끊김 · 기기 임시 저장 중';render();});
    window.addEventListener('online',()=>{message='';if(queuedState)publish();render();});
    setInterval(tick,250);
    setInterval(()=>{if(!roomCode||!role)return;editRoom(current=>{
        if(!current||current.expiresAt<Date.now())throw new Error('연결이 만료되었습니다.');
        if(role==='controller'&&current.controller!==client)throw new Error('제어권이 변경되었습니다.');
        return {...current,[role==='tv'?'tvAlive':'controllerAlive']:Date.now()};
    }).catch(error=>{message=error.message;render();});render();},10000);
    document.documentElement.dataset.tvText=localStorage.getItem('gaga-tv-text')||'normal';
    setMode(mode);
}
