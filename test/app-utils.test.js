import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assignUniqueClassAvatars,
    avatarPaths,
    getCountdownState,
    escapeHTML,
    getRefereeEligibleTeams,
    limitSelectedReferees,
    mergeStudent,
    normalizeGender,
    sortParticipants,
    validateMissions
} from '../app-utils.js';

test('sorts participants by number, score, or prioritized gender without hiding anyone', () => {
    const roster = [
        { no: 4, gender: '여', score: 3 },
        { no: 1, gender: '남', score: 2 },
        { no: 3, gender: '여', score: 5 },
        { no: 2, gender: '남', score: 5 }
    ];
    const numbers = mode => sortParticipants(roster, mode).map(student => student.no);
    assert.deepEqual(numbers('number'), [1, 2, 3, 4]);
    assert.deepEqual(numbers('score'), [2, 3, 4, 1]);
    assert.deepEqual(numbers('boys-number'), [1, 2, 3, 4]);
    assert.deepEqual(numbers('girls-number'), [3, 4, 1, 2]);
    assert.deepEqual(numbers('boys-score'), [2, 1, 3, 4]);
    assert.deepEqual(numbers('girls-score'), [3, 4, 2, 1]);
    assert.deepEqual(roster.map(student => student.no), [4, 1, 3, 2]);
});

test('countdown visuals follow the audio intro and final spoken seconds', () => {
    assert.deepEqual(getCountdownState(0, 60), { phase: 'intro', number: null, remaining: 60, startStage: 1 });
    assert.deepEqual(getCountdownState(0.78, 60), { phase: 'intro', number: null, remaining: 60, startStage: 2 });
    assert.deepEqual(getCountdownState(1.56, 60), { phase: 'intro', number: null, remaining: 60, startStage: 3 });
    assert.deepEqual(getCountdownState(2.3, 60), { phase: 'intro', number: null, remaining: 60, startStage: 4 });
    assert.deepEqual(getCountdownState(3, 60), { phase: 'running', number: 60, remaining: 60 });
    assert.deepEqual(getCountdownState(53, 60), { phase: 'final', number: 10, remaining: 10 });
    assert.deepEqual(getCountdownState(62, 60), { phase: 'final', number: 1, remaining: 1 });
    assert.deepEqual(getCountdownState(63, 60), { phase: 'done', number: 0, remaining: 0 });
    assert.deepEqual(getCountdownState(93, 100), { phase: 'final', number: 10, remaining: 10 });
});

test('assigns distinct new avatars by gender and keeps choices stable', () => {
    const students = [
        ...Array.from({ length: 25 }, (_, index) => ({ no: index + 1, gender: '남' })),
        ...Array.from({ length: 25 }, (_, index) => ({ no: index + 26, gender: '여' }))
    ];
    assert.equal(assignUniqueClassAvatars(students, () => 0.5), true);
    assert.equal(new Set(students.map(student => student.customAvatar)).size, 50);
    for (const student of students) assert.ok(avatarPaths(student.gender).includes(student.customAvatar));
    assert.equal(assignUniqueClassAvatars(students, () => 0.1), false);
});

test('replaces legacy and duplicate avatars without moving a valid first choice', () => {
    const chosen = avatarPaths('남')[0];
    const students = [
        { no: 1, gender: '남', customAvatar: chosen },
        { no: 2, gender: '남', customAvatar: chosen },
        { no: 3, gender: '남', customAvatar: 'images/avatars/boy_1-3.png' },
        { no: 4, gender: '여', customAvatar: chosen }
    ];
    assignUniqueClassAvatars(students, () => 0);
    assert.equal(students[0].customAvatar, chosen);
    assert.equal(new Set(students.map(student => student.customAvatar)).size, 4);
    assert.ok(avatarPaths('여').includes(students[3].customAvatar));
});

