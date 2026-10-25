import { auth, db, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, runTransaction, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { mergeSchoolState, validateBackup, timerPosition } from './state-sync.js';
import { mountConsole } from './console.js';
import { assignUniqueClassAvatars, avatarPaths, buildRankingPages, escapeHTML, getCountdownState, getIndividualRefereeLimit, getRankingGridLayout, getRefereeEligibleTeams, getTeamRefereePlan, isWantedMission, limitSelectedReferees, mergeStudent, normalizeClassName, sortParticipants, toggleTeamKingSelection, validateMissions } from './app-utils.js';

// ==========================================
// 1. 오디오 통합 관리 (MP3 + Web Audio API)
// ==========================================
const storedVolume = localStorage.getItem('gaga-volume');
const savedVolume = Number(storedVolume);
window.globalVolume = storedVolume !== null && Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1 ? savedVolume : 0.8;
window.isGlobalMuted = localStorage.getItem('gaga-muted') === 'true';
let currentDrawIsChampions = false;

const audioFiles = {
    anthem: new Audio('sound/orchestral-anthem.mp3'),
    waiting: new Audio('sound/pixels-in-motion.mp3'),
    tadaa: new Audio('sound/tadaa01.mp3'),
    spinner: new Audio('sound/spinner01.mp3'),
    fanfare: new Audio('sound/fanfare.mp3'),
    goodresult: new Audio('sound/goodresult.mp3')
};
audioFiles.anthem.loop = true;
audioFiles.waiting.loop = true;
Object.values(audioFiles).forEach(audio => { audio.preload = 'none'; });
const WAITING_BGM_GAIN = 0.3;
const WAITING_EFFECT_GAIN = 0.35;

function updateWaitingVolume() {
    audioFiles.waiting.volume = getAudioVolume('waiting');
}

for (const key of ['spinner', 'fanfare', 'goodresult']) {
    for (const event of ['play', 'pause', 'ended', 'error']) {
        audioFiles[key].addEventListener(event, updateWaitingVolume);
    }
}

function getAudioVolume(key) {
    if (key !== 'waiting') return window.globalVolume;
    const revealing = document.getElementById('event-loading-overlay');
    const ducked = document.getElementById('rouletteModal')?.style.display === 'flex'
        || (revealing && !revealing.classList.contains('hidden'))
        || ['spinner', 'fanfare', 'goodresult'].some(effect => !audioFiles[effect].paused && !audioFiles[effect].ended);
    return window.globalVolume * WAITING_BGM_GAIN * (ducked ? WAITING_EFFECT_GAIN : 1);
}

window.playMP3 = function(key) {
    if (window.isGlobalMuted || window.gagaRemoteMuted) return;
    if (audioFiles[key]) {
        audioFiles[key].volume = getAudioVolume(key);
        if (audioFiles[key].loop && !audioFiles[key].paused) return;
        audioFiles[key].currentTime = 0;
        audioFiles[key].volume = getAudioVolume(key);
        audioFiles[key].muted = false;
        audioFiles[key].play().catch(e => console.log("오디오 재생 제한:", e));
    }
};

window.stopMP3 = function(key) {
    if (audioFiles[key]) {
        audioFiles[key].pause();
        audioFiles[key].currentTime = 0;
    }
};

function syncBackgroundMusic() {
    const titleScreen = document.getElementById('class-selection-screen');
    const titleToggle = document.getElementById('title-audio-toggle');
    const app = document.getElementById('app-container');
    const timer = document.getElementById('timerScreen');
    const draw = document.getElementById('gagaDrawModal');
    let track = null;
    if (!titleScreen.classList.contains('hidden') && !titleToggle.classList.contains('hidden')) {
        track = 'anthem';
    } else if (!app.classList.contains('hidden') && currentTab === 'gagaball'
        && timer.style.display !== 'block'
        && (draw.style.display !== 'flex' || !currentDrawIsChampions)) {
        track = document.getElementById('gaga-view-rank').classList.contains('hidden') ? 'waiting' : 'anthem';
    }
    for (const key of ['anthem', 'waiting']) {
        if (key !== track || window.isGlobalMuted) window.stopMP3(key);
        else window.playMP3(key);
    }
}

function applyGlobalVolume() {
    const muted = window.isGlobalMuted || window.globalVolume === 0 || window.gagaRemoteMuted;
    Object.entries(audioFiles).forEach(([key, audio]) => {
        audio.volume = getAudioVolume(key);
        audio.muted = muted;
    });
    if (activeTimerAudio) {
        activeTimerAudio.volume = window.globalVolume;
        activeTimerAudio.muted = muted;
    }
    if (masterGain && audioCtx) masterGain.gain.setValueAtTime(muted ? 0 : window.globalVolume, audioCtx.currentTime);
    const muteButton = document.getElementById('global-mute-btn');
    if (muteButton) {
        muteButton.textContent = muted ? '🔇' : '🔊';
        muteButton.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
        muteButton.setAttribute('aria-pressed', String(muted));
    }
    const titleButton = document.getElementById('title-audio-toggle');
    if (titleButton) {
        titleButton.textContent = muted ? '🔇 음악 켜기' : '🔊 음악 끄기';
        titleButton.setAttribute('aria-label', muted ? '배경 음악 켜기' : '배경 음악 끄기');
        titleButton.setAttribute('aria-pressed', String(muted));
    }
    const timerVolumeIcon = document.getElementById('timer-volume-icon');
    if (timerVolumeIcon) timerVolumeIcon.textContent = muted ? '🔇 볼륨' : '🔊 볼륨';
    document.querySelectorAll('.volume-slider').forEach(slider => { slider.value = String(Math.round(window.globalVolume * 100)); });
    document.querySelectorAll('.volume-value').forEach(label => { label.textContent = `${Math.round(window.globalVolume * 100)}%`; });
}

window.toggleGlobalMute = function() {
    window.isGlobalMuted = !window.isGlobalMuted;
    if (!window.isGlobalMuted && window.globalVolume === 0) window.globalVolume = 0.8;
    localStorage.setItem('gaga-muted', String(window.isGlobalMuted));
    localStorage.setItem('gaga-volume', String(window.globalVolume));
    applyGlobalVolume();
    if (!window.isGlobalMuted) syncBackgroundMusic();
};

window.setGlobalVolume = function(value) {
    const percent = Math.min(100, Math.max(0, Number(value)));
    if (!Number.isFinite(percent)) return;
    window.globalVolume = percent / 100;
    window.isGlobalMuted = percent === 0;
    localStorage.setItem('gaga-volume', String(window.globalVolume));
    localStorage.setItem('gaga-muted', String(window.isGlobalMuted));
    applyGlobalVolume();
    if (!window.isGlobalMuted) syncBackgroundMusic();
};

queueMicrotask(applyGlobalVolume);

const handleFirstInteraction = () => { initAudio(); };
document.body.addEventListener('click', handleFirstInteraction);
document.body.addEventListener('touchstart', handleFirstInteraction);

let audioCtx;
let masterGain;
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = window.isGlobalMuted || window.gagaRemoteMuted ? 0 : window.globalVolume;
        masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
    return audioCtx;
}

window.playCoinSound = function() {
    if (window.isGlobalMuted) return;
    try {
        const ctx = initAudio();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.connect(gain); gain.connect(masterGain);
        osc.frequency.setValueAtTime(987.77, ctx.currentTime);
        osc.frequency.setValueAtTime(1318.51, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}
}

window.playBumpSound = function() {
    if (window.isGlobalMuted) return;
    try {
        const ctx = initAudio();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'triangle'; osc.connect(gain); gain.connect(masterGain);
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
    if (window.gagaCompact) return;
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
window.selectedParticipants = [];
let individualMissionResult = null;
let teamMissionResults = {};

window.lastTeamScoreChange = { teamId: null, val: 0, time: 0 };

const TOTAL_STAMP_CELLS = 20;
let defaultStampImg = "images/stamps/stamp01.jpg";
let globalStampImage = localStorage.getItem('customStamp') || defaultStampImg;
if (globalStampImage.startsWith("data:image/svg+xml")) globalStampImage = defaultStampImg;

const fallbackSVG = `data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ccircle%20cx%3D%2250%22%20cy%3D%2250%22%20r%3D%2250%22%20fill%3D%22%23f1f2f6%22%2F%3E%3Ctext%20x%3D%2250%22%20y%3D%2268%22%20font-size%3D%2245%22%20text-anchor%3D%22middle%22%3E%F0%9F%91%A4%3C%2Ftext%3E%3C%2Fsvg%3E`;

window.generateCuteAvatar = function(student) {
    if (window.gagaCompact) return fallbackSVG;
    if (!student) return fallbackSVG;
    if (student.customAvatar) return student.customAvatar;
    return fallbackSVG;
}

window.toggleAttendance = function(no) {
    if(!currentClass || !classData[currentClass]) return;
    const student = classData[currentClass].find(s => s.no == no);
    if(student) {
        student.attendance = !student.attendance;
        if(!student.attendance) {
            student.gagaDrawn = false; 
            window.selectedParticipants = window.selectedParticipants.filter(selectedNo => selectedNo !== Number(no));
        }
        saveData();
        window.renderGagaball();
        window.renderGagaRanking();
    }
};

window.openAddStudentModal = function() {
    if (!currentClass || !classData[currentClass]) {
        alert("학생을 추가할 학급을 먼저 선택해주세요.");
        return;
    }

    const students = classData[currentClass];
    const nextNumber = students.length > 0
        ? Math.max(...students.map(student => Number(student.no) || 0)) + 1
        : 1;
    const modal = document.getElementById('addStudentModal');
    const form = document.getElementById('add-student-form');
    form.reset();
    document.getElementById('add-student-class-name').innerText = `${currentClass} 학급`;
    document.getElementById('add-student-number').value = nextNumber;
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('add-student-name').focus(), 0);
};

window.closeAddStudentModal = function() {
    const modal = document.getElementById('addStudentModal');
    if (modal) modal.style.display = 'none';
};

window.addStudent = function() {
    if (!currentClass || !classData[currentClass]) return;

    const no = Number(document.getElementById('add-student-number').value);
    const name = document.getElementById('add-student-name').value.trim();
    const gender = document.getElementById('add-student-gender').value;

    if (!Number.isInteger(no) || no < 1) return alert("학생 번호는 1 이상의 정수로 입력해주세요.");
    if (!name) return alert("학생 이름을 입력해주세요.");
    if (gender !== '남' && gender !== '여') return alert("성별을 선택해주세요.");
    if (classData[currentClass].some(student => Number(student.no) === no)) {
        return alert(`${no}번 학생이 이미 등록되어 있습니다.`);
    }
    if (classData[currentClass].filter(student => student.gender === gender).length >= 50) {
        return alert(`${gender}학생 아바타 50종이 모두 사용 중입니다.`);
    }

    classData[currentClass].push(mergeStudent(null, { no, name, gender }));
    classData[currentClass].sort((a, b) => a.no - b.no);
    saveData();
    window.closeAddStudentModal();
    window.renderGagaball();
    window.renderGagaRanking();
};

window.deleteStudent = function(no) {
    if (!currentClass || !classData[currentClass]) return;
    const student = classData[currentClass].find(item => Number(item.no) === Number(no));
    if (!student) return;
    if (!confirm(`${student.no}번 ${student.name} 학생을 삭제하시겠습니까?\n점수와 경기 기록도 함께 삭제됩니다.`)) return;

    classData[currentClass] = classData[currentClass].filter(item => Number(item.no) !== Number(no));
    window.selectedParticipants = window.selectedParticipants.filter(selectedNo => Number(selectedNo) !== Number(no));
    currentGagaTeams.forEach(team => {
        team.members = team.members.filter(member => Number(member.no) !== Number(no));
    });
    saveData();
    window.renderGagaball();
    window.renderGagaRanking();
    if (currentGagaTeams.length > 0) window.renderGagaTeamView();
};

// ==========================================
// 3. 파이어베이스 연동 로직
// ==========================================
let userId = null; 
let saveTimer = null;
let saveInFlight = false;
let saveRequested = false;
let unsubscribeSnapshot = null;
let savedSchool = null;
let draftRecovered = false;
let syncError = '';
let pendingCommit = null;
const writerId = sessionStorage.getItem('gaga-writer') || crypto.randomUUID();
sessionStorage.setItem('gaga-writer', writerId);
const schoolRef = () => doc(db, 'artifacts', 'running-measurement-app', 'sharedRooms', 'dongsan-school-db');
const draftKey = () => `gaga-draft-v1:${userId}:${writerId}`;
function schoolState() {
    return structuredClone({ data: classData, scores: groupScores, records: groupRecords, stamps: classStamps,
        stampImage: globalStampImage, hiddenClasses, rouletteMissions: { individual: individualMissions, team: teamMissions } });
}
function readSchool(data = {}) {
    return { data: data.data || {}, scores: data.scores || {}, records: data.records || {}, stamps: data.stamps || {},
        stampImage: data.stampImage || defaultStampImg, hiddenClasses: data.hiddenClasses || [],
        rouletteMissions: { individual: data.rouletteMissions?.individual || defaultIndividualMissions,
            team: data.rouletteMissions?.team || defaultTeamMissions } };
}
function applySchool(data) {
    // Keep the last acknowledged cloud snapshot immutable for three-way merging.
    data = structuredClone(data);
    classData = data.data; groupScores = data.scores; groupRecords = data.records; classStamps = data.stamps;
    hiddenClasses = data.hiddenClasses; globalStampImage = data.stampImage;
    individualMissions = data.rouletteMissions.individual; teamMissions = data.rouletteMissions.team;
    if (!isSpinning) currentMissions = currentMissionsType === 'team' ? teamMissions : individualMissions;
    currentGagaTeams.forEach(team => { team.members = team.members.map(member => {
        const student = classData[currentClass]?.find(s => s.no === member.no);
        return student ? { ...student, isKing: member.isKing } : null;
    }).filter(Boolean); });
}
function refreshSchoolViews() {
    if (currentClass && !classData[currentClass]) { currentClass = ''; window.openClassSelection(); }
    if (currentClass) {
        window.renderGagaball(); window.renderGagaRanking(); window.renderGagaTeamView(); window.renderStampBoard();
        document.querySelectorAll('[id^="modal-score-"]').forEach(node => {
            const s = classData[currentClass].find(s => s.no === Number(node.id.replace('modal-score-', '')));
            if (s) node.textContent = s.score;
        });
    }
    window.renderClassSelect();
    window.dispatchEvent(new Event('gaga-state'));
}
function keepDraft() {
    if (!userId || !savedSchool) return;
    try { localStorage.setItem(draftKey(), JSON.stringify({ base: savedSchool, local: schoolState(), pendingCommit })); }
    catch { syncError = '기기 저장 공간이 부족합니다. 백업을 내려받아 주세요.'; }
}

function setSyncStatus(state, message = '') {
    window.gagaSyncStatus = state === 'idle' ? '저장 완료' : message || (state === 'saving' ? '저장 중' : '저장 실패 · 재시도 필요');
    window.dispatchEvent(new Event('gaga-sync'));
    const syncIcon = document.getElementById('sync-status');
    if (!syncIcon) return;
    syncIcon.classList.toggle('hidden', state === 'idle');
    syncIcon.classList.toggle('flex', state !== 'idle');
    syncIcon.classList.toggle('bg-red-700', state === 'error');
    syncIcon.classList.toggle('bg-slate-700', state !== 'error');
    const label = syncIcon.querySelector('[data-sync-label]');
    if (label) label.innerText = message || (state === 'saving' ? '저장 중' : '동기화 오류');
}

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
            savedSchool = null; draftRecovered = false; pendingCommit = null;
            window.dispatchEvent(new Event('gaga-auth'));
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('user-email').innerText = user.email.split('@')[0];
            setupFirestoreListener();
        } else {
            clearTimeout(saveTimer);
            if (saveRequested || saveInFlight) keepDraft();
            userId = null;
            savedSchool = null; saveRequested = false;
            window.closeGagaTimer();
            window.dispatchEvent(new Event('gaga-auth'));
            if(unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
            window.stopMP3('anthem');
            window.stopMP3('waiting');
            document.getElementById('login-screen').classList.remove('hidden');
            document.getElementById('app-container').classList.add('hidden');
            document.getElementById('class-selection-screen').classList.add('hidden');
            document.getElementById('class-selection-screen').classList.remove('flex');
            window.closeStartupClassPanel();
            document.getElementById('title-audio-toggle').classList.add('hidden');
            document.getElementById('title-volume-slider').classList.add('hidden');
            classData = {}; groupScores = {}; groupRecords = {}; classStamps = {}; hiddenClasses = [];
            currentClass = ""; 
            window.selectedParticipants = [];
            currentGagaTeams = [];
            currentGagaStandbyReferees = [];
            currentGagaRefereeWarning = false;
            individualMissionResult = null;
            teamMissionResults = {};
        }
    });
}

