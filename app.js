import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==========================================
// 1. 오디오 통합 관리 (MP3 + Web Audio API)
// ==========================================
const audioFiles = {
    anthem: new Audio('sound/orchestral-anthem.mp3'),
    tadaa: new Audio('sound/tadaa01.mp3'),
    spinner: new Audio('sound/spinner01.mp3'),
    goodresult: new Audio('sound/goodresult.mp3')
};
audioFiles.anthem.loop = true;

window.playMP3 = function(key) {
    if (audioFiles[key]) {
        audioFiles[key].currentTime = 0;
        audioFiles[key].volume = 1;
        audioFiles[key].play().catch(e => console.log("오디오 재생 제한:", e));
    }
};

window.stopMP3 = function(key) {
    if (audioFiles[key]) {
        audioFiles[key].pause();
        audioFiles[key].currentTime = 0;
    }
};

window.fadeOutMP3 = function(key) {
    const audio = audioFiles[key];
    if (audio && !audio.paused) {
        let vol = audio.volume;
        let fadeInterval = setInterval(() => {
            if (vol > 0.05) {
                vol -= 0.05;
                audio.volume = vol;
            } else {
                clearInterval(fadeInterval);
                audio.pause();
                audio.currentTime = 0;
            }
        }, 50);
    }
};

let firstInteraction = false;
const handleFirstInteraction = () => {
    if (!firstInteraction && !currentClass) {
        firstInteraction = true;
        window.playMP3('anthem');
    }
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
};
document.body.addEventListener('click', handleFirstInteraction);
document.body.addEventListener('touchstart', handleFirstInteraction);

let audioCtx;
function initAudio() {
    if (!audioCtx) { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
    return audioCtx;
}

window.playCoinSound = function() {
    try {
        const ctx = initAudio();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(987.77, ctx.currentTime);
        osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

window.playBumpSound = function() {
    try {
        const ctx = initAudio();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

let confettiAnimationFrame;
let confettiParticles = [];
window.fireConfetti = function() {
    const canvas = document.getElementById('confetti-canvas');
    canvas.classList.remove('hidden');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    
    if(confettiAnimationFrame) cancelAnimationFrame(confettiAnimationFrame);
    confettiParticles = [];
    const colors = ['#fce18a', '#ff726d', '#b48def', '#f4306d', '#48b8d0', '#3498db', '#2ecc71', '#ffb74d'];

    for(let i = 0; i < 200; i++) {
        confettiParticles.push({
            x: canvas.width / 2, y: canvas.height / 2 + 150,
            r: Math.random() * 8 + 4, dx: Math.random() * 30 - 15, dy: Math.random() * -25 - 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            tilt: Math.floor(Math.random() * 10) - 10, tiltAngle: 0, tiltAngleInc: (Math.random() * 0.07) + 0.05
        });
    }
    
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let active = false;
        confettiParticles.forEach(p => {
            p.tiltAngle += p.tiltAngleInc;
            p.y += (Math.cos(p.tiltAngle) + 1 + p.r / 2) / 2;
            p.x += Math.sin(p.tiltAngle) * 2;
            p.dy += 0.3; p.y += p.dy; p.x += p.dx;
            if (p.y <= canvas.height) active = true;

            ctx.beginPath(); ctx.lineWidth = p.r; ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
            ctx.stroke();
        });
        if (active) confettiAnimationFrame = requestAnimationFrame(render);
        else { 
            cancelAnimationFrame(confettiAnimationFrame); 
            canvas.classList.add('hidden'); 
        }
    }
    render();
}

// ==========================================
// 2. 기본 상태 변수
// ==========================================
let currentClass = "";
let classData = {};
let groupScores = {}; 
let groupRecords = {}; 
let classStamps = {}; 
let currentTab = 'gagaball'; 
let hiddenClasses = []; 
window.championsSelection = []; 

window.lastTeamScoreChange = { teamId: null, val: 0, time: 0 };

const TOTAL_STAMP_CELLS = 20;
let defaultStampImg = "images/stamps/stamp01.jpg";
let globalStampImage = localStorage.getItem('customStamp') || defaultStampImg;
if (globalStampImage.startsWith("data:image/svg+xml")) globalStampImage = defaultStampImg;

const fallbackSVG = `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ccircle%20cx%3D%2250%22%20cy%3D%2250%22%20r%3D%2250%22%20fill%3D%22%23f1f2f6%22%2F%3E%3Ctext%20x%3D%2250%22%20y%3D%2268%22%20font-size%3D%2245%22%20text-anchor%3D%22middle%22%3E%F0%9F%91%A4%3C%2Ftext%3E%3C%2Fsvg%3E`;

window.generateCuteAvatar = function(student) {
    if (!student) return fallbackSVG;
    if (student.customAvatar) return student.customAvatar;
    const studentsInClass = classData[currentClass] || [];
    let sameGenderStudents = studentsInClass.filter(s => s.gender === student.gender);
    sameGenderStudents.sort((a, b) => a.no - b.no);
    let index = sameGenderStudents.findIndex(s => s.no === student.no);
    if (index === -1) index = 0; 
    let avatarIndex = index % 50; 
    let row = Math.floor(avatarIndex / 10) + 1;
    let col = (avatarIndex % 10) + 1; 
    let prefix = student.gender === '남' ? 'boy' : 'girl';
    return `images/avatars/${prefix}_${row}-${col}.png`;
}

window.toggleReferee = function(no) {
    const student = classData[currentClass].find(s => s.no == no);
    if(student) {
        student.isReferee = !student.isReferee;
        if(student.isReferee) window.playStampSound();
        saveData(); window.renderGagaRanking();
    }
}

window.toggleAttendance = function(no) {
    if(!currentClass || !classData[currentClass]) return;
    const student = classData[currentClass].find(s => s.no == no);
    if(student) {
        student.attendance = !student.attendance;
        if(!student.attendance) {
            student.gagaDrawn = false; 
        }
        saveData();
        window.renderGagaball();
        window.renderGagaRanking();
    }
};

// ==========================================
// 3. 파이어베이스 연동 로직
// ==========================================
let userId = null; 
let isDebouncing = false; 
let unsubscribeSnapshot = null;

if (auth && db) {
    window.signInWithGoogle = function() {
        const btn = document.getElementById('btn-login');
        btn.innerHTML = '로그인 중...';
        handleFirstInteraction();
        signInWithPopup(auth, provider).catch(() => {
            alert("로그인에 실패했습니다.");
            btn.innerHTML = 'Google 계정으로 시작하기';
        });
    };

    window.signOutApp = function() { if(confirm("로그아웃 하시겠습니까?")) signOut(auth); };

    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('user-email').innerText = user.email.split('@')[0];
            setupFirestoreListener();
        } else {
            userId = null;
            if(unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('app-container').classList.add('hidden');
            document.getElementById('class-selection-screen').classList.add('hidden');
            document.getElementById('class-selection-screen').classList.remove('flex');
            classData = {}; groupScores = {}; groupRecords = {}; classStamps = {}; hiddenClasses = [];
            currentClass = ""; 
        }
    });
}

function setupFirestoreListener() {
    if (!userId || !db) return;
    const docRef = doc(db, 'artifacts', 'running-measurement-app', 'sharedRooms', 'dongsan-school-db');
    if (unsubscribeSnapshot) unsubscribeSnapshot(); 
    const syncIcon = document.getElementById('sync-status');
    if(syncIcon) { syncIcon.classList.remove('hidden'); syncIcon.classList.add('flex'); }

    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (isDebouncing) return;
        if(syncIcon) { syncIcon.classList.add('hidden'); syncIcon.classList.remove('flex'); }
        if (docSnap.exists()) {
            const data = docSnap.data();
            classData = data.data || {}; groupScores = data.scores || {}; groupRecords = data.records || {}; classStamps = data.stamps || {};
            hiddenClasses = data.hiddenClasses || [];
            if (data.stampImage) { globalStampImage = data.stampImage; localStorage.setItem('customStamp', globalStampImage); document.querySelectorAll('.stamp-img').forEach(img => { img.src = globalStampImage; }); }
        }
        
        if (!currentClass) {
            window.openClassSelection();
        } else if (classData[currentClass]) {
            if(currentTab === 'gagaball') window.renderGagaball();
            if(currentTab === 'stamp') window.renderStampBoard();
        }
        window.renderClassSelect();
    }, (error) => {
        console.error("데이터 동기화 오류:", error);
        if(syncIcon) { syncIcon.classList.add('hidden'); syncIcon.classList.remove('flex'); }
    });
}

function saveData() {
    if (userId && db) {
        isDebouncing = true; 
        const syncIcon = document.getElementById('sync-status');
        if(syncIcon) { syncIcon.classList.remove('hidden'); syncIcon.classList.add('flex'); }
        const docRef = doc(db, 'artifacts', 'running-measurement-app', 'sharedRooms', 'dongsan-school-db');
        setDoc(docRef, { data: classData, scores: groupScores, records: groupRecords, stamps: classStamps, stampImage: globalStampImage, hiddenClasses: hiddenClasses }, { merge: true })
        .then(() => { isDebouncing = false; if(syncIcon) { syncIcon.classList.add('hidden'); syncIcon.classList.remove('flex'); } })
        .catch(() => { isDebouncing = false; if(syncIcon) { syncIcon.classList.add('hidden'); syncIcon.classList.remove('flex'); } });
    }
}

