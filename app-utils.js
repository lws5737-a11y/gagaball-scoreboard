export function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    })[character]);
}

export function normalizeClassName(name) {
    return name ? name.trim().replace(/\s+/g, '') : name;
}

export function normalizeGender(gender) {
    const normalized = String(gender ?? '').trim().replace(/학생$/, '');
    return normalized === '남' || normalized === '여' ? normalized : '-';
}

export function mergeStudent(existingStudent, { no, name, gender }) {
    const defaults = {
        no, name, gender: normalizeGender(gender), ballSense: '0', attendance: true,
        score: 0, recordMs: 0, memo: '', dismissalInfo: '', drawn: false,
        groupMemberDrawn: false, gagaDrawn: false, isReferee: false,
        captain_mixed2: false, captain_mixed3: false, captain_mixed4: false,
        captain_gender: false, group_mixed2: null, group_mixed3: null,
        group_mixed4: null, group_gender: null
    };

    return existingStudent
        ? { ...defaults, ...existingStudent, no, name, gender: normalizeGender(gender) }
        : defaults;
}

// Gender-specific options prioritize that group without removing other participants.
export function sortParticipants(students, mode = 'number') {
    const [targetGender, criterion] = mode.startsWith('boys-') ? ['남', mode.slice(5)]
        : mode.startsWith('girls-') ? ['여', mode.slice(6)] : [null, mode];
    return [...students].sort((a, b) => {
        if (targetGender && (a.gender === targetGender) !== (b.gender === targetGender)) {
            return a.gender === targetGender ? -1 : 1;
        }
        if (criterion === 'score') {
            const scoreDifference = (Number(b.score) || 0) - (Number(a.score) || 0);
            if (scoreDifference) return scoreDifference;
        }
        return (Number(a.no) || 0) - (Number(b.no) || 0);
    });
}

export function buildRankingPages(students, pageSize = 12) {
    const size = Math.max(1, Math.floor(Number(pageSize) || 12));
    const sorted = [...students]
        .filter(student => student.attendance)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)
            || (Number(a.no) || 0) - (Number(b.no) || 0));
    let rank = 1;
    const ranked = sorted.map((student, index) => {
        if (index > 0 && (Number(student.score) || 0) < (Number(sorted[index - 1].score) || 0)) {
            rank = index + 1;
        }
        return { ...student, rank };
    });
    const pages = [];
    for (let index = 3; index < ranked.length; index += size) {
        pages.push(ranked.slice(index, index + size));
    }
    return { podium: ranked.slice(0, 3), pages };
}

export function getRankingGridLayout(viewportWidth, availableHeight, remainingCount) {
    const width = Number(viewportWidth) || 0;
    const columns = width >= 1600 ? 5 : width >= 1200 ? 4 : width >= 900 ? 3 : 2;
    const gap = width < 640 ? 6 : 10;
    const targetHeight = width < 640 ? 120 : width < 900 ? 108 : width >= 1600 ? 90 : 104;
    const maximumRows = Math.max(1, Math.ceil(Math.max(0, remainingCount) / columns));
    const fitRows = availableHeight > 0
        ? Math.max(1, Math.floor((availableHeight + gap) / (targetHeight + gap)))
        : 3;
    const rows = Math.min(maximumRows, width < 900 ? 3 : fitRows);
    const desiredHeight = rows * (width < 640 ? 120 : 145) + (rows - 1) * gap;
    const height = width < 900 || availableHeight <= 0
        ? rows * targetHeight + (rows - 1) * gap
        : Math.max(targetHeight, Math.min(availableHeight, desiredHeight));
    return { columns, rows, pageSize: columns * rows, height };
}

export function avatarPaths(gender) {
    const prefix = gender === '남' ? 'boy' : gender === '여' ? 'girl' : null;
    return prefix ? Array.from({ length: 50 }, (_, index) =>
        `images/avatars/v2/${prefix}_${String(index + 1).padStart(2, '0')}.webp`) : [];
}

// Keep valid manual choices, then give every remaining student a distinct random avatar.
// Mutates the roster so the assignment survives subsequent renders and cloud syncs.
export function assignUniqueClassAvatars(students, random = Math.random) {
    let changed = false;
    for (const gender of ['남', '여']) {
        const roster = students.filter(student => student.gender === gender);
        const paths = avatarPaths(gender);
        const used = new Set();
        const pending = [];
        for (const student of roster) {
            if (paths.includes(student.customAvatar) && !used.has(student.customAvatar)) {
                used.add(student.customAvatar);
            } else {
                pending.push(student);
            }
        }
        const available = paths.filter(path => !used.has(path));
        for (let index = available.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(random() * (index + 1));
            [available[index], available[swapIndex]] = [available[swapIndex], available[index]];
        }
        for (const student of pending) {
            const next = available.pop() || null;
            if (student.customAvatar !== next) {
                student.customAvatar = next;
                changed = true;
            }
        }
    }
    return changed;
}