function setupFirestoreListener() {
    if (!userId || !db) return;
    const docRef = doc(db, 'artifacts', 'running-measurement-app', 'sharedRooms', 'dongsan-school-db');
    if (unsubscribeSnapshot) unsubscribeSnapshot(); 
    setSyncStatus('saving', '불러오는 중');

    unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
        if (docSnap.metadata.hasPendingWrites) return;
        if (saveRequested || saveInFlight) return;
        if (draftRecovered && savedSchool && JSON.stringify(savedSchool) === JSON.stringify(readSchool(docSnap.data()))) return;
        setSyncStatus('idle');
        if (docSnap.exists()) {
            const data = docSnap.data();
            savedSchool = readSchool(data);
            if (!draftRecovered) {
                draftRecovered = true;
                try {
                    const draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
                    if (draft) {
                        pendingCommit = draft.pendingCommit || null;
                        if (pendingCommit) { savedSchool = draft.base; applySchool(draft.local); }
                        else applySchool(mergeSchoolState(draft.base, draft.local, savedSchool));
                        saveData(); refreshSchoolViews();
                        if (!currentClass) window.openClassSelection();
                        return;
                    }
                } catch (error) { syncError = `임시본 자동 복구 실패: ${error.message}`; setSyncStatus('error', '임시본 복구 확인 필요'); }
            }
            applySchool(savedSchool);
            let avatarsChanged = false;
            Object.values(classData).forEach(students => {
                if (Array.isArray(students) && assignUniqueClassAvatars(students)) avatarsChanged = true;
            });
            if (avatarsChanged) saveData();
            hiddenClasses = data.hiddenClasses || [];
            if (data.stampImage) { globalStampImage = data.stampImage; localStorage.setItem('customStamp', globalStampImage); document.querySelectorAll('.stamp-img').forEach(img => { img.src = globalStampImage; }); }
            
        }
        
        if (!savedSchool) savedSchool = readSchool();
        if (!currentClass) {
            const lastClass = sessionStorage.getItem(`gaga-last-class:${userId}`);
            if (lastClass && classData[lastClass]) window.selectClass(lastClass);
            else window.openClassSelection();
        } else if (classData[currentClass]) {
            if(currentTab === 'gagaball') window.renderGagaball();
            if(currentTab === 'stamp') window.renderStampBoard();
        }
        window.renderClassSelect();
        refreshSchoolViews();
    }, (error) => {
        console.error("데이터 동기화 오류:", error);
        setSyncStatus('error', '불러오기 실패');
    });
}

function saveData() {
    if (!userId || !db) return;
    Object.values(classData).forEach(students => {
        if (Array.isArray(students)) assignUniqueClassAvatars(students);
    });
    saveRequested = true;
    keepDraft();
    clearTimeout(saveTimer);
    setSyncStatus('saving');
    saveTimer = setTimeout(flushSaveData, 150);
}

async function flushSaveData() {
    if (saveInFlight || !saveRequested || !userId || !db) return;
    saveInFlight = true;
    saveRequested = false;

    if (!pendingCommit) pendingCommit = { id: crypto.randomUUID(), writer: writerId, sent: schoolState(), base: structuredClone(savedSchool || readSchool()) };
    const operation = pendingCommit;
    const sent = operation.sent;
    const base = operation.base;
    keepDraft();
    const savingUser = userId;

    try {
        const docRef = doc(db, 'artifacts', 'running-measurement-app', 'sharedRooms', 'dongsan-school-db');
        const committed = await runTransaction(db, async transaction => {
            const snapshot = await transaction.get(docRef);
            if (snapshot.data()?.saveReceipts?.[operation.writer] === operation.id) return readSchool(snapshot.data());
            const merged = mergeSchoolState(base, sent, readSchool(snapshot.data()));
            // Top-level replacement deliberately removes deleted classes. Room fields are preserved.
            const receipts = { ...snapshot.data()?.saveReceipts, [operation.writer]: operation.id };
            // Keep a bounded recent receipt list; the current operation is always retained.
            const saveReceipts = Object.fromEntries(Object.entries(receipts).slice(-100));
            if (snapshot.exists()) transaction.update(docRef, { ...merged, saveReceipts });
            else transaction.set(docRef, { ...merged, saveReceipts });
            return merged;
        });
        if (userId !== savingUser) return;
        const rebased = mergeSchoolState(sent, schoolState(), committed);
        pendingCommit = null;
        saveRequested = JSON.stringify(rebased) !== JSON.stringify(committed);
        savedSchool = committed;
        applySchool(rebased);
        syncError = '';
        if (saveRequested) keepDraft(); else localStorage.removeItem(draftKey());
        refreshSchoolViews();
        setSyncStatus(saveRequested ? 'saving' : 'idle');
    } catch (error) {
        console.error('데이터 저장 오류:', error);
        if (userId !== savingUser) return;
        syncError = error.message;
        saveRequested = true;
        keepDraft();
        setSyncStatus('error', '저장 실패');
    } finally {
        saveInFlight = false;
        if (saveRequested && !syncError) {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(flushSaveData, 500);
        }
    }
}
window.addEventListener('online', () => { if (saveRequested) { syncError = ''; flushSaveData(); } });
window.addEventListener('beforeunload', event => {
    if (saveRequested || saveInFlight) { keepDraft(); event.preventDefault(); event.returnValue = ''; }
});

// ==========================================
// 4. 앱 UI 제어 및 학급 선택 로직
// ==========================================
window.syncHeaderOffset = function() {
    const header = document.getElementById('main-header');
    if (!header || document.getElementById('app-container').classList.contains('hidden')) return;
    document.documentElement.style.setProperty('--main-header-height', `${header.offsetHeight}px`);
};

window.openClassSelection = function() {
    const screen = document.getElementById('class-selection-screen');
    if (screen.classList.contains('hidden')) {
        window.stopMP3('anthem');
        window.stopMP3('waiting');
        window.closeStartupClassPanel();
        document.getElementById('title-audio-toggle').classList.add('hidden');
        document.getElementById('title-volume-slider').classList.add('hidden');
    }
    document.body.classList.remove('app-header-visible');
    document.getElementById('app-container').classList.add('hidden');
    screen.classList.remove('hidden');
    window.renderStartupClassList();
};

window.openStartupClassPanel = function() {
    const panel = document.getElementById('startup-class-panel');
    if (!panel.classList.contains('hidden')) return;
    // 이 재생 호출은 타이틀 버튼 클릭 안에서 실행되어 브라우저 자동 재생 제한을 피한다.
    if (audioFiles.anthem.paused) window.playMP3('anthem');
    panel.classList.remove('hidden');
    document.getElementById('title-start-button').setAttribute('aria-expanded', 'true');
    document.getElementById('title-start-hint').textContent = '학급을 선택하세요';
    document.getElementById('title-audio-toggle').classList.remove('hidden');
    document.getElementById('title-volume-slider').classList.remove('hidden');
    syncBackgroundMusic();
};

window.closeStartupClassPanel = function() {
    document.getElementById('startup-class-panel').classList.add('hidden');
    document.getElementById('title-start-button').setAttribute('aria-expanded', 'false');
    document.getElementById('title-start-hint').textContent = '타이틀을 눌러 시작하세요';
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
        rowDiv.className = "startup-grade-row";
        
        grouped[grade].forEach(cls => {
            const btn = document.createElement('button');
            btn.className = "startup-class-button";
            btn.innerText = cls;
            btn.onclick = () => window.selectClass(cls);
            rowDiv.appendChild(btn);
        });
        listEl.appendChild(rowDiv);
    });
};

window.selectClass = function(className) {
    if (!classData[className]) return;
    window.closeGagaTimer(false);
    window.closeGagaDrawModal();
    window.closeRouletteModal(true);
    document.getElementById('gagaDrawResultGrid').replaceChildren();
    currentClass = className;
    currentDrawIsChampions = false;
    window.selectedParticipants = [];
    currentGagaTeams = [];
    currentGagaStandbyReferees = [];
    currentGagaRefereeWarning = false;
    individualMissionResult = null;
    teamMissionResults = {};
    window.stopMP3('anthem');
    window.stopMP3('waiting');
    
    document.getElementById('class-selection-screen').classList.add('hidden');
    document.getElementById('class-selection-screen').classList.remove('flex');
    document.getElementById('app-container').classList.remove('hidden');
    document.body.classList.add('app-header-visible');
    requestAnimationFrame(window.syncHeaderOffset);
    
    const displayBtn = document.getElementById('current-class-display');
    if (displayBtn) {
        const label = document.createElement('span');
        label.innerText = `🔄 ${className}`;
        displayBtn.replaceChildren(label);
    }
    
    window.showTab(currentTab);
    prepareTimerAudio();
};

const mainHeader = document.getElementById('main-header');
if (mainHeader && 'ResizeObserver' in window) {
    new ResizeObserver(window.syncHeaderOffset).observe(mainHeader);
}
window.addEventListener('resize', window.syncHeaderOffset);
window.addEventListener('orientationchange', () => requestAnimationFrame(window.syncHeaderOffset));

window.showTab = function(tabName) {
    currentTab = tabName;
    ['gagaball-section', 'stamp-section'].forEach(id => document.getElementById(id).classList.add('hidden'));

    const tabGaga = document.getElementById('tab-gagaball');
    const tabStamp = document.getElementById('tab-stamp');
    const gagaHeaderTabs = document.getElementById('gaga-header-tabs');

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
        syncBackgroundMusic();
        window.syncRankingAutoplay();
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

    window.hideFloatingRouletteBtn();

    if(tab === 'score') window.renderGagaball();
    if(tab === 'rank') { 
        window.renderGagaRanking();
    }
    if(tab === 'team') window.renderGagaTeamView();
    window.updateParticipantActions();
    syncBackgroundMusic();
    window.syncRankingAutoplay();
}