// ==========================================
// 4. 앱 UI 제어 및 학급 선택 로직
// ==========================================
window.openClassSelection = function() {
    document.getElementById('app-container').classList.add('hidden');
    document.getElementById('class-selection-screen').classList.remove('hidden');
    document.getElementById('class-selection-screen').classList.add('flex');
    window.renderStartupClassList();
};

window.renderStartupClassList = function() {
    const listEl = document.getElementById('startup-class-list');
    const classes = Object.keys(classData).sort().filter(cls => !(hiddenClasses || []).includes(cls));
    listEl.innerHTML = '';
    
    if (classes.length === 0) {
        listEl.innerHTML = '<div class="text-slate-500 font-bold col-span-full">표시할 학급이 없습니다. 아래 설정을 눌러 학급을 관리해주세요.</div>';
        return;
    }

    const grouped = {};
    classes.forEach(cls => {
        const match = cls.match(/^\d+/);
        const grade = match ? match[0] : '기타';
        if (!grouped[grade]) grouped[grade] = [];
        grouped[grade].push(cls);
    });

    Object.keys(grouped).sort((a,b) => (a==='기타'?1:0) - (b==='기타'?1:0) || parseInt(a) - parseInt(b)).forEach(grade => {
        const rowDiv = document.createElement('div');
        rowDiv.className = "flex flex-wrap justify-center gap-2 sm:gap-4 w-full";
        
        grouped[grade].forEach(cls => {
            const btn = document.createElement('button');
            btn.className = "px-4 py-2 sm:px-6 sm:py-3 bg-white/70 backdrop-blur-sm border-2 border-white/80 text-slate-800 font-black text-lg sm:text-3xl rounded-xl shadow-md hover:bg-white hover:scale-105 transition-all min-w-[100px] sm:min-w-[140px] shrink-0";
            btn.innerText = cls;
            btn.onclick = () => window.selectClass(cls);
            rowDiv.appendChild(btn);
        });
        listEl.appendChild(rowDiv);
    });
};

window.selectClass = function(className) {
    currentClass = className;
    window.fadeOutMP3('anthem');
    
    document.getElementById('class-selection-screen').classList.add('hidden');
    document.getElementById('class-selection-screen').classList.remove('flex');
    document.getElementById('app-container').classList.remove('hidden');
    
    const displayBtn = document.getElementById('current-class-display');
    if (displayBtn) displayBtn.innerHTML = `<span>🔄 ${className}</span>`;
    
    window.showTab(currentTab);
};

window.showTab = function(tabName) {
    currentTab = tabName;
    ['gagaball-section', 'stamp-section'].forEach(id => document.getElementById(id).classList.add('hidden'));

    const tabGaga = document.getElementById('tab-gagaball');
    const tabStamp = document.getElementById('tab-stamp');
    const gagaHeaderTabs = document.getElementById('gaga-header-tabs');

    if (tabName !== 'gagaball' || !document.getElementById('gaga-view-rank').classList.contains('hidden')) {
         window.fadeOutMP3('anthem');
    }
    window.hideFloatingRouletteBtn();

    if (tabName === 'gagaball') {
        document.getElementById('gagaball-section').classList.remove('hidden');
        tabGaga.className = "flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 rounded-xl font-bold text-sm transition text-white bg-slate-800 shadow-md border border-slate-800 transform scale-105 z-10 whitespace-nowrap";
        tabStamp.className = "flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 rounded-xl font-bold text-sm transition text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm whitespace-nowrap";
        
        if (gagaHeaderTabs) {
            gagaHeaderTabs.classList.remove('hidden');
            gagaHeaderTabs.classList.add('flex');
        }
        window.switchGagaTab('score'); 
    } else {
        document.getElementById('stamp-section').classList.remove('hidden');
        tabStamp.className = "flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 rounded-xl font-bold text-sm transition text-white bg-green-600 shadow-md border border-green-600 transform scale-105 z-10 whitespace-nowrap";
        tabGaga.className = "flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 rounded-xl font-bold text-sm transition text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm whitespace-nowrap";
        
        if (gagaHeaderTabs) {
            gagaHeaderTabs.classList.add('hidden');
            gagaHeaderTabs.classList.remove('flex');
        }
        window.renderStampBoard();
    }
}