test('escapeHTML escapes markup and attribute delimiters', () => {
    assert.equal(escapeHTML(`<img src="x" onerror='bad'>`), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;');
});

test('mergeStudent preserves game data while updating roster fields', () => {
    const existing = { no: 1, name: '이전이름', gender: '남', score: 7, customAvatar: 'avatar.png', isReferee: true };
    const merged = mergeStudent(existing, { no: 1, name: '새이름', gender: '여' });
    assert.equal(merged.name, '새이름');
    assert.equal(merged.gender, '여');
    assert.equal(merged.score, 7);
    assert.equal(merged.customAvatar, 'avatar.png');
    assert.equal(merged.isReferee, true);
});

test('normalizeGender rejects unexpected spreadsheet values', () => {
    assert.equal(normalizeGender('남'), '남');
    assert.equal(normalizeGender('기타'), '-');
});

test('validateMissions rejects empty and zero-weight roulettes', () => {
    assert.equal(validateMissions([]).valid, false);
    assert.equal(validateMissions([{ text: '미션', desc: '', color: '#ffffff', weight: 0 }]).valid, false);
});

test('validateMissions normalizes valid missions', () => {
    const result = validateMissions([{ text: ' 미션 ', desc: ' 설명 ', color: 'invalid', weight: '10' }]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.missions[0], { text: '미션', desc: '설명', color: '#74b9ff', weight: 10 });
});

test('limitSelectedReferees replaces enough referees to satisfy the limit', () => {
    const picked = [1, 2, 3, 4].map((no) => ({ no, isReferee: true }));
    const remaining = [{ no: 5, isReferee: false }, { no: 6, isReferee: false }];
    const result = limitSelectedReferees(picked, remaining, 2);
    assert.equal(result.filter((student) => student.isReferee).length, 2);
    assert.deepEqual(result.map((student) => student.no).sort(), [1, 2, 5, 6]);
});

test('limitSelectedReferees keeps at most one referee in an individual match', () => {
    const picked = [1, 2, 3].map((no) => ({ no, isReferee: true }));
    const remaining = [{ no: 4, isReferee: false }, { no: 5, isReferee: false }];
    const result = limitSelectedReferees(picked, remaining, 1);
    assert.equal(result.filter((student) => student.isReferee).length, 1);
});

test('limitSelectedReferees removes excess referees when no replacement exists', () => {
    const result = limitSelectedReferees([
        { no: 1, isReferee: true },
        { no: 2, isReferee: true }
    ], [], 1);
    assert.deepEqual(result.map((student) => student.no), [1]);
});

test('getRefereeEligibleTeams keeps referees out of the opposing team', () => {
    const referee = { no: 1, isReferee: true };
    const teams = [
        { id: 1, members: [referee], targetSize: 3 },
        { id: 2, members: [], targetSize: 3 },
        { id: 3, members: [], targetSize: 3 },
        { id: 4, members: [], targetSize: 3 }
    ];
    assert.deepEqual(getRefereeEligibleTeams(teams).map((team) => team.id), [3, 4]);
});

test('getRefereeEligibleTeams spreads appointed referees across matchups before pairing them', () => {
    const teams = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, members: [], targetSize: 3 }));
    for (let no = 1; no <= 4; no++) {
        const eligible = getRefereeEligibleTeams(teams);
        eligible[0].members.push({ no, isReferee: true });
    }
    for (let index = 0; index < 8; index += 2) {
        const refereeCount = [...teams[index].members, ...teams[index + 1].members].filter(member => member.isReferee).length;
        assert.equal(refereeCount, 1);
    }
});

test('when no separate matchup remains, referees are spread across teams', () => {
    const referee = { isReferee: true };
    const teams = [
        { id: 1, members: [referee], targetSize: 3 },
        { id: 2, members: [], targetSize: 3 },
        { id: 3, members: [referee], targetSize: 3 },
        { id: 4, members: [], targetSize: 3 }
    ];
    assert.deepEqual(getRefereeEligibleTeams(teams).map(team => team.id), [2, 4]);
});