window.changeDrawCount = function(delta) {
    const input = document.getElementById('gaga-draw-count');
    let val = parseInt(input.value) + delta;
    if(val < 1) val = 1;
    if(val > 10) val = 10;
    input.value = val;
}

let participantSortMode = 'number';
window.setGagaParticipantSort = function(mode) {
    participantSortMode = ['number', 'score', 'boys-number', 'girls-number', 'boys-score', 'girls-score'].includes(mode) ? mode : 'number';
    window.renderGagaball();
};

window.renderGagaball = function() {
    const activeGrid = document.getElementById('gaga-active-grid');
    const inactiveGrid = document.getElementById('gaga-inactive-grid');
    if(!activeGrid || !currentClass || !classData[currentClass]) return;
    window.selectedParticipants = window.selectedParticipants.filter(no =>
        classData[currentClass].some(student => Number(student.no) === no && student.attendance)
    );

    let availableTotal = 0, availableBoys = 0, availableGirls = 0;
    const students = sortParticipants(classData[currentClass], participantSortMode);
    const refereeLimit = getIndividualRefereeLimit(students);
    const activeRefereeCount = students.filter(student => student.attendance && student.isReferee).length;

    let activeHTML = ''; let inactiveHTML = '';

    students.forEach((s) => {
        const isDrawn = s.gagaDrawn; const drawnClass = isDrawn ? 'drawn' : '';
        const isSelected = s.attendance && window.selectedParticipants.includes(Number(s.no));
        const btnText = s.attendance ? '참석' : '불참';
        const btnClass = s.attendance ? 'bg-green-500 text-white' : 'bg-slate-400 text-white opacity-80';
        let borderStyle = s.gender === '남' ? '#3498db' : (s.gender === '여' ? '#e74c3c' : '#2ecc71');
        if(!s.attendance || isDrawn) borderStyle = '#95a5a6';

        if(s.attendance && !isDrawn && (!s.isReferee || refereeLimit > 0)) {
            availableTotal++; if(s.gender === '남') availableBoys++; if(s.gender === '여') availableGirls++;
        }
        let bgColor = s.attendance && !isDrawn ? (s.gender === '남' ? '#e3f2fd' : '#ffebee') : '#fff';
        const cuteAvatar = window.generateCuteAvatar(s); 

        const cardHTML = `
            <article class="score-item ${drawnClass} ${isSelected ? 'participant-selected' : ''}" style="border-color: ${borderStyle}; background-color: ${bgColor};" aria-label="${escapeHTML(s.name)} 학생, ${s.score || 0}점" ${s.attendance ? `onclick="window.handleParticipantCardClick(event, ${s.no})"` : ''}>
                ${s.attendance ? `<button class="participant-select-button" type="button" onclick="event.stopPropagation(); window.toggleParticipantSelection(${s.no})" aria-label="${escapeHTML(s.name)} 학생 ${isSelected ? '선택 해제' : '선택'}" aria-pressed="${isSelected}">${isSelected ? '✓ 선택됨' : '○ 선택'}</button>` : ''}
                <button class="student-delete-btn absolute top-1.5 right-1.5 z-30" onclick="window.deleteStudent(${s.no})" aria-label="${escapeHTML(s.name)} 학생 삭제" title="학생 삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button>
                <div class="attendance-row flex justify-center items-center mb-2 sm:mb-3 relative z-20">
                    <button class="attendance-btn ${btnClass} px-2 sm:px-3 py-1 rounded-md text-xs sm:text-sm font-bold transition hover:opacity-80" onclick="window.toggleAttendance(${s.no})" aria-label="${escapeHTML(s.name)} 학생 ${btnText} 상태 변경">${btnText}</button>
                </div>
                
                <div class="avatar-wrapper relative w-[100px] h-[100px] sm:w-[120px] sm:h-[120px] mx-auto mb-3">
                    <img src="${escapeHTML(cuteAvatar)}" alt="${escapeHTML(s.name)} 아바타" class="w-full h-full rounded-full cursor-pointer hover:scale-105 transition-transform border-4 object-cover block bg-white" onclick="window.openAvatarSelectModal(${s.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" style="border-color: ${borderStyle};" title="아바타 변경">
                    ${isDrawn ? `
                    <div class="absolute inset-0 z-10 flex items-center justify-center pointer-events-none rounded-full bg-slate-900/40">
                        <img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'%3E%3Crect width='120' height='40' rx='8' fill='%23ef4444' stroke='white' stroke-width='3'/%3E%3Ctext x='60' y='27' font-family='sans-serif' font-size='22' font-weight='900' fill='white' text-anchor='middle'%3E뽑기완료%3C/text%3E%3C/svg%3E" class="transform -rotate-12 w-20 sm:w-28 drop-shadow-md">
                    </div>
                    ` : ''}
                </div>

                <div class="name relative z-20">${escapeHTML(s.name)} <span class="text-xs sm:text-lg">(${escapeHTML(s.gender)})</span></div>
                ${s.isReferee ? '<span class="referee-badge">⚖️ 심판</span>' : ''}
                <div class="score-val relative z-20">${s.score || 0}</div>
                <div class="score-ctrl relative z-20">
                    <button class="minus" onclick="window.changeGagaScore(${s.no}, -1)" aria-label="${escapeHTML(s.name)} 점수 1점 빼기">−</button>
                    <button class="plus" onclick="window.changeGagaScore(${s.no}, 1)" aria-label="${escapeHTML(s.name)} 점수 1점 더하기">+</button>
                </div>
            </article>
        `;
        if(s.attendance) activeHTML += cardHTML; else inactiveHTML += cardHTML;
    });

    activeGrid.innerHTML = activeHTML;
    inactiveGrid.innerHTML = inactiveHTML;
    document.getElementById('gaga-participant-sort').value = participantSortMode;
    document.getElementById('gaga-draw-stats').innerText = `대기: 총 ${availableTotal}명 (남 ${availableBoys} / 여 ${availableGirls})${activeRefereeCount === 1 ? ' · 심판 1명은 경기 심판으로 대기' : ''}`;
    window.updateParticipantActions();
};

window.handleParticipantCardClick = function(event, no) {
    if (event.target.closest('button, img')) return;
    window.toggleParticipantSelection(no);
};

window.toggleParticipantSelection = function(no) {
    const student = classData[currentClass]?.find(item => Number(item.no) === Number(no));
    if (!student?.attendance) return;
    const selected = window.selectedParticipants;
    const index = selected.indexOf(Number(no));
    if (index >= 0) selected.splice(index, 1);
    else selected.push(Number(no));
    window.renderGagaball();
};

window.updateParticipantActions = function() {
    const fab = document.getElementById('participant-actions-fab');
    if (!fab) return;
    const scoreView = document.getElementById('gaga-view-score');
    const visible = window.selectedParticipants.length > 0 && currentTab === 'gagaball' && !scoreView.classList.contains('hidden');
    fab.classList.toggle('hidden', !visible);
    if (!visible) return;
    const selected = window.selectedParticipants.map(no => classData[currentClass]?.find(s => Number(s.no) === no)).filter(Boolean);
    const allReferees = selected.length > 0 && selected.every(s => s.isReferee);
    document.getElementById('participant-selection-count').textContent = selected.length > 10
        ? `${selected.length}명 선택 · 왕중왕전 최대 10명` : `${selected.length}명 선택`;
    document.getElementById('assign-referee-button').textContent = allReferees ? '⚖️ 심판 해제' : '⚖️ 심판 임명';
    const championsButton = document.getElementById('start-selected-champions-button');
    championsButton.textContent = `👑 왕중왕전 (${selected.length}명)`;
    championsButton.disabled = selected.length < 2 || selected.length > 10;
    championsButton.title = selected.length < 2 ? '왕중왕전에는 학생 2명 이상이 필요합니다.'
        : selected.length > 10 ? '왕중왕전은 최대 10명까지 진행할 수 있습니다.' : '';
};

