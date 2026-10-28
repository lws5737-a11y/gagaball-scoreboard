import { escapeHTML as h, sortParticipants } from './app-utils.js';

export function nextTeamScroll(top, min, max, direction, elapsed) {
    const next = Math.max(min, Math.min(max, top + direction * Math.min(elapsed, 100) * 0.035));
    return { top: next, direction: next >= max ? -1 : next <= min ? 1 : direction, edge: next >= max || next <= min };
}

export function mountGameScreens(api) {
    const modal = document.createElement('div');
    modal.id = 'player-picker';
    modal.className = 'gaga-modal-overlay';
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'player-picker-title');
    modal.innerHTML = `<section class="player-picker-panel">
        <header><h2 id="player-picker-title"></h2><button class="game-action secondary-action" data-picker="close" aria-label="선수 선택 닫기">✕</button></header>
        <p id="player-picker-help"></p>
        <div class="picker-filters"><label>성별 <select id="picker-gender"><option value="all">전체</option><option value="남">남학생</option><option value="여">여학생</option></select></label>
        <label>정렬 <select id="picker-sort"><option value="score">점수 높은 순</option><option value="number">번호순</option><option value="boys-score">남학생 → 여학생 · 점수순</option><option value="girls-score">여학생 → 남학생 · 점수순</option></select></label></div>
        <div id="picker-list" class="picker-list"></div>
        <footer><strong id="picker-count" aria-live="polite"></strong><button class="game-action secondary-action" data-picker="clear">선택 초기화</button><button id="picker-confirm" class="game-action champions-action" data-picker="confirm"></button></footer>
    </section>`;
    document.body.append(modal);
    let purpose = 'champions', selection = new Set(), className = '', returnFocus;
    const close = () => { modal.style.display = 'none'; returnFocus?.focus(); };
    const render = () => {
        const state = api.get();
        if (state.className !== className) { close(); return; }
        const students = state.students.filter(s => s.attendance);
        selection = new Set([...selection].filter(no => students.some(s => s.no === no)));
        const gender = document.getElementById('picker-gender').value;
        const sorted = sortParticipants(students, document.getElementById('picker-sort').value).filter(s => gender === 'all' || s.gender === gender);
        document.getElementById('picker-list').innerHTML = sorted.map(s => `<button class="picker-student" data-student="${s.no}" aria-pressed="${selection.has(s.no)}">
            <img src="${h(api.avatar(s))}" alt=""><span><b>${h(s.name)}</b><small>${h(s.gender)} · ${s.no}번${s.isReferee ? ' · 심판' : ''}</small></span><strong>${s.score || 0}</strong><i aria-hidden="true">${selection.has(s.no) ? '✓' : '+'}</i></button>`).join('') || '<p>해당하는 참가 학생이 없습니다.</p>';
        document.getElementById('picker-count').textContent = `${selection.size}명 선택`;
        const confirm = document.getElementById('picker-confirm');
        confirm.textContent = purpose === 'champions' ? '👑 왕중왕전 입장' : '심판 명단 저장';
        confirm.disabled = purpose === 'champions' && (selection.size < 2 || selection.size > 10);
    };
    window.openPlayerPicker = mode => {
        const state = api.get(); if (!state.className) return;
        purpose = mode; className = state.className; returnFocus = document.activeElement;
        selection = new Set(mode === 'referee' ? state.students.filter(s => s.attendance && s.isReferee).map(s => s.no) : []);
        document.getElementById('picker-gender').value = 'all';
        document.getElementById('picker-sort').value = 'score';
        document.getElementById('player-picker-title').textContent = mode === 'referee' ? '⚖️ 심판 임명' : '👑 왕중왕전 선수 선택';
        document.getElementById('player-picker-help').textContent = mode === 'referee' ? '심판을 선택하세요. 선택을 해제하면 심판 임명도 해제됩니다.' : '출전할 학생을 2~10명 선택하세요. 성별과 점수순으로 찾아볼 수 있습니다.';
        modal.style.display = 'flex'; render(); modal.querySelector('select').focus();
    };
    modal.addEventListener('change', render);
    modal.addEventListener('click', event => {
        if (event.target === modal || event.target.closest('[data-picker="close"]')) return close();
        const student = event.target.closest('[data-student]');
        if (student) { const no = Number(student.dataset.student); selection.has(no) ? selection.delete(no) : selection.add(no); render(); }
        if (event.target.closest('[data-picker="clear"]')) { selection.clear(); render(); }
        if (event.target.closest('[data-picker="confirm"]') && !document.getElementById('picker-confirm').disabled) {
            if (api.get().className !== className) return close();
            const numbers = [...selection]; close(); api.choose(purpose, numbers);
            window.dispatchEvent(new CustomEvent('gaga-player-picked', { detail: purpose }));
        }
    });
    modal.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
            const elements = [...modal.querySelectorAll('button:not(:disabled), select')];
            const first = elements[0], last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });

    let enabled = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let idleUntil = performance.now() + 5000, previous = 0, direction = 1;
    const toggle = document.getElementById('team-scroll-toggle');
    const label = () => { toggle.textContent = enabled ? '자동 스크롤 켜짐' : '자동 스크롤 꺼짐'; toggle.setAttribute('aria-pressed', String(enabled)); };
    window.toggleTeamAutoScroll = () => { enabled = !enabled; idleUntil = performance.now() + 5000; label(); };
    label();
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'pointermove', 'keydown', 'focusin']) document.addEventListener(type, () => { idleUntil = performance.now() + 5000; }, { passive: true });
    function tick(now) {
        const elapsed = previous ? now - previous : 0; previous = now;
        const view = document.getElementById('gaga-view-team');
        const active = enabled && !document.hidden && now >= idleUntil && api.canScroll()
            && document.documentElement.dataset.console !== 'compact' && view.getClientRects().length;
        if (active && ![...document.querySelectorAll('.gaga-modal-overlay, #timerScreen, #event-loading-overlay, #console-settings')].some(node => node.getClientRects().length)) {
            const scroller = document.scrollingElement;
            const grid = document.getElementById('gaga-team-matchups');
            const rect = grid.getBoundingClientRect();
            const header = document.getElementById('main-header').getBoundingClientRect().height;
            const min = Math.max(0, view.getBoundingClientRect().top + scroller.scrollTop - header - 12);
            const max = Math.min(scroller.scrollHeight - innerHeight, rect.bottom + scroller.scrollTop - innerHeight + 100);
            if (max > min + 20) {
                const next = nextTeamScroll(scroller.scrollTop, min, max, direction, elapsed);
                scroller.scrollTop = next.top; direction = next.direction;
                if (next.edge) idleUntil = now + 2500;
            }
        }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}
