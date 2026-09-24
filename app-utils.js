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
    const normalized = String(gender ?? '').trim();
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

export function getRefereeEligibleTeams(teams) {
    const eligibleTeams = teams.filter((team) => team.members.length < team.targetSize);
    const teamsWithoutMatchupReferee = eligibleTeams.filter((team) => {
        const matchupId = Math.floor((team.id - 1) / 2);
        return !teams
            .filter((candidate) => Math.floor((candidate.id - 1) / 2) === matchupId)
            .some((candidate) => candidate.members.some((member) => member.isReferee));
    });

    return teamsWithoutMatchupReferee.length > 0 ? teamsWithoutMatchupReferee : eligibleTeams;
}