window.assignSelectedReferees = function() {
    const selected = window.selectedParticipants.map(no => classData[currentClass]?.find(s => Number(s.no) === no)).filter(s => s?.attendance);
    if (!selected.length) return;
    const assign = !selected.every(s => s.isReferee);
    selected.forEach(s => { s.isReferee = assign; });
    if (assign) window.playStampSound(); else window.playBumpSound();
    saveData();
    window.renderGagaball();
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

// 명예의 전당: 상위 세 명은 고정하고 나머지만 TV용 페이지로 넘긴다.
const RANK_PAGE_INTERVAL = 6000;
let rankPages = [];
let rankPageIndex = 0;
let rankPageClass = null;
let rankPageSize = 12;
let rankAutoplay = true;
let rankPageTimer = null;
let rankTransitionTimer = null;
let rankResizeTimer = null;

function isRankingVisible() {
    return !document.hidden && !window.gagaCompact
        && !document.getElementById('app-container').classList.contains('hidden')
        && !document.getElementById('gagaball-section').classList.contains('hidden')
        && !document.getElementById('gaga-view-rank').classList.contains('hidden');
}

function updateRankingControls() {
    const status = document.getElementById('rank-page-status');
    if (status) status.textContent = `${rankPageIndex + 1} / ${rankPages.length}`;
    const toggle = document.getElementById('rank-autoplay-toggle');
    if (toggle) {
        toggle.textContent = rankAutoplay ? '⏸ 자동 넘김' : '▶ 자동 넘김';
        toggle.setAttribute('aria-pressed', String(!rankAutoplay));
    }
    document.querySelectorAll('.rank-page-controls button').forEach(button => {
        button.disabled = rankPages.length < 2;
    });
}

function showRankingPage(animate = false) {
    const grid = document.getElementById('rank-page-grid');
    if (!grid || !rankPages.length) return;
    grid.innerHTML = rankPages[rankPageIndex].map(student => `
        <div class="rank-page-card">
            <span class="rank-page-place">${student.rank}위</span>
            <img src="${escapeHTML(window.generateCuteAvatar(student))}" alt="${escapeHTML(student.name)} 아바타" class="rank-page-avatar">
            <span class="rank-page-name">${escapeHTML(student.name)}</span>
            <span class="rank-page-score">${Number(student.score) || 0}점</span>
        </div>`).join('');
    grid.classList.remove('rank-page-exit', 'rank-page-enter');
    if (animate) {
        void grid.offsetWidth;
        grid.classList.add('rank-page-enter');
    }
    updateRankingControls();
}

window.syncRankingAutoplay = function() {
    clearInterval(rankPageTimer);
    rankPageTimer = null;
    if (window.gagaRankInterval !== 0 && rankAutoplay && rankPages.length > 1 && isRankingVisible()) {
        rankPageTimer = setInterval(() => {
            if (!isRankingVisible()) { window.syncRankingAutoplay(); return; }
            window.changeRankingPage(1);
        }, window.gagaRankInterval || RANK_PAGE_INTERVAL);
    }
};

window.changeRankingPage = function(direction) {
    if (rankPages.length < 2 || rankTransitionTimer) return;
    rankPageIndex = (rankPageIndex + direction + rankPages.length) % rankPages.length;
    const grid = document.getElementById('rank-page-grid');
    if (!grid) return;
    grid.classList.remove('rank-page-enter');
    grid.classList.add('rank-page-exit');
    rankTransitionTimer = setTimeout(() => {
        rankTransitionTimer = null;
        showRankingPage(true);
    }, 180);
    window.syncRankingAutoplay();
};

window.toggleRankingAutoplay = function() {
    rankAutoplay = !rankAutoplay;
    updateRankingControls();
    window.syncRankingAutoplay();
};

window.addEventListener('resize', () => {
    clearTimeout(rankResizeTimer);
    if (isRankingVisible()) rankResizeTimer = setTimeout(() => window.renderGagaRanking(), 120);
});
document.addEventListener('visibilitychange', () => window.syncRankingAutoplay());

window.renderGagaRanking = function() {
    if (window.gagaCompact) return;
    const container = document.getElementById('gaga-hall-of-fame-grid');
    if(!container || !currentClass) return;
    clearTimeout(rankTransitionTimer);
    rankTransitionTimer = null;
    if (rankPageClass !== currentClass) {
        rankPageIndex = 0;
        rankAutoplay = true;
    }
    rankPageClass = currentClass;
    const roster = classData[currentClass] || [];
    const { podium, pages: individualPages } = buildRankingPages(roster, 1);
    const createStageStudent = (student, place) => student ? `
        <div class="rank-stage-student rank-stage-place-${place}">
            <img src="${escapeHTML(window.generateCuteAvatar(student))}" alt="${escapeHTML(student.name)} 아바타" class="rank-podium-avatar">
            <div class="rank-stage-label">
                <span class="rank-stage-rank">${['🥇', '🥈', '🥉'][student.rank - 1]} ${student.rank}위</span>
                <span class="rank-stage-name">${escapeHTML(student.name)}</span>
                <span class="rank-stage-score">${Number(student.score) || 0}점</span>
            </div>
        </div>` : '';
    const createMobilePodiumCard = student => student ? `
        <div class="rank-mobile-card rank-medal-${student.rank}">
            <img src="${escapeHTML(window.generateCuteAvatar(student))}" alt="${escapeHTML(student.name)} 아바타" class="rank-podium-avatar">
            <span class="rank-stage-rank">${['🥇', '🥈', '🥉'][student.rank - 1]} ${student.rank}위</span>
            <span class="rank-stage-name">${escapeHTML(student.name)}</span>
            <span class="rank-stage-score">${Number(student.score) || 0}점</span>
        </div>` : '';
    const podiumHTML = podium.length ? `
        <div class="rank-podium-scene" role="group" aria-label="상위 세 명 고정 순위">
            <img src="images/gagaball-rank-podium.png" alt="" aria-hidden="true" class="rank-podium-art">
            ${createStageStudent(podium[0], 1)}
            ${createStageStudent(podium[1], 2)}
            ${createStageStudent(podium[2], 3)}
            <img src="images/dongsan-school-emblem.png" alt="동산초등학교 엠블럼" class="rank-school-emblem">
        </div>
        <div class="rank-mobile-podium" aria-label="상위 세 명 고정 순위">
            ${podium.map(createMobilePodiumCard).join('')}
        </div>` : '<p class="ranking-empty">참가 중인 학생이 없습니다.</p>';
    const pagesHTML = individualPages.length ? `
        <section class="ranking-pages" aria-label="나머지 학생 순위">
            <div class="rank-page-toolbar">
                <div class="rank-page-controls" role="group" aria-label="순위 페이지 조작">
                    <button type="button" onclick="window.changeRankingPage(-1)" aria-label="이전 순위 페이지">◀ 이전</button>
                    <span id="rank-page-status" role="status" aria-live="polite"></span>
                    <button type="button" onclick="window.changeRankingPage(1)" aria-label="다음 순위 페이지">다음 ▶</button>
                    <button id="rank-autoplay-toggle" type="button" onclick="window.toggleRankingAutoplay()" aria-label="순위 자동 넘김 일시정지 또는 재생"></button>
                </div>
            </div>
            <div class="rank-page-viewport"><div id="rank-page-grid" class="rank-page-grid"></div></div>
        </section>` : '';
    container.innerHTML = podiumHTML + pagesHTML;
    const grid = document.getElementById('rank-page-grid');
    if (grid) {
        const navTop = document.getElementById('tab-navigation').getBoundingClientRect().top;
        const availableHeight = isRankingVisible() ? navTop - grid.getBoundingClientRect().top - 12 : 0;
        const layout = getRankingGridLayout(window.gagaRankingColumns === '5' ? Math.max(1600, window.innerWidth) : window.innerWidth, availableHeight, individualPages.length);
        rankPageSize = layout.pageSize;
        grid.style.setProperty('--rank-columns', layout.columns);
        grid.style.setProperty('--rank-rows', layout.rows);
        grid.style.height = `${layout.height}px`;
        rankPages = buildRankingPages(roster, rankPageSize).pages;
        rankPageIndex = Math.min(rankPageIndex, rankPages.length - 1);
    } else {
        rankPages = [];
        rankPageIndex = 0;
    }
    showRankingPage();
    window.syncRankingAutoplay();
}

const generateGridCards = (students) => {
    return students.map((s) => {
        let borderColor = s.gender === '남' ? '#3498db' : '#e74c3c';
        const cuteAvatar = window.generateCuteAvatar(s);
        
        return `
            <div class="draw-result-card border-[4px] sm:border-[6px] p-2 sm:p-4 rounded-3xl text-center shadow-lg bg-white w-full h-full flex flex-col items-center justify-between" style="border-color: ${borderColor}; box-sizing: border-box;" onclick="window.toggleWantedEffect(event)" onkeydown="window.handleWantedEffectKey(event)" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeHTML(s.name)} 학생 현상수배 효과 켜기">
                <div class="flex-1 w-full flex items-center justify-center min-h-0 pt-2 relative">
                    <img src="${escapeHTML(cuteAvatar)}" alt="${escapeHTML(s.name)} 아바타" class="draw-result-avatar h-full max-h-[160px] lg:max-h-[200px] xl:max-h-[250px] aspect-square rounded-full mx-auto bg-slate-50 border-4 border-slate-100 cursor-pointer object-cover shadow-sm transition hover:scale-105" onclick="event.stopPropagation(); window.openAvatarSelectModal(${s.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" title="아바타 변경">
                </div>
                <div class="wanted-mark" aria-hidden="true"><span class="wanted-heading">WANTED</span><span class="wanted-stars">★ ★ ★</span></div>
                
                <div class="draw-result-name text-4xl sm:text-5xl lg:text-[3.5rem] xl:text-[4.5rem] font-black text-slate-800 my-2 lg:my-3 whitespace-nowrap truncate leading-tight w-full shrink-0 flex items-center justify-center">${escapeHTML(s.name)}</div>
                
                <div class="text-xl sm:text-2xl lg:text-3xl font-black text-slate-600 flex items-center justify-center gap-3 w-full shrink-0 pb-1">
                    <button class="premium-score-btn minus" onclick="event.stopPropagation(); window.changeGagaScore(${s.no}, -1)" aria-label="${escapeHTML(s.name)} 점수 1점 빼기">−</button>
                    <span id="modal-score-${s.no}" class="w-12 lg:w-16 text-center tracking-tighter drop-shadow-sm">${s.score || 0}</span>
                    <button class="premium-score-btn plus" onclick="event.stopPropagation(); window.changeGagaScore(${s.no}, 1)" aria-label="${escapeHTML(s.name)} 점수 1점 더하기">+</button>
                </div>
            </div>
        `;
    }).join('');
}

let wantedRevealInterval = null;
let wantedRevealTimer = null;
let wantedFinishTimer = null;

function clearWantedReveal() {
    clearInterval(wantedRevealInterval);
    clearTimeout(wantedRevealTimer);
    clearTimeout(wantedFinishTimer);
    wantedRevealInterval = wantedRevealTimer = wantedFinishTimer = null;
    const overlay = document.getElementById('wanted-reveal-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('wanted-reveal-final');
}

function revealWantedStudent() {
    const cards = [...document.querySelectorAll('#gagaDrawResultGrid .draw-result-card')];
    if (!cards.length || document.getElementById('gagaDrawModal').style.display !== 'flex') return;
    clearWantedReveal();
    cards.forEach(card => {
        card.classList.remove('wanted-active');
        card.setAttribute('aria-pressed', 'false');
        const studentName = card.querySelector('.draw-result-name')?.textContent || '학생';
        card.setAttribute('aria-label', `${studentName} 학생 현상수배 효과 켜기`);
    });
    const selected = cards[Math.floor(Math.random() * cards.length)];
    const selectedName = selected.querySelector('.draw-result-name')?.textContent || '학생';
    const overlay = document.getElementById('wanted-reveal-overlay');
    const label = document.getElementById('wanted-reveal-label');
    const name = document.getElementById('wanted-reveal-name');
    label.textContent = '⚠️ 현상수배 대상 선정 중…';
    overlay.classList.remove('hidden');
    let index = 0;
    wantedRevealInterval = setInterval(() => {
        name.textContent = cards[index++ % cards.length].querySelector('.draw-result-name')?.textContent || '학생';
    }, 140);
    wantedRevealTimer = setTimeout(() => {
        clearInterval(wantedRevealInterval);
        wantedRevealInterval = null;
        label.textContent = '⚠️ 현상수배 대상 확정!';
        name.textContent = selectedName;
        overlay.classList.add('wanted-reveal-final');
        wantedFinishTimer = setTimeout(() => {
            clearWantedReveal();
            selected.classList.add('wanted-active');
            selected.setAttribute('aria-pressed', 'true');
            selected.setAttribute('aria-label', `${selectedName} 학생 현상수배 효과 끄기`);
            window.playStampSound();
            persistMatch();
        }, 650);
    }, 1800);
}

window.toggleWantedEffect = function(event) {
    const card = event.currentTarget;
    if (!card || event.target.closest('button, img')) return;
    const isActive = !card.classList.contains('wanted-active');
    document.querySelectorAll('#gagaDrawResultGrid .draw-result-card').forEach(other => {
        other.classList.remove('wanted-active');
        other.setAttribute('aria-pressed', 'false');
        const name = other.querySelector('.draw-result-name')?.innerText || '학생';
        other.setAttribute('aria-label', `${name} 학생 현상수배 효과 켜기`);
    });
    card.classList.toggle('wanted-active', isActive);
    card.setAttribute('aria-pressed', String(isActive));
    const studentName = card.querySelector('.draw-result-name')?.innerText || '학생';
    card.setAttribute('aria-label', `${studentName} 학생 현상수배 효과 ${isActive ? '끄기' : '켜기'}`);
    if (isActive) window.playStampSound();
    else window.playBumpSound();
};

window.handleWantedEffectKey = function(event) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    window.toggleWantedEffect(event);
};

window.startChampionsTournament = function() {
    if(window.selectedParticipants.length < 2) return alert('왕중왕전에는 학생 2명 이상을 선택해주세요.');
    if(window.selectedParticipants.length > 10) return alert('왕중왕전은 최대 10명까지 진행할 수 있습니다.');
    let selectedStudents = window.selectedParticipants.map(no => classData[currentClass].find(s => Number(s.no) === no && s.attendance)).filter(Boolean);
    if (selectedStudents.length < 2) return alert('참가 중인 학생을 2명 이상 선택해주세요.');
    currentDrawIsChampions = true;
    window.stopMP3('anthem');
    window.stopMP3('waiting');

    document.getElementById('gagaDrawMainTitle').innerText = "👑 왕중왕전 👑";
    document.getElementById('gagaDrawMainTitle').className = "text-5xl sm:text-7xl font-black text-purple-600 mb-4 font-jua drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] shrink-0 text-center";
    
    const n = selectedStudents.length;
    clearWantedReveal();
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
    
    individualMissionResult = null;
    window.renderIndividualMissionResult();
    window.selectedParticipants = [];
    window.renderGagaball();
}

// -----------------------------------------------------------
// 개인전·왕중왕전 결과창의 룰렛 버튼
// -----------------------------------------------------------
window.currentFloatingContext = 'individual';
window.currentTeamRouletteBtnId = null;

window.showFloatingRouletteBtn = function(context) {
    window.currentFloatingContext = context;
    const btn = document.getElementById('floating-roulette-btn');
    if (!btn) return;
    btn.style.display = 'flex';
};

window.hideFloatingRouletteBtn = function() {
    const btn = document.getElementById('floating-roulette-btn');
    if (btn) btn.style.display = 'none';
};

window.startRouletteFromFloating = function(e) {
    if(e) e.preventDefault();
    const opened = window.openRouletteModal(window.currentFloatingContext === 'team' ? 'team' : 'individual');
    if (opened) window.hideFloatingRouletteBtn();
};

// 룰렛 설정
let defaultIndividualMissions = [ { text: "그냥 가가볼", weight: 70, color: "#81ecec", desc: "평소처럼 가가볼을 즐기세요." }, { text: "체육쌤 레이드", weight: 10, color: "#ff7675", desc: "체육쌤이 경기장에 등장했습니다! 체육쌤을 아웃시키면 체육 도장 1장이 주어집니다!" }, { text: "포인트 X2", weight: 20, color: "#ffeaa7", desc: "최종 승자에게는 평소보다 2배의 포인트가 주어집니다." } ];
let defaultTeamMissions = [ { text: "그냥 가가볼", weight: 70, color: "#81ecec", desc: "평소처럼 가가볼을 즐기세요." }, { text: "왕을 잡아라!", weight: 15, color: "#a29bfe", desc: "양팀은 우리팀 왕을 한명 정해주세요. 상대팀 왕을 먼저 아웃시키는 팀이 승리합니다." }, { text: "포인트 X2", weight: 15, color: "#ffeaa7", desc: "최종 승리팀 전원에게 평소보다 2배의 포인트가 주어집니다." } ];

function readStoredMissions(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return validateMissions(value || []).valid ? value : fallback; } catch { return fallback; }
}
let individualMissions = readStoredMissions('gagaIndividualMissions', defaultIndividualMissions);
let teamMissions = readStoredMissions('gagaTeamMissions', defaultTeamMissions);
let currentMissions = individualMissions; 
let currentMissionsType = 'individual';
let editMissionsTemp = [];
let editingMissionsType = 'individual', rouletteEditRequested = false;

let currentRouletteRotation = 0; let isSpinning = false;
let rouletteStartTimer = null;
let rouletteAutoCloseTimer = null;
let pendingWantedReveal = false;

window.openSmartRouletteModal = function() {
    const teamView = document.getElementById('gaga-view-team');
    if (teamView && !teamView.classList.contains('hidden')) {
        window.openRouletteModal('team');
    } else {
        window.openRouletteModal('individual');
    }
}