// ==========================================
// 5. 가가볼 스코어보드 & 대진표
// ==========================================
window.switchGagaTab = function(tab) {
    ['score', 'rank', 'team'].forEach(t => {
        document.getElementById(`gaga-view-${t}`).classList.add('hidden');
        const btn = document.getElementById(`gaga-btn-${t}`);
        if(btn) {
            btn.classList.remove('bg-slate-100', 'text-slate-800', 'shadow-sm');
            btn.classList.add('text-slate-400', 'bg-transparent');
        }
    });
    document.getElementById(`gaga-view-${tab}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`gaga-btn-${tab}`);
    if(activeBtn) {
        activeBtn.classList.add('bg-slate-100', 'text-slate-800', 'shadow-sm');
        activeBtn.classList.remove('text-slate-400', 'bg-transparent');
    }

    if (tab !== 'rank') {
        window.championsSelection = []; 
        window.fadeOutMP3('anthem');
    }
    window.hideFloatingRouletteBtn();

    if(tab === 'score') window.renderGagaball();
    if(tab === 'rank') { 
        window.playMP3('anthem'); 
        window.renderGagaRanking(); 
    }
    if(tab === 'team') window.renderGagaTeamView();
}

window.changeDrawCount = function(delta) {
    const input = document.getElementById('gaga-draw-count');
    let val = parseInt(input.value) + delta;
    if(val < 1) val = 1;
    if(val > 10) val = 10;
    input.value = val;
}

window.renderGagaball = function() {
    const activeGrid = document.getElementById('gaga-active-grid');
    const inactiveGrid = document.getElementById('gaga-inactive-grid');
    if(!activeGrid || !currentClass || !classData[currentClass]) return;

    let availableTotal = 0, availableBoys = 0, availableGirls = 0;
    const students = [...classData[currentClass]].sort((a,b) => a.no - b.no);

    let activeHTML = ''; let inactiveHTML = '';

    students.forEach((s) => {
        const isDrawn = s.gagaDrawn; const drawnClass = isDrawn ? 'drawn' : '';
        const btnText = s.attendance ? '참석' : '불참';
        const btnClass = s.attendance ? 'bg-green-500 text-white' : 'bg-slate-400 text-white opacity-80';
        let borderStyle = s.gender === '남' ? '#3498db' : (s.gender === '여' ? '#e74c3c' : '#2ecc71');
        if(!s.attendance || isDrawn) borderStyle = '#95a5a6';

        if(s.attendance && !isDrawn) {
            availableTotal++; if(s.gender === '남') availableBoys++; if(s.gender === '여') availableGirls++;
        }
        let bgColor = s.attendance && !isDrawn ? (s.gender === '남' ? '#e3f2fd' : '#ffebee') : '#fff';
        const cuteAvatar = window.generateCuteAvatar(s); 

        const cardHTML = `
            <div class="score-item ${drawnClass}" style="border-color: ${borderStyle}; background-color: ${bgColor};">
                <div class="flex justify-between items-center mb-2 sm:mb-3 relative z-20">
                    <span class="font-mono font-bold text-slate-500 text-sm sm:text-lg">${s.no}번</span>
                    <button class="${btnClass} px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition hover:opacity-80" onclick="window.toggleAttendance(${s.no})">${btnText}</button>
                </div>
                
                <div class="avatar-wrapper relative w-[100px] h-[100px] sm:w-[120px] sm:h-[120px] mx-auto mb-3">
                    <img src="${cuteAvatar}" alt="avatar" class="w-full h-full rounded-full cursor-pointer hover:scale-105 transition-transform border-4 object-cover block bg-white" onclick="window.openAvatarSelectModal(${s.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" style="border-color: ${borderStyle};" title="아바타 변경">
                    ${isDrawn ? `
                    <div class="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-full bg-slate-900/40">
                        <img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Crect width='120' height='40' rx='8' fill='%23ef4444' stroke='white' stroke-width='3'/%3E%3Ctext x='60' y='27' font-family='sans-serif' font-size='22' font-weight='900' fill='white' text-anchor='middle'%3E뽑기완료%3C/text%3E%3C/svg%3E" class="transform -rotate-12 w-20 sm:w-28 drop-shadow-md">
                    </div>
                    ` : ''}
                </div>

                <div class="name relative z-20">${s.name} <span class="text-xs sm:text-lg">(${s.gender})</span></div>
                <div class="score-val relative z-20">${s.score || 0}</div>
                <div class="score-ctrl relative z-20">
                    <button class="minus hover:bg-red-600" onclick="window.changeGagaScore(${s.no}, -1)">-</button>
                    <button class="hover:bg-blue-600" onclick="window.changeGagaScore(${s.no}, 1)">+</button>
                </div>
            </div>
        `;
        if(s.attendance) activeHTML += cardHTML; else inactiveHTML += cardHTML;
    });

    activeGrid.innerHTML = activeHTML;
    inactiveGrid.innerHTML = inactiveHTML;
    document.getElementById('gaga-draw-stats').innerText = `대기: 총 ${availableTotal}명 (남 ${availableBoys} / 여 ${availableGirls})`;
};

window.changeGagaScore = function(no, val) {
    const student = classData[currentClass].find(s => s.no == no); if(!student) return;
    if (val > 0) window.playCoinSound(); else window.playBumpSound();
    student.score = Math.max(0, (student.score || 0) + val);
    
    saveData(); 
    window.renderGagaball(); window.renderGagaRanking(); 
    const modalSpan = document.getElementById(`modal-score-${no}`); if(modalSpan) modalSpan.innerText = student.score;
}

window.resetAllScoresDB = function() {
    if(!currentClass) return;
    if(confirm("모든 학생의 개인 점수와 팀 점수를 0점으로 초기화하시겠습니까?")) {
        classData[currentClass].forEach(s => s.score = 0);
        if(currentGagaTeams && currentGagaTeams.length > 0) {
            currentGagaTeams.forEach(t => {
                t.score = 0;
                t.members.forEach(m => m.score = 0);
            });
        }
        
        saveData();
        window.renderGagaball();
        window.renderGagaRanking();
        if(currentGagaTeams && currentGagaTeams.length > 0) window.renderGagaTeamView();
        alert("점수가 모두 초기화되었습니다.");
    }
}

window.toggleChampionSelection = function(no) {
    const idx = window.championsSelection.indexOf(no);
    if(idx > -1) window.championsSelection.splice(idx, 1);
    else window.championsSelection.push(no);
    window.renderGagaRanking();
}

window.rankAutoScrollInterval = null;
window.autoScrollActive = true;

// 명예의 전당 레이아웃 전면 수정: 높이차 구도 + 1위 하단 4위 이후 스크롤 + 무한반복 처리
window.renderGagaRanking = function() {
    const container = document.getElementById('gaga-hall-of-fame-grid'); 
    if(!container || !currentClass) return;
    
    const studentsForRank = [...(classData[currentClass] || [])]
        .filter(s => s.attendance)
        .sort((a, b) => (b.score || 0) - (a.score || 0));

    let rankedStudents = [];
    let currentRank = 1;
    studentsForRank.forEach((s, i) => {
        if (i > 0 && (studentsForRank[i].score || 0) < (studentsForRank[i-1].score || 0)) {
            currentRank = i + 1;
        }
        rankedStudents.push({ ...s, rank: currentRank });
    });

    let podiumHTML = '';
    let listHTML = '';
    
    window.championsSelection = window.championsSelection || [];

    const createPodiumCard = (s, rank) => {
        const isSelected = window.championsSelection.includes(s.no);
        const highlightClass = isSelected ? "ring-[4px] ring-purple-500 bg-purple-50" : "";
        
        let cardStyle = "bg-white border-[3px] border-slate-200";
        let rankBadge = `${rank}위`;
        let badgeStyle = "bg-slate-500 text-white";
        
        let sizeClass = "p-2 sm:p-3 lg:p-4 pr-10 sm:pr-14 lg:pr-16"; 
        let avatarSize = "w-14 h-14 sm:w-20 sm:h-20 lg:w-24 lg:h-24"; 
        let nameSize = "text-lg sm:text-xl lg:text-2xl"; 
        let scoreSize = "text-base sm:text-lg lg:text-xl";
        let transformClass = isSelected ? "scale-[1.03]" : "hover:scale-[1.02]";

        if (rank === 1) { 
            cardStyle = "bg-gradient-to-b from-yellow-50 to-yellow-100 border-[5px] lg:border-[6px] border-yellow-400 shadow-[0_10px_25px_rgba(250,204,21,0.25)]"; 
            rankBadge = "🥇 1위"; 
            badgeStyle = "bg-yellow-500 text-white shadow-md text-sm sm:text-base lg:text-lg px-4 py-0.5";
            transformClass += " z-10"; 
            avatarSize = "w-16 h-16 sm:w-24 sm:h-24 lg:w-28 lg:h-28";
            nameSize = "text-xl sm:text-2xl lg:text-3xl";
            scoreSize = "text-lg sm:text-xl lg:text-2xl";
        } else if (rank === 2) { 
            cardStyle = "bg-gradient-to-b from-gray-50 to-gray-100 border-[4px] lg:border-[5px] border-gray-400 shadow-[0_8px_20px_rgba(156,163,175,0.25)]"; 
            rankBadge = "🥈 2위"; 
            badgeStyle = "bg-gray-500 text-white shadow-md text-xs sm:text-sm lg:text-base px-3 py-0.5";
        } else if (rank === 3) { 
            cardStyle = "bg-gradient-to-b from-orange-50 to-orange-100 border-[4px] lg:border-[5px] border-orange-400 shadow-[0_8px_20px_rgba(249,115,22,0.25)]"; 
            rankBadge = "🥉 3위"; 
            badgeStyle = "bg-orange-600 text-white shadow-md text-xs sm:text-sm lg:text-base px-3 py-0.5";
        }

        const cuteAvatar = window.generateCuteAvatar(s);
        const refStampOpacity = s.isReferee ? 'opacity-100 scale-110' : 'opacity-20 grayscale hover:grayscale-0 hover:opacity-50';
        const refStampColor = s.isReferee ? 'border-red-500 text-red-500' : 'border-slate-300 text-slate-400';

        return `
        <div class="flex flex-col items-center justify-center rounded-[2rem] lg:rounded-[2.5rem] ${cardStyle} ${highlightClass} transition-all cursor-pointer ${sizeClass} ${transformClass} w-full relative" onclick="window.toggleChampionSelection(${s.no})">
            <div class="absolute -top-3.5 sm:-top-4 left-1/2 transform -translate-x-1/2 rounded-full font-black whitespace-nowrap z-20 ${badgeStyle}">${rankBadge}</div>
            
            <div class="relative mt-2 mb-1 shrink-0">
                <img src="${cuteAvatar}" class="${avatarSize} rounded-full border-[4px] bg-white object-cover border-white shadow-md">
            </div>
            
            <div class="${nameSize} font-black text-slate-800 drop-shadow-sm whitespace-nowrap mb-0.5 truncate max-w-full px-1">${s.name}</div>
            <div class="${scoreSize} font-black text-red-600 drop-shadow-sm">${s.score || 0}점</div>
            
            <div class="absolute top-1/2 right-1 sm:right-2 lg:right-3 transform -translate-y-1/2 cursor-pointer flex flex-col items-center justify-center transition-all ${refStampOpacity}" onclick="event.stopPropagation(); window.toggleReferee(${s.no})" title="심판 도장 토글">
                <div class="w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 rounded-full border-[2px] lg:border-[3px] ${refStampColor} border-dashed flex items-center justify-center font-black text-[10px] sm:text-xs lg:text-sm transform -rotate-12 bg-white/95 shadow-md shrink-0">
                    심판
                </div>
            </div>
        </div>
        `;
    };

    const createListCard = (s) => {
        const isSelected = window.championsSelection.includes(s.no);
        const highlightClass = isSelected ? "ring-[3px] ring-purple-500 bg-purple-50" : "bg-white hover:bg-slate-50";
        const refStampOpacity = s.isReferee ? 'opacity-100 scale-110' : 'opacity-20 grayscale hover:grayscale-0 hover:opacity-50';
        const refStampColor = s.isReferee ? 'border-red-500 text-red-500' : 'border-slate-300 text-slate-400';

        return `
        <div class="flex flex-row items-center justify-between ${highlightClass} border-2 border-slate-200 rounded-2xl p-1.5 sm:p-2 shadow-sm transition-transform cursor-pointer w-full shrink-0 h-[56px] sm:h-[72px]" onclick="window.toggleChampionSelection(${s.no})">
            <div class="w-8 sm:w-12 text-center font-black text-slate-500 text-xs sm:text-base shrink-0">${s.rank}위</div>
            <img src="${window.generateCuteAvatar(s)}" class="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-2 border-slate-200 object-cover mx-1 sm:mx-2 shrink-0 bg-white">
            <div class="flex-1 text-sm sm:text-lg font-black text-slate-800 truncate text-left">${s.name}</div>
            <div class="text-sm sm:text-lg font-black text-red-600 shrink-0 w-12 sm:w-16 text-right pr-1">${s.score || 0}점</div>
            
            <div class="cursor-pointer flex flex-col items-center justify-center transition-all transform ${refStampOpacity} shrink-0" onclick="event.stopPropagation(); window.toggleReferee(${s.no})" title="심판 도장 토글">
                <div class="w-8 h-8 sm:w-10 sm:h-10 rounded-full border-[2px] ${refStampColor} border-dashed flex items-center justify-center font-black text-[8px] sm:text-[10px] transform -rotate-12 bg-white shadow-sm">
                    심판
                </div>
            </div>
        </div>`;
    };

    let top3 = rankedStudents.slice(0, 3);
    let others = rankedStudents.slice(3);

    if (others.length > 0) {
        // 중앙 컬럼(1위 밑)에 딱 들어맞는 크기로 제한 (h-300px~450px)
        listHTML = `<div id="gaga-ranking-list" class="absolute inset-0 flex flex-col gap-2 w-full px-1 overflow-y-auto custom-scrollbar scroll-smooth" onmouseenter="window.autoScrollActive = false" onmouseleave="window.autoScrollActive = true" ontouchstart="window.autoScrollActive = false" ontouchend="window.autoScrollActive = true">`;
        others.forEach(s => {
            listHTML += createListCard(s);
        });
        listHTML += `</div>`;
    }

    if (top3.length > 0) {
        let p1 = top3[0] ? `<div class="w-full max-w-[280px] lg:max-w-[320px] flex justify-center z-10 mx-auto shrink-0">${createPodiumCard(top3[0], 1)}</div>` : '';
        let p2 = top3[1] ? `<div class="w-full flex justify-center shrink-0">${createPodiumCard(top3[1], 2)}</div>` : '';
        let p3 = top3[2] ? `<div class="w-full flex justify-center shrink-0">${createPodiumCard(top3[2], 3)}</div>` : '';

        // 1등(중앙) 공간 아래에 리스트(listHTML)가 결합되는 새로운 Flex 레이아웃
        podiumHTML = `
        <div class="flex flex-row justify-center w-full max-w-5xl mx-auto px-2 gap-2 sm:gap-4 lg:gap-6 pt-4">
            <div class="w-[28%] flex flex-col items-center pt-12 sm:pt-20 lg:pt-28 shrink-0">
                ${p2}
            </div>
            <div class="w-[44%] flex flex-col items-center z-10 shrink-0">
                ${p1}
                <div class="w-full mt-4 sm:mt-6 relative h-[300px] sm:h-[450px]">
                    ${listHTML}
                </div>
            </div>
            <div class="w-[28%] flex flex-col items-center pt-16 sm:pt-24 lg:pt-32 shrink-0">
                ${p3}
            </div>
        </div>
        `;
    } else {
        // 학생이 3명 미만일 경우 예외 처리
        podiumHTML = `<div class="relative w-full max-w-2xl mx-auto h-[400px] mt-10">${listHTML}</div>`;
    }

    container.innerHTML = podiumHTML;

    // 자동 스크롤 무한 반복 로직 (마지막 도착 시 처음으로 즉시 복귀)
    clearInterval(window.rankAutoScrollInterval);
    if (others.length > 0) {
        window.rankAutoScrollInterval = setInterval(() => {
            if(!window.autoScrollActive) return;
            const list = document.getElementById('gaga-ranking-list');
            if (list) {
                // 스크롤이 끝에 닿았는지 확인 (모니터 배율 대응으로 Math.ceil 사용)
                if (Math.ceil(list.scrollTop) + list.clientHeight >= list.scrollHeight - 1) {
                    list.scrollTop = 0; // 끝에 닿으면 즉시 처음으로 되돌아감
                } else {
                    list.scrollTop += 1;
                }
            } else {
                clearInterval(window.rankAutoScrollInterval);
            }
        }, 40);
    }

    const fab = document.getElementById('champions-fab-container');
    const fabText = document.getElementById('champions-fab-text');
    if (window.championsSelection.length > 0) {
        fab.classList.remove('hidden');
        fabText.innerText = `왕중왕전 시작 (${window.championsSelection.length}명)`;
    } else {
        fab.classList.add('hidden');
    }
}

const generateGridCards = (students) => {
    return students.map((s) => {
        let borderColor = s.gender === '남' ? '#3498db' : '#e74c3c';
        const cuteAvatar = window.generateCuteAvatar(s);
        
        return `
            <div class="border-[4px] sm:border-[6px] p-2 sm:p-4 rounded-3xl text-center shadow-lg bg-white w-full h-full flex flex-col items-center justify-between" style="border-color: ${borderColor}; box-sizing: border-box;">
                
                <div class="flex-1 w-full flex items-center justify-center min-h-0 pt-2 relative">
                    <img src="${cuteAvatar}" class="h-full max-h-[160px] lg:max-h-[200px] xl:max-h-[250px] aspect-square rounded-full mx-auto bg-slate-50 border-4 border-slate-100 cursor-pointer object-cover shadow-sm transition hover:scale-105" onclick="window.openAvatarSelectModal(${s.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" title="아바타 변경">
                </div>
                
                <div class="text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-[4.5rem] font-black text-slate-800 my-2 lg:my-3 whitespace-nowrap truncate leading-tight w-full shrink-0 flex items-center justify-center">${s.name}</div>
                
                <div class="text-xl sm:text-2xl lg:text-3xl font-black text-slate-600 flex items-center justify-center gap-3 w-full shrink-0 pb-1">
                    <button class="bg-red-500 text-white rounded-xl w-10 h-10 lg:w-12 lg:h-12 flex items-center justify-center hover:bg-red-600 transition shadow-md" onclick="window.changeGagaScore(${s.no}, -1)">-</button>
                    <span id="modal-score-${s.no}" class="w-12 lg:w-16 text-center tracking-tighter drop-shadow-sm">${s.score || 0}점</span>
                    <button class="bg-blue-500 text-white rounded-xl w-10 h-10 lg:w-12 lg:h-12 flex items-center justify-center hover:bg-blue-600 transition shadow-md" onclick="window.changeGagaScore(${s.no}, 1)">+</button>
                </div>
            </div>
        `;
    }).join('');
}

window.startChampionsTournament = function() {
    if(window.championsSelection.length === 0) return;
    let selectedStudents = window.championsSelection.map(no => classData[currentClass].find(s => s.no === no)).filter(Boolean);

    document.getElementById('gagaDrawMainTitle').innerText = "👑 왕중왕전 👑";
    document.getElementById('gagaDrawMainTitle').className = "text-5xl sm:text-7xl font-black text-purple-600 mb-4 font-jua drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] shrink-0 text-center";
    
    const n = selectedStudents.length;
    let gridClasses = "grid gap-2 sm:gap-4 w-full flex-1 h-full min-h-0 overflow-hidden px-2 pb-2 ";
    if(n <= 2) gridClasses += "grid-cols-2 grid-rows-1";
    else if(n <= 4) gridClasses += "grid-cols-2 grid-rows-2";
    else if(n <= 6) gridClasses += "grid-cols-3 grid-rows-2";
    else if(n <= 8) gridClasses += "grid-cols-4 grid-rows-2";
    else gridClasses += "grid-cols-5 grid-rows-2";
    
    document.getElementById('gagaDrawResultGrid').className = gridClasses;
    document.getElementById('gagaDrawResultGrid').innerHTML = generateGridCards(selectedStudents);
    document.getElementById('gagaDrawModal').style.display = 'flex';
    
    window.showFloatingRouletteBtn('individual');
    
    window.playMP3('tadaa'); 
    window.fireConfetti();
    
    window.championsSelection = []; 
    window.renderGagaRanking(); 
}

// -----------------------------------------------------------
// 룰렛 플로팅 창 마우스 좌클릭 드래그 로직
// -----------------------------------------------------------
window.currentFloatingContext = 'individual';
let isDraggingBtn = false;
let hasBtnMoved = false;
let btnStartX = 0, btnStartY = 0;

window.showFloatingRouletteBtn = function(context) {
    window.currentFloatingContext = context;
    const btn = document.getElementById('floating-roulette-btn');
    if (!btn) return;
    btn.style.display = 'flex';
    btn.style.transform = 'none'; 
    
    setTimeout(() => {
        const btnWidth = btn.offsetWidth || 180;
        const btnHeight = btn.offsetHeight || 60;
        btn.style.top = (window.innerHeight / 2 - btnHeight / 2) + 'px';
        btn.style.left = (window.innerWidth / 2 - btnWidth / 2) + 'px';
    }, 20);
};

window.hideFloatingRouletteBtn = function() {
    const btn = document.getElementById('floating-roulette-btn');
    if (btn) btn.style.display = 'none';
};

window.initDraggableRouletteBtn = function() {
    const btn = document.getElementById('floating-roulette-btn');
    if (!btn) return;

    // 마우스 이벤트 (좌클릭 한정)
    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // 좌클릭(0)이 아니면 무시
        e.preventDefault(); // 텍스트 선택 등 고스트 드래그 완벽 차단
        isDraggingBtn = true;
        hasBtnMoved = false;
        btnStartX = e.clientX;
        btnStartY = e.clientY;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    // 터치 이벤트 (모바일)
    btn.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            isDraggingBtn = true;
            hasBtnMoved = false;
            btnStartX = e.touches[0].clientX;
            btnStartY = e.touches[0].clientY;
            document.addEventListener('touchmove', onTouchMove, { passive: false });
            document.addEventListener('touchend', onTouchEnd);
        }
    });

    function onMouseMove(e) {
        if (!isDraggingBtn) return;
        const dx = e.clientX - btnStartX;
        const dy = e.clientY - btnStartY;
        // 일정 범위 이상 움직여야 드래그로 판정
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasBtnMoved = true;
        
        if (hasBtnMoved) {
            let newTop = btn.offsetTop + dy;
            let newLeft = btn.offsetLeft + dx;
            btnStartX = e.clientX;
            btnStartY = e.clientY;
            
            newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newTop));
            newLeft = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newLeft));
            
            btn.style.top = newTop + 'px';
            btn.style.left = newLeft + 'px';
        }
    }

    function onMouseUp() {
        isDraggingBtn = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    function onTouchMove(e) {
        if (!isDraggingBtn) return;
        if (e.touches.length === 1) {
            const dx = e.touches[0].clientX - btnStartX;
            const dy = e.touches[0].clientY - btnStartY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasBtnMoved = true;
            
            if (hasBtnMoved) {
                e.preventDefault(); 
                let newTop = btn.offsetTop + dy;
                let newLeft = btn.offsetLeft + dx;
                btnStartX = e.touches[0].clientX;
                btnStartY = e.touches[0].clientY;
                
                newTop = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, newTop));
                newLeft = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, newLeft));
                
                btn.style.top = newTop + 'px';
                btn.style.left = newLeft + 'px';
            }
        }
    }

    function onTouchEnd() {
        isDraggingBtn = false;
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
    }

    // 클릭 이벤트 통제 (드래그 시 클릭 무시)
    btn.addEventListener('click', (e) => {
        if (hasBtnMoved) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        window.hideFloatingRouletteBtn();
        if (window.currentFloatingContext === 'team') {
            window.openRouletteModal('team');
        } else {
            window.openRouletteModal('individual');
        }
        setTimeout(() => {
            window.spinRoulette();
        }, 150);
    });
};

// 룰렛 설정
let defaultIndividualMissions = [ { text: "그냥 가가볼", weight: 70, color: "#81ecec", desc: "평소처럼 가가볼을 즐기세요." }, { text: "체육쌤 레이드", weight: 10, color: "#ff7675", desc: "체육쌤이 경기장에 등장했습니다! 체육쌤을 아웃시키면 체육 도장 1장이 주어집니다!" }, { text: "포인트 X2", weight: 20, color: "#ffeaa7", desc: "최종 승자에게는 평소보다 2배의 포인트가 주어집니다." } ];
let defaultTeamMissions = [ { text: "그냥 가가볼", weight: 70, color: "#81ecec", desc: "평소처럼 가가볼을 즐기세요." }, { text: "왕을 잡아라!", weight: 15, color: "#a29bfe", desc: "양팀은 우리팀 왕을 한명 정해주세요. 상대팀 왕을 먼저 아웃시키는 팀이 승리합니다." }, { text: "포인트 X2", weight: 15, color: "#ffeaa7", desc: "최종 승리팀 전원에게 평소보다 2배의 포인트가 주어집니다." } ];

let individualMissions = JSON.parse(localStorage.getItem('gagaIndividualMissions')) || defaultIndividualMissions;
let teamMissions = JSON.parse(localStorage.getItem('gagaTeamMissions')) || defaultTeamMissions;
let currentMissions = individualMissions; 
let currentMissionsType = 'individual';
let editMissionsTemp = [];

let currentRouletteRotation = 0; let isSpinning = false;

window.openSmartRouletteModal = function() {
    const teamView = document.getElementById('gaga-view-team');
    if (teamView && !teamView.classList.contains('hidden')) {
        window.openRouletteModal('team');
    } else {
        window.openRouletteModal('individual');
    }
}

window.openRouletteModal = function(type) {
    currentMissionsType = type;
    if(type === 'team') { currentMissions = teamMissions; document.getElementById('rouletteModalTitle').innerText = "🎡 팀전 미션 룰렛"; } 
    else { currentMissions = individualMissions; document.getElementById('rouletteModalTitle').innerText = "🎡 개인전 미션 룰렛"; }
    document.getElementById('rouletteModal').style.display = 'flex'; setTimeout(window.drawRoulette, 50); 
}
window.closeRouletteModal = function() { if(isSpinning) return; document.getElementById('rouletteModal').style.display = 'none'; }
window.openRouletteEditModal = function() {
    editMissionsTemp = JSON.parse(JSON.stringify(currentMissionsType === 'team' ? teamMissions : individualMissions));
    window.renderRouletteEditList(); document.getElementById('rouletteEditModal').style.display = 'flex';
}
window.closeRouletteEditModal = function() { document.getElementById('rouletteEditModal').style.display = 'none'; }
window.renderRouletteEditList = function() {
    const list = document.getElementById('roulette-edit-list'); list.innerHTML = '';
    const colors = ["#81ecec", "#ff7675", "#ffeaa7", "#a29bfe", "#55efc4", "#fab1a0", "#74b9ff"];
    editMissionsTemp.forEach((m, i) => {
        list.innerHTML += `
            <div class="border p-3 rounded-xl bg-slate-50 flex flex-col gap-2 relative">
                <button onclick="window.removeRouletteItem(${i})" class="absolute top-2 right-2 text-red-500 font-bold">&times; 삭제</button>
                <div class="flex items-center gap-2 pr-12">
                    <input type="color" value="${m.color || colors[i%colors.length]}" id="r-edit-color-${i}" class="w-8 h-8 rounded cursor-pointer" onchange="window.updateRouletteItem(${i})">
                    <input type="text" value="${m.text}" id="r-edit-text-${i}" placeholder="미션명" class="flex-1 p-2 border rounded font-bold" onchange="window.updateRouletteItem(${i})">
                    <input type="number" value="${m.weight}" id="r-edit-weight-${i}" placeholder="확률" class="w-12 sm:w-16 p-2 border rounded" onchange="window.updateRouletteItem(${i})">
                </div>
                <textarea id="r-edit-desc-${i}" placeholder="설명" class="w-full p-2 border rounded text-sm" onchange="window.updateRouletteItem(${i})">${m.desc}</textarea>
            </div>
        `;
    });
}
window.updateRouletteItem = function(i) {
    editMissionsTemp[i].text = document.getElementById(`r-edit-text-${i}`).value;
    editMissionsTemp[i].weight = parseInt(document.getElementById(`r-edit-weight-${i}`).value) || 0;
    editMissionsTemp[i].desc = document.getElementById(`r-edit-desc-${i}`).value;
    editMissionsTemp[i].color = document.getElementById(`r-edit-color-${i}`).value;
}
window.addRouletteItem = function() { editMissionsTemp.push({ text: "새 미션", weight: 10, color: "#74b9ff", desc: "미션 설명" }); window.renderRouletteEditList(); }
window.removeRouletteItem = function(i) { editMissionsTemp.splice(i, 1); window.renderRouletteEditList(); }
window.saveRouletteEdit = function() {
    if (currentMissionsType === 'team') { teamMissions = editMissionsTemp; localStorage.setItem('gagaTeamMissions', JSON.stringify(teamMissions)); currentMissions = teamMissions; } 
    else { individualMissions = editMissionsTemp; localStorage.setItem('gagaIndividualMissions', JSON.stringify(individualMissions)); currentMissions = individualMissions; }
    window.closeRouletteEditModal(); window.drawRoulette();
}
window.drawRoulette = function() {
    const canvas = document.getElementById("rouletteCanvas"); if (!canvas.getContext) return;
    const ctx = canvas.getContext("2d"); const cw = canvas.width; const ch = canvas.height; ctx.clearRect(0, 0, cw, ch);
    let startAngle = -0.5 * Math.PI; 
    let totalWeight = currentMissions.reduce((acc, m) => acc + m.weight, 0) || 1;
    for(let i=0; i<currentMissions.length; i++) {
        let sliceAngle = (currentMissions[i].weight / totalWeight) * 2 * Math.PI;
        ctx.beginPath(); ctx.moveTo(cw/2, ch/2); ctx.arc(cw/2, ch/2, cw/2, startAngle, startAngle + sliceAngle);
        ctx.fillStyle = currentMissions[i].color || '#fff'; ctx.fill();
        ctx.lineWidth = 8; ctx.strokeStyle = "#ffffff"; ctx.stroke();
        ctx.save(); ctx.translate(cw/2, ch/2); ctx.rotate(startAngle + sliceAngle / 2);
        ctx.textAlign = "right"; ctx.fillStyle = "#2d3436"; ctx.font = "bold 42px Jua"; ctx.fillText(currentMissions[i].text, cw/2 - 45, 15); ctx.restore();
        startAngle += sliceAngle;
    }
    ctx.beginPath(); ctx.arc(cw/2, ch/2, 80, 0, 2 * Math.PI); ctx.fillStyle = "#2d3436"; ctx.fill();
    ctx.lineWidth = 8; ctx.strokeStyle = "#ffffff"; ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "bold 40px Jua"; ctx.fillText("미션", cw/2, ch/2);
}
window.spinRoulette = function() {
    if(isSpinning) return; isSpinning = true;
    window.playMP3('spinner');
    const canvas = document.getElementById("rouletteCanvas");
    const spinAngle = Math.floor(Math.random() * 360) + (360 * 5); currentRouletteRotation += spinAngle;
    canvas.style.transition = "transform 5s cubic-bezier(0.25, 0.1, 0.25, 1)"; 
    canvas.style.transform = `rotate(${currentRouletteRotation}deg)`;

    setTimeout(() => {
        isSpinning = false;
        window.stopMP3('spinner');
        window.playMP3('goodresult');
        
        const normalizedRotation = currentRouletteRotation % 360; let pointerAngle = (360 - normalizedRotation) % 360;
        let currentPos = 0; let winner = null;
        let totalWeight = currentMissions.reduce((acc, m) => acc + m.weight, 0) || 1;
        for(let i=0; i<currentMissions.length; i++) {
            let sliceSize = (currentMissions[i].weight / totalWeight) * 360;
            if(pointerAngle >= currentPos && pointerAngle < currentPos + sliceSize) { winner = currentMissions[i]; break; }
            currentPos += sliceSize;
        }
        window.showMissionDescModal(winner.text, winner.desc);
    }, 5000);
}
window.showMissionDescModal = function(title, text) {
    document.getElementById("missionDescTitle").innerText = "🎯 " + title; document.getElementById("missionDescText").innerText = text; document.getElementById("missionDescModal").style.display = "flex";
}
window.closeMissionDescModal = function() { document.getElementById("missionDescModal").style.display = "none"; }

window.triggerGagaDraw = function(targetGender) {
    if(!currentClass) return;
    const drawCount = parseInt(document.getElementById('gaga-draw-count').value, 10);
    let available = classData[currentClass].filter(s => s.attendance && !s.gagaDrawn && (targetGender === 'all' || s.gender === targetGender));
    if(available.length === 0) return alert("현재 대기 중인 학생이 없습니다.");

    document.getElementById('event-loading-overlay').classList.remove('hidden'); document.getElementById('event-loading-overlay').classList.add('flex');

    window.playMP3('tadaa'); 

    setTimeout(() => {
        document.getElementById('event-loading-overlay').classList.add('hidden'); document.getElementById('event-loading-overlay').classList.remove('flex');
        window.executeGagaDraw(targetGender, drawCount, available);
    }, 2200);
}

window.executeGagaDraw = function(targetGender, drawCount, available) {
    const actualDrawCount = Math.min(drawCount, available.length);
    for (let i = available.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [available[i], available[j]] = [available[j], available[i]]; }
    let picked = available.slice(0, actualDrawCount);
    
    let pickedReferees = picked.filter(s => s.isReferee);
    if (pickedReferees.length >= 3) {
        let unpickedNonReferees = available.slice(actualDrawCount).filter(s => !s.isReferee);
        if (unpickedNonReferees.length > 0) {
            let refToSwapOut = picked.findIndex(s => s.isReferee);
            picked[refToSwapOut] = unpickedNonReferees[0];
        }
    }

    picked.forEach(s => s.gagaDrawn = true);
    
    document.getElementById('gagaDrawMainTitle').innerText = "🎉 참가 선수 🎉";
    document.getElementById('gagaDrawMainTitle').className = "text-5xl sm:text-7xl font-black text-white mb-4 font-jua drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] shrink-0 text-center";

    const n = picked.length;
    let gridClasses = "grid gap-2 sm:gap-4 w-full flex-1 h-full min-h-0 overflow-hidden px-2 pb-2 ";
    if (n <= 2) gridClasses += "grid-cols-2 grid-rows-1";
    else if (n <= 4) gridClasses += "grid-cols-2 grid-rows-2";
    else if (n <= 6) gridClasses += "grid-cols-3 grid-rows-2";
    else if (n <= 8) gridClasses += "grid-cols-4 grid-rows-2";
    else gridClasses += "grid-cols-5 grid-rows-2";
    
    document.getElementById('gagaDrawResultGrid').className = gridClasses;
    document.getElementById('gagaDrawResultGrid').innerHTML = generateGridCards(picked); 

    saveData(); window.renderGagaball();
    document.getElementById('gagaDrawModal').style.display = 'flex';
    
    window.showFloatingRouletteBtn('individual');
    window.fireConfetti();
}

window.resetGagaDraw = function() {
    if(!currentClass) return;
    if (confirm("추첨 기록을 초기화하시겠습니까?")) {
        classData[currentClass].forEach(s => s.gagaDrawn = false); 
        saveData(); window.renderGagaball();
    }
}
window.closeGagaDrawModal = function() { 
    document.getElementById('gagaDrawModal').style.display = 'none'; 
    window.hideFloatingRouletteBtn();
}

// 팀 편성 로직
const getStudentPower = (student, validRecords) => {
    let bs = (parseInt(student.ballSense) || 0) * 60; 
    let rs = 0;
    if (student.recordMs > 0 && validRecords.length > 0) {
        let rank = validRecords.indexOf(student.recordMs);
        rs = 100 - (rank / validRecords.length * 100);
    }
    return bs + rs; 
};

let currentGagaTeams = [];
window.triggerGagaTeams = function() {
    if(!currentClass) return;
    const numTeams = parseInt(document.getElementById('gaga-team-count').value, 10);
    let available = classData[currentClass].filter(s => s.attendance);
    if(available.length < numTeams) return alert("참가 학생이 너무 적습니다.");

    document.getElementById('event-loading-overlay').classList.remove('hidden'); document.getElementById('event-loading-overlay').classList.add('flex');
    document.getElementById('event-loading-text').innerText = "팀 밸런스 조정중..."; 

    window.playMP3('tadaa');

    setTimeout(() => {
        document.getElementById('event-loading-overlay').classList.add('hidden'); document.getElementById('event-loading-overlay').classList.remove('flex');
        document.getElementById('event-loading-text').innerText = "두구두구두구..."; window.executeGagaTeams(numTeams, available);
    }, 2200);
}

window.executeGagaTeams = function(numTeams, available) {
    const totalParticipants = available.length; const baseSize = Math.floor(totalParticipants / numTeams); const remainder = totalParticipants % numTeams;
    let targetSizes = new Array(numTeams).fill(baseSize); for(let i = 0; i < remainder; i++) targetSizes[i]++;

    const teams = Array.from({length: numTeams}, (_, i) => ({ id: i + 1, members: [], score: 0, targetSize: targetSizes[i] }));
    let validRecords = available.filter(s => s.recordMs > 0).map(s => s.recordMs).sort((a,b) => a - b);
    const sortByPower = (a, b) => {
        let pA = getStudentPower(a, validRecords) + (a.score||0)*150;
        let pB = getStudentPower(b, validRecords) + (b.score||0)*150;
        return pB - pA;
    };

    let referees = available.filter(s => s.isReferee).sort(sortByPower);
    let nonReferees = available.filter(s => !s.isReferee);
    
    let boys = nonReferees.filter(s => s.gender === '남').sort(sortByPower); 
    let girls = nonReferees.filter(s => s.gender === '여').sort(sortByPower);

    function distribute(group) {
        group.forEach(student => {
            let eligibleTeams = teams.filter(t => t.members.length < t.targetSize);
            let minMembers = Math.min(...eligibleTeams.map(t => t.members.length));
            let candidates = eligibleTeams.filter(t => t.members.length === minMembers);
            candidates.sort(() => Math.random() - 0.5); candidates.sort((a, b) => a.score - b.score); 
            candidates[0].members.push(student); candidates[0].score += (student.score || 0);
        });
    }

    referees.forEach((ref) => {
        let eligibleTeams = teams.filter(t => t.members.length < t.targetSize);
        let validTeams = eligibleTeams.filter(t => {
            let matchupId = Math.floor((t.id - 1) / 2);
            let refsInMatchup = teams.filter(tm => Math.floor((tm.id - 1) / 2) === matchupId)
                                     .reduce((sum, tm) => sum + tm.members.filter(m => m.isReferee).length, 0);
            return refsInMatchup < 2;
        });
        
        if(validTeams.length === 0) validTeams = eligibleTeams;
        
        let minMembers = Math.min(...validTeams.map(t => t.members.length));
        let candidates = validTeams.filter(t => t.members.length === minMembers);
        candidates.sort(() => Math.random() - 0.5); candidates.sort((a, b) => a.score - b.score);
        candidates[0].members.push(ref); candidates[0].score += (ref.score || 0);
    });

    teams.forEach(t => t.members.forEach(m => m.isKing = false));

    distribute(boys); distribute(girls); currentGagaTeams = teams; window.renderGagaTeamView(); 
    
    window.showFloatingRouletteBtn('team');
    window.fireConfetti();
}

window.toggleTeamKing = function(teamId, memberNo) {
    const team = currentGagaTeams.find(t => t.id === teamId);
    if(!team) return;
    const member = team.members.find(m => m.no === memberNo);
    if(!member) return;
    
    member.isKing = !member.isKing;
    window.renderGagaTeamView();
}

window.renderGagaTeamView = function() {
    const container = document.getElementById('gaga-team-matchups'); let teamHTML = '';
    const now = Date.now();
    const showAnim = (window.lastTeamScoreChange && (now - window.lastTeamScoreChange.time < 100));

    for(let i = 0; i < currentGagaTeams.length; i += 2) {
        const teamA = currentGagaTeams[i]; const teamB = currentGagaTeams[i+1];
        
        const createBadges = (team) => team.members.map((m) => {
            let animHTML = '';
            if (showAnim && team.id === window.lastTeamScoreChange.teamId) {
                const val = window.lastTeamScoreChange.val;
                const sign = val > 0 ? '+' : '';
                const colorClass = val > 0 ? 'float-score-plus' : 'float-score-minus';
                animHTML = `<span class="float-score-anim ${colorClass}">${sign}${val}</span>`;
            }

            const isKing = m.isKing;
            const kingCrown = isKing ? `<div class="absolute -top-4 -right-3 text-4xl sm:text-5xl drop-shadow-md z-20 animate-bounce">👑</div>` : '';

            return `
            <div class="relative flex flex-col items-center justify-center p-2 sm:p-4 rounded-2xl sm:rounded-3xl border-2 sm:border-[4px] shadow-sm w-full h-full min-h-[140px] sm:min-h-[220px] lg:min-h-[260px] cursor-pointer transition-transform hover:scale-[1.02] ${isKing ? 'border-yellow-400 ring-4 ring-yellow-300 bg-yellow-50' : 'bg-white'}" style="${!isKing ? `border-color:${m.gender==='남'?'#3498db':'#e74c3c'}` : ''}" onclick="window.toggleTeamKing(${team.id}, ${m.no})">
                ${kingCrown}
                <div class="relative w-16 h-16 sm:w-24 sm:h-24 lg:w-32 lg:h-32 xl:w-36 xl:h-36 mb-1 sm:mb-3 shrink-0">
                    <img src="${window.generateCuteAvatar(m)}" class="w-full h-full rounded-full bg-gray-50 object-cover border-2 sm:border-[4px] border-slate-100 shadow-sm" onclick="event.stopPropagation(); window.openAvatarSelectModal(${m.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" title="아바타 변경">
                </div>
                <b class="text-xl sm:text-3xl lg:text-4xl xl:text-5xl font-black text-slate-800 truncate w-full text-center leading-tight mb-1 sm:mb-2 tracking-tight">${m.name}</b>
                <span class="text-sm sm:text-xl lg:text-2xl text-red-500 font-black relative whitespace-nowrap mt-auto">${m.score || 0}점${animHTML}</span>
            </div>`;
        }).join('');
        
        const createPanel = (team, isEven) => `
            <div class="w-full sm:w-28 lg:w-32 border-b-2 sm:border-b-0 sm:border-r-4 border-dashed ${isEven ? 'border-slate-400/50' : 'border-slate-300'} pb-2 mb-2 sm:pb-0 sm:mb-0 sm:pr-4 sm:mr-4 flex flex-row sm:flex-col justify-between items-center shrink-0">
                <div class="flex flex-col items-center">
                    <div class="text-2xl sm:text-4xl font-black text-slate-800 whitespace-nowrap">${team.id}팀</div>
                    ${isEven ? `<div class="text-xs sm:text-base font-bold text-slate-600 mt-1">(형광)</div>` : ''}
                </div>
                <div class="flex gap-2 sm:gap-3 mt-0 sm:mt-auto">
                    <button class="bg-red-500 text-white w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl text-xl sm:text-2xl font-black shadow hover:bg-red-600 transition flex items-center justify-center" onclick="window.addGagaTeamScore(${team.id}, -1)">-</button>
                    <button class="bg-blue-500 text-white w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl text-xl sm:text-2xl font-black shadow hover:bg-blue-600 transition flex items-center justify-center" onclick="window.addGagaTeamScore(${team.id}, 1)">+</button>
                </div>
            </div>`;

        let teamBgA = "bg-orange-50 border-orange-400";
        let teamBgB = "bg-[#f3ff4c] border-[#d1e600]";

        teamHTML += `
            <div class="flex flex-col xl:flex-row gap-2 sm:gap-4 bg-white p-3 sm:p-5 rounded-2xl border-2 sm:border-4 border-slate-100 shadow-md items-stretch mb-4 overflow-visible">
                <div class="flex-1 flex flex-col sm:flex-row p-3 sm:p-4 rounded-xl sm:rounded-2xl ${teamBgA} border-t-8 xl:border-t-0 xl:border-l-8">
                    ${createPanel(teamA, false)} 
                    <div class="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 py-2 px-2 overflow-visible items-stretch">${createBadges(teamA)}</div>
                </div>
                ${teamB ? `<div class="text-xl sm:text-4xl flex items-center justify-center font-black text-slate-400 drop-shadow-sm my-1 xl:my-0">VS</div>
                <div class="flex-1 flex flex-col sm:flex-row p-3 sm:p-4 rounded-xl sm:rounded-2xl ${teamBgB} border-t-8 xl:border-t-0 xl:border-r-8">
                    ${createPanel(teamB, true)} 
                    <div class="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 py-2 px-2 overflow-visible items-stretch">${createBadges(teamB)}</div>
                </div>` : ''}
            </div>`;
    }
    container.innerHTML = teamHTML;
}

window.addGagaTeamScore = function(teamId, val) {
    if (val > 0) window.playCoinSound(); else window.playBumpSound();
    const team = currentGagaTeams.find(t => t.id === teamId);
    team.score += val; 
    team.members.forEach(m => {
        const student = classData[currentClass].find(s => s.no === m.no);
        if(student) { student.score = Math.max(0, (student.score || 0) + val); m.score = student.score; }
    });
    
    window.lastTeamScoreChange = { teamId: teamId, val: val, time: Date.now() };
    saveData(); window.renderGagaTeamView(); window.renderGagaball(); window.renderGagaRanking();
}

window.openTimerSelectModal = function() { document.getElementById('timerSelectModal').style.display = 'flex'; }
window.closeTimerSelectModal = function() { document.getElementById('timerSelectModal').style.display = 'none'; }

// ==========================================
// 6. 도장판 모드
// ==========================================
window.renderStampBoard = () => {
    const board = document.getElementById('stampBoard'); if (!board) return;
    const titleEl = document.getElementById('stamp-class-title');

    if (!currentClass) { titleEl.innerText = "학급을 선택해주세요"; board.innerHTML = ""; return; }
    titleEl.innerText = `${currentClass} 도장판`;
    if (!classStamps[currentClass]) classStamps[currentClass] = Array(TOTAL_STAMP_CELLS).fill(false);

    board.innerHTML = ''; let stampedCount = 0;
    classStamps[currentClass].forEach((isStamped, i) => {
        if (isStamped) stampedCount++;
        const cell = document.createElement('div');
        cell.className = `stamp-cell w-full aspect-square border-2 border-dashed border-gray-300 rounded-full flex items-center justify-center bg-white hover:bg-green-50 ${isStamped ? 'stamped' : ''}`;
        cell.innerHTML = `<span class="cell-number font-bold font-sans">${i + 1}</span><img src="${globalStampImage}" class="stamp-img">`;
        cell.onclick = () => window.toggleStamp(i, cell);
        board.appendChild(cell);
    });
    document.getElementById('progressCount').innerText = stampedCount;
    window.checkMissionComplete(false);
};

window.toggleStampDropdown = function(e) {
    e.stopPropagation();
    const menu = document.getElementById('stamp-dropdown-menu');
    if (menu.classList.contains('hidden')) {
        menu.innerHTML = '';
        const classes = Object.keys(classData).sort().filter(cls => !(hiddenClasses || []).includes(cls));
        if(classes.length === 0) {
            menu.innerHTML = '<div class="p-4 text-sm text-slate-500 text-center font-medium font-sans">표시할 학급이 없습니다.</div>';
        } else {
            classes.forEach(cls => {
                const btn = document.createElement('button');
                btn.className = "w-full text-center px-4 py-3 text-lg font-bold hover:bg-green-50 text-slate-700 border-b border-gray-100 last:border-0 transition font-sans";
                btn.innerText = cls;
                if (cls === currentClass) { btn.classList.add('bg-green-100', 'text-green-800'); }
                btn.onclick = () => { window.selectClass(cls); menu.classList.add('hidden'); menu.classList.remove('flex'); };
                menu.appendChild(btn);
            });
        }
        menu.classList.remove('hidden'); menu.classList.add('flex');
    } else {
        menu.classList.add('hidden'); menu.classList.remove('flex');
    }
};

document.addEventListener('click', (e) => {
    const menu = document.getElementById('stamp-dropdown-menu');
    if (menu && !menu.classList.contains('hidden') && !e.target.closest('#stamp-dropdown-menu')) {
        menu.classList.add('hidden'); menu.classList.remove('flex');
    }
});

window.toggleStamp = (index, cellElement) => {
    if (!currentClass) return;
    const isStamped = !classStamps[currentClass][index]; classStamps[currentClass][index] = isStamped;
    if (isStamped) { cellElement.classList.add('stamped'); window.playStampSound(); } 
    else { cellElement.classList.remove('stamped'); window.playEraseSound(); }
    document.getElementById('progressCount').innerText = classStamps[currentClass].filter(Boolean).length;
    saveData(); window.checkMissionComplete(true);
};

window.checkMissionComplete = (playEffect) => {
    const isComplete = classStamps[currentClass]?.every(s => s === true);
    const badge = document.getElementById('missionBadgeContainer');
    if (isComplete) { 
        badge.classList.remove('hidden'); badge.classList.add('badge-animate'); 
        if (playEffect) window.playMP3('goodresult'); 
    } 
    else { badge.classList.add('hidden'); }
};

window.resetStampBoard = () => {
    if (confirm("기록을 모두 초기화하시겠습니까?")) { classStamps[currentClass] = Array(TOTAL_STAMP_CELLS).fill(false); saveData(); window.renderStampBoard(); }
};

window.playStampSound = () => {
    const ctx = initAudio(); const now = ctx.currentTime;
    const fallOsc = ctx.createOscillator(); const fallGain = ctx.createGain();
    fallOsc.type = 'sine'; fallOsc.frequency.setValueAtTime(900, now); fallOsc.frequency.exponentialRampToValueAtTime(100, now + 0.35);
    fallGain.gain.setValueAtTime(0, now); fallGain.gain.linearRampToValueAtTime(0.4, now + 0.15); fallGain.gain.linearRampToValueAtTime(0, now + 0.35);
    fallOsc.connect(fallGain); fallGain.connect(ctx.destination); fallOsc.start(now); fallOsc.stop(now + 0.35);

    const boomOsc = ctx.createOscillator(); const boomGain = ctx.createGain();
    boomOsc.type = 'square'; boomOsc.frequency.setValueAtTime(150, now + 0.35); boomOsc.frequency.exponentialRampToValueAtTime(20, now + 0.7);
    boomGain.gain.setValueAtTime(0, now + 0.34); boomGain.gain.setValueAtTime(1.5, now + 0.35); boomGain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
    boomOsc.connect(boomGain); boomGain.connect(ctx.destination); boomOsc.start(now + 0.35); boomOsc.stop(now + 0.7);
};

const playTone = (freq, type, duration, gainVal) => {
    const ctx = initAudio();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + duration);
};
window.playEraseSound = () => [659, 880, 1046].forEach((f, i) => setTimeout(() => playTone(f, 'sine', 0.4, 0.15), i * 50));

window.openStampSelectModal = function() {
    document.getElementById('stampSelectModal').style.display = 'flex';
    let html = '';
    for(let i=1; i<=20; i++) {
        let num = String(i).padStart(2, '0');
        let path = `images/stamps/stamp${num}.jpg`;
        html += `<img src="${path}" class="w-full aspect-square rounded-2xl cursor-pointer border-4 border-transparent hover:border-green-500 hover:scale-105 transition bg-white shadow-sm object-cover" onclick="window.selectStamp('${path}')" onerror="this.style.display='none'">`;
    }
    document.getElementById('stamp-grid-container').innerHTML = html;
};

window.closeStampSelectModal = function() { document.getElementById('stampSelectModal').style.display = 'none'; };

window.selectStamp = function(path) {
    globalStampImage = path;
    localStorage.setItem('customStamp', globalStampImage);
    document.querySelectorAll('.stamp-img').forEach(img => { img.src = globalStampImage; });
    saveData(); window.renderStampBoard(); window.closeStampSelectModal();
};

// ==========================================
// 7. 아바타 모달 로직
// ==========================================
let currentAvatarStudentNo = null;
window.openAvatarSelectModal = function(studentNo) {
    currentAvatarStudentNo = studentNo;
    const student = classData[currentClass].find(s => s.no == studentNo);
    if(!student) return;
    document.getElementById('avatarSelectModal').style.display = 'flex';
    window.renderAvatarGrid(student.gender === '여' ? 'girl' : 'boy');
};
window.closeAvatarSelectModal = function() { document.getElementById('avatarSelectModal').style.display = 'none'; currentAvatarStudentNo = null; };
window.renderAvatarGrid = function(prefix) {
    const container = document.getElementById('avatar-grid-container'); let html = '';
    html += `<div class="cursor-pointer border-4 border-slate-200 hover:border-slate-400 rounded-2xl flex flex-col items-center justify-center bg-slate-50 shadow-sm aspect-square transition" onclick="window.selectAvatar(null)">
        <div class="text-2xl sm:text-3xl mb-1">🔄</div><span class="text-[10px] sm:text-xs font-bold text-slate-500 font-sans">기본 아바타</span>
    </div>`;
    for(let row=1; row<=5; row++) {
        for(let col=1; col<=10; col++) {
            let path = `images/avatars/${prefix}_${row}-${col}.png`;
            html += `<img src="${path}" class="w-full aspect-square rounded-2xl cursor-pointer border-4 border-transparent hover:border-blue-500 hover:scale-105 transition bg-slate-50 shadow-sm object-cover" onclick="window.selectAvatar('${path}')" onerror="this.style.display='none'">`;
        }
    }
    container.innerHTML = html;
};
window.selectAvatar = function(path) {
    if(!currentAvatarStudentNo) return;
    const student = classData[currentClass].find(s => s.no == currentAvatarStudentNo);
    if(student) { student.customAvatar = path; saveData(); window.renderGagaball(); if(currentGagaTeams && currentGagaTeams.length > 0) window.renderGagaTeamView(); }
    window.closeAvatarSelectModal();
};

// ==========================================
// 8. 학급 관리 기능 (단순화 + 숨김 처리)
// ==========================================
window.openManageModal = function() {
    document.getElementById('manage-modal').classList.remove('hidden');
    document.getElementById('manage-modal').classList.add('flex');
    window.renderClassSelect();
}
window.closeManageModal = function() {
    document.getElementById('manage-modal').classList.add('hidden');
    document.getElementById('manage-modal').classList.remove('flex');
}

window.renderClassSelect = function() {
    const listEl = document.getElementById('modal-class-list');
    const hiddenListEl = document.getElementById('hidden-class-list');
    if(!listEl) return;
    
    listEl.innerHTML = ''; 
    if(hiddenListEl) hiddenListEl.innerHTML = '';

    const classes = Object.keys(classData).sort();
    const visibleClasses = classes.filter(c => !(hiddenClasses || []).includes(c));
    const hiddenClassesList = classes.filter(c => (hiddenClasses || []).includes(c));

    if(classes.length === 0) { 
        listEl.innerHTML = '<div class="text-slate-400 font-bold text-sm w-full py-2">등록된 학급이 없습니다. 새 학급을 추가해주세요.</div>'; 
    } else {
        visibleClasses.forEach(cls => {
            listEl.appendChild(createClassBadge(cls, false));
        });
        if(hiddenListEl) {
            hiddenClassesList.forEach(cls => {
                hiddenListEl.appendChild(createClassBadge(cls, true));
            });
        }
    }
}

function createClassBadge(cls, isHidden) {
    const wrapper = document.createElement('div');
    wrapper.className = "flex items-center gap-1 border-2 shadow-sm rounded-xl px-1.5 py-1 transition-colors w-auto shrink-0 cursor-move";
    wrapper.draggable = true;
    wrapper.ondragstart = (e) => { e.dataTransfer.setData('text/plain', cls); };

    if(isHidden) {
        wrapper.classList.add("bg-gray-200", "border-gray-300", "opacity-70");
    } else {
        wrapper.classList.add("bg-white", "border-slate-200");
        if(currentClass === cls) wrapper.classList.add("border-blue-500");
    }

    const btn = document.createElement('button'); 
    btn.className = "px-2 py-1.5 font-bold text-sm whitespace-nowrap outline-none hover:text-blue-600";
    if(currentClass === cls && !isHidden) btn.classList.add("text-blue-600", "font-black");
    btn.innerText = cls; 
    
    btn.onclick = function() { 
        if(isHidden) {
            if(confirm(`'${cls}' 학급 숨김을 해제하시겠습니까?`)) window.unhideClass(cls);
        } else {
            window.selectClass(cls); window.closeManageModal(); window.renderStartupClassList(); 
        }
    }; 
    wrapper.appendChild(btn);
    
    const delBtn = document.createElement('button');
    delBtn.className = "text-slate-400 hover:text-red-500 text-sm font-black transition p-1";
    delBtn.innerHTML = "&times;";
    delBtn.onclick = function() { window.deleteClass(cls); };
    wrapper.appendChild(delBtn);

    return wrapper;
}

window.dropToHideClass = function(e) {
    e.preventDefault();
    const cls = e.dataTransfer.getData('text/plain');
    if (cls && classData[cls] && !hiddenClasses.includes(cls)) {
        hiddenClasses.push(cls);
        saveData();
        window.renderClassSelect();
        window.renderStartupClassList();
    }
};

window.unhideClass = function(cls) {
    hiddenClasses = hiddenClasses.filter(c => c !== cls);
    saveData();
    window.renderClassSelect();
    window.renderStartupClassList();
};

let showHiddenClasses = false;
window.toggleHiddenClasses = function() {
    showHiddenClasses = !showHiddenClasses;
    const el = document.getElementById('hidden-class-list');
    const icon = document.getElementById('hidden-class-toggle-icon');
    if (showHiddenClasses) {
        el.classList.remove('hidden');
        icon.innerText = "🔽";
    } else {
        el.classList.add('hidden');
        icon.innerText = "👁️";
    }
};

function normalizeClassName(name) { return name ? name.trim().replace(/\s+/g, '') : name; }

window.addNewClass = function() {
    const input = document.getElementById('new-class-input');
    let newClassName = input.value.trim(); newClassName = normalizeClassName(newClassName);
    if (!newClassName) return alert("추가할 학급 이름을 입력해주세요.");
    if (classData[newClassName]) return alert("이미 존재하는 학급입니다.");
    classData[newClassName] = [];
    groupScores[newClassName] = { mixed2: {1:0, 2:0}, mixed3: {1:0, 2:0, 3:0}, mixed4: {1:0, 2:0, 3:0, 4:0}, gender: {1:0, 2:0, 3:0, 4:0} };
    groupRecords[newClassName] = { mixed2: {}, mixed3: {}, mixed4: {}, gender: {} };
    classStamps[newClassName] = Array(TOTAL_STAMP_CELLS).fill(false);
    saveData(); input.value = ""; window.renderClassSelect(); window.selectClass(newClassName);
    window.renderStartupClassList();
}

window.deleteClass = function(clsName) {
    if (confirm(`'${clsName}' 학급을 삭제하시겠습니까?`)) {
        delete classData[clsName]; delete groupScores[clsName]; delete groupRecords[clsName]; delete classStamps[clsName];
        hiddenClasses = hiddenClasses.filter(c => c !== clsName);
        if(currentClass === clsName) {
            currentClass = ""; 
            window.openClassSelection();
        }
        saveData(); window.renderClassSelect(); window.renderStartupClassList();
    }
}

window.importFromExcel = function() {
    const input = document.getElementById('excel-input').value.trim();
    if (!input) return alert("입력된 데이터가 없습니다.");
    if (!currentClass) return alert("추가할 학급이 선택되지 않았습니다.");
    
    const lines = input.split('\n');
    let addedCount = 0;
    let currentStudents = classData[currentClass] || [];

    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
            const no = parseInt(parts[0]); const name = parts[1]; let gender = parts.length > 2 ? parts[2] : '-';
            if (!isNaN(no) && name) {
                const existingIdx = currentStudents.findIndex(s => s.no === no);
                const newStudent = { 
                    no: no, name: name, gender: gender, ballSense: '0', attendance: true, score: 0, recordMs: 0, memo: "", dismissalInfo: "", 
                    drawn: false, groupMemberDrawn: false, gagaDrawn: false, isReferee: false,
                    captain_mixed2: false, captain_mixed3: false, captain_mixed4: false, captain_gender: false,
                    group_mixed2: null, group_mixed3: null, group_mixed4: null, group_gender: null 
                };
                if (existingIdx > -1) currentStudents[existingIdx] = newStudent;
                else currentStudents.push(newStudent);
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        classData[currentClass] = currentStudents;
        saveData(); document.getElementById('excel-input').value = "";
        alert(`${addedCount}명의 학생이 등록/수정되었습니다.`);
        if (currentTab === 'gagaball') window.renderGagaball();
    }
}

// 룰렛 플로팅 버튼 드래그 초기화
document.addEventListener('DOMContentLoaded', () => {
    window.initDraggableRouletteBtn();
});
setTimeout(() => {
    window.initDraggableRouletteBtn();
}, 1000);