export function getCountdownState(audioSeconds, gameSeconds) {
    const elapsed = Math.max(0, Number(audioSeconds) || 0);
    if (elapsed < 3) {
        const startStage = elapsed >= 2.3 ? 4 : elapsed >= 1.56 ? 3 : elapsed >= 0.78 ? 2 : 1;
        return { phase: 'intro', number: null, remaining: gameSeconds, startStage };
    }
    const remaining = Math.max(0, Math.ceil(gameSeconds - (elapsed - 3)));
    if (remaining === 0) return { phase: 'done', number: 0, remaining: 0 };
    return { phase: remaining <= 10 ? 'final' : 'running', number: remaining, remaining };
}

export function validateMissions(missions) {
    if (!Array.isArray(missions) || missions.length === 0) {
        return { valid: false, message: '룰렛 항목을 1개 이상 등록해주세요.' };
    }

    const normalized = missions.map((mission) => ({
        text: String(mission.text ?? '').trim(),
        desc: String(mission.desc ?? '').trim(),
        color: /^#[0-9a-f]{6}$/i.test(mission.color ?? '') ? mission.color : '#74b9ff',
        weight: Number.isFinite(Number(mission.weight)) ? Math.max(0, Number(mission.weight)) : 0
    }));

    if (normalized.some((mission) => !mission.text)) {
        return { valid: false, message: '모든 룰렛 항목에 미션명을 입력해주세요.' };
    }
    if (normalized.reduce((sum, mission) => sum + mission.weight, 0) <= 0) {
        return { valid: false, message: '룰렛 확률의 합은 1 이상이어야 합니다.' };
    }
    return { valid: true, missions: normalized };
}

export function limitSelectedReferees(picked, remaining, maximumReferees = 2) {
    const result = [...picked];
    const replacements = remaining.filter((student) => !student.isReferee);
    const refereeIndexes = result
        .map((student, index) => student.isReferee ? index : -1)
        .filter((index) => index >= 0);

    while (refereeIndexes.length > maximumReferees) {
        const refereeIndex = refereeIndexes.pop();
        if (replacements.length > 0) result[refereeIndex] = replacements.shift();
        else result.splice(refereeIndex, 1);
    }
    return result;
}

export function isWantedMission(mission) {
    const label = `${mission?.text || ''} ${mission?.desc || ''}`.normalize('NFKC');
    return /현상[\s\u200b-\u200d\ufeff·:!_-]*수배|\bwanted\b/i.test(label);
}

// A match may use every appointed referee except one who stays available to officiate.
// Previously drawn referees still count: they can referee a later match.
export function getIndividualRefereeLimit(students) {
    const activeReferees = students.filter(student => student.attendance && student.isReferee).length;
    return Math.max(0, activeReferees - 1);
}

export function getTeamRefereePlan(students, numTeams) {
    const referees = students.filter(student => student.isReferee);
    // A two-team match has no other matchup to supply a referee.
    const standbyReferees = referees.length && (numTeams === 2 || referees.length === 1) ? [referees[0]] : [];
    return {
        participants: standbyReferees.length ? students.filter(student => student !== referees[0]) : [...students],
        standbyReferees,
        warnAllRefereesPlaying: false
    };
}

export function getMatchReferees(students, players) {
    const playing = new Set(players.map(student => Number(student.no)));
    return students.filter(student => student.attendance && student.isReferee && !playing.has(Number(student.no)))
        .sort((a, b) => a.no - b.no);
}

// Start after the last assigned number; skip players without consuming extra turns.
export function rotateMatchReferee(students, players, lastNo = null) {
    const eligible = getMatchReferees(students, players);
    const referee = eligible.find(s => lastNo === null || Number(s.no) > Number(lastNo)) || eligible[0];
    return { refereeNo: referee ? Number(referee.no) : null, lastNo: referee ? Number(referee.no) : lastNo };
}

export function toggleTeamKingSelection(members, memberNo) {
    const selected = members.find(member => Number(member.no) === Number(memberNo));
    if (!selected) return null;
    const isKing = !selected.isKing;
    members.forEach(member => { member.isKing = member === selected && isKing; });
    return isKing;
}

export function getRefereeEligibleTeams(teams) {
    const eligibleTeams = teams.filter((team) => team.members.length < team.targetSize);
    if (!eligibleTeams.length) return [];
    const refereeCounts = eligibleTeams.map((team) => {
        const matchupId = Math.floor((team.id - 1) / 2);
        const matchupReferees = teams
            .filter((candidate) => Math.floor((candidate.id - 1) / 2) === matchupId)
            .reduce((count, candidate) => count + candidate.members.filter((member) => member.isReferee).length, 0);
        return { team, matchupReferees, teamReferees: team.members.filter((member) => member.isReferee).length };
    });
    const fewestInMatchup = Math.min(...refereeCounts.map((entry) => entry.matchupReferees));
    const bestMatchups = refereeCounts.filter((entry) => entry.matchupReferees === fewestInMatchup);
    const fewestInTeam = Math.min(...bestMatchups.map((entry) => entry.teamReferees));
    return bestMatchups.filter((entry) => entry.teamReferees === fewestInTeam).map((entry) => entry.team);
}