window.openRouletteModal = function(type, teamMatchupId = null) {
    if (isSpinning || rouletteAutoCloseTimer) return false;
    clearTimeout(rouletteStartTimer);
    clearTimeout(rouletteAutoCloseTimer);
    rouletteAutoCloseTimer = null;
    pendingWantedReveal = false;
    const missions = type === 'team' ? teamMissions : individualMissions;
    const validation = validateMissions(missions);
    if (!validation.valid) { alert(validation.message); return false; }
    currentMissionsType = type;
    window.currentTeamRouletteBtnId = type === 'team' ? teamMatchupId : null;
    currentMissions = validation.missions;
    document.getElementById('rouletteModalTitle').innerText = type === 'team' ? "🎡 팀전 미션 룰렛" : "🎡 개인전 미션 룰렛";
    const summary = document.getElementById('roulette-result-summary');
    summary.textContent = '룰렛이 자동으로 돌아갑니다…';
    summary.classList.remove('roulette-winning');
    document.getElementById('rouletteModal').style.display = 'flex';
    syncBackgroundMusic();
    rouletteStartTimer = setTimeout(() => {
        rouletteStartTimer = null;
        if (document.getElementById('rouletteModal').style.display !== 'flex') return;
        window.drawRoulette();
        window.spinRoulette();
    }, 100);
    return true;
}
window.closeRouletteModal = function(force = false) {
    if (isSpinning || (rouletteAutoCloseTimer && !force)) return;
    const shouldRevealWanted = pendingWantedReveal;
    pendingWantedReveal = false;
    clearTimeout(rouletteStartTimer);
    rouletteStartTimer = null;
    clearTimeout(rouletteAutoCloseTimer);
    rouletteAutoCloseTimer = null;
    document.getElementById('rouletteModal').style.display = 'none';
    document.getElementById('roulette-result-summary').classList.remove('roulette-winning');
    if (document.getElementById('gagaDrawModal').style.display === 'flex') {
        window.showFloatingRouletteBtn('individual');
    }
    if (shouldRevealWanted) revealWantedStudent();
    syncBackgroundMusic();
    persistMatch();
};
window.openRouletteEditModal = function() {
    if (isSpinning) { rouletteEditRequested = true; document.getElementById('roulette-result-summary').textContent = '추첨이 끝나면 편집창이 열립니다.'; return; }
    window.closeRouletteModal(true);
    editingMissionsType = currentMissionsType;
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
                    <input type="color" value="${escapeHTML(m.color || colors[i%colors.length])}" id="r-edit-color-${i}" class="w-8 h-8 rounded cursor-pointer" onchange="window.updateRouletteItem(${i})">
                    <input type="text" value="${escapeHTML(m.text)}" id="r-edit-text-${i}" placeholder="미션명" class="flex-1 p-2 border rounded font-bold" onchange="window.updateRouletteItem(${i})">
                    <input type="number" value="${m.weight}" id="r-edit-weight-${i}" placeholder="확률" class="w-12 sm:w-16 p-2 border rounded" onchange="window.updateRouletteItem(${i})">
                </div>
                <textarea id="r-edit-desc-${i}" placeholder="설명" class="w-full p-2 border rounded text-sm" onchange="window.updateRouletteItem(${i})">${escapeHTML(m.desc)}</textarea>
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
    editMissionsTemp.forEach((_, index) => window.updateRouletteItem(index));
    const validation = validateMissions(editMissionsTemp);
    if (!validation.valid) return alert(validation.message);
    editMissionsTemp = validation.missions;

    if (editingMissionsType === 'team') {
        teamMissions = editMissionsTemp; 
        currentMissions = teamMissions; 
    } else { 
        individualMissions = editMissionsTemp; 
        currentMissions = individualMissions; 
    }
    
    // 💡 localStorage 대신 파이어베이스 동기화 함수를 호출합니다!
    saveData(); 
    
    window.closeRouletteEditModal(); 
    window.drawRoulette();
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
    const validation = validateMissions(currentMissions);
    if (!validation.valid) return alert(validation.message);
    currentMissions = validation.missions;
    if(isSpinning) return; isSpinning = true;
    const spinMissions = currentMissions.map(mission => ({ ...mission }));
    const spinType = currentMissionsType;
    const spinMatchupId = window.currentTeamRouletteBtnId;
    window.playMP3('spinner');
    const canvas = document.getElementById("rouletteCanvas");
    const spinAngle = Math.floor(Math.random() * 360) + (360 * 5); currentRouletteRotation += spinAngle;
    canvas.style.transition = "transform 5s cubic-bezier(0.25, 0.1, 0.25, 1)"; 
    canvas.style.transform = `rotate(${currentRouletteRotation}deg)`;
    persistMatch();

    setTimeout(() => {
        isSpinning = false;
        window.stopMP3('spinner');
        window.playMP3('goodresult');
        
        const normalizedRotation = currentRouletteRotation % 360; let pointerAngle = (360 - normalizedRotation) % 360;
        let currentPos = 0; let winner = null;
        let totalWeight = spinMissions.reduce((acc, m) => acc + m.weight, 0) || 1;
        for(let i=0; i<spinMissions.length; i++) {
            let sliceSize = (spinMissions[i].weight / totalWeight) * 360;
            if(pointerAngle >= currentPos && pointerAngle < currentPos + sliceSize) { winner = spinMissions[i]; break; }
            currentPos += sliceSize;
        }
        if (!winner) winner = spinMissions.at(-1);
        const result = { text: winner.text, desc: winner.desc };
        const summary = document.getElementById('roulette-result-summary');
        summary.innerHTML = missionMarkup(result);
        if (spinType === 'team') {
            teamMissionResults[spinMatchupId || 'global'] = result;
            window.renderGagaTeamView();
            window.currentTeamRouletteBtnId = null;
        } else {
            individualMissionResult = result;
            window.renderIndividualMissionResult();
            pendingWantedReveal = isWantedMission(result);
        }
        summary.classList.add('roulette-winning');
        rouletteAutoCloseTimer = setTimeout(() => window.closeRouletteModal(true), 3000);
        summary.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
        if (rouletteEditRequested) { rouletteEditRequested = false; window.openRouletteEditModal(); }
        persistMatch();
    }, 5000);
}
function missionMarkup(result) {
    return `<strong>🎯 ${escapeHTML(result.text)}</strong>${result.desc ? `<span>${escapeHTML(result.desc)}</span>` : ''}`;
}

window.renderIndividualMissionResult = function() {
    const banner = document.getElementById('gaga-draw-mission-result');
    banner.classList.toggle('hidden', !individualMissionResult);
    banner.innerHTML = individualMissionResult ? missionMarkup(individualMissionResult) : '';
};
function showEventReveal(mode) {
    const overlay = document.getElementById('event-loading-overlay');
    overlay.dataset.mode = mode;
    document.getElementById('event-loading-icon').textContent = mode === 'team' ? '⚔' : '✦';
    document.getElementById('event-loading-text').textContent = mode === 'team' ? '팀을 편성하고 있습니다' : '선수를 뽑고 있습니다';
    document.getElementById('event-loading-subtitle').textContent = mode === 'team' ? '균형 잡힌 대결이 곧 시작됩니다' : '오늘의 경기 주인공이 곧 공개됩니다';
    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
    syncBackgroundMusic();
    window.playMP3('spinner');
}

function finishEventReveal() {
    const overlay = document.getElementById('event-loading-overlay');
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    window.stopMP3('spinner');
    window.playMP3('fanfare');
}

window.triggerGagaDraw = function(targetGender) {
    if(!currentClass) return;
    const drawCount = parseInt(document.getElementById('gaga-draw-count').value, 10);
    const refereeLimit = getIndividualRefereeLimit(classData[currentClass]);
    let available = classData[currentClass].filter(s => s.attendance && !s.gagaDrawn
        && (targetGender === 'all' || s.gender === targetGender)
        && (!s.isReferee || refereeLimit > 0));
    if(available.length === 0) return alert("현재 대기 중인 학생이 없습니다.");

    showEventReveal('draw');

    setTimeout(() => {
        finishEventReveal();
        window.executeGagaDraw(targetGender, drawCount, available, refereeLimit);
    }, 2400);
}

window.executeGagaDraw = function(targetGender, drawCount, available, refereeLimit) {
    // The reveal animation can outlive a cloud update; use the current roster objects.
    available = available.map(s => classData[currentClass].find(student => student.no === s.no))
        .filter(s => s && s.attendance && !s.gagaDrawn && (targetGender === 'all' || s.gender === targetGender));
    refereeLimit = getIndividualRefereeLimit(classData[currentClass]);
    window.closeGagaTimer(false);
    currentDrawIsChampions = false;
    const actualDrawCount = Math.min(drawCount, available.length);
    for (let i = available.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [available[i], available[j]] = [available[j], available[i]]; }
    let picked = available.slice(0, actualDrawCount);
    
    picked = limitSelectedReferees(picked, available.slice(actualDrawCount), refereeLimit);

    picked.forEach(s => s.gagaDrawn = true);
    
    document.getElementById('gagaDrawMainTitle').innerText = "🎉 참가 선수 🎉";
    document.getElementById('gagaDrawMainTitle').className = "text-5xl sm:text-7xl font-black text-white mb-4 font-jua drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] shrink-0 text-center";

    const n = picked.length;
    clearWantedReveal();
    let gridClasses = "grid gap-2 sm:gap-4 w-full flex-1 h-full min-h-0 overflow-hidden px-2 pb-2 ";
    if (n <= 2) gridClasses += "grid-cols-2 grid-rows-1";
    else if (n <= 4) gridClasses += "grid-cols-2 grid-rows-2";
    else if (n <= 6) gridClasses += "grid-cols-3 grid-rows-2";
    else if (n <= 8) gridClasses += "grid-cols-4 grid-rows-2";
    else gridClasses += "grid-cols-5 grid-rows-2";
    
    document.getElementById('gagaDrawResultGrid').className = gridClasses;
    document.getElementById('gagaDrawResultGrid').innerHTML = generateGridCards(picked); 
    individualMissionResult = null;
    window.renderIndividualMissionResult();

    saveData(); window.renderGagaball();
    document.getElementById('gagaDrawModal').style.display = 'flex';
    
    window.showFloatingRouletteBtn('individual');
    syncBackgroundMusic();
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
    clearWantedReveal();
    document.getElementById('gagaDrawModal').style.display = 'none';
    currentDrawIsChampions = false;
    window.hideFloatingRouletteBtn();
    syncBackgroundMusic();
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
let currentGagaStandbyReferees = [];
let currentGagaRefereeWarning = false;
window.triggerGagaTeams = function() {
    if(!currentClass) return;
    const numTeams = parseInt(document.getElementById('gaga-team-count').value, 10);
    let available = classData[currentClass].filter(s => s.attendance);
    const refereePlan = getTeamRefereePlan(available, numTeams);
    if(refereePlan.participants.length < numTeams) return alert("심판 대기 학생을 제외하면 팀마다 한 명씩 배정할 수 없습니다. 참가 학생을 늘리거나 팀 수를 줄여주세요.");

    showEventReveal('team');

    setTimeout(() => {
        finishEventReveal();
        window.executeGagaTeams(numTeams, available);
    }, 2400);
}

window.executeGagaTeams = function(numTeams, available) {
    const refereePlan = getTeamRefereePlan(available, numTeams);
    if(refereePlan.participants.length < numTeams) return alert("심판 대기 학생을 제외하면 팀마다 한 명씩 배정할 수 없습니다.");
    window.closeGagaTimer(false);
    window.closeGagaDrawModal();
    const participants = refereePlan.participants;
    const totalParticipants = participants.length; const baseSize = Math.floor(totalParticipants / numTeams); const remainder = totalParticipants % numTeams;
    let targetSizes = new Array(numTeams).fill(baseSize); for(let i = 0; i < remainder; i++) targetSizes[i]++;

    const teams = Array.from({length: numTeams}, (_, i) => ({ id: i + 1, members: [], score: 0, targetSize: targetSizes[i] }));
    let validRecords = participants.filter(s => s.recordMs > 0).map(s => s.recordMs).sort((a,b) => a - b);
    const sortByPower = (a, b) => {
        let pA = getStudentPower(a, validRecords) + (a.score||0)*150;
        let pB = getStudentPower(b, validRecords) + (b.score||0)*150;
        return pB - pA;
    };

    let referees = participants.filter(s => s.isReferee).sort(sortByPower);
    let nonReferees = participants.filter(s => !s.isReferee);
    
    let boys = nonReferees.filter(s => s.gender === '남').sort(sortByPower); 
    let girls = nonReferees.filter(s => s.gender === '여').sort(sortByPower);
    let unspecified = nonReferees.filter(s => !['남', '여'].includes(s.gender)).sort(sortByPower);

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
        const validTeams = getRefereeEligibleTeams(teams);
        
        let minMembers = Math.min(...validTeams.map(t => t.members.length));
        let candidates = validTeams.filter(t => t.members.length === minMembers);
        candidates.sort(() => Math.random() - 0.5); candidates.sort((a, b) => a.score - b.score);
        candidates[0].members.push(ref); candidates[0].score += (ref.score || 0);
    });

    distribute(boys); 
    distribute(girls);
    distribute(unspecified);

    teams.forEach(t => { t.members = t.members.map(m => ({ ...m, isKing: false })); t.score = 0; });

    currentGagaTeams = teams;
    currentGagaStandbyReferees = refereePlan.standbyReferees;
    currentGagaRefereeWarning = refereePlan.warnAllRefereesPlaying;
    teamMissionResults = {};
    window.renderGagaTeamView(); 
    syncBackgroundMusic();
    window.fireConfetti();
}

