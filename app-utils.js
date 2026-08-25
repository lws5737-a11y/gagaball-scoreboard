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

    while (refereeIndexes.length > maximumReferees && replacements.length > 0) {
        result[refereeIndexes.pop()] = replacements.shift();
    }
    return result;
}