window.toggleTeamKing = function(teamId, memberNo) {
    const team = currentGagaTeams.find(t => t.id === teamId);
    if(!team) return;
    const isKing = toggleTeamKingSelection(team.members, memberNo);
    if(isKing === null) return;

    if(isKing) {
        window.playCoinSound(); 
        window.fireConfetti();
    } else {
        window.playBumpSound(); 
    }
    
    window.renderGagaTeamView();
}

window.renderGagaTeamView = function() {
    const container = document.getElementById('gaga-team-matchups'); let teamHTML = '';
    const refereeStatus = document.getElementById('team-referee-status');
    refereeStatus.classList.toggle('hidden', !currentGagaRefereeWarning && currentGagaStandbyReferees.length === 0);
    refereeStatus.classList.toggle('team-referee-warning', currentGagaRefereeWarning);
    refereeStatus.classList.toggle('team-referee-standby', !currentGagaRefereeWarning);
    refereeStatus.innerHTML = currentGagaRefereeWarning
        ? '⚠️ 2팀전 예외: 모든 심판이 출전하여 경기 밖에 남는 심판이 없습니다.'
        : currentGagaStandbyReferees.length
            ? `⚖️ 경기 심판 대기: ${currentGagaStandbyReferees.map(student => escapeHTML(student.name)).join(', ')} — 이번 팀 편성에서는 출전하지 않습니다.`
            : '';
    const now = Date.now();
    const showAnim = (window.lastTeamScoreChange && (now - window.lastTeamScoreChange.time < 100));

    for(let i = 0; i < currentGagaTeams.length; i += 2) {
        const teamA = currentGagaTeams[i]; const teamB = currentGagaTeams[i+1];
        const matchupId = `team-roulette-${i}`;
        const matchupMission = teamMissionResults[matchupId];
        
        const createBadges = (team) => team.members.map((m) => {
            let animHTML = '';
            if (showAnim && team.id === window.lastTeamScoreChange.teamId) {
                const val = window.lastTeamScoreChange.val;
                const sign = val > 0 ? '+' : '';
                const colorClass = val > 0 ? 'float-score-plus' : 'float-score-minus';
                animHTML = `<span class="float-score-anim ${colorClass}">${sign}${val}</span>`;
            }

            const isKing = m.isKing;
            const kingCrown = isKing ? `
                <div class="team-king-effect" aria-hidden="true">
                    <span class="king-crown">👑</span>
                    <span class="king-sparkle king-sparkle-left">✨</span>
                    <span class="king-sparkle king-sparkle-right">✨</span>
                    <span class="king-label">왕</span>
                </div>` : '';

            return `
            <div class="team-player-card ${isKing ? 'team-king-active' : ''} relative flex flex-col items-center justify-center p-2 sm:p-4 rounded-2xl sm:rounded-3xl border-2 sm:border-[4px] shadow-sm w-full h-full min-h-[140px] sm:min-h-[220px] lg:min-h-[260px] cursor-pointer transition-transform hover:scale-[1.02] ${isKing ? 'border-yellow-400 ring-4 ring-yellow-300 bg-yellow-50' : 'bg-white'}" style="${!isKing ? `border-color:${m.gender==='남'?'#3498db':'#e74c3c'}` : ''}" onclick="window.toggleTeamKing(${team.id}, ${m.no})">
                
                <div class="${isKing ? 'team-king-avatar' : ''} relative w-16 h-16 sm:w-24 sm:h-24 lg:w-32 lg:h-32 xl:w-36 xl:h-36 mb-1 sm:mb-3 shrink-0">
                    ${kingCrown}
                    <img src="${escapeHTML(window.generateCuteAvatar(m))}" alt="${escapeHTML(m.name)} 아바타" class="w-full h-full rounded-full bg-gray-50 object-cover border-2 sm:border-[4px] border-slate-100 shadow-sm" onclick="event.stopPropagation(); window.openAvatarSelectModal(${m.no})" onerror="this.onerror=null; this.src='${fallbackSVG}';" title="아바타 변경">
                </div>
                <b class="team-player-name font-black text-slate-800 w-full min-w-0 text-center leading-tight mb-1 sm:mb-2 tracking-tight">${escapeHTML(m.name)}</b>
                <span class="text-sm sm:text-xl lg:text-2xl text-red-500 font-black relative whitespace-nowrap mt-auto">${m.score || 0}${animHTML}</span>
            </div>`;
        }).join('');
        
        const createPanel = (team, isEven) => `
            <div class="w-full sm:w-28 lg:w-32 border-b-2 sm:border-b-0 sm:border-r-4 border-dashed ${isEven ? 'border-slate-400/50' : 'border-slate-300'} pb-2 mb-2 sm:pb-0 sm:mb-0 sm:pr-4 sm:mr-4 flex flex-row sm:flex-col justify-between items-center shrink-0">
                <div class="flex flex-col items-center">
                    <div class="text-2xl sm:text-4xl font-black text-slate-800 whitespace-nowrap">${team.id}팀</div>
                    ${isEven ? `<div class="text-xs sm:text-base font-bold text-slate-600 mt-1">(형광)</div>` : ''}
                </div>
                <div class="flex gap-2 sm:gap-3 mt-0 sm:mt-auto">
                    <button class="premium-score-btn minus" onclick="window.addGagaTeamScore(${team.id}, -1)" aria-label="${team.id}팀 점수 1점 빼기">−</button>
                    <button class="premium-score-btn plus" onclick="window.addGagaTeamScore(${team.id}, 1)" aria-label="${team.id}팀 점수 1점 더하기">+</button>
                </div>
            </div>`;

        let teamBgA = "bg-orange-50 border-orange-400";
        let teamBgB = "bg-[#f3ff4c] border-[#d1e600]";

        teamHTML += `
            <div class="flex flex-col xl:flex-row gap-2 sm:gap-4 bg-white p-3 sm:p-5 rounded-2xl border-2 sm:border-4 border-slate-100 shadow-md items-stretch mb-4 overflow-visible">
                <div class="flex-1 flex flex-col sm:flex-row p-3 sm:p-4 rounded-xl sm:rounded-2xl ${teamBgA} border-t-8 xl:border-t-0 xl:border-l-8">
                    ${createPanel(teamA, false)} 
                    <div class="team-members-grid flex-1 gap-2 sm:gap-3 py-2 px-2 overflow-visible items-stretch">${createBadges(teamA)}</div>
                </div>
                ${teamB ? `
                <div class="relative flex flex-col items-center justify-center my-2 xl:my-0 z-10 w-full ${matchupMission ? 'xl:w-48' : 'xl:w-20'} shrink-0 gap-1 sm:gap-2">
                    ${matchupMission ? `<div class="match-mission-result matchup-mission-result">${missionMarkup(matchupMission)}</div>` : `<button id="${matchupId}" type="button" class="matchup-roulette-button" onclick="window.openRouletteModal('team', '${matchupId}')" title="팀전 미션 룰렛" aria-label="${teamA.id}팀과 ${teamB.id}팀 미션 룰렛 열기"><img src="images/gaga-roulette-icon.png" alt="" aria-hidden="true"></button>`}
                    <div class="text-xl sm:text-3xl lg:text-4xl flex items-center justify-center font-black text-slate-400 drop-shadow-sm">VS</div>
                </div>
                <div class="flex-1 flex flex-col sm:flex-row p-3 sm:p-4 rounded-xl sm:rounded-2xl ${teamBgB} border-t-8 xl:border-t-0 xl:border-r-8">
                    ${createPanel(teamB, true)} 
                    <div class="team-members-grid flex-1 gap-2 sm:gap-3 py-2 px-2 overflow-visible items-stretch">${createBadges(teamB)}</div>
                </div>` : ''}
            </div>`;
    }
    container.innerHTML = teamHTML;
    const globalMission = document.getElementById('team-global-mission-result');
    globalMission.classList.toggle('hidden', !teamMissionResults.global);
    globalMission.innerHTML = teamMissionResults.global ? missionMarkup(teamMissionResults.global) : '';
}

window.addGagaTeamScore = function(teamId, val) {
    if (val > 0) window.playCoinSound(); else window.playBumpSound();
    const team = currentGagaTeams.find(t => t.id === teamId);
    if (!team) return;
    val = Math.max(0, team.score + val) - team.score;
    if (!val) return;
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

let activeTimerAudio = null;
let activeTimerDuration = 0;
let timerAnimationFrame = null;
let lastTimerNumber = '';
let timerModel = null;
const timerAudioCache = new Map();
function prepareTimerAudio() {
    if (window.gagaRemoteMuted) return;
    for (const duration of [60, 100]) {
        const path = `sound/countdown-${currentDrawIsChampions ? 'champions-' : ''}${duration}s.mp3`;
        if (!timerAudioCache.has(path)) { const audio = new Audio(path); audio.preload = 'auto'; timerAudioCache.set(path, audio); }
    }
}
const finalTimerWords = ['TIME UP!', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'];

function getTimerSeekMax() {
    return activeTimerDuration + 3;
}

function formatTimerPosition(seconds) {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    const minutes = Math.floor(safeSeconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function renderTimerScreen() {
    if (!timerModel) return;
    const elapsed = timerPosition(timerModel);
    if (activeTimerAudio && timerModel.running && !activeTimerAudio.paused && Math.abs(activeTimerAudio.currentTime - elapsed) > .4) {
        activeTimerAudio.currentTime = elapsed;
    }
    const state = getCountdownState(elapsed, activeTimerDuration);
    const screen = document.getElementById('timerScreen');
    const number = document.getElementById('timer-main-number');
    const phase = document.getElementById('timer-phase-label');
    const word = document.getElementById('timer-word-label');
    const showGo = elapsed >= 3 && elapsed < 3.7;
    const display = showGo ? 'GO!' : state.phase === 'done' ? '0' : String(state.number);
    const displayKey = state.phase === 'intro' ? `lights-${state.startStage}` : display;

    screen.dataset.phase = state.phase;
    phase.textContent = state.phase === 'intro' ? '시작 준비' : state.phase === 'done' ? '경기 종료!' : state.phase === 'final' ? '마지막 10초!' : '경기 중';
    word.textContent = state.phase === 'intro' ? (state.startStage === 4 ? 'GO!' : 'START LIGHTS')
        : showGo ? '가가볼 시작!' : state.phase === 'final' ? finalTimerWords[state.number]
        : state.phase === 'done' ? 'TIME UP!' : 'GAGA BALL';
    if (displayKey !== lastTimerNumber) {
        if (state.phase === 'intro') {
            number.classList.add('timer-race-lights');
            number.innerHTML = Array.from({ length: 4 }, (_, index) =>
                `<span class="timer-race-light ${index < state.startStage ? 'active' : ''} ${index === 3 && state.startStage === 4 ? 'go' : ''}">●</span>`
            ).join('');
        } else {
            number.classList.remove('timer-race-lights');
            number.textContent = display;
        }
        number.classList.remove('timer-beat');
        void number.offsetWidth;
        number.classList.add('timer-beat');
        lastTimerNumber = displayKey;
    }
    const seek = document.getElementById('timer-seek-input');
    const seekMax = getTimerSeekMax();
    const seekValue = Math.min(elapsed, seekMax);
    seek.max = String(seekMax);
    seek.value = String(seekValue);
    seek.style.setProperty('--timer-seek-progress', `${seekMax ? seekValue / seekMax * 100 : 0}%`);
    seek.setAttribute('aria-valuetext', `${formatTimerPosition(seekValue)} / ${formatTimerPosition(seekMax)}`);
    document.getElementById('timer-seek-current').textContent = formatTimerPosition(seekValue);
    document.getElementById('timer-seek-total').textContent = formatTimerPosition(seekMax);
    if (elapsed >= activeTimerDuration + 3) {
        const wasRunning = timerModel.running;
        timerModel.position = activeTimerDuration + 3; timerModel.running = false;
        document.getElementById('timer-pause-button').textContent = '경기 종료';
        if (wasRunning) persistMatch();
    }
    else timerAnimationFrame = requestAnimationFrame(renderTimerScreen);
}

window.seekGagaTimer = function(value) {
    if (!timerModel) return;
    const requestedTime = Number(value);
    if (!Number.isFinite(requestedTime)) return;
    timerModel.position = Math.min(Math.max(requestedTime, 0), activeTimerDuration + 3);
    timerModel.startedAt = Date.now();
    if (activeTimerAudio) activeTimerAudio.currentTime = timerModel.position;
    lastTimerNumber = '';
    if (timerAnimationFrame) cancelAnimationFrame(timerAnimationFrame);
    renderTimerScreen();
};

window.openGagaTimer = function(duration, { autoplay = true } = {}) {
    if (duration !== 60 && duration !== 100) return;
    window.closeTimerSelectModal();
    window.closeGagaTimer(false);
    window.stopMP3('anthem');
    window.stopMP3('waiting');
    activeTimerDuration = duration;
    timerModel = { id: crypto.randomUUID(), duration, position: 0, startedAt: Date.now(), running: autoplay, champions: currentDrawIsChampions };
    const path = `sound/countdown-${currentDrawIsChampions ? 'champions-' : ''}${duration}s.mp3`;
    activeTimerAudio = window.gagaRemoteMuted ? new Audio() : timerAudioCache.get(path) || new Audio(path);
    activeTimerAudio.currentTime = 0;
    activeTimerAudio.preload = 'auto';
    activeTimerAudio.muted = window.isGlobalMuted || window.gagaRemoteMuted;
    activeTimerAudio.volume = window.globalVolume;
    activeTimerAudio.onended = () => {};
    activeTimerAudio.onloadedmetadata = () => {
        if (timerAnimationFrame) cancelAnimationFrame(timerAnimationFrame);
        renderTimerScreen();
    };
    lastTimerNumber = '';
    document.getElementById('timer-duration-label').textContent = `${duration}초 경기`;
    document.getElementById('timer-audio-status').textContent = window.gagaRemoteMuted ? 'TV에서 소리 재생' : '';
    document.getElementById('timer-pause-button').textContent = '⏸️ 일시정지';
    document.getElementById('timerScreen').style.display = 'block';
    renderTimerScreen();
    if (autoplay && !window.gagaRemoteMuted) activeTimerAudio.play().catch(error => {
        console.error('타이머 음원 재생 실패:', error);
        document.getElementById('timer-audio-status').textContent = '소리 재생 불가 · 무음 타이머로 진행 중';
    });
};

window.toggleGagaTimerPause = function() {
    if (!timerModel || timerPosition(timerModel) >= timerModel.duration + 3) return;
    const button = document.getElementById('timer-pause-button');
    timerModel.position = timerPosition(timerModel); timerModel.startedAt = Date.now(); timerModel.running = !timerModel.running;
    button.textContent = timerModel.running ? '⏸️ 일시정지' : '▶️ 계속';
    if (timerModel.running && !window.gagaRemoteMuted) activeTimerAudio?.play().catch(() => { document.getElementById('timer-audio-status').textContent = '무음 타이머로 진행 중'; });
    else activeTimerAudio?.pause();
};

window.restartGagaTimer = function() {
    if (!activeTimerAudio) return;
    timerModel = { ...timerModel, id: crypto.randomUUID(), position: 0, startedAt: Date.now(), running: true };
    activeTimerAudio.pause();
    activeTimerAudio.currentTime = 0;
    lastTimerNumber = '';
    document.getElementById('timer-pause-button').textContent = '⏸️ 일시정지';
    if (timerAnimationFrame) cancelAnimationFrame(timerAnimationFrame);
    renderTimerScreen();
    if (!window.gagaRemoteMuted) activeTimerAudio.play().catch(error => console.error('타이머 재시작 실패:', error));
};

window.toggleGagaTimerFullscreen = function() {
    const screen = document.getElementById('timerScreen');
    if (document.fullscreenElement === screen) document.exitFullscreen();
    else if (screen.requestFullscreen) screen.requestFullscreen().catch(error => console.error('전체 화면 전환 실패:', error));
};

window.closeGagaTimer = function(resumeMusic = true) {
    timerModel = null;
    if (timerAnimationFrame) cancelAnimationFrame(timerAnimationFrame);
    timerAnimationFrame = null;
    if (activeTimerAudio) {
        activeTimerAudio.pause();
        activeTimerAudio.onended = null;
        activeTimerAudio.onloadedmetadata = null;
        activeTimerAudio.currentTime = 0;
        activeTimerAudio = null;
    }
    const screen = document.getElementById('timerScreen');
    if (screen) screen.style.display = 'none';
    if (document.fullscreenElement === screen) document.exitFullscreen().catch(() => {});
    if (resumeMusic) syncBackgroundMusic();
};

// ==========================================
// 6. 도장판 모드
// ==========================================
window.renderStampBoard = () => {
    if (window.gagaCompact) return;
    const board = document.getElementById('stampBoard'); if (!board) return;
    const titleEl = document.getElementById('stamp-class-title');

    if (!currentClass) { titleEl.innerText = "학급을 선택해주세요"; board.innerHTML = ""; return; }
    titleEl.innerText = `${currentClass} 도장판`;
    if (!classStamps[currentClass]) classStamps[currentClass] = Array(TOTAL_STAMP_CELLS).fill(false);

    board.innerHTML = ''; let stampedCount = 0;
    classStamps[currentClass].forEach((isStamped, i) => {
        if (isStamped) stampedCount++;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `stamp-cell w-full aspect-square border-2 border-dashed border-gray-300 rounded-full flex items-center justify-center bg-white hover:bg-green-50 ${isStamped ? 'stamped' : ''}`;
        cell.setAttribute('aria-label', `${i + 1}번째 도장 ${isStamped ? '취소' : '찍기'}`);
        cell.setAttribute('aria-pressed', String(isStamped));
        cell.innerHTML = `<span class="cell-number font-bold font-sans">${i + 1}</span><img src="${escapeHTML(globalStampImage)}" class="stamp-img" alt="">`;
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
    cellElement.setAttribute('aria-label', `${index + 1}번째 도장 ${isStamped ? '취소' : '찍기'}`);
    cellElement.setAttribute('aria-pressed', String(isStamped));
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
    if (window.isGlobalMuted) return;
    const ctx = initAudio(); const now = ctx.currentTime;
    const fallOsc = ctx.createOscillator(); const fallGain = ctx.createGain();
    fallOsc.type = 'sine'; fallOsc.frequency.setValueAtTime(900, now); fallOsc.frequency.exponentialRampToValueAtTime(100, now + 0.35);
    fallGain.gain.setValueAtTime(0, now); fallGain.gain.linearRampToValueAtTime(0.4, now + 0.15); fallGain.gain.linearRampToValueAtTime(0, now + 0.35);
    fallOsc.connect(fallGain); fallGain.connect(masterGain); fallOsc.start(now); fallOsc.stop(now + 0.35);

    const boomOsc = ctx.createOscillator(); const boomGain = ctx.createGain();
    boomOsc.type = 'square'; boomOsc.frequency.setValueAtTime(150, now + 0.35); boomOsc.frequency.exponentialRampToValueAtTime(20, now + 0.7);
    boomGain.gain.setValueAtTime(0, now + 0.34); boomGain.gain.setValueAtTime(1.5, now + 0.35); boomGain.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
    boomOsc.connect(boomGain); boomGain.connect(masterGain); boomOsc.start(now + 0.35); boomOsc.stop(now + 0.7);
};

const playTone = (freq, type, duration, gainVal) => {
    if (window.isGlobalMuted) return;
    const ctx = initAudio();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(masterGain); osc.start(); osc.stop(ctx.currentTime + duration);
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
    window.renderAvatarGrid();
};
window.closeAvatarSelectModal = function() { document.getElementById('avatarSelectModal').style.display = 'none'; currentAvatarStudentNo = null; };
window.renderAvatarGrid = function() {
    const students = classData[currentClass] || [];
    const student = students.find(item => item.no == currentAvatarStudentNo);
    if (!student) return;
    const paths = avatarPaths(student.gender);
    const usedByOthers = new Set(students.filter(item => item !== student).map(item => item.customAvatar));
    const container = document.getElementById('avatar-grid-container'); let html = '';
    html += '<p class="col-span-full text-left text-sm font-bold text-slate-600">다른 학생이 사용 중인 아바타는 선택할 수 없습니다.</p>';
    html += `<button type="button" class="avatar-choice rounded-2xl border-4 border-slate-200 hover:border-blue-500 bg-slate-50 shadow-sm flex flex-col items-center justify-center" onclick="window.rerollAvatar()" aria-label="아바타 무작위로 다시 선택"><span class="text-3xl">🔄</span><span class="text-xs font-bold">무작위 선택</span></button>`;
    paths.forEach((path, index) => {
        const inUse = usedByOthers.has(path);
        const selected = student.customAvatar === path;
        html += `<button type="button" class="avatar-choice rounded-2xl border-4 ${selected ? 'border-blue-500' : 'border-transparent'} ${inUse ? 'opacity-40 cursor-not-allowed' : 'hover:border-blue-500 focus-visible:border-blue-500'} bg-slate-50 shadow-sm" ${inUse ? 'disabled' : `onclick="window.selectAvatar('${path}')"`} aria-label="${student.gender === '여' ? '여학생' : '남학생'} 아바타 ${index + 1}${inUse ? ' 사용 중' : selected ? ' 현재 선택됨' : ' 선택'}" ${selected ? 'aria-pressed="true"' : ''}><img src="${path}" alt="" loading="lazy" class="w-full h-full object-contain" onerror="this.parentElement.style.display='none'"></button>`;
    });
    container.innerHTML = html;
};
window.rerollAvatar = function() {
    const students = classData[currentClass] || [];
    const student = students.find(item => item.no == currentAvatarStudentNo);
    if (!student) return;
    const used = new Set(students.filter(item => item !== student).map(item => item.customAvatar));
    const available = avatarPaths(student.gender).filter(path => !used.has(path));
    const alternatives = available.filter(path => path !== student.customAvatar);
    const choices = alternatives.length ? alternatives : available;
    if (!choices.length) return alert('선택할 수 있는 아바타가 없습니다.');
    window.selectAvatar(choices[Math.floor(Math.random() * choices.length)]);
};
window.selectAvatar = function(path) {
    if(!currentAvatarStudentNo) return;
    const students = classData[currentClass] || [];
    const student = students.find(s => s.no == currentAvatarStudentNo);
    if (!student || !avatarPaths(student.gender).includes(path)) return;
    if (students.some(item => item !== student && item.customAvatar === path)) return alert('같은 학급에서 이미 사용 중인 아바타입니다.');
    student.customAvatar = path;
    saveData();
    window.renderGagaball();
    window.renderGagaRanking();
    if(currentGagaTeams && currentGagaTeams.length > 0) window.renderGagaTeamView();
    window.closeAvatarSelectModal();
};

// ==========================================
// 8. 학급 관리 기능
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
    const errors = [];
    const numbers = new Set();
    lines.forEach((line, index) => {
        const [number, name, gender] = line.trim().split(/\s+/);
        const no = Number(number);
        if (!Number.isInteger(no) || no < 1 || !name || !['남', '여'].includes(String(gender || '').replace(/학생$/, '')) || numbers.has(no)) errors.push(`${index + 1}행: 번호·이름·성별 또는 중복 번호를 확인해주세요.`);
        numbers.add(no);
    });
    if (errors.length) return alert(errors.join('\n'));
    if (!confirm(`${currentClass}에 ${lines.length}명을 등록/수정합니다. 같은 번호는 기존 점수를 유지합니다.\n\n${lines.slice(0, 8).join('\n')}${lines.length > 8 ? '\n…' : ''}`)) return;
    let addedCount = 0;
    let currentStudents = [...(classData[currentClass] || [])];

    lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
            const no = parseInt(parts[0]); const name = parts[1]; const gender = parts.length > 2 ? parts[2] : '-';
            if (!isNaN(no) && name) {
                const existingIdx = currentStudents.findIndex(s => s.no === no);
                const existingStudent = existingIdx > -1 ? currentStudents[existingIdx] : null;
                const newStudent = mergeStudent(existingStudent, { no, name, gender });
                if (existingIdx > -1) currentStudents[existingIdx] = newStudent;
                else currentStudents.push(newStudent);
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        if (['남', '여'].some(gender => currentStudents.filter(student => student.gender === gender).length > 50)) {
            return alert('한 학급에서 남학생과 여학생은 각각 최대 50명까지 등록할 수 있습니다. 아바타 중복을 방지하기 위해 명단을 저장하지 않았습니다.');
        }
        classData[currentClass] = currentStudents;
        saveData(); document.getElementById('excel-input').value = "";
        alert(`${addedCount}명의 학생이 등록/수정되었습니다.`);
        if (currentTab === 'gagaball') window.renderGagaball();
    }
}

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    const dialogs = [
        ['timerScreen', window.closeGagaTimer],
        ['rouletteEditModal', window.closeRouletteEditModal],
        ['rouletteModal', window.closeRouletteModal],
        ['avatarSelectModal', window.closeAvatarSelectModal],
        ['stampSelectModal', window.closeStampSelectModal],
        ['gagaDrawModal', window.closeGagaDrawModal],
        ['timerSelectModal', window.closeTimerSelectModal],
        ['addStudentModal', window.closeAddStudentModal]
    ];

    const activeDialog = dialogs.find(([id]) => {
        const element = document.getElementById(id);
        return element && getComputedStyle(element).display !== 'none';
    });

    if (activeDialog) {
        event.preventDefault();
        activeDialog[1]();
        return;
    }

    const manageModal = document.getElementById('manage-modal');
    if (manageModal && !manageModal.classList.contains('hidden')) {
        event.preventDefault();
        window.closeManageModal();
    }
});

// One adapter for the existing presentation and the image-free teacher console.
let applyingMatch = false;
let undoEntries = [];
let presentationEffect = null;
let remoteEffectTimer = null;
let lastRemoteEffect = '';
let remoteRouletteSpinning = false;
const matchKey = () => `gaga-match-v1:${userId}:${currentClass}`;
function captureMatch() {
    const cards = [...document.querySelectorAll('#gagaDrawResultGrid .draw-result-card')];
    const numbers = cards.map(card => Number(card.querySelector('[id^="modal-score-"]')?.id.replace('modal-score-', '')));
    return structuredClone({ className: currentClass, teams: currentGagaTeams, standby: currentGagaStandbyReferees,
        refereeWarning: currentGagaRefereeWarning, individualMission: individualMissionResult, teamMissions: teamMissionResults,
        champions: currentDrawIsChampions, players: numbers,
        wanted: numbers.filter((_, index) => cards[index].classList.contains('wanted-active')),
        drawOpen: document.getElementById('gagaDrawModal').style.display === 'flex',
        view: ['score', 'team', 'rank'].find(view => !document.getElementById(`gaga-view-${view}`).classList.contains('hidden')) || 'score',
        timer: timerModel, volume: window.globalVolume, muted: window.isGlobalMuted, effect: presentationEffect,
        roulette: { open: document.getElementById('rouletteModal').style.display === 'flex', spinning: isSpinning,
            rotation: currentRouletteRotation, type: currentMissionsType, missions: currentMissions,
            result: document.getElementById('roulette-result-summary').textContent } });
}
function persistMatch() {
    if (applyingMatch || !userId || !currentClass) return;
    try { localStorage.setItem(matchKey(), JSON.stringify(captureMatch())); } catch {}
    sessionStorage.setItem(`gaga-last-class:${userId}`, currentClass);
    window.dispatchEvent(new Event('gaga-match'));
}
function restoreMatch(state, pause = false) {
    if (!state || !classData[state.className]) return;
    applyingMatch = true;
    try {
        if (currentClass !== state.className) window.selectClass(state.className);
        currentGagaTeams = structuredClone(state.teams || []);
        currentGagaStandbyReferees = state.standby || [];
        currentGagaRefereeWarning = !!state.refereeWarning;
        individualMissionResult = state.individualMission || null; teamMissionResults = state.teamMissions || {};
        currentDrawIsChampions = !!state.champions;
        window.switchGagaTab(state.view || 'score');
        const picked = (state.players || []).map(no => classData[currentClass].find(s => s.no === no)).filter(Boolean);
        const grid = document.getElementById('gagaDrawResultGrid');
        grid.className = `grid gap-2 sm:gap-4 w-full flex-1 min-h-0 overflow-hidden px-2 pb-2 grid-cols-${picked.length <= 4 ? 2 : picked.length <= 6 ? 3 : picked.length <= 8 ? 4 : 5} ${picked.length <= 2 ? 'grid-rows-1' : 'grid-rows-2'}`;
        grid.innerHTML = generateGridCards(picked);
        [...grid.children].forEach((card, index) => {
            const wanted = state.wanted?.[0] === picked[index].no;
            card.classList.toggle('wanted-active', !!wanted); card.setAttribute('aria-pressed', String(!!wanted));
        });
        document.getElementById('gagaDrawMainTitle').textContent = state.champions ? '👑 왕중왕전 👑' : '🎉 참가 선수 🎉';
        document.getElementById('gagaDrawModal').style.display = state.drawOpen ? 'flex' : 'none';
        window.renderIndividualMissionResult();
        if (state.drawOpen) window.showFloatingRouletteBtn('individual');
        if (window.gagaReceivingMatch || window.gagaReadOnly) {
            const roulette = state.roulette;
            document.getElementById('rouletteModal').style.display = roulette?.open ? 'flex' : 'none';
            if (roulette?.open) {
                currentMissions = roulette.missions; currentMissionsType = roulette.type;
                document.getElementById('rouletteModalTitle').textContent = roulette.type === 'team' ? '🎡 팀전 미션 룰렛' : '🎡 개인전 미션 룰렛';
                window.drawRoulette();
                const canvas = document.getElementById('rouletteCanvas');
                canvas.style.transition = roulette.spinning ? 'transform 5s cubic-bezier(.25,.1,.25,1)' : 'none';
                canvas.style.transform = `rotate(${roulette.rotation}deg)`;
                document.getElementById('roulette-result-summary').textContent = roulette.result;
                document.getElementById('roulette-result-summary').classList.toggle('roulette-winning', !roulette.spinning);
                if (roulette.spinning) window.playMP3('spinner'); else window.stopMP3('spinner');
                if (remoteRouletteSpinning && !roulette.spinning) window.playMP3('goodresult');
            } else window.stopMP3('spinner');
            remoteRouletteSpinning = !!roulette?.spinning;
            if (state.effect && state.effect.id !== lastRemoteEffect && Date.now() - state.effect.at < 6000) {
                lastRemoteEffect = state.effect.id;
                showEventReveal(state.effect.kind); clearTimeout(remoteEffectTimer);
                remoteEffectTimer = setTimeout(() => { finishEventReveal(); window.fireConfetti(); syncBackgroundMusic(); }, 1200);
            }
        }
        if (state.timer) {
            const wantedTimer = structuredClone(state.timer);
            if (pause) { wantedTimer.position = timerPosition(wantedTimer); wantedTimer.running = false; }
            if (!timerModel || timerModel.id !== wantedTimer.id) window.openGagaTimer(wantedTimer.duration, { autoplay: false });
            timerModel = wantedTimer;
            activeTimerAudio.currentTime = timerPosition(timerModel);
            if (timerModel.running && !window.gagaRemoteMuted) activeTimerAudio.play().catch(() => { document.getElementById('timer-audio-status').textContent = '무음 진행 · 소리 켜기를 눌러주세요'; });
            else activeTimerAudio.pause();
            document.getElementById('timer-pause-button').textContent = timerModel.running ? '⏸️ 일시정지' : '▶️ 계속';
            if (timerAnimationFrame) cancelAnimationFrame(timerAnimationFrame);
            renderTimerScreen();
        } else if (timerModel) window.closeGagaTimer();
        if (Number.isFinite(state.volume)) window.globalVolume = state.volume;
        window.isGlobalMuted = !!state.muted; applyGlobalVolume();
        refreshSchoolViews(); syncBackgroundMusic();
    } finally { applyingMatch = false; }
}
const trackedActions = ['toggleAttendance', 'changeGagaScore', 'addGagaTeamScore', 'assignSelectedReferees', 'resetAllScoresDB',
    'resetGagaDraw', 'deleteStudent', 'importFromExcel', 'executeGagaDraw', 'executeGagaTeams', 'startChampionsTournament'];
for (const name of trackedActions) {
    const original = window[name];
    window[name] = function(...args) {
        if (window.gagaReadOnly && !applyingMatch) return;
        const before = schoolState(), match = captureMatch();
        const result = original(...args);
        if (['executeGagaDraw', 'executeGagaTeams', 'startChampionsTournament'].includes(name)) presentationEffect = {
            id: crypto.randomUUID(), at: Date.now(), kind: name === 'executeGagaTeams' ? 'team' : 'draw' };
        if (!applyingMatch && JSON.stringify(before) !== JSON.stringify(schoolState())) {
            undoEntries.push({ before, after: schoolState(), match }); undoEntries = undoEntries.slice(-15);
            try { localStorage.setItem(`gaga-safety-backup:${userId}`, JSON.stringify({ version: 1, savedAt: Date.now(), school: before })); } catch {}
        }
        persistMatch(); return result;
    };
}
for (const name of ['toggleTeamKing', 'toggleWantedEffect', 'switchGagaTab', 'closeGagaDrawModal', 'openGagaTimer', 'closeGagaTimer',
    'toggleGagaTimerPause', 'restartGagaTimer', 'seekGagaTimer', 'setGlobalVolume', 'toggleGlobalMute']) {
    const original = window[name];
    window[name] = function(...args) { if (window.gagaReadOnly && !applyingMatch) return; const result = original(...args); persistMatch(); return result; };
}
const selectClassOriginal = window.selectClass;
window.selectClass = function(name) {
    if (window.gagaReadOnly && !applyingMatch) return;
    const previous = localStorage.getItem(`gaga-match-v1:${userId}:${name}`);
    selectClassOriginal(name);
    undoEntries = [];
    if (!applyingMatch && previous) { try { restoreMatch(JSON.parse(previous), true); } catch {} }
    persistMatch();
};
mountConsole({
    auth, db, schoolRef,
    get: () => ({ userId, currentClass, classes: Object.keys(classData).filter(name => !hiddenClasses.includes(name)).sort(),
        students: structuredClone(classData[currentClass] || []), selected: [...window.selectedParticipants], match: captureMatch(),
        syncError, pending: saveRequested || saveInFlight, undo: undoEntries.length, busy: isSpinning || !!rouletteAutoCloseTimer }),
    restoreMatch,
    retry: () => { syncError = ''; flushSaveData(); },
    reloadCloud: async () => {
        if (saveInFlight) return alert('저장 처리가 끝난 뒤 다시 시도해주세요.');
        if (!confirm('현재 기록을 안전 백업에 보관한 뒤 서버의 최신 기록으로 바꿉니다. 계속할까요?')) return;
        const snapshot = await getDoc(schoolRef());
        localStorage.setItem(`gaga-safety-backup:${userId}`, JSON.stringify({ version: 1, school: schoolState() }));
        clearTimeout(saveTimer); pendingCommit = null; saveRequested = false; syncError = '';
        localStorage.removeItem(draftKey()); savedSchool = readSchool(snapshot.data()); applySchool(savedSchool);
        setSyncStatus('idle'); refreshSchoolViews();
    },
    unlock: () => { initAudio(); prepareTimerAudio(); applyGlobalVolume(); syncBackgroundMusic();
        if (activeTimerAudio && timerModel?.running && !window.gagaRemoteMuted) activeTimerAudio.play().then(() => { document.getElementById('timer-audio-status').textContent = ''; }).catch(() => {}); },
    setOutput: remote => {
        const changed = !!window.gagaRemoteMuted !== remote;
        const state = currentClass ? captureMatch() : null;
        window.gagaRemoteMuted = remote;
        if (changed && timerModel) {
            applyingMatch = true;
            try { window.closeGagaTimer(false); } finally { applyingMatch = false; }
        }
        if (state) restoreMatch(state);
        applyGlobalVolume(); syncBackgroundMusic();
    },
    backup: () => ({ version: 1, savedAt: Date.now(), school: schoolState() }),
    safetyBackup: () => JSON.parse(localStorage.getItem(`gaga-safety-backup:${userId}`) || 'null'),
    draft: () => JSON.parse(localStorage.getItem(draftKey()) || 'null'),
    importBackup: value => { const state = validateBackup(value); if (!confirm('백업의 학급 명단과 점수를 복원합니다. 현재 데이터의 백업을 먼저 내려받았나요?')) return;
        localStorage.setItem(`gaga-safety-backup:${userId}`, JSON.stringify({ version: 1, school: schoolState() }));
        applySchool(readSchool(state)); saveData(); refreshSchoolViews(); },
    undo: () => {
        const entry = undoEntries.at(-1); if (!entry) return;
        try { const restored = mergeSchoolState(entry.after, entry.before, schoolState()); applySchool(restored); undoEntries.pop();
            restoreMatch(entry.match, true); saveData(); refreshSchoolViews(); persistMatch(); }
        catch { alert('다른 변경과 겹쳐 되돌릴 수 없습니다. 백업과 현재 기록을 확인해주세요.'); }
    },
    act: (name, ...args) => {
        if (!currentClass && name !== 'selectClass') return;
        if (name === 'openGagaTimer') window.closeRouletteModal(true);
        if (name === 'switchGagaTab') { window.closeGagaTimer(); window.closeGagaDrawModal(); window.closeRouletteModal(true); }
        if (name === 'draw') {
            window.switchGagaTab('score');
            document.getElementById('gaga-draw-count').value = args[1];
            const roster = classData[currentClass] || []; const limit = getIndividualRefereeLimit(roster);
            const available = roster.filter(s => s.attendance && !s.gagaDrawn && (args[0] === 'all' || s.gender === args[0]) && (!s.isReferee || limit > 0));
            if (!available.length) return alert('추첨할 대기 학생이 없습니다. 추첨 기록을 초기화해주세요.');
            window.executeGagaDraw(args[0], Number(args[1]), available, limit);
        } else if (name === 'teams') { window.executeGagaTeams(Number(args[0]), (classData[currentClass] || []).filter(s => s.attendance)); window.switchGagaTab('team'); }
        else if (name === 'referee') { window.selectedParticipants = args[0]; window.assignSelectedReferees(); }
        else if (name === 'champions') { window.closeGagaTimer(false); window.switchGagaTab('score'); window.selectedParticipants = args[0]; window.startChampionsTournament(); }
        else if (['selectClass', 'toggleAttendance', 'changeGagaScore', 'addGagaTeamScore', 'toggleTeamKing', 'openRouletteModal', 'openGagaTimer',
            'toggleGagaTimerPause', 'restartGagaTimer', 'closeGagaTimer', 'closeGagaDrawModal', 'switchGagaTab', 'setGlobalVolume', 'toggleGlobalMute', 'resetGagaDraw'].includes(name)) window[name](...args);
        persistMatch();
    }
});
